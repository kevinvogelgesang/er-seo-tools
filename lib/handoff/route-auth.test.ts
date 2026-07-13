// lib/handoff/route-auth.test.ts
// TDD for the shared requireHandoffToken() helper (D1 PR2, Task 8). Every
// {error,status} cell asserted here must match the exact value pinned at the
// route level by lib/handoff/route-auth-characterization.test.ts — this
// helper is the thing that later replaces those routes' inline auth blocks,
// so a mismatch here IS a regression, not a test-authoring choice.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

import { requireHandoffToken } from './route-auth';
import type { HandoffFamilyKey } from './meta';

// Mocked ONLY for the two "facade seam" tests at the bottom of this file —
// `vi.fn(actual.fn)` wraps the real implementation so every OTHER test in
// this file (which forges real JWTs and expects real verify() behavior)
// keeps working unmodified; only a `mockRejectedValueOnce`/spy assertion
// inside those specific tests observes/overrides a single call.
vi.mock('../pillar-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pillar-token')>();
  return { ...actual, verifyPillarToken: vi.fn(actual.verifyPillarToken) };
});
vi.mock('../content-audit-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../content-audit-token')>();
  return { ...actual, verifyContentAuditToken: vi.fn(actual.verifyContentAuditToken) };
});

import { verifyPillarToken } from '../pillar-token';
import { verifyContentAuditToken } from '../content-audit-token';

const ORIG_ENV = { ...process.env };

const SECRETS = {
  pat: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  srt: 'test-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb',
  krtKstCat: 'test-secret-cccccccccccccccccccccccc', // KEYWORD_MEMO_TOKEN_SECRET, shared by krt_/kst_/cat_
  qct: 'test-secret-dddddddddddddddddddddddd',
};

beforeEach(() => {
  process.env = {
    ...ORIG_ENV,
    NODE_ENV: 'test',
    PILLAR_TOKEN_SECRET: SECRETS.pat,
    SEO_ROADMAP_TOKEN_SECRET: SECRETS.srt,
    KEYWORD_MEMO_TOKEN_SECRET: SECRETS.krtKstCat,
    QUARTER_PUSH_TOKEN_SECRET: SECRETS.qct,
  };
  vi.mocked(verifyPillarToken).mockClear();
  vi.mocked(verifyContentAuditToken).mockClear();
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

/** Same hand-forged JWT builder as route-auth-characterization.test.ts. */
async function forge(opts: {
  aud: string;
  sub: string;
  scope?: unknown;
  omitScope?: boolean;
  secret: string;
  prefix: string;
  iss?: string;
  expSecondsFromNow?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = opts.omitScope ? {} : { scope: opts.scope };
  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(opts.iss ?? 'er-seo-tools')
    .setAudience(opts.aud)
    .setSubject(opts.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSecondsFromNow ?? 3600))
    .sign(new TextEncoder().encode(opts.secret));
  return opts.prefix + jwt;
}

function req(authHeader: string | null, url = 'http://localhost/x'): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader != null) headers.Authorization = authHeader;
  return new NextRequest(url, { headers });
}

async function expectFail(
  result: Awaited<ReturnType<typeof requireHandoffToken>>,
  code: { error: string; status: number },
) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.response.status).toBe(code.status);
  expect(await result.response.json()).toEqual({ error: code.error });
}

// ---------------------------------------------------------------------------
// Standard families: pat_/srt_/krt_/kst_/qct_ — bearer-strict transport,
// message-sniffed tokenError(), per-family missingHeader/malformedHeader
// split (qct_ collapses the two into one code).
// ---------------------------------------------------------------------------
interface StandardCfg {
  label: string;
  family: HandoffFamilyKey;
  prefix: string;
  secret: string;
  audience: string;
  sub: string;
  requiredScope: string;
  fullScopes: string[];
  noHeaderCode: { error: string; status: number };
  malformedCode: { error: string; status: number };
  invalidTokenCode: { error: string; status: number };
  badSigCode: { error: string; status: number };
  wrongSubCode: { error: string; status: number };
  missingScopeCode: { error: string; status: number };
}

