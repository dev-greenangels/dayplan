'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'
import { isDeputyOrBoss, ROLE_LABEL } from '@/lib/roles'
import BrandLogo from '@/components/brand-logo'
import { usePush } from '@/components/push-provider'

interface NavBarProps {
  profile: Profile
}

function isActive(pathname: string, href: string) {
  if (href === '/admin') {
    return pathname === '/admin' || pathname.startsWith('/teams/')
  }
  return pathname === href || pathname.startsWith(href + '/')
}

function mobileRoleTitle(role: Profile['role']) {
  if (role === 'super_admin') return 'Шеф'
  if (role === 'sub_admin') return 'Адмін'
  return ROLE_LABEL[role] ?? 'Працівник'
}

export default function NavBar({ profile }: NavBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const headerRef = useRef<HTMLElement>(null)
  const { status: pushStatus, error: pushError, enable: enablePush } = usePush()

  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const sync = () => {
      document.documentElement.style.setProperty('--app-header-offset', `${el.offsetHeight}px`)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--app-header-offset')
    }
  }, [])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isAdmin = isDeputyOrBoss(profile.role)
  const mobileTitle = mobileRoleTitle(profile.role)

  const links = isAdmin
    ? [
        { href: '/admin', label: 'Команди' },
        { href: '/admin/people', label: 'Люди' },
      ]
    : [{ href: '/dashboard', label: 'Мій план' }]

  return (
    <header
      ref={headerRef}
      className="app-header sticky top-0 z-50 px-3 sm:px-4"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <div className="boty-glass mx-auto flex h-14 min-w-0 max-w-[1600px] items-center justify-between gap-2 overflow-hidden rounded-lg px-3 sm:px-5">
        <Link href={isAdmin ? '/admin' : '/dashboard'} className="tap-btn flex min-w-0 shrink items-center gap-2">
          <BrandLogo size={32} className="hidden sm:block" />
          <span className="hidden truncate text-sm font-semibold tracking-tight text-foreground sm:inline">
            PlanDay-GA
          </span>
          <span className="flex min-w-0 flex-col sm:hidden">
            <span className="truncate text-[15px] font-bold leading-tight text-foreground">
              {profile.full_name?.trim() || profile.email || 'Користувач'}
            </span>
            <span
              className={`truncate text-[11px] font-medium leading-tight ${
                profile.role === 'super_admin'
                  ? 'text-primary'
                  : profile.role === 'sub_admin'
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground'
              }`}
            >
              {mobileTitle}
            </span>
          </span>
        </Link>

        <nav className="flex min-w-0 flex-1 items-center justify-center gap-0.5 sm:gap-1">
          {links.map(link => {
            const active = isActive(pathname, link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`tap-btn rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:px-4 ${
                  active
                    ? 'bg-primary/12 text-primary'
                    : 'text-muted-foreground hover:bg-black/5 hover:text-foreground'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden max-w-[140px] truncate text-xs text-muted-foreground lg:block">
            {profile.full_name || profile.email}
          </span>
          <span className={`hidden rounded-full px-2.5 py-0.5 text-xs font-medium sm:inline-block ${
            profile.role === 'super_admin'
              ? 'bg-primary/15 text-primary'
              : profile.role === 'sub_admin'
              ? 'bg-secondary text-secondary-foreground'
              : 'bg-muted text-muted-foreground'
          }`}>
            {ROLE_LABEL[profile.role] ?? 'Працівник'}
          </span>
          {pushStatus !== 'unsupported' && pushStatus !== 'loading' && (
            <button
              type="button"
              onClick={() => {
                if (pushStatus === 'subscribed' || pushStatus === 'denied' || pushStatus === 'unavailable') return
                void enablePush()
              }}
              disabled={pushStatus === 'subscribed' || pushStatus === 'denied' || pushStatus === 'unavailable'}
              className={`tap-btn rounded-lg p-2.5 sm:p-2 ${
                pushStatus === 'subscribed'
                  ? 'text-primary'
                  : pushStatus === 'need-permission'
                    ? 'text-amber-700 hover:bg-amber-500/10'
                    : 'text-muted-foreground'
              }`}
              title={
                pushStatus === 'subscribed'
                  ? 'Push-сповіщення увімкнено'
                  : pushStatus === 'denied'
                    ? (pushError ?? 'Дозвіл на сповіщення заблоковано в браузері')
                    : pushStatus === 'unavailable'
                      ? (pushError ?? 'Push не налаштовано на сервері')
                      : 'Увімкнути push-сповіщення'
              }
              aria-label={
                pushStatus === 'subscribed'
                  ? 'Push увімкнено'
                  : 'Увімкнути push-сповіщення'
              }
            >
              {pushStatus === 'subscribed' ? (
                <svg className="h-6 w-6 sm:h-4 sm:w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                </svg>
              ) : (
                <svg className="h-6 w-6 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.66V5a2 2 0 10-4 0v.34A6 6 0 006 11v3.2c0 .53-.21 1.04-.59 1.41L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={signOut}
            className="tap-btn rounded-lg p-2.5 text-muted-foreground hover:bg-black/5 hover:text-foreground sm:p-2"
            title="Вийти"
          >
            <svg className="h-6 w-6 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
