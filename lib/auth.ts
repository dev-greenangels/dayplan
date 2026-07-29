import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Profile } from '@/lib/types'
import type { User } from '@supabase/supabase-js'
import { isBoss, isDeputyOrBoss } from '@/lib/roles'

import { avatarFromMetadata } from '@/lib/avatar'

function sameInstant(a: string | null | undefined, b: string | null | undefined) {
  if (!a && !b) return true
  if (!a || !b) return false
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b
  return ta === tb
}

export type SessionContext = {
  supabase: Awaited<ReturnType<typeof createClient>>
  user: User
  profile: Profile
}

export { isBoss, isDeputyOrBoss } from '@/lib/roles'

/** Core columns that always exist — never block auth on optional migration cols. */
const PROFILE_CORE = 'id, full_name, email, role, department, created_at'
const PROFILE_WITH_SIGNIN = `${PROFILE_CORE}, avatar_url, last_sign_in_at, invite_blocked`
const PROFILE_WITH_NOTIFY = `${PROFILE_WITH_SIGNIN}, notify_email, notify_push, notify_worker_send_push`

/**
 * Request-scoped session + profile. Dedupes getUser + profiles within one RSC tree.
 * Never invents a fake profile role — that caused redirect loops with middleware.
 */
export const getSessionProfile = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  let profile: Profile | null = null
  let error: { message: string } | null = null
  /** False when fallback select omitted sign-in columns — do not stamp (avoids refresh loops). */
  let canCompareSignIn = false

  {
    const res = await supabase
      .from('profiles')
      .select(PROFILE_WITH_NOTIFY)
      .eq('id', user.id)
      .maybeSingle<Profile>()
    if (!res.error) {
      profile = res.data
      canCompareSignIn = true
    } else {
      const mid = await supabase
        .from('profiles')
        .select(PROFILE_WITH_SIGNIN)
        .eq('id', user.id)
        .maybeSingle<Profile>()
      if (!mid.error) {
        profile = mid.data
        canCompareSignIn = true
        error = null
      } else {
        const fallback = await supabase
          .from('profiles')
          .select(PROFILE_CORE)
          .eq('id', user.id)
          .maybeSingle<Profile>()
        profile = fallback.data
        error = fallback.error
      }
    }
  }

  // Row missing → create pending (first login). Do not invent on other errors.
  if (!profile && !error) {
    await supabase.from('profiles').insert({
      id: user.id,
      full_name: user.user_metadata?.full_name ?? '',
      email: user.email ?? '',
      role: 'pending',
      department: user.user_metadata?.department ?? '',
    })
    const refetch = await supabase
      .from('profiles')
      .select(PROFILE_WITH_NOTIFY)
      .eq('id', user.id)
      .maybeSingle<Profile>()
    if (!refetch.error) {
      profile = refetch.data
      canCompareSignIn = true
    } else {
      const mid = await supabase
        .from('profiles')
        .select(PROFILE_WITH_SIGNIN)
        .eq('id', user.id)
        .maybeSingle<Profile>()
      if (!mid.error) {
        profile = mid.data
        canCompareSignIn = true
      } else {
        const fallback = await supabase
          .from('profiles')
          .select(PROFILE_CORE)
          .eq('id', user.id)
          .maybeSingle<Profile>()
        profile = fallback.data
      }
    }
  }

  if (!profile) return null

  profile = {
    ...profile,
    notify_email: profile.notify_email !== false,
    notify_push: profile.notify_push !== false,
    notify_worker_send_push: profile.notify_worker_send_push !== false,
  }

  const metaAvatar = avatarFromMetadata(user.user_metadata as Record<string, unknown>)
  if (canCompareSignIn && metaAvatar && metaAvatar !== profile.avatar_url) {
    profile = { ...profile, avatar_url: metaAvatar }
    void stampProfileAvatar(user.id, metaAvatar)
  }

  // Stamp sign-in only when DB value differs (unconditional UPDATE retriggers
  // Realtime on every RSC render → infinite refresh on /admin/people).
  if (
    canCompareSignIn &&
    user.last_sign_in_at &&
    (!sameInstant(user.last_sign_in_at, profile.last_sign_in_at) ||
      profile.invite_blocked === false)
  ) {
    profile = {
      ...profile,
      last_sign_in_at: user.last_sign_in_at,
      invite_blocked: true,
    }
    void stampProfileSignIn(user.id, user.last_sign_in_at)
  } else if (user.last_sign_in_at) {
    profile = {
      ...profile,
      last_sign_in_at: user.last_sign_in_at,
      invite_blocked: true,
    }
  }

  return { supabase, user, profile }
})

/** In-process guards so RSC remounts never re-stamp the same values (Realtime-safe). */
const stampedSignInAt = new Map<string, string>()
const stampedAvatarUrl = new Map<string, string>()

async function stampProfileAvatar(userId: string, avatarUrl: string) {
  if (stampedAvatarUrl.get(userId) === avatarUrl) return
  stampedAvatarUrl.set(userId, avatarUrl)
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    await admin.from('profiles').update({ avatar_url: avatarUrl }).eq('id', userId)
  } catch (e) {
    console.warn('[auth] stampProfileAvatar failed', e)
  }
}

