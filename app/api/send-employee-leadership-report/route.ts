import { NextRequest, NextResponse } from 'next/server'
import { getApiSession, isBoss } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMailConfigured, sendAppMail } from '@/lib/mail'
import { isPushConfigured, sendPushToUserIds } from '@/lib/push'
import { getNotifyPrefsByUserIds } from '@/lib/notify-prefs'
import { formatUkDate } from '@/lib/format-date'
import {
  buildDeptGroupedPlanTableHtml,
  mapTaskRowsForEmail,
} from '@/lib/email-plan-html'

/** Employee → leadership: only the current user's completed report (email + push). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiSession()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { supabase, user, profile } = ctx

    if (profile.role === 'pending') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { teamId, date } = await req.json() as {
      teamId: string
      date: string
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

    const { data: plan } = await supabase
      .from('day_plans')
      .select('id')
      .eq('team_id', teamId)
      .eq('plan_date', date)
      .maybeSingle()

    if (!plan) return NextResponse.json({ error: 'План ще не створено' }, { status: 404 })

    const { data: rows } = await supabase
      .from('task_rows')
      .select('*, profile:profiles(full_name, email), department:departments(name)')
      .eq('plan_id', plan.id)
      .eq('employee_id', user.id)
      .order('created_at')

    const withCompleted = (rows ?? []).filter(r => (r.completed || '').trim())
    if (withCompleted.length === 0) {
      return NextResponse.json({ error: 'Заповніть своє поле «Виконано» перед відправкою' }, { status: 400 })
    }

    // Service role: employees cannot read other profiles' emails via RLS
    const admin = createAdminClient()
    const [{ data: teamAdmins }, { data: superAdmins }] = await Promise.all([
      admin.from('team_admins').select('user_id, profile:profiles(id, email)').eq('team_id', teamId),
      admin.from('profiles').select('id, email').eq('role', 'super_admin'),
    ])

    const leaders = [
      ...(superAdmins ?? []).map(a => ({ id: a.id, email: a.email })),
      ...(teamAdmins ?? []).map(a => {
        const p = a.profile as { id?: string; email?: string } | { id?: string; email?: string }[] | null
        const prof = Array.isArray(p) ? p[0] : p
        return { id: prof?.id || a.user_id, email: prof?.email }
      }),
    ]
    const leaderIds = [...new Set(leaders.map(l => l.id).filter(Boolean))] as string[]
    const prefs = await getNotifyPrefsByUserIds(
      admin as Parameters<typeof getNotifyPrefsByUserIds>[0],
      leaderIds
    )
    const emails = [...new Set(
      leaders
        .filter(l => l.email && prefs.get(l.id)?.email !== false)
        .map(l => l.email)
        .filter(Boolean)
    )] as string[]
    const pushLeaderIds = leaderIds.filter(id => prefs.get(id)?.push !== false)

    const dateStr = formatUkDate(date, { weekday: false })
    const fromName = profile.full_name || user.email

    let emailSent = 0
    let pushSent = 0

    const mailOk = isMailConfigured()
    const pushOk = isPushConfigured()

    if (emails.length === 0 && pushLeaderIds.length === 0) {
      return NextResponse.json(
        { error: 'Немає керівництва з увімкненими сповіщеннями (або без email)' },
        { status: 400 }
      )
    }

    if (!mailOk && !pushOk) {
      return NextResponse.json(
        { error: 'На сервері не налаштовано email і push (GMAIL / VAPID)' },
        { status: 400 }
      )
    }

    if (emails.length > 0 && mailOk) {
      const { data: teamColumns } = await admin
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
      const tableHtml = buildDeptGroupedPlanTableHtml(emailRows, 'employee_report', extraCols)

      const html = `
        <div style="font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 24px;">
          <h2 style="color:#2d6a4f;margin:0 0 4px;">Звіт керівництву — ${team.name}</h2>
          <p style="color:#2d6a4f;font-size:16px;font-weight:600;margin:0 0 12px;">${dateStr}</p>
          <p style="color:#555;margin:0 0 16px;">Від: <strong>${fromName}</strong></p>
          ${tableHtml}
          <p style="margin-top:16px;font-size:12px;color:#999;">PlanDay-GA</p>
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

    if (pushLeaderIds.length > 0 && pushOk) {
      // sendPushToUserIds uses caller supabase — pass admin so subscriptions are readable
      pushSent = await sendPushToUserIds(admin as Parameters<typeof sendPushToUserIds>[0], pushLeaderIds, {
        title: 'Звіт керівництву',
        body: `${fromName} · ${team.name} · ${dateStr}`,
      })
    }

    if (emailSent === 0 && pushSent === 0) {
      const hints: string[] = []
      if (mailOk && emails.length === 0) hints.push('у керівництва немає email')
      if (!mailOk) hints.push('Gmail не налаштовано')
      if (pushOk && pushSent === 0) hints.push('немає push-підписок у керівництва')
      if (!pushOk) hints.push('push не налаштовано')
      return NextResponse.json(
        { error: `Не вдалося надіслати (${hints.join('; ') || 'немає каналів'})` },
        { status: 400 }
      )
    }

    const sentAt = new Date().toISOString()
    const rowIds = withCompleted.map(r => r.id).filter(Boolean)
    if (rowIds.length > 0) {
      const { error: stampErr } = await admin
        .from('task_rows')
        .update({ report_sent_at: sentAt })
        .in('id', rowIds)
      if (stampErr) {
        console.warn('[send-employee-leadership-report] report_sent_at update failed', stampErr.message)
      }
    }

    return NextResponse.json({
      success: true,
      emailSent,
      pushSent,
      sent_at: sentAt,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
