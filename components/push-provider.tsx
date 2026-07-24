'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { usePushNotifications, type PushStatus } from '@/lib/use-push-notifications'

type PushContextValue = {
  status: PushStatus
  error: string | null
  enable: () => Promise<void>
}

const PushContext = createContext<PushContextValue | null>(null)

export function usePush() {
  const ctx = useContext(PushContext)
  if (!ctx) {
    throw new Error('usePush must be used within PushProvider')
  }
  return ctx
}

export default function PushProvider({ children }: { children: ReactNode }) {
  const value = usePushNotifications()

  return (
    <PushContext.Provider value={value}>
      {children}
      {value.status === 'need-permission' && (
        <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="boty-glass mx-auto flex max-w-lg items-center gap-3 rounded-xl px-4 py-3 shadow-lg">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Увімкнути сповіщення?</p>
              <p className="text-xs text-muted-foreground">
                Щоб отримувати push про плани та звіти — потрібен ваш дозвіл.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void value.enable()}
              className="tap-btn shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Увімкнути
            </button>
          </div>
        </div>
      )}
    </PushContext.Provider>
  )
}
