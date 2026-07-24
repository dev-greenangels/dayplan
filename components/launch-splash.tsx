'use client'

import { useEffect, useState } from 'react'

/**
 * Client splash for standalone PWA only.
 * Must not remove DOM outside React (that caused insertBefore/removeChild crashes).
 */
export default function LaunchSplash() {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      !!(window.navigator as any).standalone

    if (!standalone) return

    setVisible(true)
    const leave = window.setTimeout(() => setLeaving(true), 700)
    const hide = window.setTimeout(() => setVisible(false), 1100)
    return () => {
      window.clearTimeout(leave)
      window.clearTimeout(hide)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      className={`ios-launch-splash ios-launch-splash-on ${leaving ? 'ios-launch-splash-leaving' : ''}`}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/green-angels-logo.png"
        alt=""
        className="ios-launch-splash-logo"
        width={220}
        height={85}
      />
      <p className="ios-launch-splash-title">Green Angels</p>
      <p className="ios-launch-splash-subtitle">PlanDay</p>
    </div>
  )
}
