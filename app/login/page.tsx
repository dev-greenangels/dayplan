'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/** Always use the current browser origin for OAuth — never bake localhost from env. */
function authRedirectTo(path: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${path}`
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('email') as HTMLInputElement | null
    const address = (input?.value ?? '').trim()
    const ok = Boolean(input?.checkValidity() && address)
    if (!ok) {
      form.reportValidity()
      setError('Введіть коректний email')
      return
    }
    setLoading(true)
    setError(null)
    setEmail(address)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  async function handleVerifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('code') as HTMLInputElement | null
    const token = (input?.value ?? '').replace(/\s/g, '').trim()
    const ok = Boolean(input?.checkValidity() && token.length >= 6)
    if (!ok) {
      form.reportValidity()
      setError('Введіть код з листа')
      return
    }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Drop stale cookies first — dead refresh token causes "Failed to fetch" on verifyOtp
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      /* ignore */
    }
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: 'email',
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Не вдалося перевірити код (мережа або застаріла сесія). Оновіть сторінку і спробуйте ще раз.')
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authRedirectTo('/auth/callback') },
    })
    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
  }

  return (
    <div
      className="page-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4"
      style={{
        background: 'linear-gradient(135deg, #d4edda 0%, #e8f5e9 40%, #c8e6c9 100%)',
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div
        className="relative w-full max-w-sm"
        style={{ animation: 'fadeInUp 0.45s cubic-bezier(.16,1,.3,1) both' }}
      >
        <style>{`
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(24px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          /* Native constraint UI — updates on iOS without React change events */
          .login-otp-form:has(input:invalid) .login-otp-submit:not(:disabled),
          .login-otp-form:invalid .login-otp-submit:not(:disabled) {
            opacity: 0.5;
            pointer-events: none;
            cursor: not-allowed;
          }
        `}</style>

        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/green-angels-logo.png"
              alt="Green Angels"
              width={280}
              height={108}
              className="h-auto w-full max-w-[280px] object-contain drop-shadow-md"
            />
          </div>
          <h1 className="text-2xl font-bold text-foreground">PlanDay-GA</h1>
          <p className="mt-1 text-sm text-muted-foreground">Планування робочого дня</p>
        </div>

        <div
          className="rounded-2xl p-7 shadow-xl"
          style={{
            background: 'rgba(255,255,255,0.65)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.7)',
          }}
        >
          {sent ? (
            <form
              onSubmit={handleVerifyCode}
              className="login-otp-form flex flex-col gap-3"
              style={{ animation: 'fadeInUp 0.3s ease both' }}
            >
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <svg className="h-7 w-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-center text-lg font-semibold text-foreground">Введіть код</h2>
              <p className="mb-1 text-center text-sm text-muted-foreground">
                Код надіслано на{' '}
                <span className="font-medium text-foreground">{email}</span>
              </p>
              <input
                name="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                placeholder="123456"
                required
                minLength={6}
                maxLength={6}
                onInput={e => {
                  // keep native :invalid in sync; clear error while typing
                  void e.currentTarget.checkValidity()
                  if (error) setError(null)
                }}
                className="rounded-xl border border-input bg-white/60 px-3.5 py-2.5 text-center text-lg tracking-[0.3em] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="login-otp-submit tap-btn rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Перевіряємо...' : 'Увійти'}
              </button>
              <button
                type="button"
                onClick={() => { setSent(false); setError(null) }}
                className="tap-btn mt-1 text-sm text-primary underline underline-offset-4"
              >
                Змінити email / надіслати ще раз
              </button>
            </form>
          ) : (
            <>
              <h2 className="mb-5 text-lg font-semibold text-foreground">Увійти</h2>

              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading}
                className="tap-btn flex w-full items-center justify-center gap-3 rounded-xl border border-border/70 bg-white/80 px-4 py-2.5 text-sm font-medium text-foreground shadow-sm disabled:opacity-60"
              >
                {googleLoading ? (
                  <svg className="h-4 w-4 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                Увійти через Google
              </button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-xs text-muted-foreground">або</span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              <form onSubmit={handleSendCode} className="login-otp-form flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-email" className="text-sm font-medium text-foreground">
                    Email
                  </label>
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="your@email.com"
                    required
                    onInput={e => {
                      void e.currentTarget.checkValidity()
                      if (error) setError(null)
                    }}
                    className="rounded-xl border border-input bg-white/60 px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                  />
                </div>
                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="login-otp-submit tap-btn rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Надсилаємо...' : 'Отримати код'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Green Angels &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
