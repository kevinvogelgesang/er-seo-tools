// lib/keyword-strategy-route-auth.ts
// Facade over lib/handoff/route-auth.ts (D1 Task 9): authenticateStrategyRequest
// now delegates to requireHandoffToken(req, 'kst', sessionId, requiredScope),
// keeping this module's own exported signature + StrategyAuthResult shape
// (property `response`, same as the shared helper) so the three public KS-5
// keyword-strategy routes (export GET, memo PATCH, volumes POST) don't need
// to change.
import type { NextRequest, NextResponse } from 'next/server'
import type { JWTPayload } from 'jose'
import { requireHandoffToken } from '@/lib/handoff/route-auth'

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
  return requireHandoffToken(req, 'kst', sessionId, requiredScope)
}
