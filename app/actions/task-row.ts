'use server'

import { createClient } from '@/lib/supabase/server'

export async function updateTaskRow(
  rowId: string,
  updates: Partial<{
    planned: string
    completed: string
    notes: string
    shift: string
    notified: boolean
  }>
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('task_rows')
    .update(updates)
    .eq('id', rowId)

  if (error) {
    return { error: error.message }
  }
  return { success: true }
}

export async function deleteTaskRow(rowId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('task_rows').delete().eq('id', rowId)
  if (error) return { error: error.message }
  return { success: true }
}
