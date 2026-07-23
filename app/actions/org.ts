'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, requireSuperAdmin, canManageTeam } from '@/lib/auth'
import type { WorkMode } from '@/lib/types'

export async function listTeams() {
  const { supabase, profile } = await requireAdmin()
  let query = supabase.from('teams').select('*').order('name')

  if (profile.role !== 'super_admin') {
    const { data: adminRows } = await supabase
      .from('team_admins')
      .select('team_id')
      .eq('user_id', profile.id)
    const ids = (adminRows ?? []).map(r => r.team_id)
    if (ids.length === 0) return { teams: [] }
    query = query.in('id', ids)
  }

  const { data, error } = await query
  if (error) return { error: error.message, teams: [] }
  return { teams: data ?? [] }
}

export async function createTeam(name: string, workMode: WorkMode = 'shared') {
  const { supabase } = await requireSuperAdmin()
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Вкажіть назву команди' }

  const { data: team, error } = await supabase
    .from('teams')
    .insert({ name: trimmed, work_mode: workMode })
    .select()
    .single()

  if (error) return { error: error.message }

  await supabase.from('departments').insert({
    team_id: team.id,
    name: 'Загальний',
    sort_order: 0,
  })

  await supabase.from('team_columns').insert([
    { team_id: team.id, key: 'shift', label: 'Робоча зміна', sort_order: 10, is_system: true },
    { team_id: team.id, key: 'planned', label: 'Заплановано', sort_order: 20, is_system: true },
    { team_id: team.id, key: 'completed', label: 'Виконано', sort_order: 30, is_system: true },
    { team_id: team.id, key: 'notes', label: 'Обробки', sort_order: 40, is_system: true },
  ])

  revalidatePath('/admin')
  return { team }
}

export async function updateTeam(
  teamId: string,
  patch: {
    name?: string
    work_mode?: WorkMode
    default_shift?: string
    show_send_worker_emails?: boolean
    show_send_leadership?: boolean
  }
) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, teamId))) {
    return { error: 'Немає доступу' }
  }
  const updates: Record<string, unknown> = {}
  if (typeof patch.name === 'string') updates.name = patch.name.trim()
  if (patch.work_mode) updates.work_mode = patch.work_mode
  if (typeof patch.default_shift === 'string') {
    const s = patch.default_shift.trim()
    if (!s) return { error: 'Вкажіть робочу зміну' }
    updates.default_shift = s
  }
  if (typeof patch.show_send_worker_emails === 'boolean') {
    updates.show_send_worker_emails = patch.show_send_worker_emails
  }
  if (typeof patch.show_send_leadership === 'boolean') {
    updates.show_send_leadership = patch.show_send_leadership
  }
  if (Object.keys(updates).length === 0) return { error: 'Немає змін' }

  const { error } = await supabase.from('teams').update(updates).eq('id', teamId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath(`/teams/${teamId}`)
  return { success: true }
}

export async function deleteTeam(teamId: string) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, teamId))) {
    return { error: 'Немає доступу до цієї команди' }
  }
  const { error } = await supabase.from('teams').delete().eq('id', teamId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/admin/people')
  return { success: true }
}

export async function listDepartments(teamId: string) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, teamId)) && profile.role !== 'super_admin') {
    // members can also read via RLS; allow for plan screen
  }
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('team_id', teamId)
    .is('archived_at', null)
    .order('sort_order')
  if (error) return { error: error.message, departments: [] }
  return { departments: data ?? [] }
}

export async function createDepartment(teamId: string, name: string) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, teamId))) return { error: 'Немає доступу' }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Вкажіть назву відділу' }

  const { data: max } = await supabase
    .from('departments')
    .select('sort_order')
    .eq('team_id', teamId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('departments')
    .insert({
      team_id: teamId,
      name: trimmed,
      sort_order: (max?.sort_order ?? 0) + 10,
    })
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { department: data }
}

export async function archiveDepartment(departmentId: string) {
  const { supabase, profile } = await requireAdmin()
  const { data: dept } = await supabase
    .from('departments')
    .select('team_id')
    .eq('id', departmentId)
    .single()
  if (!dept || !(await canManageTeam(supabase, profile, dept.team_id))) {
    return { error: 'Немає доступу' }
  }
  const { error } = await supabase
    .from('departments')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', departmentId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/admin/people')
  return { success: true }
}

