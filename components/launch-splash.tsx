'use client'

import { useEffect, useState } from 'react'

export default function LaunchSplash() {
  const [leaving, setLeaving] = useState(false)
  const [removed, setRemoved] = useState(false)

  useEffect(() => {
    const start = window.setTimeout(() => setLeaving(true), 250)
    const remove = window.setTimeout(() => setRemoved(true), 650)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(remove)
    }
  }, [])

  if (removed) return null

  return (
    <div
      className={`ios-launch-splash ${leaving ? 'ios-launch-splash-leaving' : ''}`}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/green-angels-logo.png"
        alt=""
        className="ios-launch-splash-logo"
      />
      <p className="ios-launch-splash-title">Green Angels</p>
      <p className="ios-launch-splash-subtitle">PlanDay</p>
    </div>
  )
}
