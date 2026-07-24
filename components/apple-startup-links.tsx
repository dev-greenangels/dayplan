import startupImages from '../public/splash/startup-images.json'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || ''

function splashHref(path: string) {
  // Absolute only on real deploy hosts — localhost absolute URLs break iOS install.
  if (siteUrl && !/localhost|127\.0\.0\.1/.test(siteUrl)) {
    return `${siteUrl}${path}`
  }
  return path
}

/**
 * Explicit <link rel="apple-touch-startup-image"> tags.
 * Next metadata omits `sizes` / `screen and` details that iOS often requires.
 */
export default function AppleStartupLinks() {
  return (
    <>
      {startupImages.map(img => (
        <link
          key={`${img.sizes}-${img.media}`}
          rel="apple-touch-startup-image"
          href={splashHref(img.url)}
          media={img.media}
          sizes={img.sizes}
        />
      ))}
    </>
  )
}
