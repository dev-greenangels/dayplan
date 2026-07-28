/**
 * Realtime channel naming — keep ≤ a few channels per browser tab
 * (Supabase limit: 100 channels per connection, not per topic).
 *
 * Topics are shared: many users join the same plan/admin channel.
 */
export function planChannelTopic(teamId: string, date: string) {
  return `dayplan:plan:${teamId}:${date}`
}

/** Single org channel for /admin and /admin/people (structural refresh). */
export const ORG_CHANNEL_TOPIC = 'dayplan:org'
