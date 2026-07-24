import { redirect } from 'next/navigation'
import { getSessionProfile } from '@/lib/auth'
import NavBar from '@/components/nav-bar'
import PushProvider from '@/components/push-provider'

export type MembershipInfo = {
  teamName: string | null
  departmentName: string | null
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
    .select('team:teams(name), department:departments(name)')
    .eq('user_id', ctx.user.id)
    .maybeSingle()

  if (mem) {
    const team = mem.team as { name?: string } | { name?: string }[] | null
    const dept = mem.department as { name?: string } | { name?: string }[] | null
    const teamObj = Array.isArray(team) ? team[0] : team
    const deptObj = Array.isArray(dept) ? dept[0] : dept
    membership = {
      teamName: teamObj?.name ?? null,
      departmentName: deptObj?.name ?? null,
    }
  }

  return (
    <PushProvider>
      <div className="page-bg min-h-screen">
        <NavBar profile={ctx.profile} membership={membership} />
        <main className="app-main mx-auto min-w-0 max-w-[1600px] px-3 py-4 sm:px-4 sm:py-6">
          {children}
        </main>
      </div>
    </PushProvider>
  )
}
