import nodemailer from 'nodemailer'

export function createMailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

export function isMailConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
}

export async function sendAppMail(opts: {
  to: string
  subject: string
  html: string
  bcc?: string
}) {
  if (!isMailConfigured()) {
    throw new Error('Gmail не налаштовано')
  }
  const transporter = createMailTransporter()
  await transporter.sendMail({
    from: `PlanDay-GA <${process.env.GMAIL_USER}>`,
    to: opts.to,
    bcc: opts.bcc,
    subject: opts.subject,
    html: opts.html,
  })
}
