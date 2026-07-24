'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Department, Profile, Team, UserRole } from '@/lib/types'
import {
  approveUser,
  createPerson,
  deletePerson,
  movePerson,
  resendInvite,
  setDeputyTeams,
  setUserRole,
  updatePersonName,
} from '@/app/actions/people'
import ConfirmDialog from '@/components/confirm-dialog'
import Modal from '@/components/modal'
import PencilEdit from '@/components/pencil-edit'
import { formatUkDateTime } from '@/lib/format-date'

interface Membership {
  user_id: string
  team_id: string
  department_id: string | null
}

interface Props {
  people: Profile[]
  teams: Team[]
  departments: Department[]
  memberships: Membership[]
  adminships: { user_id: string; team_id: string }[]
  loggedInIds: string[]
  isSuperAdmin: boolean
  currentUserId: string
}

const ROLE_LABEL: Record<string, string> = {
  pending: 'Очікує',
  employee: 'Працівник',
  sub_admin: 'Заступник',
  super_admin: 'Шеф',
}

export default function PeopleManager({
  people,
  teams,
  departments,
  memberships,
  adminships,
  loggedInIds,
  isSuperAdmin,
  currentUserId,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter] = useState<'all' | 'pending' | 'active'>('all')
  const [msg, setMsg] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Profile | null>(null)

  const loggedIn = useMemo(() => new Set(loggedInIds), [loggedInIds])

  const filtered = useMemo(() => {
    return people.filter(p => {
      if (filter === 'pending') return p.role === 'pending'
      if (filter === 'active') return p.role !== 'pending'
      return true
    })
  }, [people, filter])

  const membershipByUser = useMemo(() => {
    const map = new Map<string, Membership>()
    for (const m of memberships) map.set(m.user_id, m)
    return map
  }, [memberships])

  const adminTeamsByUser = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const a of adminships) {
      const name = teams.find(t => t.id === a.team_id)?.name
      if (!name) continue
      const list = map.get(a.user_id) ?? []
      list.push(name)
      map.set(a.user_id, list)
    }
    return map
  }, [adminships, teams])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const deptById = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments])

  function membershipLabel(userId: string) {
    const m = membershipByUser.get(userId)
    const adminTeams = adminTeamsByUser.get(userId) ?? []
    const team = m ? teamById.get(m.team_id) : null
    const dept = m?.department_id ? deptById.get(m.department_id) : null
    const place = [team?.name, dept?.name].filter(Boolean).join(' / ')
    if (adminTeams.length) {
      return place
        ? `Заступник: ${adminTeams.join(', ')} · у плані: ${place}`
        : `Заступник: ${adminTeams.join(', ')}`
    }
    return place || '—'
  }

  function run(fn: () => Promise<{ error?: string; warning?: string; inviteBlocked?: boolean }>) {
    setMsg(null)
    startTransition(async () => {
      const res = await fn()
      if (res.error) {
        setMsg('Помилка: ' + res.error)
        if (res.inviteBlocked) router.refresh()
      } else if (res.warning) {
        setMsg(res.warning)
        router.refresh()
      } else {
        setMsg('Готово')
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Люди</h1>
          <p className="text-sm text-muted-foreground">Додавання, схвалення, переведення</p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          disabled={teams.length === 0}
          className="tap-btn rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-40"
        >
          + Додати співробітника
        </button>
      </div>

      {teams.length === 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Спочатку створіть команду на сторінці «Команди».
        </p>
      )}

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.startsWith('Помилка') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
          {msg}
        </p>
      )}

      <div className="flex gap-2">
        {(['all', 'pending', 'active'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`tap-btn rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === f ? 'bg-primary text-primary-foreground' : 'border border-border bg-white/70'
            }`}
          >
            {f === 'all' ? 'Усі' : f === 'pending' ? 'Очікують' : 'Активні'}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {filtered.map(person => (
          <PersonCard
            key={person.id}
            person={person}
            teams={teams}
            departments={departments}
            membershipLabel={membershipLabel(person.id)}
            currentMembership={memberships.find(x => x.user_id === person.id) ?? null}
            deputyTeamIds={adminships.filter(a => a.user_id === person.id).map(a => a.team_id)}
            hasLoggedIn={loggedIn.has(person.id)}
            isSuperAdmin={isSuperAdmin}
            isSelf={person.id === currentUserId}
            disabled={isPending}
            onApprove={(role, teamId, departmentId, teamIds) =>
              run(() => approveUser({ userId: person.id, role, teamId, departmentId, teamIds }))
            }
            onDelete={() => setToDelete(person)}
            onResend={() => run(() => resendInvite(person.email))}
            onMove={(teamId, departmentId) =>
              run(() => movePerson({ userId: person.id, teamId, departmentId }))
            }
            onSaveDeputyTeams={teamIds =>
              run(() => setDeputyTeams(person.id, teamIds))
            }
            onSetRole={role => run(() => setUserRole(person.id, role))}
            onSaveName={name => run(() => updatePersonName(person.id, name))}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">Немає користувачів</p>
        )}
      </div>

      <AddPersonModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teams={teams}
        departments={departments}
        isSuperAdmin={isSuperAdmin}
        disabled={isPending}
        onSubmit={opts => {
          run(async () => {
            const r = await createPerson(opts)
            if (!r.error) setAddOpen(false)
            return r
          })
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Видалити людину?"
        description={
          toDelete
            ? `Дійсно видалити ${toDelete.full_name || toDelete.email}? Обліковий запис буде видалено.`
            : ''
        }
        confirmLabel="Видалити"
        busy={isPending}
        onConfirm={() => {
          if (!toDelete) return
          run(async () => {
            const r = await deletePerson(toDelete.id)
            setToDelete(null)
            return r
          })
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}

function AddPersonModal({
  open,
  onClose,
  teams,
  departments,
  isSuperAdmin,
  disabled,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  teams: Team[]
  departments: Department[]
  isSuperAdmin: boolean
  disabled: boolean
  onSubmit: (opts: {
    email: string
    fullName: string
    role: UserRole
    teamId: string
    departmentId: string
    sendInvite?: boolean
    teamIds?: string[]
  }) => void
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('employee')
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '')
  const [deptId, setDeptId] = useState('')
  const [extraTeams, setExtraTeams] = useState<string[]>([])
  const [sendInvite, setSendInvite] = useState(false)

  const deptsForTeam = useMemo(
    () => departments.filter(d => d.team_id === teamId),
    [departments, teamId]
  )

  useEffect(() => {
    if (open) {
      setFullName('')
      setEmail('')
      setRole('employee')
      setTeamId(teams[0]?.id ?? '')
      setDeptId('')
      setExtraTeams([])
      setSendInvite(false)
    }
  }, [open, teams])

  useEffect(() => {
    if (deptsForTeam.length && !deptsForTeam.some(d => d.id === deptId)) {
      setDeptId(deptsForTeam[0].id)
    }
  }, [deptsForTeam, deptId])

  const needsDept = role === 'employee' || role === 'sub_admin'
  const canAdd = !disabled && !!email.trim() && !!fullName.trim() && !!teamId && (!needsDept || !!deptId)

  return (
    <Modal open={open} onClose={onClose} title="Додати співробітника" description="Одразу зʼявиться в команді — можна вносити в план">
      <div className="grid gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">ПІБ</label>
          <input value={fullName} onChange={e => setFullName(e.target.value)} className="rounded-lg border border-input bg-white px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="rounded-lg border border-input bg-white px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Роль</label>
          <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="rounded-lg border border-input bg-white px-3 py-2 text-sm">
            <option value="employee">Працівник</option>
            <option value="sub_admin">Заступник</option>
            {isSuperAdmin && <option value="super_admin">Шеф</option>}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {role === 'sub_admin' ? 'Основна команда' : 'Команда'}
          </label>
          <select value={teamId} onChange={e => { setTeamId(e.target.value); setDeptId('') }} className="rounded-lg border border-input bg-white px-3 py-2 text-sm">
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {role === 'sub_admin' && teams.length > 1 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Додаткові команди (можна кілька)</label>
            <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-white/50 p-2">
              {teams.filter(t => t.id !== teamId).map(t => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={extraTeams.includes(t.id)}
                    onChange={e => {
                      setExtraTeams(prev => e.target.checked ? [...prev, t.id] : prev.filter(id => id !== t.id))
                    }}
                    className="accent-primary"
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {(role === 'employee' || role === 'sub_admin') && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              {role === 'sub_admin' ? 'Відділ у плані (основна команда)' : 'Відділ'}
            </label>
            <select value={deptId} onChange={e => setDeptId(e.target.value)} className="rounded-lg border border-input bg-white px-3 py-2 text-sm" disabled={deptsForTeam.length === 0}>
              {deptsForTeam.length === 0 ? (
                <option value="">Немає відділів — додайте в налаштуваннях команди</option>
              ) : (
                deptsForTeam.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
              )}
            </select>
            {role === 'sub_admin' && (
              <p className="text-[11px] text-muted-foreground">
                Щоб заступник зʼявлявся в денному плані — оберіть відділ основної команди.
              </p>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} className="accent-primary" />
          Також надіслати запрошення на email
        </label>
        <button
          disabled={!canAdd}
          onClick={() => onSubmit({
            email,
            fullName,
            role,
            teamId,
            departmentId: deptId,
            sendInvite,
            teamIds: role === 'sub_admin' ? extraTeams : undefined,
          })}
          className="tap-btn rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          Додати в команду
        </button>
      </div>
    </Modal>
  )
}

function PersonCard({
  person,
  teams,
  departments,
  membershipLabel,
  currentMembership,
  deputyTeamIds,
  hasLoggedIn,
  isSuperAdmin,
  isSelf,
  disabled,
  onApprove,
  onDelete,
  onResend,
  onMove,
  onSaveDeputyTeams,
  onSetRole,
  onSaveName,
}: {
  person: Profile
  teams: Team[]
  departments: Department[]
  membershipLabel: string
  currentMembership: Membership | null
  deputyTeamIds: string[]
  hasLoggedIn: boolean
  isSuperAdmin: boolean
  isSelf: boolean
  disabled: boolean
  onApprove: (role: UserRole, teamId: string, departmentId: string, teamIds?: string[]) => void
  onDelete: () => void
  onResend: () => void
  onMove: (teamId: string, departmentId: string) => void
  onSaveDeputyTeams: (teamIds: string[]) => void
  onSetRole: (role: UserRole) => void
  onSaveName: (name: string) => void
}) {
  const [role, setRole] = useState<UserRole>('employee')
  const [teamId, setTeamId] = useState(currentMembership?.team_id || teams[0]?.id || '')
  const depts = departments.filter(d => d.team_id === teamId)
  const [deptId, setDeptId] = useState(currentMembership?.department_id || depts[0]?.id || '')
  const [deputyTeams, setDeputyTeamsState] = useState<string[]>(
    deputyTeamIds.length ? deputyTeamIds : (teams[0]?.id ? [teams[0].id] : [])
  )
  const [extraTeams, setExtraTeams] = useState<string[]>([])
  const [editing, setEditing] = useState(person.role === 'pending')
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deputyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
      if (deputyTimerRef.current) clearTimeout(deputyTimerRef.current)
    }
  }, [])

  const showInvite = !person.invite_blocked && !hasLoggedIn
  const canEditCard = person.role !== 'pending'

  function autoMove(nextTeam: string, nextDept: string) {
    if (!nextTeam || !nextDept || disabled) return
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
    moveTimerRef.current = setTimeout(() => {
      onMove(nextTeam, nextDept)
    }, 400)
  }

  function autoDeputyTeams(next: string[]) {
    setDeputyTeamsState(next)
    if (disabled || next.length === 0) return
    if (deputyTimerRef.current) clearTimeout(deputyTimerRef.current)
    deputyTimerRef.current = setTimeout(() => {
      onSaveDeputyTeams(next)
    }, 400)
  }

  return (
    <div className={`glass-card relative p-4 ${showInvite ? 'pb-12' : ''} ${!hasLoggedIn && person.role !== 'pending' ? 'ring-1 ring-amber-200/80' : ''}`}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <PencilEdit
            value={person.full_name || ''}
            disabled={disabled}
            onSave={onSaveName}
            textClassName="text-base font-semibold text-foreground"
          />
          <p className="mt-0.5 text-xs text-muted-foreground">{person.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ROLE_LABEL[person.role]} · {membershipLabel}
            {!hasLoggedIn && person.role !== 'pending' && (
              <span className="ml-1 text-amber-700">· ще не входив</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canEditCard && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditing(v => !v)}
              className={`tap-btn rounded-lg p-1.5 disabled:opacity-40 ${
                editing ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              title={editing ? 'Згорнути' : 'Редагувати'}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          {isSuperAdmin && !isSelf && (
            <button
              disabled={disabled}
              onClick={onDelete}
              className="tap-btn rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40"
              title="Видалити"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {person.role === 'pending' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Роль</label>
            <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs">
              <option value="employee">Працівник</option>
              <option value="sub_admin">Заступник</option>
              {isSuperAdmin && <option value="super_admin">Шеф</option>}
            </select>
          </div>
          {role === 'employee' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Команда</label>
                <select value={teamId} onChange={e => { setTeamId(e.target.value); setDeptId('') }} className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs">
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Відділ</label>
                <select value={deptId || depts[0]?.id || ''} onChange={e => setDeptId(e.target.value)} className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs">
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </>
          )}
          {role === 'sub_admin' && (
            <>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Команди (можна кілька)</label>
                <div className="flex flex-wrap gap-2 rounded-lg border border-border/50 bg-white/60 p-2">
                  {teams.map(t => (
                    <label key={t.id} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={extraTeams.includes(t.id) || (!extraTeams.length && t.id === teamId)}
                        onChange={e => {
                          setExtraTeams(prev => {
                            const base = prev.length ? prev : (teamId ? [teamId] : [])
                            return e.target.checked
                              ? [...new Set([...base, t.id])]
                              : base.filter(id => id !== t.id)
                          })
                          if (e.target.checked && !teamId) setTeamId(t.id)
                        }}
                        className="accent-primary"
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Команда для плану</label>
                <select
                  value={teamId}
                  onChange={e => { setTeamId(e.target.value); setDeptId('') }}
                  className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
                >
                  {(extraTeams.length ? teams.filter(t => extraTeams.includes(t.id) || t.id === teamId) : teams).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Відділ у плані</label>
                <select
                  value={deptId || depts[0]?.id || ''}
                  onChange={e => setDeptId(e.target.value)}
                  className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
                >
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </>
          )}
          <button
            disabled={
              disabled ||
              (role === 'employee'
                ? !teamId || !(deptId || depts[0]?.id)
                : role === 'sub_admin'
                  ? !(extraTeams.length || teamId) || !(deptId || depts[0]?.id)
                  : false)
            }
            onClick={() => {
              const teamsForDeputy = extraTeams.length ? extraTeams : (teamId ? [teamId] : [])
              onApprove(
                role,
                role === 'sub_admin' ? teamId || teamsForDeputy[0] : teamId,
                deptId || depts[0]?.id || '',
                role === 'sub_admin' ? teamsForDeputy.filter(id => id !== (teamId || teamsForDeputy[0])) : undefined
              )
            }}
            className="tap-btn rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            Схвалити
          </button>
        </div>
      )}

      {editing && person.role === 'employee' && (
        <div className="mt-3 rounded-xl border border-border/40 bg-white/30 p-3">
          <p className="mb-1 text-xs font-medium text-foreground">Приналежність до команди</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Зміни зберігаються одразу.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Команда</label>
              <select
                value={teamId}
                onChange={e => {
                  const tid = e.target.value
                  setTeamId(tid)
                  const nextDepts = departments.filter(d => d.team_id === tid)
                  const did = nextDepts[0]?.id || ''
                  setDeptId(did)
                  if (did) autoMove(tid, did)
                }}
                className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
              >
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Відділ</label>
              <select
                value={deptId || depts[0]?.id || ''}
                onChange={e => {
                  const did = e.target.value
                  setDeptId(did)
                  autoMove(teamId, did)
                }}
                className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
              >
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          {isSuperAdmin && (
            <div className="mt-2 flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Роль</label>
              <select defaultValue={person.role} onChange={e => onSetRole(e.target.value as UserRole)} className="max-w-xs rounded-lg border border-input bg-white px-2 py-1.5 text-xs">
                <option value="employee">Працівник</option>
                <option value="sub_admin">Заступник</option>
                <option value="super_admin">Шеф</option>
              </select>
            </div>
          )}
        </div>
      )}

      {editing && person.role === 'sub_admin' && (
        <div className="mt-3 rounded-xl border border-border/40 bg-white/30 p-3">
          <p className="mb-1 text-xs font-medium text-foreground">Команди заступника</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Зміни зберігаються одразу.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {teams.map(t => (
              <label key={t.id} className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-white px-2.5 py-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={deputyTeams.includes(t.id)}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...deputyTeams, t.id]
                      : deputyTeams.filter(id => id !== t.id)
                    autoDeputyTeams(next)
                  }}
                  className="accent-primary"
                />
                {t.name}
              </label>
            ))}
          </div>

          <div className="border-t border-border/40 pt-3">
            <p className="mb-1 text-xs font-medium text-foreground">Відділ у плані</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Команда</label>
                <select
                  value={teamId}
                  onChange={e => {
                    const tid = e.target.value
                    setTeamId(tid)
                    const nextDepts = departments.filter(d => d.team_id === tid)
                    const did = nextDepts[0]?.id || ''
                    setDeptId(did)
                    if (did) autoMove(tid, did)
                  }}
                  className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
                >
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Відділ</label>
                <select
                  value={deptId || depts[0]?.id || ''}
                  onChange={e => {
                    const did = e.target.value
                    setDeptId(did)
                    autoMove(teamId, did)
                  }}
                  className="rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
                >
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {isSuperAdmin && (
            <div className="mt-3 flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Роль</label>
              <select defaultValue={person.role} onChange={e => onSetRole(e.target.value as UserRole)} className="max-w-xs rounded-lg border border-input bg-white px-2 py-1.5 text-xs">
                <option value="employee">Працівник</option>
                <option value="sub_admin">Заступник</option>
                <option value="super_admin">Шеф</option>
              </select>
            </div>
          )}
        </div>
      )}

      {editing && person.role === 'super_admin' && isSuperAdmin && (
        <div className="mt-3 rounded-xl border border-border/40 bg-white/30 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Роль</label>
            <select
              defaultValue={person.role}
              onChange={e => onSetRole(e.target.value as UserRole)}
              className="max-w-xs rounded-lg border border-input bg-white px-2 py-1.5 text-xs"
            >
              <option value="employee">Працівник</option>
              <option value="sub_admin">Заступник</option>
              <option value="super_admin">Шеф</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Змінити роль шефа можна будь-коли. Себе зняти з шефа не можна — зробіть це з іншого акаунта шефа.
            </p>
          </div>
        </div>
      )}

      {showInvite && (
        <button
          type="button"
          disabled={disabled}
          onClick={onResend}
          title={
            person.invite_sent_at
              ? `Надіслано ${formatUkDateTime(person.invite_sent_at)}. Надіслати знову.`
              : 'Надіслати лист із запрошенням'
          }
          className={`tap-btn absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40 ${
            person.invite_sent_at
              ? 'border border-green-300 bg-green-50 text-green-800'
              : 'bg-primary text-primary-foreground'
          }`}
        >
          <InviteEnvelopeIcon className="h-4 w-4" />
          {person.invite_sent_at ? 'Запрошення ✓' : 'Запрошення'}
        </button>
      )}
    </div>
  )
}

function InviteEnvelopeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5l6.8 4.25a2 2 0 002.1 0L19.7 8.5" />
      <rect x="3" y="6" width="14.5" height="12" rx="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.5h4.5v4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 4.5l-6 6" />
    </svg>
  )
}
