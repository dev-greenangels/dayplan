import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types'
import CreatePlanForm from './create-plan-form'

export default async function CreatePlanPage() {
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
    .select('id, full_name, email, department, role')
    .order('full_name', { ascending: true })

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Новий денний план</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Створіть план та призначте завдання</p>
      </div>
      <div className="glass-card p-6 sm:p-8">
        <CreatePlanForm employees={(employees ?? []) as Pick<Profile, 'id' | 'full_name' | 'email' | 'department'>[]} />
      </div>
    </div>
  )
}
