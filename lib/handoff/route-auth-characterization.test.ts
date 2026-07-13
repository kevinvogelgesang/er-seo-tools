// lib/handoff/route-auth-characterization.test.ts
//
// D1 frozen-wire net: the AUTH CHARACTERIZATION MATRIX for all 14 public
// token-authed routes across the six handoff families (pat_/srt_/krt_/kst_/
// cat_/qct_). A later PR centralizes this auth logic into one shared helper;
// this file is the regression net that PR must keep green, UNCHANGED. We are
// pinning CURRENT behavior, warts included — if a cell looks wrong, that is
// a separate decision for a human, not something this file may "fix".
//
// Scope discipline: every cell below is reachable WITHOUT any database row —
// in all six families, auth resolves fully before the route's first Prisma
// call (confirmed per-route by reading the source). DB-backed success /
// not-found / wrong-sub-with-a-real-row cases are already pinned by sibling
// route.test.ts files (see the "already covered" notes per family) and are
// deliberately NOT duplicated here.
//
// Per-family constants (code -> file:line), verified by direct source read:
//
// pat_ (pillar-analysis) — lib/pillar-token.ts, app/api/pillar-analysis/[id]/route.ts,
//   app/api/pillar-analysis/[id]/narrative/route.ts
//   issuer 'er-seo-tools' (pillar-token.ts:6), audience 'pillar-analysis-narrative' (pillar-token.ts:7)
//   secret env PILLAR_TOKEN_SECRET (pillar-token.ts:28)
//   GET requiredScope 'read' (route.ts:41); PATCH requiredScope 'narrative-write' (narrative/route.ts:8)
//   mint scope ['read','narrative-write'] (pillar-token.ts:57)
//   no-header -> auth_missing/401 (route.ts:14, narrative/route.ts:36)
//   non-bearer/wrong-prefix (regex /^Bearer\s+(pat_\S+)$/ fails) -> auth_malformed/401 (route.ts:16-18, narrative/route.ts:38-40)
//   malformed-jwt/wrong-iss/wrong-aud/expired -> generic token_invalid/401 (route.ts:26-37 tokenErrorCode fallthrough;
//     jose's real expiry message '"exp" claim timestamp check failed' does NOT contain 'expired', so an
//     actually-expired token maps to token_invalid, NOT token_expired -- pinned wart, not a bug to fix here)
//   bad-signature -> token_invalid_signature/401 (message contains 'signature')
//   wrong-sub -> token_wrong_analysis_id/401 (message contains 'does not match')
//   missing/non-array/absent scope -> token_missing_scope/401 (route.ts:40-43, Array.isArray guard)
//   body-before-auth (narrative PATCH parses body FIRST): narrative_required/invalid_json 400 beats a missing/absent
//     Authorization header (narrative/route.ts:19-31 precede the auth block at :34)
//   token_service_unavailable/500 is UNREACHABLE via the public routes: verifyPillarToken wraps every internal
//     throw (including a production-unset-secret) into PillarTokenError, so the routes' `else` 500 branch
//     (route.ts:36-37) is dead code from HTTP callers -- not pinned here, noted in the report.
//
// srt_ (seo-roadmap) — lib/seo-roadmap-token.ts, app/api/seo-roadmap/[id]/route.ts,
//   app/api/seo-roadmap/[id]/roadmap/route.ts
//   issuer 'er-seo-tools', audience 'seo-audit-roadmap' (seo-roadmap-token.ts:5-6), secret env SEO_ROADMAP_TOKEN_SECRET
//   GET requiredScope 'read'; PATCH requiredScope 'roadmap-write' (roadmap/route.ts:7); mint scope ['read','roadmap-write']
//   no-header -> auth_missing/401; non-bearer/wrong-prefix -> auth_malformed/401 (regex /^Bearer\s+(srt_\S+)$/)
//   malformed-jwt/wrong-iss/wrong-aud/expired -> token_invalid/401 (same jose-message wart as pat_)
//   bad-signature -> token_invalid_signature/401; wrong-sub -> token_wrong_roadmap_id/401
//   missing/non-array/absent scope -> token_missing_scope/401
//   body-before-auth (roadmap PATCH): roadmap_required/invalid_json 400 beats absent auth (roadmap/route.ts:24-46 precede :50)
//   token_service_unavailable/500 unreachable, same reasoning as pat_.
//
// krt_ (keyword-memo) — lib/keyword-memo-token.ts, app/api/keyword-memo/[id]/route.ts,
//   app/api/keyword-memo/[id]/memo/route.ts
//   issuer 'er-seo-tools', audience 'keyword-strategy-memo' (keyword-memo-token.ts:5-6), secret env KEYWORD_MEMO_TOKEN_SECRET
//   GET requiredScope 'read'; PATCH requiredScope 'memo-write' (memo/route.ts:7); mint scope ['read','memo-write']
//   no-header -> auth_missing/401; non-bearer/wrong-prefix -> auth_malformed/401 (regex /^Bearer\s+(krt_\S+)$/)
//   malformed-jwt/wrong-iss/wrong-aud/expired -> token_invalid/401 (same wart); bad-signature -> token_invalid_signature/401
//   wrong-sub -> token_wrong_memo_id/401; missing/non-array/absent scope -> token_missing_scope/401
//   body-before-auth (memo PATCH): memo_required/invalid_json 400 beats absent auth (memo/route.ts:24-46 precede :50)
//   token_service_unavailable/500 unreachable, same reasoning.
//
// kst_ (keyword-strategy) — lib/keyword-strategy-token.ts, lib/keyword-strategy-route-auth.ts,
//   app/api/keyword-strategy/[id]/route.ts, [id]/memo/route.ts, [id]/volumes/route.ts
//   issuer 'er-seo-tools', audience 'keyword-strategy-client' (keyword-strategy-token.ts:8-9)
//   secret env KEYWORD_MEMO_TOKEN_SECRET (deliberately shared with krt_/cat_ -- audience isolates)
//   GET requiredScope 'read'; PATCH memo requiredScope 'memo-write'; POST volumes requiredScope 'volume-lookup'
//     (keyword-strategy-route-auth.ts:18,50,61 call sites in each route); mint scope ['read','memo-write','volume-lookup']
//   no-header -> auth_missing/401; non-bearer/wrong-prefix -> auth_malformed/401 (regex /^Bearer\s+(kst_\S+)$/,
//     keyword-strategy-route-auth.ts:41-48)
//   malformed-jwt/wrong-iss/wrong-aud/expired -> token_invalid/401 (same wart, route-auth.ts:16-22)
//   bad-signature -> token_invalid_signature/401; wrong-sub -> token_wrong_session_id/401
//   missing/non-array/absent scope -> token_missing_scope/401 (route-auth.ts:66-69)
//   body-before-auth: memo PATCH memo_required/invalid_json 400 beats absent auth (memo/route.ts:26-51);
//     volumes POST idempotency_key_required/keywords_required 400 beats absent auth (volumes/route.ts:43-62).
//     Per the brief, volumes cells stop at the auth verdict -- the dark gate/reserve/billing path is untested here.
//   token_service_unavailable/500 unreachable, same reasoning.
//
// cat_ (content-audit) — lib/content-audit-token.ts, lib/content-audit/route-auth.ts,
//   app/api/content-audit/[siteAuditId]/manifest/route.ts, [siteAuditId]/page/route.ts,
//   [siteAuditId]/findings/route.ts
//   issuer 'er-seo-tools', audience 'content-audit-client' (content-audit-token.ts:8-9)
//   secret env KEYWORD_MEMO_TOKEN_SECRET (shared; audience is the isolation wall)
//   GET manifest / GET page requiredScope 'read'; PATCH findings requiredScope 'findings-write'
//     (manifest/route.ts:11, page/route.ts:11, findings/route.ts:28); mint scope ['read','findings-write']
//   requireContentAuditToken (route-auth.ts:18-32) COLLAPSES every token-shape failure -- missing token,
//     non-Bearer header, wrong/no prefix, malformed JWT, wrong iss, wrong aud, expired, bad signature, wrong
//     sub -- into ONE code: {error:'auth_required'}, 401 (route-auth.ts:20,24-26 bare catch, no message
//     inspection). Every scope-shape failure (missing/non-array/absent scope claim) collapses into
//     {error:'insufficient_scope'}, 401 (route-auth.ts:27-30). There is no token_service_unavailable path --
//     the helper never throws.
//   body-before-auth (findings PATCH): readBoundedText -> JSON.parse -> auth (findings/route.ts:23-29) --
//     invalid_json/400 or body_too_large/413 both beat absent auth.
//
// qct_ (quarter-plan push) — lib/quarter-push-token.ts, app/api/quarter-plan/push/[planId]/route.ts,
//   app/api/quarter-plan/push/[planId]/receipt/route.ts
//   issuer 'er-seo-tools', audience 'quarter-cycle-push' (quarter-push-token.ts:6-7), secret env QUARTER_PUSH_TOKEN_SECRET
//   GET requiredScope 'read'; POST receipt requiredScope 'receipt-write'; mint scope ['read','receipt-write']
//   no-header AND non-bearer/wrong-prefix BOTH -> the SAME code: auth_missing_or_malformed/401 (route.ts:17-22,34-35;
//     receipt/route.ts:27-29 -- bearerToken()/the inline match return null for either case, one check site)
//   malformed-jwt/wrong-iss/wrong-aud/expired -> token_invalid/401 (same wart, tokenErrorCode at route.ts:9-15 /
//     receipt/route.ts:7-13); bad-signature -> token_invalid_signature/401; wrong-sub -> token_wrong_plan_id/401
//   missing/non-array/absent scope -> token_missing_scope/401
//   body-before-auth is REVERSED here: receipt POST authenticates FIRST (receipt/route.ts:27-39), THEN parses the
//     body (:41-46) -- an absent/malformed Authorization header with a garbage body still yields 401
//     auth_missing_or_malformed, never the 400 JSON error.
//   token_service_unavailable/500 unreachable, same reasoning.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

