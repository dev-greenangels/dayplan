'use server'

import { revalidatePath } from 'next/cache'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function updateMyAccountSettings(opts: {
  full_name?: string
  notify_email?: boolean
  notify_push?: boolean
}) {
  const ctx = await getSessionProfile()
  if (!ctx) return { error: 'Unauthorized' }

  const payload: {
    full_name?: string
    notify_email?: boolean
    notify_push?: boolean
  } = {}

  if (typeof opts.full_name === 'string') {
    const trimmed = opts.full_name.trim()
    if (!trimmed) return { error: 'ПІБ обовʼязкове' }
    payload.full_name = trimmed
  }
  if (typeof opts.notify_email === 'boolean') payload.notify_email = opts.notify_email
  if (typeof opts.notify_push === 'boolean') payload.notify_push = opts.notify_push

  if (Object.keys(payload).length === 0) return { error: 'Немає змін' }

  // Employees cannot self-update profiles via RLS — use admin client for allowed fields only
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('profiles').update(payload).eq('id', ctx.user.id)
    if (error) return { error: error.message }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не вдалося зберегти'
    return { error: message }
  }

  revalidatePath('/', 'layout')
  return { success: true as const }
}
