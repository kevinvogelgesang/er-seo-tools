import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, isAuthBypassedInDev, isValidAuthCookie } from '@/lib/auth'

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

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true
  if (/^\/api\/pillar-analysis\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/pillar-analysis\/[^/]+\/narrative$/.test(pathname)) return true
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

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!.*\\..*).*)', '/api/:path*'],
}
