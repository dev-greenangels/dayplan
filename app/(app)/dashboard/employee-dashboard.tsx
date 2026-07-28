'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DayPlan, Profile, TaskRow, TeamColumn } from '@/lib/types'
import {
  formatUkDate,
  formatUkDateTime,
  formatUkDayTab,
  formatUkShortDate,
  todayISO,
} from '@/lib/format-date'
import { updateTaskRowFields } from '@/app/actions/plans'
import AutoGrowTextarea from '@/components/auto-grow-textarea'
import { useMobileKeyboardOpen } from '@/hooks/use-mobile-keyboard-open'

type TaskRowWithPlan = TaskRow & { day_plans: DayPlan | null }

interface Props {
  profile: Profile
  selectedDate: string
  selectedRow: TaskRowWithPlan | null
  planDates: string[]
  teamName?: string
  teamId?: string
  isToday: boolean
  columns: TeamColumn[]
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function EmployeeDashboard({
  profile,
  selectedDate,
  selectedRow,
  planDates,
  teamName,
  teamId,
  isToday,
  columns,
}: Props) {
  const router = useRouter()
  const [report, setReport] = useState(selectedRow?.completed ?? '')
  const [notes, setNotes] = useState(selectedRow?.notes ?? '')
  const [extra, setExtra] = useState<Record<string, string>>(selectedRow?.extra ?? {})
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [fieldSave, setFieldSave] = useState<Record<string, SaveState>>({})
  const [error, setError] = useState<string | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportMsg, setReportMsg] = useState<string | null>(null)
  const [reportSentAt, setReportSentAt] = useState<string | null>(
    selectedRow?.report_sent_at ?? null
  )
  const [reportInvalid, setReportInvalid] = useState(false)
  const frozen = selectedDate < todayISO() && !!reportSentAt
  const keyboardOpen = useMobileKeyboardOpen()

  const reportRef = useRef(report)
  const notesRef = useRef(notes)
  const extraRef = useRef(extra)
  const rowIdRef = useRef(selectedRow?.id ?? null)
  const committedRef = useRef({
    completed: selectedRow?.completed ?? '',
    notes: selectedRow?.notes ?? '',
    extra: { ...(selectedRow?.extra ?? {}) },
  })
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const aliveRef = useRef(true)

  reportRef.current = report
  notesRef.current = notes
  extraRef.current = extra
  rowIdRef.current = selectedRow?.id ?? null

