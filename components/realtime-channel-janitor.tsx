'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ORG_CHANNEL_TOPIC } from '@/lib/realtime'

/**
 * Drops leftover org Realtime channels after Fast Refresh / HMR.
 * Old callbacks (profiles → router.refresh) can keep firing forever otherwise.
 */
export default function RealtimeChannelJanitor() {
  useEffect(() => {
    const supabase = createClient()
    for (const ch of supabase.getChannels()) {
      const topic = typeof ch.topic === 'string' ? ch.topic : ''
      if (topic.includes(ORG_CHANNEL_TOPIC) || topic.includes('dayplan:org')) {
        void supabase.removeChannel(ch)
      }
    }
  }, [])

  return null
}
