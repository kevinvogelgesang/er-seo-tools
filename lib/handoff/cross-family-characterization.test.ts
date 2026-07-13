// lib/handoff/cross-family-characterization.test.ts
//
// D1 frozen-wire net: the LAST characterization piece for the token-auth
// layer. Two things pinned here, both CURRENT-code behavior (warts
// included) — a failure means the test mis-modeled the code, fix the test:
//
// 1. cat_'s Bearer-vs-?token= transport precedence
//    (lib/content-audit/route-auth.ts bearer(), lines 12-16): a request's
//    Authorization header is consulted FIRST; the ?token= query param is
//    read ONLY when that header is entirely absent or does not start with
//    'Bearer '. Once a Bearer-prefixed value is extracted from the header,
//    it is used exclusively — an invalid Bearer token NEVER falls back to
//    a valid ?token=.
//
// 2. Audience isolation for the three token families that deliberately
//    share KEYWORD_MEMO_TOKEN_SECRET (no per-family prod env var):
//      krt_ (lib/keyword-memo-token.ts)      audience 'keyword-strategy-memo'
//      kst_ (lib/keyword-strategy-token.ts)  audience 'keyword-strategy-client'
//      cat_ (lib/content-audit-token.ts)     audience 'content-audit-client'
//    Each verify() checks its OWN literal prefix before touching the JWT at
//    all, so a same-secret cross-family token is normally rejected by the
//    PREFIX wall, not the audience wall (pinned as-is below). To prove the
//    audience wall is a real, independent line of defense — not just an
//    artifact of the prefix check — each pair is ALSO exercised with the
//    minted token's prefix stripped and replaced with the target family's
//    prefix, which bypasses the prefix wall and forces the assertion onto
//    audience validation alone.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

import { requireContentAuditToken } from '../content-audit/route-auth';
import { mintContentAuditToken, verifyContentAuditToken, ContentAuditTokenError } from '../content-audit-token';
import { mintKeywordMemoToken, verifyKeywordMemoToken, KeywordMemoTokenError } from '../keyword-memo-token';
import {
  mintKeywordStrategyToken,
  verifyKeywordStrategyToken,
  KeywordStrategyTokenError,
} from '../keyword-strategy-token';

const ORIG_ENV = { ...process.env };
// NODE_ENV is 'test' under vitest, but the dev fallback secret in all three
// token modules only activates when KEYWORD_MEMO_TOKEN_SECRET is unset — set
// it explicitly so mint/verify below are deterministic and independent of
// whatever the ambient test env happens to have.
const SHARED_SECRET = 'test-shared-secret-krt-kst-cat-0000000000';

beforeAll(() => {
  process.env = { ...ORIG_ENV, NODE_ENV: 'test', KEYWORD_MEMO_TOKEN_SECRET: SHARED_SECRET };
});
afterAll(() => {
  process.env = { ...ORIG_ENV };
});

// ---------------------------------------------------------------------------
// 1. cat_ transport precedence — exercised through requireContentAuditToken
//    directly (the route handlers themselves are already covered by
//    route-auth-characterization.test.ts and manifest/route.test.ts).
// ---------------------------------------------------------------------------
const CAT_PRECEDENCE_SUB = 'sa_cat-precedence';

function catReq(query: string | null, authHeader: string | null): NextRequest {
  const base = `http://localhost/api/content-audit/${CAT_PRECEDENCE_SUB}/manifest`;
  const url = query != null ? `${base}?token=${encodeURIComponent(query)}` : base;
  const headers: Record<string, string> = {};
  if (authHeader != null) headers.Authorization = authHeader;
  return new NextRequest(url, { headers });
}

