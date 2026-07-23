import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Profile } from '@/lib/types'
import type { User } from '@supabase/supabase-js'
import { isBoss, isDeputyOrBoss } from '@/lib/roles'

export type SessionContext = {
  supabase: Awaited<ReturnType<typeof createClient>>
  user: User
  profile: Profile
}

export { isBoss, isDeputyOrBoss } from '@/lib/roles'

/** Core columns that always exist — never block auth on optional migration cols. */
const PROFILE_CORE = 'id, full_name, email, role, department, created_at'

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

  let { data: profile, error } = await supabase
    .from('profiles')
    .select(PROFILE_CORE)
    .eq('id', user.id)
    .maybeSingle<Profile>()

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
      .select(PROFILE_CORE)
      .eq('id', user.id)
      .maybeSingle<Profile>()
    profile = refetch.data
  }

  if (!profile) return null

  // Optional last_sign_in_at — ignore failures (column may lag schema cache)
  if (user.last_sign_in_at) {
    void supabase
      .from('profiles')
      .update({ last_sign_in_at: user.last_sign_in_at })
      .eq('id', user.id)
    profile = { ...profile, last_sign_in_at: user.last_sign_in_at }
  }

  return { supabase, user, profile }
})

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
): Promise<{ canManage: boolean; canEditTasks: boolean }> {
  if (isBoss(profile.role)) {
    return { canManage: true, canEditTasks: true }
  }
  if (profile.role !== 'sub_admin') {
    return { canManage: false, canEditTasks: false }
  }
  const { data } = await supabase
    .from('team_admins')
    .select('can_edit_tasks')
    .eq('team_id', teamId)
    .eq('user_id', profile.id)
    .maybeSingle()
  if (!data) return { canManage: false, canEditTasks: false }
  return { canManage: true, canEditTasks: data.can_edit_tasks !== false }
}
