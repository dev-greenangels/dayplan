'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, requireUser, canManageTeam, canEditTeamTasks } from '@/lib/auth'

export interface PlanRowInput {
  employee_id: string
  department_id: string | null
  shift: string
  planned: string
  completed?: string
  notes?: string
  notify_email: boolean
  notify_push: boolean
  extra?: Record<string, string>
}

export async function ensureDayPlan(
  teamId: string,
  date: string,
  ctx?: Awaited<ReturnType<typeof requireAdmin>>
) {
  const { supabase, user, profile } = ctx ?? (await requireAdmin())
  if (!(await canManageTeam(supabase, profile, teamId))) {
    return { error: 'Немає доступу' }
  }

  const { data: existing } = await supabase
    .from('day_plans')
    .select('id, team_id, plan_date, created_by, created_at, digest_sent_at, digest_receipts')
    .eq('team_id', teamId)
    .eq('plan_date', date)
    .maybeSingle()

  if (existing) return { plan: existing }

  const { data: plan, error } = await supabase
    .from('day_plans')
    .insert({ team_id: teamId, plan_date: date, created_by: user.id, department: '' })
    .select('id, team_id, plan_date, created_by, created_at, digest_sent_at, digest_receipts')
    .single()

  if (error) return { error: error.message }
  return { plan, created: true }
}

export async function getTeamPlan(teamId: string, date: string) {
  const { supabase, profile } = await requireUser()

  const { data: team } = await supabase.from('teams').select('*').eq('id', teamId).single()
  if (!team) return { error: 'Команду не знайдено' }

  const isAdmin = profile.role === 'super_admin' || profile.role === 'sub_admin'
  if (!isAdmin) {
    const { data: member } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('team_id', teamId)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!member) return { error: 'Немає доступу' }
  } else if (!(await canManageTeam(supabase, profile, teamId)) && profile.role !== 'super_admin') {
    return { error: 'Немає доступу' }
  }

  const { data: plan } = await supabase
    .from('day_plans')
    .select('*')
    .eq('team_id', teamId)
    .eq('plan_date', date)
    .maybeSingle()

  const { data: departments } = await supabase
    .from('departments')
    .select('*')
    .eq('team_id', teamId)
    .is('archived_at', null)
    .order('sort_order')

  const { data: columns } = await supabase
    .from('team_columns')
    .select('*')
    .eq('team_id', teamId)
    .order('sort_order')

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id, department_id, profile:profiles(*)')
    .eq('team_id', teamId)

  let rows: unknown[] = []
  if (plan) {
    const { data } = await supabase
      .from('task_rows')
      .select('*, profile:profiles(*), department:departments(*)')
      .eq('plan_id', plan.id)
      .order('created_at')
    rows = data ?? []
  }

  return {
    team,
    plan,
    departments: departments ?? [],
    columns: columns ?? [],
    members: members ?? [],
    rows,
  }
}

export async function saveTeamPlan(teamId: string, date: string, rows: PlanRowInput[]) {
  const ctx = await requireAdmin()
  const { supabase, profile } = ctx
  if (!(await canManageTeam(supabase, profile, teamId))) {
    return { error: 'Немає доступу' }
  }

  const allowEditTasks = await canEditTeamTasks(supabase, profile, teamId)

  const ensured = await ensureDayPlan(teamId, date, ctx)
  if (ensured.error || !ensured.plan) return { error: ensured.error ?? 'Немає плану' }
  const plan = ensured.plan

  // If deputy cannot edit tasks, preserve existing planned/shift from DB
  let existingByEmployee = new Map<string, { planned: string; shift: string; extra: Record<string, string> }>()
  if (!allowEditTasks) {
    const { data: existing } = await supabase
      .from('task_rows')
      .select('employee_id, planned, shift, extra')
      .eq('plan_id', plan.id)
    for (const r of existing ?? []) {
      existingByEmployee.set(r.employee_id, {
        planned: r.planned || '',
        shift: r.shift || '8:00-18:00',
        extra: (r.extra as Record<string, string>) || {},
      })
    }
  }

  if (rows.length > 0) {
    const payload = rows.map(row => {
      const locked = existingByEmployee.get(row.employee_id)
      return {
        plan_id: plan.id,
        employee_id: row.employee_id,
        department_id: row.department_id,
        shift: allowEditTasks ? (row.shift || '8:00-18:00') : (locked?.shift || row.shift || '8:00-18:00'),
        planned: allowEditTasks ? (row.planned ?? '') : (locked?.planned ?? row.planned ?? ''),
        completed: row.completed ?? '',
        notes: row.notes ?? '',
        notify_email: row.notify_email,
        notify_push: row.notify_push,
        extra: allowEditTasks ? (row.extra ?? {}) : (locked?.extra ?? row.extra ?? {}),
      }
    })
    const { error } = await supabase.from('task_rows').upsert(payload, {
      onConflict: 'plan_id,employee_id',
    })
    if (error) return { error: error.message }
  }

  revalidatePath(`/teams/${teamId}/plans/${date}`)
  return { success: true, planId: plan.id, created: ensured.created }
}

