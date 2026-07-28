'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { usePathname } from 'next/navigation'
import { daysInMonth, formatUkMonthYear, todayISO } from '@/lib/format-date'

export type PlanScheduleChromeState = {
  date: string
  dateLabelNoYear: string
  showLock: boolean
  tasksLocked: boolean
  lockBusy: boolean
  onToggleLock: () => void
  isDayAllowed: (day: string) => boolean
  goToDate: (day: string) => void
}

type Ctx = {
  chrome: PlanScheduleChromeState | null
  setChrome: Dispatch<SetStateAction<PlanScheduleChromeState | null>>
  datePickerOpen: boolean
  setDatePickerOpen: Dispatch<SetStateAction<boolean>>
}

const PlanScheduleChromeContext = createContext<Ctx | null>(null)

export function PlanScheduleChromeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [chrome, setChrome] = useState<PlanScheduleChromeState | null>(null)
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  useEffect(() => {
    setChrome(null)
    setDatePickerOpen(false)
  }, [pathname])

  const value = useMemo(
    () => ({ chrome, setChrome, datePickerOpen, setDatePickerOpen }),
    [chrome, datePickerOpen]
  )

  return (
    <PlanScheduleChromeContext.Provider value={value}>
      {children}
    </PlanScheduleChromeContext.Provider>
  )
}

export function usePlanScheduleChromeHost() {
  const ctx = useContext(PlanScheduleChromeContext)
  if (!ctx) {
    return {
      setChrome: (() => {}) as Dispatch<SetStateAction<PlanScheduleChromeState | null>>,
      datePickerOpen: false,
      setDatePickerOpen: (() => {}) as Dispatch<SetStateAction<boolean>>,
    }
  }
  return {
    setChrome: ctx.setChrome,
    datePickerOpen: ctx.datePickerOpen,
    setDatePickerOpen: ctx.setDatePickerOpen,
  }
}

export function usePlanScheduleChrome() {
  return useContext(PlanScheduleChromeContext)
}

/** Shared month calendar popover body. */
export function PlanMonthCalendarGrid({
  pickerMonth,
  setPickerMonth,
  selectedDate,
  isDayAllowed,
  onSelect,
}: {
  pickerMonth: string
  setPickerMonth: (m: string) => void
  selectedDate: string
  isDayAllowed: (day: string) => boolean
  onSelect: (day: string) => void
}) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="tap-btn rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm font-semibold"
          onClick={() => {
            const [y, m] = pickerMonth.split('-').map(Number)
            const dt = new Date(Date.UTC(y, m - 2, 1))
            setPickerMonth(dt.toISOString().slice(0, 10))
          }}
        >
          ‹
        </button>
        <p className="text-sm font-semibold text-foreground">{formatUkMonthYear(pickerMonth)}</p>
        <button
          type="button"
          className="tap-btn rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm font-semibold"
          onClick={() => {
            const [y, m] = pickerMonth.split('-').map(Number)
            const dt = new Date(Date.UTC(y, m, 1))
            setPickerMonth(dt.toISOString().slice(0, 10))
          }}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-muted-foreground">
        {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'].map(d => (
          <span key={d} className="py-1">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {(() => {
          const days = daysInMonth(pickerMonth)
          if (days.length === 0) return null
          const [y, m, d0] = days[0].split('-').map(Number)
          const monFirstPad = (new Date(Date.UTC(y, m - 1, d0)).getUTCDay() + 6) % 7
          const today = todayISO()
          const cells: ReactNode[] = []
          for (let i = 0; i < monFirstPad; i++) {
            cells.push(<span key={`pad-${i}`} />)
          }
          for (const day of days) {
            const dayNum = Number(day.slice(8, 10))
            const selected = day === selectedDate
            const isToday = day === today
            const allowed = isDayAllowed(day)
            cells.push(
              <button
                key={day}
                type="button"
                disabled={!allowed}
                onClick={() => {
                  if (!allowed) return
                  onSelect(day)
                }}
                className={`tap-btn aspect-square rounded-lg text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-30 ${
                  selected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : isToday
                      ? 'bg-primary/15 text-primary'
                      : 'text-foreground hover:bg-muted'
                }`}
              >
                {dayNum}
              </button>
            )
          }
          return cells
        })()}
      </div>
    </>
  )
}

function LockIcon({ locked, className }: { locked: boolean; className?: string }) {
  if (locked) {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    )
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  )
}

/** Mobile-only lock in app header. */
export function PlanScheduleMobileHeaderControls() {
  const ctx = usePlanScheduleChrome()
  const chrome = ctx?.chrome

  if (!chrome?.showLock) return null

  return (
    <div className="flex items-center sm:hidden">
      <button
        type="button"
        title={
          chrome.tasksLocked
            ? 'Розблокувати редагування завдань'
            : 'Заблокувати редагування завдань'
        }
        disabled={chrome.lockBusy}
        onClick={chrome.onToggleLock}
        className={`tap-btn shrink-0 rounded-md border border-border/40 p-1.5 ${
          chrome.tasksLocked
            ? 'bg-amber-100 text-amber-800'
            : 'bg-primary/5 text-primary/80'
        } disabled:opacity-60`}
      >
        <LockIcon locked={chrome.tasksLocked} className="h-5 w-5" />
      </button>
    </div>
  )
}
