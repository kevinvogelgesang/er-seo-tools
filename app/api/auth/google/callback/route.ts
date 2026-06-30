// GET /api/auth/google/callback — complete the Google login handshake.
// Verifies the handshake cookie (state) + ID token (signature/nonce via the lib)
// + identity (domain/active), then mints the verified session cookie. Any failure
// redirects to /login with a generic error and clears the handshake cookie.

import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_MAX_AGE_SECONDS,
  createAuthCookieValue,
  getAuthRedirectBase,
  normalizeAuthReturnPath,
  readSignedToken,
} from '@/lib/auth'
import { verifyGoogleCallback } from '@/lib/auth/google-oauth'
import { resolveOperatorIdentity } from '@/lib/auth/identity'

export const dynamic = 'force-dynamic'

const OAUTH_HANDSHAKE_COOKIE = 'er_oauth' // must match /api/auth/google/start

function loginError(base: string, code: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, base), { status: 307 })
  res.cookies.delete({ name: OAUTH_HANDSHAKE_COOKIE, path: '/api/auth/google' })
  return res
}

export async function GET(request: NextRequest) {
  const base = getAuthRedirectBase(request)
  const params = new URL(request.url).searchParams

  // User declined consent (or Google returned an error).
  if (params.get('error')) return loginError(base, 'oauth_denied')

  const handshake = await readSignedToken(request.cookies.get(OAUTH_HANDSHAKE_COOKIE)?.value)
  if (!handshake || typeof handshake.state !== 'string') return loginError(base, 'oauth_failed')

  const code = params.get('code')
  if (!code || params.get('state') !== handshake.state) return loginError(base, 'oauth_failed')

  const allowedHd = process.env.GOOGLE_ALLOWED_HD
  if (!allowedHd) return loginError(base, 'oauth_unavailable')

  const redirectUri = new URL('/api/auth/google/callback', base).toString()

  try {
    const verified = await verifyGoogleCallback({
      code,
      codeVerifier: String(handshake.codeVerifier),
      redirectUri,
      expectedNonce: String(handshake.nonce),
    })
    const operator = await resolveOperatorIdentity(verified, { allowedHd })

    const next = normalizeAuthReturnPath(typeof handshake.next === 'string' ? handshake.next : '/')
    const res = NextResponse.redirect(new URL(next, base), { status: 307 })
    res.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: await createAuthCookieValue(operator),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    })
    res.cookies.delete({ name: OAUTH_HANDSHAKE_COOKIE, path: '/api/auth/google' })
    return res
  } catch (err) {
    // Generic error to the user; reason stays server-side (sanitized — no tokens).
    console.error('[auth/google/callback]', err instanceof Error ? err.message : 'error')
    return loginError(base, 'oauth_denied')
  }
}
