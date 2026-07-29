import { requireAdmin, getManagedTeamIds, isBoss } from '@/lib/auth'
import { todayISO } from '@/lib/format-date'
import AdminTeamList from './admin-team-list'

export default async function AdminHomePage() {
  const { supabase, profile } = await requireAdmin()
  const managed = await getManagedTeamIds(supabase, profile)

  let teamsQuery = supabase.from('teams').select('*').order('name')
  if (managed !== 'all') {
    teamsQuery =
      managed.length > 0
        ? teamsQuery.in('id', managed)
        : teamsQuery.eq('id', '00000000-0000-0000-0000-000000000000')
  }

  const { data: teams } = await teamsQuery
  const today = todayISO()
  const teamIds = (teams ?? []).map(t => t.id)

  // departments/columns still needed by team settings panel props — scoped to managed teams
  const [membersRes, departmentsRes, columnsRes, teamAdminsRes, deputiesRes] = await Promise.all([
    teamIds.length
      ? supabase.from('team_members').select('team_id').in('team_id', teamIds)
      : Promise.resolve({ data: [] as { team_id: string }[] }),
    teamIds.length
      ? supabase.from('departments').select('*').in('team_id', teamIds).order('sort_order')
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? supabase.from('team_columns').select('*').in('team_id', teamIds).order('sort_order')
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? supabase
          .from('team_admins')
          .select('team_id, user_id, hide_from_plan, can_edit_tasks, can_add_photos, can_access_people, notify_email, notify_push')
          .in('team_id', teamIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .in('role', ['sub_admin', 'super_admin'])
      .order('full_name'),
  ])

  const countByTeam = new Map<string, number>()
  for (const m of membersRes.data ?? []) {
    countByTeam.set(m.team_id, (countByTeam.get(m.team_id) ?? 0) + 1)
  }

  const memberDeptsRes = teamIds.length
    ? await supabase
        .from('team_members')
        .select('team_id, user_id, department_id')
        .in('team_id', teamIds)
    : { data: [] as { team_id: string; user_id: string; department_id: string | null }[] }

  const teamsWithCount = (teams ?? []).map(t => ({
    ...t,
    memberCount: countByTeam.get(t.id) ?? 0,
  }))

  return (
    <div className="mx-auto max-w-4xl">
      <AdminTeamList
        teams={teamsWithCount}
        today={today}
        departments={departmentsRes.data ?? []}
        columns={columnsRes.data ?? []}
        teamAdmins={teamAdminsRes.data ?? []}
        memberDepartments={memberDeptsRes.data ?? []}
        deputies={(deputiesRes.data ?? []) as never[]}
        isSuperAdmin={isBoss(profile.role)}
      />
    </div>
  )
}
