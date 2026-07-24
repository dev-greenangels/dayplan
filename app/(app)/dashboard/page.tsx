import { redirect } from 'next/navigation'
import { requireUser, isDeputyOrBoss } from '@/lib/auth'
import { todayISO } from '@/lib/format-date'
import type { DayPlan, Profile, TaskRow, Team } from '@/lib/types'
import EmployeeDashboard from './employee-dashboard'

type TaskRowWithPlan = TaskRow & { day_plans: DayPlan | null }

const ROW_SELECT =
  'id, plan_id, employee_id, shift, planned, notified, completed, notes, notify_email, notify_push, created_at, plan_email_sent_at, plan_push_sent_at, report_sent_at, extra, day_plans!inner(id, plan_date, team_id, created_by, created_at, digest_sent_at)'

interface Props {
  searchParams: Promise<{ date?: string }>
}

export default async function DashboardPage({ searchParams }: Props) {
  const { supabase, profile, user } = await requireUser()
  const params = await searchParams

  if (isDeputyOrBoss(profile.role)) {
    redirect('/admin')
  }

  const today = todayISO()
  const requested =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today

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

  const { data: allData } = await supabase
    .from('task_rows')
    .select(ROW_SELECT)
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false })

  const allRows = (allData ?? []) as unknown as TaskRowWithPlan[]
  const planDates = [
    ...new Set(
      allRows
        .map(r => r.day_plans?.plan_date)
        .filter((d): d is string => !!d)
    ),
  ].sort()

  let selectedDate = requested
  if (planDates.length > 0 && !planDates.includes(selectedDate)) {
    const pastOrToday = planDates.filter(d => d <= today)
    selectedDate = pastOrToday.length ? pastOrToday[pastOrToday.length - 1] : planDates[0]
    if (selectedDate !== requested) {
      redirect(`/dashboard?date=${selectedDate}`)
    }
  }

  const selectedRow =
    allRows.find(r => r.day_plans?.plan_date === selectedDate) ?? null
  const team = membership?.team as unknown as Pick<Team, 'id' | 'name' | 'work_mode'> | null

  return (
    <EmployeeDashboard
      profile={profile as Profile}
      selectedDate={selectedDate}
      selectedRow={selectedRow}
      planDates={planDates}
      teamName={team?.name}
      teamId={team?.id ?? membership?.team_id}
      isToday={selectedDate === today}
    />
  )
}
