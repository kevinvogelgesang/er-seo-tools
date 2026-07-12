// lib/content-audit-token.ts
// Stateless JWT for the C12 D1 cat_ content-audit bridge. Structural clone of
// lib/keyword-strategy-token.ts — deliberately shares KEYWORD_MEMO_TOKEN_SECRET
// (no new prod env var); the distinct AUDIENCE is the isolation wall between
// this and the kst_/krt_ families. Subject = siteAuditId.
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const ISSUER = 'er-seo-tools'
const AUDIENCE = 'content-audit-client'
export const CONTENT_AUDIT_TOKEN_TTL_MS = 3600 * 1000 // 1h — lockstep with EXPIRY_SECONDS
const EXPIRY_SECONDS = 3600
const TOKEN_PREFIX = 'cat_'

export const CONTENT_AUDIT_TOKEN_SCOPES = ['read', 'findings-write'] as const

const DEV_FALLBACK_SECRET = 'dev-keyword-memo-secret-do-not-use-in-prod'
let didWarnAboutDevFallback = false

export class ContentAuditTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentAuditTokenError'
  }
}

function getSecret(): Uint8Array {
  const env = process.env.KEYWORD_MEMO_TOKEN_SECRET
  if (env && env.length > 0) return new TextEncoder().encode(env)
  if (process.env.NODE_ENV === 'production') {
    throw new ContentAuditTokenError(
      'KEYWORD_MEMO_TOKEN_SECRET is required in production and is unset. Refusing to mint or verify tokens.',
    )
  }
  if (!didWarnAboutDevFallback) {
    // eslint-disable-next-line no-console
    console.warn('[content-audit-token] KEYWORD_MEMO_TOKEN_SECRET unset; using dev fallback. Set the env var in production.')
    didWarnAboutDevFallback = true
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET)
}

export interface MintedToken { token: string; expiresAt: string }

export async function mintContentAuditToken(siteAuditId: string): Promise<MintedToken> {
  const secret = getSecret()
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + EXPIRY_SECONDS
  const jwt = await new SignJWT({ scope: [...CONTENT_AUDIT_TOKEN_SCOPES] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(siteAuditId)
    .setIssuedAt(issuedAt).setExpirationTime(expiresAt)
    .sign(secret)
  return { token: TOKEN_PREFIX + jwt, expiresAt: new Date(expiresAt * 1000).toISOString() }
}

export async function verifyContentAuditToken(
  token: string, expectedSiteAuditId: string,
): Promise<JWTPayload> {
  if (!token.startsWith(TOKEN_PREFIX)) throw new ContentAuditTokenError('token missing cat_ prefix')
  const jwt = token.slice(TOKEN_PREFIX.length)
  let payload: JWTPayload
  try {
    const verified = await jwtVerify(jwt, getSecret(), { issuer: ISSUER, audience: AUDIENCE })
    payload = verified.payload
  } catch (err) {
    throw new ContentAuditTokenError(
      `token verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
    )
  }
  if (payload.sub !== expectedSiteAuditId) {
    throw new ContentAuditTokenError(
      `token sub (${payload.sub}) does not match expected site audit id (${expectedSiteAuditId})`,
    )
  }
  return payload
}
