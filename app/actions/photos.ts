'use server'

import { revalidatePath } from 'next/cache'
import { getSessionProfile, canManageTeam, getTeamAccess } from '@/lib/auth'
import type { TaskPhotoField, TaskRowPhoto } from '@/lib/types'

const MAX_PHOTOS = 3
const BUCKET = 'task-photos'

async function loadRowContext(rowId: string) {
  const ctx = await getSessionProfile()
  if (!ctx) return { error: 'Unauthorized' as const }

  const { data: row, error } = await ctx.supabase
    .from('task_rows')
    .select('id, employee_id, plan_id, day_plans!inner(id, team_id, plan_date)')
    .eq('id', rowId)
    .maybeSingle()

  if (error || !row) return { error: 'Рядок не знайдено' as const }

  const plan = row.day_plans as
    | { id: string; team_id: string; plan_date: string }
    | { id: string; team_id: string; plan_date: string }[]
  const planObj = Array.isArray(plan) ? plan[0] : plan
  if (!planObj) return { error: 'План не знайдено' as const }

  const isAdmin = await canManageTeam(ctx.supabase, ctx.profile, planObj.team_id)
  const isOwner = row.employee_id === ctx.user.id
  if (!isAdmin && !isOwner) return { error: 'Немає доступу' as const }

  return { ctx, row, plan: planObj, isAdmin, isOwner }
}

export async function uploadTaskPhoto(formData: FormData) {
  const rowId = String(formData.get('rowId') || '')
  const field = String(formData.get('field') || '') as TaskPhotoField
  const full = formData.get('full')
  const thumb = formData.get('thumb')

  if (!rowId || (field !== 'planned' && field !== 'completed')) {
    return { error: 'Невірні параметри' }
  }
  if (!(full instanceof File) || !(thumb instanceof File)) {
    return { error: 'Файл відсутній' }
  }
  if (full.type !== 'image/webp' || thumb.type !== 'image/webp') {
    return { error: 'Очікується WebP' }
  }

  const loaded = await loadRowContext(rowId)
  if ('error' in loaded && loaded.error) return { error: loaded.error }
  const { ctx, plan, isAdmin } = loaded as Exclude<Awaited<ReturnType<typeof loadRowContext>>, { error: string }>

  // Employees cannot upload to planned (admin-only field)
  if (field === 'planned' && !isAdmin) {
    return { error: 'Немає доступу' }
  }

  // Leadership may view photos always; upload gated by can_add_photos
  if (isAdmin) {
    const access = await getTeamAccess(ctx.supabase, ctx.profile, plan.team_id)
    if (!access.canAddPhotos) {
      return { error: 'Додавання фото вимкнено для вашого доступу' }
    }
  }

  const { count } = await ctx.supabase
    .from('task_row_photos')
    .select('id', { count: 'exact', head: true })
    .eq('task_row_id', rowId)
    .eq('field', field)

  if ((count ?? 0) >= MAX_PHOTOS) {
    return { error: 'Максимум 3 фото' }
  }

  const { data: existing } = await ctx.supabase
    .from('task_row_photos')
    .select('sort_order')
    .eq('task_row_id', rowId)
    .eq('field', field)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1
  const id = crypto.randomUUID()
  const base = `${plan.team_id}/${plan.id}/${rowId}/${field}/${id}`
  const storagePath = `${base}.webp`
  const thumbPath = `${base}_thumb.webp`

  const fullBuf = Buffer.from(await full.arrayBuffer())
  const thumbBuf = Buffer.from(await thumb.arrayBuffer())

  const { error: upFull } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(storagePath, fullBuf, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    })
  if (upFull) return { error: upFull.message }

  const { error: upThumb } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(thumbPath, thumbBuf, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    })
  if (upThumb) {
    await ctx.supabase.storage.from(BUCKET).remove([storagePath])
    return { error: upThumb.message }
  }

  const { data: inserted, error: insErr } = await ctx.supabase
    .from('task_row_photos')
    .insert({
      id,
      task_row_id: rowId,
      field,
      storage_path: storagePath,
      thumb_path: thumbPath,
      created_by: ctx.user.id,
      sort_order: nextOrder,
    })
    .select('id, task_row_id, field, storage_path, thumb_path, created_by, sort_order, created_at')
    .single()

  if (insErr || !inserted) {
    await ctx.supabase.storage.from(BUCKET).remove([storagePath, thumbPath])
    return { error: insErr?.message ?? 'Не вдалося зберегти' }
  }

  const { data: signed } = await ctx.supabase.storage
    .from(BUCKET)
    .createSignedUrl(thumbPath, 60 * 60)

  revalidatePath(`/teams/${plan.team_id}/plans/${plan.plan_date}`)
  return {
    success: true as const,
    photo: { ...inserted, thumb_url: signed?.signedUrl ?? null } as TaskRowPhoto,
  }
}

