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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Only insert if the row genuinely doesn't exist (PGRST116 = no rows found)
  if (!profile && profileError?.code === 'PGRST116') {
    await supabase.from('profiles').insert({
      id: user.id,
      full_name: user.user_metadata?.full_name ?? '',
      email: user.email ?? '',
      role: 'employee',
      department: user.user_metadata?.department ?? '',
    })
  }

  // If profile still null after insert attempt, re-fetch once
  let resolvedProfile: Profile = profile ?? {
    id: user.id,
    full_name: user.user_metadata?.full_name ?? '',
    email: user.email ?? '',
    role: 'employee',
    department: '',
    created_at: new Date().toISOString(),
  }

  // Re-fetch if we just inserted, to get the actual DB row (including any role set manually)
  if (!profile) {
    const { data: refetched } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    if (refetched) resolvedProfile = refetched
  }

  // Redirect pending users — but not if they are already on /pending
  if (resolvedProfile.role === 'pending') {
    redirect('/pending')
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
