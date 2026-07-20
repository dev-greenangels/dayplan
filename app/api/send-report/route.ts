import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { taskRowId, completed } = await req.json() as { taskRowId: string; completed: string }

    if (!taskRowId || !completed?.trim()) {
      return NextResponse.json({ error: 'Заповніть звіт перед відправкою' }, { status: 400 })
    }

    // 1. Save the completed report
    const { error: updateError } = await supabase
      .from('task_rows')
      .update({ completed })
      .eq('id', taskRowId)
      .eq('employee_id', user.id)

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    // 2. Get the task row + plan + employee profile
    const { data: row } = await supabase
      .from('task_rows')
      .select('*, day_plans(*)')
      .eq('id', taskRowId)
      .single()

    if (!row) return NextResponse.json({ success: true })

    const { data: employee } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .single()

    // 3. Find admins of the same department
    const dept = row.day_plans?.department
    if (!dept) return NextResponse.json({ success: true })

    const { data: admins } = await supabase
      .from('profiles')
      .select('email, full_name')
      .in('role', ['super_admin', 'sub_admin'])
      .eq('department', dept)

    const adminEmails = (admins ?? []).map(a => a.email).filter(Boolean)
    if (adminEmails.length === 0) return NextResponse.json({ success: true })

    // 4. Send email to admins if configured
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      const transporter = createTransporter()
      const dateStr = row.day_plans?.plan_date
        ? new Date(row.day_plans.plan_date).toLocaleDateString('uk-UA', {
            day: 'numeric', month: 'long', year: 'numeric',
          })
        : ''

      const html = `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f0f7f0; border-radius: 12px;">
          <h2 style="color: #2d6a4f; margin-bottom: 8px;">Звіт від ${employee?.full_name || user.email}</h2>
          <p style="color: #555; margin-bottom: 4px;">Відділ: <strong>${dept}</strong></p>
          <p style="color: #555; margin-bottom: 16px;">Дата: <strong>${dateStr}</strong></p>
          <div style="background: white; border-radius: 8px; padding: 16px; border-left: 4px solid #52b788;">
            <p style="white-space: pre-wrap; color: #333; margin: 0;">${completed}</p>
          </div>
          <p style="margin-top: 16px; font-size: 12px; color: #999;">GA-DayPlan</p>
        </div>
      `

      await transporter.sendMail({
        from: `GA-DayPlan <${process.env.GMAIL_USER}>`,
        to: adminEmails.join(', '),
        subject: `Звіт: ${employee?.full_name || user.email} — ${dateStr}`,
        html,
      })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
