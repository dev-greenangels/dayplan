import { NextRequest, NextResponse } from 'next/server'
import { getApiSession, assertAdminApi, canManageTeam } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMailConfigured, sendAppMail } from '@/lib/mail'
import { isPushConfigured, sendPushToUserIds } from '@/lib/push'
import { formatUkDate } from '@/lib/format-date'
import {
  buildDeptGroupedPlanTableHtml,
  escapeHtml,
  mapTaskRowsForEmail,
  type DigestContentMode,
} from '@/lib/email-plan-html'
import { isFilledBeyondTemplate } from '@/lib/column-templates'
import { effectiveLeaderNotifyPrefs } from '@/lib/notify-prefs'

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
      channels = 'all',
      content = 'full',
    } = await req.json() as {
      teamId: string
      date: string
      channels?: 'email' | 'push' | 'all'
      content?: DigestContent
    }
    if (!teamId || !date) return NextResponse.json({ error: 'Невірні параметри' }, { status: 400 })

    const sendEmail = channels === 'email' || channels === 'all'
    const sendPush = channels === 'push' || channels === 'all'
    // Always send the full table unless an older client still asks otherwise
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

    if (team?.work_mode === 'shared') {
      const { data: completedCol } = await supabase
        .from('team_columns')
        .select('input_template')
        .eq('team_id', teamId)
        .eq('key', 'completed')
        .maybeSingle()
      const completedTemplate = completedCol?.input_template
      const incomplete = (rows ?? []).filter(
        r => !isFilledBeyondTemplate(r.completed, completedTemplate)
      )
      if (!rows?.length) {
        return NextResponse.json({ error: 'Немає рядків у плані' }, { status: 400 })
      }
      if (incomplete.length > 0) {
        return NextResponse.json(
          { error: 'Заповніть «Виконано» для всіх у плані перед відправкою' },
          { status: 400 }
        )
      }
    }

    const { data: teamColumns } = await supabase
      .from('team_columns')
      .select('key, label, is_system, hidden, sort_order')
      .eq('team_id', teamId)
      .order('sort_order')

    // Admin client: deputies must see all co-leaders (RLS previously limited to self)
    const admin = createAdminClient()
    const { data: deputies } = await admin
      .from('team_admins')
      .select(
        'user_id, notify_email, notify_push, profile:profiles(id, email, notify_email, notify_push)'
      )
      .eq('team_id', teamId)

    const recipients = (deputies ?? []).map(d => {
      const p = d.profile as
        | { id?: string; email?: string; notify_email?: boolean; notify_push?: boolean }
        | { id?: string; email?: string; notify_email?: boolean; notify_push?: boolean }[]
        | null
      const prof = Array.isArray(p) ? p[0] : p
      const prefs = effectiveLeaderNotifyPrefs(d, {
        email: prof?.notify_email !== false,
        push: prof?.notify_push !== false,
      })
      return {
        id: prof?.id || d.user_id,
        email: prof?.email,
        notify_email: prefs.email,
        notify_push: prefs.push,
      }
    })

    const emails = [...new Set(
      recipients
        .filter(a => a.notify_email && a.email)
        .map(a => a.email)
        .filter(Boolean)
    )] as string[]
    const recipientUserIds = [...new Set(
      recipients.filter(a => a.notify_push && a.id).map(a => a.id)
    )]
    const emailEligibleIds = recipients.filter(a => a.notify_email && a.email).map(a => a.id)

    if (recipients.length === 0) {
      return NextResponse.json({ error: 'Немає керівництва команди' }, { status: 400 })
    }
    if (emails.length === 0 && recipientUserIds.length === 0) {
      return NextResponse.json(
        {
          error:
            'У керівництва вимкнено email і push (картка користувача або налаштування команди)',
        },
        { status: 400 }
      )
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
        const fromName = escapeHtml(profile.full_name || profile.email || 'Заступник')
        const html = `
          <div style="font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 24px;">
            <h2 style="color:#2d6a4f;margin:0 0 4px;">${contentTitle} — ${escapeHtml(team?.name ?? '')}</h2>
            <p style="color:#2d6a4f;font-size:16px;font-weight:600;margin:0 0 12px;">${dateStr}</p>
            <p style="color:#555;margin:0 0 16px;">Від: <strong>${fromName}</strong></p>
            ${tableHtml}
            <p style="margin-top:16px;font-size:12px;color:#999;">PlanDay-GA</p>
          </div>
        `

        await sendAppMail({
          to: process.env.GMAIL_USER!,
          bcc: emails.join(', '),
          subject: `${contentTitle} «${team?.name ?? ''}» — ${dateStr}`,
          html,
        })
        emailSent = emails.length
        emailedIds.push(...emailEligibleIds)
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
          title: 'Звіт керівництву',
          body: body.slice(0, 120),
          url: `/teams/${teamId}/plans/${date}`,
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
