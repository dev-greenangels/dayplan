import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { DayPlan, Profile } from '@/lib/types'

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>()

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'sub_admin'

  let plans: DayPlan[] = []

  if (isAdmin) {
    const { data } = await supabase
      .from('day_plans')
      .select('*')
      .order('plan_date', { ascending: false })
    plans = data ?? []
  } else {
    // Employees see only plans they have task rows in
    const { data: taskRows } = await supabase
      .from('task_rows')
      .select('plan_id')
      .eq('employee_id', user.id)
    const planIds = [...new Set((taskRows ?? []).map(r => r.plan_id))]
    if (planIds.length > 0) {
      const { data } = await supabase
        .from('day_plans')
        .select('*')
        .in('id', planIds)
        .order('plan_date', { ascending: false })
      plans = data ?? []
    }
  }

  // Group by date
  const grouped = plans.reduce<Record<string, DayPlan[]>>((acc, plan) => {
    const key = plan.plan_date
    if (!acc[key]) acc[key] = []
    acc[key].push(plan)
    return acc
  }, {})

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Денні плани</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isAdmin ? 'Всі плани підрозділів' : 'Ваші плани на день'}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/admin/create-plan"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90"
          >
            + Новий план
          </Link>
        )}
      </div>

      {sortedDates.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center gap-3 py-16 text-center">
          <svg className="h-12 w-12 text-muted-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-muted-foreground">Планів ще немає</p>
          {isAdmin && (
            <Link href="/admin/create-plan" className="text-sm text-primary underline underline-offset-4">
              Створити перший план
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sortedDates.map(date => (
            <section key={date}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {formatDate(date)}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {grouped[date].map(plan => (
                  <Link
                    key={plan.id}
                    href={`/plans/${plan.id}`}
                    className="glass-card block p-5 transition hover:shadow-md hover:-translate-y-0.5 duration-150"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">
                          {plan.department || 'Без відділу'}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(plan.plan_date)}
                        </p>
                      </div>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-primary font-medium">Відкрити план &rarr;</p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
