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

function isGoneSubscription(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const status = 'statusCode' in err ? Number((err as { statusCode?: number }).statusCode) : NaN
  return status === 404 || status === 410
}

async function deleteSubscription(supabase: Supabase, endpoint: string) {
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
}

/** Recipients for leadership digest / employee report: only team_admins for this team. */
export async function getTeamLeadersForNotify(
  supabase: Supabase,
  teamId: string
): Promise<{ user_id: string; notify_email: boolean; notify_push: boolean }[]> {
  const { data: deputies } = await supabase
    .from('team_admins')
    .select('user_id, notify_email, notify_push')
    .eq('team_id', teamId)
  const byId = new Map<string, { user_id: string; notify_email: boolean; notify_push: boolean }>()
  for (const d of deputies ?? []) {
    byId.set(d.user_id, {
      user_id: d.user_id,
      notify_email: d.notify_email !== false,
      notify_push: d.notify_push !== false,
    })
  }
  return [...byId.values()]
}

/**
 * Recipients for «tasks were sent to workers» ack push:
 * team_admins for the team + every super_admin (even if not listed on the team).
 */
export async function getWorkerSendAckUserIds(
  supabase: Supabase,
  teamId: string
): Promise<string[]> {
  const leaders = await getTeamLeadersForNotify(supabase, teamId)
  const ids = new Set(leaders.map(l => l.user_id))
  const { data: bosses } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'super_admin')
  for (const b of bosses ?? []) {
    if (b.id) ids.add(b.id)
  }
  return [...ids]
}

export async function getTeamLeaderUserIds(supabase: Supabase, teamId: string): Promise<string[]> {
  return (await getTeamLeadersForNotify(supabase, teamId)).map(d => d.user_id)
}

export async function sendPushToUserIds(
  supabase: Supabase,
  userIds: string[],
  payload: { title: string; body: string; icon?: string; url?: string }
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
            icon: payload.icon ?? '/web-app-manifest-192x192.png',
            url: payload.url || '/',
          })
        )
        sent++
      } catch (err) {
        if (isGoneSubscription(err)) {
          await deleteSubscription(supabase, sub.endpoint)
        }
      }
    })
  )
  return sent
}

/** Per-user payloads (e.g. different plan text per employee). Returns unique user ids that got at least one push. */
export async function sendPushPerUser(
  supabase: Supabase,
  items: { userId: string; title: string; body: string; url?: string }[]
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
            icon: '/web-app-manifest-192x192.png',
            url: item.url || '/',
          })
        )
        pushed.add(sub.user_id)
      } catch (err) {
        if (isGoneSubscription(err)) {
          await deleteSubscription(supabase, sub.endpoint)
        }
      }
    })
  )
  return [...pushed]
}
