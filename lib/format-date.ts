const WEEKDAYS_UK = [
  'неділя',
  'понеділок',
  'вівторок',
  'середа',
  'четвер',
  'пʼятниця',
  'субота',
] as const

const MONTHS_UK = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
] as const

/** Deterministic UK date label (avoids SSR/client locale hydration mismatches). */
export function formatUkDate(dateStr: string, opts?: { weekday?: boolean }) {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const utc = new Date(Date.UTC(y, m - 1, d))
  const dayMonthYear = `${d} ${MONTHS_UK[m - 1]} ${y}`
  if (opts?.weekday === false) return dayMonthYear
  return `${WEEKDAYS_UK[utc.getUTCDay()]}, ${dayMonthYear}`
}

/** YYYY-MM-DD in local calendar math via UTC noon to avoid DST edge cases. */
export function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return dt.toISOString().slice(0, 10)
}

export function todayISO(): string {
  const n = new Date()
  const y = n.getFullYear()
  const m = String(n.getMonth() + 1).padStart(2, '0')
  const d = String(n.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Short tab label: «пн 20» */
export function formatUkDayTab(dateStr: string): { weekday: string; day: string } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  const short = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const
  return { weekday: short[utc.getUTCDay()], day: String(d) }
}

export function formatUkDateTime(iso: string): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

const MONTHS_NOMINATIVE = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
] as const

/** «Липень 2026» */
export function formatUkMonthYear(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  if (!y || !m) return dateStr
  return `${MONTHS_NOMINATIVE[m - 1]} ${y}`
}

/** All YYYY-MM-DD days in the month of dateStr */
export function daysInMonth(dateStr: string): string[] {
  const [y, m] = dateStr.split('-').map(Number)
  if (!y || !m) return []
  const days: string[] = []
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  for (let d = 1; d <= last; d++) {
    days.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return days
}

/** dd.mm.yyyy from ISO date or timestamptz */
export function formatUkShortDate(iso: string): string {
  const dt = new Date(iso.includes('T') ? iso : iso + 'T12:00:00')
  if (Number.isNaN(dt.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`
}
