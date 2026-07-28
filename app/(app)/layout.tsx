import { redirect } from 'next/navigation'
import { getSessionProfile, canAccessPeoplePage, isBoss, isDeputyOrBoss } from '@/lib/auth'
import NavBar from '@/components/nav-bar'
import PushProvider from '@/components/push-provider'
import { ToastProvider } from '@/components/toast-provider'
import { PlanChromeLockProvider } from '@/components/plan-chrome-lock'
import { TeamPlanSearchProvider } from '@/components/team-plan-search'
import { PlanScheduleChromeProvider } from '@/components/plan-schedule-chrome'
import RealtimeChannelJanitor from '@/components/realtime-channel-janitor'
import { todayISO } from '@/lib/format-date'
import type { WorkMode } from '@/lib/types'

export type MembershipInfo = {
  teamName: string | null
  departmentName: string | null
  teamId: string | null
  workMode: WorkMode | null
} | null

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await getSessionProfile()
  if (!ctx) redirect('/login')

  // Pending users stay on /pending (that page is outside this layout)
  if (ctx.profile.role === 'pending') {
    redirect('/pending')
  }

  let membership: MembershipInfo = null
  const { data: mem } = await ctx.supabase
    .from('team_members')
    .select('team_id, team:teams(id, name, work_mode), department:departments(name)')
    .eq('user_id', ctx.user.id)
    .maybeSingle()

  if (mem) {
    const team = mem.team as
      | { id?: string; name?: string; work_mode?: WorkMode }
      | { id?: string; name?: string; work_mode?: WorkMode }[]
      | null
    const dept = mem.department as { name?: string } | { name?: string }[] | null
    const teamObj = Array.isArray(team) ? team[0] : team
    const deptObj = Array.isArray(dept) ? dept[0] : dept
    membership = {
      teamName: teamObj?.name ?? null,
      departmentName: deptObj?.name ?? null,
      teamId: teamObj?.id ?? mem.team_id ?? null,
      workMode: teamObj?.work_mode ?? null,
    }
  }

  const canAccessPeople =
    isBoss(ctx.profile.role) ||
    (ctx.profile.role === 'sub_admin' && (await canAccessPeoplePage(ctx.supabase, ctx.profile)))

  const employeeHome =
    membership?.workMode === 'shared' && membership.teamId
      ? `/teams/${membership.teamId}/plans/${todayISO()}`
      : '/dashboard'

  return (
    <PushProvider>
      <ToastProvider>
        <PlanChromeLockProvider>
          <TeamPlanSearchProvider enabled={isDeputyOrBoss(ctx.profile.role)}>
            <PlanScheduleChromeProvider>
              <RealtimeChannelJanitor />
              <div className="page-bg min-h-screen">
                <NavBar
                  profile={ctx.profile}
                  membership={membership}
                  employeeHome={employeeHome}
                  canAccessPeople={canAccessPeople}
                />
                <main className="app-main mx-auto min-w-0 max-w-[1600px] px-3 py-4 sm:px-4 sm:py-6">
                  {children}
                </main>
              </div>
            </PlanScheduleChromeProvider>
          </TeamPlanSearchProvider>
        </PlanChromeLockProvider>
      </ToastProvider>
    </PushProvider>
  )
}
