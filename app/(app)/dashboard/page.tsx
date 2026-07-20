import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { DayPlan, Profile, TaskRow } from '@/lib/types'
import EmployeeDashboard from './employee-dashboard'
import AdminDashboard from './admin-dashboard'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>()

  if (!profile) redirect('/auth/login')

  const isAdmin = profile.role === 'super_admin' || profile.role === 'sub_admin'

  if (isAdmin) {
    const { data: plans } = await supabase
      .from('day_plans')
      .select('*')
      .order('plan_date', { ascending: false })

    const grouped: Record<string, DayPlan[]> = {}
    for (const plan of plans ?? []) {
      if (!grouped[plan.plan_date]) grouped[plan.plan_date] = []
      grouped[plan.plan_date].push(plan)
    }

    return <AdminDashboard grouped={grouped} profile={profile} />
  }

  // Employee: find today's task row
  const today = new Date().toISOString().slice(0, 10)
  const { data: taskRows } = await supabase
    .from('task_rows')
    .select('*, day_plans(*)')
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false })

  type TaskRowWithPlan = TaskRow & { day_plans: DayPlan | null }
  const typedRows = (taskRows ?? []) as TaskRowWithPlan[]

  const todayRow = typedRows.find(r => r.day_plans?.plan_date === today) ?? null
  const pastRows = typedRows.filter(r => r.day_plans?.plan_date !== today).slice(0, 5)

  return (
    <EmployeeDashboard
      profile={profile}
      todayRow={todayRow}
      todayPlan={todayRow?.day_plans ?? null}
      pastRows={pastRows}
    />
  )
}
