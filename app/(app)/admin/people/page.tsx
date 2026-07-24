import { requireAdmin, getManagedTeamIds, isBoss } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { avatarFromMetadata } from '@/lib/avatar'
import type { Profile } from '@/lib/types'
import PeopleManager from './people-manager'

const SELECT_FULL =
  'id, full_name, email, role, department, created_at, invite_sent_at, invite_blocked, last_sign_in_at, notify_email, notify_push, avatar_url'
const SELECT_INVITE =
  'id, full_name, email, role, department, created_at, invite_sent_at, invite_blocked, notify_email, notify_push, avatar_url'
const SELECT_BASE = 'id, full_name, email, role, department, created_at'

async function loadProfiles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (t: string) => any },
  opts?: { ids?: string[]; role?: string }
): Promise<Profile[]> {
  const run = async (cols: string) => {
    let q = client.from('profiles').select(cols).order('created_at', { ascending: false })
    if (opts?.ids) q = q.in('id', opts.ids)
    if (opts?.role) q = q.eq('role', opts.role)
    return q
  }

  for (const cols of [SELECT_FULL, SELECT_INVITE, SELECT_BASE]) {
    const { data, error } = await run(cols)
    if (!error) return (data ?? []) as Profile[]
    console.warn('[people] select failed, trying narrower columns:', error.message)
  }
  return []
}

/**
 * Pull last_sign_in_at + avatar from Auth (Google picture lives in user_metadata).
 */
async function syncSignInFlags(people: Profile[]): Promise<Profile[]> {
  let next = people.map(p => ({ ...p }))

  try {
    const admin = createAdminClient()
    const authSignIn = new Map<string, string>()
    const authAvatar = new Map<string, string>()

    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) {
        console.warn('[people] listUsers failed', error.message)
        break
      }
      for (const u of data.users) {
        if (u.last_sign_in_at) authSignIn.set(u.id, u.last_sign_in_at)
        const pic = avatarFromMetadata(u.user_metadata as Record<string, unknown>)
        if (pic) authAvatar.set(u.id, pic)
      }
      if (data.users.length < 200) break
    }

    const toPersist: { id: string; last_sign_in_at?: string; avatar_url?: string; invite_blocked?: boolean }[] = []
    next = next.map(p => {
      const at = authSignIn.get(p.id) || p.last_sign_in_at || null
      const av = authAvatar.get(p.id) || p.avatar_url || null
      const patch: { id: string; last_sign_in_at?: string; avatar_url?: string; invite_blocked?: boolean } = { id: p.id }
      let changed = false
      if (at && at !== p.last_sign_in_at) {
        patch.last_sign_in_at = at
        patch.invite_blocked = true
        changed = true
      }
      if (av && av !== p.avatar_url) {
        patch.avatar_url = av
        changed = true
      }
      if (changed) toPersist.push(patch)
      return {
        ...p,
        last_sign_in_at: at || p.last_sign_in_at,
        invite_blocked: !!(p.invite_blocked || at),
        avatar_url: av,
      }
    })

    if (toPersist.length > 0) {
      await Promise.all(
        toPersist.map(u => {
          const payload: Record<string, unknown> = {}
          if (u.last_sign_in_at) {
            payload.last_sign_in_at = u.last_sign_in_at
            payload.invite_blocked = true
          }
          if (u.avatar_url) payload.avatar_url = u.avatar_url
          return admin.from('profiles').update(payload).eq('id', u.id)
        })
      )
    }
  } catch (e) {
    console.warn('[people] sign-in sync skipped', e)
  }

  return next.map(p => ({
    ...p,
    invite_blocked: !!(p.invite_blocked || p.last_sign_in_at),
  }))
}

export default async function PeoplePage() {
  const { supabase, profile } = await requireAdmin()
  const managed = await getManagedTeamIds(supabase, profile)

  let teamsQuery = supabase
    .from('teams')
    .select('id, name, work_mode, created_at, default_shift, show_send_worker_emails, show_send_leadership')
    .order('name')
  if (managed !== 'all') {
    teamsQuery =
      managed.length > 0
        ? teamsQuery.in('id', managed)
        : teamsQuery.eq('id', '00000000-0000-0000-0000-000000000000')
  }

  const { data: teams } = await teamsQuery
  const teamIds = (teams ?? []).map(t => t.id)

  const [departmentsRes, membersRes, adminshipsRes] = await Promise.all([
    teamIds.length
      ? supabase
          .from('departments')
          .select('id, team_id, name, sort_order, archived_at, created_at')
          .in('team_id', teamIds)
          .is('archived_at', null)
          .order('sort_order')
      : Promise.resolve({ data: [] as never[] }),
    teamIds.length
      ? supabase.from('team_members').select('user_id, team_id, department_id').in('team_id', teamIds)
      : Promise.resolve({ data: [] as { user_id: string; team_id: string; department_id: string | null }[] }),
    teamIds.length
      ? supabase.from('team_admins').select('user_id, team_id').in('team_id', teamIds)
      : Promise.resolve({ data: [] as { user_id: string; team_id: string }[] }),
  ])

  const members = membersRes.data ?? []
  const memberIds = new Set(members.map(m => m.user_id))
  memberIds.add(profile.id)
  // Deputies also appear in team_admins — include them in the list
  for (const a of adminshipsRes.data ?? []) memberIds.add(a.user_id)

  let filteredPeople: Profile[]

  // Always load profiles via service role so boss AND deputy see the same invite/sign-in fields
  try {
    const admin = createAdminClient()
    if (isBoss(profile.role)) {
      filteredPeople = await loadProfiles(admin)
    } else {
      const all = await loadProfiles(admin)
      filteredPeople = all.filter(p => p.role === 'pending' || memberIds.has(p.id))
    }
  } catch (e) {
    console.error('[people] admin client failed, falling back to session client', e)
    if (isBoss(profile.role)) {
      filteredPeople = await loadProfiles(supabase)
    } else {
      const [pending, scoped] = await Promise.all([
        loadProfiles(supabase, { role: 'pending' }),
        memberIds.size > 0 ? loadProfiles(supabase, { ids: [...memberIds] }) : Promise.resolve([] as Profile[]),
      ])
      const byId = new Map<string, Profile>()
      for (const p of [...pending, ...scoped]) byId.set(p.id, p)
      filteredPeople = [...byId.values()]
    }
  }

  filteredPeople = await syncSignInFlags(filteredPeople)

  const loggedInIds = filteredPeople
    .filter(p => p.last_sign_in_at || p.invite_blocked)
    .map(p => p.id)

  const personIds = filteredPeople.map(p => p.id)
  let pushActiveIds: string[] = []
  if (personIds.length > 0) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .in('user_id', personIds)
    pushActiveIds = [...new Set((subs ?? []).map(s => s.user_id))]
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PeopleManager
        people={filteredPeople}
        teams={teams ?? []}
        departments={departmentsRes.data ?? []}
        memberships={members}
        adminships={adminshipsRes.data ?? []}
        loggedInIds={loggedInIds}
        pushActiveIds={pushActiveIds}
        isSuperAdmin={isBoss(profile.role)}
        currentUserId={profile.id}
      />
    </div>
  )
}
