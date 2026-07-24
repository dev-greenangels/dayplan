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

/** Backfill invite_blocked for people who already signed in but flag is still false. */
async function syncInviteBlocked(people: Profile[]): Promise<Profile[]> {
  const needBlock = people.filter(p => p.last_sign_in_at && !p.invite_blocked)
  if (needBlock.length === 0) {
    return people.map(p => ({
      ...p,
      invite_blocked: !!(p.invite_blocked || p.last_sign_in_at),
    }))
  }
  try {
    const admin = createAdminClient()
    const ids = needBlock.map(p => p.id)
    await admin.from('profiles').update({ invite_blocked: true }).in('id', ids)
  } catch (e) {
    console.warn('[people] invite_blocked backfill skipped', e)
  }
  return people.map(p => ({
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

  let filteredPeople: Profile[]

  if (isBoss(profile.role)) {
    try {
      filteredPeople = await loadProfiles(createAdminClient())
    } catch (e) {
      console.error('[people] admin client failed, falling back to session client', e)
      filteredPeople = await loadProfiles(supabase)
    }
  } else {
    const [pending, scoped] = await Promise.all([
      loadProfiles(supabase, { role: 'pending' }),
      memberIds.size > 0 ? loadProfiles(supabase, { ids: [...memberIds] }) : Promise.resolve([] as Profile[]),
    ])
    const byId = new Map<string, Profile>()
    for (const p of [...pending, ...scoped]) byId.set(p.id, p)
    filteredPeople = [...byId.values()]
  }

  filteredPeople = await syncInviteBlocked(filteredPeople)

  const loggedInIds = filteredPeople.filter(p => p.last_sign_in_at).map(p => p.id)

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
