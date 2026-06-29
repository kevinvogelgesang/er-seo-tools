import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, getAuthRedirectBase } from '@/lib/auth'
import { isSameSiteRequest } from '@/lib/security/same-site-request'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Logout lives under the public `/api/auth/` prefix, so middleware's central
  // same-site guard does not run for it — keep the explicit check here.
  if (!isSameSiteRequest(request)) {
    return NextResponse.json({ error: 'Cross-site logout requests are not allowed' }, { status: 403 })
  }

  const response = NextResponse.redirect(new URL('/login', getAuthRedirectBase(request)), { status: 303 })
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