export async function updateTaskRowFields(
  rowId: string,
  fields: Partial<{
    shift: string
    planned: string
    completed: string
    notes: string
    notify_email: boolean
    notify_push: boolean
    notified: boolean
    extra: Record<string, string>
    department_id: string | null
  }>
) {
  const { supabase, profile, user } = await requireUser()

  const { data: row } = await supabase
    .from('task_rows')
    .select('*, day_plans(team_id, plan_date)')
    .eq('id', rowId)
    .single()

  if (!row) return { error: 'Рядок не знайдено' }
  const teamId = row.day_plans?.team_id as string
  const planDate = row.day_plans?.plan_date as string | undefined
  const isAdmin =
    profile.role === 'super_admin' ||
    (await canManageTeam(supabase, profile, teamId))

  if (!isAdmin) {
    if (row.employee_id !== user.id) return { error: 'Немає доступу' }
    const allowed: Record<string, unknown> = {}
    if (fields.completed !== undefined) allowed.completed = fields.completed
    if (fields.notes !== undefined) allowed.notes = fields.notes
    if (fields.extra !== undefined) allowed.extra = fields.extra
    const { error } = await supabase.from('task_rows').update(allowed).eq('id', rowId)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('task_rows').update(fields).eq('id', rowId)
    if (error) return { error: error.message }
  }

  if (teamId && planDate) {
    revalidatePath(`/teams/${teamId}/plans/${planDate}`)
  } else if (teamId) {
    revalidatePath(`/teams/${teamId}`)
  }
  return { success: true }
}

export async function syncPlanMembers(teamId: string, date: string) {
  const ctx = await requireAdmin()
  const { supabase, profile } = ctx
  if (!(await canManageTeam(supabase, profile, teamId))) return { error: 'Немає доступу' }

  const ensured = await ensureDayPlan(teamId, date, ctx)
  if (ensured.error || !ensured.plan) return { error: ensured.error ?? 'Немає плану' }

  const { data: teamRow } = await supabase
    .from('teams')
    .select('default_shift')
    .eq('id', teamId)
    .maybeSingle()
  const defaultShift = teamRow?.default_shift?.trim() || '8:00-18:00'

  const { data: hiddenAdmins } = await supabase
    .from('team_admins')
    .select('user_id')
    .eq('team_id', teamId)
    .eq('hide_from_plan', true)
  const hidden = new Set((hiddenAdmins ?? []).map(a => a.user_id))

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id, department_id')
    .eq('team_id', teamId)

  const payload = (members ?? [])
    .filter(m => !hidden.has(m.user_id))
    .map(m => ({
      plan_id: ensured.plan!.id,
      employee_id: m.user_id,
      department_id: m.department_id,
      shift: defaultShift,
      planned: '',
    }))

  if (payload.length) {
    const { error } = await supabase.from('task_rows').upsert(payload, {
      onConflict: 'plan_id,employee_id',
      ignoreDuplicates: true,
    })
    if (error) return { error: error.message }
  }

  revalidatePath(`/teams/${teamId}/plans/${date}`)
  return { success: true, planId: ensured.plan.id }
}

