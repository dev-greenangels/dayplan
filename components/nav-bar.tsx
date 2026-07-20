'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'

interface NavBarProps {
  profile: Profile
}

export default function NavBar({ profile }: NavBarProps) {
  const router = useRouter()
  const pathname = usePathname()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const isAdmin = profile.role === 'super_admin' || profile.role === 'sub_admin'

  const links = [
    { href: '/dashboard', label: 'Плани' },
    ...(isAdmin ? [{ href: '/admin/employees', label: 'Працівники' }] : []),
    ...(isAdmin ? [{ href: '/admin/create-plan', label: 'Новий план' }] : []),
  ]

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <svg className="h-4 w-4 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <span className="font-semibold text-foreground text-sm hidden sm:block">GA-DayPlan</span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname.startsWith(link.href)
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* User / sign out */}
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:block truncate max-w-[140px]">
            {profile.full_name || profile.email}
          </span>
          <span className={`hidden sm:inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            profile.role === 'super_admin'
              ? 'bg-primary/20 text-primary'
              : profile.role === 'sub_admin'
              ? 'bg-secondary text-secondary-foreground'
              : 'bg-muted text-muted-foreground'
          }`}>
            {profile.role === 'super_admin' ? 'Адмін' : profile.role === 'sub_admin' ? 'Менеджер' : 'Працівник'}
          </span>
          <button
            onClick={signOut}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
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
