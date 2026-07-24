'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Department, Profile, TaskRow, Team, TeamColumn } from '@/lib/types'
import { addPlanMembers, copyPlanFromPreviousDay, deleteDayPlan, removePlanMember, saveTeamPlan, updateTaskRowFields } from '@/app/actions/plans'
import {
  daysInMonth,
  formatUkDate,
  formatUkDateTime,
  formatUkDayTab,
  formatUkMonthYear,
  formatUkShortDate,
  todayISO,
} from '@/lib/format-date'
import ConfirmDialog from '@/components/confirm-dialog'
import Modal from '@/components/modal'

type RowWithProfile = TaskRow & {
  profile?: Profile | null
  department?: Department | null
}

interface Member {
  user_id: string
  department_id: string | null
  profile: Profile | null
}

interface Leader {
  id: string
  full_name: string
  email: string
  role: string
  email_sent_at?: string | null
  push_sent_at?: string | null
}

type SendChannels = 'email' | 'push' | 'all'
type DigestContent = 'full' | 'planned' | 'completed'
type DigestReceipts = Record<string, { email?: string; push?: string }>

interface Props {
  team: Team
  date: string
  planId: string | null
  digestSentAt: string | null
  digestReceipts: DigestReceipts
  planDates: string[]
  previousPlanDate: string | null
  departments: Department[]
  columns: TeamColumn[]
  members: Member[]
  rows: RowWithProfile[]
  leaders: Leader[]
  isAdmin: boolean
  isSubAdmin: boolean
  canEditTasks: boolean
  currentUserId: string
  loggedInIds: string[]
  hiddenFromPlanIds: string[]
}

interface LocalRow {
  id?: string
  employee_id: string
  department_id: string | null
  full_name: string
  email: string
  shift: string
  planned: string
  completed: string
  notes: string
  plan_email_sent_at: string | null
  plan_push_sent_at: string | null
  report_sent_at: string | null
  extra: Record<string, string>
}

const COL_ICONS: Record<string, string> = {
  shift: '⏱',
  planned: '📋',
  completed: '',
  notes: '🔧',
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function mapRows(initialRows: RowWithProfile[], fallbackShift = '8:00-18:00'): LocalRow[] {
  return initialRows.map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    department_id: r.department_id,
    full_name: r.profile?.full_name?.trim() || 'Працівник',
    email: r.profile?.email || '',
    shift: r.shift || fallbackShift,
    planned: r.planned || '',
    completed: r.completed || '',
    notes: r.notes || '',
    plan_email_sent_at: r.plan_email_sent_at ?? null,
    plan_push_sent_at: r.plan_push_sent_at ?? null,
    report_sent_at: r.report_sent_at ?? null,
    extra: (r.extra as Record<string, string>) || {},
  }))
}

