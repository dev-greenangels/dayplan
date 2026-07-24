import { redirect } from 'next/navigation'
import { requireUser, isDeputyOrBoss } from '@/lib/auth'
import { todayISO } from '@/lib/format-date'
import type { DayPlan, Profile, TaskRow, Team } from '@/lib/types'
import EmployeeDashboard from './employee-dashboard'

type TaskRowWithPlan = TaskRow & { day_plans: DayPlan | null }

const ROW_SELECT =
  'id, plan_id, employee_id, shift, planned, notified, completed, notes, notify_email, notify_push, created_at, plan_email_sent_at, plan_push_sent_at, extra, day_plans!inner(id, plan_date, team_id, created_by, created_at, digest_sent_at)'

export default async function DashboardPage() {
  const { supabase, profile, user } = await requireUser()

  if (isDeputyOrBoss(profile.role)) {
    redirect('/admin')
  }

  const today = todayISO()

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id, department_id, team:teams(id, name, work_mode)')
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.team) {
    const team = membership.team as unknown as Pick<Team, 'id' | 'name' | 'work_mode'>
    if (team.work_mode === 'shared') {
      redirect(`/teams/${team.id}/plans/${today}`)
    }
  }

  const [{ data: todayData }, { data: pastData }] = await Promise.all([
    supabase
      .from('task_rows')
      .select(ROW_SELECT)
      .eq('employee_id', user.id)
      .eq('day_plans.plan_date', today)
      .maybeSingle(),
    supabase
      .from('task_rows')
      .select(ROW_SELECT)
      .eq('employee_id', user.id)
      .neq('day_plans.plan_date', today)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const todayRow = (todayData as unknown as TaskRowWithPlan | null) ?? null
  const pastRows = (pastData ?? []) as unknown as TaskRowWithPlan[]
  const team = membership?.team as unknown as Pick<Team, 'id' | 'name' | 'work_mode'> | null

  return (
    <EmployeeDashboard
      profile={profile as Profile}
      todayRow={todayRow}
      todayPlan={todayRow?.day_plans ?? null}
      pastRows={pastRows}
      teamName={team?.name}
      teamId={team?.id ?? membership?.team_id}
    />
  )
}
