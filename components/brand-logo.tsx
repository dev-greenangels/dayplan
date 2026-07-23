/** App brand mark — PNG from /public PWA icons. */

export default function BrandLogo({
  size = 32,
  className = '',
  rounded = 'rounded-lg',
}: {
  size?: number
  className?: string
  rounded?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/web-app-manifest-192x192.png"
      alt="PlanDay-GA"
      width={size}
      height={size}
      className={`${rounded} object-cover shadow-sm ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