import { GET as patGet } from '@/app/api/pillar-analysis/[id]/route';
import { PATCH as patPatch } from '@/app/api/pillar-analysis/[id]/narrative/route';
import { GET as srtGet } from '@/app/api/seo-roadmap/[id]/route';
import { PATCH as srtPatch } from '@/app/api/seo-roadmap/[id]/roadmap/route';
import { GET as krtGet } from '@/app/api/keyword-memo/[id]/route';
import { PATCH as krtPatch } from '@/app/api/keyword-memo/[id]/memo/route';
import { GET as kstGet } from '@/app/api/keyword-strategy/[id]/route';
import { PATCH as kstPatch } from '@/app/api/keyword-strategy/[id]/memo/route';
import { POST as kstVolumes } from '@/app/api/keyword-strategy/[id]/volumes/route';
import { GET as catManifest } from '@/app/api/content-audit/[siteAuditId]/manifest/route';
import { GET as catPage } from '@/app/api/content-audit/[siteAuditId]/page/route';
import { PATCH as catFindings } from '@/app/api/content-audit/[siteAuditId]/findings/route';
import { GET as qctExport } from '@/app/api/quarter-plan/push/[planId]/route';
import { POST as qctReceipt } from '@/app/api/quarter-plan/push/[planId]/receipt/route';

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
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

