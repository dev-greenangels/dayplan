/** Client-side image resize + WebP encode for task photos. */

export type CompressedPhoto = {
  full: Blob
  thumb: Blob
  width: number
  height: number
}

const FULL_MAX_HEIGHT = 1000
const THUMB_MAX_EDGE = 180
const FULL_QUALITY = 0.72
const THUMB_QUALITY = 0.65
/** Keep full+thumb safely under Server Action limit (multipart overhead ~20 KB) */
const MAX_TOTAL_BYTES = 850_000

function loadImage(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => loadViaImageElement(file))
  }
  return loadViaImageElement(file)
}

function loadViaImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Не вдалося прочитати зображення. Спробуйте JPEG або PNG.'))
    }
    img.src = url
  })
}

function drawScaled(
  source: HTMLImageElement | ImageBitmap,
  maxW: number,
  maxH: number
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const sw = 'naturalWidth' in source ? source.naturalWidth || source.width : source.width
  const sh = 'naturalHeight' in source ? source.naturalHeight || source.height : source.height
  const scale = Math.min(1, maxW / sw, maxH / sh)
  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas недоступний')
  ctx.drawImage(source, 0, 0, width, height)
  return { canvas, width, height }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) reject(new Error('Не вдалося стиснути зображення'))
        else resolve(blob)
      },
      mime,
      quality
    )
  })
}

async function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await canvasToBlob(canvas, 'image/webp', quality)
  if (blob.type === 'image/webp') return blob
  // Safari fallback: try JPEG if WebP unsupported
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality)
  return jpeg
}

export async function compressTaskPhoto(file: File): Promise<CompressedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Оберіть файл зображення')
  }
  const source = await loadImage(file)
  try {
    const full = drawScaled(source, FULL_MAX_HEIGHT * 2, FULL_MAX_HEIGHT)
    const thumb = drawScaled(source, THUMB_MAX_EDGE, THUMB_MAX_EDGE)

    let quality = FULL_QUALITY
    let fullBlob = await canvasToWebp(full.canvas, quality)
    const thumbBlob = await canvasToWebp(thumb.canvas, THUMB_QUALITY)

    // Adaptive: reduce quality until combined size fits
    let attempts = 0
    while (fullBlob.size + thumbBlob.size > MAX_TOTAL_BYTES && quality > 0.30 && attempts < 5) {
      quality -= 0.10
      fullBlob = await canvasToWebp(full.canvas, quality)
      attempts++
    }

    if (fullBlob.size + thumbBlob.size > MAX_TOTAL_BYTES * 3) {
      throw new Error('Зображення занадто велике навіть після стиснення')
    }

    return {
      full: fullBlob,
      thumb: thumbBlob,
      width: full.width,
      height: full.height,
    }
  } finally {
    if ('close' in source && typeof source.close === 'function') source.close()
  }
}
