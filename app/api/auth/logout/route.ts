import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function trustedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>([new URL(request.url).origin])
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      origins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin)
    } catch {
      // Ignore malformed deployment URL here; startup/config checks cover env mistakes.
    }
  }
  return origins
}

function isSameSiteLogoutRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    return false
  }

  const origin = request.headers.get('origin')
  if (!origin) return true

  return trustedOrigins(request).has(origin)
}

export async function POST(request: NextRequest) {
  if (!isSameSiteLogoutRequest(request)) {
    return NextResponse.json({ error: 'Cross-site logout requests are not allowed' }, { status: 403 })
  }

  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 })
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
}
