// v2 PR4: verified-operator detection for the PUBLIC page. The auth cookie
// value is verified by getAuthSession; break-glass sessions carry no email.

import { cookies } from 'next/headers'
import { AUTH_COOKIE_NAME, getAuthSession, isAuthBypassedInDev } from '@/lib/auth'

export async function getOperatorEmailForPublicPage(): Promise<string | null> {
  if (isAuthBypassedInDev()) return 'dev@localhost'
  const cookieStore = await cookies()
  const session = await getAuthSession(cookieStore.get(AUTH_COOKIE_NAME)?.value)
  return session?.email ?? null
}
