// GET /api/auth/google/start — begin the Google login handshake.
// Builds the Google auth URL (PKCE + nonce + state) and stores the transient
// handshake in a short-lived signed, HttpOnly cookie scoped to /api/auth/google.

import { NextRequest, NextResponse } from 'next/server'
import { createSignedToken, getAuthRedirectBase, normalizeAuthReturnPath } from '@/lib/auth'
import {
  buildGoogleAuthRequest,
  isGoogleOAuthConfigured,
  GOOGLE_HANDSHAKE_TTL_SECONDS,
} from '@/lib/auth/google-oauth'

export const dynamic = 'force-dynamic'

const OAUTH_HANDSHAKE_COOKIE = 'er_oauth' // must match /api/auth/google/callback

export async function GET(request: NextRequest) {
  const base = getAuthRedirectBase(request)

  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(new URL('/login?error=oauth_unavailable', base), { status: 307 })
  }

  const next = normalizeAuthReturnPath(new URL(request.url).searchParams.get('next'))
  const redirectUri = new URL('/api/auth/google/callback', base).toString()

  const { url, handshake } = await buildGoogleAuthRequest({
    redirectUri,
    next,
    hd: process.env.GOOGLE_ALLOWED_HD || undefined,
  })

  const res = NextResponse.redirect(url, { status: 307 })
  res.cookies.set({
    name: OAUTH_HANDSHAKE_COOKIE,
    value: await createSignedToken(handshake, GOOGLE_HANDSHAKE_TTL_SECONDS),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/google',
    maxAge: GOOGLE_HANDSHAKE_TTL_SECONDS,
  })
  return res
}