describe('cat_ transport precedence (lib/content-audit/route-auth.ts bearer())', () => {
  it('case 1: missing Authorization header + valid ?token= -> accepted (query fallback)', async () => {
    const { token } = await mintContentAuditToken(CAT_PRECEDENCE_SUB);
    const result = await requireContentAuditToken(catReq(token, null), CAT_PRECEDENCE_SUB, 'read');
    expect(result.ok).toBe(true);
  });

  it('case 2: non-Bearer Authorization header + valid ?token= -> accepted (falls back to query)', async () => {
    const { token } = await mintContentAuditToken(CAT_PRECEDENCE_SUB);
    const result = await requireContentAuditToken(catReq(token, 'Basic dXNlcjpwYXNz'), CAT_PRECEDENCE_SUB, 'read');
    expect(result.ok).toBe(true);
  });

  it("case 3: 'Bearer <invalid>' + valid ?token= -> 401 auth_required (header token extracted; an invalid Bearer NEVER falls back to query)", async () => {
    const { token } = await mintContentAuditToken(CAT_PRECEDENCE_SUB);
    const result = await requireContentAuditToken(catReq(token, 'Bearer cat_invalid'), CAT_PRECEDENCE_SUB, 'read');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.res.status).toBe(401);
    expect(await result.res.json()).toEqual({ error: 'auth_required' });
  });

  it('case 4: missing header + no query -> 401 auth_required', async () => {
    const result = await requireContentAuditToken(catReq(null, null), CAT_PRECEDENCE_SUB, 'read');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.res.status).toBe(401);
    expect(await result.res.json()).toEqual({ error: 'auth_required' });
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-family audience isolation — krt_/kst_/cat_ share
//    KEYWORD_MEMO_TOKEN_SECRET; each pair below is exercised in both
//    directions (6 permutations total).
// ---------------------------------------------------------------------------
interface FamilyDef {
  label: string;
  prefix: string;
  mint: (sub: string) => Promise<{ token: string }>;
  verify: (token: string, sub: string) => Promise<unknown>;
  ErrorClass: new (message: string) => Error;
}

const KRT: FamilyDef = {
  label: 'krt_',
  prefix: 'krt_',
  mint: mintKeywordMemoToken,
  verify: verifyKeywordMemoToken,
  ErrorClass: KeywordMemoTokenError,
};
const KST: FamilyDef = {
  label: 'kst_',
  prefix: 'kst_',
  mint: mintKeywordStrategyToken,
  verify: verifyKeywordStrategyToken,
  ErrorClass: KeywordStrategyTokenError,
};
const CAT: FamilyDef = {
  label: 'cat_',
  prefix: 'cat_',
  mint: mintContentAuditToken,
  verify: verifyContentAuditToken,
  ErrorClass: ContentAuditTokenError,
};

function runCrossFamilyRejection(source: FamilyDef, target: FamilyDef) {
  describe(`${source.label} token presented to ${target.label} verify (same secret, same sub)`, () => {
    const SUB = `xfam-${source.label}${target.label}sub`;

    it('rejects on the PREFIX wall (pinned wart: verify checks its own literal prefix before signature/audience)', async () => {
      const { token } = await source.mint(SUB);
      expect(token.startsWith(source.prefix)).toBe(true);

      let caught: unknown;
      try {
        await target.verify(token, SUB);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(target.ErrorClass);
      expect((caught as Error).message).toContain(`missing ${target.prefix} prefix`);
    });

    it('still rejects on the AUDIENCE wall when the prefix wall is bypassed (prefix re-forged, same secret+sub)', async () => {
      const { token } = await source.mint(SUB);
      const rawJwt = token.slice(source.prefix.length);
      const forged = target.prefix + rawJwt;

      let caught: unknown;
      try {
        await target.verify(forged, SUB);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(target.ErrorClass);
      // Proves this rejection came from the audience check, not the prefix
      // check the previous test already pinned.
      expect((caught as Error).message).not.toContain('prefix');
    });
  });
}

runCrossFamilyRejection(KRT, KST);
runCrossFamilyRejection(KRT, CAT);
runCrossFamilyRejection(KST, KRT);
runCrossFamilyRejection(KST, CAT);
runCrossFamilyRejection(CAT, KRT);
runCrossFamilyRejection(CAT, KST);
