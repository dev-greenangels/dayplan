import { NextRequest, NextResponse } from 'next/server'
import { getApiSession, assertAdminApi, canManageTeam } from '@/lib/auth'
import { isMailConfigured, sendAppMail } from '@/lib/mail'
import { getTeamLeadersForNotify, isPushConfigured, sendPushPerUser, sendPushToUserIds } from '@/lib/push'
import { getNotifyPrefsByUserIds } from '@/lib/notify-prefs'
import { formatUkDate } from '@/lib/format-date'
import { escapeHtml, formatPlanDateDots } from '@/lib/email-plan-html'

interface RowPayload {
  employee_id: string
  email: string
  full_name: string
  planned: string
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiSession()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const forbidden = assertAdminApi(ctx.profile)
    if (forbidden) return NextResponse.json({ error: forbidden.error }, { status: forbidden.status })

    const { supabase, profile } = ctx
    const body = await req.json()
    const { date, teamId, rows, channels = 'all' } = body as {
      date: string
      teamId: string
      rows: RowPayload[]
      channels?: 'email' | 'push' | 'all'
    }

    if (!date || !teamId || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Невірні параметри' }, { status: 400 })
    }

    const sendEmail = channels === 'email' || channels === 'all'
    const sendPush = channels === 'push' || channels === 'all'

    if (!(await canManageTeam(supabase, profile, teamId))) {
      return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
    }

    const { data: team } = await supabase.from('teams').select('name').eq('id', teamId).single()

    const { data: plan } = await supabase
      .from('day_plans')
      .select('id')
      .eq('team_id', teamId)
      .eq('plan_date', date)
      .maybeSingle()

    if (!plan) {
      return NextResponse.json({ error: 'План ще не створено' }, { status: 404 })
    }

    const employeeIds = rows.map(r => r.employee_id)
    const prefs = await getNotifyPrefsByUserIds(supabase, employeeIds)
    let sent = 0
    let emailSent = 0
    let pushSent = 0
    const sentAt = new Date().toISOString()
    const emailedIds: string[] = []
    const pushedIds: string[] = []

    const withEmail = rows.filter(
      r => r.email && r.planned?.trim() && prefs.get(r.employee_id)?.email !== false
    )
    if (sendEmail && withEmail.length > 0 && isMailConfigured()) {
      const dateStr = formatUkDate(date)
      const dateDots = formatPlanDateDots(date)

      for (const row of withEmail) {
        try {
          const html = `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f0f7f0; border-radius: 12px;">
              <p style="color: #333; margin: 0 0 16px; font-size: 15px; line-height: 1.45;">
                Доброго дня! Ваше завдання на <strong>${dateDots}</strong>
              </p>
              <p style="color: #555; margin-bottom: 12px;">Команда: <strong>${escapeHtml(team?.name ?? '')}</strong></p>
              <div style="background: white; border-radius: 8px; padding: 16px; border-left: 4px solid #52b788;">
                <p style="white-space: pre-wrap; color: #333; margin: 0;">${escapeHtml(row.planned)}</p>
              </div>
              <p style="margin-top: 20px; color: #2d6a4f; font-size: 15px; font-weight: 600;">Успіхів!</p>
              <p style="margin-top: 16px; font-size: 12px; color: #999;">PlanDay-GA · ${escapeHtml(dateStr)}</p>
            </div>
          `
          await sendAppMail({
            to: row.email,
            subject: `Ваше завдання на ${dateDots} — ${team?.name ?? ''}`,
            html,
          })
          emailedIds.push(row.employee_id)
          emailSent++
          sent++
        } catch {
          // continue others
        }
      }
    }

    const pushConfigured = isPushConfigured()
    if (sendPush && pushConfigured) {
      const titleDate = formatUkDate(date, { weekday: false })
      const pushRows = rows.filter(r => prefs.get(r.employee_id)?.push !== false)
      const pushed = await sendPushPerUser(
        supabase,
        pushRows.map(r => ({
          userId: r.employee_id,
          title: `План на ${titleDate}`,
          body: (r.planned || 'Нове завдання').slice(0, 100),
        }))
      )
      pushedIds.push(...pushed)
      pushSent += pushed.length
      sent += pushed.length
    }

    if (sendEmail && emailedIds.length > 0) {
      await supabase
        .from('task_rows')
        .update({ notified: true, plan_email_sent_at: sentAt })
        .eq('plan_id', plan.id)
        .in('employee_id', emailedIds)
    }
    if (sendPush && pushedIds.length > 0) {
      await supabase
        .from('task_rows')
        .update({ notified: true, plan_push_sent_at: sentAt })
        .eq('plan_id', plan.id)
        .in('employee_id', pushedIds)
    }

    if (sent > 0) {
      const titleDate = formatUkDate(date, { weekday: false })
      const leaders = await getTeamLeadersForNotify(supabase, teamId)
      const leaderPrefs = await getNotifyPrefsByUserIds(
        supabase,
        leaders.map(l => l.user_id)
      )
      const pushLeaders = leaders
        .filter(l => {
          const prefs = leaderPrefs.get(l.user_id)
          return prefs?.push !== false && prefs?.workerSendPush !== false
        })
        .map(l => l.user_id)
      await sendPushToUserIds(supabase, pushLeaders, {
        title: `Завдання на ${titleDate}`,
        body: `Команда «${team?.name ?? ''}» отримала завдання на ${titleDate}`,
      })
    }

    if (sent === 0) {
      let hint = 'Нічого не надіслано'
      if (sendPush && !pushConfigured) {
        hint = 'Push не налаштовано на сервері (додайте VAPID_PUBLIC_KEY і VAPID_PRIVATE_KEY у Vercel)'
      } else if (sendEmail && !sendPush) {
        hint = 'Не вдалося надіслати email (немає адрес/плану або Gmail не налаштовано)'
      } else if (!sendEmail && sendPush) {
        hint = 'Немає push-підписок у вибраних (користувачі мають увімкнути сповіщення в додатку)'
      }
      return NextResponse.json({ error: hint }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      sent,
      emailSent,
      pushSent,
      plan_email_sent_at: emailedIds.length > 0 ? sentAt : null,
      plan_push_sent_at: pushedIds.length > 0 ? sentAt : null,
      emailedIds,
      pushedIds,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
