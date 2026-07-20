import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import NavBar from '@/components/nav-bar'
import type { Profile } from '@/lib/types'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // If no profile yet (first login before trigger ran), create one
  if (!profile) {
    await supabase.from('profiles').insert({
      id: user.id,
      full_name: user.user_metadata?.full_name ?? '',
      email: user.email ?? '',
      role: user.user_metadata?.role ?? 'employee',
      department: user.user_metadata?.department ?? '',
    })
  }

  const resolvedProfile: Profile = profile ?? {
    id: user.id,
    full_name: '',
    email: user.email ?? '',
    role: 'employee',
    department: '',
    created_at: new Date().toISOString(),
  }

  return (
    <div className="page-bg min-h-screen">
      <NavBar profile={resolvedProfile} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  )
}
