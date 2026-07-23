import { NextRequest, NextResponse } from 'next/server'
import { getApiSession, assertAdminApi, canManageTeam } from '@/lib/auth'
import { isMailConfigured, sendAppMail } from '@/lib/mail'
import { isPushConfigured, sendPushToUserIds } from '@/lib/push'
import { formatUkDate } from '@/lib/format-date'
import {
  buildDeptGroupedPlanTableHtml,
  mapTaskRowsForEmail,
  type DigestContentMode,
} from '@/lib/email-plan-html'

type DigestContent = DigestContentMode
type Receipts = Record<string, { email?: string; push?: string }>

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiSession()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const forbidden = assertAdminApi(ctx.profile)
    if (forbidden) return NextResponse.json({ error: forbidden.error }, { status: forbidden.status })
    const { supabase, profile } = ctx

    const {
      teamId,
      date,
      recipientIds,
      channels = 'all',
      content = 'full',
    } = await req.json() as {
      teamId: string
      date: string
      recipientIds?: string[]
      channels?: 'email' | 'push' | 'all'
      content?: DigestContent
    }
    if (!teamId || !date) return NextResponse.json({ error: 'Невірні параметри' }, { status: 400 })

    const sendEmail = channels === 'email' || channels === 'all'
    const sendPush = channels === 'push' || channels === 'all'
    const contentMode: DigestContent =
      content === 'planned' || content === 'completed' ? content : 'full'

    if (!(await canManageTeam(supabase, profile, teamId))) {
      return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
    }

    const { data: team } = await supabase.from('teams').select('*').eq('id', teamId).single()
    const { data: plan } = await supabase
      .from('day_plans')
      .select('id, digest_receipts')
      .eq('team_id', teamId)
      .eq('plan_date', date)
      .maybeSingle()

    if (!plan) return NextResponse.json({ error: 'План ще не створено' }, { status: 404 })

    const { data: rows } = await supabase
      .from('task_rows')
      .select('*, profile:profiles(full_name, email), department:departments(name)')
      .eq('plan_id', plan.id)
      .order('created_at')

    const { data: teamColumns } = await supabase
      .from('team_columns')
      .select('key, label, is_system, hidden, sort_order')
      .eq('team_id', teamId)
      .order('sort_order')

    const { data: superAdmins } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('role', 'super_admin')

    const { data: deputies } = await supabase
      .from('team_admins')
      .select('user_id, profile:profiles(id, email)')
      .eq('team_id', teamId)

    const allLeaders = [
      ...(superAdmins ?? []).map(a => ({ id: a.id, email: a.email })),
      ...(deputies ?? []).map(d => {
        const p = d.profile as { id?: string; email?: string } | { id?: string; email?: string }[] | null
        const prof = Array.isArray(p) ? p[0] : p
        return { id: prof?.id || d.user_id, email: prof?.email }
      }),
    ]

    let recipients = allLeaders
    if (recipientIds?.length) {
      const allow = new Set(recipientIds)
      recipients = allLeaders.filter(a => allow.has(a.id))
    }

    const emails = [...new Set(recipients.map(a => a.email).filter(Boolean))] as string[]
    const recipientUserIds = [...new Set(recipients.map(a => a.id).filter(Boolean))]

    if (recipients.length === 0) {
      return NextResponse.json({ error: 'Немає отримувачів' }, { status: 400 })
    }

    const dateStr = formatUkDate(date)

    let emailSent = 0
    let pushSent = 0
    const emailedIds: string[] = []
    const pushedIds: string[] = []

    const contentTitle =
      contentMode === 'planned'
        ? 'Завдання'
        : contentMode === 'completed'
          ? 'Виконано'
          : 'План і звіти'

    if (sendEmail) {
      if (emails.length === 0) {
        if (!sendPush) {
          return NextResponse.json({ error: 'Немає email у вибраних' }, { status: 400 })
        }
      } else if (!isMailConfigured()) {
        if (!sendPush) {
          return NextResponse.json({ error: 'Gmail не налаштовано' }, { status: 500 })
        }
      } else {
        const emailRows = mapTaskRowsForEmail(rows ?? [])
        const extraCols = (teamColumns ?? []).map(c => ({
          key: c.key,
          label: c.label,
          is_system: !!c.is_system,
          hidden: !!c.hidden,
        }))
        const tableHtml = buildDeptGroupedPlanTableHtml(emailRows, contentMode, extraCols)
        const html = `
          <div style="font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 24px;">
            <h2 style="color:#2d6a4f;">${contentTitle} — ${team?.name ?? ''} — ${dateStr}</h2>
            ${tableHtml}
            <p style="margin-top:16px;font-size:12px;color:#999;">GA-DayPlan</p>
          </div>
        `

        await sendAppMail({
          to: process.env.GMAIL_USER!,
          bcc: emails.join(', '),
          subject: `${contentTitle} «${team?.name ?? ''}» — ${dateStr}`,
          html,
        })
        emailSent = emails.length
        for (const r of recipients) {
          if (r.email) emailedIds.push(r.id)
        }
      }
    }

    if (sendPush) {
      if (!isPushConfigured()) {
        if (!sendEmail || emailSent === 0) {
          return NextResponse.json({ error: 'Push не налаштовано' }, { status: 500 })
        }
      } else if (recipientUserIds.length > 0) {
        const plannedCount = (rows ?? []).filter(r => (r.planned || '').trim()).length
        const body = `Команда «${team?.name ?? ''}»: ${contentTitle.toLowerCase()} · ${plannedCount} рядків · ${dateStr}`
        pushSent = await sendPushToUserIds(supabase, recipientUserIds, {
          title: 'План керівництву',
          body: body.slice(0, 120),
        })
        // Approximate which leaders got push: those with subscriptions among recipients
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('user_id')
          .in('user_id', recipientUserIds)
        pushedIds.push(...new Set((subs ?? []).map(s => s.user_id)))
      }
    }

    if (emailSent === 0 && pushSent === 0) {
      const hint = sendEmail && !sendPush
        ? 'Не вдалося надіслати email'
        : !sendEmail && sendPush
          ? 'Немає push-підписок у вибраних'
          : 'Нічого не надіслано'
      return NextResponse.json({ error: hint }, { status: 400 })
    }

    const sentAt = new Date().toISOString()
    const prevReceipts = (plan.digest_receipts ?? {}) as Receipts
    const nextReceipts: Receipts = { ...prevReceipts }
    for (const id of emailedIds) {
      nextReceipts[id] = { ...nextReceipts[id], email: sentAt }
    }
    for (const id of pushedIds) {
      nextReceipts[id] = { ...nextReceipts[id], push: sentAt }
    }

    await supabase
      .from('day_plans')
      .update({ digest_sent_at: sentAt, digest_receipts: nextReceipts })
      .eq('id', plan.id)

    return NextResponse.json({
      success: true,
      recipients: emailSent || recipientUserIds.length,
      emailSent,
      pushSent,
      digest_sent_at: sentAt,
      digest_receipts: nextReceipts,
      emailedIds,
      pushedIds,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
