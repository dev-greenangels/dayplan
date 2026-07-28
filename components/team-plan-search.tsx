'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { searchTeamPlans, type TeamPlanSearchHit } from '@/app/actions/search'

type SearchCtx = {
  open: boolean
  toggle: () => void
  close: () => void
  teamId: string | null
  showSearch: boolean
}

const TeamPlanSearchContext = createContext<SearchCtx | null>(null)

export function useTeamPlanSearch() {
  const ctx = useContext(TeamPlanSearchContext)
  if (!ctx) {
    return {
      open: false,
      toggle: () => {},
      close: () => {},
      teamId: null as string | null,
      showSearch: false,
    }
  }
  return ctx
}

function parseTeamPlanPath(pathname: string): string | null {
  const m = pathname.match(/^\/teams\/([^/]+)\/plans\//)
  return m?.[1] ?? null
}

export function TeamPlanSearchProvider({
  children,
  enabled,
}: {
  children: ReactNode
  /** Admin/deputy may use search */
  enabled: boolean
}) {
  const pathname = usePathname()
  const teamId = parseTeamPlanPath(pathname)
  const showSearch = enabled && !!teamId
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const toggle = useCallback(() => {
    if (!showSearch) return
    setOpen(v => !v)
  }, [showSearch])

  const close = useCallback(() => setOpen(false), [])

  return (
    <TeamPlanSearchContext.Provider value={{ open, toggle, close, teamId, showSearch }}>
      {children}
    </TeamPlanSearchContext.Provider>
  )
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
    </svg>
  )
}

function CloseSearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export function TeamPlanSearchTrigger({ className }: { className?: string }) {
  const { open, toggle, close, showSearch } = useTeamPlanSearch()
  if (!showSearch) return null
  return (
    <button
      type="button"
      onClick={() => (open ? close() : toggle())}
      aria-expanded={open}
      aria-label={open ? 'Закрити пошук' : 'Пошук по планах'}
      title={open ? 'Закрити' : 'Пошук'}
      className={`tap-btn inline-flex items-center justify-center rounded-md border border-border/40 bg-primary/5 p-1.5 text-primary/80 active:!scale-[0.9] active:!opacity-75 ${
        open ? 'bg-primary/10 text-primary ring-1 ring-primary/15' : ''
      } ${className ?? ''}`}
    >
      {open ? (
        <CloseSearchIcon className="h-5 w-5 sm:h-4 sm:w-4" />
      ) : (
        <SearchIcon className="h-5 w-5 sm:h-4 sm:w-4" />
      )}
    </button>
  )
}

/** Overlay search panel under header bar — does not push sticky calendar/table. */
export function TeamPlanSearchPanel() {
  const { open, close, teamId, showSearch } = useTeamPlanSearch()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<TeamPlanSearchHit[]>([])
  const [pending, startTransition] = useTransition()
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
      setSearched(false)
      return
    }
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = panelRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        // Don't close when clicking search triggers (they toggle)
        const t = e.target as HTMLElement
        if (t.closest?.('[aria-label="Пошук по планах"], [aria-label="Закрити пошук"]')) return
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
    }
  }, [open, close])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!open || !teamId) return
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      setSearched(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const res = await searchTeamPlans(teamId, q)
        setHits(res.hits)
        setSearched(true)
      })
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, teamId, open])

  if (!showSearch || !open) return null

  return (
    <div
      ref={panelRef}
      className="absolute left-0 right-0 top-full z-[60] mt-1.5 overflow-hidden rounded-lg border border-white/30 px-3 pb-2.5 pt-2 shadow-xl sm:px-4"
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        WebkitBackdropFilter: 'blur(12px)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Пошук по планах…"
          className="w-full rounded-lg border border-border/50 bg-white/90 py-2 pl-3 pr-9 text-sm text-foreground outline-none ring-primary/20 focus:ring-2"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setHits([])
              setSearched(false)
              inputRef.current?.focus()
            }}
            className="tap-btn absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-label="Очистити"
            title="Очистити"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {(pending || searched || hits.length > 0) && (
        <ul className="mt-2 max-h-[min(50dvh,20rem)] overflow-y-auto rounded-lg border border-border/40 bg-white/70">
          {pending && hits.length === 0 ? (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">Пошук…</li>
          ) : hits.length === 0 && searched ? (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">Нічого не знайдено</li>
          ) : (
            hits.map((hit, i) => (
              <li key={`${hit.plan_date}-${hit.columnKey}-${hit.employeeName}-${i}`}>
                {i > 0 ? <div className="border-t border-border/35" /> : null}
                <button
                  type="button"
                  className="tap-btn flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-black/[0.04]"
                  onClick={() => {
                    if (!teamId) return
                    close()
                    router.push(`/teams/${teamId}/plans/${hit.plan_date}`)
                  }}
                >
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-semibold text-foreground">{hit.dateLabel}</span>
                    <span className="text-[11px] font-medium text-primary/90">{hit.columnLabel}</span>
                    <span className="text-[11px] text-muted-foreground">{hit.employeeName}</span>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{hit.snippet}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
