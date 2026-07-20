'use client'

import { useState, useTransition } from 'react'
import type { Profile, UserRole } from '@/lib/types'
import { updateEmployeeRole } from '@/app/actions/admin'

interface Props {
  employees: Profile[]
  currentUserId: string
  isSuperAdmin: boolean
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Адмін',
  sub_admin: 'Менеджер',
  employee: 'Працівник',
}

const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'bg-primary/20 text-primary',
  sub_admin: 'bg-secondary text-secondary-foreground',
  employee: 'bg-muted text-muted-foreground',
}

export default function EmployeeList({ employees, currentUserId, isSuperAdmin }: Props) {
  const [list, setList] = useState(employees)
  const [isPending, startTransition] = useTransition()

  function handleRoleChange(profileId: string, role: string) {
    setList(prev => prev.map(p => p.id === profileId ? { ...p, role: role as UserRole } : p))
    startTransition(async () => {
      await updateEmployeeRole(profileId, role)
    })
  }

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <p className="text-sm text-muted-foreground">Немає працівників</p>
      </div>
    )
  }

  // Group by department
  const grouped = list.reduce<Record<string, Profile[]>>((acc, p) => {
    const key = p.department || 'Без відділу'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  return (
    <div className="divide-y divide-border">
      {Object.entries(grouped).map(([dept, members]) => (
        <div key={dept}>
          <div className="bg-primary/5 px-6 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dept}</p>
          </div>
          {members.map(emp => (
            <div key={emp.id} className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-muted/30 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground text-sm">
                  {emp.full_name || emp.email}
                  {emp.id === currentUserId && (
                    <span className="ml-2 text-xs text-muted-foreground">(ви)</span>
                  )}
                </p>
                {emp.full_name && (
                  <p className="truncate text-xs text-muted-foreground">{emp.email}</p>
                )}
              </div>
              <div className="shrink-0">
                {isSuperAdmin && emp.id !== currentUserId ? (
                  <select
                    value={emp.role}
                    onChange={e => handleRoleChange(emp.id, e.target.value)}
                    disabled={isPending}
                    className="rounded-md border border-input bg-background/60 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary transition"
                  >
                    <option value="employee">Працівник</option>
                    <option value="sub_admin">Менеджер</option>
                    <option value="super_admin">Адмін</option>
                  </select>
                ) : (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[emp.role]}`}>
                    {ROLE_LABELS[emp.role]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
