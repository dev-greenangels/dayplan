import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/pending', '/auth']
const SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 10

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    p => pathname === p || pathname.startsWith(p + '/')
  )
}

/**
 * Session refresh only. Role routing lives in app pages/layout —
 * doing it here too caused /admin ↔ /pending ↔ /login redirect loops.
 */
export async function updateSession(request: NextRequest) {
  // OAuth/PKCE: Supabase often returns ?code= to Site URL (/). Exchange must happen on /auth/callback.
  const code = request.nextUrl.searchParams.get('code')
  const pathname = request.nextUrl.pathname
  if (code && !pathname.startsWith('/auth/callback')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/callback'
    return NextResponse.redirect(url)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
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
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              maxAge: options?.maxAge ?? SESSION_MAX_AGE,
            })
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublicPath(pathname) && pathname !== '/' && !pathname.startsWith('/api')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Logged-in users shouldn't sit on the login screen — root page picks the home by role
  if (
    user &&
    (pathname === '/login' || pathname === '/auth/login' || pathname.startsWith('/auth/login/'))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Pending lock: only when DB actually says pending (never guess)
  if (user && pathname !== '/pending' && !pathname.startsWith('/auth') && !pathname.startsWith('/api')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.role === 'pending') {
      const url = request.nextUrl.clone()
      url.pathname = '/pending'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
