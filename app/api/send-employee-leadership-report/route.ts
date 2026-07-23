import { NextRequest, NextResponse } from 'next/server'
import { getApiSession, isBoss } from '@/lib/auth'
import { isMailConfigured, sendAppMail } from '@/lib/mail'
import { getTeamLeaderUserIds, isPushConfigured, sendPushToUserIds } from '@/lib/push'
import { formatUkDate } from '@/lib/format-date'
import {
  buildDeptGroupedPlanTableHtml,
  mapTaskRowsForEmail,
} from '@/lib/email-plan-html'

/** Employee → leadership: completed work report (email + push). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiSession()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { supabase, user, profile } = ctx

    if (profile.role === 'pending') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { teamId, date, scope = 'mine' } = await req.json() as {
      teamId: string
      date: string
      scope?: 'mine' | 'all'
    }
    if (!teamId || !date) {
      return NextResponse.json({ error: 'Невірні параметри' }, { status: 400 })
    }

    const { data: team } = await supabase.from('teams').select('*').eq('id', teamId).single()
    if (!team) return NextResponse.json({ error: 'Команду не знайдено' }, { status: 404 })

    const { data: membership } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .maybeSingle()

    const isLeader =
      isBoss(profile.role) ||
      !!(await supabase.from('team_admins').select('user_id').eq('team_id', teamId).eq('user_id', user.id).maybeSingle()).data

    if (!membership && !isLeader) {
      return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
    }

    if (scope === 'all' && team.work_mode !== 'shared') {
      return NextResponse.json({ error: 'Звіт усіх доступний лише на спільному ПК' }, { status: 400 })
    }

    const { data: plan } = await supabase
      .from('day_plans')
      .select('id')
      .eq('team_id', teamId)
      .eq('plan_date', date)
      .maybeSingle()

    if (!plan) return NextResponse.json({ error: 'План ще не створено' }, { status: 404 })

    let query = supabase
      .from('task_rows')
      .select('*, profile:profiles(full_name, email), department:departments(name)')
      .eq('plan_id', plan.id)

    if (scope === 'mine') {
      query = query.eq('employee_id', user.id)
    }

    const { data: rows } = await query.order('created_at')
    const withCompleted = (rows ?? []).filter(r => (r.completed || '').trim())
    if (withCompleted.length === 0) {
      return NextResponse.json({ error: 'Немає заповненого «Виконано» для відправки' }, { status: 400 })
    }

    const [{ data: teamAdmins }, { data: superAdmins }] = await Promise.all([
      supabase.from('team_admins').select('user_id, profile:profiles(id, email)').eq('team_id', teamId),
      supabase.from('profiles').select('id, email').eq('role', 'super_admin'),
    ])

    const leaders = [
      ...(superAdmins ?? []).map(a => ({ id: a.id, email: a.email })),
      ...(teamAdmins ?? []).map(a => {
        const p = a.profile as { id?: string; email?: string } | { id?: string; email?: string }[] | null
        const prof = Array.isArray(p) ? p[0] : p
        return { id: prof?.id || a.user_id, email: prof?.email }
      }),
    ]
    const emails = [...new Set(leaders.map(l => l.email).filter(Boolean))] as string[]
    const leaderIds = await getTeamLeaderUserIds(supabase, teamId)

    const dateStr = formatUkDate(date)

    let emailSent = 0
    let pushSent = 0

    if (emails.length > 0 && isMailConfigured()) {
      const { data: teamColumns } = await supabase
        .from('team_columns')
        .select('key, label, is_system, hidden')
        .eq('team_id', teamId)
        .order('sort_order')

      const emailRows = mapTaskRowsForEmail(withCompleted)
      const extraCols = (teamColumns ?? []).map(c => ({
        key: c.key,
        label: c.label,
        is_system: !!c.is_system,
        hidden: !!c.hidden,
      }))
      const tableHtml = buildDeptGroupedPlanTableHtml(emailRows, 'completed', extraCols)

      const scopeLabel = scope === 'all' ? 'усіх працівників' : profile.full_name || user.email
      const html = `
        <div style="font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 24px;">
          <h2 style="color:#2d6a4f;">Звіт керівництву — ${team.name} — ${dateStr}</h2>
          <p style="color:#555;">Від: <strong>${profile.full_name || user.email}</strong> (${scopeLabel})</p>
          ${tableHtml}
          <p style="margin-top:16px;font-size:12px;color:#999;">GA-DayPlan</p>
        </div>
      `

      await sendAppMail({
        to: process.env.GMAIL_USER!,
        bcc: emails.join(', '),
        subject: `Звіт керівництву «${team.name}» — ${dateStr}`,
        html,
      })
      emailSent = emails.length
    }

    if (leaderIds.length > 0 && isPushConfigured()) {
      pushSent = await sendPushToUserIds(supabase, leaderIds, {
        title: 'Звіт керівництву',
        body: `${profile.full_name || user.email} · ${team.name} · ${withCompleted.length} звітів`,
      })
    }

    if (emailSent === 0 && pushSent === 0) {
      return NextResponse.json({ error: 'Не вдалося надіслати (немає email/push у керівництва)' }, { status: 400 })
    }

    return NextResponse.json({ success: true, emailSent, pushSent })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