/** Restore archived department so it appears again for new plans. */
export async function restoreDepartment(departmentId: string) {
  const { supabase, profile } = await requireAdmin()
  const { data: dept } = await supabase
    .from('departments')
    .select('team_id')
    .eq('id', departmentId)
    .single()
  if (!dept || !(await canManageTeam(supabase, profile, dept.team_id))) {
    return { error: 'Немає доступу' }
  }
  const { error } = await supabase
    .from('departments')
    .update({ archived_at: null })
    .eq('id', departmentId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/admin/people')
  return { success: true }
}

export async function listTeamColumns(teamId: string) {
  const { supabase } = await requireAdmin()
  const { data, error } = await supabase
    .from('team_columns')
    .select('*')
    .eq('team_id', teamId)
    .order('sort_order')
  if (error) return { error: error.message, columns: [] }
  return { columns: data ?? [] }
}

export async function addTeamColumn(teamId: string, label: string) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, teamId))) return { error: 'Немає доступу' }
  const trimmed = label.trim()
  if (!trimmed) return { error: 'Вкажіть назву колонки' }

  const key = 'custom_' + trimmed
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9]+/gi, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) + '_' + Date.now().toString(36)

  const { data: max } = await supabase
    .from('team_columns')
    .select('sort_order')
    .eq('team_id', teamId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('team_columns')
    .insert({
      team_id: teamId,
      key,
      label: trimmed,
      sort_order: (max?.sort_order ?? 40) + 10,
      is_system: false,
    })
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath(`/teams/${teamId}`)
  return { column: data }
}

export async function deleteTeamColumn(columnId: string) {
  const { supabase, profile } = await requireAdmin()
  const { data: col } = await supabase
    .from('team_columns')
    .select('team_id, is_system')
    .eq('id', columnId)
    .single()
  if (!col || col.is_system) return { error: 'Системну колонку не можна видалити' }
  if (!(await canManageTeam(supabase, profile, col.team_id))) return { error: 'Немає доступу' }

  const { error } = await supabase.from('team_columns').delete().eq('id', columnId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/admin/people')
  return { success: true }
}

export async function updateTeamColumn(
  columnId: string,
  patch: { label?: string; hidden?: boolean }
) {
  const { supabase, profile } = await requireAdmin()
  const { data: col } = await supabase
    .from('team_columns')
    .select('team_id, key, is_system')
    .eq('id', columnId)
    .single()
  if (!col) return { error: 'Колонку не знайдено' }
  if (!(await canManageTeam(supabase, profile, col.team_id))) return { error: 'Немає доступу' }

  const updates: { label?: string; hidden?: boolean } = {}
  if (typeof patch.label === 'string') {
    const trimmed = patch.label.trim()
    if (!trimmed) return { error: 'Назва не може бути порожньою' }
    updates.label = trimmed
  }
  if (typeof patch.hidden === 'boolean') {
    // System columns except «Працівник» identity: allow hide notes; block shift/planned/completed
    if (col.is_system && col.key !== 'notes') {
      return { error: 'Цю системну колонку не можна приховати' }
    }
    updates.hidden = patch.hidden
  }

  const { error } = await supabase.from('team_columns').update(updates).eq('id', columnId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath(`/teams/${col.team_id}`)
  return { success: true }
}

export async function reorderTeamColumns(teamId: string, orderedIds: string[]) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, teamId))) return { error: 'Немає доступу' }
  if (orderedIds.length === 0) return { error: 'Порожній список' }

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('team_columns')
      .update({ sort_order: (i + 1) * 10 })
      .eq('id', orderedIds[i])
      .eq('team_id', teamId)
    if (error) return { error: error.message }
  }

  revalidatePath('/admin')
  revalidatePath(`/teams/${teamId}`)
  return { success: true }
}

export async function setTeamAdmins(
  teamId: string,
  admins: { user_id: string; hide_from_plan?: boolean; can_edit_tasks?: boolean }[]
) {
  const { supabase } = await requireSuperAdmin()

  await supabase.from('team_admins').delete().eq('team_id', teamId)
  if (admins.length > 0) {
    const { error } = await supabase.from('team_admins').insert(
      admins.map(a => ({
        team_id: teamId,
        user_id: a.user_id,
        hide_from_plan: !!a.hide_from_plan,
        can_edit_tasks: a.can_edit_tasks !== false,
      }))
    )
    if (error) return { error: error.message }
  }
  revalidatePath('/admin')
  revalidatePath('/admin/people')
  return { success: true }
}

export async function assignDeputyToAllTeams(userId: string) {
  const { supabase } = await requireSuperAdmin()
  const { data: teams } = await supabase.from('teams').select('id')
  if (!teams?.length) return { success: true }

  const { error } = await supabase.from('team_admins').upsert(
    teams.map(t => ({ team_id: t.id, user_id: userId })),
    { onConflict: 'team_id,user_id' }
  )
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/admin/people')
  return { success: true }
}
