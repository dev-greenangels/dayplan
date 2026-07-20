'use client'

import { useState, useTransition } from 'react'
import type { TaskRow, Profile, UserRole } from '@/lib/types'
import { updateTaskRow } from '@/app/actions/task-row'

interface PlanTableProps {
  rows: (TaskRow & { profile: Profile })[]
  planId: string
  currentUserId: string
  currentUserRole: UserRole
  planDepartment: string
  planDate: string
}

type EditField = 'planned' | 'completed' | 'notes' | 'shift'

interface CellEdit {
  rowId: string
  field: EditField
  value: string
}

function canEditRow(row: TaskRow, userId: string, role: UserRole): boolean {
  if (role === 'super_admin' || role === 'sub_admin') return true
  return row.employee_id === userId
}

function canEditField(field: EditField, role: UserRole): boolean {
  if (role === 'super_admin' || role === 'sub_admin') return true
  // employees can only edit completed and notes
  return field === 'completed' || field === 'notes'
}

export default function PlanTable({
  rows: initialRows,
  planId,
  currentUserId,
  currentUserRole,
  planDepartment,
  planDate,
}: PlanTableProps) {
  const [rows, setRows] = useState(initialRows)
  const [editing, setEditing] = useState<CellEdit | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'sub_admin'

  function startEdit(rowId: string, field: EditField, currentValue: string) {
    const row = rows.find(r => r.id === rowId)
    if (!row) return
    if (!canEditRow(row, currentUserId, currentUserRole)) return
    if (!canEditField(field, currentUserRole)) return
    setEditing({ rowId, field, value: currentValue })
  }

  async function commitEdit() {
    if (!editing) return
    const { rowId, field, value } = editing
    const oldRows = rows
    // Optimistic update
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: value } : r))
    setEditing(null)
    setSaving(rowId)

    startTransition(async () => {
      const result = await updateTaskRow(rowId, { [field]: value })
      if (result?.error) {
        setRows(oldRows) // revert
      }
      setSaving(null)
    })
  }

  async function toggleNotified(rowId: string, current: boolean) {
    if (!isAdmin) return
    const oldRows = rows
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, notified: !current } : r))
    startTransition(async () => {
      const result = await updateTaskRow(rowId, { notified: !current })
      if (result?.error) setRows(oldRows)
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      commitEdit()
    }
    if (e.key === 'Escape') setEditing(null)
  }

  const formattedDate = new Date(planDate).toLocaleDateString('uk-UA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div>
      {/* Plan header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">{planDepartment || 'Без відділу'}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground capitalize">{formattedDate}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              disabled
              className="rounded-lg border border-border bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-900 opacity-60 cursor-not-allowed"
              title="Відправити повідомлення всім (буде доступно пізніше)"
            >
              Відправити всім
            </button>
          )}
        </div>
      </div>

      {/* ===== DESKTOP TABLE ===== */}
      <div className="hidden lg:block">
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-primary/8">
                  <th className="px-4 py-3 text-left font-semibold text-foreground w-[170px]">Працівник</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground w-[110px]">Робоча зміна</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Заплановано</th>
                  <th className="px-4 py-3 text-center font-semibold text-foreground w-[60px]">
                    <svg className="mx-auto h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Виконано</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground w-[150px]">Обробки</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const editable = canEditRow(row, currentUserId, currentUserRole)
                  const isSaving = saving === row.id

                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-border/60 transition-colors ${idx % 2 === 0 ? 'bg-green-50/30' : 'bg-white/20'} ${isSaving ? 'opacity-70' : ''}`}
                    >
                      {/* Employee */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground leading-snug">
                          {row.profile?.full_name || row.profile?.email || '—'}
                        </div>
                        {row.profile?.email && row.profile.full_name && (
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]">{row.profile.email}</div>
                        )}
                      </td>

                      {/* Shift */}
                      <td className="px-4 py-3">
                        {editing?.rowId === row.id && editing.field === 'shift' ? (
                          <input
                            autoFocus
                            className="w-full rounded border border-primary/50 bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            value={editing.value}
                            onChange={e => setEditing(ed => ed ? { ...ed, value: e.target.value } : null)}
                            onBlur={commitEdit}
                            onKeyDown={handleKeyDown}
                          />
                        ) : (
                          <span
                            onClick={() => editable && canEditField('shift', currentUserRole) && startEdit(row.id, 'shift', row.shift)}
                            className={`block rounded px-1 py-0.5 text-sm text-foreground ${editable && canEditField('shift', currentUserRole) ? 'cursor-pointer hover:bg-primary/10' : ''}`}
                          >
                            {row.shift || '—'}
                          </span>
                        )}
                      </td>

                      {/* Planned */}
                      <td className="px-4 py-3">
                        {editing?.rowId === row.id && editing.field === 'planned' ? (
                          <textarea
                            autoFocus
                            rows={3}
                            className="w-full rounded border border-primary/50 bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                            value={editing.value}
                            onChange={e => setEditing(ed => ed ? { ...ed, value: e.target.value } : null)}
                            onBlur={commitEdit}
                            onKeyDown={handleKeyDown}
                          />
                        ) : (
                          <span
                            onClick={() => editable && canEditField('planned', currentUserRole) && startEdit(row.id, 'planned', row.planned)}
                            className={`block whitespace-pre-wrap text-sm text-foreground leading-relaxed ${editable && canEditField('planned', currentUserRole) ? 'cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5' : ''}`}
                          >
                            {row.planned || <span className="text-muted-foreground italic">—</span>}
                          </span>
                        )}
                      </td>

                      {/* Notified bell */}
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleNotified(row.id, row.notified)}
                          disabled={!isAdmin}
                          className={`mx-auto flex h-7 w-7 items-center justify-center rounded transition ${
                            row.notified
                              ? 'bg-green-100 text-green-600'
                              : 'bg-muted text-muted-foreground'
                          } ${isAdmin ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
                          title={row.notified ? 'Повідомлено' : 'Не повідомлено'}
                        >
                          {row.notified ? (
                            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                            </svg>
                          )}
                        </button>
                      </td>

                      {/* Completed */}
                      <td className="px-4 py-3">
                        {editing?.rowId === row.id && editing.field === 'completed' ? (
                          <textarea
                            autoFocus
                            rows={3}
                            className="w-full rounded border border-primary/50 bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                            value={editing.value}
                            onChange={e => setEditing(ed => ed ? { ...ed, value: e.target.value } : null)}
                            onBlur={commitEdit}
                            onKeyDown={handleKeyDown}
                          />
                        ) : (
                          <span
                            onClick={() => editable && startEdit(row.id, 'completed', row.completed)}
                            className={`block whitespace-pre-wrap text-sm text-foreground leading-relaxed ${editable ? 'cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5' : ''}`}
                          >
                            {row.completed || <span className="text-muted-foreground italic">—</span>}
                          </span>
                        )}
                      </td>

                      {/* Notes */}
                      <td className="px-4 py-3">
                        {editing?.rowId === row.id && editing.field === 'notes' ? (
                          <textarea
                            autoFocus
                            rows={2}
                            className="w-full rounded border border-primary/50 bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                            value={editing.value}
                            onChange={e => setEditing(ed => ed ? { ...ed, value: e.target.value } : null)}
                            onBlur={commitEdit}
                            onKeyDown={handleKeyDown}
                          />
                        ) : (
                          <span
                            onClick={() => editable && startEdit(row.id, 'notes', row.notes)}
                            className={`block whitespace-pre-wrap text-sm text-foreground leading-relaxed ${editable ? 'cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5' : ''}`}
                          >
                            {row.notes || <span className="text-muted-foreground italic">—</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Натисніть на клітинку для редагування. Enter — зберегти, Esc — скасувати.</p>
      </div>

      {/* ===== MOBILE CARDS ===== */}
      <div className="flex flex-col gap-4 lg:hidden">
        {rows.map(row => {
          const editable = canEditRow(row, currentUserId, currentUserRole)
          const isSaving = saving === row.id

          return (
            <div key={row.id} className={`glass-card p-4 ${isSaving ? 'opacity-70' : ''}`}>
              {/* Employee header */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">
                    {row.profile?.full_name || row.profile?.email || '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">{row.shift}</p>
                </div>
                <button
                  onClick={() => toggleNotified(row.id, row.notified)}
                  disabled={!isAdmin}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                    row.notified ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground'
                  } ${isAdmin ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                >
                  {row.notified ? (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Planned */}
              <MobileField
                label="Заплановано"
                value={row.planned}
                rowId={row.id}
                field="planned"
                editable={editable && canEditField('planned', currentUserRole)}
                editing={editing}
                onStartEdit={startEdit}
                onCommit={commitEdit}
                onKeyDown={handleKeyDown}
                onEditChange={val => setEditing(ed => ed ? { ...ed, value: val } : null)}
              />
              {/* Completed */}
              <MobileField
                label="Виконано"
                value={row.completed}
                rowId={row.id}
                field="completed"
                editable={editable}
                editing={editing}
                onStartEdit={startEdit}
                onCommit={commitEdit}
                onKeyDown={handleKeyDown}
                onEditChange={val => setEditing(ed => ed ? { ...ed, value: val } : null)}
              />
              {/* Notes */}
              <MobileField
                label="Обробки"
                value={row.notes}
                rowId={row.id}
                field="notes"
                editable={editable}
                editing={editing}
                onStartEdit={startEdit}
                onCommit={commitEdit}
                onKeyDown={handleKeyDown}
                onEditChange={val => setEditing(ed => ed ? { ...ed, value: val } : null)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface MobileFieldProps {
  label: string
  value: string
  rowId: string
  field: EditField
  editable: boolean
  editing: CellEdit | null
  onStartEdit: (rowId: string, field: EditField, value: string) => void
  onCommit: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onEditChange: (val: string) => void
}

function MobileField({ label, value, rowId, field, editable, editing, onStartEdit, onCommit, onKeyDown, onEditChange }: MobileFieldProps) {
  const isEditing = editing?.rowId === rowId && editing?.field === field

  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {isEditing ? (
        <textarea
          autoFocus
          rows={3}
          className="w-full rounded-lg border border-primary/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          value={editing!.value}
          onChange={e => onEditChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <p
          onClick={() => editable && onStartEdit(rowId, field, value)}
          className={`min-h-[2rem] whitespace-pre-wrap rounded-lg px-2 py-1.5 text-sm text-foreground leading-relaxed ${
            editable ? 'cursor-pointer hover:bg-primary/10 border border-transparent hover:border-primary/20' : ''
          }`}
        >
          {value || <span className="text-muted-foreground italic">—</span>}
        </p>
      )}
    </div>
  )
}
