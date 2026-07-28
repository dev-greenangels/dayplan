self.addEventListener('install', event => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', function (event) {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'PlanDay-GA', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'PlanDay-GA'
  const options = {
    body: data.body || '',
    icon: data.icon || '/web-app-manifest-192x192.png',
    // Android status-bar / left icon: white silhouette on transparent (not a color logo)
    badge: data.badge || '/notification-badge.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client && typeof client.navigate === 'function') {
            try {
              await client.navigate(targetUrl)
              return
            } catch {
              // fall through to openWindow
            }
          }
          // Older clients: postMessage so the app can router.push
          client.postMessage({ type: 'NOTIFICATION_NAVIGATE', url: targetUrl })
          return
        }
      }
      if (clients.openWindow) {
        await clients.openWindow(targetUrl)
      }
    })()
  )
})
