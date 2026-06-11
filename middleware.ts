import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, getAuthRedirectBase, isAuthBypassedInDev, isValidAuthCookie } from '@/lib/auth'

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/share/',
  '/ada-audit/share/',
  '/api/auth/',
  '/api/share/',
  '/_next/',
]

const PUBLIC_EXACT_PATHS = new Set([
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
])

// Skill-handoff API routes are authenticated by a short-lived JWT verified
// inside the route handler (sub binding + scope + expiry), NOT by the
// app-password cookie. They MUST bypass this cookie gate — otherwise the
// external Claude skill (which holds a token, not a session cookie) can never
// reach them, and the gate returns `auth_required` before the token logic runs.
// Only the token-bearing routes are listed; mint-token + by-session poll stay
// gated because they are triggered from the authenticated dashboard.
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true
  // pillar-analysis: GET payload + PATCH narrative
  if (/^\/api\/pillar-analysis\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/pillar-analysis\/[^/]+\/narrative$/.test(pathname)) return true
  // seo-roadmap: GET payload + PATCH roadmap write-back
  if (/^\/api\/seo-roadmap\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/seo-roadmap\/[^/]+\/roadmap$/.test(pathname)) return true
  // keyword-memo: GET payload + PATCH memo write-back
  if (/^\/api\/keyword-memo\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/keyword-memo\/[^/]+\/memo$/.test(pathname)) return true
  // quarter push (qct_): GET cycle export + POST receipt write-back.
  // mint-token stays cookie-gated (triggered from the authenticated grid).
  if (/^\/api\/quarter-plan\/push\/\d+$/.test(pathname)) return true
  if (/^\/api\/quarter-plan\/push\/\d+\/receipt$/.test(pathname)) return true
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function wantsJson(request: NextRequest): boolean {
  const accept = request.headers.get('accept') ?? ''
  return request.nextUrl.pathname.startsWith('/api/') || accept.includes('application/json')
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname) || isAuthBypassedInDev()) {
    return NextResponse.next()
  }

  if (await isValidAuthCookie(request.cookies.get(AUTH_COOKIE_NAME)?.value)) {
    return NextResponse.next()
  }

  if (wantsJson(request)) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  }

  const loginUrl = new URL('/login', getAuthRedirectBase(request))
  loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!.*\\..*).*)', '/api/:path*'],
}
