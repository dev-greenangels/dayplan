/**
 * Generates iOS apple-touch-startup-image PNGs.
 * Run: node scripts/generate-splash.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const outDir = path.join(root, 'public', 'splash')
const logoPath = path.join(root, 'public', 'green-angels-logo.png')

/** Portrait splash sizes: [width, height, cssWidth, cssHeight, dpr] */
const SIZES = [
  // iPhone SE / 8 / 7 / 6s
  [640, 1136, 320, 568, 2],
  [750, 1334, 375, 667, 2],
  [1242, 2208, 414, 736, 3],
  // iPhone X / XS / 11 Pro
  [1125, 2436, 375, 812, 3],
  // iPhone XR / 11
  [828, 1792, 414, 896, 2],
  // iPhone XS Max / 11 Pro Max
  [1242, 2688, 414, 896, 3],
  // iPhone 12/13 mini
  [1080, 2340, 360, 780, 3],
  // iPhone 12/13/14
  [1170, 2532, 390, 844, 3],
  // iPhone 12/13/14 Pro Max / 14 Plus
  [1284, 2778, 428, 926, 3],
  // iPhone 14 Pro / 15 / 15 Pro / 16
  [1179, 2556, 393, 852, 3],
  // iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus
  [1290, 2796, 430, 932, 3],
  // iPhone 16 Pro
  [1206, 2622, 402, 874, 3],
  // iPhone 16 Pro Max
  [1320, 2868, 440, 956, 3],
  // iPad mini / Air portrait
  [1536, 2048, 768, 1024, 2],
  [1668, 2224, 834, 1112, 2],
  [1668, 2388, 834, 1194, 2],
  [2048, 2732, 1024, 1366, 2],
]

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function composeSplash(width, height) {
  const logoMaxW = Math.round(width * 0.42)
  const logo = await sharp(logoPath)
    .resize({ width: logoMaxW, withoutEnlargement: true })
    .png()
    .toBuffer()
  const logoMeta = await sharp(logo).metadata()
  const logoW = logoMeta.width ?? logoMaxW
  const logoH = logoMeta.height ?? Math.round(logoMaxW * 0.385)

  const titleSize = Math.round(width * 0.055)
  const subSize = Math.round(width * 0.038)
  const gap = Math.round(height * 0.022)
  const titleY = Math.round(height * 0.48 + logoH / 2 + gap)
  const subY = titleY + titleSize + Math.round(gap * 0.55)
  const logoLeft = Math.round((width - logoW) / 2)
  const logoTop = Math.round(height * 0.48 - logoH / 2 - gap)

  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#d4edda"/>
      <stop offset="40%" stop-color="#e8f5e9"/>
      <stop offset="100%" stop-color="#c8e6c9"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <text x="50%" y="${titleY}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${titleSize}" font-weight="700" fill="#2d6a4f" filter="drop-shadow(0 2px 4px rgba(45,106,79,0.28))">${escapeXml('Green Angels')}</text>
  <text x="50%" y="${subY}" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${subSize}" font-weight="600" fill="#4a7c59" letter-spacing="0.04em">${escapeXml('PlanDay')}</text>
</svg>`)

  return sharp(svg)
    .composite([{ input: logo, left: logoLeft, top: logoTop }])
    .png()
    .toBuffer()
}

fs.mkdirSync(outDir, { recursive: true })

const entries = []
for (const [w, h, cssW, cssH, dpr] of SIZES) {
  const name = `apple-splash-${w}-${h}.png`
  const buf = await composeSplash(w, h)
  fs.writeFileSync(path.join(outDir, name), buf)
  entries.push({
    url: `/splash/${name}`,
    media: `(device-width: ${cssW}px) and (device-height: ${cssH}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
  })
  console.log('wrote', name)
}

fs.writeFileSync(
  path.join(outDir, 'startup-images.json'),
  JSON.stringify(entries, null, 2)
)
console.log('done,', entries.length, 'images')