/** Hand-forged JWT builder — copies the pattern in
 * app/api/pillar-analysis/[id]/route.test.ts:69, extended with `iss` and a
 * scope escape hatch for the non-array / omitted-claim cells. */
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

function headers(authHeader: string | null): Record<string, string> {
  return authHeader === null ? {} : { Authorization: authHeader };
}

// ---------------------------------------------------------------------------
// Generic matrix runner for the five families whose auth wall is a
// `/^Bearer\s+(<prefix>_\S+)$/` regex + verify + Array.isArray-guarded scope
// check (pat_, srt_, krt_, kst_, qct_). cat_ is structurally different
// (collapsed codes) and gets its own runner below.
// ---------------------------------------------------------------------------
interface StandardFamilyConfig {
  label: string;
  prefix: string;
  secret: string;
  audience: string;
  sub: string;
  requiredScope: string;
  fullScopes: string[];
  invoke: (authHeader: string | null) => Promise<Response>;
  noHeaderCode: string;
  malformedCode: string; // non-bearer scheme / wrong family prefix
  invalidTokenCode: string; // malformed-jwt-correct-prefix / wrong-iss / wrong-aud / expired
  badSigCode: string;
  wrongSubCode: string;
  missingScopeCode: string;
}

function runStandardAuthMatrix(cfg: StandardFamilyConfig) {
  describe(cfg.label, () => {
    it('401 when Authorization header is absent', async () => {
      const res = await cfg.invoke(null);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.noHeaderCode });
    });

    it('401 on a non-Bearer auth scheme', async () => {
      const res = await cfg.invoke('Basic dXNlcjpwYXNz');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.malformedCode });
    });

    it('401 on a Bearer token with the wrong family prefix', async () => {
      const res = await cfg.invoke('Bearer wrongfamily_notarealtoken');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.malformedCode });
    });

    it('401 on a malformed JWT that still carries the correct prefix', async () => {
      const res = await cfg.invoke(`Bearer ${cfg.prefix}not-a-real-jwt`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.invalidTokenCode });
    });

    it('401 on a validly-signed token with the wrong issuer', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
        iss: 'someone-else',
      });
      const res = await cfg.invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.invalidTokenCode });
    });

    it('401 on a validly-signed token with the wrong audience', async () => {
      const token = await forge({
        aud: 'some-other-audience',
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const res = await cfg.invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.invalidTokenCode });
    });

    it('401 on an expired token (pinned wart: falls through to the generic invalid code, not an "expired" code)', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
        expSecondsFromNow: -10,
      });
      const res = await cfg.invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.invalidTokenCode });
    });

    it('401 on a bad signature (signed with a different secret)', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes,
        secret: `${cfg.secret}-wrong`,
        prefix: cfg.prefix,
      });
      const res = await cfg.invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.badSigCode });
    });

    it('401 on a token whose sub does not match the path id', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: `${cfg.sub}-other`,
        scope: cfg.fullScopes,
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const res = await cfg.invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.wrongSubCode });
    });

    it('401 when the scope array is present but lacks the required scope', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.fullScopes.filter((s) => s !== cfg.requiredScope),
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const res = await cfg.invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.missingScopeCode });
    });

    it('401 when the scope claim is a non-array value', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        scope: cfg.requiredScope, // a bare string, not an array
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const res = await cfg.invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.missingScopeCode });
    });

    it('401 when the scope claim is absent entirely', async () => {
      const token = await forge({
        aud: cfg.audience,
        sub: cfg.sub,
        omitScope: true,
        secret: cfg.secret,
        prefix: cfg.prefix,
      });
      const res = await cfg.invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: cfg.missingScopeCode });
    });
  });
}

