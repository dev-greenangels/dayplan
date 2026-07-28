'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, requireUser, canManageTeam, canEditTeamTasks, isBoss } from '@/lib/auth'
import { applyInputTemplate } from '@/lib/column-templates'
import { todayISO } from '@/lib/format-date'
import type { Profile } from '@/lib/types'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/** Deputy/boss can edit planned/shift only when this day's plan is unlocked. */
async function allowEditingPlanTasks(
  supabase: Supabase,
  profile: Profile,
  teamId: string,
  date: string
): Promise<boolean> {
  if (!(await canEditTeamTasks(supabase, profile, teamId))) return false
  const { data } = await supabase
    .from('day_plans')
    .select('plan_tasks_locked')
    .eq('team_id', teamId)
    .eq('plan_date', date)
    .maybeSingle()
  // No plan yet / missing column → unlocked
  return data?.plan_tasks_locked !== true
}

async function loadColumnTemplates(supabase: Supabase, teamId: string) {
  const { data } = await supabase
    .from('team_columns')
    .select('key, input_template')
    .eq('team_id', teamId)
  const map = new Map<string, string>()
  for (const c of data ?? []) {
    if (c.input_template) map.set(c.key, c.input_template)
  }
  return map
}

function templatesForNewRow(templates: Map<string, string>) {
  const planned = applyInputTemplate('', templates.get('planned'))
  const completed = applyInputTemplate('', templates.get('completed'))
  const notes = applyInputTemplate('', templates.get('notes'))
  const extra: Record<string, string> = {}
  for (const [key, tmpl] of templates) {
    if (key === 'shift' || key === 'planned' || key === 'completed' || key === 'notes') continue
    const applied = applyInputTemplate('', tmpl)
    if (applied) extra[key] = applied
  }
  return { planned, completed, notes, extra }
}

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
    .select('id, team_id, plan_date, created_by, created_at, digest_sent_at, digest_receipts, plan_tasks_locked')
    .eq('team_id', teamId)
    .eq('plan_date', date)
    .maybeSingle()

  if (existing) return { plan: existing }

  const { data: plan, error } = await supabase
    .from('day_plans')
    .insert({ team_id: teamId, plan_date: date, created_by: user.id, department: '', plan_tasks_locked: false })
    .select('id, team_id, plan_date, created_by, created_at, digest_sent_at, digest_receipts, plan_tasks_locked')
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

  const allowEditTasks = await allowEditingPlanTasks(supabase, profile, teamId, date)

  const ensured = await ensureDayPlan(teamId, date, ctx)
  if (ensured.error || !ensured.plan) return { error: ensured.error ?? 'Немає плану' }
  const plan = ensured.plan

  const isPast = date < todayISO()
  const planDigestSent = !!(plan as { digest_sent_at?: string | null }).digest_sent_at
  const { data: existingRows } = await supabase
    .from('task_rows')
    .select('employee_id, planned, shift, extra, completed, notes, report_sent_at')
    .eq('plan_id', plan.id)

  const existingByEmployee = new Map<
    string,
    {
      planned: string
      shift: string
      extra: Record<string, string>
      completed: string
      notes: string
      report_sent_at: string | null
    }
  >()
  for (const r of existingRows ?? []) {
    existingByEmployee.set(r.employee_id, {
      planned: r.planned || '',
      shift: r.shift || '8:00-18:00',
      extra: (r.extra as Record<string, string>) || {},
      completed: r.completed || '',
      notes: r.notes || '',
      report_sent_at: r.report_sent_at ?? null,
    })
  }

  if (rows.length > 0) {
    const payload = rows.map(row => {
      const existing = existingByEmployee.get(row.employee_id)
      const frozen = isPast && (planDigestSent || !!existing?.report_sent_at)
      return {
        plan_id: plan.id,
        employee_id: row.employee_id,
        department_id: row.department_id,
        shift: frozen || !allowEditTasks
          ? (existing?.shift || row.shift || '8:00-18:00')
          : (row.shift || '8:00-18:00'),
        planned: frozen || !allowEditTasks
          ? (existing?.planned ?? row.planned ?? '')
          : (row.planned ?? ''),
        completed: frozen ? (existing?.completed ?? '') : (row.completed ?? ''),
        notes: frozen ? (existing?.notes ?? '') : (row.notes ?? ''),
        notify_email: row.notify_email,
        notify_push: row.notify_push,
        extra: frozen
          ? (existing?.extra ?? {})
          : allowEditTasks
            ? (row.extra ?? {})
            : (existing?.extra ?? row.extra ?? {}),
        ...(existing?.report_sent_at ? { report_sent_at: existing.report_sent_at } : {}),
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
    .select('*, day_plans(team_id, plan_date, digest_sent_at)')
    .eq('id', rowId)
    .single()

  if (!row) return { error: 'Рядок не знайдено' }
  const dayPlanRaw = row.day_plans as
    | { team_id?: string; plan_date?: string; digest_sent_at?: string | null }
    | { team_id?: string; plan_date?: string; digest_sent_at?: string | null }[]
    | null
  const dayPlan = Array.isArray(dayPlanRaw) ? dayPlanRaw[0] : dayPlanRaw
  const teamId = dayPlan?.team_id as string
  const planDate = dayPlan?.plan_date as string | undefined
  const isAdmin =
    profile.role === 'super_admin' ||
    (await canManageTeam(supabase, profile, teamId))

  // Past day + digest or row report already sent → frozen
  if (
    planDate &&
    planDate < todayISO() &&
    (!!row.report_sent_at || !!dayPlan?.digest_sent_at)
  ) {
    return { error: 'Звіт за минулий день уже відправлено — редагування заборонено' }
  }

  if (!isAdmin) {
    if (row.employee_id !== user.id) return { error: 'Немає доступу' }
    const allowed: Record<string, unknown> = {}
    if (fields.completed !== undefined) allowed.completed = fields.completed
    if (fields.notes !== undefined) allowed.notes = fields.notes
    if (fields.extra !== undefined) allowed.extra = fields.extra
    if (Object.keys(allowed).length === 0) return { success: true }
    const { error } = await supabase.from('task_rows').update(allowed).eq('id', rowId)
    if (error) return { error: error.message }
  } else {
    const allowEditTasks = planDate
      ? await allowEditingPlanTasks(supabase, profile, teamId, planDate)
      : await canEditTeamTasks(supabase, profile, teamId)
    const patch: Record<string, unknown> = { ...fields }
    if (!allowEditTasks) {
      delete patch.planned
      delete patch.shift
      delete patch.extra
    }
    if (Object.keys(patch).length === 0) return { success: true }
    const { error } = await supabase.from('task_rows').update(patch).eq('id', rowId)
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

  const templates = await loadColumnTemplates(supabase, teamId)
  const seeded = templatesForNewRow(templates)

  const payload = (members ?? [])
    .filter(m => !hidden.has(m.user_id))
    .map(m => ({
      plan_id: ensured.plan!.id,
      employee_id: m.user_id,
      department_id: m.department_id,
      shift: defaultShift,
      planned: seeded.planned,
      completed: seeded.completed,
      notes: seeded.notes,
      extra: seeded.extra,
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
  if (date < todayISO() && !isBoss(profile.role)) {
    return { error: 'У минулі дні працівників може додавати лише шеф' }
  }

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

  const templates = await loadColumnTemplates(supabase, teamId)
  const seeded = templatesForNewRow(templates)

  const payload = (members ?? [])
    .filter(m => !hidden.has(m.user_id))
    .map(m => ({
      plan_id: ensured.plan!.id,
      employee_id: m.user_id,
      department_id: m.department_id,
      shift: defaultShift,
      planned: seeded.planned,
      completed: seeded.completed,
      notes: seeded.notes,
      extra: seeded.extra,
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

  const templates = await loadColumnTemplates(supabase, teamId)
  const seeded = templatesForNewRow(templates)

  const payload = prevRows.map(r => ({
    plan_id: ensured.plan!.id,
    employee_id: r.employee_id,
    department_id: r.department_id,
    shift: r.shift || '8:00-18:00',
    planned: r.planned || seeded.planned,
    completed: seeded.completed,
    notes: seeded.notes,
    extra: {
      ...seeded.extra,
      ...((r.extra as Record<string, string>) || {}),
    },
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
    .select('id, plan_date, digest_sent_at, plan_tasks_locked')
    .eq('team_id', teamId)
    .eq('plan_date', date)
    .maybeSingle()

  if (!plan) return { error: 'План не знайдено' }

  if (plan.plan_tasks_locked === true) {
    return { error: 'План заблоковано — спочатку розблокуйте день' }
  }

  const isPast = plan.plan_date < todayISO()
  if (isPast && plan.digest_sent_at) {
    return { error: 'Минулий день із надісланим звітом — видалення недоступне' }
  }

  const { data: existing } = await supabase
    .from('task_rows')
    .select('report_sent_at')
    .eq('plan_id', plan.id)
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (isPast && existing?.report_sent_at) {
    return { error: 'Минулий день із надісланим звітом — видалення недоступне' }
  }

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

/** Lock planned/shift/extra for a specific plan day (default unlocked). */
export async function setDayPlanTasksLocked(teamId: string, date: string, locked: boolean) {
  const ctx = await requireAdmin()
  const { supabase, profile } = ctx
  if (!(await canManageTeam(supabase, profile, teamId))) {
    return { error: 'Немає доступу' }
  }
  if (!(await canEditTeamTasks(supabase, profile, teamId))) {
    return { error: 'Редагування завдань вимкнено в налаштуваннях' }
  }

  const planRes = await ensureDayPlan(teamId, date, ctx)
  if (planRes.error || !planRes.plan) return { error: planRes.error ?? 'Немає плану' }

  const { error } = await supabase
    .from('day_plans')
    .update({ plan_tasks_locked: locked })
    .eq('id', planRes.plan.id)

  if (error) return { error: error.message }
  revalidatePath(`/teams/${teamId}/plans/${date}`)
  revalidatePath('/admin')
  return { success: true, planId: planRes.plan.id }
}

/** @deprecated use setDayPlanTasksLocked */
export async function setTeamPlanTasksLocked(teamId: string, locked: boolean) {
  return setDayPlanTasksLocked(teamId, todayISO(), locked)
}