function runStandardMatrix(cfg: StandardCfg) {
  describe(cfg.label, () => {
    it('fails with the missingHeader policy when Authorization is absent', async () => {
      const result = await requireHandoffToken(req(null), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.noHeaderCode);
    });

    it('fails with the malformedHeader policy on a non-Bearer scheme', async () => {
      const result = await requireHandoffToken(req('Basic dXNlcjpwYXNz'), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.malformedCode);
    });

    it('fails with the malformedHeader policy on a Bearer token with the wrong family prefix', async () => {
      const result = await requireHandoffToken(
        req('Bearer wrongfamily_notarealtoken'),
        cfg.family,
        cfg.sub,
        cfg.requiredScope,
      );
      await expectFail(result, cfg.malformedCode);
    });

    it('fails with the tokenError policy on a malformed JWT carrying the correct prefix', async () => {
      const result = await requireHandoffToken(
        req(`Bearer ${cfg.prefix}not-a-real-jwt`),
        cfg.family,
        cfg.sub,
        cfg.requiredScope,
      );
      await expectFail(result, cfg.invalidTokenCode);
    });

    it('fails with the tokenError policy on a validly-signed token with the wrong issuer', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
        iss: 'someone-else',
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.invalidTokenCode);
    });

    it('fails with the tokenError policy on a validly-signed token with the wrong audience', async () => {
      const token = await forge({
        aud: 'some-other-audience',
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.invalidTokenCode);
    });

    it('fails with the tokenError policy on an expired token (pinned wart: falls to the generic invalid code)', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
        expSecondsFromNow: -10,
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.invalidTokenCode);
    });

    it('fails with the badSig policy on a bad signature (signed with a different secret)', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: `${cfg.secret}-wrong`,
        prefix: cfg.prefix,
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.badSigCode);
    });

    it('fails with the wrongSub policy when the token sub does not match expectedId', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: `${cfg.sub}-other`,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.wrongSubCode);
    });

    it('fails with the missingScope policy when the scope array lacks the required scope', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes.filter((s) => s !== cfg.requiredScope),
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.missingScopeCode);
    });

    it('fails with the missingScope policy when the scope claim is a non-array value', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.requiredScope,
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.missingScopeCode);
    });

    it('fails with the missingScope policy when the scope claim is absent entirely', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        omitScope: true,
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      await expectFail(result, cfg.missingScopeCode);
    });

    it('succeeds with the verified payload on a fully valid token', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const result = await requireHandoffToken(req(`Bearer ${token}`), cfg.family, cfg.sub, cfg.requiredScope);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.payload.sub).toBe(cfg.sub);
      expect(result.payload.scope).toEqual(cfg.fullScopes);
    });
  });
}

runStandardMatrix({
  label: 'pat_',
  family: 'pat',
  prefix: 'pat_',
  secret: SECRETS.pat,
  audience: 'pillar-analysis-narrative',
  sub: 'pa_routeauth',
  requiredScope: 'read',
  fullScopes: ['read', 'narrative-write'],
  noHeaderCode: { error: 'auth_missing', status: 401 },
  malformedCode: { error: 'auth_malformed', status: 401 },
  invalidTokenCode: { error: 'token_invalid', status: 401 },
  badSigCode: { error: 'token_invalid_signature', status: 401 },
  wrongSubCode: { error: 'token_wrong_analysis_id', status: 401 },
  missingScopeCode: { error: 'token_missing_scope', status: 401 },
});

runStandardMatrix({
  label: 'srt_',
  family: 'srt',
  prefix: 'srt_',
  secret: SECRETS.srt,
  audience: 'seo-audit-roadmap',
  sub: 'sr_routeauth',
  requiredScope: 'read',
  fullScopes: ['read', 'roadmap-write'],
  noHeaderCode: { error: 'auth_missing', status: 401 },
  malformedCode: { error: 'auth_malformed', status: 401 },
  invalidTokenCode: { error: 'token_invalid', status: 401 },
  badSigCode: { error: 'token_invalid_signature', status: 401 },
  wrongSubCode: { error: 'token_wrong_roadmap_id', status: 401 },
  missingScopeCode: { error: 'token_missing_scope', status: 401 },
});

runStandardMatrix({
  label: 'krt_',
  family: 'krt',
  prefix: 'krt_',
  secret: SECRETS.krtKstCat,
  audience: 'keyword-strategy-memo',
  sub: 'kr_routeauth',
  requiredScope: 'read',
  fullScopes: ['read', 'memo-write'],
  noHeaderCode: { error: 'auth_missing', status: 401 },
  malformedCode: { error: 'auth_malformed', status: 401 },
  invalidTokenCode: { error: 'token_invalid', status: 401 },
  badSigCode: { error: 'token_invalid_signature', status: 401 },
  wrongSubCode: { error: 'token_wrong_memo_id', status: 401 },
  missingScopeCode: { error: 'token_missing_scope', status: 401 },
});

runStandardMatrix({
  label: 'kst_',
  family: 'kst',
  prefix: 'kst_',
  secret: SECRETS.krtKstCat,
  audience: 'keyword-strategy-client',
  sub: 'ks_routeauth',
  requiredScope: 'read',
  fullScopes: ['read', 'memo-write', 'volume-lookup'],
  noHeaderCode: { error: 'auth_missing', status: 401 },
  malformedCode: { error: 'auth_malformed', status: 401 },
  invalidTokenCode: { error: 'token_invalid', status: 401 },
  badSigCode: { error: 'token_invalid_signature', status: 401 },
  wrongSubCode: { error: 'token_wrong_session_id', status: 401 },
  missingScopeCode: { error: 'token_missing_scope', status: 401 },
});

