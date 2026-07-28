'use client'

import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { planChannelTopic } from '@/lib/realtime'
import { useToast } from '@/components/toast-provider'

type DigestReceipts = Record<string, { email?: string; push?: string }>

export type PlanRealtimeRow = {
  id?: string
  employee_id: string
  department_id: string | null
  full_name?: string
  email?: string
  avatar_url?: string | null
  notify_email?: boolean
  notify_push?: boolean
  shift: string
  planned: string
  completed: string
  notes: string
  plan_email_sent_at: string | null
  plan_push_sent_at: string | null
  report_sent_at: string | null
  extra: Record<string, string>
}

type Args = {
  teamId: string
  date: string
  planId: string | null
  setActivePlanId: Dispatch<SetStateAction<string | null>>
  setTasksLocked: Dispatch<SetStateAction<boolean>>
  setDigestSentAt: Dispatch<SetStateAction<string | null>>
  setDigestReceipts: Dispatch<SetStateAction<DigestReceipts>>
  setLocalRows: (updater: (prev: PlanRealtimeRow[]) => PlanRealtimeRow[]) => void
  dirtyFieldsRef: MutableRefObject<Set<string>>
  /** Mark employee as having signed in (clears «ще не входив»). */
  onProfileSignedIn?: (userId: string) => void
}

/**
 * One Realtime channel per plan day (shared topic across users).
 * Never calls router.refresh() on task_row noise — that looped RSC fetches.
 */
