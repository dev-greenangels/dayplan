'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Department, Team, TeamColumn, WorkMode } from '@/lib/types'
import {
  createTeam,
  updateTeam,
  deleteTeam,
  createDepartment,
  archiveDepartment,
  restoreDepartment,
  addTeamColumn,
  deleteTeamColumn,
  updateTeamColumn,
  reorderTeamColumns,
  setTeamAdmins,
} from '@/app/actions/org'
import ConfirmDialog from '@/components/confirm-dialog'
import PencilEdit from '@/components/pencil-edit'
import { useToast } from '@/components/toast-provider'

interface Deputy {
  id: string
  full_name: string
  email: string
  role: string
}

interface TeamAdminRow {
  team_id: string
  user_id: string
  hide_from_plan?: boolean
  can_edit_tasks?: boolean
  can_add_photos?: boolean
  can_access_people?: boolean
  notify_email?: boolean
  notify_push?: boolean
}

interface Props {
  /** null = create new team mode */
  team: Team | null
  departments: Department[]
  columns: TeamColumn[]
  teamAdmins: TeamAdminRow[]
  memberDepartments: { team_id: string; user_id: string; department_id: string | null }[]
  deputies: Deputy[]
  isSuperAdmin: boolean
  onDone: () => void
}

export default function TeamSettingsPanel({
  team,
  departments,
  columns,
  teamAdmins,
  memberDepartments,
  deputies,
  isSuperAdmin,
  onDone,
}: Props) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [name, setName] = useState(team?.name ?? '')
  const [mode, setMode] = useState<WorkMode>(team?.work_mode ?? 'shared')
  const [defaultShift, setDefaultShift] = useState(team?.default_shift || '8:00-18:00')
  const [showSendWorkers, setShowSendWorkers] = useState(team?.show_send_worker_emails !== false)
  const [showSendLeadership, setShowSendLeadership] = useState(team?.show_send_leadership !== false)
  const [newDept, setNewDept] = useState('')
  const [newCol, setNewCol] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const activeTeamId = team?.id ?? createdId
  const isCreate = !team && !createdId

  const activeDepts = useMemo(
    () => departments.filter(d => d.team_id === activeTeamId && !d.archived_at),
    [departments, activeTeamId]
  )
  const archivedDepts = useMemo(
    () => departments.filter(d => d.team_id === activeTeamId && !!d.archived_at),
    [departments, activeTeamId]
  )
  const cols = useMemo(
    () => columns.filter(c => c.team_id === activeTeamId).sort((a, b) => a.sort_order - b.sort_order),
    [columns, activeTeamId]
  )
  const adminsForTeam = teamAdmins.filter(a => a.team_id === activeTeamId)
  const adminIds = adminsForTeam.map(a => a.user_id)
  const membersForTeam = memberDepartments.filter(m => m.team_id === activeTeamId)
  const adminsKey = `${activeTeamId}:${[...adminIds].sort().join(',')}:${adminsForTeam.map(a => `${a.user_id}:${a.hide_from_plan}:${a.can_edit_tasks !== false}:${a.can_add_photos !== false}:${!!a.can_access_people}:${a.notify_email !== false}:${a.notify_push !== false}`).join('|')}:${membersForTeam.map(m => `${m.user_id}:${m.department_id}`).join('|')}`
  const hideMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const a of adminsForTeam) m.set(a.user_id, !!a.hide_from_plan)
    return m
  }, [adminsForTeam])
  const editTasksMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const a of adminsForTeam) m.set(a.user_id, a.can_edit_tasks !== false)
    return m
  }, [adminsForTeam])
  const addPhotosMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const a of adminsForTeam) m.set(a.user_id, a.can_add_photos !== false)
    return m
  }, [adminsForTeam])
  const peopleAccessMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const a of adminsForTeam) m.set(a.user_id, !!a.can_access_people)
    return m
  }, [adminsForTeam])
  const notifyEmailMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const a of adminsForTeam) m.set(a.user_id, a.notify_email !== false)
    return m
  }, [adminsForTeam])
  const notifyPushMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const a of adminsForTeam) m.set(a.user_id, a.notify_push !== false)
    return m
  }, [adminsForTeam])
  const deptMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of membersForTeam) {
      if (x.department_id) m.set(x.user_id, x.department_id)
    }
    return m
  }, [membersForTeam])

  const eligibleDeputies = deputies.filter(d => d.role === 'sub_admin' || d.role === 'super_admin')
  const [checkedAdmins, setCheckedAdmins] = useState<Set<string>>(() => new Set(adminIds))
  const [hideFromPlan, setHideFromPlan] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}
    for (const a of adminsForTeam) o[a.user_id] = !!a.hide_from_plan
    return o
  })
  const [canEditTasks, setCanEditTasks] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}
    for (const a of adminsForTeam) o[a.user_id] = a.can_edit_tasks !== false
    return o
  })
  const [canAddPhotos, setCanAddPhotos] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}
    for (const a of adminsForTeam) o[a.user_id] = a.can_add_photos !== false
    return o
  })
  const [canAccessPeople, setCanAccessPeople] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}
    for (const a of adminsForTeam) o[a.user_id] = !!a.can_access_people
    return o
  })
  const [notifyEmail, setNotifyEmail] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}
    for (const a of adminsForTeam) o[a.user_id] = a.notify_email !== false
    return o
  })
  const [notifyPush, setNotifyPush] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}
    for (const a of adminsForTeam) o[a.user_id] = a.notify_push !== false
    return o
  })
  const [leaderDept, setLeaderDept] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const a of adminsForTeam) {
      const d = deptMap.get(a.user_id)
      if (d) o[a.user_id] = d
    }
    return o
  })
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const c of columns) o[c.id] = c.input_template ?? ''
    return o
  })
  const [newColTemplate, setNewColTemplate] = useState('')

  // Sync when team / admins change
  useEffect(() => {
    setCheckedAdmins(new Set(adminIds))
    const hide: Record<string, boolean> = {}
    const edit: Record<string, boolean> = {}
    const photos: Record<string, boolean> = {}
    const people: Record<string, boolean> = {}
    const email: Record<string, boolean> = {}
    const push: Record<string, boolean> = {}
    const depts: Record<string, string> = {}
    for (const a of adminsForTeam) {
      hide[a.user_id] = !!a.hide_from_plan
      edit[a.user_id] = a.can_edit_tasks !== false
      photos[a.user_id] = a.can_add_photos !== false
      people[a.user_id] = !!a.can_access_people
      email[a.user_id] = a.notify_email !== false
      push[a.user_id] = a.notify_push !== false
      const d = deptMap.get(a.user_id)
      if (d) depts[a.user_id] = d
    }
    setHideFromPlan(hide)
    setCanEditTasks(edit)
    setCanAddPhotos(photos)
    setCanAccessPeople(people)
    setNotifyEmail(email)
    setNotifyPush(push)
    setLeaderDept(depts)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminsKey])

  useEffect(() => {
    const o: Record<string, string> = {}
    for (const c of columns) o[c.id] = c.input_template ?? ''
    setTemplateDrafts(o)
  }, [columns])

  useEffect(() => {
    if (!team) return
    setName(team.name)
    setMode(team.work_mode)
    setDefaultShift(team.default_shift || '8:00-18:00')
    setShowSendWorkers(team.show_send_worker_emails !== false)
    setShowSendLeadership(team.show_send_leadership !== false)
  }, [team?.id, team?.name, team?.work_mode, team?.default_shift, team?.show_send_worker_emails, team?.show_send_leadership])

  const deputiesDirty = useMemo(() => {
    if (checkedAdmins.size !== adminIds.length) return true
    for (const id of adminIds) {
      if (!checkedAdmins.has(id)) return true
      if (!!hideMap.get(id) !== !!hideFromPlan[id]) return true
      if (!!editTasksMap.get(id) !== (canEditTasks[id] !== false)) return true
      if (!!addPhotosMap.get(id) !== (canAddPhotos[id] !== false)) return true
      if (!!peopleAccessMap.get(id) !== !!canAccessPeople[id]) return true
      if (!!notifyEmailMap.get(id) !== (notifyEmail[id] !== false)) return true
      if (!!notifyPushMap.get(id) !== (notifyPush[id] !== false)) return true
      if ((deptMap.get(id) || '') !== (leaderDept[id] || '')) return true
    }
    for (const id of checkedAdmins) {
      if (!adminIds.includes(id)) return true
    }
    return false
  }, [checkedAdmins, adminIds, hideFromPlan, hideMap, canEditTasks, editTasksMap, canAddPhotos, addPhotosMap, canAccessPeople, peopleAccessMap, notifyEmail, notifyEmailMap, notifyPush, notifyPushMap, leaderDept, deptMap])

  const teamDirty = !!team && (
    name.trim() !== team.name ||
    mode !== team.work_mode ||
    defaultShift.trim() !== (team.default_shift || '8:00-18:00') ||
    showSendWorkers !== (team.show_send_worker_emails !== false) ||
    showSendLeadership !== (team.show_send_leadership !== false)
  )

  function run(fn: () => Promise<{ error?: string; team?: Team } | unknown>) {
    setMsg(null)
    startTransition(async () => {
      const res = (await fn()) as { error?: string; team?: Team }
      if (res?.error) toast.error(res.error)
      else {
        setMsg('Збережено')
        router.refresh()
        if (res?.team) setCreatedId(res.team.id)
      }
    })
  }

  function moveColumn(colId: string, dir: -1 | 1) {
    if (!activeTeamId) return
    const ids = cols.map(c => c.id)
    const idx = ids.indexOf(colId)
    const next = idx + dir
    if (idx < 0 || next < 0 || next >= ids.length) return
    ;[ids[idx], ids[next]] = [ids[next], ids[idx]]
    run(() => reorderTeamColumns(activeTeamId, ids))
  }

  if (isCreate) {
    return (
      <div className="flex flex-col gap-4">
        {msg && (
          <p className={`rounded-lg px-3 py-2 text-sm ${msg.startsWith('Помилка') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
            {msg}
          </p>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Назва команди</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Напр. Полтава"
            className="rounded-lg border border-input bg-white px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Режим відображення плану</label>
          <select
            value={mode}
            onChange={e => setMode(e.target.value as WorkMode)}
            className="rounded-lg border border-input bg-white px-3 py-2 text-sm"
          >
            <option value="shared">Спільний ПК (одна таблиця)</option>
            <option value="individual">Індивідуально (особистий кабінет)</option>
          </select>
        </div>
        <button
          disabled={isPending || !name.trim() || !isSuperAdmin}
          onClick={() => run(async () => createTeam(name, mode))}
          className="tap-btn rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {isPending ? '...' : 'Створити команду'}
        </button>
        {!isSuperAdmin && (
          <p className="text-xs text-muted-foreground">Лише шеф може створювати команди.</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.startsWith('Помилка') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
          {msg}
        </p>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Основні параметри</h3>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Назва</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="rounded-lg border border-input bg-white px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Режим відображення плану</label>
            <select
              value={mode}
              onChange={e => setMode(e.target.value as WorkMode)}
              className="rounded-lg border border-input bg-white px-3 py-2 text-sm"
            >
              <option value="shared">Спільний ПК</option>
              <option value="individual">Індивідуально</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Дефолтна робоча зміна</label>
            <input
              value={defaultShift}
              onChange={e => setDefaultShift(e.target.value)}
              placeholder="8:00-18:00"
              className="rounded-lg border border-input bg-white px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">Підставляється при додаванні працівників у план.</p>
          </div>
          <div className="rounded-xl border border-border/40 bg-white/40 p-3">
            <p className="mb-2 text-xs font-medium text-foreground">Кнопки розсилки в плані</p>
            <p className="mb-2 text-[11px] text-muted-foreground">За замовчуванням увімкнені. Вимкніть, щоб сховати кнопки в плані.</p>
            <label className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span>Надіслати завдання працівникам</span>
              <input
                type="checkbox"
                role="switch"
                checked={showSendWorkers}
                onChange={e => setShowSendWorkers(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Надіслати план керівництву</span>
              <input
                type="checkbox"
                role="switch"
                checked={showSendLeadership}
                onChange={e => setShowSendLeadership(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={isPending || !teamDirty || !name.trim() || !activeTeamId}
              onClick={() => activeTeamId && run(() => updateTeam(activeTeamId, {
                name: name.trim(),
                work_mode: mode,
                default_shift: defaultShift.trim() || '8:00-18:00',
                show_send_worker_emails: showSendWorkers,
                show_send_leadership: showSendLeadership,
              }))}
              className="tap-btn rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              Зберегти
            </button>
            {team && (
              <button
                disabled={isPending}
                onClick={() => setDeleteOpen(true)}
                className="tap-btn rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
              >
                Видалити команду
              </button>
            )}
          </div>
        </div>
      </section>

      {activeTeamId && (
        <>
          <section>
            <h3 className="mb-1 text-sm font-semibold">Відділи</h3>
            <p className="mb-2 text-[11px] text-muted-foreground">
              «Архівувати» ховає відділ від нових планів, історія зберігається.
            </p>
            <ul className="mb-2 flex flex-col gap-1.5">
              {activeDepts.map(d => (
                <li key={d.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-white/60 px-3 py-2 text-sm">
                  <span>{d.name}</span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => archiveDepartment(d.id))}
                    className="tap-btn text-xs text-amber-700 hover:underline disabled:opacity-40"
                  >
                    Архівувати
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={newDept}
                onChange={e => setNewDept(e.target.value)}
                placeholder="Новий відділ"
                className="flex-1 rounded-lg border border-input bg-white px-3 py-2 text-sm"
              />
              <button
                disabled={isPending || !newDept.trim()}
                onClick={() => run(async () => {
                  const r = await createDepartment(activeTeamId, newDept)
                  if (!r.error) setNewDept('')
                  return r
                })}
                className="tap-btn rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                Додати
              </button>
            </div>
            {archivedDepts.length > 0 && (
              <div className="mt-2">
                <button type="button" onClick={() => setShowArchived(v => !v)} className="tap-btn text-xs text-muted-foreground">
                  {showArchived ? '▾' : '▸'} Архів ({archivedDepts.length})
                </button>
                {showArchived && (
                  <ul className="mt-1 flex flex-col gap-1">
                    {archivedDepts.map(d => (
                      <li key={d.id} className="flex items-center justify-between rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground">
                        <span>{d.name}</span>
                        <button type="button" disabled={isPending} onClick={() => run(() => restoreDepartment(d.id))} className="tap-btn text-xs text-primary">
                          Відновити
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold">Колонки плану</h3>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Порядок, назви та шаблони для порожніх клітинок. Шаблон не вважається заповненням для звіту. «Обробки» можна приховати.
            </p>
            <ul className="mb-2 flex flex-col gap-2">
              {cols.map((c, i) => (
                <li
                  key={`${c.id}-${c.hidden}`}
                  className={`rounded-lg border px-2 py-1.5 text-sm ${
                    c.hidden ? 'border-dashed opacity-70' : 'border-border/50 bg-white/60'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-col">
                      <button type="button" disabled={isPending || i === 0} onClick={() => moveColumn(c.id, -1)} className="tap-btn px-1 text-[10px] disabled:opacity-30">▲</button>
                      <button type="button" disabled={isPending || i === cols.length - 1} onClick={() => moveColumn(c.id, 1)} className="tap-btn px-1 text-[10px] disabled:opacity-30">▼</button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <PencilEdit
                        value={c.label}
                        disabled={isPending}
                        onSave={label => run(() => updateTeamColumn(c.id, { label }))}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{c.is_system ? 'системна' : 'власна'}</span>
                    {(!c.is_system || c.key === 'notes') && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(() => updateTeamColumn(c.id, { hidden: !c.hidden }))}
                        title={c.hidden ? 'Показати колонку' : 'Приховати колонку'}
                        className={`tap-btn rounded-lg p-1.5 ${c.hidden ? 'text-muted-foreground hover:bg-muted' : 'text-primary hover:bg-primary/10'}`}
                      >
                        {c.hidden ? (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    )}
                    {!c.is_system && (
                      <button type="button" disabled={isPending} onClick={() => run(() => deleteTeamColumn(c.id))} className="tap-btn text-xs text-red-600">
                        Видалити
                      </button>
                    )}
                  </div>
                  {c.key !== 'shift' && (
                    <div className="mt-1.5 ml-6">
                      <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Шаблон заготовки</label>
                      <textarea
                        value={templateDrafts[c.id] ?? ''}
                        onChange={e => setTemplateDrafts(prev => ({ ...prev, [c.id]: e.target.value }))}
                        rows={3}
                        placeholder="Текст, який підставляється в порожню клітинку"
                        className="w-full rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
                      />
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          disabled={isPending || (templateDrafts[c.id] ?? '') === (c.input_template ?? '')}
                          onClick={() => run(() => updateTeamColumn(c.id, { input_template: templateDrafts[c.id] ?? '' }))}
                          className="tap-btn rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
                        >
                          Зберегти шаблон
                        </button>
                        {(templateDrafts[c.id] || c.input_template) && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              setTemplateDrafts(prev => ({ ...prev, [c.id]: '' }))
                              run(() => updateTeamColumn(c.id, { input_template: null }))
                            }}
                            className="tap-btn text-[11px] text-muted-foreground"
                          >
                            Очистити
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  value={newCol}
                  onChange={e => setNewCol(e.target.value)}
                  placeholder="Нова колонка"
                  className="flex-1 rounded-lg border border-input bg-white px-3 py-2 text-sm"
                />
                <button
                  disabled={isPending || !newCol.trim()}
                  onClick={() => run(async () => {
                    const r = await addTeamColumn(activeTeamId!, newCol, newColTemplate)
                    if (!r.error) {
                      setNewCol('')
                      setNewColTemplate('')
                    }
                    return r
                  })}
                  className="tap-btn rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  Додати
                </button>
              </div>
              <textarea
                value={newColTemplate}
                onChange={e => setNewColTemplate(e.target.value)}
                rows={2}
                placeholder="Опційний шаблон для нової колонки"
                className="w-full rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
              />
            </div>
          </section>

          {isSuperAdmin && (
            <section>
              <h3 className="mb-1 text-sm font-semibold">Керівництво команди</h3>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Відзначені отримують «План керівництву» / «Звіт керівництву» (вся таблиця). Email і push —
                лише для цієї команди (і лише якщо в картці користувача канал увімкнено глобально).
                «Не в плані» — керує командою, але не зʼявляється в таблиці дня. Для появи в плані оберіть відділ.
              </p>
              <div className="flex flex-col gap-2">
                {eligibleDeputies.map(d => {
                  const checked = checkedAdmins.has(d.id)
                  const roleLabel = d.role === 'super_admin' ? 'Шеф' : 'Заступник'
                  return (
                    <div key={d.id} className="rounded-lg border border-border/50 bg-white/50 px-3 py-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            setCheckedAdmins(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(d.id)
                              else next.delete(d.id)
                              return next
                            })
                          }}
                          className="accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{d.full_name || d.email}</span>
                          <span className="ml-1.5 text-[10px] text-muted-foreground">({roleLabel})</span>
                          {d.full_name && d.email ? (
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">{d.email}</span>
                          ) : null}
                        </span>
                      </label>
                      {checked && (
                        <div className="mt-1.5 ml-6 flex flex-col gap-1.5">
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={notifyEmail[d.id] !== false}
                              onChange={e => setNotifyEmail(prev => ({ ...prev, [d.id]: e.target.checked }))}
                              className="accent-primary"
                            />
                            Отримувати email з цієї команди
                          </label>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={notifyPush[d.id] !== false}
                              onChange={e => setNotifyPush(prev => ({ ...prev, [d.id]: e.target.checked }))}
                              className="accent-primary"
                            />
                            Отримувати push з цієї команди
                          </label>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={!!hideFromPlan[d.id]}
                              onChange={e => setHideFromPlan(prev => ({ ...prev, [d.id]: e.target.checked }))}
                              className="accent-primary"
                            />
                            Не показувати в плані
                          </label>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={canEditTasks[d.id] !== false}
                              onChange={e => setCanEditTasks(prev => ({ ...prev, [d.id]: e.target.checked }))}
                              className="accent-primary"
                            />
                            Може редагувати завдання
                          </label>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={canAddPhotos[d.id] !== false}
                              onChange={e => setCanAddPhotos(prev => ({ ...prev, [d.id]: e.target.checked }))}
                              className="accent-primary"
                            />
                            Може додавати фото
                          </label>
                          {d.role === 'sub_admin' && (
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={!!canAccessPeople[d.id]}
                                onChange={e => setCanAccessPeople(prev => ({ ...prev, [d.id]: e.target.checked }))}
                                className="accent-primary"
                              />
                              Доступ до сторінки «Люди»
                            </label>
                          )}
                          {!hideFromPlan[d.id] && (
                            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                              <span>Відділ у плані</span>
                              <select
                                value={leaderDept[d.id] || ''}
                                onChange={e => setLeaderDept(prev => ({ ...prev, [d.id]: e.target.value }))}
                                className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs text-foreground"
                              >
                                <option value="">— оберіть —</option>
                                {activeDepts.map(dep => (
                                  <option key={dep.id} value={dep.id}>{dep.name}</option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <button
                disabled={isPending || !deputiesDirty || !activeTeamId}
                className="tap-btn mt-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                onClick={() => {
                  if (!activeTeamId) return
                  const payload = [...checkedAdmins].map(user_id => ({
                    user_id,
                    hide_from_plan: !!hideFromPlan[user_id],
                    can_edit_tasks: canEditTasks[user_id] !== false,
                    can_add_photos: canAddPhotos[user_id] !== false,
                    can_access_people: !!canAccessPeople[user_id],
                    notify_email: notifyEmail[user_id] !== false,
                    notify_push: notifyPush[user_id] !== false,
                    department_id: hideFromPlan[user_id] ? null : (leaderDept[user_id] || null),
                  }))
                  run(() => setTeamAdmins(activeTeamId, payload))
                }}
              >
                Зберегти керівництво
              </button>
            </section>
          )}

          <button type="button" onClick={onDone} className="tap-btn rounded-lg border border-border px-4 py-2 text-sm font-medium">
            Готово
          </button>
        </>
      )}

      <ConfirmDialog
        open={deleteOpen && !!team}
        title="Видалити команду?"
        description={team ? `Дійсно видалити «${team.name}»? Усі плани буде втрачено.` : ''}
        confirmLabel="Видалити"
        busy={isPending}
        onConfirm={() => {
          if (!team) return
          run(async () => {
            const r = await deleteTeam(team.id)
            if (!r.error) {
              setDeleteOpen(false)
              onDone()
            }
            return r
          })
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  )
}