runStandardMatrix({
  label: 'qct_ (no-header and malformed-header collapse into ONE code)',
  family: 'qct',
  prefix: 'qct_',
  secret: SECRETS.qct,
  audience: 'quarter-cycle-push',
  sub: '999999',
  requiredScope: 'read',
  fullScopes: ['read', 'receipt-write'],
  noHeaderCode: { error: 'auth_missing_or_malformed', status: 401 },
  malformedCode: { error: 'auth_missing_or_malformed', status: 401 },
  invalidTokenCode: { error: 'token_invalid', status: 401 },
  badSigCode: { error: 'token_invalid_signature', status: 401 },
  wrongSubCode: { error: 'token_wrong_plan_id', status: 401 },
  missingScopeCode: { error: 'token_missing_scope', status: 401 },
});

// ---------------------------------------------------------------------------
// cat_ — bearer-or-query transport, collapsed error codes (auth_required for
// every token-shape failure, insufficient_scope for every scope-shape one).
// ---------------------------------------------------------------------------
const CAT_SUB = 'sa_routeauth';
const CAT_AUD = 'content-audit-client';
const CAT_SCOPES = ['read', 'findings-write'];
const AUTH_REQUIRED = { error: 'auth_required', status: 401 };
const INSUFFICIENT_SCOPE = { error: 'insufficient_scope', status: 401 };

