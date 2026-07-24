'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type ToastVariant = 'error' | 'info'

type ToastItem = {
  id: number
  message: string
  variant: ToastVariant
}

type ToastApi = {
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

let toastSeq = 0

function shortenError(raw: string, max = 96): string {
  let s = raw
    .replace(/^Помилка(?:\s+збереження)?:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  if (!s) s = 'Щось пішло не так'
  if (s.length > max) s = `${s.slice(0, max - 1)}…`
  return s
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((message: string, variant: ToastVariant) => {
    const id = ++toastSeq
    const text = variant === 'error' ? shortenError(message) : message.trim() || 'Готово'
    setItems(prev => [...prev.slice(-2), { id, message: text, variant }])
    window.setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id))
    }, 4200)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      error: (message: string) => push(message, 'error'),
      info: (message: string) => push(message, 'info'),
    }),
    [push]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-3"
        style={{ top: 'calc(var(--app-header-offset, 4.5rem) + 0.5rem)' }}
        aria-live="polite"
      >
        {items.map(t => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-[min(22rem,calc(100vw-1.5rem))] items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg ${
              t.variant === 'error'
                ? 'border-red-200/70 bg-red-50/55 text-red-900'
                : 'border-border/50 bg-white/55 text-foreground'
            }`}
            style={{
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
            }}
          >
            {t.variant === 'error' ? (
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-700">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
                </svg>
              </span>
            ) : null}
            <p className="min-w-0 flex-1 font-medium leading-snug">{t.message}</p>
            <button
              type="button"
              className="tap-btn -mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-current/50 hover:bg-black/5 hover:text-current"
              aria-label="Закрити"
              onClick={() => setItems(prev => prev.filter(x => x.id !== t.id))}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return {
      error: () => {},
      info: () => {},
    }
  }
  return ctx
}
