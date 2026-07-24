import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type NotifyPrefs = { email: boolean; push: boolean }

/** Defaults to true when row/columns missing (pre-migration or unknown user). */
export async function getNotifyPrefsByUserIds(
  supabase: Supabase,
  userIds: string[]
): Promise<Map<string, NotifyPrefs>> {
  const map = new Map<string, NotifyPrefs>()
  const unique = [...new Set(userIds.filter(Boolean))]
  for (const id of unique) {
    map.set(id, { email: true, push: true })
  }
  if (unique.length === 0) return map

  const { data, error } = await supabase
    .from('profiles')
    .select('id, notify_email, notify_push')
    .in('id', unique)

  if (error) {
    // Column may not exist yet — keep defaults
    return map
  }

  for (const row of data ?? []) {
    map.set(row.id, {
      email: row.notify_email !== false,
      push: row.notify_push !== false,
    })
  }
  return map
}
