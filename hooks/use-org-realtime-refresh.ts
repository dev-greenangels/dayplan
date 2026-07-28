'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ORG_CHANNEL_TOPIC } from '@/lib/realtime'

/**
 * Soft-refresh /admin and /admin/people when teams / members / admins change.
 *
 * Never listens to `profiles` — auth stamps last_sign_in_at/avatar on RSC loads;
 * that UPDATE + refresh caused infinite GET loops. Profile edits already
 * call router.refresh() from actions/UI.
 */
export function useOrgRealtimeRefresh(enabled = true) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRefreshAtRef = useRef(0)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const supabase = createClient()

    for (const ch of supabase.getChannels()) {
      const topic = typeof ch.topic === 'string' ? ch.topic : ''
      if (topic.includes(ORG_CHANNEL_TOPIC) || topic.includes('dayplan:org')) {
        void supabase.removeChannel(ch)
      }
    }

    const scheduleRefresh = () => {
      if (cancelled) return
      const now = Date.now()
      if (now - lastRefreshAtRef.current < 4000) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (cancelled) return
        lastRefreshAtRef.current = Date.now()
        routerRef.current.refresh()
      }, 600)
    }

    const topic = `${ORG_CHANNEL_TOPIC}:${Math.random().toString(36).slice(2, 9)}`
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teams' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_members' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_admins' },
        scheduleRefresh
      )
      .subscribe()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      void supabase.removeChannel(channel)
    }
  }, [enabled])
}
