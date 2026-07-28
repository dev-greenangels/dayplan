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

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) reject(new Error('Не вдалося стиснути зображення'))
        else resolve(blob)
      },
      'image/webp',
      quality
    )
  })
}

export async function compressTaskPhoto(file: File): Promise<CompressedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Оберіть файл зображення')
  }
  const source = await loadImage(file)
  try {
    const full = drawScaled(source, FULL_MAX_HEIGHT * 2, FULL_MAX_HEIGHT)
    const thumb = drawScaled(source, THUMB_MAX_EDGE, THUMB_MAX_EDGE)
    const [fullBlob, thumbBlob] = await Promise.all([
      canvasToWebp(full.canvas, FULL_QUALITY),
      canvasToWebp(thumb.canvas, THUMB_QUALITY),
    ])
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
