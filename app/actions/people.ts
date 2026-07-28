'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  requireSuperAdmin,
  requirePeopleAccess,
  canManageTeam,
  getManagedTeamIds,
  isBoss,
} from '@/lib/auth'
import { isMailConfigured, sendAppMail } from '@/lib/mail'
import type { UserRole } from '@/lib/types'

const ASSIGNABLE_ROLES: UserRole[] = ['employee', 'sub_admin', 'super_admin']

async function sendLoginInviteEmail(email: string, fullName: string) {
  if (!isMailConfigured()) {
    return { error: 'Gmail не налаштовано' }
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const loginUrl = `${siteUrl.replace(/\/$/, '')}/login`
  const greeting = fullName ? `Вітаємо, ${fullName}!` : 'Вітаємо!'
  await sendAppMail({
    to: email,
    subject: 'Запрошення до PlanDay-GA',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f0f7f0;border-radius:12px;">
        <h2 style="color:#2d6a4f;margin:0 0 12px;">${greeting}</h2>
        <p style="color:#333;font-size:15px;line-height:1.5;margin:0 0 12px;">
          Вас запрошено до додатку <strong>PlanDay-GA</strong> (Green Angels).
        </p>
        <p style="color:#333;font-size:15px;line-height:1.5;margin:0 0 12px;">
          Зайдіть за посиланням і авторизуйтесь своїм email — там будуть плани робіт і звітування.
        </p>
        <p style="margin:20px 0;">
          <a href="${loginUrl}"
             style="display:inline-block;background:#2d6a4f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">
            Відкрити додаток
          </a>
        </p>
        <p style="color:#555;font-size:13px;line-height:1.45;margin:0 0 8px;">
          Або скопіюйте посилання: <a href="${loginUrl}" style="color:#2d6a4f;">${loginUrl}</a>
        </p>
        <p style="color:#555;font-size:13px;line-height:1.45;margin:0 0 8px;">
          Увійдіть через Google цим самим email або введіть email і отримайте код у листі.
        </p>
        <p style="margin-top:20px;font-size:12px;color:#999;">PlanDay-GA · Green Angels</p>
      </div>
    `,
  })
  return { success: true as const }
}

export async function listPeople() {
  const { supabase, profile } = await requirePeopleAccess()

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
  const { supabase, profile } = await requirePeopleAccess()
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

  if (opts.role === 'employee' || opts.role === 'sub_admin') {
    if (!opts.departmentId) return { error: 'Оберіть відділ' }
    if (opts.role === 'sub_admin') {
      const teams = [...new Set([opts.teamId, ...(opts.teamIds ?? [])].filter(Boolean))]
      for (const tid of teams) {
        if (!canAccess(tid)) continue
        const { error: adminErr } = await supabase.from('team_admins').upsert({
          team_id: tid,
          user_id: opts.userId,
        })
        if (adminErr) return { error: adminErr.message }
      }
    }
    await supabase.from('team_members').delete().eq('user_id', opts.userId)
    const { error: memberErr } = await supabase.from('team_members').upsert({
      team_id: opts.teamId,
      user_id: opts.userId,
      department_id: opts.departmentId,
    })
    if (memberErr) return { error: 'Не вдалося додати в команду: ' + memberErr.message }
  }

  revalidatePath('/admin/people')
  revalidatePath('/admin')
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
  const { supabase, profile } = await requirePeopleAccess()
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

    if (existingProfile?.id) {
      return { error: 'Користувач з таким email уже існує' }
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: opts.role },
    })
    if (error) {
      const msg = error.message || ''
      if (/already|exist|registered/i.test(msg)) {
        return { error: 'Користувач з таким email уже існує' }
      }
      return { error: error.message }
    }
    if (!data.user) return { error: 'Не вдалося створити користувача' }
    const userId = data.user.id

    await admin.from('profiles').upsert({
      id: userId,
      full_name: fullName,
      email,
      role: opts.role,
      department: '',
    }, { onConflict: 'id' })

    if (opts.role === 'employee' || opts.role === 'sub_admin') {
      if (opts.role === 'sub_admin') {
        const teams = [...new Set([opts.teamId, ...(opts.teamIds ?? [])].filter(Boolean))]
        for (const tid of teams) {
          const { error: adminErr } = await admin.from('team_admins').upsert({
            team_id: tid,
            user_id: userId,
          })
          if (adminErr) return { error: adminErr.message }
        }
      }
      await admin.from('team_members').delete().eq('user_id', userId)
      const { error: memberErr } = await admin.from('team_members').upsert({
        team_id: opts.teamId,
        user_id: userId,
        department_id: opts.departmentId,
      })
      if (memberErr) return { error: 'Не вдалося додати в команду: ' + memberErr.message }
    }

    if (opts.sendInvite) {
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
  await requirePeopleAccess()
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
  const { supabase } = await requirePeopleAccess()
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

/** Change email only before the user has ever signed in (Auth + profiles). */
export async function updatePersonEmail(userId: string, email: string) {
  await requirePeopleAccess()
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { error: 'Невірний email' }
  }

  try {
    const admin = createAdminClient()
    const { data: authData, error: getErr } = await admin.auth.admin.getUserById(userId)
    if (getErr || !authData.user) return { error: getErr?.message || 'Користувача не знайдено' }
    if (authData.user.last_sign_in_at) {
      return { error: 'Email можна змінити лише до першого входу' }
    }

    const { data: clash } = await admin
      .from('profiles')
      .select('id')
      .eq('email', trimmed)
      .neq('id', userId)
      .maybeSingle()
    if (clash) return { error: 'Цей email уже зайнятий' }

    const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
      email: trimmed,
      email_confirm: true,
    })
    if (authErr) return { error: authErr.message }

    const { error } = await admin.from('profiles').update({ email: trimmed }).eq('id', userId)
    if (error) return { error: error.message }

    revalidatePath('/admin/people')
    return { success: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не вдалося змінити email'
    return { error: message }
  }
}

export async function updatePersonNotifyPrefs(
  userId: string,
  prefs: {
    notify_email?: boolean
    notify_push?: boolean
    notify_worker_send_push?: boolean
  }
) {
  const { supabase } = await requirePeopleAccess()
  const payload: {
    notify_email?: boolean
    notify_push?: boolean
    notify_worker_send_push?: boolean
  } = {}
  if (typeof prefs.notify_email === 'boolean') payload.notify_email = prefs.notify_email
  if (typeof prefs.notify_push === 'boolean') payload.notify_push = prefs.notify_push
  if (typeof prefs.notify_worker_send_push === 'boolean') {
    payload.notify_worker_send_push = prefs.notify_worker_send_push
  }
  if (Object.keys(payload).length === 0) return { error: 'Немає змін' }

  const { error } = await supabase.from('profiles').update(payload).eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin/people')
  return { success: true }
}

export async function setDeputyTeams(userId: string, teamIds: string[]) {
  const { supabase, profile } = await requirePeopleAccess()
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
  const { supabase, profile } = await requirePeopleAccess()
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

  // Plan rows keep a department snapshot — sync today+ for this team so the board matches «Люди»
  const today = new Date().toISOString().slice(0, 10)
  const { data: plans } = await supabase
    .from('day_plans')
    .select('id, plan_date')
    .eq('team_id', opts.teamId)
    .gte('plan_date', today)

  if (plans && plans.length > 0) {
    const planIds = plans.map(p => p.id)
    await supabase
      .from('task_rows')
      .update({ department_id: opts.departmentId })
      .eq('employee_id', opts.userId)
      .in('plan_id', planIds)

    for (const p of plans) {
      revalidatePath(`/teams/${opts.teamId}/plans/${p.plan_date}`)
    }
  }

  revalidatePath('/admin/people')
  revalidatePath('/admin')
  return { success: true }
}

export async function setUserRole(
  userId: string,
  role: UserRole,
  opts?: { teamId?: string; departmentId?: string; teamIds?: string[] }
) {
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

  // employee / deputy must belong to a team — never leave orphan profiles
  if (role === 'employee' || role === 'sub_admin') {
    const { data: existing } = await supabase
      .from('team_members')
      .select('team_id, department_id')
      .eq('user_id', userId)
      .maybeSingle()

    const teamId = opts?.teamId || existing?.team_id
    const departmentId = opts?.departmentId || existing?.department_id
    if (!teamId || !departmentId) {
      return { error: 'Спочатку оберіть команду і відділ, потім змініть роль' }
    }
    if (!(await canManageTeam(supabase, profile, teamId))) {
      return { error: 'Немає доступу до цієї команди' }
    }

    if (role === 'sub_admin') {
      const teams = [...new Set([teamId, ...(opts?.teamIds ?? [])].filter(Boolean))]
      for (const tid of teams) {
        if (!(await canManageTeam(supabase, profile, tid))) continue
        const { error: adminErr } = await supabase.from('team_admins').upsert({
          team_id: tid,
          user_id: userId,
        })
        if (adminErr) return { error: adminErr.message }
      }
    } else {
      // Downgrade from deputy → drop adminships
      await supabase.from('team_admins').delete().eq('user_id', userId)
    }

    await supabase.from('team_members').delete().eq('user_id', userId)
    const { error: memberErr } = await supabase.from('team_members').upsert({
      team_id: teamId,
      user_id: userId,
      department_id: departmentId,
    })
    if (memberErr) return { error: 'Не вдалося додати в команду: ' + memberErr.message }
  }

  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin/people')
  revalidatePath('/admin')
  return { success: true }
}
