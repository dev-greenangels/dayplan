import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types'
import InviteForm from './invite-form'
import EmployeeList from './employee-list'

export default async function EmployeesPage() {
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

  const { data: employees } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Працівники</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Управління командою та ролями</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Invite form */}
        <div className="lg:col-span-1">
          <div className="glass-card p-6">
            <h2 className="mb-4 font-semibold text-foreground">Запросити працівника</h2>
            <InviteForm />
          </div>
        </div>

        {/* Employees list */}
        <div className="lg:col-span-2">
          <div className="glass-card overflow-hidden">
            <div className="border-b border-border px-6 py-4">
              <h2 className="font-semibold text-foreground">Список ({employees?.length ?? 0})</h2>
            </div>
            <EmployeeList
              employees={(employees ?? []) as Profile[]}
              currentUserId={user.id}
              isSuperAdmin={profile.role === 'super_admin'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
