// Operator attribution for viewbook admin writes (spec §7 / Kevin decision):
// a VERIFIED session email or a 401 — never a sentinel stored in an
// email-typed field. Takes the Request so direct route tests are
// deterministic (no next/headers ambient state).
//
// Dev-bypass affordance: when auth is not configured outside production
// (isAuthBypassedInDev), the whole app is open and there is no identity at
// all; admin writes attribute to 'dev@localhost' so local development works.
// Production always has configured auth (requireAuthConfig at boot).

import { AUTH_COOKIE_NAME, getAuthSession, isAuthBypassedInDev } from '@/lib/auth'
import { HttpError } from '@/lib/api/errors'

function cookieFromHeader(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

// Non-throwing core: null means "no verified operator identity", used where a
// route wants to know operator status WITHOUT gating the whole request on it
// (e.g. an anonymous-writable public route that additionally unlocks a
// stricter action for verified operators).
export async function resolveOperatorEmail(request: Request): Promise<string | null> {
  if (isAuthBypassedInDev()) return 'dev@localhost'
  const value = cookieFromHeader(request.headers.get('cookie') ?? '', AUTH_COOKIE_NAME)
  const session = await getAuthSession(value)
  return session?.email ?? null
}

export async function requireOperatorEmail(request: Request): Promise<string> {
  const email = await resolveOperatorEmail(request)
  if (!email) throw new HttpError(401, 'auth_required')
  return email
}
