'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Department, Profile, TaskRow, Team, TeamColumn } from '@/lib/types'
import { addPlanMembers, copyPlanFromPreviousDay, deleteDayPlan, removePlanMember, saveTeamPlan, setTeamPlanTasksLocked, updateTaskRowFields } from '@/app/actions/plans'
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
import UserAvatar, { PushStatusBell } from '@/components/user-avatar'
import { useToast } from '@/components/toast-provider'
import { usePlanChromeLock } from '@/components/plan-chrome-lock'
import { createClient } from '@/lib/supabase/client'

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
  avatar_url?: string | null
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
  pushActiveIds: string[]
  /** Dates where this employee already has a task_row (employees only) */
  memberPlanDates?: string[]
}

interface LocalRow {
  id?: string
  employee_id: string
  department_id: string | null
  full_name: string
  email: string
  avatar_url?: string | null
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
    avatar_url: r.profile?.avatar_url ?? null,
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
  pushActiveIds,
  memberPlanDates = [],
}: Props) {
  const router = useRouter()
  const toast = useToast()
  const { chromeBlocked, setChromeBlocked } = usePlanChromeLock()
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
  const [tasksLocked, setTasksLocked] = useState(() => team.plan_tasks_locked !== false)
  const [lockBusy, setLockBusy] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [activePlanId, setActivePlanId] = useState(planId)
  const dayStripRef = useRef<HTMLDivElement>(null)
  const monthBarRef = useRef<HTMLDivElement>(null)
  const monthBarSentinelRef = useRef<HTMLDivElement>(null)
  const datePickerRef = useRef<HTMLDivElement>(null)
  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [monthBarStuck, setMonthBarStuck] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localRowsRef = useRef<LocalRow[]>([])
  const flushSaveRef = useRef<() => Promise<boolean>>(async () => true)
  const savingRef = useRef(false)
  const aliveRef = useRef(true)
  const committedEmployeeRef = useRef<Map<string, { completed: string; notes: string }>>(new Map())
  const loggedIn = useMemo(() => new Set(loggedInIds), [loggedInIds])
  const hiddenSet = useMemo(() => new Set(hiddenFromPlanIds), [hiddenFromPlanIds])
  const pushActive = useMemo(() => new Set(pushActiveIds), [pushActiveIds])
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
    setTasksLocked(team.plan_tasks_locked !== false)
  }, [team.id, team.plan_tasks_locked])

  useEffect(() => {
    const el = monthBarRef.current
    if (!el) return
    const sync = () => {
      document.documentElement.style.setProperty('--plan-month-bar-offset', `${el.offsetHeight}px`)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--plan-month-bar-offset')
    }
  }, [])

  useEffect(() => {
    const sentinel = monthBarSentinelRef.current
    if (!sentinel) return

    let observer: IntersectionObserver | null = null

    const attach = () => {
      observer?.disconnect()
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--app-header-offset')
        .trim()
      const headerPx = Number.parseFloat(raw) || 0
      observer = new IntersectionObserver(
        ([entry]) => setMonthBarStuck(!entry.isIntersecting),
        {
          threshold: 0,
          rootMargin: `-${headerPx}px 0px 0px 0px`,
        }
      )
      observer.observe(sentinel)
    }

    attach()
    const onResize = () => attach()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [])

  // Live lock sync for admins only (boss + deputies)
  useEffect(() => {
    if (!isAdmin) return
    const supabase = createClient()
    const channel = supabase
      .channel(`team-lock:${team.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'teams',
          filter: `id=eq.${team.id}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const next = payload.new?.plan_tasks_locked !== false
          setTasksLocked(prev => {
            if (prev === next) return prev
            queueMicrotask(() => {
              toast.info(next ? 'План заблоковано' : 'План розблоковано')
            })
            return next
          })
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isAdmin, team.id, toast])

  useEffect(() => {
    return () => setChromeBlocked(false)
  }, [setChromeBlocked])

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
        toast.error(res.error)
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
  }, [isAdmin, team.id, date, rowPayload, toast])

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

  const memberDateSet = useMemo(() => new Set(memberPlanDates), [memberPlanDates])

  const dateTabs = useMemo(() => {
    const today = todayISO()
    const set = new Set(planDates)
    const days = daysInMonth(date)
    const list = !isAdmin && memberPlanDates.length > 0
      ? days.filter(d => memberDateSet.has(d))
      : days
    return list.map(d => ({
      date: d,
      hasPlan: set.has(d) || (d === date && !!activePlanId),
      isToday: d === today,
      isSelected: d === date,
      allowed: isAdmin || memberDateSet.has(d),
    }))
  }, [date, planDates, activePlanId, isAdmin, memberPlanDates, memberDateSet])

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
    if (!isAdmin && memberPlanDates.length > 0 && !memberDateSet.has(d)) return
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
    const res = await updateTaskRowFields(row.id, { [field]: value })
    if (res.error) {
      committedEmployeeRef.current.set(key, prev)
      toast.error(res.error)
    }
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
        toast.error(json.error || `HTTP ${res.status}`)
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
      toast.error('Немає звʼязку з сервером')
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
        toast.error(json.error || `HTTP ${res.status}`)
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
      toast.error('Немає звʼязку з сервером')
    }
    setEmployeeReportBusy(false)
  }

  function copyFromPrevious() {
    setMsg(null)
    startTransition(async () => {
      const res = await copyPlanFromPreviousDay(team.id, date)
      if (res.error) {
        toast.error(res.error)
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
          toast.error(res.error)
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
    { head: 'bg-emerald-100/90 text-emerald-950', row: 'bg-emerald-50/30', identity: 'bg-emerald-100/45' },
    { head: 'bg-sky-100/90 text-sky-950', row: 'bg-sky-50/30', identity: 'bg-sky-100/45' },
    { head: 'bg-amber-100/90 text-amber-950', row: 'bg-amber-50/30', identity: 'bg-amber-100/45' },
    { head: 'bg-violet-100/90 text-violet-950', row: 'bg-violet-50/30', identity: 'bg-violet-100/45' },
    { head: 'bg-rose-100/90 text-rose-950', row: 'bg-rose-50/30', identity: 'bg-rose-100/45' },
    { head: 'bg-teal-100/90 text-teal-950', row: 'bg-teal-50/30', identity: 'bg-teal-100/45' },
  ] as const

  return (
    <div className={`mx-auto min-w-0 max-w-[1600px] ${isAdmin ? 'pb-24 sm:pb-0' : 'pb-28'}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{team.name}</h1>
          </div>
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
              disabled={isPending || chromeBlocked}
              title={chromeBlocked ? 'Спочатку розблокуйте план' : 'Видалити план на цю дату'}
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

      <div
        ref={monthBarSentinelRef}
        className="pointer-events-none h-px w-full"
        aria-hidden
      />
      <div
        ref={monthBarRef}
        className="plan-month-sticky -mx-3 mb-2 px-3 sm:-mx-4 sm:px-4"
      >
        <div
          className={`boty-glass flex items-center justify-between gap-2 border border-border/50 px-3 py-2 transition-[border-radius] duration-150 ${
            monthBarStuck ? 'rounded-t-none rounded-b-lg' : 'rounded-lg'
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="min-w-0 truncate text-sm font-semibold text-foreground">Плани на {monthLabel}</p>
            {isAdmin && canEditTasks && (
              <button
                type="button"
                title={
                  tasksLocked
                    ? 'Розблокувати редагування завдань'
                    : 'Заблокувати редагування завдань'
                }
                disabled={lockBusy}
                onClick={() => {
                  if (lockBusy) return
                  const next = !tasksLocked
                  setTasksLocked(next)
                  if (isSubAdmin) setChromeBlocked(next)
                  setLockBusy(true)
                  void setTeamPlanTasksLocked(team.id, next).then(res => {
                    setLockBusy(false)
                    if (res.error) {
                      setTasksLocked(!next)
                      if (isSubAdmin) setChromeBlocked(!next)
                      toast.error(res.error)
                    }
                  })
                }}
                className={`tap-btn shrink-0 rounded-lg p-1.5 ${
                  tasksLocked
                    ? 'bg-amber-100 text-amber-800'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                } disabled:opacity-60`}
              >
                {tasksLocked ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            )}
          </div>
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
                      const allowed = isAdmin || memberDateSet.size === 0 || memberDateSet.has(day)
                      cells.push(
                        <button
                          key={day}
                          type="button"
                          disabled={!allowed}
                          onClick={() => {
                            if (!allowed) return
                            setDatePickerOpen(false)
                            void goToDate(day)
                          }}
                          className={`tap-btn aspect-square rounded-lg text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-30 ${
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
      </div>

      <div className="mb-4 min-w-0 rounded-xl border border-border/50 bg-white/50 p-2">
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
                          notLoggedIn && allowEditTasks ? 'bg-amber-50/70' : ''
                        } ${rowIdx < section.rows.length - 1 ? 'border-b border-border/55' : 'border-b border-border/25'}`}
                      >
                        <td className="w-0 whitespace-nowrap px-3 py-2">
                          <RowIdentity
                            row={row}
                            isAdmin={isAdmin}
                            notLoggedIn={notLoggedIn && allowEditTasks}
                            onRemove={isAdmin && allowEditTasks ? () => removeEmployeeFromPlan(row) : undefined}
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

      {/* Mobile: separate cards per worker for clearer scanning */}
      <div className="flex flex-col gap-4 sm:hidden">
        {localRows.length === 0 ? (
          <div className="glass-card px-4 py-8 text-center text-sm text-muted-foreground">
            {isAdmin ? 'Натисніть «Додати», щоб заповнити план' : 'План ще порожній'}
          </div>
        ) : (
          sections.map((section, sectionIdx) => {
            const style = DEPT_STYLES[sectionIdx % DEPT_STYLES.length]
            return (
              <div key={section.id} className="flex flex-col gap-2.5">
                <div className={`rounded-lg px-3 py-2 text-xs font-bold tracking-wide ${style.head}`}>
                  відділ: {section.name}
                </div>
                {section.rows.map((row, rowIdx) => {
                  const notLoggedIn = isAdmin && !loggedIn.has(row.employee_id)
                  return (
                    <div
                      key={row.employee_id}
                      className={`rounded-xl border border-black/10 bg-white/90 px-3.5 py-3.5 shadow-sm ${
                        notLoggedIn && allowEditTasks ? 'border-amber-300/70 bg-amber-50/90' : ''
                      }`}
                    >
                      <div className={`mb-3 -mx-1 rounded-lg px-2.5 py-2 ${style.identity}`}>
                        <RowIdentity
                          row={row}
                          isAdmin={isAdmin}
                          notLoggedIn={notLoggedIn && allowEditTasks}
                          onRemove={isAdmin && allowEditTasks ? () => removeEmployeeFromPlan(row) : undefined}
                          removeDisabled={isPending}
                        />
                      </div>
                      <div className="flex flex-col gap-3">
                        {visibleCols.map(c => {
                          const val = cellValue(row, c)
                          if (c.key === 'shift') {
                            return (
                              <div key={c.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
                                  {COL_ICONS[c.key] ? <span className="mr-1 normal-case">{COL_ICONS[c.key]}</span> : null}
                                  {c.label}
                                </span>
                                {isAdmin ? (
                                  <PlanField
                                    col={c}
                                    isAdmin={isAdmin}
                                    canEdit={canEditField('shift', row)}
                                    value={val}
                                    onChange={v => onCellChange(row, c, v)}
                                    onBlurAdmin={() => { scheduleBlurSave() }}
                                    onBlurEmployee={() => {}}
                                    compact
                                  />
                                ) : (
                                  <span className="text-base font-semibold text-foreground">{val.trim() || '—'}</span>
                                )}
                              </div>
                            )
                          }
                          return (
                          <div key={c.id} className="flex flex-col gap-1.5">
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
                              {COL_ICONS[c.key] ? <span className="normal-case">{COL_ICONS[c.key]}</span> : null}
                              {c.label}
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
              toast.error(res.error)
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
                avatar_url: m.profile?.avatar_url ?? null,
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
        pushActiveIds={pushActive}
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
            if (json.error) toast.error(json.error)
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
            toast.error('Немає звʼязку з сервером')
          }
          setSending(false)
        }}
      />

      <DigestModal
        open={digestOpen}
        leaders={leaders}
        busy={digestSending}
        pushActiveIds={pushActive}
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
            if (res.error) toast.error(res.error)
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
                if (chromeBlocked) return
                if (!activePlanId && localRows.length === 0) {
                  setMsg('Спочатку додайте працівників')
                  return
                }
                setDeleteOpen(true)
              }}
              disabled={isPending || chromeBlocked}
              className="tap-btn flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium text-red-500 disabled:opacity-40"
              title={chromeBlocked ? 'Спочатку розблокуйте план' : 'Видалити план'}
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
      <UserAvatar url={row.avatar_url} name={row.full_name} size={32} />
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
          <div className="mt-0.5 inline-flex items-center gap-0.5 whitespace-nowrap text-[10px] font-medium text-amber-700/90">
            <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            ще не входив
          </div>
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
  const lockedLook = !canEdit
  const fieldTone = lockedLook
    ? col.key === 'planned'
      ? 'border-sky-200/70 bg-sky-50/50 text-foreground shadow-none'
      : col.key === 'completed'
        ? value.trim()
          ? 'border-emerald-200/70 bg-emerald-50/60 text-emerald-900 shadow-none'
          : 'border-emerald-100 bg-emerald-50/40 text-foreground shadow-none'
        : 'border-border/40 bg-muted/20 text-foreground shadow-none'
    : col.key === 'planned'
      ? 'border-sky-400/90 bg-sky-50 shadow-[0_1px_2px_rgba(15,23,42,0.06),inset_0_0_0_1px_rgba(56,189,248,0.12)]'
      : col.key === 'completed'
        ? value.trim()
          ? 'border-emerald-500 bg-emerald-50 text-emerald-900 shadow-[0_1px_2px_rgba(15,23,42,0.06),inset_0_0_0_1px_rgba(16,185,129,0.15)]'
          : 'border-emerald-300 bg-emerald-50/70 shadow-[0_1px_2px_rgba(15,23,42,0.05)]'
        : 'border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
  const plannedAsText = col.key === 'planned' && !isAdmin
  const minW = compact || isShift ? '' : 'min-w-[180px]'
  const fieldShadow = lockedLook ? 'shadow-none' : 'shadow-[0_1px_2px_rgba(15,23,42,0.06)]'

  if (plannedAsText) {
    return (
      <div className={`min-h-[40px] w-full whitespace-pre-wrap rounded-md border border-sky-200/70 bg-sky-50/50 px-2.5 py-2 text-base leading-snug text-foreground ${minW}`}>
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
        className={`w-full resize-none overflow-hidden rounded-md border px-2.5 py-2 text-base leading-snug disabled:cursor-not-allowed disabled:opacity-100 ${minW} ${fieldTone}`}
      />
    )
  }

  if (isShift) {
    if (!isAdmin || !canEdit) {
      if (!isAdmin) {
        return (
          <span className="inline-block whitespace-nowrap text-base font-semibold leading-snug text-foreground">
            {value.trim() || '—'}
          </span>
        )
      }
      return (
        <input
          value={value}
          disabled
          size={Math.max(value.length, 9)}
          readOnly
          className={`w-auto max-w-none cursor-not-allowed whitespace-nowrap rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-base font-medium text-foreground [field-sizing:content] ${fieldShadow}`}
        />
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
        className={`w-auto max-w-none whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-base font-medium disabled:cursor-not-allowed disabled:opacity-100 [field-sizing:content] ${fieldShadow}`}
      />
    )
  }

  return (
    <input
      value={value}
      disabled={!canEdit}
      onChange={e => onChange(e.target.value)}
      onBlur={() => { if (isAdmin) onBlurAdmin() }}
      className={`w-full rounded-md border px-2.5 py-2 text-base disabled:cursor-not-allowed disabled:opacity-100 ${fieldTone} ${minW}`}
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
  pushDisabled,
  onSend,
}: {
  busy: boolean
  disabled: boolean
  pushDisabled?: boolean
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
        disabled={busy || disabled || !!pushDisabled}
        title={pushDisabled ? 'Ніхто з вибраних не активував push' : undefined}
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
  pushActiveIds,
  onClose,
  onSend,
}: {
  open: boolean
  rows: LocalRow[]
  busy: boolean
  pushActiveIds: Set<string>
  onClose: () => void
  onSend: (ids: string[], channels: SendChannels) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setSelected(new Set(rows.map(r => r.employee_id)))
  }, [open, rows])

  const selectedHasPush = [...selected].some(id => pushActiveIds.has(id))

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
                <UserAvatar url={r.avatar_url} name={r.full_name} size={28} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {r.full_name}
                    <PushStatusBell active={pushActiveIds.has(r.employee_id)} />
                  </span>
                  <span className="block text-xs text-muted-foreground">{r.email || 'без email'}</span>
                  <ChannelStamps emailAt={r.plan_email_sent_at} pushAt={r.plan_push_sent_at} />
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Вибрано: {selected.size}. ✉ email · 🔔 push активовано на пристрої.
          {!selectedHasPush && selected.size > 0 ? ' Ніхто з вибраних не має push.' : ''}
        </p>
        <SendChannelButtons
          busy={busy}
          disabled={selected.size === 0}
          pushDisabled={!selectedHasPush}
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
  pushActiveIds,
  onClose,
  onSend,
}: {
  open: boolean
  leaders: Leader[]
  busy: boolean
  pushActiveIds: Set<string>
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

  const selectedHasPush = [...selected].some(id => pushActiveIds.has(id))

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
                  <UserAvatar url={l.avatar_url} name={l.full_name} size={28} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {l.full_name}
                      <PushStatusBell active={pushActiveIds.has(l.id)} />
                    </span>
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
          <p className="text-[11px] text-muted-foreground">
            Вибрано: {selected.size}
            {!selectedHasPush && selected.size > 0 ? ' · ніхто з вибраних не має push' : ''}
          </p>
          <SendChannelButtons
            busy={busy}
            disabled={selected.size === 0}
            pushDisabled={!selectedHasPush}
            onSend={channels => onSend([...selected], channels, content)}
          />
        </div>
      )}
    </Modal>
  )
}