export function usePlanRealtimeSync({
  teamId,
  date,
  planId,
  setActivePlanId,
  setTasksLocked,
  setDigestSentAt,
  setDigestReceipts,
  setLocalRows,
  dirtyFieldsRef,
  onProfileSignedIn,
}: Args) {
  const router = useRouter()
  const toast = useToast()
  const planIdRef = useRef(planId)
  planIdRef.current = planId
  const onSignedInRef = useRef(onProfileSignedIn)
  onSignedInRef.current = onProfileSignedIn

  useEffect(() => {
    let cancelled = false
    let readyForToast = false
    const supabase = createClient()
    const topic = planChannelTopic(teamId, date)

    for (const ch of supabase.getChannels()) {
      const topicName = typeof ch.topic === 'string' ? ch.topic : ''
      if (topicName.includes(`dayplan:plan:${teamId}`)) {
        void supabase.removeChannel(ch)
      }
    }

    function applyLock(next: boolean, planIdNext?: string | null, withToast = true) {
      if (planIdNext) {
        planIdRef.current = planIdNext
        setActivePlanId(planIdNext)
      }
      setTasksLocked(prev => {
        if (prev === next) return prev
        if (withToast && readyForToast) {
          queueMicrotask(() => {
            toast.info(next ? 'День заблоковано' : 'День розблоковано')
          })
        }
        return next
      })
    }

    async function pullLock(withToast = false) {
      const { data } = await supabase
        .from('day_plans')
        .select('id, plan_tasks_locked, digest_sent_at, digest_receipts')
        .eq('team_id', teamId)
        .eq('plan_date', date)
        .maybeSingle()
      if (cancelled) return
      if (!data) {
        planIdRef.current = null
        setActivePlanId(null)
        return
      }
      applyLock(data.plan_tasks_locked === true, data.id, withToast)
      if (data.digest_sent_at) setDigestSentAt(data.digest_sent_at)
      if (data.digest_receipts) {
        setDigestReceipts(data.digest_receipts as DigestReceipts)
      }
    }

    function fieldIsDirty(rowKey: string, field: string) {
      return dirtyFieldsRef.current.has(`${rowKey}:${field}`)
    }

    function mergeRemoteRow(remote: Record<string, unknown>) {
      const remoteId = typeof remote.id === 'string' ? remote.id : undefined
      const employeeId = typeof remote.employee_id === 'string' ? remote.employee_id : undefined
      if (!employeeId) return

      setLocalRows(prev => {
        const idx = prev.findIndex(
          r => (remoteId && r.id === remoteId) || r.employee_id === employeeId
        )
        if (idx < 0) return prev
        const cur = prev[idx]
        const rowKey = cur.id || cur.employee_id
        const next: PlanRealtimeRow = { ...cur }
        let changed = false

        const takeStr = (field: 'shift' | 'planned' | 'completed' | 'notes', value: unknown) => {
          if (fieldIsDirty(rowKey, field)) return
          if (typeof value !== 'string') return
          if (next[field] === value) return
          next[field] = value
          changed = true
        }
        const takeStamp = (
          field: 'report_sent_at' | 'plan_email_sent_at' | 'plan_push_sent_at',
          value: unknown
        ) => {
          if (fieldIsDirty(rowKey, field)) return
          const v = typeof value === 'string' ? value : value === null ? null : undefined
          if (v === undefined || next[field] === v) return
          next[field] = v
          changed = true
        }

        if (remoteId && !cur.id) {
          next.id = remoteId
          changed = true
        }
        if (typeof remote.department_id === 'string' || remote.department_id === null) {
          if (!fieldIsDirty(rowKey, 'department_id') && next.department_id !== remote.department_id) {
            next.department_id = remote.department_id as string | null
            changed = true
          }
        }
        takeStr('shift', remote.shift)
        takeStr('planned', remote.planned)
        takeStr('completed', remote.completed)
        takeStr('notes', remote.notes)
        takeStamp('report_sent_at', remote.report_sent_at)
        takeStamp('plan_email_sent_at', remote.plan_email_sent_at)
        takeStamp('plan_push_sent_at', remote.plan_push_sent_at)
        if (remote.extra && typeof remote.extra === 'object') {
          const extraDirty = [...dirtyFieldsRef.current].some(k =>
            k.startsWith(`${rowKey}:extra`)
          )
          if (!extraDirty) {
            const extra = remote.extra as Record<string, string>
            if (JSON.stringify(extra) !== JSON.stringify(cur.extra)) {
              next.extra = extra
              changed = true
            }
          }
        }

        if (!changed) return prev
        const copy = [...prev]
        copy[idx] = next
        return copy
      })
    }

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'day_plans',
          filter: `team_id=eq.${teamId}`,
        },
        (payload: {
          eventType?: string
          new?: Record<string, unknown> | null
          old?: Record<string, unknown> | null
        }) => {
          if (payload.eventType === 'DELETE') {
            if (payload.old?.plan_date === date) {
              toast.info('План видалено')
              router.push('/admin')
            }
            return
          }
          const row = payload.new
          if (!row || row.plan_date !== date) return
          applyLock(
            row.plan_tasks_locked === true,
            typeof row.id === 'string' ? row.id : null,
            true
          )
          if (typeof row.digest_sent_at === 'string') setDigestSentAt(row.digest_sent_at)
          else if (row.digest_sent_at === null) setDigestSentAt(null)
          if (row.digest_receipts && typeof row.digest_receipts === 'object') {
            setDigestReceipts(row.digest_receipts as DigestReceipts)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_rows',
        },
        (payload: {
          eventType?: string
          new?: Record<string, unknown> | null
          old?: Record<string, unknown> | null
        }) => {
          const pid = planIdRef.current
          if (!pid) return
          const newPid = payload.new?.plan_id
          const oldPid = payload.old?.plan_id
          if (newPid !== pid && oldPid !== pid) return

          if (payload.eventType === 'DELETE') {
            const oldId = payload.old?.id
            const oldEmp = payload.old?.employee_id
            setLocalRows(prev =>
              prev.filter(r => r.id !== oldId && r.employee_id !== oldEmp)
            )
            return
          }
          if (payload.new) mergeRemoteRow(payload.new)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
        },
        (payload: {
          new?: Record<string, unknown> | null
          old?: Record<string, unknown> | null
        }) => {
          const remote = payload.new
          const id = typeof remote?.id === 'string' ? remote.id : undefined
          if (!id || !remote) return

          if (remote.last_sign_in_at) {
            onSignedInRef.current?.(id)
          }

          setLocalRows(prev => {
            const idx = prev.findIndex(r => r.employee_id === id)
            if (idx < 0) return prev
            const cur = prev[idx]
            const next: PlanRealtimeRow = { ...cur }
            let changed = false

            if (typeof remote.full_name === 'string') {
              const name = remote.full_name.trim() || 'Працівник'
              if (next.full_name !== name) {
                next.full_name = name
                changed = true
              }
            }
            if (typeof remote.email === 'string' && next.email !== remote.email) {
              next.email = remote.email
              changed = true
            }
            if ('avatar_url' in remote) {
              const url =
                typeof remote.avatar_url === 'string' ? remote.avatar_url : null
              if (next.avatar_url !== url) {
                next.avatar_url = url
                changed = true
              }
            }
            if (typeof remote.notify_email === 'boolean') {
              if (next.notify_email !== remote.notify_email) {
                next.notify_email = remote.notify_email
                changed = true
              }
            }
            if (typeof remote.notify_push === 'boolean') {
              if (next.notify_push !== remote.notify_push) {
                next.notify_push = remote.notify_push
                changed = true
              }
            }

            if (!changed) return prev
            const copy = [...prev]
            copy[idx] = next
            return copy
          })
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          void pullLock(false).then(() => {
            readyForToast = true
          })
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[plan-realtime]', topic, status)
        }
      })

    const onVis = () => {
      if (document.visibilityState === 'visible') void pullLock(false)
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, date])
}
