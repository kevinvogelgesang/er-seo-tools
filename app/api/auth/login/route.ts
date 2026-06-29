import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_MAX_AGE_SECONDS,
  OPERATOR_NAME_COOKIE_NAME,
  OPERATOR_NAME_MAX_AGE_SECONDS,
  createAuthCookieValue,
  getAuthRedirectBase,
  normalizeAuthReturnPath,
  sanitizeOperatorName,
  verifyPassword,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const password = formData.get('password')
  const nextPath = normalizeAuthReturnPath(formData.get('next'))

  const base = getAuthRedirectBase(request)

  if (typeof password !== 'string' || !verifyPassword(password)) {
    const loginUrl = new URL('/login', base)
    loginUrl.searchParams.set('error', 'invalid')
    loginUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(loginUrl, { status: 303 })
  }

  // Operator-name cookie (optional, non-credential): set when provided,
  // delete when empty/whitespace so a stale value doesn't survive.
  const operatorName = sanitizeOperatorName(formData.get('operatorName'))

  const response = NextResponse.redirect(new URL(nextPath, base), { status: 303 })
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    // Break-glass / shared-password session: synthetic identity (no verified
    // email or hosted domain). Google logins carry the verified identity instead.
    value: await createAuthCookieValue({
      sub: 'password:break-glass',
      email: null,
      hd: null,
      name: operatorName ?? 'Operator',
    }),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  })

  if (operatorName) {
    response.cookies.set({
      name: OPERATOR_NAME_COOKIE_NAME,
      value: operatorName,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: OPERATOR_NAME_MAX_AGE_SECONDS,
    })
  } else {
    response.cookies.delete(OPERATOR_NAME_COOKIE_NAME)
  }

  return response
}
