'use client'

import { useState, useTransition } from 'react'
import type { Profile } from '@/lib/types'
import { createDayPlan } from '@/app/actions/admin'

type EmployeeOption = Pick<Profile, 'id' | 'full_name' | 'email' | 'department'>

interface Props {
  employees: EmployeeOption[]
}

const DEPARTMENTS = [
  'Відділ обліку та збору',
  'Упаковка',
  'Посадочна бригада',
  'Адміністрація',
]

export default function CreatePlanForm({ employees }: Props) {
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const [department, setDepartment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Group employees by department for the checkbox list
  const grouped = employees.reduce<Record<string, EmployeeOption[]>>((acc, emp) => {
    const key = emp.department || 'Без відділу'
    if (!acc[key]) acc[key] = []
    acc[key].push(emp)
    return acc
  }, {})

  function toggleEmployee(id: string) {
    setSelectedEmployees(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    )
  }

  function selectDepartmentEmployees(dept: string) {
    const deptIds = (grouped[dept] ?? []).map(e => e.id)
    const allSelected = deptIds.every(id => selectedEmployees.includes(id))
    if (allSelected) {
      setSelectedEmployees(prev => prev.filter(id => !deptIds.includes(id)))
    } else {
      setSelectedEmployees(prev => [...new Set([...prev, ...deptIds])])
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    selectedEmployees.forEach(id => formData.append('employee_ids', id))
    startTransition(async () => {
      const result = await createDayPlan(formData)
      if (result?.error) setError(result.error)
    })
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Date + Department row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="plan_date" className="text-sm font-medium text-foreground">Дата *</label>
          <input
            id="plan_date"
            name="plan_date"
            type="date"
            defaultValue={today}
            required
            className="rounded-lg border border-input bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="department" className="text-sm font-medium text-foreground">Відділ *</label>
          <select
            id="department"
            name="department"
            value={department}
            onChange={e => setDepartment(e.target.value)}
            required
            className="rounded-lg border border-input bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          >
            <option value="">— Оберіть відділ —</option>
            {DEPARTMENTS.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Default shift */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="default_shift" className="text-sm font-medium text-foreground">Стандартна зміна</label>
        <input
          id="default_shift"
          name="default_shift"
          type="text"
          defaultValue="8:00-17:00"
          placeholder="8:00-17:00"
          className="rounded-lg border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
        />
      </div>

      {/* Employees selection */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">
          Працівники{' '}
          <span className="text-muted-foreground font-normal">
            ({selectedEmployees.length} обрано)
          </span>
        </p>
        <div className="rounded-lg border border-border overflow-hidden max-h-80 overflow-y-auto">
          {Object.entries(grouped).map(([dept, members]) => {
            const deptIds = members.map(m => m.id)
            const allSelected = deptIds.every(id => selectedEmployees.includes(id))
            return (
              <div key={dept}>
                {/* Department header */}
                <button
                  type="button"
                  onClick={() => selectDepartmentEmployees(dept)}
                  className="flex w-full items-center justify-between bg-primary/5 px-4 py-2 text-left transition hover:bg-primary/10"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dept}</span>
                  <span className="text-xs text-primary">{allSelected ? 'Зняти всіх' : 'Обрати всіх'}</span>
                </button>
                {members.map(emp => (
                  <label
                    key={emp.id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-border/40 last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmployees.includes(emp.id)}
                      onChange={() => toggleEmployee(emp.id)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {emp.full_name || emp.email}
                      </p>
                      {emp.full_name && (
                        <p className="truncate text-xs text-muted-foreground">{emp.email}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )
          })}
          {employees.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Немає працівників. Спершу запросіть їх на сторінці &ldquo;Працівники&rdquo;.
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 border border-red-200">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? 'Створюємо...' : 'Створити план'}
      </button>
    </form>
  )
}
