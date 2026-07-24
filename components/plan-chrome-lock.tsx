'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type PlanChromeLockApi = {
  chromeBlocked: boolean
  setChromeBlocked: (blocked: boolean) => void
}

const PlanChromeLockContext = createContext<PlanChromeLockApi | null>(null)

export function PlanChromeLockProvider({ children }: { children: ReactNode }) {
  const [chromeBlocked, setChromeBlockedState] = useState(false)
  const setChromeBlocked = useCallback((blocked: boolean) => {
    setChromeBlockedState(blocked)
  }, [])
  const value = useMemo(
    () => ({ chromeBlocked, setChromeBlocked }),
    [chromeBlocked, setChromeBlocked]
  )
  return (
    <PlanChromeLockContext.Provider value={value}>
      {children}
    </PlanChromeLockContext.Provider>
  )
}

export function usePlanChromeLock(): PlanChromeLockApi {
  const ctx = useContext(PlanChromeLockContext)
  if (!ctx) {
    return { chromeBlocked: false, setChromeBlocked: () => {} }
  }
  return ctx
}
