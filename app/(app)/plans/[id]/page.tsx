import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PlanTable from '@/components/plan-table'
import Link from 'next/link'
import type { Profile, TaskRow } from '@/lib/types'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PlanDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>()

  if (!profile) redirect('/auth/login')

  const { data: plan } = await supabase
    .from('day_plans')
    .select('*')
    .eq('id', id)
    .single()

  if (!plan) notFound()

  // Fetch task rows with joined profile data
  const { data: rawRows } = await supabase
    .from('task_rows')
    .select('*, profile:profiles(*)')
    .eq('plan_id', id)
    .order('created_at', { ascending: true })

  const rows: (TaskRow & { profile: Profile })[] = (rawRows ?? []).map(r => ({
    ...r,
    profile: r.profile as Profile,
  }))

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Назад до планів
        </Link>
      </div>

      <PlanTable
        rows={rows}
        planId={id}
        currentUserId={user.id}
        currentUserRole={profile.role}
        planDepartment={plan.department}
        planDate={plan.plan_date}
      />
    </div>
  )
}
