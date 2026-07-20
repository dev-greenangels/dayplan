'use client'

import { useEffect } from 'react'

export function usePushNotifications() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    async function register() {
      try {
        // Register service worker
        const reg = await navigator.serviceWorker.register('/sw.js')

        // Check if already subscribed
        const existing = await reg.pushManager.getSubscription()
        if (existing) return

        // Get VAPID public key
        const res = await fetch('/api/vapid-public-key')
        const { key } = await res.json()
        if (!key) return

        // Request permission
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return

        // Subscribe
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        })

        // Save to server
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

    register()
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
