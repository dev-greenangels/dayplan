import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { requireUser, getTeamAccess } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import TeamPlanBoard from './team-plan-board'
import type { Department, Profile, TaskRow, Team, TeamColumn } from '@/lib/types'

interface Props {
  params: Promise<{ teamId: string; date: string }>
}

function asProfile(raw: unknown): Profile | null {
  if (!raw) return null
  const p = (Array.isArray(raw) ? raw[0] : raw) as Profile | null
  return p ?? null
}

const PROFILE_JOIN =
  'id, full_name, email, role, department, created_at, last_sign_in_at, avatar_url'

export default async function TeamPlanPage({ params }: Props) {
  const { teamId, date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const { supabase, profile, user } = await requireUser()

  const { data: team } = await supabase
    .from('teams')
    .select(
      'id, name, work_mode, created_at, default_shift, show_send_worker_emails, show_send_leadership, plan_tasks_locked'
    )
    .eq('id', teamId)
    .single<Team>()
  if (!team) notFound()

  const access = await getTeamAccess(supabase, profile, teamId)
  const isAdmin = access.canManage
  const canEditTasks = access.canEditTasks

  if (!isAdmin) {
    const { data: member } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!member) redirect('/dashboard')
    if (team.work_mode === 'individual') redirect('/dashboard')
  }

  const leadersPromise = isAdmin
    ? Promise.all([
        supabase.from('profiles').select('id, full_name, email, role, avatar_url').eq('role', 'super_admin'),
        supabase
          .from('team_admins')
          .select('user_id, profile:profiles(id, full_name, email, role, avatar_url)')
          .eq('team_id', teamId),
      ])
    : Promise.resolve([
        { data: null as { id: string; full_name: string; email: string; role: string; avatar_url?: string | null }[] | null },
        { data: null as { user_id: string; profile: unknown }[] | null },
      ] as const)

  const [
    planRes,
    existingPlansRes,
    departmentsRes,
    columnsRes,
    membersRes,
    hiddenRes,
    leadersBundle,
  ] = await Promise.all([
    supabase
      .from('day_plans')
      .select('id, team_id, plan_date, created_by, created_at, digest_sent_at, digest_receipts')
      .eq('team_id', teamId)
      .eq('plan_date', date)
      .maybeSingle(),
    supabase
      .from('day_plans')
      .select('plan_date')
      .eq('team_id', teamId)
      .order('plan_date', { ascending: false })
      .limit(90),
    supabase
      .from('departments')
      .select('id, team_id, name, sort_order, archived_at, created_at')
      .eq('team_id', teamId)
      .is('archived_at', null)
      .order('sort_order'),
    supabase
      .from('team_columns')
      .select('id, team_id, key, label, sort_order, is_system, hidden, created_at')
      .eq('team_id', teamId)
      .order('sort_order'),
    supabase
      .from('team_members')
      .select(`user_id, department_id, profile:profiles(${PROFILE_JOIN})`)
      .eq('team_id', teamId),
    supabase
      .from('team_admins')
      .select('user_id')
      .eq('team_id', teamId)
      .eq('hide_from_plan', true),
    leadersPromise,
  ])

  const plan = planRes.data
  const hiddenFromPlanIds = (hiddenRes.data ?? []).map(a => a.user_id)

  let rows: (TaskRow & { profile: Profile | null; department: Department | null })[] = []
  if (plan) {
    const { data } = await supabase
      .from('task_rows')
      .select(
        `id, plan_id, employee_id, shift, planned, notified, completed, notes, notify_email, notify_push, created_at, plan_email_sent_at, plan_push_sent_at, report_sent_at, extra, department_id, profile:profiles(${PROFILE_JOIN}), department:departments(id, team_id, name, sort_order, archived_at, created_at)`
      )
      .eq('plan_id', plan.id)
      .order('created_at')
    rows = (data ?? []) as unknown as typeof rows

    // Keep plan grouping in sync with current team_members departments
    if (isAdmin && rows.length > 0) {
      const memberDept = new Map(
        (membersRes.data ?? []).map(m => [m.user_id, m.department_id as string | null])
      )
      const deptById = new Map(
        ((departmentsRes.data ?? []) as Department[]).map(d => [d.id, d])
      )
      const stale = rows.filter(r => {
        if (!memberDept.has(r.employee_id)) return false
        return memberDept.get(r.employee_id) !== r.department_id
      })
      if (stale.length > 0) {
        await Promise.all(
          stale.map(r =>
            supabase
              .from('task_rows')
              .update({ department_id: memberDept.get(r.employee_id) ?? null })
              .eq('id', r.id)
          )
        )
        rows = rows.map(r => {
          if (!memberDept.has(r.employee_id)) return r
          const nextId = memberDept.get(r.employee_id) ?? null
          if (nextId === r.department_id) return r
          return {
            ...r,
            department_id: nextId,
            department: nextId ? deptById.get(nextId) ?? null : null,
          }
        })
      }
    }
  }

  const nameById = new Map<string, string>()
  const loggedInIds: string[] = []
  const ids = [
    ...new Set([
      ...(membersRes.data ?? []).map(m => m.user_id),
      ...rows.map(r => r.employee_id),
    ]),
  ]

  // Prefer last_sign_in_at from profiles (no Auth Admin listUsers)
  for (const m of membersRes.data ?? []) {
    const p = asProfile(m.profile)
    if (p?.last_sign_in_at) loggedInIds.push(p.id)
  }
  for (const r of rows) {
    const p = asProfile(r.profile)
    if (p?.last_sign_in_at && !loggedInIds.includes(p.id)) loggedInIds.push(p.id)
  }

  const joinMissingNames =
    rows.some(r => !asProfile(r.profile)?.full_name?.trim()) ||
    (membersRes.data ?? []).some(m => !asProfile(m.profile)?.full_name?.trim())

  if (ids.length > 0 && joinMissingNames) {
    try {
      const admin = createAdminClient()
      const { data: nameRows } = await admin.from('profiles').select('id, full_name').in('id', ids)
      for (const p of nameRows ?? []) {
        if (p.full_name?.trim()) nameById.set(p.id, p.full_name.trim())
      }
    } catch {
      // ignore
    }
  }

  function displayProfile(userId: string, raw: Profile | null): Profile | null {
    const fullName = raw?.full_name?.trim() || nameById.get(userId) || ''
    if (!raw && !fullName) return null
    return {
      id: userId,
      full_name: fullName,
      email: isAdmin ? (raw?.email ?? '') : '',
      role: raw?.role ?? 'employee',
      department: raw?.department ?? '',
      created_at: raw?.created_at ?? '',
      last_sign_in_at: raw?.last_sign_in_at ?? null,
    }
  }

  const safeMembers = (membersRes.data ?? []).map(m => ({
    user_id: m.user_id,
    department_id: m.department_id,
    profile: displayProfile(m.user_id, asProfile(m.profile)),
  }))

  const safeRows = rows.map(r => ({
    ...r,
    profile: displayProfile(r.employee_id, asProfile(r.profile)) ?? undefined,
  })) as typeof rows

  let leaders: { id: string; full_name: string; email: string; role: string; avatar_url?: string | null }[] = []
  if (isAdmin) {
    const [supersRes, deputyRes] = leadersBundle as [
      { data: { id: string; full_name: string; email: string; role: string; avatar_url?: string | null }[] | null },
      { data: { user_id: string; profile: unknown }[] | null },
    ]
    const map = new Map<string, { id: string; full_name: string; email: string; role: string; avatar_url?: string | null }>()
    for (const s of supersRes.data ?? []) {
      map.set(s.id, {
        id: s.id,
        full_name: s.full_name || s.email,
        email: s.email || '',
        role: s.role,
        avatar_url: s.avatar_url ?? null,
      })
    }
    for (const d of deputyRes.data ?? []) {
      const p = asProfile(d.profile)
      if (!p) continue
      map.set(p.id, {
        id: p.id,
        full_name: p.full_name || p.email,
        email: p.email || '',
        role: p.role,
        avatar_url: p.avatar_url ?? null,
      })
    }
    leaders = [...map.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'uk'))
  }

  const planDates = (existingPlansRes.data ?? []).map(p => p.plan_date)
  const previousPlanDate = planDates.find(d => d < date) ?? null

  const pushUserIds = [
    ...new Set([
      ...ids,
      ...leaders.map(l => l.id),
    ]),
  ]
  let pushActiveIds: string[] = []
  if (isAdmin && pushUserIds.length > 0) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .in('user_id', pushUserIds)
    pushActiveIds = [...new Set((subs ?? []).map(s => s.user_id))]
  }

  return (
    <div className="plan-page min-w-0 max-w-full">
      {isAdmin && (
        <div className="mb-3">
          <Link href="/admin" className="tap-btn text-sm text-muted-foreground hover:text-foreground">
            ← До команд
          </Link>
        </div>
      )}
      <TeamPlanBoard
        team={team}
        date={date}
        planId={plan?.id ?? null}
        digestSentAt={plan?.digest_sent_at ?? null}
        digestReceipts={(plan?.digest_receipts as Record<string, { email?: string; push?: string }> | null) ?? {}}
        planDates={planDates}
        previousPlanDate={previousPlanDate}
        departments={(departmentsRes.data ?? []) as Department[]}
        columns={(columnsRes.data ?? []) as TeamColumn[]}
        members={safeMembers}
        rows={safeRows}
        leaders={leaders}
        isAdmin={isAdmin}
        isSubAdmin={profile.role === 'sub_admin'}
        canEditTasks={canEditTasks}
        currentUserId={user.id}
        loggedInIds={loggedInIds}
        hiddenFromPlanIds={hiddenFromPlanIds}
        pushActiveIds={pushActiveIds}
      />
    </div>
  )
}
