// lib/content-audit-token.ts — facade over lib/handoff (D1 consolidation,
// Task 6). Wire contract unchanged. Stateless JWT for the C12 D1 cat_
// content-audit bridge. Structural clone of lib/keyword-strategy-token.ts —
// deliberately shares KEYWORD_MEMO_TOKEN_SECRET (no new prod env var); the
// distinct AUDIENCE is the isolation wall between this and the kst_/krt_
// families. Subject = siteAuditId.
import type { JWTPayload } from 'jose'
import { createHandoffTokenFamily } from './handoff/token'
import { HANDOFF_TOKEN_CONFIGS } from './handoff/registry'

export { ContentAuditTokenError } from './handoff/errors'

export const CONTENT_AUDIT_TOKEN_TTL_MS = HANDOFF_TOKEN_CONFIGS.cat.ttlSeconds * 1000 // 1h — lockstep with the registry's ttlSeconds

export const CONTENT_AUDIT_TOKEN_SCOPES = HANDOFF_TOKEN_CONFIGS.cat.scopes

export interface MintedToken { token: string; expiresAt: string }

const family = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.cat)

export async function mintContentAuditToken(siteAuditId: string): Promise<MintedToken> {
  return family.mint(siteAuditId)
}

export async function verifyContentAuditToken(
  token: string, expectedSiteAuditId: string,
): Promise<JWTPayload> {
  return family.verify(token, expectedSiteAuditId)
}
