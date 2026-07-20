'use client'

import { usePushNotifications } from '@/lib/use-push-notifications'

export default function PushProvider() {
  usePushNotifications()
  return null
}
