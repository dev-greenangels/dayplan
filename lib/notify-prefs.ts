import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type NotifyPrefs = {
  email: boolean
  push: boolean
  /** Leaders / шеф: ack push when workers receive tasks (default true). Шеф gets it even outside team_admins. */
  workerSendPush: boolean
}

/**
 * Effective channels for a team leader:
 * profile (global card) AND team_admins (per-team). Either OFF → no send.
 */
export function effectiveLeaderNotifyPrefs(
  teamFlags: { notify_email?: boolean | null; notify_push?: boolean | null },
  profile: Pick<NotifyPrefs, 'email' | 'push'> | undefined
): { email: boolean; push: boolean } {
  return {
    email: teamFlags.notify_email !== false && profile?.email !== false,
    push: teamFlags.notify_push !== false && profile?.push !== false,
  }
}

/** Defaults to true when row/columns missing (pre-migration or unknown user). */
export async function getNotifyPrefsByUserIds(
  supabase: Supabase,
  userIds: string[]
): Promise<Map<string, NotifyPrefs>> {
  const map = new Map<string, NotifyPrefs>()
  const unique = [...new Set(userIds.filter(Boolean))]
  for (const id of unique) {
    map.set(id, { email: true, push: true, workerSendPush: true })
  }
  if (unique.length === 0) return map

  const { data, error } = await supabase
    .from('profiles')
    .select('id, notify_email, notify_push, notify_worker_send_push')
    .in('id', unique)

  if (error) {
    // Column may not exist yet — try without worker flag
    const fallback = await supabase
      .from('profiles')
      .select('id, notify_email, notify_push')
      .in('id', unique)
    if (fallback.error) return map
    for (const row of fallback.data ?? []) {
      map.set(row.id, {
        email: row.notify_email !== false,
        push: row.notify_push !== false,
        workerSendPush: true,
      })
    }
    return map
  }

  for (const row of data ?? []) {
    map.set(row.id, {
      email: row.notify_email !== false,
      push: row.notify_push !== false,
      workerSendPush: row.notify_worker_send_push !== false,
    })
  }
  return map
}
