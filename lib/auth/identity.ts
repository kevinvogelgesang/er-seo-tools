// Turns a verified Google identity into an app session identity, enforcing the
// company-domain gate and the per-user active allowlist, and recording the login.

import { prisma } from '@/lib/db'
import type { AuthIdentity } from '@/lib/auth'
import type { GoogleVerifiedIdentity } from './google-oauth'

export class IdentityError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
    this.name = 'IdentityError'
  }
}

/**
 * Enforce + record. Throws IdentityError (a 4xx-class reason) when the identity
 * is not allowed; returns the session AuthIdentity when it is.
 *
 * Gate: email_verified, the verified ID-token `hd` claim === allowedHd, and the
 * email domain === allowedHd. The User row (keyed by Google `sub`) is upserted
 * and must be `active`.
 */
export async function resolveOperatorIdentity(
  verified: GoogleVerifiedIdentity,
  opts: { allowedHd: string },
): Promise<AuthIdentity> {
  if (!verified.emailVerified || !verified.email) {
    throw new IdentityError('email_unverified')
  }

  const allowedHd = opts.allowedHd.toLowerCase()
  const email = verified.email.toLowerCase()
  const hd = verified.hd?.toLowerCase() ?? null
  if (!allowedHd || hd !== allowedHd || !email.endsWith(`@${allowedHd}`)) {
    throw new IdentityError('domain_not_allowed')
  }

  const user = await prisma.user.upsert({
    where: { googleSub: verified.sub },
    update: { email, name: verified.name, hd, lastLoginAt: new Date() },
    create: {
      googleSub: verified.sub,
      email,
      name: verified.name,
      hd,
      active: true,
      lastLoginAt: new Date(),
    },
  })
  if (!user.active) {
    throw new IdentityError('account_deactivated')
  }

  return { sub: `google:${verified.sub}`, email, hd, name: verified.name }
}