// ---------------------------------------------------------------------------
// pat_ — pillar-analysis
// ---------------------------------------------------------------------------
const PAT_SUB = 'pa_charmatrix';
const PAT_AUD = 'pillar-analysis-narrative';
const PAT_SCOPES = ['read', 'narrative-write'];

function patGetReq(authHeader: string | null) {
  return patGet(
    new NextRequest('http://localhost/api/pillar-analysis/x', { headers: headers(authHeader) }),
    { params: Promise.resolve({ id: PAT_SUB }) },
  );
}
function patPatchReq(authHeader: string | null, body: unknown = { narrative: 'ok' }) {
  return patPatch(
    new NextRequest('http://localhost/api/pillar-analysis/x/narrative', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(authHeader) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: PAT_SUB }) },
  );
}

runStandardAuthMatrix({
  label: 'pat_ GET /api/pillar-analysis/[id] (new cells only — auth_missing/token_missing_scope/success already pinned by route.test.ts)',
  prefix: 'pat_',
  secret: SECRETS.pat,
  audience: PAT_AUD,
  sub: PAT_SUB,
  requiredScope: 'read',
  fullScopes: PAT_SCOPES,
  invoke: patGetReq,
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_analysis_id',
  missingScopeCode: 'token_missing_scope',
});

runStandardAuthMatrix({
  label:
    'pat_ PATCH /api/pillar-analysis/[id]/narrative (new cells only — invalid_json/narrative_required/narrative_too_long/auth_missing/auth_malformed/token_wrong_analysis_id/token_missing_scope/not_found/success already pinned by narrative/route.test.ts)',
  prefix: 'pat_',
  secret: SECRETS.pat,
  audience: PAT_AUD,
  sub: PAT_SUB,
  requiredScope: 'narrative-write',
  fullScopes: PAT_SCOPES,
  invoke: (authHeader) => patPatchReq(authHeader),
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_analysis_id',
  missingScopeCode: 'token_missing_scope',
});

