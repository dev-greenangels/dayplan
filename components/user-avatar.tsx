'use client'

import { useState } from 'react'

/** Circular avatar with Google photo or initials / user-icon placeholder. */
export default function UserAvatar({
  url,
  name,
  size = 32,
  className = '',
}: {
  url?: string | null
  name?: string | null
  size?: number
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const initials = (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('')

  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }

  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full object-cover bg-muted ${className}`}
        style={style}
      />
    )
  }

  if (initials) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary ${className}`}
        style={style}
        aria-hidden
      >
        {initials}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ${className}`}
      style={style}
      aria-hidden
    >
      <svg
        width={Math.round(size * 0.55)}
        height={Math.round(size * 0.55)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </span>
  )
}

/** Small bell: active = device push subscribed. */
export function PushStatusBell({
  active,
  className = '',
}: {
  active: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 ${active ? 'text-violet-600' : 'text-muted-foreground/45'} ${className}`}
      title={active ? 'Push увімкнено на пристрої' : 'Push не активовано'}
      aria-label={active ? 'Push увімкнено' : 'Push не активовано'}
    >
      {active ? (
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.73 21a2 2 0 01-3.46 0M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M1 1l22 22" />
        </svg>
      )}
    </span>
  )
}