/** Persist last_sign_in_at + invite_blocked; prefer admin client so RLS never blocks. */
async function stampProfileSignIn(userId: string, lastSignInAt: string) {
  if (stampedSignInAt.get(userId) === lastSignInAt) return
  stampedSignInAt.set(userId, lastSignInAt)
  const payload = { last_sign_in_at: lastSignInAt, invite_blocked: true }
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    const { error } = await admin.from('profiles').update(payload).eq('id', userId)
    if (!error) return
    console.warn('[auth] stampProfileSignIn admin failed', error.message)
  } catch (e) {
    console.warn('[auth] stampProfileSignIn admin unavailable', e)
  }
  // Fallback: session client (works for sub_admin / super_admin only)
  try {
    const supabase = await createClient()
    await supabase.from('profiles').update(payload).eq('id', userId)
  } catch {
    /* ignore */
  }
}

export async function requireUser(): Promise<SessionContext> {
  const ctx = await getSessionProfile()
  if (!ctx) redirect('/login')
  if (ctx.profile.role === 'pending') redirect('/pending')
  return ctx
}

export async function requireAdmin(): Promise<SessionContext> {
  const ctx = await requireUser()
  if (!isDeputyOrBoss(ctx.profile.role)) {
    redirect('/dashboard')
  }
  return ctx
}

export async function requireSuperAdmin(): Promise<SessionContext> {
  const ctx = await requireUser()
  if (!isBoss(ctx.profile.role)) {
    redirect('/dashboard')
  }
  return ctx
}

/** For API routes — no redirects. */
export async function getApiSession(): Promise<SessionContext | null> {
  return getSessionProfile()
}

export function assertAdminApi(profile: Profile): { error: string; status: number } | null {
  if (!isDeputyOrBoss(profile.role)) {
    return { error: 'Forbidden', status: 403 }
  }
  return null
}

/** Teams the current admin can manage */
export async function getManagedTeamIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: Profile
): Promise<string[] | 'all'> {
  if (isBoss(profile.role)) return 'all'

  const { data } = await supabase
    .from('team_admins')
    .select('team_id')
    .eq('user_id', profile.id)

  return (data ?? []).map(r => r.team_id)
}

/** Whether deputy may open /admin/people (boss always). */
export async function canAccessPeoplePage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: Profile
): Promise<boolean> {
  if (isBoss(profile.role)) return true
  if (profile.role !== 'sub_admin') return false
  const { data } = await supabase
    .from('team_admins')
    .select('team_id')
    .eq('user_id', profile.id)
    .eq('can_access_people', true)
    .limit(1)
  return (data ?? []).length > 0
}

export async function requirePeopleAccess(): Promise<SessionContext> {
  const ctx = await requireAdmin()
  if (!(await canAccessPeoplePage(ctx.supabase, ctx.profile))) {
    redirect('/admin')
  }
  return ctx
}

export async function canManageTeam(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: Profile,
  teamId: string
): Promise<boolean> {
  if (isBoss(profile.role)) return true
  const { data } = await supabase
    .from('team_admins')
    .select('team_id')
    .eq('team_id', teamId)
    .eq('user_id', profile.id)
    .maybeSingle()
  return !!data
}

/** Whether deputy can edit planned tasks for this team (super_admin always true). */
export async function canEditTeamTasks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: Profile,
  teamId: string
): Promise<boolean> {
  if (isBoss(profile.role)) return true
  if (profile.role !== 'sub_admin') return false
  const { data } = await supabase
    .from('team_admins')
    .select('can_edit_tasks')
    .eq('team_id', teamId)
    .eq('user_id', profile.id)
    .maybeSingle()
  return data ? data.can_edit_tasks !== false : false
}

/** Single team_admins round-trip for manage + edit flags. */
export async function getTeamAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: Profile,
  teamId: string
): Promise<{ canManage: boolean; canEditTasks: boolean; canAddPhotos: boolean }> {
  if (isBoss(profile.role)) {
    const { data } = await supabase
      .from('team_admins')
      .select('can_add_photos')
      .eq('team_id', teamId)
      .eq('user_id', profile.id)
      .maybeSingle()
    return {
      canManage: true,
      canEditTasks: true,
      // Listed on leadership → respect flag; otherwise always allow
      canAddPhotos: data ? data.can_add_photos !== false : true,
    }
  }
  if (profile.role !== 'sub_admin') {
    return { canManage: false, canEditTasks: false, canAddPhotos: false }
  }
  const { data } = await supabase
    .from('team_admins')
    .select('can_edit_tasks, can_add_photos')
    .eq('team_id', teamId)
    .eq('user_id', profile.id)
    .maybeSingle()
  if (!data) return { canManage: false, canEditTasks: false, canAddPhotos: false }
  return {
    canManage: true,
    canEditTasks: data.can_edit_tasks !== false,
    canAddPhotos: data.can_add_photos !== false,
  }
}