describe('cat_', () => {
  it('fails auth_required when Authorization is absent', async () => {
    const result = await requireHandoffToken(req(null), 'cat', CAT_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('fails auth_required on a non-Bearer scheme', async () => {
    const result = await requireHandoffToken(req('Basic dXNlcjpwYXNz'), 'cat', CAT_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('fails auth_required on a Bearer token with the wrong family prefix', async () => {
    const result = await requireHandoffToken(req('Bearer wrongfamily_notarealtoken'), 'cat', CAT_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('fails auth_required on a malformed JWT with the correct cat_ prefix', async () => {
    const result = await requireHandoffToken(req('Bearer cat_not-a-real-jwt'), 'cat', CAT_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('fails auth_required on a validly-signed token with the wrong issuer', async () => {
    const token = await forge({
      aud: CAT_AUD,
      sub: CAT_SUB,
      scope: CAT_SCOPES,
      secret: SECRETS.krtKstCat,
      prefix: 'cat_',
      iss: 'someone-else',
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', CAT_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('fails auth_required on an expired token', async () => {
    const token = await forge({
      aud: CAT_AUD,
      sub: CAT_SUB,
      scope: CAT_SCOPES,
      secret: SECRETS.krtKstCat,
      prefix: 'cat_',
      expSecondsFromNow: -10,
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', CAT_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('fails auth_required on a bad signature', async () => {
    const token = await forge({
      aud: CAT_AUD,
      sub: CAT_SUB,
      scope: CAT_SCOPES,
      secret: `${SECRETS.krtKstCat}-wrong`,
      prefix: 'cat_',
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', CAT_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('fails auth_required on a wrong-sub token', async () => {
    const token = await forge({
      aud: CAT_AUD,
      sub: `${CAT_SUB}-other`,
      scope: CAT_SCOPES,
      secret: SECRETS.krtKstCat,
      prefix: 'cat_',
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', CAT_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('fails insufficient_scope when the scope array lacks the required scope', async () => {
    const token = await forge({
      aud: CAT_AUD,
      sub: CAT_SUB,
      scope: CAT_SCOPES.filter((s) => s !== 'findings-write'),
      secret: SECRETS.krtKstCat,
      prefix: 'cat_',
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', CAT_SUB, 'findings-write');
    await expectFail(result, INSUFFICIENT_SCOPE);
  });

  it('fails insufficient_scope when the scope claim is a non-array value', async () => {
    const token = await forge({
      aud: CAT_AUD,
      sub: CAT_SUB,
      scope: 'read',
      secret: SECRETS.krtKstCat,
      prefix: 'cat_',
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', CAT_SUB, 'read');
    await expectFail(result, INSUFFICIENT_SCOPE);
  });

  it('fails insufficient_scope when the scope claim is absent entirely', async () => {
    const token = await forge({
      aud: CAT_AUD,
      sub: CAT_SUB,
      omitScope: true,
      secret: SECRETS.krtKstCat,
      prefix: 'cat_',
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', CAT_SUB, 'read');
    await expectFail(result, INSUFFICIENT_SCOPE);
  });

  it('succeeds with the verified payload on a fully valid token', async () => {
    const token = await forge({ aud: CAT_AUD, sub: CAT_SUB, scope: CAT_SCOPES, secret: SECRETS.krtKstCat, prefix: 'cat_' });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', CAT_SUB, 'read');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.payload.sub).toBe(CAT_SUB);
  });
});

// ---------------------------------------------------------------------------
// cat_ transport precedence (bearer-or-query) — mirrors Task 3's four cases
// in lib/handoff/cross-family-characterization.test.ts, exercised through
// requireHandoffToken instead of requireContentAuditToken directly.
// ---------------------------------------------------------------------------
function catQueryReq(query: string | null, authHeader: string | null): NextRequest {
  const base = 'http://localhost/api/content-audit/sa_routeauth-precedence/manifest';
  const url = query != null ? `${base}?token=${encodeURIComponent(query)}` : base;
  const headers: Record<string, string> = {};
  if (authHeader != null) headers.Authorization = authHeader;
  return new NextRequest(url, { headers });
}

describe('cat_ transport precedence (bearer-or-query)', () => {
  const PRECEDENCE_SUB = 'sa_routeauth-precedence';

  async function mintValidCatToken(): Promise<string> {
    return forge({ aud: CAT_AUD, sub: PRECEDENCE_SUB, scope: CAT_SCOPES, secret: SECRETS.krtKstCat, prefix: 'cat_' });
  }

  it('case 1: missing Authorization header + valid ?token= -> accepted (query fallback)', async () => {
    const token = await mintValidCatToken();
    const result = await requireHandoffToken(catQueryReq(token, null), 'cat', PRECEDENCE_SUB, 'read');
    expect(result.ok).toBe(true);
  });

  it('case 2: non-Bearer Authorization header + valid ?token= -> accepted (falls back to query)', async () => {
    const token = await mintValidCatToken();
    const result = await requireHandoffToken(catQueryReq(token, 'Basic dXNlcjpwYXNz'), 'cat', PRECEDENCE_SUB, 'read');
    expect(result.ok).toBe(true);
  });

  it("case 3: 'Bearer <invalid>' + valid ?token= -> 401 auth_required (header token extracted; an invalid Bearer NEVER falls back to query)", async () => {
    const token = await mintValidCatToken();
    const result = await requireHandoffToken(catQueryReq(token, 'Bearer cat_invalid'), 'cat', PRECEDENCE_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });

  it('case 4: missing header + no query -> 401 auth_required', async () => {
    const result = await requireHandoffToken(catQueryReq(null, null), 'cat', PRECEDENCE_SUB, 'read');
    await expectFail(result, AUTH_REQUIRED);
  });
});

// ---------------------------------------------------------------------------
// Verifier seam: requireHandoffToken must call the FACADE verify function
// (not re-derive verification from the registry/factory itself), and any
// throw that is NOT the family's own error class must fail closed to the
// verifierUnavailable policy.
// ---------------------------------------------------------------------------
describe('facade seam + fail-closed verifierUnavailable', () => {
  it('pat_: requireHandoffToken calls verifyPillarToken (the facade), not some other verification path', async () => {
    const token = await forge({
      aud: 'pillar-analysis-narrative',
      sub: 'pa_seam',
      scope: ['read', 'narrative-write'],
      secret: SECRETS.pat,
      prefix: 'pat_',
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'pat', 'pa_seam', 'read');
    expect(result.ok).toBe(true);
    expect(verifyPillarToken).toHaveBeenCalledWith(token, 'pa_seam');
  });

  it('pat_: a non-PillarTokenError throw from the facade maps to verifierUnavailable (500 token_service_unavailable), never a raw throw', async () => {
    vi.mocked(verifyPillarToken).mockRejectedValueOnce(new Error('boom: totally unrelated failure'));
    const result = await requireHandoffToken(req('Bearer pat_whatever'), 'pat', 'pa_seam', 'read');
    await expectFail(result, { error: 'token_service_unavailable', status: 500 });
  });

  it('cat_: requireHandoffToken calls verifyContentAuditToken (the facade)', async () => {
    const token = await forge({
      aud: CAT_AUD,
      sub: 'sa_seam',
      scope: CAT_SCOPES,
      secret: SECRETS.krtKstCat,
      prefix: 'cat_',
    });
    const result = await requireHandoffToken(req(`Bearer ${token}`), 'cat', 'sa_seam', 'read');
    expect(result.ok).toBe(true);
    expect(verifyContentAuditToken).toHaveBeenCalledWith(token, 'sa_seam');
  });

  it('cat_: a non-ContentAuditTokenError throw from the facade still maps to auth_required/401 (verifierUnavailable === tokenError for this family)', async () => {
    vi.mocked(verifyContentAuditToken).mockRejectedValueOnce(new Error('boom: totally unrelated failure'));
    const result = await requireHandoffToken(req('Bearer cat_whatever'), 'cat', 'sa_seam', 'read');
    await expectFail(result, AUTH_REQUIRED);
  });
});
