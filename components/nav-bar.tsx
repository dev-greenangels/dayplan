'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'
import { isDeputyOrBoss, ROLE_LABEL } from '@/lib/roles'

interface NavBarProps {
  profile: Profile
}

function isActive(pathname: string, href: string) {
  if (href === '/admin') {
    return pathname === '/admin' || pathname.startsWith('/teams/')
  }
  return pathname === href || pathname.startsWith(href + '/')
}

export default function NavBar({ profile }: NavBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const headerRef = useRef<HTMLElement>(null)

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
      <div className="boty-glass mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2 rounded-lg px-4 sm:px-5">
        <Link href={isAdmin ? '/admin' : '/dashboard'} className="tap-btn flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/web-app-manifest-192x192.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg object-cover shadow-sm"
          />
          <span className="text-sm font-semibold tracking-tight text-foreground">GA-DayPlan</span>
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
          <button
            onClick={signOut}
            className="tap-btn rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-foreground"
            title="Вийти"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
