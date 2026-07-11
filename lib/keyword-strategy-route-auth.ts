// lib/keyword-strategy-route-auth.ts
// Shared Bearer-token auth for the three PUBLIC KS-5 keyword-strategy routes
// (export GET, memo PATCH, volumes POST). One home for the Bearer regex, the
// verifyKeywordStrategyToken call, the tokenErrorCode taxonomy (mirrors the
// keyword-memo route), and the per-route scope check — so the three handlers
// don't each carry a copy. Returns a NextResponse to return on failure, or the
// verified payload on success.
import { NextResponse, type NextRequest } from 'next/server'
import type { JWTPayload } from 'jose'
import {
  verifyKeywordStrategyToken,
  KeywordStrategyTokenError,
} from '@/lib/keyword-strategy-token'

/** Same taxonomy the keyword-memo route uses; every code is a 401. */
function tokenErrorCode(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('expired')) return 'token_expired'
  if (m.includes('does not match')) return 'token_wrong_session_id'
  if (m.includes('signature')) return 'token_invalid_signature'
  return 'token_invalid'
}

export type StrategyAuthResult =
  | { ok: true; payload: JWTPayload }
  | { ok: false; response: NextResponse }

/**
 * Authenticate a public keyword-strategy request:
 *   Bearer `kst_…` header → verifyKeywordStrategyToken(token, sessionId) →
 *   scope must include `requiredScope`.
 * A legacy `krt_` token fails the Bearer regex (401 auth_malformed); a valid
 * kst_ token missing the scope fails with 401 token_missing_scope — two
 * independent walls (spec §5, umbrella-Codex #2).
 */
export async function authenticateStrategyRequest(
  req: NextRequest,
  sessionId: string,
  requiredScope: string,
): Promise<StrategyAuthResult> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return { ok: false, response: NextResponse.json({ error: 'auth_missing' }, { status: 401 }) }
  }
  const match = authHeader.match(/^Bearer\s+(kst_\S+)$/)
  if (!match) {
    return { ok: false, response: NextResponse.json({ error: 'auth_malformed' }, { status: 401 }) }
  }

  let payload: JWTPayload
  try {
    payload = await verifyKeywordStrategyToken(match[1], sessionId)
  } catch (err) {
    if (err instanceof KeywordStrategyTokenError) {
      return {
        ok: false,
        response: NextResponse.json({ error: tokenErrorCode(err.message) }, { status: 401 }),
      }
    }
    return {
      ok: false,
      response: NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 }),
    }
  }

  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : []
  if (!scopes.includes(requiredScope)) {
    return { ok: false, response: NextResponse.json({ error: 'token_missing_scope' }, { status: 401 }) }
  }

  return { ok: true, payload }
}
