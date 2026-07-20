import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'
import webpush from 'web-push'

// Configure VAPID if keys are set
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.GMAIL_USER ?? 'admin@example.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

interface RowPayload {
  employee_id: string
  email: string
  full_name: string
  planned: string
  notify_email: boolean
  notify_push: boolean
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || (profile.role !== 'super_admin' && profile.role !== 'sub_admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { date, department, rows } = body as {
      date: string
      department: string
      rows: RowPayload[]
    }

    if (!date || !department || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'Невірні параметри' }, { status: 400 })
    }

    // Upsert the plan and rows first
    const { data: plan } = await supabase
      .from('day_plans')
      .upsert({ plan_date: date, department, created_by: user.id }, { onConflict: 'plan_date,department' })
      .select()
      .single()

    if (plan) {
      for (const row of rows) {
        await supabase.from('task_rows').upsert(
          {
            plan_id: plan.id,
            employee_id: row.employee_id,
            planned: row.planned,
            notify_email: row.notify_email,
            notify_push: row.notify_push,
            shift: '8:00-17:00',
          },
          { onConflict: 'plan_id,employee_id' }
        )
      }
    }

    const emailRows = rows.filter(r => r.notify_email && r.email && r.planned)
    const pushRows = rows.filter(r => r.notify_push)

    let sent = 0

    // ---- Email ----
    if (emailRows.length > 0 && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      const transporter = createTransporter()
      const dateStr = new Date(date).toLocaleDateString('uk-UA', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })

      await Promise.all(
        emailRows.map(async row => {
          const html = `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f0f7f0; border-radius: 12px;">
              <h2 style="color: #2d6a4f; margin-bottom: 8px;">План на ${dateStr}</h2>
              <p style="color: #555; margin-bottom: 16px;">Відділ: <strong>${department}</strong></p>
              <div style="background: white; border-radius: 8px; padding: 16px; border-left: 4px solid #52b788;">
                <p style="white-space: pre-wrap; color: #333; margin: 0;">${row.planned}</p>
              </div>
              <p style="margin-top: 16px; font-size: 12px; color: #999;">GA-DayPlan</p>
            </div>
          `
          await transporter.sendMail({
            from: `GA-DayPlan <${process.env.GMAIL_USER}>`,
            to: row.email,
            subject: `Ваш план на ${dateStr} — ${department}`,
            html,
          })
          sent++
        })
      )
    }

    // ---- Push ----
    if (pushRows.length > 0 && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      const pushEmployeeIds = pushRows.map(r => r.employee_id)
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .in('user_id', pushEmployeeIds)

      if (subs && subs.length > 0) {
        const dateStr = new Date(date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })
        await Promise.all(
          subs.map(async sub => {
            const row = pushRows.find(r => r.employee_id === sub.user_id)
            if (!row) return
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                JSON.stringify({
                  title: `План на ${dateStr}`,
                  body: row.planned.slice(0, 100),
                  icon: '/icon-192.png',
                })
              )
              sent++
            } catch {
              // ignore individual push failures
            }
          })
        )
      }
    }

    // Mark as notified in task_rows
    if (plan) {
      const notifiedIds = rows.filter(r => r.notify_email || r.notify_push).map(r => r.employee_id)
      if (notifiedIds.length > 0) {
        await supabase
          .from('task_rows')
          .update({ notified: true })
          .eq('plan_id', plan.id)
          .in('employee_id', notifiedIds)
      }
    }

    return NextResponse.json({ success: true, sent })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
