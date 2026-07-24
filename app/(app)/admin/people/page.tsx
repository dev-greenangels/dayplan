import { requireAdmin, getManagedTeamIds, isBoss } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Profile } from '@/lib/types'
import PeopleManager from './people-manager'

const SELECT_FULL =
  'id, full_name, email, role, department, created_at, invite_sent_at, invite_blocked, last_sign_in_at'
const SELECT_INVITE =
  'id, full_name, email, role, department, created_at, invite_sent_at, invite_blocked'
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
 * Pull real last_sign_in_at from Auth for everyone on the page (boss + deputy + employee).
 * Profiles cache can lag; Auth is source of truth.
 */
async function syncSignInFlags(people: Profile[]): Promise<Profile[]> {
  let next = people.map(p => ({ ...p }))

  try {
    const admin = createAdminClient()
    const authSignIn = new Map<string, string>()

    // Paginate Auth users (covers boss/deputy who often use Google)
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) {
        console.warn('[people] listUsers failed', error.message)
        break
      }
      for (const u of data.users) {
        if (u.last_sign_in_at) authSignIn.set(u.id, u.last_sign_in_at)
      }
      if (data.users.length < 200) break
    }

    const toPersist: { id: string; last_sign_in_at: string }[] = []
    next = next.map(p => {
      const at = authSignIn.get(p.id) || p.last_sign_in_at || null
      if (at && at !== p.last_sign_in_at) {
        toPersist.push({ id: p.id, last_sign_in_at: at })
      }
      if (!at) return p
      return { ...p, last_sign_in_at: at, invite_blocked: true }
    })

    if (toPersist.length > 0) {
      await Promise.all(
        toPersist.map(u =>
          admin
            .from('profiles')
            .update({ last_sign_in_at: u.last_sign_in_at, invite_blocked: true })
            .eq('id', u.id)
        )
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

  return (
    <div className="mx-auto max-w-4xl">
      <PeopleManager
        people={filteredPeople}
        teams={teams ?? []}
        departments={departmentsRes.data ?? []}
        memberships={members}
        adminships={adminshipsRes.data ?? []}
        loggedInIds={loggedInIds}
        isSuperAdmin={isBoss(profile.role)}
        currentUserId={profile.id}
      />
    </div>
  )
}