describe('pat_ PATCH narrative — body-before-auth ordering', () => {
  it('400 narrative_required beats a completely absent Authorization header', async () => {
    const res = await patPatchReq(null, { otherField: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'narrative_required' });
  });

  it('400 invalid_json beats a completely absent Authorization header', async () => {
    const res = await patPatch(
      new NextRequest('http://localhost/api/pillar-analysis/x/narrative', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      { params: Promise.resolve({ id: PAT_SUB }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });
});

// ---------------------------------------------------------------------------
// srt_ — seo-roadmap
// ---------------------------------------------------------------------------
const SRT_SUB = 'sr_charmatrix';
const SRT_AUD = 'seo-audit-roadmap';
const SRT_SCOPES = ['read', 'roadmap-write'];

function srtGetReq(authHeader: string | null) {
  return srtGet(
    new NextRequest('http://localhost/api/seo-roadmap/x', { headers: headers(authHeader) }),
    { params: Promise.resolve({ id: SRT_SUB }) },
  );
}
function srtPatchReq(authHeader: string | null, body: unknown = { roadmap: 'ok' }) {
  return srtPatch(
    new NextRequest('http://localhost/api/seo-roadmap/x/roadmap', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(authHeader) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: SRT_SUB }) },
  );
}

runStandardAuthMatrix({
  label:
    'srt_ GET /api/seo-roadmap/[id] (new cells only — auth_missing/non-bearer/wrong-prefix/malformed-jwt/wrong-sub/missing-scope/success already pinned by route.test.ts, this file adds wrong-iss/wrong-aud/expired/bad-sig/non-array-scope/absent-scope)',
  prefix: 'srt_',
  secret: SECRETS.srt,
  audience: SRT_AUD,
  sub: SRT_SUB,
  requiredScope: 'read',
  fullScopes: SRT_SCOPES,
  invoke: srtGetReq,
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_roadmap_id',
  missingScopeCode: 'token_missing_scope',
});

runStandardAuthMatrix({
  label:
    'srt_ PATCH /api/seo-roadmap/[id]/roadmap (new cells only — body-shape/auth_missing/auth_malformed/wrong-sub/missing-scope/not_found/success already pinned by roadmap/route.test.ts)',
  prefix: 'srt_',
  secret: SECRETS.srt,
  audience: SRT_AUD,
  sub: SRT_SUB,
  requiredScope: 'roadmap-write',
  fullScopes: SRT_SCOPES,
  invoke: (authHeader) => srtPatchReq(authHeader),
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_roadmap_id',
  missingScopeCode: 'token_missing_scope',
});

describe('srt_ PATCH roadmap — body-before-auth ordering', () => {
  it('400 roadmap_required beats a completely absent Authorization header', async () => {
    const res = await srtPatchReq(null, { otherField: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'roadmap_required' });
  });
});

// ---------------------------------------------------------------------------
// krt_ — keyword-memo
// ---------------------------------------------------------------------------
const KRT_SUB = 'kr_charmatrix';
const KRT_AUD = 'keyword-strategy-memo';
const KRT_SCOPES = ['read', 'memo-write'];

function krtGetReq(authHeader: string | null) {
  return krtGet(
    new NextRequest('http://localhost/api/keyword-memo/x', { headers: headers(authHeader) }),
    { params: Promise.resolve({ id: KRT_SUB }) },
  );
}
function krtPatchReq(authHeader: string | null, body: unknown = { memo: 'ok' }) {
  return krtPatch(
    new NextRequest('http://localhost/api/keyword-memo/x/memo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(authHeader) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: KRT_SUB }) },
  );
}

runStandardAuthMatrix({
  label:
    'krt_ GET /api/keyword-memo/[id] (new cells only — auth_missing/non-bearer/wrong-prefix/malformed-jwt/wrong-sub/missing-scope/success already pinned by route.test.ts)',
  prefix: 'krt_',
  secret: SECRETS.krtKstCat,
  audience: KRT_AUD,
  sub: KRT_SUB,
  requiredScope: 'read',
  fullScopes: KRT_SCOPES,
  invoke: krtGetReq,
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_memo_id',
  missingScopeCode: 'token_missing_scope',
});

runStandardAuthMatrix({
  label:
    'krt_ PATCH /api/keyword-memo/[id]/memo (new cells only — body-shape/auth_missing/auth_malformed/wrong-sub/missing-scope/not_found/success already pinned by memo/route.test.ts)',
  prefix: 'krt_',
  secret: SECRETS.krtKstCat,
  audience: KRT_AUD,
  sub: KRT_SUB,
  requiredScope: 'memo-write',
  fullScopes: KRT_SCOPES,
  invoke: (authHeader) => krtPatchReq(authHeader),
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_memo_id',
  missingScopeCode: 'token_missing_scope',
});

describe('krt_ PATCH memo — body-before-auth ordering', () => {
  it('400 memo_required beats a completely absent Authorization header', async () => {
    const res = await krtPatchReq(null, { otherField: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'memo_required' });
  });
});

// ---------------------------------------------------------------------------
// kst_ — keyword-strategy
// ---------------------------------------------------------------------------
const KST_SUB = 'ks_charmatrix';
const KST_AUD = 'keyword-strategy-client';
const KST_SCOPES = ['read', 'memo-write', 'volume-lookup'];

function kstGetReq(authHeader: string | null) {
  return kstGet(
    new NextRequest('http://localhost/api/keyword-strategy/x', { headers: headers(authHeader) }),
    { params: Promise.resolve({ id: KST_SUB }) },
  );
}
function kstPatchReq(authHeader: string | null, body: unknown = { memo: 'ok' }) {
  return kstPatch(
    new NextRequest('http://localhost/api/keyword-strategy/x/memo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(authHeader) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: KST_SUB }) },
  );
}
function kstVolumesReq(
  authHeader: string | null,
  body: unknown = { idempotencyKey: 'char-matrix-key', keywords: ['test keyword'] },
) {
  return kstVolumes(
    new NextRequest('http://localhost/api/keyword-strategy/x/volumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers(authHeader) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: KST_SUB }) },
  );
}

runStandardAuthMatrix({
  label:
    'kst_ GET /api/keyword-strategy/[id] (new cells only — auth_missing/non-bearer/wrong-prefix/expired/wrong-sub/missing-scope/success already pinned by route.test.ts)',
  prefix: 'kst_',
  secret: SECRETS.krtKstCat,
  audience: KST_AUD,
  sub: KST_SUB,
  requiredScope: 'read',
  fullScopes: KST_SCOPES,
  invoke: kstGetReq,
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_session_id',
  missingScopeCode: 'token_missing_scope',
});

runStandardAuthMatrix({
  label:
    'kst_ PATCH /api/keyword-strategy/[id]/memo (new cells only — body-shape/auth_missing/auth_malformed/missing-scope/success already pinned by memo/route.test.ts)',
  prefix: 'kst_',
  secret: SECRETS.krtKstCat,
  audience: KST_AUD,
  sub: KST_SUB,
  requiredScope: 'memo-write',
  fullScopes: KST_SCOPES,
  invoke: (authHeader) => kstPatchReq(authHeader),
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_session_id',
  missingScopeCode: 'token_missing_scope',
});

runStandardAuthMatrix({
  label:
    'kst_ POST /api/keyword-strategy/[id]/volumes (auth cells ONLY — per the brief, the dark-gate/reserve/billing path past auth is out of scope; body-shape/auth_missing/auth_malformed/missing-scope already pinned by volumes/route.test.ts)',
  prefix: 'kst_',
  secret: SECRETS.krtKstCat,
  audience: KST_AUD,
  sub: KST_SUB,
  requiredScope: 'volume-lookup',
  fullScopes: KST_SCOPES,
  invoke: (authHeader) => kstVolumesReq(authHeader),
  noHeaderCode: 'auth_missing',
  malformedCode: 'auth_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_session_id',
  missingScopeCode: 'token_missing_scope',
});

describe('kst_ — body-before-auth ordering', () => {
  it('memo PATCH: 400 memo_required beats a completely absent Authorization header', async () => {
    const res = await kstPatchReq(null, { otherField: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'memo_required' });
  });

  it('volumes POST: 400 idempotency_key_required beats a completely absent Authorization header', async () => {
    const res = await kstVolumesReq(null, { keywords: ['x'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'idempotency_key_required' });
  });
});

// ---------------------------------------------------------------------------
// cat_ — content-audit (structurally different: collapsed codes)
// ---------------------------------------------------------------------------
const CAT_SUB = 'sa_charmatrix';
const CAT_AUD = 'content-audit-client';
const CAT_SCOPES = ['read', 'findings-write'];
const AUTH_REQUIRED = { error: 'auth_required' };
const INSUFFICIENT_SCOPE = { error: 'insufficient_scope' };

function catManifestReq(authHeader: string | null) {
  return catManifest(
    new NextRequest('http://localhost/api/content-audit/x/manifest', { headers: headers(authHeader) }),
    { params: Promise.resolve({ siteAuditId: CAT_SUB }) },
  );
}
function catPageReq(authHeader: string | null) {
  // auth runs before the ?url= check, so this never needs a real url param.
  return catPage(
    new NextRequest('http://localhost/api/content-audit/x/page', { headers: headers(authHeader) }),
    { params: Promise.resolve({ siteAuditId: CAT_SUB }) },
  );
}
function catFindingsReq(authHeader: string | null, body: unknown = { findings: [] }) {
  return catFindings(
    new NextRequest('http://localhost/api/content-audit/x/findings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(authHeader) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ siteAuditId: CAT_SUB }) },
  );
}

function runContentAuditAuthCells(label: string, invoke: (authHeader: string | null) => Promise<Response>, requiredScope: string) {
  describe(label, () => {
    it('401 auth_required when Authorization is absent', async () => {
      const res = await invoke(null);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(AUTH_REQUIRED);
    });

    it('401 auth_required on a non-Bearer auth scheme', async () => {
      const res = await invoke('Basic dXNlcjpwYXNz');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(AUTH_REQUIRED);
    });

    it('401 auth_required on a Bearer token with the wrong family prefix', async () => {
      const res = await invoke('Bearer wrongfamily_notarealtoken');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(AUTH_REQUIRED);
    });

    it('401 auth_required on a malformed JWT with the correct cat_ prefix', async () => {
      const res = await invoke('Bearer cat_not-a-real-jwt');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(AUTH_REQUIRED);
    });

    it('401 auth_required on a validly-signed token with the wrong issuer', async () => {
      const token = await forge({
        aud: CAT_AUD,
        sub: CAT_SUB,
        scope: CAT_SCOPES,
        secret: SECRETS.krtKstCat,
        prefix: 'cat_',
        iss: 'someone-else',
      });
      const res = await invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(AUTH_REQUIRED);
    });

    it('401 auth_required on a validly-signed token with the wrong audience', async () => {
      const token = await forge({
        aud: 'some-other-audience',
        sub: CAT_SUB,
        scope: CAT_SCOPES,
        secret: SECRETS.krtKstCat,
        prefix: 'cat_',
      });
      const res = await invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(AUTH_REQUIRED);
    });

    it('401 auth_required on an expired token', async () => {
      const token = await forge({
        aud: CAT_AUD,
        sub: CAT_SUB,
        scope: CAT_SCOPES,
        secret: SECRETS.krtKstCat,
        prefix: 'cat_',
        expSecondsFromNow: -10,
      });
      const res = await invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(AUTH_REQUIRED);
    });

    it('401 auth_required on a bad signature (signed with a different secret)', async () => {
      const token = await forge({
        aud: CAT_AUD,
        sub: CAT_SUB,
        scope: CAT_SCOPES,
        secret: `${SECRETS.krtKstCat}-wrong`,
        prefix: 'cat_',
      });
      const res = await invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(AUTH_REQUIRED);
    });

    it('401 insufficient_scope when the scope array is present but lacks the required scope', async () => {
      const token = await forge({
        aud: CAT_AUD,
        sub: CAT_SUB,
        scope: CAT_SCOPES.filter((s) => s !== requiredScope),
        secret: SECRETS.krtKstCat,
        prefix: 'cat_',
      });
      const res = await invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(INSUFFICIENT_SCOPE);
    });

    it('401 insufficient_scope when the scope claim is a non-array value', async () => {
      const token = await forge({
        aud: CAT_AUD,
        sub: CAT_SUB,
        scope: requiredScope,
        secret: SECRETS.krtKstCat,
        prefix: 'cat_',
      });
      const res = await invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(INSUFFICIENT_SCOPE);
    });

    it('401 insufficient_scope when the scope claim is absent entirely', async () => {
      const token = await forge({
        aud: CAT_AUD,
        sub: CAT_SUB,
        omitScope: true,
        secret: SECRETS.krtKstCat,
        prefix: 'cat_',
      });
      const res = await invoke(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(INSUFFICIENT_SCOPE);
    });
  });
}

// Note: manifest/route.test.ts and findings/route.test.ts already pin
// "missing token -> 401" and "wrong-sub token -> 401" (both via the same
// collapsed auth_required code) plus a 410/409/200-with-real-fixture set of
// DB-shape cases; this section adds the remaining token-shape and
// scope-shape cells (wrong-iss/wrong-aud/expired/bad-sig/non-bearer/
// wrong-prefix/malformed-jwt/insufficient_scope variants), none of which
// need a database row since requireContentAuditToken never touches Prisma.
runContentAuditAuthCells('cat_ GET /api/content-audit/[siteAuditId]/manifest', catManifestReq, 'read');
runContentAuditAuthCells('cat_ GET /api/content-audit/[siteAuditId]/page', catPageReq, 'read');
runContentAuditAuthCells('cat_ PATCH /api/content-audit/[siteAuditId]/findings', (h) => catFindingsReq(h), 'findings-write');

describe('cat_ PATCH findings — body-before-auth ordering', () => {
  it('400 invalid_json beats a completely absent Authorization header (body is read+parsed before auth)', async () => {
    const res = await catFindings(
      new NextRequest('http://localhost/api/content-audit/x/findings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      { params: Promise.resolve({ siteAuditId: CAT_SUB }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });
});

// ---------------------------------------------------------------------------
// qct_ — quarter-plan push
// ---------------------------------------------------------------------------
const QCT_SUB = '424242';
const QCT_AUD = 'quarter-cycle-push';
const QCT_SCOPES = ['read', 'receipt-write'];

function qctExportReq(authHeader: string | null) {
  return qctExport(
    new NextRequest('http://localhost/api/quarter-plan/push/424242', { headers: headers(authHeader) }),
    { params: Promise.resolve({ planId: QCT_SUB }) },
  );
}
function qctReceiptReq(authHeader: string | null, body: unknown = { created: 1 }) {
  return qctReceipt(
    new NextRequest('http://localhost/api/quarter-plan/push/424242/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers(authHeader) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ planId: QCT_SUB }) },
  );
}

runStandardAuthMatrix({
  label:
    'qct_ GET /api/quarter-plan/push/[planId] (new cells only — auth_missing_or_malformed/token_invalid_signature/token_wrong_plan_id/token_missing_scope/success already pinned by app/api/quarter-plan/route.test.ts "quarter push routes (B5)")',
  prefix: 'qct_',
  secret: SECRETS.qct,
  audience: QCT_AUD,
  sub: QCT_SUB,
  requiredScope: 'read',
  fullScopes: QCT_SCOPES,
  invoke: qctExportReq,
  noHeaderCode: 'auth_missing_or_malformed',
  malformedCode: 'auth_missing_or_malformed', // no-header and malformed-header share one code for this family
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_plan_id',
  missingScopeCode: 'token_missing_scope',
});

runStandardAuthMatrix({
  label:
    'qct_ POST /api/quarter-plan/push/[planId]/receipt (new cells only — auth_missing_or_malformed/token_invalid_signature/token_wrong_plan_id/token_missing_scope/success already pinned by app/api/quarter-plan/route.test.ts "quarter push routes (B5)")',
  prefix: 'qct_',
  secret: SECRETS.qct,
  audience: QCT_AUD,
  sub: QCT_SUB,
  requiredScope: 'receipt-write',
  fullScopes: QCT_SCOPES,
  invoke: (authHeader) => qctReceiptReq(authHeader),
  noHeaderCode: 'auth_missing_or_malformed',
  malformedCode: 'auth_missing_or_malformed',
  invalidTokenCode: 'token_invalid',
  badSigCode: 'token_invalid_signature',
  wrongSubCode: 'token_wrong_plan_id',
  missingScopeCode: 'token_missing_scope',
});

describe('qct_ receipt — auth-before-body ordering (the ONE family that authenticates FIRST)', () => {
  it('401 auth_missing_or_malformed on a garbage body with no Authorization header — never the 400 JSON error', async () => {
    const res = await qctReceipt(
      new NextRequest('http://localhost/api/quarter-plan/push/424242/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all{{{',
      }),
      { params: Promise.resolve({ planId: QCT_SUB }) },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'auth_missing_or_malformed' });
  });
});
