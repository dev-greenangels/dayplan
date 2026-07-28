'use server'

import { getSessionProfile, canManageTeam } from '@/lib/auth'
import { formatUkShortDate } from '@/lib/format-date'

export type TeamPlanSearchHit = {
  plan_date: string
  dateLabel: string
  columnKey: string
  columnLabel: string
  employeeName: string
  snippet: string
}

const SYSTEM_LABELS: Record<string, string> = {
  planned: 'Заплановано',
  completed: 'Виконано',
  notes: 'Обробки',
}

function snippetAround(text: string, q: string, max = 80): string {
  const lower = text.toLowerCase()
  const iq = q.toLowerCase()
  const idx = lower.indexOf(iq)
  if (idx < 0) return text.slice(0, max).trim()
  const start = Math.max(0, idx - 24)
  const end = Math.min(text.length, idx + q.length + 40)
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = '…' + s
  if (end < text.length) s = s + '…'
  return s.slice(0, max)
}

export async function searchTeamPlans(
  teamId: string,
  query: string
): Promise<{ hits: TeamPlanSearchHit[]; error?: string }> {
  const ctx = await getSessionProfile()
  if (!ctx) return { hits: [], error: 'Unauthorized' }
  if (!(await canManageTeam(ctx.supabase, ctx.profile, teamId))) {
    return { hits: [], error: 'Немає доступу' }
  }

  const q = query.trim()
  if (q.length < 2) return { hits: [] }

  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - 12)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data: columns } = await ctx.supabase
    .from('team_columns')
    .select('key, label')
    .eq('team_id', teamId)

  const labelByKey = new Map<string, string>()
  for (const c of columns ?? []) {
    labelByKey.set(c.key, c.label)
  }

  // Escape PostgREST filter specials; wrap pattern in quotes
  const safeQ = q.replace(/[%_,.()]/g, ' ').replace(/\s+/g, ' ').trim()
  if (safeQ.length < 2) return { hits: [] }
  const pattern = `%${safeQ}%`

  const { data: rows, error } = await ctx.supabase
    .from('task_rows')
    .select(
      `planned, completed, notes, extra, profile:profiles(full_name), day_plans!inner(plan_date, team_id)`
    )
    .eq('day_plans.team_id', teamId)
    .gte('day_plans.plan_date', sinceStr)
    .or(
      `planned.ilike."${pattern}",completed.ilike."${pattern}",notes.ilike."${pattern}"`
    )
    .limit(60)

  if (error) return { hits: [], error: error.message }

  const hits: TeamPlanSearchHit[] = []
  const qLower = q.toLowerCase()

  for (const row of rows ?? []) {
    const plan = row.day_plans as
      | { plan_date: string; team_id: string }
      | { plan_date: string; team_id: string }[]
    const planObj = Array.isArray(plan) ? plan[0] : plan
    if (!planObj) continue

    const prof = row.profile as { full_name?: string } | { full_name?: string }[] | null
    const profObj = Array.isArray(prof) ? prof[0] : prof
    const employeeName = profObj?.full_name?.trim() || 'Працівник'

    const candidates: { key: string; text: string }[] = [
      { key: 'planned', text: row.planned || '' },
      { key: 'completed', text: row.completed || '' },
      { key: 'notes', text: row.notes || '' },
    ]
    const extra = (row.extra as Record<string, string>) || {}
    for (const [key, text] of Object.entries(extra)) {
      if (typeof text === 'string') candidates.push({ key, text })
    }

    for (const c of candidates) {
      if (!c.text.toLowerCase().includes(qLower)) continue
      hits.push({
        plan_date: planObj.plan_date,
        dateLabel: formatUkShortDate(planObj.plan_date),
        columnKey: c.key,
        columnLabel: labelByKey.get(c.key) || SYSTEM_LABELS[c.key] || c.key,
        employeeName,
        snippet: snippetAround(c.text, q),
      })
      if (hits.length >= 25) break
    }
    if (hits.length >= 25) break
  }

  hits.sort((a, b) => b.plan_date.localeCompare(a.plan_date))
  return { hits }
}
