import { requireAdmin, getManagedTeamIds, isBoss } from '@/lib/auth'
import type { Profile } from '@/lib/types'
import PeopleManager from './people-manager'

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

  const profileSelect =
    'id, full_name, email, role, department, created_at, invite_sent_at, invite_blocked, last_sign_in_at'

  let filteredPeople: Profile[]

  if (isBoss(profile.role)) {
    const { data: people } = await supabase
      .from('profiles')
      .select(profileSelect)
      .order('created_at', { ascending: false })
    filteredPeople = (people ?? []) as Profile[]
  } else {
    const [{ data: pending }, { data: scoped }] = await Promise.all([
      supabase
        .from('profiles')
        .select(profileSelect)
        .eq('role', 'pending')
        .order('created_at', { ascending: false }),
      memberIds.size > 0
        ? supabase
            .from('profiles')
            .select(profileSelect)
            .in('id', [...memberIds])
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as Profile[] }),
    ])
    const byId = new Map<string, Profile>()
    for (const p of [...(pending ?? []), ...(scoped ?? [])] as Profile[]) {
      byId.set(p.id, p)
    }
    filteredPeople = [...byId.values()]
  }

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
