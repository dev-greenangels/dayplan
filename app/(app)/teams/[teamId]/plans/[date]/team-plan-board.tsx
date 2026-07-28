'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Department, Profile, TaskRow, TaskRowPhoto, Team, TeamColumn } from '@/lib/types'
import { addPlanMembers, copyPlanFromPreviousDay, deleteDayPlan, removePlanMember, saveTeamPlan, setDayPlanTasksLocked, updateTaskRowFields } from '@/app/actions/plans'
import { isFilledBeyondTemplate } from '@/lib/column-templates'
import {
  daysInMonth,
  formatUkDate,
  formatUkDateTime,
  formatUkDayMonth,
  formatUkDayTab,
  formatUkMonthYear,
  formatUkShortDate,
  todayISO,
} from '@/lib/format-date'
import AutoGrowTextarea from '@/components/auto-grow-textarea'
import FieldPhotos from '@/components/field-photos'
import ConfirmDialog from '@/components/confirm-dialog'
import Modal from '@/components/modal'
import UserAvatar, { PushStatusBell } from '@/components/user-avatar'
import { useToast } from '@/components/toast-provider'
import { usePlanChromeLock } from '@/components/plan-chrome-lock'
import { usePlanRealtimeSync } from '@/hooks/use-plan-realtime-sync'
import {
  PlanMonthCalendarGrid,
  usePlanScheduleChromeHost,
} from '@/components/plan-schedule-chrome'

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
type DigestReceipts = Record<string, { email?: string; push?: string }>

interface Props {
  team: Team
  date: string
  planId: string | null
  /** Day-level lock; default unlocked */
  planTasksLocked?: boolean
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
  isSuperAdmin?: boolean
  canEditTasks: boolean
  currentUserId: string
  loggedInIds: string[]
  hiddenFromPlanIds: string[]
  pushActiveIds: string[]
  /** Dates where this employee already has a task_row (employees only) */
  memberPlanDates?: string[]
  initialPhotos?: TaskRowPhoto[]
}

interface LocalRow {
  id?: string
  employee_id: string
  department_id: string | null
  full_name: string
  email: string
  avatar_url?: string | null
  notify_email: boolean
  notify_push: boolean
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
    notify_email: r.profile?.notify_email !== false,
    notify_push: r.profile?.notify_push !== false,
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
  planTasksLocked = false,
  digestSentAt: initialDigestSentAt,
  digestReceipts: initialDigestReceipts,
  planDates,
  previousPlanDate,
  departments,
  columns,
  members,
  rows: initialRows,
  leaders: _initialLeaders,
  isAdmin,
  isSubAdmin,
  isSuperAdmin = false,
  canEditTasks,
  currentUserId,
  loggedInIds,
  hiddenFromPlanIds,
  pushActiveIds,
  memberPlanDates = [],
  initialPhotos = [],
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
  const [employeeReportBusy, setEmployeeReportBusy] = useState(false)
  const [employeeReportSentAt, setEmployeeReportSentAt] = useState<string | null>(() => {
    const mine = initialRows.find(r => r.employee_id === currentUserId)
    return mine?.report_sent_at ?? null
  })
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [pickerMonth, setPickerMonth] = useState(date) // any day in visible month
  const [tasksLocked, setTasksLocked] = useState(() => planTasksLocked === true)
  const [lockBusy, setLockBusy] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [activePlanId, setActivePlanId] = useState(planId)
  const [fieldSaveState, setFieldSaveState] = useState<Record<string, 'saving' | 'saved'>>({})
  const [completedInvalidIds, setCompletedInvalidIds] = useState<Set<string>>(() => new Set())
  const [photosByRow, setPhotosByRow] = useState<Record<string, TaskRowPhoto[]>>(() => {
    const map: Record<string, TaskRowPhoto[]> = {}
    for (const p of initialPhotos) {
      if (!map[p.task_row_id]) map[p.task_row_id] = []
      map[p.task_row_id].push(p)
    }
    return map
  })
  useEffect(() => {
    const map: Record<string, TaskRowPhoto[]> = {}
    for (const p of initialPhotos) {
      if (!map[p.task_row_id]) map[p.task_row_id] = []
      map[p.task_row_id].push(p)
    }
    setPhotosByRow(map)
  }, [initialPhotos, planId, date])

  function photosFor(rowId: string | undefined, field: 'planned' | 'completed') {
    if (!rowId) return []
    return (photosByRow[rowId] ?? []).filter(p => p.field === field)
  }

  function setPhotosFor(rowId: string, field: 'planned' | 'completed', next: TaskRowPhoto[]) {
    setPhotosByRow(prev => {
      const others = (prev[rowId] ?? []).filter(p => p.field !== field)
      return { ...prev, [rowId]: [...others, ...next] }
    })
  }

  const dayStripRef = useRef<HTMLDivElement>(null)
  const monthBarRef = useRef<HTMLDivElement>(null)
  const monthBarSentinelRef = useRef<HTMLDivElement>(null)
  const datePickerRef = useRef<HTMLDivElement>(null)
  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [monthBarStuck, setMonthBarStuck] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const employeeIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyFieldsRef = useRef<Set<string>>(new Set())
  const localRowsRef = useRef<LocalRow[]>([])
  const flushSaveRef = useRef<() => Promise<boolean>>(async () => true)
  const savingRef = useRef(false)
  const aliveRef = useRef(true)
  const committedEmployeeRef = useRef<Map<string, { completed: string; notes: string; extra: Record<string, string> }>>(new Map())
  const [loggedIn, setLoggedIn] = useState(() => new Set(loggedInIds))
  const hiddenSet = useMemo(() => new Set(hiddenFromPlanIds), [hiddenFromPlanIds])
  const pushActive = useMemo(() => new Set(pushActiveIds), [pushActiveIds])

