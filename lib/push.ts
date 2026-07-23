import webpush from 'web-push'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

let vapidReady = false

function ensureVapid() {
  if (vapidReady) return true
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails(
    `mailto:${process.env.GMAIL_USER ?? 'admin@example.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
  vapidReady = true
  return true
}

export function isPushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export async function getTeamLeaderUserIds(supabase: Supabase, teamId: string): Promise<string[]> {
  const [{ data: superAdmins }, { data: deputies }] = await Promise.all([
    supabase.from('profiles').select('id').eq('role', 'super_admin'),
    supabase.from('team_admins').select('user_id').eq('team_id', teamId),
  ])
  return [...new Set([
    ...(superAdmins ?? []).map(a => a.id),
    ...(deputies ?? []).map(d => d.user_id),
  ])]
}

export async function sendPushToUserIds(
  supabase: Supabase,
  userIds: string[],
  payload: { title: string; body: string; icon?: string }
): Promise<number> {
  if (!ensureVapid() || userIds.length === 0) return 0

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  let sent = 0
  await Promise.all(
    (subs ?? []).map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            icon: payload.icon ?? '/icon-192.png',
          })
        )
        sent++
      } catch {
        // ignore
      }
    })
  )
  return sent
}

/** Per-user payloads (e.g. different plan text per employee). Returns unique user ids that got at least one push. */
export async function sendPushPerUser(
  supabase: Supabase,
  items: { userId: string; title: string; body: string }[]
): Promise<string[]> {
  if (!ensureVapid() || items.length === 0) return []
  const byUser = new Map(items.map(i => [i.userId, i]))
  const userIds = [...byUser.keys()]

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  const pushed = new Set<string>()
  await Promise.all(
    (subs ?? []).map(async sub => {
      const item = byUser.get(sub.user_id)
      if (!item) return
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: item.title,
            body: item.body,
            icon: '/icon-192.png',
          })
        )
        pushed.add(sub.user_id)
      } catch {
        // ignore
      }
    })
  )
  return [...pushed]
}
