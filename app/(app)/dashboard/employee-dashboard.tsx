'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { DayPlan, Profile, TaskRow } from '@/lib/types'
import {
  formatUkDate,
  formatUkDateTime,
  formatUkDayTab,
  formatUkShortDate,
} from '@/lib/format-date'
import { updateTaskRowFields } from '@/app/actions/plans'
import BrandLogo from '@/components/brand-logo'

type TaskRowWithPlan = TaskRow & { day_plans: DayPlan | null }

interface Props {
  profile: Profile
  selectedDate: string
  selectedRow: TaskRowWithPlan | null
  planDates: string[]
  teamName?: string
  teamId?: string
  isToday: boolean
}

export default function EmployeeDashboard({
  profile,
  selectedDate,
  selectedRow,
  planDates,
  teamName,
  teamId,
  isToday,
}: Props) {
  const router = useRouter()
  const [report, setReport] = useState(selectedRow?.completed ?? '')
  const [notes, setNotes] = useState(selectedRow?.notes ?? '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [reportBusy, setReportBusy] = useState(false)
  const [reportMsg, setReportMsg] = useState<string | null>(null)
  const [reportSentAt, setReportSentAt] = useState<string | null>(
    selectedRow?.report_sent_at ?? null
  )

  useEffect(() => {
    setReport(selectedRow?.completed ?? '')
    setNotes(selectedRow?.notes ?? '')
    setReportSentAt(selectedRow?.report_sent_at ?? null)
    setSaved(false)
    setError(null)
    setReportMsg(null)
  }, [selectedRow?.id, selectedRow?.completed, selectedRow?.notes, selectedRow?.report_sent_at])

  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(t)
    }
  }, [saved])

  function goToDate(d: string) {
    if (d === selectedDate) return
    router.push(`/dashboard?date=${d}`)
  }

  function handleSubmit() {
    if (!selectedRow) return
    setError(null)
    startTransition(async () => {
      const res = await updateTaskRowFields(selectedRow.id, {
        completed: report,
        notes,
      })
      if (res.error) setError(res.error)
      else setSaved(true)
    })
  }

  async function sendLeadershipReport() {
    if (!teamId) return
    if (!report.trim()) {
      setReportMsg('Помилка: заповніть «Виконано» перед відправкою')
      return
    }
    setReportBusy(true)
    setReportMsg(null)
    try {
      if (selectedRow) {
        await updateTaskRowFields(selectedRow.id, { completed: report, notes })
      }
      const res = await fetch('/api/send-employee-leadership-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, date: selectedDate }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setReportMsg('Помилка: ' + (json.error || `HTTP ${res.status}`))
      } else {
        const sentAt = (json.sent_at as string) || new Date().toISOString()
        setReportSentAt(sentAt)
        const parts: string[] = []
        if (json.emailSent) parts.push(`email: ${json.emailSent}`)
        if (json.pushSent) parts.push(`push: ${json.pushSent}`)
        setReportMsg(parts.length ? `Надіслано (${parts.join(', ')})` : 'Надіслано')
        setSaved(true)
      }
    } catch {
      setReportMsg('Помилка мережі')
    }
    setReportBusy(false)
  }

  const sortedDates = [...planDates].sort()

  return (
    <div className="mx-auto max-w-lg pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          Привіт, {profile.full_name || 'Працівнику'}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{formatUkDate(selectedDate)}</p>
        {teamName && <p className="text-xs text-muted-foreground">{teamName}</p>}
      </div>

      {sortedDates.length > 0 && (
        <div className="mb-4 min-w-0 rounded-xl border border-border/50 bg-white/50 p-2">
          <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Мої плани</p>
          <div className="flex max-w-full gap-1 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sortedDates.map(d => {
              const label = formatUkDayTab(d)
              const selected = d === selectedDate
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => goToDate(d)}
                  className={`tap-btn flex min-w-[48px] shrink-0 flex-col items-center rounded-lg px-2 py-1.5 text-center transition ${
                    selected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'border border-border/60 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className="text-[10px] uppercase opacity-80">{label.weekday}</span>
                  <span className="text-sm font-semibold leading-tight">{label.day}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

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
          <BrandLogo size={40} rounded="rounded-xl" />
          <div>
            <p className="font-semibold text-foreground">
              Мій план на {formatUkShortDate(selectedDate)}
            </p>
          </div>
        </div>

        {selectedRow ? (
          <div className="rounded-xl border border-border bg-white/40 px-4 py-3">
            {selectedRow.shift && (
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Зміна: <span className="font-semibold text-foreground">{selectedRow.shift}</span>
              </p>
            )}
            <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
              {selectedRow.planned || (
                <span className="italic text-muted-foreground">План ще не заповнено</span>
              )}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-white/20 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {isToday
                ? 'Шеф ще не склав план на сьогодні'
                : 'Немає плану на цей день'}
            </p>
          </div>
        )}
      </div>

      {selectedRow && (
        <div className="glass-card mb-4 p-6">
          <p className="mb-3 font-semibold text-foreground">Мій звіт за день</p>
          <textarea
            value={report}
            onChange={e => setReport(e.target.value)}
            placeholder="Що виконано сьогодні..."
            rows={4}
            className="w-full resize-none rounded-xl border border-input bg-white/60 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mb-2 mt-4 text-sm font-medium text-foreground">Обробки</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Додаткові обробки (якщо були)..."
            rows={2}
            className="w-full resize-none rounded-xl border border-input bg-white/60 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <button
            onClick={handleSubmit}
            disabled={isPending || !report.trim()}
            className="relative mt-4 w-full overflow-hidden rounded-xl bg-primary py-3 text-base font-semibold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? 'Відправка...' : saved ? '✓ Звіт збережено!' : 'Зберегти звіт'}
          </button>
        </div>
      )}

      {teamId && selectedRow && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="boty-glass mx-auto flex max-w-lg justify-center rounded-lg px-1.5 py-2">
            <button
              type="button"
              onClick={() => { void sendLeadershipReport() }}
              disabled={reportBusy || !report.trim()}
              className={`tap-btn flex flex-col items-center gap-0.5 rounded-lg px-6 py-1 text-[10px] font-semibold disabled:opacity-40 ${
                reportSentAt ? 'text-green-700' : 'text-primary'
              }`}
            >
              <span className={`relative flex h-9 w-9 items-center justify-center rounded-full shadow-sm ${
                reportSentAt ? 'bg-green-100 text-green-800' : 'bg-primary text-primary-foreground'
              }`}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5l6.8 4.25a2 2 0 002.1 0L19.7 8.5" />
                  <rect x="3" y="6" width="14.5" height="12" rx="1.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.5h4.5v4.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 4.5l-6 6" />
                </svg>
                {reportSentAt && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-600 text-[8px] text-white">✓</span>
                )}
              </span>
              Звіт керівництву
              <span className={`text-[9px] font-normal ${reportSentAt ? 'text-green-700/90' : 'invisible'}`}>
                {reportSentAt ? formatUkDateTime(reportSentAt) : '00.00.0000 00:00'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
