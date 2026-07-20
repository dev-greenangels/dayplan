'use client'

import { useState, useTransition, useEffect } from 'react'
import type { DayPlan, Profile, TaskRow } from '@/lib/types'

type TaskRowWithPlan = TaskRow & { day_plans: DayPlan | null }

interface Props {
  profile: Profile
  todayRow: TaskRowWithPlan | null
  todayPlan: DayPlan | null
  pastRows: TaskRowWithPlan[]
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('uk-UA', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

export default function EmployeeDashboard({ profile, todayRow, todayPlan, pastRows }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const [report, setReport] = useState(todayRow?.completed ?? '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Reset saved state after animation
  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(t)
    }
  }, [saved])

  function handleSubmit() {
    if (!todayRow) return
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskRowId: todayRow.id, completed: report }),
      })
      const json = await res.json()
      if (json.error) {
        setError(json.error)
      } else {
        setSaved(true)
      }
    })
  }

  return (
    <div className="mx-auto max-w-lg">
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          Привіт, {profile.full_name || 'Працівнику'}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground capitalize">{formatDate(today)}</p>
      </div>

      {/* Today's plan card */}
      <div className="glass-card mb-4 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l-3 3 3-3m0 0l3-3-3 3" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-foreground">Мій план на сьогодні</p>
            {todayPlan && <p className="text-xs text-muted-foreground">{todayPlan.department}</p>}
          </div>
        </div>

        {todayRow ? (
          <div className="rounded-xl border border-border bg-white/40 px-4 py-3">
            {todayRow.shift && (
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Зміна: <span className="text-foreground font-semibold">{todayRow.shift}</span>
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {todayRow.planned || <span className="italic text-muted-foreground">План ще не заповнено</span>}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-white/20 px-4 py-8 text-center">
            <svg className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
            </svg>
            <p className="text-sm text-muted-foreground">Адмін ще не склав план на сьогодні</p>
          </div>
        )}
      </div>

      {/* Report card */}
      {todayRow && (
        <div className="glass-card mb-4 p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
              <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <p className="font-semibold text-foreground">Мій звіт за день</p>
          </div>

          <textarea
            value={report}
            onChange={e => setReport(e.target.value)}
            placeholder="Що виконано сьогодні..."
            rows={4}
            className="w-full resize-none rounded-xl border border-input bg-white/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />

          {error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={isPending || !report.trim()}
            className="relative mt-4 w-full overflow-hidden rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow shadow-primary/25 transition hover:opacity-90 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-50"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Відправка...
              </span>
            ) : saved ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-5 w-5 animate-[scale-in_0.2s_ease-out]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Звіт збережено!
              </span>
            ) : (
              'Надіслати звіт'
            )}
          </button>
        </div>
      )}

      {/* Past plans */}
      {pastRows.length > 0 && (
        <div className="glass-card p-6">
          <p className="mb-3 text-sm font-semibold text-foreground">Попередні дні</p>
          <div className="flex flex-col gap-2">
            {pastRows.map(row => (
              <div key={row.id} className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-white/30 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground capitalize">
                    {row.day_plans?.plan_date ? formatDate(row.day_plans.plan_date) : '—'}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-foreground">
                    {row.planned || <span className="italic text-muted-foreground">Без плану</span>}
                  </p>
                </div>
                {row.completed ? (
                  <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Виконано</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Без звіту</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