export default function TeamPlanBoard({
  team,
  date,
  planId,
  digestSentAt: initialDigestSentAt,
  digestReceipts: initialDigestReceipts,
  planDates,
  previousPlanDate,
  departments,
  columns,
  members,
  rows: initialRows,
  leaders: initialLeaders,
  isAdmin,
  isSubAdmin,
  canEditTasks,
  currentUserId,
  loggedInIds,
  hiddenFromPlanIds,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [sending, setSending] = useState(false)
  const [digestSending, setDigestSending] = useState(false)
  const [digestSentAt, setDigestSentAt] = useState(initialDigestSentAt)
  const [digestReceipts, setDigestReceipts] = useState<DigestReceipts>(initialDigestReceipts ?? {})
  const [msg, setMsg] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<LocalRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [digestOpen, setDigestOpen] = useState(false)
  const [employeeReportBusy, setEmployeeReportBusy] = useState(false)
  const [employeeReportSentAt, setEmployeeReportSentAt] = useState<string | null>(() => {
    const mine = initialRows.find(r => r.employee_id === currentUserId)
    return mine?.report_sent_at ?? null
  })
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [pickerMonth, setPickerMonth] = useState(date) // any day in visible month
  const [tasksLocked, setTasksLocked] = useState(!canEditTasks)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [activePlanId, setActivePlanId] = useState(planId)
  const dayStripRef = useRef<HTMLDivElement>(null)
  const datePickerRef = useRef<HTMLDivElement>(null)
  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localRowsRef = useRef<LocalRow[]>([])
  const flushSaveRef = useRef<() => Promise<boolean>>(async () => true)
  const savingRef = useRef(false)
  const aliveRef = useRef(true)
  const committedEmployeeRef = useRef<Map<string, { completed: string; notes: string }>>(new Map())
  const loggedIn = useMemo(() => new Set(loggedInIds), [loggedInIds])
  const hiddenSet = useMemo(() => new Set(hiddenFromPlanIds), [hiddenFromPlanIds])
  const defaultShift = team.default_shift?.trim() || '8:00-18:00'
  const showSendWorkers = team.show_send_worker_emails !== false
  const showSendLeadership = team.show_send_leadership !== false
  const allowEditTasks = canEditTasks && !tasksLocked

  useEffect(() => {
    const mine = initialRows.find(r => r.employee_id === currentUserId)
    setEmployeeReportSentAt(mine?.report_sent_at ?? null)
  }, [initialRows, currentUserId, date, team.id])

  useEffect(() => {
    if (datePickerOpen) setPickerMonth(date)
  }, [datePickerOpen, date])

  useEffect(() => {
    if (!datePickerOpen) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const root = datePickerRef.current
      if (!root) return
      if (e.target instanceof Node && !root.contains(e.target)) {
        setDatePickerOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDatePickerOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [datePickerOpen])

  const visibleCols = useMemo(
    () => columns.filter(c => !c.hidden).sort((a, b) => a.sort_order - b.sort_order),
    [columns]
  )

  const [localRows, setLocalRows] = useState<LocalRow[]>(() => mapRows(initialRows, defaultShift))

  localRowsRef.current = localRows

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    setActivePlanId(planId)
  }, [planId])

  // Keep digest stamp scoped to this team+date plan (do not leak across teams)
  useEffect(() => {
    setDigestSentAt(initialDigestSentAt)
    setDigestReceipts(initialDigestReceipts ?? {})
  }, [team.id, date, planId, initialDigestSentAt, initialDigestReceipts])

  useEffect(() => {
    if (!canEditTasks) setTasksLocked(true)
  }, [canEditTasks])

  const leaders = useMemo(() => {
    return initialLeaders.map(l => ({
      ...l,
      email_sent_at: digestReceipts[l.id]?.email ?? l.email_sent_at ?? null,
      push_sent_at: digestReceipts[l.id]?.push ?? l.push_sent_at ?? null,
    }))
  }, [initialLeaders, digestReceipts])

  // Sync from server when date changes or after refresh while clean
  const rowsSyncKey = `${date}:${planId}:${initialRows.map(r => r.id ?? r.employee_id).join(',')}`
  useEffect(() => {
    if (!dirtyRef.current) {
      setLocalRows(mapRows(initialRows, defaultShift))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync by fingerprint only
  }, [rowsSyncKey, defaultShift])

  const rowPayload = useCallback(() => {
    return localRowsRef.current.map(r => ({
      employee_id: r.employee_id,
      department_id: r.department_id,
      shift: r.shift,
      planned: r.planned,
      completed: r.completed,
      notes: r.notes,
      notify_email: false,
      notify_push: false,
      extra: r.extra,
    }))
  }, [])

  const flushSave = useCallback(async () => {
    if (!isAdmin || !dirtyRef.current) return true
    if (savingRef.current) return true
    savingRef.current = true
    if (aliveRef.current) setSaveStatus('saving')
    try {
      const res = await saveTeamPlan(team.id, date, rowPayload())
      if (!aliveRef.current) return !res.error
      if (res.error) {
        setSaveStatus('error')
        setMsg('Помилка збереження: ' + res.error)
        return false
      }
      dirtyRef.current = false
      setDirty(false)
      setSaveStatus('saved')
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      return true
    } finally {
      savingRef.current = false
    }
  }, [isAdmin, team.id, date, rowPayload])

  flushSaveRef.current = flushSave

  const scheduleBlurSave = useCallback(() => {
    if (blurSaveTimerRef.current) clearTimeout(blurSaveTimerRef.current)
    blurSaveTimerRef.current = setTimeout(() => {
      void flushSaveRef.current()
    }, 500)
  }, [])

  const markDirty = useCallback(() => {
    dirtyRef.current = true
    setDirty(true)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      void flushSaveRef.current()
    }, 30_000)
  }, [])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flushSaveRef.current()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
        void flushSaveRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (blurSaveTimerRef.current) clearTimeout(blurSaveTimerRef.current)
    }
  }, [])

  const hasAnyPlanned = localRows.some(r => r.planned.trim().length > 0)
  const hasAnyCompleted = localRows.some(r => r.completed.trim().length > 0)
  const canSendDigest = hasAnyPlanned || hasAnyCompleted
  const myRow = localRows.find(r => r.employee_id === currentUserId)
  const canSendMyReport = !!(myRow && myRow.completed.trim().length > 0)

  useEffect(() => {
    const el = dayStripRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
    if (el && dayStripRef.current) {
      const strip = dayStripRef.current
      const left = el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2
      strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
    }
  }, [date])

  const dateTabs = useMemo(() => {
    const today = todayISO()
    const set = new Set(planDates)
    return daysInMonth(date).map(d => ({
      date: d,
      hasPlan: set.has(d) || (d === date && !!activePlanId),
      isToday: d === today,
      isSelected: d === date,
    }))
  }, [date, planDates, activePlanId])

  const sections = useMemo(() => {
    const map = new Map<string, LocalRow[]>()
    for (const dept of departments) map.set(dept.id, [])
    map.set('__none__', [])
    for (const row of localRows) {
      const key = row.department_id && map.has(row.department_id) ? row.department_id : '__none__'
      map.get(key)!.push(row)
    }
    const result: { id: string; name: string; rows: LocalRow[] }[] = departments.map(d => ({
      id: d.id,
      name: d.name,
      rows: map.get(d.id) ?? [],
    }))
    const none = map.get('__none__') ?? []
    if (none.length > 0) result.push({ id: '__none__', name: 'Без відділу', rows: none })
    return result.filter(s => s.rows.length > 0)
  }, [localRows, departments])

  const availableToAdd = useMemo(() => {
    const inPlan = new Set(localRows.map(r => r.employee_id))
    return members.filter(m => !inPlan.has(m.user_id) && !hiddenSet.has(m.user_id))
  }, [members, localRows, hiddenSet])

  async function goToDate(d: string) {
    if (d === date) return
    await flushSave()
    router.push(`/teams/${team.id}/plans/${d}`)
  }

  function updateRow(employeeId: string, patch: Partial<LocalRow>) {
    setLocalRows(prev => prev.map(r => r.employee_id === employeeId ? { ...r, ...patch } : r))
    markDirty()
  }

  function setExtra(employeeId: string, key: string, value: string) {
    setLocalRows(prev => prev.map(r => {
      if (r.employee_id !== employeeId) return r
      return { ...r, extra: { ...r.extra, [key]: value } }
    }))
    markDirty()
  }

  function canEditField(field: string, row: LocalRow) {
    if (isAdmin) {
      if (!allowEditTasks && (field === 'planned' || field === 'shift' || field.startsWith('extra:'))) {
        return false
      }
      return true
    }
    if (row.employee_id !== currentUserId) return false
    return field === 'completed' || field === 'notes' || field.startsWith('extra:')
  }

  async function commitEmployeeField(row: LocalRow, field: 'completed' | 'notes', value: string) {
    if (!row.id || isAdmin) return
    const key = row.id
    const prev = committedEmployeeRef.current.get(key) ?? {
      completed: row.completed,
      notes: row.notes,
    }
    if (prev[field] === value) return
    const next = { ...prev, [field]: value }
    committedEmployeeRef.current.set(key, next)
    await updateTaskRowFields(row.id, { [field]: value })
  }

  function cellValue(row: LocalRow, col: TeamColumn): string {
    if (col.key === 'shift') return row.shift
    if (col.key === 'planned') return row.planned
    if (col.key === 'completed') return row.completed
    if (col.key === 'notes') return row.notes
    return row.extra[col.key] ?? ''
  }

  function onCellChange(row: LocalRow, col: TeamColumn, value: string) {
    if (col.key === 'shift') updateRow(row.employee_id, { shift: value })
    else if (col.key === 'planned') updateRow(row.employee_id, { planned: value })
    else if (col.key === 'completed') updateRow(row.employee_id, { completed: value })
    else if (col.key === 'notes') updateRow(row.employee_id, { notes: value })
    else setExtra(row.employee_id, col.key, value)
  }

  async function sendDigest(recipientIds: string[], channels: SendChannels, content: DigestContent) {
    if ((!hasAnyPlanned && !hasAnyCompleted) || recipientIds.length === 0) return
    setDigestSending(true)
    setMsg(null)
    try {
      const ok = await flushSave()
      if (!ok && dirtyRef.current) {
        setDigestSending(false)
        return
      }
      if (!activePlanId) await saveTeamPlan(team.id, date, rowPayload())

      const res = await fetch('/api/send-plan-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, date, recipientIds, channels, content }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setMsg('Помилка: ' + (json.error || `HTTP ${res.status}`))
      } else {
        setDigestSentAt(json.digest_sent_at ?? new Date().toISOString())
        if (json.digest_receipts) setDigestReceipts(json.digest_receipts as DigestReceipts)
        const parts: string[] = []
        if (json.emailSent) parts.push(`email: ${json.emailSent}`)
        if (json.pushSent) parts.push(`push: ${json.pushSent}`)
        setMsg(parts.length ? `План керівництву (${parts.join(', ')})` : 'План надіслано керівництву')
        setDigestOpen(false)
        router.refresh()
      }
    } catch {
      setMsg('Помилка мережі')
    }
    setDigestSending(false)
  }

  async function sendEmployeeLeadershipReport() {
    setEmployeeReportBusy(true)
    setMsg(null)
    try {
      if (isAdmin) await flushSave()
      else if (myRow?.id) {
        await updateTaskRowFields(myRow.id, {
          completed: myRow.completed,
          notes: myRow.notes,
        })
      }
      const res = await fetch('/api/send-employee-leadership-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, date }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setMsg('Помилка: ' + (json.error || `HTTP ${res.status}`))
      } else {
        const sentAt = (json.sent_at as string) || new Date().toISOString()
        setEmployeeReportSentAt(sentAt)
        setLocalRows(prev =>
          prev.map(r =>
            r.employee_id === currentUserId ? { ...r, report_sent_at: sentAt } : r
          )
        )
        const parts: string[] = []
        if (json.emailSent) parts.push(`email: ${json.emailSent}`)
        if (json.pushSent) parts.push(`push: ${json.pushSent}`)
        setMsg(parts.length ? `Звіт надіслано (${parts.join(', ')})` : 'Звіт надіслано')
      }
    } catch {
      setMsg('Помилка мережі')
    }
    setEmployeeReportBusy(false)
  }

  function copyFromPrevious() {
    setMsg(null)
    startTransition(async () => {
      const res = await copyPlanFromPreviousDay(team.id, date)
      if (res.error) {
        setMsg('Помилка: ' + res.error)
        return
      }
      if (res.planId) setActivePlanId(res.planId)
      setMsg(`Скопійовано з ${res.fromDate} (${res.count} осіб)`)
      dirtyRef.current = false
      setDirty(false)
      router.refresh()
    })
  }

  function removeEmployeeFromPlan(row: LocalRow) {
    setRemoveTarget(row)
  }

  async function confirmRemoveEmployee() {
    const row = removeTarget
    if (!row) return
    setMsg(null)
    setRemoveTarget(null)
    startTransition(async () => {
      await flushSave()
      if (row.id || activePlanId) {
        const res = await removePlanMember(team.id, date, row.employee_id)
        if (res.error) {
          setMsg('Помилка: ' + res.error)
          return
        }
      }
      setLocalRows(prev => prev.filter(r => r.employee_id !== row.employee_id))
      dirtyRef.current = false
      setDirty(false)
      router.refresh()
    })
  }

  const dateLabel = formatUkDate(date)
  const monthLabel = formatUkMonthYear(date)
  const shortDate = formatUkShortDate(date)
  const colCount = 1 + visibleCols.length

  const DEPT_STYLES = [
    { head: 'bg-emerald-100/90 text-emerald-950', row: 'bg-emerald-50/30' },
    { head: 'bg-sky-100/90 text-sky-950', row: 'bg-sky-50/30' },
    { head: 'bg-amber-100/90 text-amber-950', row: 'bg-amber-50/30' },
    { head: 'bg-violet-100/90 text-violet-950', row: 'bg-violet-50/30' },
    { head: 'bg-rose-100/90 text-rose-950', row: 'bg-rose-50/30' },
    { head: 'bg-teal-100/90 text-teal-950', row: 'bg-teal-50/30' },
  ] as const

  return (
    <div className={`mx-auto min-w-0 max-w-[1600px] ${isAdmin ? 'pb-24 sm:pb-0' : 'pb-28'}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{team.name}</h1>
          {isAdmin && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {saveStatus === 'saving' && 'Зберігається…'}
              {saveStatus === 'saved' && !dirty && 'Збережено'}
              {saveStatus === 'error' && 'Помилка збереження'}
              {dirty && saveStatus !== 'saving' && 'Є незбережені зміни'}
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="hidden flex-wrap gap-2 sm:flex">
            <button
              onClick={() => setAddOpen(true)}
              disabled={isPending}
              className="tap-btn rounded-lg border border-border bg-white/70 px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              Додати працівників
            </button>
            {showSendWorkers && (
              <button
                onClick={() => setSendOpen(true)}
                disabled={sending || !hasAnyPlanned || localRows.length === 0}
                title={!hasAnyPlanned ? 'Заповніть хоча б одне поле «Заплановано»' : 'Надіслати завдання працівникам'}
                className="tap-btn glass-send-btn inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                <SendEnvelopeIcon className="h-4 w-4" />
                Надіслати завдання
              </button>
            )}
            {showSendLeadership && (
              <button
                onClick={() => setDigestOpen(true)}
                disabled={digestSending || !canSendDigest}
                title="Надіслати зведення плану шефам і заступникам"
                className={`tap-btn flex min-h-[52px] min-w-[168px] flex-col items-center justify-center rounded-xl px-4 py-1.5 text-sm font-semibold leading-tight disabled:opacity-40 ${
                  digestSentAt
                    ? 'border border-green-300 bg-green-50 text-green-800'
                    : 'border border-primary/30 bg-primary/10 text-primary'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <SendEnvelopeIcon className="h-4 w-4" />
                  {digestSending
                    ? '...'
                    : digestSentAt
                      ? 'План керівництву ✓'
                      : 'План керівництву'}
                </span>
                <span className={`mt-0.5 text-[10px] font-normal ${digestSentAt ? 'text-green-700/80' : 'invisible'}`}>
                  {digestSentAt ? formatUkDateTime(digestSentAt) : '00.00.0000 00:00'}
                </span>
              </button>
            )}
            <button
              onClick={() => {
                if (!activePlanId && localRows.length === 0) {
                  setMsg('Спочатку додайте працівників')
                  return
                }
                setDeleteOpen(true)
              }}
              disabled={isPending}
              title="Видалити план на цю дату"
              className="tap-btn inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-40"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Видалити план
            </button>
          </div>
        )}
      </div>

      <div className="mb-4 min-w-0 rounded-xl border border-border/50 bg-white/50 p-2">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <p className="min-w-0 truncate text-sm font-semibold text-foreground">Плани на {monthLabel}</p>
          <div className="relative shrink-0" ref={datePickerRef}>
            <button
              type="button"
              onClick={() => setDatePickerOpen(v => !v)}
              aria-expanded={datePickerOpen}
              className="tap-btn inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground shadow-sm"
            >
              <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {shortDate}
            </button>
            {datePickerOpen && (
              <div
                className="absolute right-0 top-[calc(100%+0.35rem)] z-40 w-[min(18.5rem,calc(100vw-1.5rem))] rounded-xl border border-border/60 bg-white p-3 shadow-xl"
                style={{
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="tap-btn rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm font-semibold"
                    onClick={() => {
                      const [y, m] = pickerMonth.split('-').map(Number)
                      const dt = new Date(Date.UTC(y, m - 2, 1))
                      setPickerMonth(dt.toISOString().slice(0, 10))
                    }}
                  >
                    ‹
                  </button>
                  <p className="text-sm font-semibold text-foreground">{formatUkMonthYear(pickerMonth)}</p>
                  <button
                    type="button"
                    className="tap-btn rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm font-semibold"
                    onClick={() => {
                      const [y, m] = pickerMonth.split('-').map(Number)
                      const dt = new Date(Date.UTC(y, m, 1))
                      setPickerMonth(dt.toISOString().slice(0, 10))
                    }}
                  >
                    ›
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-muted-foreground">
                  {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'].map(d => (
                    <span key={d} className="py-1">{d}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {(() => {
                    const days = daysInMonth(pickerMonth)
                    if (days.length === 0) return null
                    const [y, m, d0] = days[0].split('-').map(Number)
                    const monFirstPad = (new Date(Date.UTC(y, m - 1, d0)).getUTCDay() + 6) % 7
                    const today = todayISO()
                    const cells: ReactNode[] = []
                    for (let i = 0; i < monFirstPad; i++) {
                      cells.push(<span key={`pad-${i}`} />)
                    }
                    for (const day of days) {
                      const dayNum = Number(day.slice(8, 10))
                      const selected = day === date
                      const isToday = day === today
                      cells.push(
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            setDatePickerOpen(false)
                            void goToDate(day)
                          }}
                          className={`tap-btn aspect-square rounded-lg text-sm font-semibold ${
                            selected
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : isToday
                                ? 'bg-primary/15 text-primary'
                                : 'text-foreground hover:bg-muted'
                          }`}
                        >
                          {dayNum}
                        </button>
                      )
                    }
                    return cells
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
        <div
          ref={dayStripRef}
          className="flex max-w-full gap-1 overflow-x-auto overscroll-x-contain pb-1 scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {dateTabs.map(tab => {
            const label = formatUkDayTab(tab.date)
            return (
              <button
                key={tab.date}
                type="button"
                data-selected={tab.isSelected ? 'true' : undefined}
                onClick={() => void goToDate(tab.date)}
                className={`tap-btn flex min-w-[48px] shrink-0 flex-col items-center rounded-lg px-2 py-1.5 text-center transition ${
                  tab.isSelected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : tab.hasPlan
                      ? 'bg-primary/10 text-foreground hover:bg-primary/15'
                      : tab.isToday
                        ? 'bg-muted/60 text-foreground'
                        : 'border border-border/60 text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="text-[10px] uppercase opacity-80">{label.weekday}</span>
                <span className="text-sm font-semibold leading-tight">{label.day}</span>
                {(tab.isToday || tab.hasPlan) && !tab.isSelected && (
                  <span className="mt-0.5 h-1 w-1 rounded-full bg-primary/60" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {msg && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.startsWith('Помилка') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
          {msg}
        </p>
      )}

      {isAdmin && localRows.length === 0 && previousPlanDate && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Скопіювати з попереднього дня?</p>
            <p className="text-xs text-muted-foreground">
              Працівники та їхні завдання з {formatUkShortDate(previousPlanDate)}. Виконано не копіюється.
            </p>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={copyFromPrevious}
            className="tap-btn rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Скопіювати план
          </button>
        </div>
      )}

      <div className="glass-card hidden sm:block">
        {/* No overflow wrapper — sticky thead needs the viewport as scrollport */}
        <table className="w-full min-w-[900px] table-auto text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-muted-foreground">
                <th className="plan-table-sticky-th w-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-muted-foreground">
                  Працівник
                </th>
                {visibleCols.map(c => (
                  <th
                    key={c.id}
                    className={`plan-table-sticky-th px-3 py-2.5 text-sm font-medium text-muted-foreground ${
                      c.key === 'planned' || c.key === 'completed' || c.key === 'notes'
                        ? 'min-w-[240px] w-[28%]'
                        : c.key === 'shift'
                          ? 'w-0 whitespace-nowrap'
                          : 'min-w-[140px]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {COL_ICONS[c.key] ? <span>{COL_ICONS[c.key]}</span> : null}
                      {c.label}
                      {c.key === 'planned' && isSubAdmin && (
                        <button
                          type="button"
                          title={
                            !canEditTasks
                              ? 'Редагування завдань вимкнено в налаштуваннях'
                              : tasksLocked
                                ? 'Розблокувати редагування завдань'
                                : 'Заблокувати редагування завдань'
                          }
                          disabled={!canEditTasks}
                          onClick={() => setTasksLocked(v => !v)}
                          className={`tap-btn rounded-md p-1 ${
                            tasksLocked || !canEditTasks
                              ? 'bg-amber-100 text-amber-800'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          } disabled:opacity-60`}
                        >
                          {tasksLocked || !canEditTasks ? (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                          ) : (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((section, sectionIdx) => {
                const style = DEPT_STYLES[sectionIdx % DEPT_STYLES.length]
                return (
                <Fragment key={section.id}>
                  <tr>
                    <td colSpan={colCount} className="px-2 pt-3 pb-1">
                      <div className={`rounded-lg px-3 py-2 text-xs font-bold tracking-wide ${style.head}`}>
                        відділ: {section.name}
                      </div>
                    </td>
                  </tr>
                  {section.rows.map((row, rowIdx) => {
                    const notLoggedIn = isAdmin && !loggedIn.has(row.employee_id)
                    return (
                      <tr
                        key={row.employee_id}
                        className={`align-top ${style.row} ${
                          notLoggedIn ? 'bg-amber-50/70' : ''
                        } ${rowIdx < section.rows.length - 1 ? 'border-b border-border/55' : 'border-b border-border/25'}`}
                      >
                        <td className="w-0 whitespace-nowrap px-3 py-2">
                          <RowIdentity
                            row={row}
                            isAdmin={isAdmin}
                            notLoggedIn={notLoggedIn}
                            onRemove={isAdmin ? () => removeEmployeeFromPlan(row) : undefined}
                            removeDisabled={isPending}
                          />
                        </td>
                        {visibleCols.map(c => (
                          <td
                            key={c.id}
                            className={`px-1 py-2 ${
                              c.key === 'planned' || c.key === 'completed' || c.key === 'notes'
                                ? 'w-[28%]'
                                : c.key === 'shift'
                                  ? 'w-0 whitespace-nowrap'
                                  : ''
                            }`}
                          >
                            <PlanField
                              col={c}
                              isAdmin={isAdmin}
                              canEdit={canEditField(c.is_system ? c.key : `extra:${c.key}`, row)}
                              value={cellValue(row, c)}
                              onChange={v => onCellChange(row, c, v)}
                              onBlurAdmin={() => { scheduleBlurSave() }}
                              onBlurEmployee={v => {
                                if (row.id && (c.key === 'completed' || c.key === 'notes')) {
                                  void commitEmployeeField(row, c.key as 'completed' | 'notes', v)
                                }
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </Fragment>
                )
              })}
              {localRows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {isAdmin ? 'Натисніть «Додати працівників», щоб заповнити план' : 'План ще порожній'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
      </div>

      {/* Mobile: unified list with department separators */}
      <div className="glass-card overflow-hidden sm:hidden">
        {localRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {isAdmin ? 'Натисніть «Додати», щоб заповнити план' : 'План ще порожній'}
          </div>
        ) : (
          sections.map((section, sectionIdx) => {
            const style = DEPT_STYLES[sectionIdx % DEPT_STYLES.length]
            return (
              <div key={section.id}>
                <div className={`px-3 py-2 text-xs font-bold tracking-wide ${style.head}`}>
                  відділ: {section.name}
                </div>
                {section.rows.map((row, rowIdx) => {
                  const notLoggedIn = isAdmin && !loggedIn.has(row.employee_id)
                  const showLockOnPlanned = isSubAdmin && sectionIdx === 0 && rowIdx === 0
                  return (
                    <div
                      key={row.employee_id}
                      className={`px-4 pt-3.5 pb-7 ${style.row} ${
                        rowIdx < section.rows.length - 1 ? 'border-b-2 border-border/45' : ''
                      } ${notLoggedIn ? 'bg-amber-50/70' : ''}`}
                    >
                      <div className="mb-3">
                        <RowIdentity
                          row={row}
                          isAdmin={isAdmin}
                          notLoggedIn={notLoggedIn}
                          onRemove={isAdmin ? () => removeEmployeeFromPlan(row) : undefined}
                          removeDisabled={isPending}
                        />
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {visibleCols.map(c => {
                          const val = cellValue(row, c)
                          if (c.key === 'shift' && !isAdmin) {
                            return (
                              <div key={c.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base">
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {COL_ICONS[c.key] ? <span className="mr-1 normal-case">{COL_ICONS[c.key]}</span> : null}
                                  {c.label}
                                </span>
                                <span className="font-semibold text-foreground">{val.trim() || '—'}</span>
                              </div>
                            )
                          }
                          return (
                          <div key={c.id} className="flex flex-col gap-1">
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {COL_ICONS[c.key] ? <span className="normal-case">{COL_ICONS[c.key]}</span> : null}
                              {c.label}
                              {c.key === 'planned' && showLockOnPlanned && (
                                <button
                                  type="button"
                                  title={
                                    !canEditTasks
                                      ? 'Редагування завдань вимкнено в налаштуваннях'
                                      : tasksLocked
                                        ? 'Розблокувати редагування завдань'
                                        : 'Заблокувати редагування завдань'
                                  }
                                  disabled={!canEditTasks}
                                  onClick={() => setTasksLocked(v => !v)}
                                  className={`tap-btn rounded-md p-1 normal-case ${
                                    tasksLocked || !canEditTasks
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                  } disabled:opacity-60`}
                                >
                                  {tasksLocked || !canEditTasks ? (
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                  ) : (
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                    </svg>
                                  )}
                                </button>
                              )}
                            </label>
                            <PlanField
                              col={c}
                              isAdmin={isAdmin}
                              canEdit={canEditField(c.is_system ? c.key : `extra:${c.key}`, row)}
                              value={val}
                              onChange={v => onCellChange(row, c, v)}
                              onBlurAdmin={() => { scheduleBlurSave() }}
                              onBlurEmployee={v => {
                                if (row.id && (c.key === 'completed' || c.key === 'notes')) {
                                  void commitEmployeeField(row, c.key as 'completed' | 'notes', v)
                                }
                              }}
                              compact
                            />
                          </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      <AddWorkersModal
        open={addOpen}
        members={availableToAdd}
        busy={isPending}
        onClose={() => setAddOpen(false)}
        onAdd={ids => {
          setMsg(null)
          startTransition(async () => {
            await flushSave()
            const res = await addPlanMembers(team.id, date, ids)
            setAddOpen(false)
            if (res.error) {
              setMsg('Помилка: ' + res.error)
              return
            }
            if (res.planId) setActivePlanId(res.planId)
            const addedSet = new Set(res.addedIds ?? ids)
            const toAdd: LocalRow[] = members
              .filter(m => addedSet.has(m.user_id))
              .map(m => ({
                employee_id: m.user_id,
                department_id: m.department_id,
                full_name: m.profile?.full_name?.trim() || 'Працівник',
                email: m.profile?.email || '',
                shift: defaultShift,
                planned: '',
                completed: '',
                notes: '',
                plan_email_sent_at: null,
                plan_push_sent_at: null,
                report_sent_at: null,
                extra: {},
              }))
            setLocalRows(prev => {
              const have = new Set(prev.map(r => r.employee_id))
              return [...prev, ...toAdd.filter(r => !have.has(r.employee_id))]
            })
            setMsg('Працівників додано')
            router.refresh()
          })
        }}
      />

      <SendTasksModal
        open={sendOpen}
        rows={localRows}
        busy={sending}
        onClose={() => setSendOpen(false)}
        onSend={async (selectedIds, channels) => {
          setSending(true)
          setMsg(null)
          try {
            await flushSave()
            await saveTeamPlan(team.id, date, rowPayload())
            const selected = localRows.filter(r => selectedIds.includes(r.employee_id))
            const res = await fetch('/api/send-plans', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                teamId: team.id,
                date,
                channels,
                rows: selected.map(r => ({
                  employee_id: r.employee_id,
                  email: r.email,
                  full_name: r.full_name,
                  planned: r.planned,
                })),
              }),
            })
            const json = await res.json()
            if (json.error) setMsg('Помилка: ' + json.error)
            else {
              const emailStamp = json.plan_email_sent_at as string | null | undefined
              const pushStamp = json.plan_push_sent_at as string | null | undefined
              const emailed = new Set((json.emailedIds as string[]) ?? [])
              const pushed = new Set((json.pushedIds as string[]) ?? [])
              setLocalRows(prev => prev.map(r => ({
                ...r,
                plan_email_sent_at: emailed.has(r.employee_id) && emailStamp
                  ? emailStamp
                  : r.plan_email_sent_at,
                plan_push_sent_at: pushed.has(r.employee_id) && pushStamp
                  ? pushStamp
                  : r.plan_push_sent_at,
              })))
              const parts: string[] = []
              if (json.emailSent) parts.push(`email: ${json.emailSent}`)
              if (json.pushSent) parts.push(`push: ${json.pushSent}`)
              setMsg(parts.length ? `Відправлено (${parts.join(', ')})` : `Відправлено ${json.sent ?? 0}`)
              setSendOpen(false)
              router.refresh()
            }
          } catch {
            setMsg('Помилка мережі')
          }
          setSending(false)
        }}
      />

      <DigestModal
        open={digestOpen}
        leaders={leaders}
        busy={digestSending}
        onClose={() => setDigestOpen(false)}
        onSend={(ids, channels, content) => { void sendDigest(ids, channels, content) }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Видалити план?"
        description={`Дійсно видалити план команди «${team.name}» на ${dateLabel}? Усі рядки завдань буде втрачено.`}
        confirmLabel="Видалити план"
        busy={isPending}
        onConfirm={() => {
          setMsg(null)
          startTransition(async () => {
            const res = await deleteDayPlan(team.id, date)
            setDeleteOpen(false)
            if (res.error) setMsg('Помилка: ' + res.error)
            else {
              setMsg('План видалено')
              router.push('/admin')
              router.refresh()
            }
          })
        }}
        onCancel={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={!!removeTarget}
        title="Прибрати з плану?"
        description={
          removeTarget
            ? `Прибрати «${removeTarget.full_name}» з плану на цей день? З команди людина не видаляється.`
            : ''
        }
        confirmLabel="Прибрати"
        busy={isPending}
        onConfirm={() => { void confirmRemoveEmployee() }}
        onCancel={() => setRemoveTarget(null)}
      />

      {isAdmin && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-3 sm:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="boty-glass mx-auto flex max-w-[1600px] items-stretch justify-around gap-0.5 rounded-lg px-1.5 py-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              disabled={isPending}
              className="tap-btn flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium text-foreground disabled:opacity-40"
              title="Додати працівників"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-foreground shadow-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </span>
              Додати
            </button>
            {showSendWorkers && (
              <button
                type="button"
                onClick={() => setSendOpen(true)}
                disabled={sending || !hasAnyPlanned || localRows.length === 0}
                className="tap-btn flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-semibold text-primary disabled:opacity-40"
                title="Надіслати завдання"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <SendEnvelopeIcon className="h-5 w-5" />
                </span>
                Завдання
              </button>
            )}
            {showSendLeadership && (
              <button
                type="button"
                onClick={() => setDigestOpen(true)}
                disabled={digestSending || !canSendDigest}
                className={`tap-btn flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-semibold disabled:opacity-40 ${
                  digestSentAt ? 'text-green-700' : 'text-primary'
                }`}
                title="План керівництву"
              >
                <span className={`relative flex h-9 w-9 items-center justify-center rounded-full shadow-sm ${
                  digestSentAt ? 'bg-green-100 text-green-800' : 'bg-primary/15 text-primary'
                }`}>
                  <SendEnvelopeIcon className="h-5 w-5" />
                  {digestSentAt && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-600 text-[8px] text-white">✓</span>
                  )}
                </span>
                Керівництву
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (!activePlanId && localRows.length === 0) {
                  setMsg('Спочатку додайте працівників')
                  return
                }
                setDeleteOpen(true)
              }}
              disabled={isPending}
              className="tap-btn flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium text-red-500 disabled:opacity-40"
              title="Видалити план"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50/90 text-red-500 shadow-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </span>
              Видалити
            </button>
          </div>
        </div>
      )}

      {!isAdmin && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="boty-glass mx-auto flex max-w-[1600px] justify-center rounded-lg px-1.5 py-2">
            <button
              type="button"
              onClick={() => { void sendEmployeeLeadershipReport() }}
              disabled={employeeReportBusy || !canSendMyReport}
              title={canSendMyReport ? 'Надіслати свій звіт керівництву' : 'Спочатку заповніть «Виконано»'}
              className={`tap-btn flex flex-col items-center gap-0.5 rounded-lg px-6 py-1 text-[10px] font-semibold disabled:opacity-40 ${
                employeeReportSentAt ? 'text-green-700' : 'text-primary'
              }`}
            >
              <span className={`relative flex h-9 w-9 items-center justify-center rounded-full shadow-sm ${
                employeeReportSentAt ? 'bg-green-100 text-green-800' : 'bg-primary text-primary-foreground'
              }`}>
                <SendEnvelopeIcon className="h-5 w-5" />
                {employeeReportSentAt && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-600 text-[8px] text-white">✓</span>
                )}
              </span>
              Звіт керівництву
              <span className={`text-[9px] font-normal ${employeeReportSentAt ? 'text-green-700/90' : 'invisible'}`}>
                {employeeReportSentAt ? formatUkDateTime(employeeReportSentAt) : '00.00.0000 00:00'}
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
      {/* envelope */}
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5l6.8 4.25a2 2 0 002.1 0L19.7 8.5" />
      <rect x="3" y="6" width="14.5" height="12" rx="1.5" />
      {/* send arrow */}
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.5h4.5v4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 4.5l-6 6" />
    </svg>
  )
}

function RowIdentity({
  row,
  isAdmin,
  notLoggedIn,
  onRemove,
  removeDisabled,
}: {
  row: LocalRow
  isAdmin: boolean
  notLoggedIn: boolean
  onRemove?: () => void
  removeDisabled?: boolean
}) {
  return (
    <div className="flex w-max items-start gap-2">
      {onRemove && (
        <button
          type="button"
          title="Прибрати з плану на цей день"
          disabled={removeDisabled}
          onClick={onRemove}
          className="tap-btn shrink-0 rounded-lg bg-red-50/90 p-1.5 text-red-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-40"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      )}
      <div>
        <div className="whitespace-nowrap text-[15px] font-semibold leading-tight text-foreground">
          {row.full_name}
        </div>
        {isAdmin && (
          <div className="whitespace-nowrap text-xs text-muted-foreground">{row.email}</div>
        )}
        {isAdmin && row.plan_email_sent_at && (
          <div className="mt-1 flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-green-700">
            <span title="Email надіслано">✉✓</span>
            <span>{formatUkShortDate(row.plan_email_sent_at)}</span>
          </div>
        )}
        {isAdmin && notLoggedIn && (
          <div className="mt-0.5 whitespace-nowrap text-[10px] font-medium text-amber-700/90">ще не входив</div>
        )}
      </div>
    </div>
  )
}

function PlanField({
  col,
  isAdmin,
  canEdit,
  value,
  onChange,
  onBlurAdmin,
  onBlurEmployee,
  compact,
}: {
  row?: LocalRow
  col: TeamColumn
  isAdmin: boolean
  canEdit: boolean
  value: string
  onChange: (v: string) => void
  onBlurAdmin: () => void
  onBlurEmployee: (v: string) => void
  compact?: boolean
}) {
  const isTextArea = col.key === 'planned' || col.key === 'completed' || col.key === 'notes' || !col.is_system
  const isShift = col.key === 'shift'
  const fieldTone =
    col.key === 'planned'
      ? 'border-sky-300/80 bg-sky-50/70'
      : col.key === 'completed'
        ? value.trim()
          ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
          : 'border-emerald-200/80 bg-emerald-50/40'
        : 'border-input bg-white/60'
  const plannedAsText = col.key === 'planned' && !isAdmin
  const minW = compact || isShift ? '' : 'min-w-[180px]'

  if (plannedAsText) {
    return (
      <div className={`min-h-[40px] w-full whitespace-pre-wrap rounded-[0.3rem] border border-sky-200/70 bg-sky-50/50 px-2.5 py-2 text-base leading-snug text-foreground ${minW}`}>
        {value.trim() || '—'}
      </div>
    )
  }

  if (isTextArea) {
    return (
      <AutoGrowTextarea
        value={value}
        disabled={!canEdit}
        onChange={onChange}
        onBlur={v => {
          if (isAdmin) onBlurAdmin()
          else onBlurEmployee(v)
        }}
        className={`w-full resize-none overflow-hidden rounded-[0.3rem] border px-2.5 py-2 text-base leading-snug disabled:opacity-60 ${minW} ${fieldTone}`}
      />
    )
  }

  if (isShift) {
    if (!isAdmin || !canEdit) {
      return (
        <span className="inline-block whitespace-nowrap text-base font-semibold leading-snug text-foreground">
          {value.trim() || '—'}
        </span>
      )
    }
    const shiftChars = Math.max(value.length, 9)
    return (
      <input
        value={value}
        disabled={!canEdit}
        size={shiftChars}
        onChange={e => onChange(e.target.value)}
        onBlur={() => { if (isAdmin) onBlurAdmin() }}
        className="w-auto max-w-none whitespace-nowrap rounded-[0.3rem] border border-input bg-white/60 px-2.5 py-2 text-base disabled:opacity-60 [field-sizing:content]"
      />
    )
  }

  return (
    <input
      value={value}
      disabled={!canEdit}
      onChange={e => onChange(e.target.value)}
      onBlur={() => { if (isAdmin) onBlurAdmin() }}
      className={`w-full rounded-[0.3rem] border border-input bg-white/60 px-2.5 py-2 text-base disabled:opacity-60 ${minW}`}
    />
  )
}

function AutoGrowTextarea({
  value,
  disabled,
  onChange,
  onBlur,
  className,
}: {
  value: string
  disabled?: boolean
  onChange: (v: string) => void
  onBlur?: (v: string) => void
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(40, el.scrollHeight)}px`
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      rows={1}
      onChange={e => {
        onChange(e.target.value)
        requestAnimationFrame(resize)
      }}
      onBlur={e => onBlur?.(e.target.value)}
      className={className}
    />
  )
}

function AddWorkersModal({
  open,
  members,
  busy,
  onClose,
  onAdd,
}: {
  open: boolean
  members: Member[]
  busy: boolean
  onClose: () => void
  onAdd: (ids: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setSelected(new Set(members.map(m => m.user_id)))
  }, [open, members])

  return (
    <Modal open={open} onClose={onClose} title="Додати працівників" description="Оберіть кого додати в план на цей день">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Усі члени команди вже в плані (або приховані з плану).</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              className="tap-btn text-xs font-medium text-primary"
              onClick={() => setSelected(new Set(members.map(m => m.user_id)))}
            >
              Виділити всіх
            </button>
            <button
              type="button"
              className="tap-btn text-xs text-muted-foreground"
              onClick={() => setSelected(new Set())}
            >
              Зняти всі
            </button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {members.map(m => (
              <li key={m.user_id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={selected.has(m.user_id)}
                    onChange={e => {
                      setSelected(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(m.user_id)
                        else next.delete(m.user_id)
                        return next
                      })
                    }}
                  />
                  <span className="font-medium">{m.profile?.full_name || '—'}</span>
                  <span className="text-xs text-muted-foreground">{m.profile?.email}</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => onAdd([...selected])}
            className="tap-btn rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Додати вибраних ({selected.size})
          </button>
        </div>
      )}
    </Modal>
  )
}

function SelectAllBar({
  onSelectAll,
  onClear,
}: {
  onSelectAll: () => void
  onClear: () => void
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onSelectAll}
        className="tap-btn inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Усі
      </button>
      <button
        type="button"
        onClick={onClear}
        className="tap-btn inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        Жодного
      </button>
    </div>
  )
}

function ChannelStamps({
  emailAt,
  pushAt,
}: {
  emailAt?: string | null
  pushAt?: string | null
}) {
  if (!emailAt && !pushAt) return null
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-[10px] leading-tight">
      {emailAt && (
        <span className="text-sky-700">Email · {formatUkDateTime(emailAt)}</span>
      )}
      {pushAt && (
        <span className="text-violet-700">Push · {formatUkDateTime(pushAt)}</span>
      )}
    </div>
  )
}

function SendChannelButtons({
  busy,
  disabled,
  onSend,
}: {
  busy: boolean
  disabled: boolean
  onSend: (channels: SendChannels) => void
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => onSend('email')}
        className="tap-btn flex-1 rounded-lg border border-border bg-white/80 px-3 py-2.5 text-sm font-medium text-foreground disabled:opacity-40"
      >
        {busy ? '…' : 'Надіслати email'}
      </button>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => onSend('push')}
        className="tap-btn flex-1 rounded-lg border border-border bg-white/80 px-3 py-2.5 text-sm font-medium text-foreground disabled:opacity-40"
      >
        {busy ? '…' : 'Надіслати push'}
      </button>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => onSend('all')}
        className="tap-btn flex-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
      >
        {busy ? 'Надсилаємо…' : 'Надіслати все'}
      </button>
    </div>
  )
}

function SendTasksModal({
  open,
  rows,
  busy,
  onClose,
  onSend,
}: {
  open: boolean
  rows: LocalRow[]
  busy: boolean
  onClose: () => void
  onSend: (ids: string[], channels: SendChannels) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setSelected(new Set(rows.map(r => r.employee_id)))
  }, [open, rows])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Надіслати завдання"
      description="Оберіть працівників і спосіб: email, push або обидва"
    >
      <div className="flex flex-col gap-3">
        <SelectAllBar
          onSelectAll={() => setSelected(new Set(rows.map(r => r.employee_id)))}
          onClear={() => setSelected(new Set())}
        />
        <ul className="modal-list-scroll max-h-72 space-y-1 pr-1">
          {rows.map(r => (
            <li key={r.employee_id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="mt-1 accent-primary"
                  checked={selected.has(r.employee_id)}
                  onChange={e => {
                    setSelected(prev => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(r.employee_id)
                      else next.delete(r.employee_id)
                      return next
                    })
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.full_name}</span>
                  <span className="block text-xs text-muted-foreground">{r.email || 'без email'}</span>
                  <ChannelStamps emailAt={r.plan_email_sent_at} pushAt={r.plan_push_sent_at} />
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Вибрано: {selected.size}. Email — лише з адресою і планом; push — з підпискою.
        </p>
        <SendChannelButtons
          busy={busy}
          disabled={selected.size === 0}
          onSend={channels => onSend([...selected], channels)}
        />
      </div>
    </Modal>
  )
}

function DigestModal({
  open,
  leaders,
  busy,
  onClose,
  onSend,
}: {
  open: boolean
  leaders: Leader[]
  busy: boolean
  onClose: () => void
  onSend: (ids: string[], channels: SendChannels, content: DigestContent) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [content, setContent] = useState<DigestContent>('full')

  useEffect(() => {
    if (open) {
      setSelected(new Set())
      setContent('full')
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="План керівництву"
      description="Оберіть отримувачів, зміст і спосіб відправки"
    >
      {leaders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Немає отримувачів серед шефів і заступників.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Що надіслати</p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'full' as const, label: 'Всю таблицю' },
                  { id: 'planned' as const, label: 'Тільки завдання' },
                  { id: 'completed' as const, label: 'Тільки виконано' },
                ]
              ).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setContent(opt.id)}
                  className={`tap-btn rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    content === opt.id
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-white/80 text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <SelectAllBar
            onSelectAll={() => setSelected(new Set(leaders.map(l => l.id)))}
            onClear={() => setSelected(new Set())}
          />
          <ul className="modal-list-scroll max-h-72 space-y-1 pr-1">
            {leaders.map(l => (
              <li key={l.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="mt-1 accent-primary"
                    checked={selected.has(l.id)}
                    onChange={e => {
                      setSelected(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(l.id)
                        else next.delete(l.id)
                        return next
                      })
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{l.full_name}</span>
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({l.role === 'super_admin' ? 'Шеф' : 'Заступник'})
                    </span>
                    <span className="block text-xs text-muted-foreground">{l.email || 'без email'}</span>
                    <ChannelStamps emailAt={l.email_sent_at} pushAt={l.push_sent_at} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">Вибрано: {selected.size}</p>
          <SendChannelButtons
            busy={busy}
            disabled={selected.size === 0}
            onSend={channels => onSend([...selected], channels, content)}
          />
        </div>
      )}
    </Modal>
  )
}
