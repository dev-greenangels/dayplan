'use client'

import { useEffect } from 'react'

export function usePushNotifications() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    let cancelled = false

    async function register() {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')
        if (cancelled) return

        const existing = await reg.pushManager.getSubscription()
        if (existing || cancelled) return

        const res = await fetch('/api/vapid-public-key')
        if (cancelled) return
        const { key } = await res.json()
        if (!key || cancelled) return

        const permission = await Notification.requestPermission()
        if (permission !== 'granted' || cancelled) return

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        })
        if (cancelled) return

        const subJson = sub.toJSON()
        await fetch('/api/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subJson),
        })
      } catch {
        // Silent fail — push is optional
      }
    }

    void register()
    return () => {
      cancelled = true
    }
  }, [])
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