/** Add selected team members to the day plan (skip hide_from_plan deputies). */
export async function addPlanMembers(teamId: string, date: string, userIds: string[]) {
  const ctx = await requireAdmin()
  const { supabase, profile } = ctx
  if (!(await canManageTeam(supabase, profile, teamId))) return { error: 'Немає доступу' }
  if (!userIds.length) return { error: 'Оберіть працівників' }

  const ensured = await ensureDayPlan(teamId, date, ctx)
  if (ensured.error || !ensured.plan) return { error: ensured.error ?? 'Немає плану' }

  const { data: teamRow } = await supabase
    .from('teams')
    .select('default_shift')
    .eq('id', teamId)
    .maybeSingle()
  const defaultShift = teamRow?.default_shift?.trim() || '8:00-18:00'

  const { data: hiddenAdmins } = await supabase
    .from('team_admins')
    .select('user_id')
    .eq('team_id', teamId)
    .eq('hide_from_plan', true)
  const hidden = new Set((hiddenAdmins ?? []).map(a => a.user_id))

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id, department_id')
    .eq('team_id', teamId)
    .in('user_id', userIds)

  const payload = (members ?? [])
    .filter(m => !hidden.has(m.user_id))
    .map(m => ({
      plan_id: ensured.plan!.id,
      employee_id: m.user_id,
      department_id: m.department_id,
      shift: defaultShift,
      planned: '',
    }))

  if (payload.length) {
    const { error } = await supabase.from('task_rows').upsert(payload, {
      onConflict: 'plan_id,employee_id',
      ignoreDuplicates: true,
    })
    if (error) return { error: error.message }
  }

  revalidatePath(`/teams/${teamId}/plans/${date}`)
  return { success: true, planId: ensured.plan.id, addedIds: payload.map(p => p.employee_id) }
}

/** Copy workers + planned tasks from the latest previous plan day. */
export async function copyPlanFromPreviousDay(teamId: string, date: string) {
  const ctx = await requireAdmin()
  const { supabase, profile } = ctx
  if (!(await canManageTeam(supabase, profile, teamId))) return { error: 'Немає доступу' }

  const { data: prev } = await supabase
    .from('day_plans')
    .select('id, plan_date')
    .eq('team_id', teamId)
    .lt('plan_date', date)
    .order('plan_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!prev) return { error: 'Немає попереднього плану для копіювання' }

  const { data: prevRows } = await supabase
    .from('task_rows')
    .select('employee_id, department_id, shift, planned, extra')
    .eq('plan_id', prev.id)

  if (!prevRows?.length) return { error: 'У попередньому плані немає рядків' }

  const ensured = await ensureDayPlan(teamId, date, ctx)
  if (ensured.error || !ensured.plan) return { error: ensured.error ?? 'Немає плану' }

  const payload = prevRows.map(r => ({
    plan_id: ensured.plan!.id,
    employee_id: r.employee_id,
    department_id: r.department_id,
    shift: r.shift || '8:00-18:00',
    planned: r.planned || '',
    completed: '',
    notes: '',
    extra: (r.extra as Record<string, string>) || {},
  }))

  const { error } = await supabase.from('task_rows').upsert(payload, {
    onConflict: 'plan_id,employee_id',
    ignoreDuplicates: false,
  })
  if (error) return { error: error.message }

  revalidatePath(`/teams/${teamId}/plans/${date}`)
  return {
    success: true,
    planId: ensured.plan.id,
    fromDate: prev.plan_date,
    count: payload.length,
  }
}

/** Remove one employee from a day plan (does not remove from team). */
export async function removePlanMember(teamId: string, date: string, employeeId: string) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, teamId))) return { error: 'Немає доступу' }

  const { data: plan } = await supabase
    .from('day_plans')
    .select('id')
    .eq('team_id', teamId)
    .eq('plan_date', date)
    .maybeSingle()

  if (!plan) return { error: 'План не знайдено' }

  const { error } = await supabase
    .from('task_rows')
    .delete()
    .eq('plan_id', plan.id)
    .eq('employee_id', employeeId)

  if (error) return { error: error.message }
  revalidatePath(`/teams/${teamId}/plans/${date}`)
  return { success: true }
}

/** Delete a day plan (and its task rows via FK cascade or explicit delete). */
export async function deleteDayPlan(teamId: string, date: string) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, teamId))) {
    return { error: 'Немає доступу' }
  }

  const { data: plan } = await supabase
    .from('day_plans')
    .select('id')
    .eq('team_id', teamId)
    .eq('plan_date', date)
    .maybeSingle()

  if (!plan) return { error: 'План не знайдено' }

  // task_rows reference plan_id — delete rows then plan (or rely on CASCADE if set)
  await supabase.from('task_rows').delete().eq('plan_id', plan.id)
  const { error } = await supabase.from('day_plans').delete().eq('id', plan.id)
  if (error) return { error: error.message }

  revalidatePath(`/teams/${teamId}/plans/${date}`)
  revalidatePath('/admin')
  return { success: true }
}