  const editableCols = useMemo(
    () =>
      columns
        .filter(c => !c.hidden)
        .filter(c => c.key === 'completed' || c.key === 'notes' || !c.is_system)
        .sort((a, b) => a.sort_order - b.sort_order),
    [columns]
  )

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    setReport(selectedRow?.completed ?? '')
    setNotes(selectedRow?.notes ?? '')
    setExtra(selectedRow?.extra ?? {})
    committedRef.current = {
      completed: selectedRow?.completed ?? '',
      notes: selectedRow?.notes ?? '',
      extra: { ...(selectedRow?.extra ?? {}) },
    }
    setReportSentAt(selectedRow?.report_sent_at ?? null)
    setSaveState('idle')
    setFieldSave({})
    setError(null)
    setReportMsg(null)
    setReportInvalid(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    // Reset only when switching row or server values for this row change
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extra object identity is unstable
  }, [selectedRow?.id, selectedRow?.completed, selectedRow?.notes, selectedRow?.report_sent_at])

  useEffect(() => {
    if (saveState !== 'saved') return
    const t = setTimeout(() => {
      if (aliveRef.current) setSaveState('idle')
    }, 2500)
    return () => clearTimeout(t)
  }, [saveState])

  const flushSave = useCallback(async (): Promise<boolean> => {
    const rowId = rowIdRef.current
    if (!rowId || frozen) return true

    // Wait out an in-flight save so "send report" always persists latest input
    for (let i = 0; i < 40 && savingRef.current; i++) {
      await new Promise(r => setTimeout(r, 50))
    }
    if (savingRef.current) return false

    const next = {
      completed: reportRef.current,
      notes: notesRef.current,
      extra: { ...extraRef.current },
    }
    const prev = committedRef.current
    const changed: string[] = []
    if (prev.completed !== next.completed) changed.push('completed')
    if (prev.notes !== next.notes) changed.push('notes')
    const extraKeys = new Set([...Object.keys(prev.extra), ...Object.keys(next.extra)])
    for (const ek of extraKeys) {
      if ((prev.extra[ek] || '') !== (next.extra[ek] || '')) changed.push(`extra:${ek}`)
    }
    if (changed.length === 0) return true

    savingRef.current = true
    if (aliveRef.current) {
      setSaveState('saving')
      setFieldSave(prevState => {
        const n = { ...prevState }
        for (const k of changed) n[k] = 'saving'
        return n
      })
    }
    try {
      const res = await updateTaskRowFields(rowId, {
        completed: next.completed,
        notes: next.notes,
        extra: next.extra,
      })
      if (!aliveRef.current) return !res.error
      if (res.error) {
        setError(res.error)
        setSaveState('error')
        setFieldSave(prevState => {
          const n = { ...prevState }
          for (const k of changed) delete n[k]
          return n
        })
        return false
      }
      committedRef.current = next
      setError(null)
      setSaveState('saved')
      setFieldSave(prevState => {
        const n = { ...prevState }
        for (const k of changed) n[k] = 'saved'
        return n
      })
      return true
    } finally {
      savingRef.current = false
    }
  }, [frozen])

  const scheduleIdleSave = useCallback(() => {
    if (frozen) return
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      void flushSave()
    }, 10_000)
  }, [flushSave, frozen])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flushSave()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const prev = committedRef.current
      const dirty =
        prev.completed !== reportRef.current ||
        prev.notes !== notesRef.current ||
        JSON.stringify(prev.extra) !== JSON.stringify(extraRef.current)
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
        void flushSave()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [flushSave])

  function goToDate(d: string) {
    if (d === selectedDate) return
    void flushSave().then(() => {
      router.push(`/dashboard?date=${d}`)
    })
  }

  function onReportChange(v: string) {
    setReport(v)
    setReportInvalid(false)
    setFieldSave(prev => {
      if (!prev.completed) return prev
      const n = { ...prev }
      delete n.completed
      return n
    })
    scheduleIdleSave()
  }

  function onNotesChange(v: string) {
    setNotes(v)
    setFieldSave(prev => {
      if (!prev.notes) return prev
      const n = { ...prev }
      delete n.notes
      return n
    })
    scheduleIdleSave()
  }

  function onExtraChange(key: string, v: string) {
    setExtra(prev => ({ ...prev, [key]: v }))
    setFieldSave(prev => {
      const fk = `extra:${key}`
      if (!prev[fk]) return prev
      const n = { ...prev }
      delete n[fk]
      return n
    })
    scheduleIdleSave()
  }

  async function sendLeadershipReport() {
    if (!teamId) return
    if (!report.trim()) {
      setReportInvalid(true)
      setReportMsg('Помилка: заповніть «Виконано» перед відправкою')
      return
    }
    setReportBusy(true)
    setReportMsg(null)
    try {
      const ok = await flushSave()
      if (!ok) {
        setReportMsg('Помилка: не вдалося зберегти звіт перед відправкою')
        setReportBusy(false)
        return
      }
      const res = await fetch('/api/send-employee-leadership-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, date: selectedDate }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        if (String(json.error || '').includes('Виконано')) setReportInvalid(true)
        setReportMsg('Помилка: ' + (json.error || `HTTP ${res.status}`))
      } else {
        setReportInvalid(false)
        const sentAt = (json.sent_at as string) || new Date().toISOString()
        setReportSentAt(sentAt)
        const parts: string[] = []
        if (json.emailSent) parts.push(`email: ${json.emailSent}`)
        if (json.pushSent) parts.push(`push: ${json.pushSent}`)
        setReportMsg(parts.length ? `Надіслано (${parts.join(', ')})` : 'Надіслано')
        setSaveState('saved')
      }
    } catch {
      setReportMsg('Помилка мережі')
    }
    setReportBusy(false)
  }

  const sortedDates = [...planDates].sort()

  function fieldBadge(key: string) {
    const state = fieldSave[key]
    if (state === 'saving') {
      return (
        <span className="pointer-events-none absolute right-2 top-2 text-[10px] font-semibold text-muted-foreground/80">
          …
        </span>
      )
    }
    if (state === 'saved') {
      return (
        <span className="pointer-events-none absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700">
          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )
    }
    return null
  }

  const reportField = (
    <div className="relative">
      <AutoGrowTextarea
        value={report}
        onChange={onReportChange}
        onBlur={() => { void flushSave() }}
        disabled={frozen}
        placeholder="Що виконано сьогодні..."
        minHeight={88}
        aria-invalid={reportInvalid}
        className={`w-full resize-none rounded-xl border px-4 py-3.5 pr-8 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70 ${
          reportInvalid
            ? 'border-red-400 bg-emerald-50 text-emerald-900 ring-1 ring-red-300/80'
            : frozen
              ? 'border-emerald-200/70 bg-emerald-50/60 text-emerald-900 shadow-none'
              : 'border-emerald-300 bg-emerald-50/70 text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05)]'
        }`}
      />
      {fieldBadge('completed')}
    </div>
  )

  const notesField = (
    <div className="relative">
      <AutoGrowTextarea
        value={notes}
        onChange={onNotesChange}
        onBlur={() => { void flushSave() }}
        disabled={frozen}
        placeholder="Додаткові обробки (якщо були)..."
        minHeight={64}
        className="w-full resize-none rounded-xl border border-input bg-white/60 px-4 py-3.5 pr-8 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
      />
      {fieldBadge('notes')}
    </div>
  )

  return (
    <div className="mx-auto max-w-lg pb-24 xl:pb-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Привіт, {profile.full_name || 'Працівнику'}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{formatUkDate(selectedDate)}</p>
          {teamName && <p className="text-xs text-muted-foreground">{teamName}</p>}
          {saveState === 'saving' && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Збереження…</p>
          )}
          {saveState === 'saved' && (
            <p className="mt-0.5 text-[11px] text-emerald-700">Збережено</p>
          )}
        </div>
        {teamId && selectedRow && (
          <button
            type="button"
            onClick={() => { void sendLeadershipReport() }}
            disabled={reportBusy || frozen}
            title={frozen ? 'Звіт за минулий день уже відправлено' : 'Надіслати свій звіт керівництву'}
            className={`tap-btn hidden min-h-[52px] min-w-[168px] flex-col items-center justify-center rounded-xl px-4 py-1.5 text-sm font-semibold leading-tight disabled:opacity-40 xl:flex ${
              reportSentAt
                ? 'border border-green-300 bg-green-50 text-green-800'
                : 'glass-send-btn text-primary-foreground'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <SendEnvelopeIcon className="h-4 w-4" />
              {reportBusy ? '...' : reportSentAt ? 'Звіт керівництву ✓' : 'Звіт керівництву'}
            </span>
            <span className={`mt-0.5 text-[10px] font-normal ${reportSentAt ? 'text-green-700/80' : 'invisible text-primary-foreground/80'}`}>
              {reportSentAt ? formatUkDateTime(reportSentAt) : '00.00.0000 00:00'}
            </span>
          </button>
        )}
      </div>

      {sortedDates.length > 0 && (
        <div className="mb-4 min-w-0 rounded-xl border border-border/50 bg-white/50 p-2">
          <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Мої плани</p>
          <div className="flex max-w-full gap-1 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sortedDates.map(d => {
              const label = formatUkDayTab(d)
              const selected = d === selectedDate
              const today = d === todayISO()
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => goToDate(d)}
                  className={`tap-btn flex min-w-[48px] shrink-0 flex-col items-center rounded-lg px-2 py-1.5 text-center transition ${
                    selected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : today
                        ? 'border-2 border-primary/70 bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_rgba(45,106,79,0.12)]'
                        : 'border border-border/60 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className={`text-[10px] uppercase opacity-80 ${today && !selected ? 'font-semibold text-primary' : ''}`}>
                    {today && !selected ? 'сьогодні' : label.weekday}
                  </span>
                  <span className="text-sm font-semibold leading-tight">{label.day}</span>
                  {today && !selected && (
                    <span className="mt-0.5 h-1 w-1 rounded-full bg-primary" />
                  )}
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
        <p className="mb-4 text-lg font-semibold text-foreground">
          Мій план на {formatUkShortDate(selectedDate)}
        </p>

        {selectedRow ? (
          <div className="space-y-3">
            {selectedRow.shift && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Зміна
                </p>
                <p className="mt-0.5 text-base font-semibold text-foreground">{selectedRow.shift}</p>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-sky-800/80">
                Завдання
              </p>
              <div className="min-h-[40px] whitespace-pre-wrap rounded-xl border border-sky-200/70 bg-sky-50/50 px-3.5 py-2.5 text-base leading-relaxed text-foreground">
                {selectedRow.planned || (
                  <span className="italic text-muted-foreground">План ще не заповнено</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              {isToday
                ? 'Шеф ще не склав план на сьогодні'
                : 'Немає плану на цей день'}
            </p>
          </div>
        )}
      </div>

      {selectedRow && (
        <div className="glass-card mb-4 space-y-4 p-6">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-foreground">Мій звіт за день</p>
            {saveState === 'saved' && (
              <span className="text-[11px] text-emerald-700">✓ збережено</span>
            )}
          </div>
          {frozen && (
            <p className="text-xs text-amber-700">Звіт за минулий день уже відправлено — редагування заборонено.</p>
          )}

          {editableCols.length > 0 ? (
            editableCols.map(col => {
              if (col.key === 'completed') {
                return (
                  <div key={col.id}>
                    <p className="mb-2 text-sm font-bold text-emerald-900">{col.label || 'Виконано'}</p>
                    {reportField}
                  </div>
                )
              }
              if (col.key === 'notes') {
                return (
                  <div key={col.id}>
                    <p className="mb-2 text-sm font-bold text-foreground">{col.label || 'Обробки'}</p>
                    {notesField}
                  </div>
                )
              }
              const val = extra[col.key] ?? ''
              return (
                <div key={col.id}>
                  <p className="mb-2 text-sm font-bold text-foreground">{col.label}</p>
                  <div className="relative">
                    <AutoGrowTextarea
                      value={val}
                      onChange={v => onExtraChange(col.key, v)}
                      onBlur={() => { void flushSave() }}
                      disabled={frozen}
                      placeholder={col.input_template || undefined}
                      minHeight={56}
                      className="w-full resize-none rounded-xl border border-input bg-white/60 px-4 py-3.5 pr-8 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
                    />
                    {fieldBadge(`extra:${col.key}`)}
                  </div>
                </div>
              )
            })
          ) : (
            <>
              <div>
                <p className="mb-2 text-sm font-bold text-emerald-900">Виконано</p>
                {reportField}
              </div>
              <div>
                <p className="mb-2 text-sm font-bold text-foreground">Обробки</p>
                {notesField}
              </div>
            </>
          )}
        </div>
      )}

      {teamId && selectedRow && !keyboardOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-3 xl:hidden"
          style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom))' }}
        >
          <div className="boty-glass mx-auto flex max-w-lg justify-center rounded-lg px-1 py-1">
            <button
              type="button"
              onClick={() => { void sendLeadershipReport() }}
              disabled={reportBusy || frozen}
              className={`tap-btn flex flex-col items-center gap-0 rounded-lg px-5 py-0.5 text-[11px] font-semibold leading-tight disabled:opacity-40 ${
                reportSentAt ? 'text-green-700' : 'text-primary'
              }`}
            >
              <span className={`relative flex h-11 w-11 items-center justify-center rounded-full shadow-[0_4px_14px_oklch(0.42_0.12_155_/_40%)] ${
                reportSentAt
                  ? 'bg-green-100 text-green-800'
                  : 'bg-[linear-gradient(135deg,oklch(0.42_0.12_155),oklch(0.48_0.13_150))] text-primary-foreground'
              }`}>
                <SendEnvelopeIcon className="h-6 w-6" />
                {reportSentAt && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-600 text-[8px] text-white">✓</span>
                )}
              </span>
              Звіт керівництву
              <span className={`text-[9px] font-normal leading-none ${reportSentAt ? 'text-green-700/90' : 'invisible'}`}>
                {reportSentAt ? formatUkDateTime(reportSentAt) : '00.00.0000 00:00'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SendEnvelopeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5l6.8 4.25a2 2 0 002.1 0L19.7 8.5" />
      <rect x="3" y="6" width="14.5" height="12" rx="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.5h4.5v4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 4.5l-6 6" />
    </svg>
  )
}
