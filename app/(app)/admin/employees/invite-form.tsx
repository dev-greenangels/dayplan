'use client'

import { useState, useRef } from 'react'
import { inviteEmployee } from '@/app/actions/admin'

const DEPARTMENTS = [
  'Відділ обліку та збору',
  'Упаковка',
  'Посадочна бригада',
  'Адміністрація',
]

export default function InviteForm() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const formData = new FormData(e.currentTarget)
    const result = await inviteEmployee(formData)
    if (result?.error) {
      setMessage({ type: 'error', text: result.error })
    } else {
      setMessage({ type: 'success', text: 'Запрошення надіслано!' })
      formRef.current?.reset()
    }
    setLoading(false)
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="inv-email" className="text-sm font-medium text-foreground">Email *</label>
        <input
          id="inv-email"
          name="email"
          type="email"
          required
          placeholder="worker@example.com"
          className="rounded-lg border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="inv-name" className="text-sm font-medium text-foreground">Ім&apos;я та прізвище</label>
        <input
          id="inv-name"
          name="full_name"
          type="text"
          placeholder="Іванова Марія"
          className="rounded-lg border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="inv-role" className="text-sm font-medium text-foreground">Роль</label>
        <select
          id="inv-role"
          name="role"
          className="rounded-lg border border-input bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
        >
          <option value="employee">Працівник</option>
          <option value="sub_admin">Менеджер</option>
          <option value="super_admin">Адмін</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="inv-dept" className="text-sm font-medium text-foreground">Відділ</label>
        <select
          id="inv-dept"
          name="department"
          className="rounded-lg border border-input bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
        >
          <option value="">— Оберіть відділ —</option>
          {DEPARTMENTS.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {message && (
        <p className={`rounded-lg px-3 py-2 text-sm border ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-600 border-red-200'
        }`}>
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Надсилаємо...' : 'Надіслати запрошення'}
      </button>
    </form>
  )
}
