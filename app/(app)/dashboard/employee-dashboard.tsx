'use client'

import { useState, useTransition, useEffect } from 'react'
import type { DayPlan, Profile, TaskRow, WorkMode } from '@/lib/types'
import { formatUkDate } from '@/lib/format-date'
import { updateTaskRowFields } from '@/app/actions/plans'
import Modal from '@/components/modal'

type TaskRowWithPlan = TaskRow & { day_plans: DayPlan | null }

interface Props {
  profile: Profile
  todayRow: TaskRowWithPlan | null
  todayPlan: DayPlan | null
  pastRows: TaskRowWithPlan[]
  teamName?: string
  teamId?: string
  workMode?: WorkMode
}

function formatDate(dateStr: string) {
  return formatUkDate(dateStr)
}

export default function EmployeeDashboard({
  profile,
  todayRow,
  todayPlan,
  pastRows,
  teamName,
  teamId,
  workMode = 'individual',
}: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const [report, setReport] = useState(todayRow?.completed ?? '')
  const [notes, setNotes] = useState(todayRow?.notes ?? '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [reportOpen, setReportOpen] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportScope, setReportScope] = useState<'mine' | 'all'>('mine')
  const [reportMsg, setReportMsg] = useState<string | null>(null)

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
      const res = await updateTaskRowFields(todayRow.id, {
        completed: report,
        notes,
      })
      if (res.error) setError(res.error)
      else setSaved(true)
    })
  }

  async function sendLeadershipReport(scope: 'mine' | 'all') {
    if (!teamId) return
    setReportBusy(true)
    setReportMsg(null)
    try {
      if (todayRow && report.trim()) {
        await updateTaskRowFields(todayRow.id, { completed: report, notes })
      }
      const res = await fetch('/api/send-employee-leadership-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, date: today, scope }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setReportMsg('Помилка: ' + (json.error || `HTTP ${res.status}`))
      } else {
        const parts: string[] = []
        if (json.emailSent) parts.push(`email: ${json.emailSent}`)
        if (json.pushSent) parts.push(`push: ${json.pushSent}`)
        setReportMsg(parts.length ? `Надіслано (${parts.join(', ')})` : 'Надіслано')
        setReportOpen(false)
        setSaved(true)
      }
    } catch {
      setReportMsg('Помилка мережі')
    }
    setReportBusy(false)
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Привіт, {profile.full_name || 'Працівнику'}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{formatDate(today)}</p>
          {teamName && <p className="text-xs text-muted-foreground">{teamName}</p>}
        </div>
        {teamId && (
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            disabled={!todayRow}
            className="tap-btn glass-send-btn inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Звіт керівництву
          </button>
        )}
      </div>

      {(error || reportMsg) && (
        <p className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
          (error || reportMsg || '').startsWith('Помилка')
            ? 'border-red-200 bg-red-50 text-red-600'
            : 'border-green-200 bg-green-50 text-green-800'
        }`}>
          {error || reportMsg}
        </p>
      )}

      <div className="glass-card mb-4 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l-3 3 3-3m0 0l3-3-3 3" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-foreground">
              Мій план на {formatUkDate(today, { weekday: false })}
            </p>
          </div>
        </div>

        {todayRow ? (
          <div className="rounded-xl border border-border bg-white/40 px-4 py-3">
            {todayRow.shift && (
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Зміна: <span className="font-semibold text-foreground">{todayRow.shift}</span>
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {todayRow.planned || <span className="italic text-muted-foreground">План ще не заповнено</span>}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-white/20 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">Адмін ще не склав план на сьогодні</p>
          </div>
        )}
      </div>

      {todayRow && (
        <div className="glass-card mb-4 p-6">
          <p className="mb-3 font-semibold text-foreground">Мій звіт за день</p>
          <textarea
            value={report}
            onChange={e => setReport(e.target.value)}
            placeholder="Що виконано сьогодні..."
            rows={4}
            className="w-full resize-none rounded-xl border border-input bg-white/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mb-2 mt-4 text-sm font-medium text-foreground">Обробки</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Додаткові обробки (якщо були)..."
            rows={2}
            className="w-full resize-none rounded-xl border border-input bg-white/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <button
            onClick={handleSubmit}
            disabled={isPending || !report.trim()}
            className="relative mt-4 w-full overflow-hidden rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? 'Відправка...' : saved ? '✓ Звіт збережено!' : 'Зберегти звіт'}
          </button>
        </div>
      )}

      {pastRows.length > 0 && (
        <div className="glass-card p-6">
          <p className="mb-3 text-sm font-semibold text-foreground">Попередні дні</p>
          <div className="flex flex-col gap-2">
            {pastRows.map(row => (
              <div key={row.id} className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-white/30 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
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

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Звіт керівництву"
        description="Надішле email і push керівництву з полем «Виконано»"
      >
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setReportScope('mine')}
            className={`tap-btn rounded-xl border px-3 py-3 text-left text-sm ${
              reportScope === 'mine'
                ? 'border-primary bg-primary/10 font-semibold text-primary'
                : 'border-border bg-white/70 text-foreground'
            }`}
          >
            Тільки мій звіт (виконано)
          </button>
          {workMode === 'shared' && (
            <button
              type="button"
              onClick={() => setReportScope('all')}
              className={`tap-btn rounded-xl border px-3 py-3 text-left text-sm ${
                reportScope === 'all'
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'border-border bg-white/70 text-foreground'
              }`}
            >
              Усіх працівників (виконано) — спільний ПК
            </button>
          )}
          <button
            type="button"
            disabled={reportBusy}
            onClick={() => { void sendLeadershipReport(reportScope) }}
            className="tap-btn rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {reportBusy ? 'Надсилаємо…' : 'Надіслати email і push'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
