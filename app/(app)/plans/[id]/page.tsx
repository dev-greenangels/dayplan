import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

/** Legacy plan detail → resolve team+date and redirect */
export default async function LegacyPlanRedirect({ params }: Props) {
  const { id } = await params
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: plan } = await supabase
    .from('day_plans')
    .select('team_id, plan_date')
    .eq('id', id)
    .maybeSingle()

  if (plan?.team_id && plan.plan_date) {
    redirect(`/teams/${plan.team_id}/plans/${plan.plan_date}`)
  }
  redirect('/admin')
}
