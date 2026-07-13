// lib/handoff/route-auth.ts
// Shared route-auth helper for all six handoff token families (D1 PR2,
// Task 8). Consolidates the per-route Bearer-extraction + verify + scope
// dance that pat_/srt_/krt_/kst_/cat_/qct_ routes each currently duplicate
// (see lib/handoff/route-auth-characterization.test.ts, the 173-cell matrix
// this helper must reproduce EXACTLY). Policy — which error code/status each
// failure maps to, and which transport (bearer-strict vs cat_'s
// bearer-or-query) a family uses — lives on the registry's
// HandoffTokenConfig.authErrors/.transport (lib/handoff/registry.ts); this
// file is pure mechanism.
//
// Verifier seam (Codex plan-review fix 3): this module calls the FACADE
// verify functions (verifyPillarToken, etc.) imported from the six legacy
// lib/*-token.ts modules, NOT createHandoffTokenFamily/the registry config
// directly. Existing route tests mock '@/lib/<x>-token' — routing through
// the same facade functions keeps those mocks effective once routes adopt
// this helper (Tasks 10-11).
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { JWTPayload } from 'jose';
import type { HandoffFamilyKey } from './meta';
import { HANDOFF_TOKEN_CONFIGS, type HandoffAuthErrorCode } from './registry';
import {
  PillarTokenError,
  SeoRoadmapTokenError,
  KeywordMemoTokenError,
  KeywordStrategyTokenError,
  ContentAuditTokenError,
  QuarterPushTokenError,
} from './errors';
import { verifyPillarToken } from '../pillar-token';
import { verifySeoRoadmapToken } from '../seo-roadmap-token';
import { verifyKeywordMemoToken } from '../keyword-memo-token';
import { verifyKeywordStrategyToken } from '../keyword-strategy-token';
import { verifyContentAuditToken } from '../content-audit-token';
import { verifyQuarterPushToken } from '../quarter-push-token';

export type HandoffAuthResult = { ok: true; payload: JWTPayload } | { ok: false; response: NextResponse };

/**
 * One verify() per family, routed through each family's FACADE module (not
 * the registry/factory directly) so route tests' `vi.mock('@/lib/<x>-token')`
 * seams keep working after routes adopt this helper.
 */
const VERIFIERS: Record<HandoffFamilyKey, (token: string, expectedId: string) => Promise<JWTPayload>> = {
  pat: verifyPillarToken,
  srt: verifySeoRoadmapToken,
  krt: verifyKeywordMemoToken,
  kst: verifyKeywordStrategyToken,
  cat: verifyContentAuditToken,
  qct: verifyQuarterPushToken,
};

/**
 * Each family's own legacy error class. A verify() throw is only sniffed via
 * `authErrors.tokenError()` when it's an `instanceof` this class — matching
 * every legacy route's `if (err instanceof <FamilyError>) { ...sniff... }
 * else { 500 token_service_unavailable }` shape verbatim. cat_'s helper uses
 * a bare catch with no instanceof check, but its tokenError and
 * verifierUnavailable policies are identical ({error:'auth_required',
 * status:401}), so the branch taken is behaviorally moot for that family.
 */
const ERROR_CLASSES: Record<HandoffFamilyKey, new (message: string) => Error> = {
  pat: PillarTokenError,
  srt: SeoRoadmapTokenError,
  krt: KeywordMemoTokenError,
  kst: KeywordStrategyTokenError,
  cat: ContentAuditTokenError,
  qct: QuarterPushTokenError,
};

function jsonError(policy: HandoffAuthErrorCode): NextResponse {
  return NextResponse.json({ error: policy.error }, { status: policy.status });
}

type Extraction = { kind: 'token'; token: string } | { kind: 'missing' } | { kind: 'malformed' };

/**
 * bearer-strict: exactly `/^Bearer\s+(<prefix>\S+)$/`, prefix-interpolated —
 * the CURRENT regex every pat_/srt_/krt_/kst_/qct_ route uses. No header ->
 * 'missing'; header present but no match (wrong scheme, wrong/no family
 * prefix) -> 'malformed'.
 *
 * bearer-or-query (cat_ ONLY): reproduces lib/content-audit/route-auth.ts's
 * `bearer()` verbatim — a header starting with 'Bearer ' WINS outright (its
 * value is used even if empty/garbage) and the query string is NEVER
 * consulted in that case; only when the header is absent or doesn't start
 * with 'Bearer ' does `?token=` get consulted. cat_'s extraction does NOT
 * check the cat_ prefix itself (unlike bearer-strict) — that check happens
 * inside verifyContentAuditToken, so a wrong-prefix cat_ request surfaces as
 * a 'token' extraction that fails later at verify(), not here. Because cat_
 * has no 'malformed' policy distinct from 'missing', this transport never
 * returns 'malformed'.
 */
function extractToken(req: NextRequest, prefix: string, transport: 'bearer-strict' | 'bearer-or-query'): Extraction {
  const authHeader = req.headers.get('authorization');

  if (transport === 'bearer-or-query') {
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      return { kind: 'token', token };
    }
    const queryToken = req.nextUrl.searchParams.get('token');
    return queryToken ? { kind: 'token', token: queryToken } : { kind: 'missing' };
  }

  if (!authHeader) return { kind: 'missing' };
  const match = authHeader.match(new RegExp(`^Bearer\\s+(${prefix}\\S+)$`));
  return match ? { kind: 'token', token: match[1] } : { kind: 'malformed' };
}

/**
 * Authenticates a public handoff-token request end to end: extract -> verify
 * (via the family's facade) -> scope check. Fail-closed — the outermost
 * try/catch maps ANY unexpected throw (not just a verify() throw) to the
 * family's `verifierUnavailable` policy, so this function never throws.
 */
export async function requireHandoffToken(
  req: NextRequest,
  family: HandoffFamilyKey,
  expectedId: string,
  requiredScope: string,
): Promise<HandoffAuthResult> {
  const config = HANDOFF_TOKEN_CONFIGS[family];
  try {
    const extraction = extractToken(req, config.prefix, config.transport);
    if (extraction.kind === 'missing') {
      return { ok: false, response: jsonError(config.authErrors.missingHeader) };
    }
    if (extraction.kind === 'malformed') {
      return { ok: false, response: jsonError(config.authErrors.malformedHeader) };
    }

    let payload: JWTPayload;
    try {
      payload = await VERIFIERS[family](extraction.token, expectedId);
    } catch (err) {
      if (err instanceof ERROR_CLASSES[family]) {
        return { ok: false, response: jsonError(config.authErrors.tokenError(err.message)) };
      }
      return { ok: false, response: jsonError(config.authErrors.verifierUnavailable) };
    }

    const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
    if (!scopes.includes(requiredScope)) {
      return { ok: false, response: jsonError(config.authErrors.missingScope) };
    }

    return { ok: true, payload };
  } catch {
    return { ok: false, response: jsonError(config.authErrors.verifierUnavailable) };
  }
}
