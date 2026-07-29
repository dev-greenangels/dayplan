'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { Department, Team, TeamColumn } from '@/lib/types'
import { deleteTeam } from '@/app/actions/org'
import ConfirmDialog from '@/components/confirm-dialog'
import Modal from '@/components/modal'
import TeamSettingsPanel from '@/components/team-settings-panel'
import { useOrgRealtimeRefresh } from '@/hooks/use-org-realtime-refresh'

interface TeamWithCount extends Team {
  memberCount: number
}

interface Deputy {
  id: string
  full_name: string
  email: string
  role: string
}

interface Props {
  teams: TeamWithCount[]
  today: string
  departments: Department[]
  columns: TeamColumn[]
  teamAdmins: {
    team_id: string
    user_id: string
    hide_from_plan?: boolean
    can_edit_tasks?: boolean
    can_add_photos?: boolean
    can_access_people?: boolean
    notify_email?: boolean
    notify_push?: boolean
  }[]
  memberDepartments: { team_id: string; user_id: string; department_id: string | null }[]
  deputies: Deputy[]
  isSuperAdmin: boolean
}

export default function AdminTeamList({
  teams,
  today,
  departments,
  columns,
  teamAdmins,
  memberDepartments,
  deputies,
  isSuperAdmin,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<TeamWithCount | null>(null)
  const [settingsTeam, setSettingsTeam] = useState<Team | null | 'new'>(null)

  // One org channel (shared topic) — soft refresh on team/member/profile changes
  useOrgRealtimeRefresh(true)

  function closeSettings() {
    setSettingsTeam(null)
  }

  function confirmDelete() {
    if (!toDelete) return
    const team = toDelete
    setError(null)
    startTransition(async () => {
      const res = await deleteTeam(team.id)
      setToDelete(null)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="relative pb-20 sm:pb-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Команди</h1>
          <p className="text-sm text-muted-foreground">Оберіть команду, щоб відкрити план на день</p>
        </div>
        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setSettingsTeam('new')}
            className="tap-btn hidden rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm sm:inline-flex"
          >
            + Створити команду
          </button>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {teams.length === 0 ? (
        <div className="glass-card py-12 text-center text-sm text-muted-foreground">
          Немає доступних команд.
          {isSuperAdmin && (
            <>
              {' '}
              <button type="button" onClick={() => setSettingsTeam('new')} className="tap-btn text-primary underline">
                Створити першу
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map(team => (
            <div
              key={team.id}
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/teams/${team.id}/plans/${today}`)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  router.push(`/teams/${team.id}/plans/${today}`)
                }
              }}
              className="tap-card glass-card group relative cursor-pointer overflow-hidden p-5 text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-3 pr-10">
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-foreground group-hover:text-primary">{team.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {team.work_mode === 'shared' ? 'Спільний ПК' : 'Індивідуальний режим'}
                    {' · '}
                    {team.memberCount} {pluralWorkers(team.memberCount)}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <span className="text-sm font-medium text-primary">Відкрити план →</span>
              </div>

              <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1">
                {isSuperAdmin && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setToDelete(team)
                    }}
                    onPointerDown={e => e.stopPropagation()}
                    title="Видалити команду"
                    className="pointer-events-auto tap-btn relative z-10 flex h-11 w-11 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setSettingsTeam(team)
                }}
                onPointerDown={e => e.stopPropagation()}
                title="Налаштування команди"
                className="tap-btn absolute bottom-2 right-2 z-10 flex h-12 w-12 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/70">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {isSuperAdmin && (
        <button
          type="button"
          onClick={() => setSettingsTeam('new')}
          className="tap-btn fixed bottom-5 right-4 z-30 flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 sm:hidden"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <span className="text-lg leading-none">+</span>
          Створити команду
        </button>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Видалити команду?"
        description={
          toDelete
            ? `Дійсно видалити команду «${toDelete.name}»? Усі плани та рядки завдань цієї команди буде втрачено.`
            : ''
        }
        confirmLabel="Видалити команду"
        busy={isPending}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />

      <Modal
        open={settingsTeam !== null}
        title={
          settingsTeam === 'new'
            ? 'Нова команда'
            : settingsTeam
              ? `Налаштування — ${settingsTeam.name}`
              : ''
        }
        description={
          settingsTeam === 'new'
            ? 'Створіть команду, потім налаштуйте відділи та колонки'
            : 'Відділи, колонки плану, режим і керівництво'
        }
        wide
        onClose={closeSettings}
      >
        {settingsTeam !== null && (
          <TeamSettingsPanel
            key={settingsTeam === 'new' ? 'new' : settingsTeam.id}
            team={settingsTeam === 'new' ? null : settingsTeam}
            departments={departments}
            columns={columns}
            teamAdmins={teamAdmins}
            memberDepartments={memberDepartments}
            deputies={deputies}
            isSuperAdmin={isSuperAdmin}
            onDone={closeSettings}
          />
        )}
      </Modal>
    </div>
  )
}

function pluralWorkers(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'працівник'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'працівники'
  return 'працівників'
}
