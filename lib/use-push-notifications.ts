'use client'

import { useCallback, useEffect, useState } from 'react'

export type PushStatus =
  | 'loading'
  | 'unsupported'
  | 'unavailable'
  | 'need-permission'
  | 'denied'
  | 'subscribed'

async function saveSubscription(sub: PushSubscription) {
  const subJson = sub.toJSON()
  const res = await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subJson),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(typeof body.error === 'string' ? body.error : 'Не вдалося зберегти підписку')
  }
}

async function fetchVapidKey(): Promise<string | null> {
  const res = await fetch('/api/vapid-public-key')
  if (!res.ok) return null
  const { key } = await res.json()
  return typeof key === 'string' && key.length > 0 ? key : null
}

async function subscribeWithKey(reg: ServiceWorkerRegistration, key: string) {
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  })
}

/**
 * Registers the SW, syncs an existing browser subscription to the DB,
 * and exposes `enable()` for a user-gesture permission prompt.
 * Browsers no longer show Notification.requestPermission() on page load alone.
 */
export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  const sync = useCallback(async (interactive: boolean) => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setStatus('unsupported')
      return
    }

    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const key = await fetchVapidKey()
      if (!key) {
        setStatus('unavailable')
        setError('Push не налаштовано на сервері (VAPID)')
        return
      }

      if (Notification.permission === 'denied') {
        setStatus('denied')
        setError('Дозвіл на сповіщення заблоковано в налаштуваннях браузера')
        return
      }

      let sub = await reg.pushManager.getSubscription()

      if (Notification.permission === 'granted') {
        if (!sub) {
          sub = await subscribeWithKey(reg, key)
        }
        await saveSubscription(sub)
        setError(null)
        setStatus('subscribed')
        return
      }

      // permission === 'default'
      if (!interactive) {
        setStatus('need-permission')
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'need-permission')
        setError(permission === 'denied' ? 'Дозвіл на сповіщення відхилено' : null)
        return
      }

      sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await subscribeWithKey(reg, key)
      }
      await saveSubscription(sub)
      setError(null)
      setStatus('subscribed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка підписки на push')
      setStatus(prev => (prev === 'subscribed' ? prev : 'need-permission'))
    }
  }, [])

  useEffect(() => {
    void sync(false)
  }, [sync])

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'NOTIFICATION_NAVIGATE' || typeof data.url !== 'string') return
      const url = data.url.trim()
      if (!url.startsWith('/')) return
      if (window.location.pathname + window.location.search === url) return
      window.location.assign(url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  const enable = useCallback(async () => {
    setError(null)
    await sync(true)
  }, [sync])

  return { status, error, enable }
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
