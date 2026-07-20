'use client'

import { useState, useTransition, useCallback } from 'react'
import type { Profile } from '@/lib/types'
import { approveUser, deleteUser, updateEmployeeRole, savePlanForDate } from '@/app/actions/admin'

interface AdminPanelProps {
  currentProfile: Profile
  employees: Profile[]
  pendingUsers: Profile[]
  departments: string[]
}

type NotifyMode = 'email' | 'push' | null

interface RowState {
  planned: string
  notify_email: boolean
  notify_push: boolean
  completed?: string
}

export default function AdminPanel({ currentProfile, employees, pendingUsers, departments }: AdminPanelProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedDept, setSelectedDept] = useState(departments[0] ?? '')
  const [globalMode, setGlobalMode] = useState<NotifyMode>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [showUserModal, setShowUserModal] = useState(false)
  const [sending, setSending] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Employees in selected dept
  const deptEmployees = employees.filter(e => e.department === selectedDept)

  function getRow(empId: string): RowState {
    return rows[empId] ?? { planned: '', notify_email: false, notify_push: false }
  }

  function setRowField<K extends keyof RowState>(empId: string, field: K, val: RowState[K]) {
    setRows(prev => ({ ...prev, [empId]: { ...getRow(empId), [field]: val } }))
  }

  function toggleGlobalMode(mode: NotifyMode) {
    const next = globalMode === mode ? null : mode
    setGlobalMode(next)
    if (next) {
      // Apply toggle to all current dept employees
      const field = next === 'email' ? 'notify_email' : 'notify_push'
      setRows(prev => {
        const updated = { ...prev }
        deptEmployees.forEach(e => {
          updated[e.id] = { ...getRow(e.id), [field]: true }
        })
        return updated
      })
    }
  }

  async function handleSendPlans() {
    setSending(true)
    setSaveMsg(null)
    try {
      const payload = deptEmployees.map(e => ({
        employee_id: e.id,
        email: e.email,
        full_name: e.full_name,
        ...getRow(e.id),
      }))
      const res = await fetch('/api/send-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, department: selectedDept, rows: payload }),
      })
      const json = await res.json()
      if (json.error) {
        setSaveMsg('Помилка: ' + json.error)
      } else {
        setSaveMsg(`Відправлено ${json.sent ?? 0} сповіщень`)
      }
    } catch {
      setSaveMsg('Помилка мережі')
    }
    setSending(false)
  }

  async function handleSavePlan() {
    setSaveMsg(null)
    const payload = deptEmployees.map(e => ({ employee_id: e.id, ...getRow(e.id) }))
    startTransition(async () => {
      const res = await savePlanForDate(selectedDate, selectedDept, payload)
      setSaveMsg(res.error ? 'Помилка: ' + res.error : 'План збережено')
    })
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Адмін панель</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Управління планами команди</p>
        </div>
        <button
          onClick={() => setShowUserModal(true)}
          className="relative flex items-center gap-2 rounded-xl border border-border bg-white/70 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
          </svg>
          Керування користувачами
          {pendingUsers.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white font-bold">
              {pendingUsers.length}
            </span>
          )}
        </button>
      </div>

      {/* Filters row */}
      <div className="glass-card mb-5 flex flex-wrap items-center gap-3 p-4">
        {/* Date picker */}
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="rounded-lg border border-input bg-white/70 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Department picker */}
        <select
          value={selectedDept}
          onChange={e => setSelectedDept(e.target.value)}
          className="rounded-lg border border-input bg-white/70 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {departments.length === 0 && <option value="">Немає відділів</option>}
          {departments.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Global toggles */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => toggleGlobalMode('email')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              globalMode === 'email'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-white/70 text-muted-foreground hover:bg-white'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email розсилка
          </button>
          <button
            onClick={() => toggleGlobalMode('push')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              globalMode === 'push'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-white/70 text-muted-foreground hover:bg-white'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            Push сповіщення
          </button>
        </div>
      </div>

      {/* Employee table / cards */}
      {deptEmployees.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center gap-3 py-16 text-center">
          <svg className="h-10 w-10 text-muted-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-muted-foreground text-sm">У цьому відділі немає працівників</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="glass-card hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left">
                  <th className="px-4 py-3 font-semibold text-foreground">ПІБ</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Email</th>
                  <th className="px-4 py-3 font-semibold text-foreground w-72">План на день</th>
                  <th className="px-4 py-3 font-semibold text-foreground w-56">Звіт</th>
                  <th className="px-4 py-3 text-center font-semibold text-foreground">
                    <svg className="mx-auto h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8" />
                    </svg>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-foreground">
                    <svg className="mx-auto h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5" />
                    </svg>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deptEmployees.map((emp, i) => {
                  const row = getRow(emp.id)
                  const hasReport = !!row.completed
                  return (
                    <tr key={emp.id} className={`border-b border-border/40 last:border-0 ${i % 2 === 0 ? 'bg-white/20' : ''}`}>
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{emp.full_name || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{emp.email}</td>
                      <td className="px-4 py-3">
                        <textarea
                          value={row.planned}
                          onChange={e => setRowField(emp.id, 'planned', e.target.value)}
                          placeholder="Введіть план..."
                          rows={2}
                          className="w-full resize-none rounded-lg border border-input bg-white/60 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="px-4 py-3">
                        {hasReport ? (
                          <div className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs text-green-700">
                            {row.completed}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Очікується...</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={row.notify_email}
                          onChange={e => setRowField(emp.id, 'notify_email', e.target.checked)}
                          className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={row.notify_push}
                          onChange={e => setRowField(emp.id, 'notify_push', e.target.checked)}
                          className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {deptEmployees.map(emp => {
              const row = getRow(emp.id)
              const hasReport = !!row.completed
              return (
                <div key={emp.id} className="glass-card p-4">
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{emp.full_name || '—'}</p>
                      <p className="text-xs text-muted-foreground">{emp.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                        <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8" />
                        </svg>
                        <input
                          type="checkbox"
                          checked={row.notify_email}
                          onChange={e => setRowField(emp.id, 'notify_email', e.target.checked)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                      </label>
                      <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                        <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5" />
                        </svg>
                        <input
                          type="checkbox"
                          checked={row.notify_push}
                          onChange={e => setRowField(emp.id, 'notify_push', e.target.checked)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                      </label>
                    </div>
                  </div>

                  <textarea
                    value={row.planned}
                    onChange={e => setRowField(emp.id, 'planned', e.target.value)}
                    placeholder="Введіть план на день..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-input bg-white/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />

                  {hasReport && (
                    <div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                      <span className="font-medium">Звіт: </span>{row.completed}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Save + Send buttons */}
      {deptEmployees.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-3">
          {saveMsg && (
            <p className={`rounded-lg px-4 py-2 text-sm font-medium ${
              saveMsg.startsWith('Помилка')
                ? 'bg-red-50 text-red-600 border border-red-200'
                : 'bg-green-50 text-green-700 border border-green-200'
            }`}>{saveMsg}</p>
          )}
          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={handleSavePlan}
              disabled={isPending}
              className="flex-1 rounded-xl border border-border bg-white/70 px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition hover:bg-white disabled:opacity-60"
            >
              {isPending ? 'Збереження...' : 'Зберегти план'}
            </button>
            <button
              onClick={handleSendPlans}
              disabled={sending}
              className="group relative flex-1 overflow-hidden rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow shadow-primary/30 transition hover:opacity-90 hover:shadow-lg hover:shadow-primary/30 disabled:opacity-60"
            >
              <span className={`flex items-center justify-center gap-2 ${sending ? 'opacity-0' : ''}`}>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Відправити команді
              </span>
              {sending && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* User management modal */}
      {showUserModal && (
        <UserManagementModal
          pendingUsers={pendingUsers}
          departments={departments}
          onClose={() => setShowUserModal(false)}
        />
      )}
    </div>
  )
}

// ---- User Management Modal ----
function UserManagementModal({
  pendingUsers,
  departments,
  onClose,
}: {
  pendingUsers: Profile[]
  departments: string[]
  onClose: () => void
}) {
  const [list, setList] = useState(pendingUsers)
  const [approving, setApproving] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState<Record<string, string>>({})
  const [selectedDept, setSelectedDept] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  function handleApprove(userId: string) {
    const role = selectedRole[userId] || 'employee'
    const dept = selectedDept[userId] || departments[0] || ''
    setApproving(userId)
    startTransition(async () => {
      await approveUser(userId, role, dept)
      setList(prev => prev.filter(u => u.id !== userId))
      setApproving(null)
    })
  }

  function handleDelete(userId: string) {
    startTransition(async () => {
      await deleteUser(userId)
      setList(prev => prev.filter(u => u.id !== userId))
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl p-6 shadow-2xl"
        style={{
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Керування користувачами</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {list.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Немає користувачів, що очікують підтвердження
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">
            {list.map(user => (
              <div key={user.id} className="rounded-xl border border-border/60 bg-white/60 p-4">
                <div className="mb-3">
                  <p className="font-semibold text-foreground">{user.full_name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <div className="mb-3 flex gap-2">
                  <select
                    value={selectedRole[user.id] ?? 'employee'}
                    onChange={e => setSelectedRole(prev => ({ ...prev, [user.id]: e.target.value }))}
                    className="flex-1 rounded-lg border border-input bg-white px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="employee">Працівник</option>
                    <option value="sub_admin">Менеджер</option>
                    <option value="super_admin">Адмін</option>
                  </select>
                  <select
                    value={selectedDept[user.id] ?? (departments[0] || '')}
                    onChange={e => setSelectedDept(prev => ({ ...prev, [user.id]: e.target.value }))}
                    className="flex-1 rounded-lg border border-input bg-white px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    {departments.length === 0 && <option value="">Немає відділів</option>}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(user.id)}
                    disabled={approving === user.id || isPending}
                    className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60"
                  >
                    {approving === user.id ? '...' : 'Схвалити'}
                  </button>
                  <button
                    onClick={() => handleDelete(user.id)}
                    disabled={isPending}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    Видалити
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
