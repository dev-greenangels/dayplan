'use client'

import { useRef, useState, useTransition } from 'react'
import Modal from '@/components/modal'
import { compressTaskPhoto } from '@/lib/image-compress'
import {
  deleteTaskPhoto,
  getTaskPhotoFullUrl,
  uploadTaskPhoto,
} from '@/app/actions/photos'
import type { TaskPhotoField, TaskRowPhoto } from '@/lib/types'
import { useToast } from '@/components/toast-provider'

export default function FieldPhotos({
  rowId,
  field,
  photos,
  canUpload,
  canDelete,
  onChange,
}: {
  rowId: string
  field: TaskPhotoField
  photos: TaskRowPhoto[]
  canUpload: boolean
  canDelete: boolean
  onChange: (next: TaskRowPhoto[]) => void
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [lightbox, setLightbox] = useState<{ id: string; url: string } | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [sourceMenu, setSourceMenu] = useState(false)

  const atLimit = photos.length >= 3

  function pickCamera() {
    setSourceMenu(false)
    cameraRef.current?.click()
  }
  function pickGallery() {
    setSourceMenu(false)
    galleryRef.current?.click()
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !rowId) return
    startTransition(async () => {
      try {
        const compressed = await compressTaskPhoto(file)
        const fd = new FormData()
        fd.set('rowId', rowId)
        fd.set('field', field)
        fd.set('full', new File([compressed.full], 'full.webp', { type: compressed.full.type || 'image/webp' }))
        fd.set('thumb', new File([compressed.thumb], 'thumb.webp', { type: compressed.thumb.type || 'image/webp' }))
        const res = await uploadTaskPhoto(fd)
        if (res.error || !res.photo) {
          toast.error(res.error ?? 'Помилка завантаження')
          return
        }
        onChange([...photos, res.photo])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Помилка фото')
      }
    })
  }

  function openPhoto(photo: TaskRowPhoto) {
    setLoadingFull(true)
    startTransition(async () => {
      const res = await getTaskPhotoFullUrl(photo.id)
      setLoadingFull(false)
      if (res.error || !('url' in res) || !res.url) {
        toast.error(res.error ?? 'Не вдалося відкрити')
        return
      }
      setLightbox({ id: photo.id, url: res.url })
    })
  }

  function removePhoto(photoId: string) {
    startTransition(async () => {
      const res = await deleteTaskPhoto(photoId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      onChange(photos.filter(p => p.id !== photoId))
      setLightbox(null)
    })
  }

  if (!rowId && photos.length === 0 && !canUpload) return null

  const addTone =
    field === 'planned'
      ? 'border-sky-400/80 bg-sky-50 text-sky-800 hover:bg-sky-100/80'
      : 'border-emerald-400/80 bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80'

  return (
    <div className="mt-1.5 flex w-full flex-wrap items-center gap-1.5">
      {photos.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => openPhoto(p)}
          className="tap-btn relative h-11 w-11 overflow-hidden rounded-md border border-border/60 bg-muted/40"
          title="Відкрити фото"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.thumb_url || undefined}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </button>
      ))}
      {canUpload && (
        <div className="relative ml-auto">
          <button
            type="button"
            disabled={atLimit || pending || !rowId}
            onClick={() => setSourceMenu(v => !v)}
            className={`tap-btn inline-flex h-11 items-center gap-1 rounded-md border border-dashed px-2.5 text-[11px] font-semibold disabled:opacity-40 ${addTone}`}
            title={atLimit ? 'Максимум 3 фото' : !rowId ? 'Спочатку збережіть рядок' : 'Додати фото'}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Фото
          </button>
          {sourceMenu && (
            <>
              {/* backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => setSourceMenu(false)} />
              <div className="absolute right-0 bottom-full z-50 mb-1 flex min-w-[150px] flex-col overflow-hidden rounded-lg border border-border bg-white shadow-lg">
                <button
                  type="button"
                  onClick={pickCamera}
                  className="tap-btn px-3 py-2.5 text-left text-xs font-medium hover:bg-muted/50"
                >
                  📷 Камера
                </button>
                <button
                  type="button"
                  onClick={pickGallery}
                  className="tap-btn px-3 py-2.5 text-left text-xs font-medium hover:bg-muted/50"
                >
                  🖼 З галереї
                </button>
              </div>
            </>
          )}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onFile}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="hidden"
            onChange={onFile}
          />
        </div>
      )}

      <Modal
        open={!!lightbox}
        onClose={() => setLightbox(null)}
        title="Фото"
        wide
      >
        {lightbox && (
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt=""
              className="max-h-[70dvh] w-full rounded-lg object-contain bg-black/5"
            />
            {canDelete && (
              <button
                type="button"
                disabled={pending}
                onClick={() => removePhoto(lightbox.id)}
                className="tap-btn rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
              >
                Видалити фото
              </button>
            )}
            {loadingFull && (
              <p className="text-xs text-muted-foreground">Завантаження…</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
