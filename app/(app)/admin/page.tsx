import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Profile } from '@/lib/types'
import AdminPanel from './admin-panel'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>()

  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'sub_admin')) {
    redirect('/dashboard')
  }

  // Load all non-pending profiles
  const { data: employees } = await supabase
    .from('profiles')
    .select('*')
    .not('role', 'eq', 'pending')
    .order('full_name')

  // Load pending users (for management modal)
  const { data: pendingUsers } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'pending')
    .order('created_at')

  // Unique departments from profiles
  const allDepts = [...new Set((employees ?? []).map((e: Profile) => e.department).filter(Boolean))]

  return (
    <AdminPanel
      currentProfile={profile}
      employees={(employees ?? []) as Profile[]}
      pendingUsers={(pendingUsers ?? []) as Profile[]}
      departments={allDepts}
    />
  )
}