export async function deleteTaskPhoto(photoId: string) {
  const ctx = await getSessionProfile()
  if (!ctx) return { error: 'Unauthorized' }

  const { data: photo, error } = await ctx.supabase
    .from('task_row_photos')
    .select(
      'id, storage_path, thumb_path, task_row_id, task_rows!inner(employee_id, plan_id, day_plans!inner(team_id, plan_date))'
    )
    .eq('id', photoId)
    .maybeSingle()

  if (error || !photo) return { error: 'Фото не знайдено' }

  const row = photo.task_rows as
    | {
        employee_id: string
        plan_id: string
        day_plans: { team_id: string; plan_date: string } | { team_id: string; plan_date: string }[]
      }
    | {
        employee_id: string
        plan_id: string
        day_plans: { team_id: string; plan_date: string } | { team_id: string; plan_date: string }[]
      }[]
  const rowObj = Array.isArray(row) ? row[0] : row
  if (!rowObj) return { error: 'Рядок не знайдено' }
  const plan = Array.isArray(rowObj.day_plans) ? rowObj.day_plans[0] : rowObj.day_plans
  if (!plan) return { error: 'План не знайдено' }

  const isAdmin = await canManageTeam(ctx.supabase, ctx.profile, plan.team_id)
  const isOwner = rowObj.employee_id === ctx.user.id
  if (!isAdmin && !isOwner) return { error: 'Немає доступу' }

  await ctx.supabase.storage.from(BUCKET).remove([photo.storage_path, photo.thumb_path])
  const { error: delErr } = await ctx.supabase.from('task_row_photos').delete().eq('id', photoId)
  if (delErr) return { error: delErr.message }

  revalidatePath(`/teams/${plan.team_id}/plans/${plan.plan_date}`)
  return { success: true as const }
}

export async function getTaskPhotoFullUrl(photoId: string) {
  const ctx = await getSessionProfile()
  if (!ctx) return { error: 'Unauthorized' }

  const { data: photo, error } = await ctx.supabase
    .from('task_row_photos')
    .select('id, storage_path, task_row_id')
    .eq('id', photoId)
    .maybeSingle()

  if (error || !photo) return { error: 'Фото не знайдено' }

  // RLS on select already gates access
  const { data: signed, error: signErr } = await ctx.supabase.storage
    .from(BUCKET)
    .createSignedUrl(photo.storage_path, 60 * 10)

  if (signErr || !signed?.signedUrl) return { error: signErr?.message ?? 'Немає URL' }
  return { url: signed.signedUrl }
}

/** Load photos for all rows on a plan with signed thumb URLs. */
export async function listPlanPhotos(
  planId: string
): Promise<{ photos: TaskRowPhoto[]; error?: string }> {
  const ctx = await getSessionProfile()
  if (!ctx) return { photos: [], error: 'Unauthorized' }

  const { data: rows } = await ctx.supabase.from('task_rows').select('id').eq('plan_id', planId)
  const rowIds = (rows ?? []).map(r => r.id)
  if (rowIds.length === 0) return { photos: [] }

  const { data, error } = await ctx.supabase
    .from('task_row_photos')
    .select('id, task_row_id, field, storage_path, thumb_path, created_by, sort_order, created_at')
    .in('task_row_id', rowIds)
    .order('sort_order', { ascending: true })

  if (error) return { photos: [], error: error.message }

  const photos = (data ?? []) as TaskRowPhoto[]
  if (photos.length === 0) return { photos: [] }

  const { data: signed } = await ctx.supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      photos.map(p => p.thumb_path),
      60 * 60
    )

  const urlByPath = new Map<string, string>()
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
  }

  return {
    photos: photos.map(p => ({
      ...p,
      thumb_url: urlByPath.get(p.thumb_path) ?? null,
    })),
  }
}