  useEffect(() => {
    setLoggedIn(new Set(loggedInIds))
  }, [loggedInIds])
  const defaultShift = team.default_shift?.trim() || '8:00-18:00'
  const showSendWorkers = team.show_send_worker_emails !== false
  const showSendLeadership = team.show_send_leadership !== false
  const allowEditTasks = canEditTasks && !tasksLocked
  const isPastDay = date < todayISO()
  const completedTemplate = useMemo(
    () => columns.find(c => c.key === 'completed')?.input_template ?? null,
    [columns]
  )

  function isRowFrozen(row: LocalRow) {
    // Past day + plan digest sent OR this row's report sent → no edit (planned/completed)
    return isPastDay && (!!digestSentAt || !!row.report_sent_at)
  }

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
    setTasksLocked(planTasksLocked === true)
  }, [team.id, date, planId, planTasksLocked])

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

  usePlanRealtimeSync({
    teamId: team.id,
    date,
    planId: activePlanId,
    setActivePlanId,
    setTasksLocked,
    setDigestSentAt,
    setDigestReceipts,
    setLocalRows: updater => {
      setLocalRows(prev => updater(prev) as LocalRow[])
    },
    dirtyFieldsRef,
    onProfileSignedIn: userId => {
      setLoggedIn(prev => {
        if (prev.has(userId)) return prev
        const next = new Set(prev)
        next.add(userId)
        return next
      })
    },
  })

  useEffect(() => {
    return () => {
      queueMicrotask(() => setChromeBlocked(false))
    }
  }, [setChromeBlocked])

  useEffect(() => {
    if (!isSubAdmin) return
    queueMicrotask(() => setChromeBlocked(tasksLocked))
  }, [isSubAdmin, tasksLocked, setChromeBlocked])

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
    const pendingKeys = [...dirtyFieldsRef.current]
    if (aliveRef.current) {
      setSaveStatus('saving')
      if (pendingKeys.length) {
        setFieldSaveState(prev => {
          const next = { ...prev }
          for (const k of pendingKeys) next[k] = 'saving'
          return next
        })
      }
    }
    try {
      const res = await saveTeamPlan(team.id, date, rowPayload())
      if (!aliveRef.current) return !res.error
      if (res.error) {
        setSaveStatus('error')
        if (pendingKeys.length) {
          setFieldSaveState(prev => {
            const next = { ...prev }
            for (const k of pendingKeys) delete next[k]
            return next
          })
        }
        toast.error(res.error)
        return false
      }
      dirtyRef.current = false
      setDirty(false)
      setSaveStatus('saved')
      dirtyFieldsRef.current.clear()
      if (pendingKeys.length) {
        setFieldSaveState(prev => {
          const next = { ...prev }
          for (const k of pendingKeys) next[k] = 'saved'
          return next
        })
      }
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
    }, 10_000)
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
      if (employeeIdleTimerRef.current) clearTimeout(employeeIdleTimerRef.current)
    }
  }, [])

  const isSharedPc = team.work_mode === 'shared'
  const incompleteCompletedIds = useMemo(() => {
    return localRows
      .filter(r => !isFilledBeyondTemplate(r.completed, completedTemplate))
      .map(r => r.employee_id)
  }, [localRows, completedTemplate])

  const hasAnyPlanned = localRows.some(r => r.planned.trim().length > 0)
  const hasAnyCompleted = localRows.some(r =>
    isFilledBeyondTemplate(r.completed, completedTemplate)
  )
  const myRow = localRows.find(r => r.employee_id === currentUserId)
  const myCompletedOk = !!(myRow && isFilledBeyondTemplate(myRow.completed, completedTemplate))
  const myRowFrozen = !!(myRow && isRowFrozen(myRow))

  function assertSharedCompletedFilled(): boolean {
    if (!isSharedPc) return true
    if (localRows.length === 0) {
      toast.error('Немає рядків у плані')
      return false
    }
    if (incompleteCompletedIds.length === 0) return true
    setCompletedInvalidIds(new Set(incompleteCompletedIds))
    toast.error('Заповніть «Виконано» для всіх у плані перед відправкою')
    return false
  }

  function trySendLeadershipDigest() {
    if (!assertSharedCompletedFilled()) return
    void sendLeadershipDigest()
  }

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
    if (isRowFrozen(row)) return false
    if (isAdmin) {
      if (!allowEditTasks && (field === 'planned' || field === 'shift' || field.startsWith('extra:'))) {
        return false
      }
      return true
    }
    if (row.employee_id !== currentUserId) return false
    return field === 'completed' || field === 'notes' || field.startsWith('extra:')
  }

  function fieldSaveKey(rowKey: string, field: string) {
    return `${rowKey}:${field}`
  }

  function rowKeyOf(row: LocalRow) {
    return row.id || row.employee_id
  }

  function colFieldKey(col: TeamColumn) {
    return col.key === 'shift' || col.key === 'planned' || col.key === 'completed' || col.key === 'notes'
      ? col.key
      : `extra:${col.key}`
  }

  function setFieldsSaving(keys: string[]) {
    if (!keys.length) return
    setFieldSaveState(prev => {
      const next = { ...prev }
      for (const k of keys) next[k] = 'saving'
      return next
    })
  }

  function setFieldsSaved(keys: string[]) {
    if (!keys.length) return
    setFieldSaveState(prev => {
      const next = { ...prev }
      for (const k of keys) next[k] = 'saved'
      return next
    })
  }

  function clearFieldSaved(row: LocalRow, field: string) {
    const key = fieldSaveKey(rowKeyOf(row), field)
    dirtyFieldsRef.current.add(key)
    setFieldSaveState(prev => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function commitEmployeeRow(row: LocalRow, onlyField?: string) {
    if (!row.id || isAdmin || isRowFrozen(row)) return
    const key = row.id
    const prev = committedEmployeeRef.current.get(key) ?? {
      completed: '',
      notes: '',
      extra: {},
    }
    const next = {
      completed: row.completed,
      notes: row.notes,
      extra: { ...row.extra },
    }
    const changed: string[] = []
    if (prev.completed !== next.completed) changed.push('completed')
    if (prev.notes !== next.notes) changed.push('notes')
    const extraKeys = new Set([...Object.keys(prev.extra), ...Object.keys(next.extra)])
    for (const ek of extraKeys) {
      if ((prev.extra[ek] || '') !== (next.extra[ek] || '')) changed.push(`extra:${ek}`)
    }
    const toSave = onlyField ? changed.filter(f => f === onlyField) : changed
    if (toSave.length === 0) return

    const statusKeys = toSave.map(f => fieldSaveKey(row.id!, f))
    setFieldsSaving(statusKeys)
    committedEmployeeRef.current.set(key, next)
    const res = await updateTaskRowFields(row.id, {
      completed: next.completed,
      notes: next.notes,
      extra: next.extra,
    })
    if (res.error) {
      committedEmployeeRef.current.set(key, prev)
      setFieldSaveState(prevState => {
        const n = { ...prevState }
        for (const k of statusKeys) delete n[k]
        return n
      })
      toast.error(res.error)
      return
    }
    setFieldsSaved(statusKeys)
  }

  function scheduleEmployeeIdleSave(employeeId: string) {
    if (isAdmin) return
    if (employeeIdleTimerRef.current) clearTimeout(employeeIdleTimerRef.current)
    employeeIdleTimerRef.current = setTimeout(() => {
      const row = localRowsRef.current.find(r => r.employee_id === employeeId)
      if (row) void commitEmployeeRow(row)
    }, 10_000)
  }

  async function commitEmployeeField(row: LocalRow, field: 'completed' | 'notes' | `extra:${string}`, value: string) {
    if (!row.id || isAdmin || isRowFrozen(row)) return
    const latest = localRowsRef.current.find(r => r.id === row.id) ?? row
    const patched =
      field === 'completed'
        ? { ...latest, completed: value }
        : field === 'notes'
          ? { ...latest, notes: value }
          : {
              ...latest,
              extra: { ...latest.extra, [field.slice(6)]: value },
            }
    await commitEmployeeRow(patched, field)
  }

  function cellValue(row: LocalRow, col: TeamColumn): string {
    if (col.key === 'shift') return row.shift
    if (col.key === 'planned') return row.planned
    if (col.key === 'completed') return row.completed
    if (col.key === 'notes') return row.notes
    return row.extra[col.key] ?? ''
  }

  function onCellChange(row: LocalRow, col: TeamColumn, value: string) {
    const fieldKey = colFieldKey(col)
    clearFieldSaved(row, fieldKey)
    if (col.key === 'completed') {
      setCompletedInvalidIds(prev => {
        if (!prev.has(row.employee_id)) return prev
        const next = new Set(prev)
        next.delete(row.employee_id)
        return next
      })
    }
    if (col.key === 'shift') updateRow(row.employee_id, { shift: value })
    else if (col.key === 'planned') updateRow(row.employee_id, { planned: value })
    else if (col.key === 'completed') updateRow(row.employee_id, { completed: value })
    else if (col.key === 'notes') updateRow(row.employee_id, { notes: value })
    else setExtra(row.employee_id, col.key, value)
    if (!isAdmin && row.employee_id === currentUserId) {
      scheduleEmployeeIdleSave(row.employee_id)
    }
  }

  async function sendLeadershipDigest() {
    if ((!hasAnyPlanned && !hasAnyCompleted) && localRows.length === 0) return
    if (!assertSharedCompletedFilled()) return
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
        body: JSON.stringify({ teamId: team.id, date, channels: 'all', content: 'full' }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        if (String(json.error || '').includes('Виконано')) {
          setCompletedInvalidIds(new Set(incompleteCompletedIds))
        }
        toast.error(json.error || `HTTP ${res.status}`)
      } else {
        setDigestSentAt(json.digest_sent_at ?? new Date().toISOString())
        if (json.digest_receipts) setDigestReceipts(json.digest_receipts as DigestReceipts)
        const parts: string[] = []
        if (json.emailSent) parts.push(`email: ${json.emailSent}`)
        if (json.pushSent) parts.push(`push: ${json.pushSent}`)
        setMsg(parts.length ? `План керівництву (${parts.join(', ')})` : 'План надіслано керівництву')
        router.refresh()
      }
    } catch {
      toast.error('Немає звʼязку з сервером')
    }
    setDigestSending(false)
  }

  async function sendEmployeeLeadershipReport() {
    if (myRowFrozen) {
      toast.error('Звіт за минулий день уже відправлено — редагування та повторна відправка заборонені')
      return
    }
    setEmployeeReportBusy(true)
    setMsg(null)
    try {
      if (!assertSharedCompletedFilled()) {
        setEmployeeReportBusy(false)
        return
      }
      if (!myRow || !myCompletedOk) {
        setCompletedInvalidIds(new Set(myRow ? [myRow.employee_id] : []))
        toast.error('Заповніть поле «Виконано» перед відправкою')
        setEmployeeReportBusy(false)
        return
      }
      if (isAdmin) await flushSave()
      else if (myRow?.id) {
        await commitEmployeeRow(myRow)
      }
      const res = await fetch('/api/send-employee-leadership-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, date }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        if (String(json.error || '').includes('Виконано')) {
          setCompletedInvalidIds(new Set(incompleteCompletedIds.length ? incompleteCompletedIds : myRow ? [myRow.employee_id] : []))
        }
        toast.error(json.error || `HTTP ${res.status}`)
      } else {
        setCompletedInvalidIds(new Set())
        const sentAt = (json.sent_at as string) || new Date().toISOString()
        setEmployeeReportSentAt(sentAt)
        setLocalRows(prev =>
          prev.map(r =>
            isSharedPc || r.employee_id === currentUserId
              ? { ...r, report_sent_at: sentAt }
              : r
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
    if (!allowEditTasks) {
      toast.error('План заблоковано — спочатку розблокуйте день')
      return
    }
    if (isRowFrozen(row)) {
      toast.error('Минулий день із надісланим звітом — видалення недоступне')
      return
    }
    setRemoveTarget(row)
  }

  async function confirmRemoveEmployee() {
    const row = removeTarget
    if (!row) return
    if (!allowEditTasks || isRowFrozen(row)) {
      setRemoveTarget(null)
      toast.error(
        isRowFrozen(row)
          ? 'Минулий день із надісланим звітом — видалення недоступне'
          : 'План заблоковано — спочатку розблокуйте день'
      )
      return
    }
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
  const dayMonth = formatUkDayMonth(date)
  const colCount = 1 + visibleCols.length

  const { setChrome: setScheduleChrome } = usePlanScheduleChromeHost()

  const toggleTasksLock = useCallback(() => {
    if (lockBusy) return
    if (!(isAdmin && canEditTasks)) return
    const next = !tasksLocked
    setTasksLocked(next)
    if (isSubAdmin) setChromeBlocked(next)
    setLockBusy(true)
    void setDayPlanTasksLocked(team.id, date, next).then(res => {
      setLockBusy(false)
      if (res.error) {
        setTasksLocked(!next)
        if (isSubAdmin) setChromeBlocked(!next)
        toast.error(res.error)
        return
      }
      if (res.planId) setActivePlanId(res.planId)
    })
  }, [
    lockBusy,
    isAdmin,
    canEditTasks,
    tasksLocked,
    isSubAdmin,
    setChromeBlocked,
    team.id,
    date,
    toast,
  ])

  useEffect(() => {
    setScheduleChrome({
      date,
      dateLabelNoYear: dayMonth,
      showLock: isAdmin && canEditTasks,
      tasksLocked,
      lockBusy,
      onToggleLock: toggleTasksLock,
      isDayAllowed: (day: string) => isAdmin || memberDateSet.size === 0 || memberDateSet.has(day),
      goToDate: (d: string) => {
        void goToDate(d)
      },
    })
    return () => setScheduleChrome(null)
  }, [
    setScheduleChrome,
    date,
    dayMonth,
    isAdmin,
    canEditTasks,
    tasksLocked,
    lockBusy,
    toggleTasksLock,
    memberDateSet,
  ])

  const DEPT_STYLES = [
    { head: 'bg-emerald-100/90 text-emerald-950', row: 'bg-emerald-50/30', identity: 'bg-emerald-100/45' },
    { head: 'bg-sky-100/90 text-sky-950', row: 'bg-sky-50/30', identity: 'bg-sky-100/45' },
    { head: 'bg-amber-100/90 text-amber-950', row: 'bg-amber-50/30', identity: 'bg-amber-100/45' },
    { head: 'bg-violet-100/90 text-violet-950', row: 'bg-violet-50/30', identity: 'bg-violet-100/45' },
    { head: 'bg-rose-100/90 text-rose-950', row: 'bg-rose-50/30', identity: 'bg-rose-100/45' },
    { head: 'bg-teal-100/90 text-teal-950', row: 'bg-teal-50/30', identity: 'bg-teal-100/45' },
  ] as const

  return (
    <div className="mx-auto min-w-0 max-w-[1600px] pb-24 xl:pb-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h1 className="text-2xl font-bold text-foreground">{team.name}</h1>
            <p className="text-xs font-medium text-muted-foreground sm:hidden">
              Плани на {monthLabel}
            </p>
          </div>
          {isAdmin && dirty && saveStatus !== 'saving' && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Є незбережені зміни</p>
          )}
        </div>
        {!isAdmin && (
          <div className="hidden flex-wrap gap-2 xl:flex">
            <button
              type="button"
              onClick={() => { void sendEmployeeLeadershipReport() }}
              disabled={employeeReportBusy || myRowFrozen}
              title={
                myRowFrozen
                  ? 'Звіт за минулий день уже відправлено'
                  : 'Надіслати свій звіт керівництву'
              }
              className={`tap-btn flex min-h-[52px] min-w-[168px] flex-col items-center justify-center rounded-xl px-4 py-1.5 text-sm font-semibold leading-tight disabled:opacity-40 ${
                employeeReportSentAt
                  ? 'border border-green-300 bg-green-50 text-green-800'
                  : 'glass-send-btn text-primary-foreground'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <SendEnvelopeIcon className="h-4 w-4" />
                {employeeReportBusy
                  ? '...'
                  : employeeReportSentAt
                    ? 'Звіт керівництву ✓'
                    : 'Звіт керівництву'}
              </span>
              <span className={`mt-0.5 text-[10px] font-normal ${employeeReportSentAt ? 'text-green-700/80' : 'invisible text-primary-foreground/80'}`}>
                {employeeReportSentAt ? formatUkDateTime(employeeReportSentAt) : '00.00.0000 00:00'}
              </span>
            </button>
          </div>
        )}
        {isAdmin && (
          <div className="hidden flex-wrap gap-2 xl:flex">
            <button
              onClick={() => {
                if (isPastDay && !isSuperAdmin) {
                  toast.error('У минулі дні працівників може додавати лише шеф')
                  return
                }
                setAddOpen(true)
              }}
              disabled={isPending || (isPastDay && !isSuperAdmin)}
              title={isPastDay && !isSuperAdmin ? 'У минулі дні працівників може додавати лише шеф' : undefined}
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
                onClick={() => trySendLeadershipDigest()}
                disabled={digestSending || localRows.length === 0}
                title="Надіслати всю таблицю керівництву (email/push — з налаштувань команди)"
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
        className="plan-month-sticky -mx-3 mb-4 px-3 sm:-mx-4 sm:px-4"
      >
        <div
          className={`boty-glass flex items-center gap-2 border border-border/50 px-2 py-2 transition-[border-radius] duration-150 sm:gap-3 sm:px-3 ${
            monthBarStuck ? 'rounded-t-none rounded-b-lg' : 'rounded-lg'
          }`}
        >
          {/* Desktop: month title + lock */}
          <div className="hidden min-w-0 shrink-0 items-center gap-1.5 sm:flex">
            <p className="min-w-0 truncate whitespace-nowrap text-sm font-semibold text-foreground">
              Плани на {monthLabel}
            </p>
            {isAdmin && canEditTasks && (
              <button
                type="button"
                title={
                  tasksLocked
                    ? 'Розблокувати редагування завдань'
                    : 'Заблокувати редагування завдань'
                }
                disabled={lockBusy}
                onClick={toggleTasksLock}
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

          {/* Day strip fills the middle */}
          <div
            ref={dayStripRef}
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {dateTabs.map(tab => {
              const label = formatUkDayTab(tab.date)
              return (
                <button
                  key={tab.date}
                  type="button"
                  data-selected={tab.isSelected ? 'true' : undefined}
                  onClick={() => void goToDate(tab.date)}
                  className={`tap-btn flex shrink-0 flex-col items-center rounded-lg text-center transition ${
                    monthBarStuck ? 'min-w-[36px] px-1.5 py-1' : 'min-w-[48px] px-2 py-1.5'
                  } ${
                    tab.isSelected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : tab.isToday
                        ? 'border-2 border-primary/70 bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_rgba(45,106,79,0.12)]'
                        : tab.hasPlan
                          ? 'bg-primary/10 text-foreground hover:bg-primary/15'
                          : 'border border-border/60 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {!monthBarStuck && (
                    <span className={`text-[10px] uppercase opacity-80 ${tab.isToday && !tab.isSelected ? 'font-semibold text-primary' : ''}`}>
                      {tab.isToday && !tab.isSelected ? 'сьогодні' : label.weekday}
                    </span>
                  )}
                  <span className="text-sm font-semibold leading-tight">{label.day}</span>
                  {(tab.isToday || tab.hasPlan) && !tab.isSelected && (
                    <span className={`mt-0.5 h-1 w-1 rounded-full ${tab.isToday ? 'bg-primary' : 'bg-primary/60'}`} />
                  )}
                </button>
              )
            })}
          </div>

          {/* Calendar: mobile icon-only on the right; desktop icon + date */}
          <div className="relative shrink-0" ref={datePickerRef}>
            <button
              type="button"
              onClick={() => setDatePickerOpen(v => !v)}
              aria-expanded={datePickerOpen}
              aria-label="Календар"
              title="Календар"
              className="tap-btn inline-flex items-center gap-2 rounded-lg border border-border bg-white p-2 text-sm font-semibold text-foreground shadow-sm sm:rounded-xl sm:px-3 sm:py-2"
            >
              <svg className="h-4 w-4 text-muted-foreground sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">{shortDate}</span>
            </button>
            {datePickerOpen && (
              <div
                className="absolute right-0 top-[calc(100%+0.35rem)] z-40 w-[min(18.5rem,calc(100vw-1.5rem))] rounded-xl border border-border/60 bg-white p-3 shadow-xl"
                style={{
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              >
                <PlanMonthCalendarGrid
                  pickerMonth={pickerMonth}
                  setPickerMonth={setPickerMonth}
                  selectedDate={date}
                  isDayAllowed={day => isAdmin || memberDateSet.size === 0 || memberDateSet.has(day)}
                  onSelect={day => {
                    setDatePickerOpen(false)
                    void goToDate(day)
                  }}
                />
              </div>
            )}
          </div>
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

      <div className="glass-card hidden min-w-0 max-w-full xl:block">
        <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-muted-foreground">
                <th className="plan-table-sticky-th w-[16%] min-w-[10.5rem] px-2 py-2.5 text-sm font-medium text-muted-foreground xl:px-3">
                  Працівник
                </th>
                {visibleCols.map(c => (
                  <th
                    key={c.id}
                    className={`plan-table-sticky-th px-2 py-2.5 text-sm font-medium text-muted-foreground xl:px-3 ${
                      c.key === 'planned' || c.key === 'completed' || c.key === 'notes'
                        ? 'w-[18%] min-w-0'
                        : c.key === 'shift'
                          ? 'w-[7%] whitespace-nowrap'
                          : 'w-[12%] min-w-0'
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
                        <td className="min-w-0 w-[16%] px-2 py-2 xl:px-3">
                          <RowIdentity
                            row={row}
                            isAdmin={isAdmin}
                            notLoggedIn={notLoggedIn}
                            pushActive={pushActive.has(row.employee_id)}
                            onRemove={isAdmin ? () => removeEmployeeFromPlan(row) : undefined}
                            removeDisabled={
                              isPending || !allowEditTasks || isRowFrozen(row)
                            }
                            removeTitle={
                              isRowFrozen(row)
                                ? 'Минулий день із надісланим звітом — видалення недоступне'
                                : !allowEditTasks
                                  ? 'План заблоковано — спочатку розблокуйте день'
                                  : 'Прибрати з плану на цей день'
                            }
                          />
                        </td>
                        {visibleCols.map(c => (
                          <td
                            key={c.id}
                            className={`min-w-0 px-1 py-2 ${
                              c.key === 'planned' || c.key === 'completed' || c.key === 'notes'
                                ? 'w-[18%]'
                                : c.key === 'shift'
                                  ? 'w-[7%] whitespace-nowrap'
                                  : 'w-[12%]'
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
                                if (!row.id) return
                                if (c.key === 'completed' || c.key === 'notes') {
                                  void commitEmployeeField(row, c.key, v)
                                } else if (!c.is_system) {
                                  void commitEmployeeField(row, `extra:${c.key}`, v)
                                }
                              }}
                              saveState={
                                fieldSaveState[fieldSaveKey(rowKeyOf(row), colFieldKey(c))]
                              }
                              invalid={
                                c.key === 'completed' && completedInvalidIds.has(row.employee_id)
                              }
                              rowId={row.id}
                              photos={
                                c.key === 'planned' || c.key === 'completed'
                                  ? photosFor(row.id, c.key)
                                  : undefined
                              }
                              canUploadPhoto={
                                (c.key === 'planned' || c.key === 'completed') &&
                                !!row.id &&
                                canEditField(c.key, row) &&
                                (c.key === 'completed' || isAdmin)
                              }
                              canDeletePhoto={
                                (c.key === 'planned' || c.key === 'completed') &&
                                (isAdmin || row.employee_id === currentUserId)
                              }
                              onPhotosChange={
                                c.key === 'planned' || c.key === 'completed'
                                  ? next => {
                                      if (row.id) setPhotosFor(row.id, c.key as 'planned' | 'completed', next)
                                    }
                                  : undefined
                              }
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
      <div className="flex flex-col gap-4 xl:hidden">
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
                          notLoggedIn={notLoggedIn}
                          pushActive={pushActive.has(row.employee_id)}
                          removeCorner
                          onRemove={isAdmin ? () => removeEmployeeFromPlan(row) : undefined}
                          removeDisabled={
                            isPending || !allowEditTasks || isRowFrozen(row)
                          }
                          removeTitle={
                            isRowFrozen(row)
                              ? 'Минулий день із надісланим звітом — видалення недоступне'
                              : !allowEditTasks
                                ? 'План заблоковано — спочатку розблокуйте день'
                                : 'Прибрати з плану на цей день'
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-3">
                        {visibleCols.map(c => {
                          const val = cellValue(row, c)
                          if (c.key === 'shift') {
                            return (
                              <div key={c.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                <span className="shrink-0 text-xs font-bold tracking-wide text-foreground">
                                  {COL_ICONS[c.key] ? <span className="mr-1 font-normal">{COL_ICONS[c.key]}</span> : null}
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
                          <div
                            key={c.id}
                            className={`flex flex-col gap-1.5 ${
                              c.key === 'completed'
                                ? 'border-t border-border/45 pt-3 mt-0.5'
                                : ''
                            }`}
                          >
                            <label className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-foreground">
                              {COL_ICONS[c.key] ? <span className="font-normal">{COL_ICONS[c.key]}</span> : null}
                              <span className="flex-1">{c.label}</span>
                              {c.key === 'planned' &&
                                isSuperAdmin &&
                                val.trim() !== '' && (
                                <button
                                  type="button"
                                  title="Копіювати заплановане"
                                  aria-label="Копіювати заплановане"
                                  className="tap-btn ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50/80 text-sky-700/80 hover:bg-sky-100 hover:text-sky-900 active:bg-sky-100"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(val).then(
                                      () => toast.info('Скопійовано'),
                                      () => toast.error('Не вдалося скопіювати')
                                    )
                                  }}
                                >
                                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
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
                                if (!row.id) return
                                if (c.key === 'completed' || c.key === 'notes') {
                                  void commitEmployeeField(row, c.key, v)
                                } else if (!c.is_system) {
                                  void commitEmployeeField(row, `extra:${c.key}`, v)
                                }
                              }}
                              compact
                              saveState={
                                fieldSaveState[fieldSaveKey(rowKeyOf(row), colFieldKey(c))]
                              }
                              invalid={
                                c.key === 'completed' && completedInvalidIds.has(row.employee_id)
                              }
                              rowId={row.id}
                              photos={
                                c.key === 'planned' || c.key === 'completed'
                                  ? photosFor(row.id, c.key)
                                  : undefined
                              }
                              canUploadPhoto={
                                (c.key === 'planned' || c.key === 'completed') &&
                                !!row.id &&
                                canEditField(c.key, row) &&
                                (c.key === 'completed' || isAdmin)
                              }
                              canDeletePhoto={
                                (c.key === 'planned' || c.key === 'completed') &&
                                (isAdmin || row.employee_id === currentUserId)
                              }
                              onPhotosChange={
                                c.key === 'planned' || c.key === 'completed'
                                  ? next => {
                                      if (row.id) setPhotosFor(row.id, c.key as 'planned' | 'completed', next)
                                    }
                                  : undefined
                              }
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
                notify_email: m.profile?.notify_email !== false,
                notify_push: m.profile?.notify_push !== false,
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
          className="fixed inset-x-0 bottom-0 z-30 px-3 xl:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="boty-glass mx-auto flex max-w-[1600px] items-stretch justify-around gap-0.5 rounded-lg px-1.5 py-2">
            <button
              type="button"
              onClick={() => {
                if (isPastDay && !isSuperAdmin) {
                  toast.error('У минулі дні працівників може додавати лише шеф')
                  return
                }
                setAddOpen(true)
              }}
              disabled={isPending || (isPastDay && !isSuperAdmin)}
              className="tap-btn flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium text-foreground disabled:opacity-40"
              title={isPastDay && !isSuperAdmin ? 'У минулі дні працівників може додавати лише шеф' : 'Додати працівників'}
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
                onClick={() => trySendLeadershipDigest()}
                disabled={digestSending || localRows.length === 0}
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
          className="fixed inset-x-0 bottom-0 z-30 px-3 xl:hidden"
          style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom))' }}
        >
          <div className="boty-glass mx-auto flex max-w-[1600px] justify-center rounded-lg px-1 py-1">
            <button
              type="button"
              onClick={() => { void sendEmployeeLeadershipReport() }}
              disabled={employeeReportBusy || myRowFrozen}
              title={
                myRowFrozen
                  ? 'Звіт за минулий день уже відправлено'
                  : 'Надіслати свій звіт керівництву'
              }
              className={`tap-btn flex flex-col items-center gap-0 rounded-lg px-5 py-0.5 text-[11px] font-semibold leading-tight disabled:opacity-40 ${
                employeeReportSentAt ? 'text-green-700' : 'text-primary'
              }`}
            >
              <span className={`relative flex h-11 w-11 items-center justify-center rounded-full shadow-[0_4px_14px_oklch(0.42_0.12_155_/_40%)] ${
                employeeReportSentAt
                  ? 'bg-green-100 text-green-800'
                  : 'bg-[linear-gradient(135deg,oklch(0.42_0.12_155),oklch(0.48_0.13_150))] text-primary-foreground'
              }`}>
                <SendEnvelopeIcon className="h-6 w-6" />
                {employeeReportSentAt && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-600 text-[8px] text-white">✓</span>
                )}
              </span>
              Звіт керівництву
              <span className={`text-[9px] font-normal leading-none ${employeeReportSentAt ? 'text-green-700/90' : 'invisible'}`}>
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
  pushActive,
  removeCorner,
  onRemove,
  removeDisabled,
  removeTitle,
}: {
  row: LocalRow
  isAdmin: boolean
  notLoggedIn: boolean
  pushActive?: boolean
  /** Mobile: delete button in top-right corner */
  removeCorner?: boolean
  onRemove?: () => void
  removeDisabled?: boolean
  removeTitle?: string
}) {
  const removeBtn = onRemove ? (
    <button
      type="button"
      title={removeTitle ?? 'Прибрати з плану на цей день'}
      disabled={removeDisabled}
      onClick={onRemove}
      className={`tap-btn shrink-0 rounded-lg bg-red-50/90 p-1.5 text-red-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-40 ${
        removeCorner ? 'absolute right-0 top-0 z-10' : ''
      }`}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
    </button>
  ) : null

  return (
    <div className={`flex min-w-0 items-start gap-2 ${removeCorner ? 'relative w-full pr-9' : 'w-full max-w-full'}`}>
      {!removeCorner && removeBtn}
      {removeCorner && removeBtn}
      <UserAvatar url={row.avatar_url} name={row.full_name} size={32} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-tight text-foreground">
          <span className="min-w-0 truncate">{row.full_name}</span>
          {isAdmin && (
            <PushStatusBell
              active={!!pushActive && row.notify_push}
              className="shrink-0"
              title={
                !row.notify_push
                  ? 'Push сповіщення вимкнено'
                  : pushActive
                    ? 'Push увімкнено (є підписка на пристрої)'
                    : 'Push увімкнено в налаштуваннях, але ще немає підписки на пристрої'
              }
            />
          )}
        </div>
        {isAdmin && (
          <div
            className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
            title={row.notify_email ? 'Email сповіщення увімкнено' : 'Email сповіщення вимкнено'}
          >
            <span className="min-w-0 truncate">{row.email}</span>
            {row.notify_email ? (
              <svg
                className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            ) : (
              <svg
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 16" />
              </svg>
            )}
          </div>
        )}
        {isAdmin && (row.plan_email_sent_at || row.plan_push_sent_at || notLoggedIn) && (
          <div
            className={`mt-1 flex items-start gap-2 text-[10px] font-medium ${
              (row.plan_email_sent_at || row.plan_push_sent_at) && notLoggedIn
                ? 'justify-between'
                : ''
            }`}
          >
            {(row.plan_email_sent_at || row.plan_push_sent_at) && (
              <div className="min-w-0 flex flex-col gap-0.5">
                {row.plan_email_sent_at && (
                  <div className="flex items-center gap-1 whitespace-nowrap text-green-700">
                    <span title="Email надіслано">✉✓</span>
                    <span>{formatUkDateTime(row.plan_email_sent_at)}</span>
                  </div>
                )}
                {row.plan_push_sent_at && (
                  <div className="flex items-center gap-1 whitespace-nowrap text-violet-700">
                    <span title="Push надіслано">🔔✓</span>
                    <span>{formatUkDateTime(row.plan_push_sent_at)}</span>
                  </div>
                )}
              </div>
            )}
            {notLoggedIn && (
              <div className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-amber-700/90">
                <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                ще не входив
              </div>
            )}
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
  saveState,
  invalid,
  rowId,
  photos,
  canUploadPhoto,
  canDeletePhoto,
  onPhotosChange,
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
  saveState?: 'saving' | 'saved'
  invalid?: boolean
  rowId?: string
  photos?: TaskRowPhoto[]
  canUploadPhoto?: boolean
  canDeletePhoto?: boolean
  onPhotosChange?: (next: TaskRowPhoto[]) => void
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
  const minW = compact || isShift ? '' : 'min-w-0'
  const fieldShadow = lockedLook ? 'shadow-none' : 'shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
  const invalidTone = invalid ? '!border-red-400 ring-1 ring-red-300/80' : ''
  const padForStatus = saveState ? 'pr-7' : ''

  function withSaveBadge(node: ReactNode) {
    return (
      <div className="relative">
        {node}
        {saveState === 'saving' && (
          <span
            className="pointer-events-none absolute right-1.5 top-1.5 text-[10px] font-semibold leading-none text-muted-foreground/80"
            title="Зберігається"
            aria-label="Зберігається"
          >
            …
          </span>
        )}
        {saveState === 'saved' && (
          <span
            className="pointer-events-none absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700"
            title="Збережено"
            aria-label="Збережено"
          >
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
      </div>
    )
  }

  const showPhotos = (col.key === 'planned' || col.key === 'completed') && !!onPhotosChange

  function withPhotos(node: ReactNode) {
    if (!showPhotos) return node
    return (
      <div>
        {node}
        <FieldPhotos
          rowId={rowId ?? ''}
          field={col.key as 'planned' | 'completed'}
          photos={photos ?? []}
          canUpload={!!canUploadPhoto}
          canDelete={!!canDeletePhoto}
          onChange={onPhotosChange!}
        />
      </div>
    )
  }

  if (plannedAsText) {
    return withPhotos(
      <div className={`min-h-[40px] w-full whitespace-pre-wrap rounded-md border border-sky-200/70 bg-sky-50/50 px-2.5 py-2 text-base leading-snug text-foreground ${minW}`}>
        {value.trim() || '—'}
      </div>
    )
  }

  if (isTextArea) {
    return withPhotos(
      withSaveBadge(
        <AutoGrowTextarea
          value={value}
          disabled={!canEdit}
          softNumbering={col.key === 'planned' && canEdit}
          onChange={onChange}
          onBlur={v => {
            if (isAdmin) onBlurAdmin()
            else onBlurEmployee(v)
          }}
          className={`w-full resize-none overflow-hidden rounded-md border px-2.5 py-2 text-base leading-snug disabled:cursor-not-allowed disabled:opacity-100 ${minW} ${fieldTone} ${invalidTone} ${padForStatus}`}
        />
      )
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
      return withSaveBadge(
        <input
          value={value}
          disabled
          size={Math.max(value.length, 9)}
          readOnly
          className={`w-auto max-w-none cursor-not-allowed whitespace-nowrap rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-base font-medium text-foreground [field-sizing:content] ${fieldShadow} ${padForStatus}`}
        />
      )
    }
    const shiftChars = Math.max(value.length, 9)
    return withSaveBadge(
      <input
        value={value}
        disabled={!canEdit}
        size={shiftChars}
        onChange={e => onChange(e.target.value)}
        onBlur={() => { if (isAdmin) onBlurAdmin() }}
        className={`w-auto max-w-none whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-base font-medium disabled:cursor-not-allowed disabled:opacity-100 [field-sizing:content] ${fieldShadow} ${padForStatus}`}
      />
    )
  }

  return withSaveBadge(
    <input
      value={value}
      disabled={!canEdit}
      onChange={e => onChange(e.target.value)}
      onBlur={() => { if (isAdmin) onBlurAdmin() }}
      className={`w-full rounded-md border px-2.5 py-2 text-base disabled:cursor-not-allowed disabled:opacity-100 ${fieldTone} ${minW} ${padForStatus}`}
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
