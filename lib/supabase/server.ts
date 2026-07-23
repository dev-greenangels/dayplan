import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 10

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        maxAge: SESSION_MAX_AGE,
        sameSite: 'lax',
        path: '/',
      },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                maxAge: options?.maxAge ?? SESSION_MAX_AGE,
              })
            )
          } catch {
            // Called from a Server Component — middleware refreshes sessions.
          }
        },
      },
    }
  )
}
