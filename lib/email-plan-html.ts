/** Shared HTML builders for plan digest / report emails. */

export type DigestContentMode = 'full' | 'planned' | 'completed' | 'employee_report'

export interface EmailPlanColumn {
  key: string
  label: string
  /** system keys: shift | planned | completed | notes; else extra[key] */
  is_system?: boolean
  hidden?: boolean
}

export interface EmailPlanRow {
  full_name: string
  department_name: string | null
  shift?: string | null
  planned?: string | null
  completed?: string | null
  notes?: string | null
  extra?: Record<string, string> | null
}

const TD = 'padding:8px;border-bottom:1px solid #ddd;vertical-align:top;'
const TD_PRE = `${TD}white-space:pre-wrap;`
const TH = 'padding:8px;text-align:left;'
const DEPT_BG = 'background:#e8f5e9;color:#1b4332;font-weight:700;padding:10px 8px;'

/** Visual tones for employee report columns */
const COL_TD: Record<string, string> = {
  // width:1% + nowrap = shrink to content in email clients
  shift: `${TD}width:1%;white-space:nowrap;`,
  planned: `${TD_PRE}background:#eff6ff;border-left:3px solid #3b82f6;`,
  completed: `${TD_PRE}background:#ecfdf5;border-left:3px solid #10b981;`,
  notes: `${TD_PRE}background:#fafafa;`,
}
const COL_TH: Record<string, string> = {
  shift: `${TH}width:1%;white-space:nowrap;`,
  planned: `${TH}background:#dbeafe;color:#1e40af;`,
  completed: `${TH}background:#d1fae5;color:#065f46;`,
  notes: `${TH}background:#f3f4f6;color:#374151;`,
}

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Empty → em dash */
export function cellOrDash(value: string | null | undefined) {
  const t = (value ?? '').trim()
  return t ? escapeHtml(t) : '—'
}

/** YYYY-MM-DD → 24.07.2026 */
export function formatPlanDateDots(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d)}.${pad(m)}.${y}`
}

function columnsForMode(
  mode: DigestContentMode,
  extraCols: EmailPlanColumn[]
): EmailPlanColumn[] {
  const extras = extraCols
    .filter(c => !c.hidden && !c.is_system)
    .sort((a, b) => a.label.localeCompare(b.label, 'uk'))

  if (mode === 'planned') {
    return [
      { key: 'shift', label: 'Зміна', is_system: true },
      { key: 'planned', label: 'Заплановано', is_system: true },
      ...extras,
    ]
  }
  if (mode === 'completed') {
    return [
      { key: 'completed', label: 'Виконано', is_system: true },
      { key: 'notes', label: 'Обробки', is_system: true },
      ...extras,
    ]
  }
  if (mode === 'employee_report') {
    return [
      { key: 'shift', label: 'Зміна', is_system: true },
      { key: 'planned', label: 'Завдання', is_system: true },
      { key: 'completed', label: 'Виконано', is_system: true },
      { key: 'notes', label: 'Обробки', is_system: true },
      ...extras,
    ]
  }
  return [
    { key: 'shift', label: 'Зміна', is_system: true },
    { key: 'planned', label: 'Завдання', is_system: true },
    { key: 'completed', label: 'Виконано', is_system: true },
    { key: 'notes', label: 'Обробки', is_system: true },
    ...extras,
  ]
}

function cellValue(row: EmailPlanRow, col: EmailPlanColumn): string {
  if (col.key === 'shift') return cellOrDash(row.shift)
  if (col.key === 'planned') return cellOrDash(row.planned)
  if (col.key === 'completed') return cellOrDash(row.completed)
  if (col.key === 'notes') return cellOrDash(row.notes)
  return cellOrDash(row.extra?.[col.key])
}

function thStyle(_mode: DigestContentMode, col: EmailPlanColumn) {
  if (COL_TH[col.key]) return COL_TH[col.key]
  return TH
}

function tdStyle(_mode: DigestContentMode, col: EmailPlanColumn) {
  if (COL_TD[col.key]) return COL_TD[col.key]
  return TD_PRE
}

/**
 * Table like the plan board: department banner row, then employees.
 * No separate «Відділ» column.
 */
export function buildDeptGroupedPlanTableHtml(
  rows: EmailPlanRow[],
  mode: DigestContentMode,
  extraCols: EmailPlanColumn[] = []
) {
  const cols = columnsForMode(mode, extraCols)
  const colCount = 1 + cols.length

  const groups = new Map<string, EmailPlanRow[]>()
  for (const r of rows) {
    const key = (r.department_name || '').trim() || 'Без відділу'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  const header = `
    <tr style="background:#d8f3dc;text-align:left;">
      <th style="${TH}width:1%;white-space:nowrap;">Працівник</th>
      ${cols.map(c => `<th style="${thStyle(mode, c)}">${escapeHtml(c.label)}</th>`).join('')}
    </tr>`

  const bodyParts: string[] = []
  for (const [dept, members] of groups) {
    bodyParts.push(`
      <tr>
        <td colspan="${colCount}" style="${DEPT_BG}">відділ: ${escapeHtml(dept)}</td>
      </tr>`)
    for (const r of members) {
      bodyParts.push(`
        <tr>
          <td style="${TD}width:1%;white-space:nowrap;">${escapeHtml(r.full_name || '—')}</td>
          ${cols.map(c => `<td style="${tdStyle(mode, c)}">${cellValue(r, c)}</td>`).join('')}
        </tr>`)
    }
  }

  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #cfe8d5;border-radius:8px;overflow:hidden;">
      <thead>${header}</thead>
      <tbody>${bodyParts.join('')}</tbody>
    </table>`
}

export function mapTaskRowsForEmail(
  rows: Array<{
    shift?: string | null
    planned?: string | null
    completed?: string | null
    notes?: string | null
    extra?: unknown
    profile?: { full_name?: string } | { full_name?: string }[] | null
    department?: { name?: string } | { name?: string }[] | null
  }>
): EmailPlanRow[] {
  return rows.map(r => {
    const profile = Array.isArray(r.profile) ? r.profile[0] : r.profile
    const dept = Array.isArray(r.department) ? r.department[0] : r.department
    return {
      full_name: profile?.full_name?.trim() || '—',
      department_name: dept?.name ?? null,
      shift: r.shift,
      planned: r.planned,
      completed: r.completed,
      notes: r.notes,
      extra: (r.extra as Record<string, string>) || {},
    }
  })
}
