import { redirect } from 'next/navigation'
import { getSessionProfile } from '@/lib/auth'
import NavBar from '@/components/nav-bar'
import PushProvider from '@/components/push-provider'

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

  return (
    <div className="page-bg min-h-screen">
      <NavBar profile={ctx.profile} />
      <PushProvider />
      <main className="app-main mx-auto max-w-[1600px] px-3 py-4 sm:px-4 sm:py-6">
        {children}
      </main>
    </div>
  )
}
