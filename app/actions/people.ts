'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, requireSuperAdmin, canManageTeam, getManagedTeamIds, isBoss } from '@/lib/auth'
import { isMailConfigured, sendAppMail } from '@/lib/mail'
import type { UserRole } from '@/lib/types'

const ASSIGNABLE_ROLES: UserRole[] = ['employee', 'sub_admin', 'super_admin']

async function sendLoginInviteEmail(email: string, fullName: string) {
  if (!isMailConfigured()) {
    return { error: 'Gmail не налаштовано' }
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  await sendAppMail({
    to: email,
    subject: 'Запрошення до PlanDay-GA',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#2d6a4f;">Вітаємо${fullName ? `, ${fullName}` : ''}!</h2>
        <p>Вас додано до PlanDay-GA (плани робочого дня Green Angels).</p>
        <p>Щоб увійти:</p>
        <ol>
          <li>Відкрийте <a href="${siteUrl}/login">${siteUrl}/login</a></li>
          <li>Введіть цей email</li>
          <li>Натисніть «Отримати код» і введіть код з листа</li>
        </ol>
        <p style="color:#888;font-size:12px;">Або увійдіть через Google тим самим email.</p>
      </div>
    `,
  })
  return { success: true as const }
}

export async function listPeople() {
  const { supabase, profile } = await requireAdmin()

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, people: [] }

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id, team_id, department_id, teams(id, name), departments(id, name)')

  const { data: admins } = await supabase
    .from('team_admins')
    .select('user_id, team_id, teams(id, name)')

  // Deputies only see pending + people in their teams
  let people = profiles ?? []
  if (profile.role === 'sub_admin') {
    const { data: myTeams } = await supabase
      .from('team_admins')
      .select('team_id')
      .eq('user_id', profile.id)
    const teamIds = new Set((myTeams ?? []).map(t => t.team_id))
    const memberUserIds = new Set(
      (members ?? []).filter(m => teamIds.has(m.team_id)).map(m => m.user_id)
    )
    people = people.filter(
      p => p.role === 'pending' || memberUserIds.has(p.id) || p.id === profile.id
    )
  }

  return {
    people,
    memberships: members ?? [],
    adminships: admins ?? [],
  }
}

export async function approveUser(opts: {
  userId: string
  role: UserRole
  teamId: string
  departmentId: string
  /** Extra teams for deputies (in addition to teamId) */
  teamIds?: string[]
}) {
  const { supabase, profile } = await requireAdmin()
  if (!ASSIGNABLE_ROLES.includes(opts.role)) return { error: 'Невірна роль' }
  if (opts.role === 'super_admin' && !isBoss(profile.role)) {
    return { error: 'Лише шеф може призначати шефів' }
  }
  const managed = await getManagedTeamIds(supabase, profile)
  const canAccess = (tid: string) => managed === 'all' || managed.includes(tid)
  if (!canAccess(opts.teamId)) {
    return { error: 'Немає доступу до цієї команди' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role: opts.role })
    .eq('id', opts.userId)

  if (error) return { error: error.message }

  if (opts.role === 'employee') {
    await supabase.from('team_members').delete().eq('user_id', opts.userId)
    await supabase.from('team_members').upsert({
      team_id: opts.teamId,
      user_id: opts.userId,
      department_id: opts.departmentId,
    })
  } else if (opts.role === 'sub_admin') {
    if (!opts.departmentId) return { error: 'Оберіть відділ' }
    const teams = [...new Set([opts.teamId, ...(opts.teamIds ?? [])].filter(Boolean))]
    for (const tid of teams) {
      if (!canAccess(tid)) continue
      await supabase.from('team_admins').upsert({
        team_id: tid,
        user_id: opts.userId,
      })
    }
    await supabase.from('team_members').delete().eq('user_id', opts.userId)
    await supabase.from('team_members').upsert({
      team_id: opts.teamId,
      user_id: opts.userId,
      department_id: opts.departmentId,
    })
  }

  revalidatePath('/admin/people')
  return { success: true }
}

export async function deletePerson(userId: string) {
  const { profile, user } = await requireSuperAdmin()
  if (userId === user.id) return { error: 'Не можна видалити себе' }

  try {
    const admin = createAdminClient()
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return { error: error.message }
    revalidatePath('/admin/people')
    return { success: true }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Помилка видалення' }
  }
}

export async function createPerson(opts: {
  email: string
  fullName: string
  role: UserRole
  teamId: string
  departmentId: string
  sendInvite?: boolean
  /** Extra teams for deputies */
  teamIds?: string[]
}) {
  const { supabase, profile } = await requireAdmin()
  const email = opts.email.trim().toLowerCase()
  const fullName = opts.fullName.trim()
  if (!fullName) return { error: 'ПІБ обовʼязкове' }
  if (!email) return { error: 'Email обовʼязковий' }
  if (!opts.teamId) return { error: 'Оберіть команду' }
  if (!opts.departmentId && (opts.role === 'employee' || opts.role === 'sub_admin')) {
    return { error: 'Оберіть відділ' }
  }
  if (!ASSIGNABLE_ROLES.includes(opts.role)) return { error: 'Невірна роль' }
  if (opts.role === 'super_admin' && profile.role !== 'super_admin') {
    return { error: 'Лише шеф може призначати шефів' }
  }
  if (!(await canManageTeam(supabase, profile, opts.teamId))) {
    return { error: 'Немає доступу до цієї команди' }
  }

  try {
    const admin = createAdminClient()

    // Already exists by email?
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, role')
      .eq('email', email)
      .maybeSingle()

    let userId = existingProfile?.id as string | undefined
    let alreadySignedIn = false

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, role: opts.role },
      })
      if (error) return { error: error.message }
      if (!data.user) return { error: 'Не вдалося створити користувача' }
      userId = data.user.id
    } else {
      const { data: authUser } = await admin.auth.admin.getUserById(userId)
      alreadySignedIn = !!authUser.user?.last_sign_in_at
    }

    await admin.from('profiles').upsert({
      id: userId,
      full_name: fullName,
      email,
      role: opts.role,
      department: '',
      ...(alreadySignedIn
        ? { invite_blocked: true, last_sign_in_at: new Date().toISOString() }
        : {}),
    }, { onConflict: 'id' })

    if (opts.role === 'employee') {
      await admin.from('team_members').delete().eq('user_id', userId)
      await admin.from('team_members').upsert({
        team_id: opts.teamId,
        user_id: userId,
        department_id: opts.departmentId,
      })
    } else if (opts.role === 'sub_admin') {
      const teams = [...new Set([opts.teamId, ...(opts.teamIds ?? [])].filter(Boolean))]
      for (const tid of teams) {
        await admin.from('team_admins').upsert({
          team_id: tid,
          user_id: userId,
        })
      }
      await admin.from('team_members').delete().eq('user_id', userId)
      await admin.from('team_members').upsert({
        team_id: opts.teamId,
        user_id: userId,
        department_id: opts.departmentId,
      })
    }

    if (opts.sendInvite) {
      if (alreadySignedIn) {
        revalidatePath('/admin/people')
        return {
          success: true,
          userId,
          warning: 'Працівника додано. Запрошення не потрібне — людина вже входила в систему.',
        }
      }
      const invite = await sendLoginInviteEmail(email, fullName)
      if (invite.error) {
        revalidatePath('/admin/people')
        return {
          success: true,
          userId,
          warning: 'Працівника додано, але запрошення не надіслано: ' + invite.error,
        }
      }
      await admin
        .from('profiles')
        .update({ invite_sent_at: new Date().toISOString() })
        .eq('id', userId)
    }

    revalidatePath('/admin/people')
    return { success: true, userId }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Помилка створення' }
  }
}

export async function invitePerson(opts: {
  email: string
  fullName: string
  role: UserRole
  teamId: string
  departmentId: string
}) {
  return createPerson({ ...opts, sendInvite: true })
}

export async function resendInvite(email: string) {
  await requireAdmin()
  try {
    const admin = createAdminClient()
    const normalized = email.trim().toLowerCase()
    const { data: prof } = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('email', normalized)
      .maybeSingle()

    if (prof?.id) {
      const { data: authUser } = await admin.auth.admin.getUserById(prof.id)
      if (authUser.user?.last_sign_in_at || authUser.user?.app_metadata?.invite_blocked) {
        await admin.auth.admin.updateUserById(prof.id, {
          app_metadata: { ...(authUser.user.app_metadata ?? {}), invite_blocked: true },
        })
        await admin
          .from('profiles')
          .update({
            invite_blocked: true,
            ...(authUser.user.last_sign_in_at
              ? { last_sign_in_at: authUser.user.last_sign_in_at }
              : {}),
          })
          .eq('id', prof.id)
        revalidatePath('/admin/people')
        return { error: 'Користувач уже має доступ — запрошення не потрібне', inviteBlocked: true }
      }
    }

    const invite = await sendLoginInviteEmail(normalized, prof?.full_name || '')
    if (invite.error) return { error: invite.error }

    if (prof?.id) {
      await admin
        .from('profiles')
        .update({ invite_sent_at: new Date().toISOString() })
        .eq('id', prof.id)
    }
    revalidatePath('/admin/people')
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Помилка'
    if (message.toLowerCase().includes('already')) {
      // Best-effort: hide invite button if we can resolve the profile
      try {
        const admin = createAdminClient()
        const normalized = email.trim().toLowerCase()
        await admin
          .from('profiles')
          .update({ invite_blocked: true })
          .eq('email', normalized)
      } catch { /* ignore */ }
      return { error: 'Обліковий запис уже існує — запрошення не потрібне', inviteBlocked: true }
    }
    return { error: message }
  }
}

export async function updatePersonName(userId: string, fullName: string) {
  const { supabase } = await requireAdmin()
  const trimmed = fullName.trim()
  if (!trimmed) return { error: 'ПІБ обовʼязкове' }
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: trimmed })
    .eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin/people')
  return { success: true }
}

export async function updatePersonNotifyPrefs(
  userId: string,
  prefs: { notify_email?: boolean; notify_push?: boolean }
) {
  const { supabase } = await requireAdmin()
  const payload: { notify_email?: boolean; notify_push?: boolean } = {}
  if (typeof prefs.notify_email === 'boolean') payload.notify_email = prefs.notify_email
  if (typeof prefs.notify_push === 'boolean') payload.notify_push = prefs.notify_push
  if (Object.keys(payload).length === 0) return { error: 'Немає змін' }

  const { error } = await supabase.from('profiles').update(payload).eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin/people')
  return { success: true }
}

export async function setDeputyTeams(userId: string, teamIds: string[]) {
  const { supabase, profile } = await requireAdmin()
  const unique = [...new Set(teamIds.filter(Boolean))]
  if (unique.length === 0) return { error: 'Оберіть хоча б одну команду' }

  const managed = await getManagedTeamIds(supabase, profile)
  const managedIds = managed === 'all'
    ? (await supabase.from('teams').select('id')).data?.map(t => t.id) ?? []
    : managed

  if (managedIds.length === 0) return { error: 'Немає доступних команд' }
  if (unique.some(tid => !managedIds.includes(tid))) {
    return { error: 'Немає доступу до однієї з команд' }
  }

  await supabase
    .from('team_admins')
    .delete()
    .eq('user_id', userId)
    .in('team_id', managedIds)

  const { error } = await supabase.from('team_admins').insert(
    unique
      .filter(tid => managedIds.includes(tid))
      .map(team_id => ({ team_id, user_id: userId, hide_from_plan: false }))
  )
  if (error) return { error: error.message }

  // Ensure role is sub_admin if assigning teams
  const { data: person } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (person && person.role === 'employee') {
    await supabase.from('profiles').update({ role: 'sub_admin' }).eq('id', userId)
  }

  revalidatePath('/admin/people')
  revalidatePath('/admin')
  return { success: true }
}

export async function movePerson(opts: {
  userId: string
  teamId: string
  departmentId: string
}) {
  const { supabase, profile } = await requireAdmin()
  if (!(await canManageTeam(supabase, profile, opts.teamId))) {
    return { error: 'Немає доступу' }
  }

  await supabase.from('team_members').delete().eq('user_id', opts.userId)
  const { error } = await supabase.from('team_members').upsert({
    team_id: opts.teamId,
    user_id: opts.userId,
    department_id: opts.departmentId,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin/people')
  return { success: true }
}

export async function setUserRole(userId: string, role: UserRole) {
  const { supabase, profile } = await requireSuperAdmin()
  if (!ASSIGNABLE_ROLES.includes(role) && role !== 'pending') {
    return { error: 'Невірна роль' }
  }
  if (userId === profile.id && role !== 'super_admin') {
    return { error: 'Не можна зняти з себе роль шефа. Зробіть це з іншого акаунта шефа.' }
  }
  if (role !== 'super_admin') {
    const { data: target } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle()
    if (target?.role === 'super_admin') {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
      if ((count ?? 0) <= 1) {
        return { error: 'Має залишитись хоча б один шеф' }
      }
    }
  }
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin/people')
  return { success: true }
}
