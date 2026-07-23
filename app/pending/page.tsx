'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import BrandLogo from '@/components/brand-logo'

export default function PendingPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.replace('/login')
        return
      }
      setEmail(data.user.email ?? '')

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle()

      if (profile && profile.role !== 'pending') {
        router.replace(
          profile.role === 'super_admin' || profile.role === 'sub_admin'
            ? '/admin'
            : '/dashboard'
        )
      }
    }
    void load()
  }, [router])

  async function refreshStatus() {
    setChecking(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.replace('/login')
      return
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile && profile.role !== 'pending') {
      router.replace(profile.role === 'super_admin' || profile.role === 'sub_admin' ? '/admin' : '/dashboard')
      return
    }
    setChecking(false)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="page-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div
        className="relative w-full max-w-md"
        style={{ animation: 'fadeInUp 0.45s cubic-bezier(.16,1,.3,1) both' }}
      >
        <style>{`
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(24px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes hourglassFlip {
            0%, 40% { transform: rotate(0deg); }
            50%, 90% { transform: rotate(180deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes softPulse {
            0%, 100% { transform: scale(1); opacity: 0.55; }
            50% { transform: scale(1.18); opacity: 0.15; }
          }
        `}</style>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <BrandLogo size={64} rounded="rounded-2xl" className="shadow-lg shadow-primary/30" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">PlanDay-GA</h1>
        </div>

        <div
          className="rounded-2xl p-8 text-center shadow-xl"
          style={{
            background: 'rgba(255,255,255,0.65)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.7)',
          }}
        >
          <div className="relative mx-auto mb-6 flex h-24 w-24 items-center justify-center">
            <div
              className="absolute inset-0 rounded-full bg-primary/20"
              style={{ animation: 'softPulse 2.2s ease-in-out infinite' }}
            />
            <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg
                className="h-9 w-9 text-primary"
                style={{ animation: 'hourglassFlip 3.2s ease-in-out infinite' }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 2h12M6 22h12M8 2v3.5a4 4 0 001.172 2.828L12 11.5l2.828-3.172A4 4 0 0016 5.5V2M8 22v-3.5a4 4 0 011.172-2.828L12 12.5l2.828 3.172A4 4 0 0016 18.5V22"
                />
              </svg>
            </div>
          </div>

          <h2 className="mb-3 text-xl font-bold text-foreground">Очікування підтвердження</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ваш акаунт очікує підтвердження адміністратором. Будь ласка, зверніться до керівника.
            {email ? (
              <>
                <br /><br />
                <span className="font-medium text-foreground">{email}</span>
              </>
            ) : null}
          </p>

          <div className="mt-8 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Після підтвердження оновіть статус — вас перенаправить у кабінет.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={refreshStatus}
              disabled={checking}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-60"
            >
              {checking ? 'Перевіряємо...' : 'Оновити статус'}
            </button>
            <button
              onClick={signOut}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-white/50"
            >
              Вийти
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Green Angels &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
