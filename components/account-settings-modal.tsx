'use client'

import { useEffect, useState, useTransition } from 'react'
import Modal from '@/components/modal'
import { updateMyAccountSettings } from '@/app/actions/account'
import { usePush } from '@/components/push-provider'
import UserAvatar from '@/components/user-avatar'
import { useToast } from '@/components/toast-provider'
import type { Profile } from '@/lib/types'
import { ROLE_LABEL } from '@/lib/roles'

export type AccountMembership = {
  teamName: string | null
  departmentName: string | null
  teamId?: string | null
  workMode?: string | null
} | null

export default function AccountSettingsModal({
  open,
  onClose,
  profile,
  membership,
  onUpdated,
}: {
  open: boolean
  onClose: () => void
  profile: Profile
  membership?: AccountMembership
  onUpdated?: (patch: Partial<Profile>) => void
}) {
  const [name, setName] = useState(profile.full_name || '')
  const [notifyEmail, setNotifyEmail] = useState(profile.notify_email !== false)
  const [notifyPush, setNotifyPush] = useState(profile.notify_push !== false)
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()
  const { status: pushStatus, error: pushError, enable: enablePush } = usePush()

  const showMembership =
    profile.role === 'employee' ||
    profile.role === 'sub_admin' ||
    !!(membership?.teamName || membership?.departmentName)

  useEffect(() => {
    if (!open) return
    setName(profile.full_name || '')
    setNotifyEmail(profile.notify_email !== false)
    setNotifyPush(profile.notify_push !== false)
    setMsg(null)
  }, [open, profile])

  function save(partial?: { notify_email?: boolean; notify_push?: boolean; full_name?: string }) {
    setMsg(null)
    const nextName = partial?.full_name ?? name
    const nextEmail = partial?.notify_email ?? notifyEmail
    const nextPush = partial?.notify_push ?? notifyPush
    startTransition(async () => {
      const res = await updateMyAccountSettings({
        full_name: nextName,
        notify_email: nextEmail,
        notify_push: nextPush,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      onUpdated?.({
        full_name: nextName.trim(),
        notify_email: nextEmail,
        notify_push: nextPush,
      })
      setMsg('Збережено')
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Мій акаунт"
      description="Налаштування профілю та сповіщень"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <UserAvatar url={profile.avatar_url} name={profile.full_name || profile.email} size={48} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {profile.full_name?.trim() || 'Без імені'}
            </p>
            <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">ПІБ</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== (profile.full_name || '').trim()) {
                save({ full_name: name })
              }
            }}
            className="rounded-lg border border-input bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Email</span>
          <span className="text-sm text-foreground">{profile.email || '—'}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Роль</span>
          <span className="text-sm text-foreground">{ROLE_LABEL[profile.role] ?? profile.role}</span>
        </div>

        {showMembership && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Команда</span>
              <span className="text-sm text-foreground">{membership?.teamName || '—'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Відділ</span>
              <span className="text-sm text-foreground">{membership?.departmentName || '—'}</span>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
          <p className="mb-2 text-xs font-semibold text-foreground">Сповіщення</p>
          <p className="mb-3 text-[11px] text-muted-foreground">
            Окремо для email і push. Push також потребує дозволу браузера на цьому пристрої.
          </p>
          <div className="flex flex-col gap-2.5">
            <label className="flex items-center gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                className="accent-primary h-4 w-4"
                checked={notifyEmail}
                disabled={isPending}
                onChange={e => {
                  const next = e.target.checked
                  setNotifyEmail(next)
                  save({ notify_email: next })
                }}
              />
              Отримувати email
            </label>
            <label className="flex items-center gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                className="accent-primary h-4 w-4"
                checked={notifyPush}
                disabled={isPending}
                onChange={e => {
                  const next = e.target.checked
                  setNotifyPush(next)
                  save({ notify_push: next })
                }}
              />
              Отримувати push
            </label>
          </div>

          {notifyPush && pushStatus !== 'unsupported' && pushStatus !== 'loading' && (
            <div className="mt-3 border-t border-border/40 pt-3">
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                {pushStatus === 'subscribed'
                  ? 'Цей пристрій підписаний на push.'
                  : pushStatus === 'denied'
                    ? (pushError ?? 'Дозвіл на сповіщення заблоковано в браузері.')
                    : pushStatus === 'unavailable'
                      ? (pushError ?? 'Push не налаштовано на сервері.')
                      : 'Пристрій ще не підписаний — натисніть, щоб дозволити.'}
              </p>
              {pushStatus === 'need-permission' && (
                <button
                  type="button"
                  onClick={() => void enablePush()}
                  className="tap-btn rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  Увімкнути на цьому пристрої
                </button>
              )}
            </div>
          )}
        </div>

        {msg && (
          <p className={`text-xs ${msg.startsWith('Помилка') ? 'text-red-600' : 'text-green-700'}`}>
            {msg}
          </p>
        )}
      </div>
    </Modal>
  )
}
