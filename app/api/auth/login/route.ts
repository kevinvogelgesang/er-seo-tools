import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_MAX_AGE_SECONDS,
  createAuthCookieValue,
  normalizeAuthReturnPath,
  verifyPassword,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const password = formData.get('password')
  const nextPath = normalizeAuthReturnPath(formData.get('next'))

  if (typeof password !== 'string' || !verifyPassword(password)) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', 'invalid')
    loginUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(loginUrl, { status: 303 })
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 })
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: await createAuthCookieValue(),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  })
  return response
}
