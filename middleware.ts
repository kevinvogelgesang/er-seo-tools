import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, getAuthRedirectBase, isAuthBypassedInDev, isValidAuthCookie } from '@/lib/auth'
import { isMutatingMethod, isSameSiteRequest } from '@/lib/security/same-site-request'

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/share/',
  '/ada-audit/share/',
  '/ada-audit/site/share/',
  '/api/auth/',
  '/api/share/',
  '/_next/',
]

const PUBLIC_EXACT_PATHS = new Set([
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  // Public privacy policy — required to be reachable without auth for Google
  // OAuth consent-screen branding/verification (the app is otherwise login-gated).
  '/privacy',
  // Public "about" page — the app's home-page URL for the Google OAuth consent
  // screen; must be reachable without auth and describe the app's purpose.
  '/about',
  // A4 observability — public shallow liveness for an uptime monitor. Exact match
  // only; a future /api/health/detail must stay cookie-gated.
  '/api/health',
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
  // keyword-strategy (kst_): GET export + PATCH memo + POST volumes (billable —
  // volume-lookup scope). mint-token + by-session poll stay cookie-gated
  // (triggered from the authenticated dashboard).
  if (/^\/api\/keyword-strategy\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/keyword-strategy\/[^/]+\/memo$/.test(pathname)) return true
  if (/^\/api\/keyword-strategy\/[^/]+\/volumes$/.test(pathname)) return true
  // content-audit (cat_): GET manifest + GET page + PATCH findings. mint-token +
  // the cookie-gated poll (/api/site-audit/[id]/content-audit) stay gated —
  // they run from the authenticated dashboard. NEVER an /api/content-audit/
  // prefix (that would expose future gated sub-routes).
  if (/^\/api\/content-audit\/[^/]+\/manifest$/.test(pathname)) return true
  if (/^\/api\/content-audit\/[^/]+\/page$/.test(pathname)) return true
  if (/^\/api\/content-audit\/[^/]+\/findings$/.test(pathname)) return true
  // quarter push (qct_): GET cycle export + POST receipt write-back.
  // mint-token stays cookie-gated (triggered from the authenticated grid).
  if (/^\/api\/quarter-plan\/push\/\d+$/.test(pathname)) return true
  if (/^\/api\/quarter-plan\/push\/\d+\/receipt$/.test(pathname)) return true
  // C14 sales surface: public report page + token-scoped screenshots ONLY.
  // NEVER add an '/api/sales/' or '/sales/' PREFIX — that would expose the
  // cookie-gated intake page (/sales) and prospect APIs (/api/sales/prospects…).
  if (/^\/sales\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/sales\/[^/]+\/screenshot\/[^/]+\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/sales\/[^/]+\/hero\/[^/]+$/.test(pathname)) return true
  // Client viewbook: public themed page + exact token-scoped routes ONLY.
  // NEVER a '/viewbook/' or '/api/viewbook/' PREFIX — every public write
  // matcher is anchored, and /viewbooks (admin) stays cookie-gated.
  if (/^\/viewbook\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/assets\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/feedback$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/materials$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/answers$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/sync$/.test(pathname)) return true
  // v2 PR5: post-contract-stage public writes (ack/team-members/setup). Same
  // anchoring discipline — single-segment, no '/api/viewbook/' prefix. The
  // ack-RESET route (/api/viewbooks/[id]/ack/[sectionKey]) is the admin
  // namespace and stays cookie-gated by omission — no entry here.
  if (/^\/api\/viewbook\/[^/]+\/ack$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/team-members$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/setup$/.test(pathname)) return true
  // DORMANT (2026-07-19): no longer called by the client — collapse is now
  // purely local (localStorage); see docs/superpowers/specs/2026-07-19-
  // viewbook-collapse-local-revision.md. Matcher kept so the (unused) route
  // stays reachable/functional. v2 PR2: viewer-facing shared section
  // collapse. Same anchoring discipline.
  if (/^\/api\/viewbook\/[^/]+\/collapse$/.test(pathname)) return true
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

  // CSRF defense-in-depth: reject cross-site mutating requests to cookie-gated
  // routes. Public/token routes (login, logout, skill-handoff) already returned
  // above, so this never touches the token-authed handoff flow. SameSite=Lax +
  // CORS preflight already mitigate this; the explicit check hardens it further,
  // and matters more once user OAuth lands.
  if (isMutatingMethod(request.method) && !isSameSiteRequest(request)) {
    return NextResponse.json({ error: 'cross_site_request_blocked' }, { status: 403 })
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
