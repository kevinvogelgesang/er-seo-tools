# C12 Increment D1 — `cat_` content-audit handoff bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-billing skill-handoff bridge that lets an external Claude session audit a completed site audit's page content and PATCH typed findings back, proving the schema a future Anthropic-API job would reuse.

**Architecture:** New `cat_` stateless-JWT token family (audience-isolated, shares `KEYWORD_MEMO_TOKEN_SECRET`). The live-scan builder stops deleting `HarvestedPageSeo` and stamps a mint-extendable `contentAuditRetainUntil`; a sweep DELETEs rows at expiry. Three public token routes (manifest / page / findings) + two cookie-gated routes (mint / poll). Ingested findings land as measurement-first JSON on the live-scan `CrawlRun.contentAuditJson` — no `Finding` promotion, no score change.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, `jose` JWT, vitest, Tailwind (class-based dark mode).

**Spec:** `docs/superpowers/specs/2026-07-11-c12-cat-content-audit-bridge-design.md` (Codex-reviewed, ACCEPT WITH NAMED FIXES applied).

## Global Constraints

- **NO AI API** — this app never calls an LLM API; analysis happens in an external flat-rate Claude seat. (CLAUDE.md standing gate.)
- **No new prod env var** — the token shares `KEYWORD_MEMO_TOKEN_SECRET`; the distinct audience `content-audit-client` is the isolation wall.
- **Array-form `$transaction([...])` / tagged `$executeRaw` only** — never interactive `$transaction(async tx => …)`. Raw SQL sets `updatedAt` manually (`Date.now()` ms) — but `HarvestedPageSeo` has **no `updatedAt` column**, so its sweep is a DELETE with no timestamp write.
- **Measurement-first** — `contentAuditJson` is run-metadata JSON, never a `Finding`, never a score input.
- **Every public/token route** needs an anchored single-segment `middleware.ts` `isPublicPath` entry + a `middleware.test.ts` case. Never a `/api/content-audit/` prefix.
- **Share view unchanged** — the card is authed-results-only, like `ContentSignalsSection`/`TopicOverlapSection`.
- **Gates before PR:** `npx tsc --noEmit`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build` — all green.
- **Never `git add -A`/`-u` at repo root** — `pentest-results/`, `.playwright-mcp/` deletions, and `skills/er-handoff-memo` edits are untracked/pre-existing. Add explicit paths only.
- **Migrations** are hand-authored (`migrate dev` is interactive-only here); apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`.

---

## File Structure

**Create:**
- `prisma/migrations/20260713000000_content_audit_bridge/migration.sql` — additive columns.
- `lib/content-audit-token.ts` — `cat_` JWT sign/verify (clone of `lib/keyword-strategy-token.ts`).
- `lib/content-audit/ingest-schema.ts` — pure findings validator + caps.
- `lib/content-audit/route-auth.ts` — shared `requireContentAuditToken` fail-closed helper.
- `lib/content-audit/manifest.ts` — pure/server manifest + page loaders (shared by the public routes and the cookie-gated poll).
- `lib/content-audit-prompt.ts` — clipboard payload builder (clone of `lib/keyword-strategy-prompt.ts`).
- `app/api/site-audit/[id]/content-audit/mint-token/route.ts` — cookie-gated mint.
- `app/api/site-audit/[id]/content-audit/route.ts` — cookie-gated poll (GET).
- `app/api/content-audit/[siteAuditId]/manifest/route.ts` — `cat_` read.
- `app/api/content-audit/[siteAuditId]/page/route.ts` — `cat_` read.
- `app/api/content-audit/[siteAuditId]/findings/route.ts` — `cat_` findings-write PATCH.
- `components/site-audit/ContentAuditCard.tsx` — client component (mint + poll + render).
- Tests colocated with each of the above.

**Modify:**
- `prisma/schema.prisma` — `SiteAudit.contentAuditRetainUntil`, `CrawlRun.contentAuditJson`.
- `lib/findings/types.ts` — add `contentAuditJson` to `CrawlRunInput`.
- `lib/jobs/handlers/broken-link-verify.ts:~657-658` — stamp before write, stop deleting `HarvestedPageSeo`.
- `lib/findings/retention.ts` — add `sweepExpiredContentAudit`.
- `lib/cleanup.ts` — wire `sweepExpiredContentAudit` into `runCleanup`.
- `lib/jobs/handlers/stale-audit-reset.ts` — call `sweepExpiredContentAudit`.
- `middleware.ts` — 3 public matchers.
- `middleware.test.ts` — positive + negative cases.
- `app/(app)/ada-audit/site/[id]/page.tsx:~276-293` — add `<ContentAuditCard>` to `seoContent`.
- `~/.claude/skills/er-handoff-memo/**` — `cat_` branch + references doc.

**Interfaces locked across tasks:**
- Token: `mintContentAuditToken(siteAuditId: string): Promise<{token: string; expiresAt: string}>`; `verifyContentAuditToken(token: string, expectedSiteAuditId: string): Promise<JWTPayload>`; `CONTENT_AUDIT_TOKEN_SCOPES = ['read','findings-write'] as const`; `class ContentAuditTokenError extends Error`.
- Ingest: `type ContentAuditFinding`, `type ContentAuditPayload = {v:1; generatedAt:string; findings: ContentAuditFinding[]}`; `validateContentAuditFindings(input: unknown, allowedUrls: Set<string>): {ok:true; payload: ContentAuditPayload} | {ok:false; code:string}`.
- Route-auth: `requireContentAuditToken(req: NextRequest, siteAuditId: string, scope: 'read'|'findings-write'): Promise<{ok:true; payload:JWTPayload} | {ok:false; res: Response}>`.
- Manifest loader: `loadContentAuditManifest(siteAuditId: string, now: Date): Promise<ContentAuditManifest | null>`; `loadContentAuditPageText(siteAuditId: string, url: string, now: Date): Promise<{url:string; contentText:string; contentTruncated:boolean} | {status:404|410}>`; `type ContentAuditEligiblePage = {url:string; title:string|null; wordCount:number|null; contentAvailable:boolean}`.
- Retention: `sweepExpiredContentAudit(now?: Date): Promise<void>`.

---

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (models `SiteAudit`, `CrawlRun`)
- Create: `prisma/migrations/20260713000000_content_audit_bridge/migration.sql`
- Modify: `lib/findings/types.ts` (`CrawlRunInput`)

**Interfaces:**
- Produces: `SiteAudit.contentAuditRetainUntil: DateTime?`, `CrawlRun.contentAuditJson: String?`, `CrawlRunInput.contentAuditJson?: string | null`.

- [ ] **Step 1: Add the columns to the schema**

In `prisma/schema.prisma`, add to `model SiteAudit` (near the other nullable scalars):
```prisma
  contentAuditRetainUntil DateTime?
```
Add to `model CrawlRun` (near `topicOverlapJson`):
```prisma
  contentAuditJson String?
```

- [ ] **Step 2: Hand-author the migration**

Create `prisma/migrations/20260713000000_content_audit_bridge/migration.sql`:
```sql
-- C12 D1: mint-extendable contentText retention + measurement-first content-audit findings.
ALTER TABLE "SiteAudit" ADD COLUMN "contentAuditRetainUntil" DATETIME;
ALTER TABLE "CrawlRun" ADD COLUMN "contentAuditJson" TEXT;
-- Codex plan #1: the every-10-min sweep filters on this column; index it.
CREATE INDEX "SiteAudit_contentAuditRetainUntil_idx" ON "SiteAudit"("contentAuditRetainUntil");
```
Also add the matching index directive to `model SiteAudit` in `prisma/schema.prisma`:
```prisma
  @@index([contentAuditRetainUntil])
```

- [ ] **Step 3: Apply + regenerate**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: "1 migration applied", client regenerated, no errors.

- [ ] **Step 4: Add the writer input field**

In `lib/findings/types.ts`, add to the `CrawlRunInput` interface (alongside `topicOverlapJson`):
```ts
  contentAuditJson?: string | null
```
(No writer change — `writer.ts` spreads `{...run}`; the column is written by the PATCH route, not the builder, but keeping the input field consistent avoids a type gap if a future builder ever sets it.)

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260713000000_content_audit_bridge lib/findings/types.ts
git commit -m "feat(c12): schema — contentAuditRetainUntil + CrawlRun.contentAuditJson"
```

---

### Task 2: `cat_` token module

**Files:**
- Create: `lib/content-audit-token.ts`
- Test: `lib/content-audit-token.test.ts`

**Interfaces:**
- Consumes: `KEYWORD_MEMO_TOKEN_SECRET` env; `jose`.
- Produces: `mintContentAuditToken`, `verifyContentAuditToken`, `CONTENT_AUDIT_TOKEN_SCOPES`, `ContentAuditTokenError`, `CONTENT_AUDIT_TOKEN_TTL_MS`.

- [ ] **Step 1: Write the failing test**

Create `lib/content-audit-token.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  mintContentAuditToken, verifyContentAuditToken, ContentAuditTokenError,
} from './content-audit-token'
import { verifyKeywordStrategyToken } from './keyword-strategy-token'

describe('content-audit-token', () => {
  it('round-trips a cat_ token bound to a siteAuditId', async () => {
    const { token, expiresAt } = await mintContentAuditToken('audit_123')
    expect(token.startsWith('cat_')).toBe(true)
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())
    const payload = await verifyContentAuditToken(token, 'audit_123')
    expect(payload.sub).toBe('audit_123')
    expect(payload.scope).toEqual(['read', 'findings-write'])
  })

  it('rejects a token without the cat_ prefix', async () => {
    await expect(verifyContentAuditToken('kst_abc', 'audit_123'))
      .rejects.toThrow(ContentAuditTokenError)
  })

  it('rejects a sub mismatch', async () => {
    const { token } = await mintContentAuditToken('audit_123')
    await expect(verifyContentAuditToken(token, 'audit_999'))
      .rejects.toThrow(ContentAuditTokenError)
  })

  it('is audience-isolated from kst_ (cross-family JWT rejected both ways)', async () => {
    const { token } = await mintContentAuditToken('audit_123')
    // a cat_ token must NOT verify as kst_
    await expect(verifyKeywordStrategyToken(token, 'audit_123')).rejects.toThrow()
    // a kst_ body re-prefixed cat_ must NOT verify as cat_
    const { token: kst } = await import('./keyword-strategy-token')
      .then((m) => m.mintKeywordStrategyToken('audit_123'))
    const forged = 'cat_' + kst.slice('kst_'.length)
    await expect(verifyContentAuditToken(forged, 'audit_123')).rejects.toThrow(ContentAuditTokenError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/content-audit-token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module (clone of keyword-strategy-token.ts)**

Create `lib/content-audit-token.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/content-audit-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-audit-token.ts lib/content-audit-token.test.ts
git commit -m "feat(c12): cat_ token module (audience-isolated, shared secret)"
```

---

### Task 3: Ingest-schema validator (pure)

**Files:**
- Create: `lib/content-audit/ingest-schema.ts`
- Test: `lib/content-audit/ingest-schema.test.ts`

**Interfaces:**
- Produces: `ContentAuditFinding`, `ContentAuditPayload`, `validateContentAuditFindings(input: unknown, allowedUrls: Set<string>, now: Date): {ok:true; payload: ContentAuditPayload} | {ok:false; code: string}`. Caps: `MAX_FINDINGS=200`, `MAX_EVIDENCE=20`, `MAX_STRING=2000`, `MAX_TOTAL_BYTES=262144`.
- Consumes: `normalizeFindingUrl` from `@/lib/findings/normalize-url`.

- [ ] **Step 1: Write the failing test**

Create `lib/content-audit/ingest-schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateContentAuditFindings } from './ingest-schema'

const NOW = new Date('2026-07-13T00:00:00Z')
const allowed = new Set(['https://ex.com/a', 'https://ex.com/b'])
const good = {
  findings: [{
    type: 'data_inconsistency', severity: 'warning',
    title: 'Tuition differs', detail: 'A says $14,500; B says $15,200',
    evidence: [{ url: 'https://ex.com/a', snippet: '$14,500' }, { url: 'https://ex.com/b', snippet: '$15,200' }],
    recommendation: 'Reconcile to one figure',
  }],
}

describe('validateContentAuditFindings', () => {
  it('accepts a well-formed payload and stamps v + server generatedAt', () => {
    const r = validateContentAuditFindings(good, allowed, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.v).toBe(1)
      expect(r.payload.generatedAt).toBe(NOW.toISOString())
      expect(r.payload.findings[0].type).toBe('data_inconsistency')
    }
  })
  it('rejects an unknown type', () => {
    const r = validateContentAuditFindings({ findings: [{ ...good.findings[0], type: 'made_up' }] }, allowed, NOW)
    expect(r).toEqual({ ok: false, code: 'invalid_findings' })
  })
  it('rejects an unknown severity', () => {
    const r = validateContentAuditFindings({ findings: [{ ...good.findings[0], severity: 'urgent' }] }, allowed, NOW)
    expect(r).toEqual({ ok: false, code: 'invalid_findings' })
  })
  it('rejects an evidence url not in the audit page set', () => {
    const r = validateContentAuditFindings(
      { findings: [{ ...good.findings[0], evidence: [{ url: 'https://evil.com/x', snippet: 'y' }] }] },
      allowed, NOW)
    expect(r).toEqual({ ok: false, code: 'evidence_url_not_in_audit' })
  })
  it('rejects more than MAX_FINDINGS', () => {
    const many = { findings: Array.from({ length: 201 }, () => good.findings[0]) }
    expect(validateContentAuditFindings(many, allowed, NOW)).toEqual({ ok: false, code: 'invalid_findings' })
  })
  it('rejects a payload over the aggregate byte cap', () => {
    const big = { findings: [{ ...good.findings[0], detail: 'x'.repeat(1999) }] }
    // 200 findings * ~2k each would exceed 256k; force it via many findings each near cap
    const huge = { findings: Array.from({ length: 200 }, () => big.findings[0]) }
    expect(validateContentAuditFindings(huge, allowed, NOW)).toEqual({ ok: false, code: 'findings_too_large' })
  })
  it('normalizes evidence urls before the allowlist check', () => {
    const r = validateContentAuditFindings(
      { findings: [{ ...good.findings[0], evidence: [{ url: 'https://ex.com/a#frag', snippet: 'z' }] }] },
      allowed, NOW)
    expect(r.ok).toBe(true) // normalizeFindingUrl strips the fragment to match /a
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/content-audit/ingest-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the validator**

Create `lib/content-audit/ingest-schema.ts`:
```ts
// lib/content-audit/ingest-schema.ts
// Pure strict validator for cat_ PATCH-ingested content-audit findings.
// Enforces type/severity enums, per-field caps, an aggregate serialized-byte
// cap, and evidence-URL membership in the audit's eligible page set. Reject,
// never truncate.
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

export const CONTENT_AUDIT_FINDING_TYPES = ['data_inconsistency', 'stale_claim', 'quality_issue'] as const
export const CONTENT_AUDIT_SEVERITIES = ['info', 'warning', 'critical'] as const
export type ContentAuditFindingType = (typeof CONTENT_AUDIT_FINDING_TYPES)[number]
export type ContentAuditSeverity = (typeof CONTENT_AUDIT_SEVERITIES)[number]

const MAX_FINDINGS = 200
const MAX_EVIDENCE = 20
const MAX_STRING = 2000
const MAX_TOTAL_BYTES = 262144 // 256 KB

export interface ContentAuditEvidence { url: string; snippet: string }
export interface ContentAuditFinding {
  type: ContentAuditFindingType
  severity: ContentAuditSeverity
  title: string
  detail: string
  evidence: ContentAuditEvidence[]
  recommendation: string
}
export interface ContentAuditPayload { v: 1; generatedAt: string; findings: ContentAuditFinding[] }

type Result = { ok: true; payload: ContentAuditPayload } | { ok: false; code: string }

const isStr = (v: unknown, max = MAX_STRING): v is string =>
  typeof v === 'string' && v.length <= max

export function validateContentAuditFindings(input: unknown, allowedUrls: Set<string>, now: Date): Result {
  const root = input as { findings?: unknown }
  if (!root || typeof root !== 'object' || !Array.isArray(root.findings)) {
    return { ok: false, code: 'invalid_findings' }
  }
  if (root.findings.length > MAX_FINDINGS) return { ok: false, code: 'invalid_findings' }

  const out: ContentAuditFinding[] = []
  for (const raw of root.findings) {
    const f = raw as Partial<ContentAuditFinding>
    if (!f || typeof f !== 'object') return { ok: false, code: 'invalid_findings' }
    if (!CONTENT_AUDIT_FINDING_TYPES.includes(f.type as ContentAuditFindingType)) return { ok: false, code: 'invalid_findings' }
    if (!CONTENT_AUDIT_SEVERITIES.includes(f.severity as ContentAuditSeverity)) return { ok: false, code: 'invalid_findings' }
    if (!isStr(f.title) || !isStr(f.detail) || !isStr(f.recommendation)) return { ok: false, code: 'invalid_findings' }
    if (!Array.isArray(f.evidence) || f.evidence.length > MAX_EVIDENCE) return { ok: false, code: 'invalid_findings' }

    const evidence: ContentAuditEvidence[] = []
    for (const e of f.evidence) {
      const ev = e as Partial<ContentAuditEvidence>
      if (!ev || typeof ev !== 'object' || !isStr(ev.url, 2048) || !isStr(ev.snippet)) return { ok: false, code: 'invalid_findings' }
      let norm: string
      try { norm = normalizeFindingUrl(ev.url) } catch { return { ok: false, code: 'evidence_url_not_in_audit' } }
      if (!allowedUrls.has(norm)) return { ok: false, code: 'evidence_url_not_in_audit' }
      evidence.push({ url: norm, snippet: ev.snippet })
    }
    out.push({
      type: f.type as ContentAuditFindingType,
      severity: f.severity as ContentAuditSeverity,
      title: f.title, detail: f.detail, recommendation: f.recommendation, evidence,
    })
  }

  const payload: ContentAuditPayload = { v: 1, generatedAt: now.toISOString(), findings: out }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_TOTAL_BYTES) {
    return { ok: false, code: 'findings_too_large' }
  }
  return { ok: true, payload }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/content-audit/ingest-schema.test.ts`
Expected: PASS (7 tests). If `normalizeFindingUrl` does not strip fragments, adjust the "normalizes" test's input to a case it does normalize (verify by reading `lib/findings/normalize-url.ts`); keep the allowlist-rejection test authoritative.

- [ ] **Step 5: Commit**

```bash
git add lib/content-audit/ingest-schema.ts lib/content-audit/ingest-schema.test.ts
git commit -m "feat(c12): pure content-audit findings validator (caps + evidence-url binding)"
```

---

### Task 4: Shared route-auth helper

**Files:**
- Create: `lib/content-audit/route-auth.ts`
- Test: `lib/content-audit/route-auth.test.ts`

**Interfaces:**
- Consumes: `verifyContentAuditToken`, `ContentAuditTokenError`.
- Produces: `requireContentAuditToken(req, siteAuditId, scope) → {ok:true; payload} | {ok:false; res: Response}`. Reads the token from the `Authorization: Bearer <cat_…>` header (fallback `?token=`).

- [ ] **Step 1: Write the failing test**

Create `lib/content-audit/route-auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { requireContentAuditToken } from './route-auth'
import { mintContentAuditToken } from '../content-audit-token'

const req = (token?: string) =>
  new NextRequest('https://app.test/api/content-audit/audit_1/manifest', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

describe('requireContentAuditToken', () => {
  it('accepts a valid cat_ token with the required scope', async () => {
    const { token } = await mintContentAuditToken('audit_1')
    const r = await requireContentAuditToken(req(token), 'audit_1', 'read')
    expect(r.ok).toBe(true)
  })
  it('401s a missing token', async () => {
    const r = await requireContentAuditToken(req(), 'audit_1', 'read')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.res.status).toBe(401)
  })
  it('401s a sub mismatch', async () => {
    const { token } = await mintContentAuditToken('audit_1')
    const r = await requireContentAuditToken(req(token), 'audit_2', 'read')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/content-audit/route-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `lib/content-audit/route-auth.ts`:
```ts
// lib/content-audit/route-auth.ts
// One fail-closed auth helper for the three public cat_ routes. Maps every
// failure (missing/prefix-less token, cross-family JWT, sub mismatch, expiry,
// missing scope) to a controlled 401 Response — never a raw throw that would
// surface as withRoute's 500 internal_error.
import { NextRequest, NextResponse } from 'next/server'
import { verifyContentAuditToken, CONTENT_AUDIT_TOKEN_SCOPES } from '../content-audit-token'

type Scope = (typeof CONTENT_AUDIT_TOKEN_SCOPES)[number]
type Result = { ok: true; payload: Awaited<ReturnType<typeof verifyContentAuditToken>> } | { ok: false; res: Response }

function bearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization')
  if (h && h.startsWith('Bearer ')) return h.slice('Bearer '.length).trim()
  return req.nextUrl.searchParams.get('token')
}

export async function requireContentAuditToken(req: NextRequest, siteAuditId: string, scope: Scope): Promise<Result> {
  const token = bearer(req)
  if (!token) return { ok: false, res: NextResponse.json({ error: 'auth_required' }, { status: 401 }) }
  let payload
  try {
    payload = await verifyContentAuditToken(token, siteAuditId)
  } catch {
    return { ok: false, res: NextResponse.json({ error: 'auth_required' }, { status: 401 }) }
  }
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : []
  if (!scopes.includes(scope)) {
    return { ok: false, res: NextResponse.json({ error: 'insufficient_scope' }, { status: 401 }) }
  }
  return { ok: true, payload }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/content-audit/route-auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-audit/route-auth.ts lib/content-audit/route-auth.test.ts
git commit -m "feat(c12): shared fail-closed cat_ route-auth helper"
```

---

### Task 5: Retention — builder change + sweep

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (~lines 656-658)
- Modify: `lib/findings/retention.ts` (add `sweepExpiredContentAudit`)
- Modify: `lib/cleanup.ts` (wire into `runCleanup`)
- Modify: `lib/jobs/handlers/stale-audit-reset.ts` (call the sweep)
- Test: `lib/findings/retention.test.ts` (extend), `lib/jobs/handlers/broken-link-verify.test.ts` (extend)

**Interfaces:**
- Consumes: `CONTENT_AUDIT_BASE_TTL_MS` (define in `broken-link-verify.ts`, default `2 * 3600 * 1000`).
- Produces: `sweepExpiredContentAudit(now?: Date): Promise<void>` in `retention.ts`.

- [ ] **Step 1: Write the failing retention test**

Add to `lib/findings/retention.test.ts` a new `describe('sweepExpiredContentAudit')`:
```ts
describe('sweepExpiredContentAudit', () => {
  const DOMAIN = 'sweep-cat.example.com'
  beforeEach(async () => {
    await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('DELETEs rows for expired non-null retainUntil, keeps in-window and null', async () => {
    const now = new Date('2026-07-13T12:00:00Z')
    const expired = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(now.getTime() - 1000) } })
    const inWindow = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(now.getTime() + 60000) } })
    const stranded = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: null } })
    for (const sa of [expired, inWindow, stranded]) {
      await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', contentText: 'body' } })
    }
    const { sweepExpiredContentAudit } = await import('./retention')
    await sweepExpiredContentAudit(now)
    expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId: expired.id } })).toBe(0)
    expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId: inWindow.id } })).toBe(1)
    expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId: stranded.id } })).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts -t sweepExpiredContentAudit`
Expected: FAIL — `sweepExpiredContentAudit` is not a function.

- [ ] **Step 3: Implement the sweep**

Add to `lib/findings/retention.ts`:
```ts
/**
 * C12 D1: DELETE retained HarvestedPageSeo rows once their audit's retention
 * window has elapsed. Only non-null contentAuditRetainUntil rows are swept
 * (the stamp is written only after a successful live-scan run), so stranded
 * (null) rows are left for recoverBrokenLinkVerifies + the 7-d backstop. The
 * table has no updatedAt; a DELETE needs none. Hosted in runCleanup + the
 * every-10-min stale-audit-reset job.
 */
export async function sweepExpiredContentAudit(now: Date = new Date()): Promise<void> {
  // DateTime columns are stored as INTEGER ms in this SQLite setup (CLAUDE.md:
  // "storage is integer ms"; every raw-SQL DateTime comparison in the repo binds
  // ${x.getTime()}, e.g. lib/ops/health-check.collect.test.ts). Bind integer ms
  // — NOT a bare Date — so the comparison is integer-vs-integer and can't silently
  // never-match on a serialization mismatch.
  const count = await prisma.$executeRaw`
    DELETE FROM "HarvestedPageSeo"
    WHERE "siteAuditId" IN (
      SELECT "id" FROM "SiteAudit"
      WHERE "contentAuditRetainUntil" IS NOT NULL AND "contentAuditRetainUntil" < ${now.getTime()}
    )`
  if (count > 0) console.log(`[findings] content-audit sweep deleted ${count} expired HarvestedPageSeo row(s)`)
}
```

**Codex plan-review note (deliberate deviation):** Codex asserted a bare `Date`
param binds correctly for the SQLite DATETIME comparison. The whole repo says
otherwise (integer-ms storage; every DateTime raw comparison uses `.getTime()`),
and a mismatch here fails *silently* (sweep never fires). `.getTime()` is safe
under both readings — use it. Verify once during implementation with a real prod-
shaped row that the DELETE actually removes an expired row (the Step-4 test does).

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts -t sweepExpiredContentAudit`
Expected: PASS.

- [ ] **Step 5: Write the failing builder test**

Add to `lib/jobs/handlers/broken-link-verify.test.ts` (in a `describe` that seeds a SiteAudit + HarvestedPageSeo and runs the builder — mirror the existing similarity tests around line 717): after a successful run, assert the rows are RETAINED and `retainUntil` is stamped in the future:
```ts
it('retains HarvestedPageSeo + stamps contentAuditRetainUntil (no longer deletes)', async () => {
  const sa = await seedAuditWithPageSeoRows() // existing helper pattern: SiteAudit + 1+ HarvestedPageSeo
  await runBrokenLinkVerify({ siteAuditId: sa.id, domain: sa.domain })
  const after = await prisma.siteAudit.findUnique({ where: { id: sa.id }, select: { contentAuditRetainUntil: true } })
  expect(after?.contentAuditRetainUntil).toBeTruthy()
  expect(after!.contentAuditRetainUntil!.getTime()).toBeGreaterThan(Date.now())
  // HarvestedLink still deleted; HarvestedPageSeo retained:
  expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId: sa.id } })).toBeGreaterThan(0)
})
```
(Use the file's existing seeding + `runBrokenLinkVerify` invocation style; the existing similarity tests currently assert `harvestedPageSeo.count(...)` is `0` — those assertions must be UPDATED in the next step to expect retention, since the builder no longer deletes.)

- [ ] **Step 6: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — the new test fails (rows deleted / no stamp), and the pre-existing `harvestedPageSeo.count(...).toBe(0)` assertions now also fail. Both are expected and fixed next.

- [ ] **Step 7: Change the builder**

In `lib/jobs/handlers/broken-link-verify.ts`, replace the tail (currently):
```ts
  await writeFindingsRun(bundle)
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAuditId: job.siteAuditId } })
```
with (stamp BEFORE the run write for crash-safety, keep HarvestedPageSeo):
```ts
  // C12 D1: stamp the content-audit retention window BEFORE writing the run.
  // If we crash between here and writeFindingsRun, there is a stamp but no
  // live-scan run -> recoverBrokenLinkVerifies re-enqueues (its liveRun guard
  // is false) and the builder rebuilds idempotently. Stamp-after could leave a
  // run with retained rows but retainUntil=null (recovery skips it; export
  // can't reach the text) -- so stamp-first is the invariant.
  await prisma.siteAudit.update({
    where: { id: job.siteAuditId },
    data: { contentAuditRetainUntil: new Date(deps.now() + CONTENT_AUDIT_BASE_TTL_MS) },
  })
  await writeFindingsRun(bundle)
  // HarvestedLink stays transient (a populated row still means "builder didn't
  // finish", which recovery relies on). HarvestedPageSeo is NO LONGER deleted
  // here -- it carries contentText for the retention window and is DELETEd at
  // expiry by sweepExpiredContentAudit (retention.ts).
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: job.siteAuditId } })
```
Add near the top-of-file constants (Codex plan #2 — safe parse; a negative/NaN/
Infinity env value must NOT produce a bad window):
```ts
const CONTENT_AUDIT_BASE_TTL_MS = ((): number => {
  const raw = Number(process.env.CONTENT_AUDIT_BASE_TTL_MS)
  return Number.isInteger(raw) && raw > 0 ? raw : 2 * 3600 * 1000 // 2h default
})()
```

- [ ] **Step 8: Update the pre-existing retention assertions**

In `lib/jobs/handlers/broken-link-verify.test.ts`, every existing assertion of the form `expect(await prisma.harvestedPageSeo.count({ where: { siteAuditId … } })).toBe(0)` (there are several — the similarity/on-page/score suites) must change to `.toBeGreaterThan(0)` (or the seeded row count), since the builder now retains. Search the file for `harvestedPageSeo.count` and update each terminal assertion accordingly. Leave the `harvestedLink` deletion assertions unchanged.

- [ ] **Step 9: Run the full builder suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (all, including the new retention test).

- [ ] **Step 10: Wire the sweep into runCleanup + stale-audit-reset**

In `lib/cleanup.ts`, add to the import from `@/lib/findings/retention` and to the `Promise.allSettled([...])` array:
```ts
import { pruneArchivedBlobs, pruneHarvestedLinks, pruneHarvestedPageSeo, sweepExpiredContentAudit } from '@/lib/findings/retention';
// …
    sweepExpiredContentAudit(new Date()),
```
In `lib/jobs/handlers/stale-audit-reset.ts`, after the broken-link recovery block:
```ts
      // C12 D1: sweep expired content-audit retention windows (tight bounding).
      await import('@/lib/findings/retention')
        .then((m) => m.sweepExpiredContentAudit(new Date()))
        .catch((err) => console.warn('[stale-audit-reset] content-audit sweep failed:', (err as Error).message))
```

- [ ] **Step 11: Bound the recovery scan to genuinely-stranded audits (Codex plan #1)**

Retaining `HarvestedPageSeo` pollutes `recoverBrokenLinkVerifies`'s "populated
transient rows ⇒ maybe-missing run" signal: it would now scan every completed
audit within the retention window every 10 min. The `if (liveRun) continue` guard
keeps it *correct* but not *cheap*. Filter the `harvestedPageSeo` distinct scan at
the DB level to audits with **no** `seo-parser` live-scan run.

First **verify the reverse relation name** — `grep -n "CrawlRun\[\]\|crawlRuns\|crawlRun " prisma/schema.prisma` inside `model SiteAudit`. If SiteAudit has no reverse `CrawlRun[]` relation, add one (`crawlRuns CrawlRun[]`) in a tiny schema edit + `prisma generate` (no migration — it's a virtual relation). Then in `lib/ada-audit/broken-link-recovery.ts`, change the `harvestedPageSeo.findMany` to:
```ts
    prisma.harvestedPageSeo.findMany({
      where: { siteAudit: { crawlRuns: { none: { tool: 'seo-parser' } } } },
      distinct: ['siteAuditId'], select: { siteAuditId: true },
    }),
```
(`HarvestedLink` scan is unchanged — a populated link row still means "builder didn't finish".) The existing `if (liveRun) continue` guard stays as belt-and-suspenders.

- [ ] **Step 12: Recovery regression test**

Add to `lib/ada-audit/broken-link-recovery.test.ts`: an audit that is `complete`,
HAS a `seo-parser` live-scan run, AND has retained `HarvestedPageSeo` rows is NOT
re-enqueued (the run-bearing retention case); the pre-existing "only
HarvestedPageSeo rows, no run" stranded case still IS re-enqueued.
```ts
it('does NOT re-enqueue a completed audit that already has a live-scan run + retained pageSeo', async () => {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(Date.now() + 3600_000) } })
  await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', contentText: 'body' } })
  const n = await recoverBrokenLinkVerifies()
  const jobs = await prisma.job.count({ where: { groupKey: `site-audit:${sa.id}` } })
  expect(jobs).toBe(0)
})
```

- [ ] **Step 13: Run gates**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts lib/jobs/handlers/broken-link-verify.test.ts lib/ada-audit/broken-link-recovery.test.ts`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/findings/retention.ts lib/findings/retention.test.ts lib/jobs/handlers/broken-link-verify.test.ts lib/cleanup.ts lib/jobs/handlers/stale-audit-reset.ts lib/ada-audit/broken-link-recovery.ts lib/ada-audit/broken-link-recovery.test.ts prisma/schema.prisma
git commit -m "feat(c12): mint-extendable contentText retention — stamp-before-write + DELETE-at-expiry sweep + bounded recovery scan"
```

---

### Task 6: Cookie-gated mint + poll routes

**Files:**
- Create: `app/api/site-audit/[id]/content-audit/mint-token/route.ts`
- Create: `app/api/site-audit/[id]/content-audit/route.ts`
- Test: `app/api/site-audit/[id]/content-audit/mint-token/route.test.ts`

**Interfaces:**
- Consumes: `mintContentAuditToken`, `CONTENT_AUDIT_TOKEN_TTL_MS`, `prisma`.
- Produces: mint returns `{token, expiresAt, textAvailable}`; poll returns `{minted:boolean, contentAuditJson: string | null}`.

- [ ] **Step 1: Write the failing mint test**

Create `app/api/site-audit/[id]/content-audit/mint-token/route.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { POST } from './route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const DOMAIN = 'mint-cat.example.com'

async function seedComplete(withRun: boolean, retainUntil: Date | null) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: retainUntil } })
  if (withRun) await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
  return sa
}

describe('POST content-audit/mint-token', () => {
  beforeEach(async () => {
    await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('mints a cat_ token for a complete audit with a live-scan run', async () => {
    const sa = await seedComplete(true, new Date(Date.now() + 3600_000))
    // seed a page with text so textAvailable=true
    await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', contentText: 'body', statusCode: 200 } })
    const res = await POST(new NextRequest('https://app.test/api/site-audit/' + sa.id + '/content-audit/mint-token', { method: 'POST' }), params(sa.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token.startsWith('cat_')).toBe(true)
    expect(body.textAvailable).toBe(true)
  })
  it('409s when there is no live-scan run', async () => {
    const sa = await seedComplete(false, null)
    const res = await POST(new NextRequest('https://app.test/x', { method: 'POST' }), params(sa.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('no_live_scan_run')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/site-audit/[id]/content-audit/mint-token/route.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the mint route**

Create `app/api/site-audit/[id]/content-audit/mint-token/route.ts`:
```ts
// Cookie-gated mint for the cat_ content-audit bridge. Guards: audit complete +
// has a seo-parser live-scan run + client not archived. Extends the retention
// window (max(), never shorten) to the token's life; reports textAvailable.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { mintContentAuditToken, CONTENT_AUDIT_TOKEN_TTL_MS } from '@/lib/content-audit-token'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ id: string }> }

export const POST = withRoute(async (_req: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { id: true, status: true, contentAuditRetainUntil: true, client: { select: { archivedAt: true } } },
  })
  if (!audit) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (audit.status !== 'complete') return NextResponse.json({ error: 'audit_not_complete' }, { status: 409 })
  if (audit.client?.archivedAt) return NextResponse.json({ error: 'client_archived' }, { status: 409 })
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    select: { id: true },
  })
  if (!run) return NextResponse.json({ error: 'no_live_scan_run' }, { status: 409 })

  // Codex plan #2: atomic MONOTONIC extension. `now + TTL` is always >= any
  // earlier extension, so a conditional raw UPDATE that only RAISES the column
  // can't shorten a concurrently-extended window (no read-modify-write race).
  // Integer-ms bind (DateTime storage is integer ms — see the sweep note).
  const extendedMs = Date.now() + CONTENT_AUDIT_TOKEN_TTL_MS
  await prisma.$executeRaw`
    UPDATE "SiteAudit" SET "contentAuditRetainUntil" = ${extendedMs}
    WHERE "id" = ${id}
      AND ("contentAuditRetainUntil" IS NULL OR "contentAuditRetainUntil" < ${extendedMs})`

  // Re-read the effective window (a concurrent mint may have set it higher) +
  // whether any retained text remains, to report an honest textAvailable.
  const fresh = await prisma.siteAudit.findUnique({ where: { id }, select: { contentAuditRetainUntil: true } })
  const textRows = await prisma.harvestedPageSeo.count({ where: { siteAuditId: id, contentText: { not: null } } })
  const windowOpen = (fresh?.contentAuditRetainUntil?.getTime() ?? 0) > Date.now()
  const textAvailable = textRows > 0 && windowOpen

  const minted = await mintContentAuditToken(id)
  return NextResponse.json({ token: minted.token, expiresAt: minted.expiresAt, textAvailable })
})
```

- [ ] **Step 4: Write the poll route**

Create `app/api/site-audit/[id]/content-audit/route.ts`:
```ts
// Cookie-gated poll for the dashboard ContentAuditCard. Returns whether a
// content audit has been ingested + the raw JSON. NEVER reuses the public
// token routes (Codex #4).
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ id: string }> }

export const GET = withRoute(async (_req: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    select: { contentAuditJson: true },
  })
  return NextResponse.json({ minted: run?.contentAuditJson != null, contentAuditJson: run?.contentAuditJson ?? null })
})
```

- [ ] **Step 5: Add the textAvailable-false mint case + a poll-route test (Codex plan #5)**

Extend the mint test file with an expired-window case, and add a poll-route test
file `app/api/site-audit/[id]/content-audit/route.test.ts`:
```ts
// in mint-token/route.test.ts — expired window ⇒ still mints, textAvailable:false
it('mints but reports textAvailable:false when text is already gone', async () => {
  const sa = await seedComplete(true, new Date(Date.now() - 1000)) // window already closed
  // no HarvestedPageSeo rows (swept)
  const res = await POST(new NextRequest('https://app.test/x', { method: 'POST' }), params(sa.id))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.token.startsWith('cat_')).toBe(true)
  // mint RAISES the window to now+TTL, so text would be available IF rows existed;
  // with zero text rows textAvailable must be false.
  expect(body.textAvailable).toBe(false)
})
```
```ts
// content-audit/route.test.ts — the cookie-gated poll
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const DOMAIN = 'poll-cat.example.com'
describe('GET content-audit (poll)', () => {
  beforeEach(async () => {
    await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('reports minted:false when no contentAuditJson, minted:true after it is set', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
    let res = await GET(new NextRequest('https://app.test/x'), params(sa.id))
    expect((await res.json()).minted).toBe(false)
    await prisma.crawlRun.update({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } }, data: { contentAuditJson: '{"v":1,"generatedAt":"x","findings":[]}' } })
    res = await GET(new NextRequest('https://app.test/x'), params(sa.id))
    const body = await res.json()
    expect(body.minted).toBe(true)
    expect(body.contentAuditJson).toContain('"v":1')
  })
})
```

- [ ] **Step 6: Run to verify all Task-6 tests pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/site-audit/[id]/content-audit"`
Expected: PASS (mint: 3 tests; poll: 1 test).

- [ ] **Step 7: Commit**

```bash
git add "app/api/site-audit/[id]/content-audit"
git commit -m "feat(c12): cookie-gated cat_ mint (atomic monotonic extend) + poll routes"
```

---

### Task 7: Public export routes (manifest + page) + loader

**Files:**
- Create: `lib/content-audit/manifest.ts`
- Create: `app/api/content-audit/[siteAuditId]/manifest/route.ts`
- Create: `app/api/content-audit/[siteAuditId]/page/route.ts`
- Test: `lib/content-audit/manifest.test.ts`

**Interfaces:**
- Consumes: `prisma`, `normalizeFindingUrl`, `requireContentAuditToken`.
- Produces: `loadContentAuditManifest(siteAuditId, now) → ContentAuditManifest | null`; `loadContentAuditPageText(siteAuditId, url, now) → {url,contentText,contentTruncated} | {status:404|410}`; `contentAuditEligibleUrls(siteAuditId) → Set<string>` (the allowlist reused by the PATCH route). `ContentAuditManifest = {client, domain, completedAt, textAvailable, retainUntil, pages: ContentAuditEligiblePage[]}`.

- [ ] **Step 1: Write the failing loader test**

Create `lib/content-audit/manifest.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { loadContentAuditManifest, loadContentAuditPageText } from './manifest'

const DOMAIN = 'manifest-cat.example.com'
async function seed(retainUntil: Date | null) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', completedAt: new Date(), contentAuditRetainUntil: retainUntil } })
  // indexable page (200/html/not-noindex/not-login) with text
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', statusCode: 200, isHtml: true, title: 'A', wordCount: 500, contentText: 'body a' } })
  // non-indexable (noindex) -- excluded
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/n', statusCode: 200, isHtml: true, robotsNoindex: true, contentText: 'body n' } })
  return sa
}

describe('content-audit manifest loader', () => {
  beforeEach(async () => {
    await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('lists indexable pages only + textAvailable true in-window', async () => {
    const sa = await seed(new Date(Date.now() + 60000))
    const m = await loadContentAuditManifest(sa.id, new Date())
    expect(m).not.toBeNull()
    expect(m!.pages.map((p) => p.url)).toEqual(['https://x/a'])
    expect(m!.textAvailable).toBe(true)
  })
  it('textAvailable false when retainUntil has passed', async () => {
    const sa = await seed(new Date(Date.now() - 1000))
    const m = await loadContentAuditManifest(sa.id, new Date())
    expect(m!.textAvailable).toBe(false)
  })
  it('page loader: text in-window, 410 when expired, 404 when not in audit', async () => {
    const open = await seed(new Date(Date.now() + 60000))
    expect(await loadContentAuditPageText(open.id, 'https://x/a', new Date())).toMatchObject({ contentText: 'body a' })
    expect(await loadContentAuditPageText(open.id, 'https://x/zzz', new Date())).toEqual({ status: 404 })
    const expired = await seed(new Date(Date.now() - 1000))
    expect(await loadContentAuditPageText(expired.id, 'https://x/a', new Date())).toEqual({ status: 410 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/content-audit/manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the loader**

Create `lib/content-audit/manifest.ts`:
```ts
// Server loaders for the cat_ export. The indexable ∧ ¬loginLike filter matches
// the live-scan builder's aggregation set. Read-time expiry: retainUntil null or
// <= now => text unavailable, independent of the sweep cadence.
import { prisma } from '@/lib/db'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

export interface ContentAuditEligiblePage { url: string; title: string | null; wordCount: number | null; contentAvailable: boolean }
export interface ContentAuditManifest {
  client: { id: number; name: string } | null
  domain: string | null
  completedAt: Date | null
  textAvailable: boolean
  retainUntil: Date | null
  pages: ContentAuditEligiblePage[]
}

const isIndexable = (r: { statusCode: number | null; isHtml: boolean; robotsNoindex: boolean; xRobotsNoindex: boolean; loginLike: boolean }) =>
  r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300 &&
  r.isHtml && !r.robotsNoindex && !r.xRobotsNoindex && !r.loginLike

export async function loadContentAuditManifest(siteAuditId: string, now: Date): Promise<ContentAuditManifest | null> {
  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: { domain: true, completedAt: true, contentAuditRetainUntil: true, client: { select: { id: true, name: true } } },
  })
  if (!audit) return null
  const windowOpen = audit.contentAuditRetainUntil != null && audit.contentAuditRetainUntil.getTime() > now.getTime()
  const rows = await prisma.harvestedPageSeo.findMany({
    where: { siteAuditId },
    select: { url: true, title: true, wordCount: true, contentText: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true, loginLike: true },
    orderBy: { url: 'asc' },
  })
  const pages = rows.filter(isIndexable).map((r) => ({
    url: r.url, title: r.title, wordCount: r.wordCount,
    contentAvailable: windowOpen && r.contentText != null,
  }))
  return {
    client: audit.client, domain: audit.domain, completedAt: audit.completedAt,
    retainUntil: audit.contentAuditRetainUntil,
    textAvailable: windowOpen && pages.some((p) => p.contentAvailable),
    pages,
  }
}

export async function contentAuditEligibleUrls(siteAuditId: string): Promise<Set<string>> {
  const rows = await prisma.harvestedPageSeo.findMany({
    where: { siteAuditId },
    select: { url: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true, loginLike: true },
  })
  return new Set(rows.filter(isIndexable).map((r) => normalizeFindingUrl(r.url)))
}

export async function loadContentAuditPageText(
  siteAuditId: string, url: string, now: Date,
): Promise<{ url: string; contentText: string; contentTruncated: boolean } | { status: 404 | 410 }> {
  const audit = await prisma.siteAudit.findUnique({ where: { id: siteAuditId }, select: { contentAuditRetainUntil: true } })
  if (!audit) return { status: 404 }
  const norm = normalizeFindingUrl(url)
  const rows = await prisma.harvestedPageSeo.findMany({
    where: { siteAuditId },
    select: { url: true, contentText: true, contentTruncated: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true, loginLike: true },
  })
  const row = rows.filter(isIndexable).find((r) => normalizeFindingUrl(r.url) === norm)
  if (!row) return { status: 404 }
  const windowOpen = audit.contentAuditRetainUntil != null && audit.contentAuditRetainUntil.getTime() > now.getTime()
  if (!windowOpen || row.contentText == null) return { status: 410 }
  return { url: row.url, contentText: row.contentText, contentTruncated: row.contentTruncated }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/content-audit/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the manifest route**

Create `app/api/content-audit/[siteAuditId]/manifest/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireContentAuditToken } from '@/lib/content-audit/route-auth'
import { loadContentAuditManifest } from '@/lib/content-audit/manifest'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ siteAuditId: string }> }

export const GET = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { siteAuditId } = await params
  const auth = await requireContentAuditToken(req, siteAuditId, 'read')
  if (!auth.ok) return auth.res
  const manifest = await loadContentAuditManifest(siteAuditId, new Date())
  if (!manifest) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(manifest)
})
```

- [ ] **Step 6: Write the page route**

Create `app/api/content-audit/[siteAuditId]/page/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireContentAuditToken } from '@/lib/content-audit/route-auth'
import { loadContentAuditPageText } from '@/lib/content-audit/manifest'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ siteAuditId: string }> }

export const GET = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { siteAuditId } = await params
  const auth = await requireContentAuditToken(req, siteAuditId, 'read')
  if (!auth.ok) return auth.res
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'missing_url' }, { status: 400 })
  const result = await loadContentAuditPageText(siteAuditId, url, new Date())
  if ('status' in result) return NextResponse.json({ error: 'text_unavailable' }, { status: result.status })
  return NextResponse.json(result)
})
```

- [ ] **Step 7: Route-handler tests — token/sub enforcement + 410 (Codex plan #5)**

Add `app/api/content-audit/[siteAuditId]/manifest/route.test.ts` (and mirror for `page`):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET as MANIFEST } from './route'
import { GET as PAGE } from '../page/route'
import { mintContentAuditToken } from '@/lib/content-audit-token'
const DOMAIN = 'exproute-cat.example.com'
const p = (id: string) => ({ params: Promise.resolve({ siteAuditId: id }) })
const authed = (id: string, token: string, qs = '') =>
  new NextRequest(`https://app.test/api/content-audit/${id}/manifest${qs}`, { headers: { authorization: `Bearer ${token}` } })
async function seed(retainUntil: Date | null) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', completedAt: new Date(), contentAuditRetainUntil: retainUntil } })
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', statusCode: 200, isHtml: true, contentText: 'body' } })
  return sa
}
describe('cat_ export route handlers', () => {
  beforeEach(async () => {
    await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('manifest 401s a missing token', async () => {
    const sa = await seed(new Date(Date.now() + 60000))
    const res = await MANIFEST(new NextRequest(`https://app.test/api/content-audit/${sa.id}/manifest`), p(sa.id))
    expect(res.status).toBe(401)
  })
  it('manifest 401s a token bound to a different audit', async () => {
    const sa = await seed(new Date(Date.now() + 60000))
    const { token } = await mintContentAuditToken('other_audit')
    const res = await MANIFEST(authed(sa.id, token), p(sa.id))
    expect(res.status).toBe(401)
  })
  it('page 410s an expired in-set page', async () => {
    const sa = await seed(new Date(Date.now() - 1000))
    const { token } = await mintContentAuditToken(sa.id)
    const res = await PAGE(authed(sa.id, token, '?url=https://x/a'), p(sa.id))
    expect(res.status).toBe(410)
  })
})
```
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/content-audit/[siteAuditId]/manifest/route.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 8: Run gates on the new files**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/content-audit/manifest.ts lib/content-audit/manifest.test.ts "app/api/content-audit/[siteAuditId]/manifest" "app/api/content-audit/[siteAuditId]/page"
git commit -m "feat(c12): cat_ export routes (manifest + per-page text) + loaders + route tests"
```

---

### Task 8: PATCH findings route

**Files:**
- Create: `app/api/content-audit/[siteAuditId]/findings/route.ts`
- Test: `app/api/content-audit/[siteAuditId]/findings/route.test.ts`

**Interfaces:**
- Consumes: `requireContentAuditToken`, `validateContentAuditFindings`, `contentAuditEligibleUrls`, `parseJsonBody`, `prisma`.
- Body-before-auth order with a raw-body size guard first.

- [ ] **Step 1: Write the failing test**

Create `app/api/content-audit/[siteAuditId]/findings/route.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { PATCH } from './route'
import { mintContentAuditToken } from '@/lib/content-audit-token'

const DOMAIN = 'patch-cat.example.com'
const params = (id: string) => ({ params: Promise.resolve({ siteAuditId: id }) })

async function seed() {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(Date.now() + 60000) } })
  await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', statusCode: 200, isHtml: true, contentText: 'body' } })
  return sa
}
const req = (id: string, token: string, body: unknown) =>
  new NextRequest('https://app.test/api/content-audit/' + id + '/findings', {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const finding = (url: string) => ({ type: 'data_inconsistency', severity: 'warning', title: 't', detail: 'd', evidence: [{ url, snippet: 's' }], recommendation: 'r' })

describe('PATCH content-audit findings', () => {
  beforeEach(async () => {
    await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
    await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('stores validated findings on the live-scan run', async () => {
    const sa = await seed(); const { token } = await mintContentAuditToken(sa.id)
    const res = await PATCH(req(sa.id, token, { findings: [finding('https://x/a')] }), params(sa.id))
    expect(res.status).toBe(200)
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } }, select: { contentAuditJson: true } })
    expect(JSON.parse(run!.contentAuditJson!).findings[0].type).toBe('data_inconsistency')
  })
  it('rejects an evidence url not in the audit', async () => {
    const sa = await seed(); const { token } = await mintContentAuditToken(sa.id)
    const res = await PATCH(req(sa.id, token, { findings: [finding('https://evil/x')] }), params(sa.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('evidence_url_not_in_audit')
  })
  it('401s a missing token', async () => {
    const sa = await seed()
    const res = await PATCH(new NextRequest('https://app.test/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"findings":[]}' }), params(sa.id))
    expect(res.status).toBe(401)
  })
  it('last-writer-wins: a second PATCH overwrites the first (Codex #5)', async () => {
    const sa = await seed(); const { token } = await mintContentAuditToken(sa.id)
    await PATCH(req(sa.id, token, { findings: [finding('https://x/a')] }), params(sa.id))
    await PATCH(req(sa.id, token, { findings: [] }), params(sa.id))
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } }, select: { contentAuditJson: true } })
    expect(JSON.parse(run!.contentAuditJson!).findings.length).toBe(0)
  })
  it('409s no_live_scan_run when the audit has no seo-parser run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(Date.now() + 60000) } })
    const { token } = await mintContentAuditToken(sa.id)
    const res = await PATCH(req(sa.id, token, { findings: [] }), params(sa.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('no_live_scan_run')
  })
  it('413s an oversized body even with NO Content-Length header (Codex #3)', async () => {
    const sa = await seed(); const { token } = await mintContentAuditToken(sa.id)
    // Build a >300KB body via a ReadableStream so Content-Length is absent.
    const big = 'x'.repeat(320 * 1024)
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`{"pad":"${big}","findings":[]}`)); c.close() } })
    const r = new NextRequest('https://app.test/x', { method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' })
    const res = await PATCH(r, params(sa.id))
    expect(res.status).toBe(413)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/content-audit/[siteAuditId]/findings/route.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the bounded body reader (Codex plan #3)**

`Content-Length` is absent for chunked/streamed bodies and `parseJsonBody` has no
byte cap, so a header-only guard is bypassable. Create
`lib/content-audit/read-bounded-json.ts`:
```ts
// Reads a request body while counting streamed bytes; returns null once the cap
// is exceeded (regardless of Content-Length). Parses JSON only after the whole
// (bounded) body is in hand. Used by the cat_ PATCH route BEFORE token auth so an
// unauthenticated caller can't stream an unbounded body.
export async function readBoundedText(req: Request, maxBytes: number): Promise<string | null> {
  const reader = req.body?.getReader()
  if (!reader) {
    const t = await req.text()
    return Buffer.byteLength(t, 'utf8') > maxBytes ? null : t
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel().catch(() => {}); return null }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}
```

- [ ] **Step 4: Write the route**

Create `app/api/content-audit/[siteAuditId]/findings/route.ts`:
```ts
// PATCH ingest for the cat_ bridge. Order (Codex #3): bounded-body read (byte cap
// regardless of Content-Length) -> parse -> requireContentAuditToken(findings-write)
// -> validate (caps + evidence-URL binding) -> store on the live-scan CrawlRun.
// Last-writer-wins.
import { NextRequest, NextResponse } from 'next/server'
import { HttpError } from '@/lib/api/errors'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { readBoundedText } from '@/lib/content-audit/read-bounded-json'
import { requireContentAuditToken } from '@/lib/content-audit/route-auth'
import { validateContentAuditFindings } from '@/lib/content-audit/ingest-schema'
import { contentAuditEligibleUrls } from '@/lib/content-audit/manifest'

export const dynamic = 'force-dynamic'
type RouteParams = { params: Promise<{ siteAuditId: string }> }
const MAX_BODY_BYTES = 300 * 1024 // > the 256K aggregate cap, leaves envelope room

export const PATCH = withRoute(async (req: NextRequest, { params }: RouteParams) => {
  const { siteAuditId } = await params

  const raw = await readBoundedText(req, MAX_BODY_BYTES)
  if (raw === null) return NextResponse.json({ error: 'body_too_large' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { throw new HttpError(400, 'invalid_json') }

  const auth = await requireContentAuditToken(req, siteAuditId, 'findings-write')
  if (!auth.ok) return auth.res

  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }, select: { id: true },
  })
  if (!run) return NextResponse.json({ error: 'no_live_scan_run' }, { status: 409 })

  const allowed = await contentAuditEligibleUrls(siteAuditId)
  const result = validateContentAuditFindings(body, allowed, new Date())
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 400 })

  await prisma.crawlRun.update({ where: { id: run.id }, data: { contentAuditJson: JSON.stringify(result.payload) } })
  return NextResponse.json({ ok: true, count: result.payload.findings.length })
})
```
Note: `req.body` reading consumes the stream once — read the bounded body BEFORE
any other body access. The token comes from the `Authorization` header (not the
body), so body-before-auth holds.

- [ ] **Step 5: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/content-audit/[siteAuditId]/findings/route.test.ts"`
Expected: PASS (6 tests). If the streamed-body test hits a Node/undici `duplex`
requirement, the cast in the test already sets `duplex: 'half'`; if the runtime
still rejects it, assert the bounded reader directly in a `read-bounded-json.test.ts`
unit test (feed a >cap stream, expect null) and keep a header-based 413 case here.

- [ ] **Step 6: Commit**

```bash
git add "app/api/content-audit/[siteAuditId]/findings" lib/content-audit/read-bounded-json.ts
git commit -m "feat(c12): cat_ PATCH-ingest route (bounded body reader + validate + store)"
```

---

### Task 9: Middleware matchers + tests

**Files:**
- Modify: `middleware.ts` (`isPublicPath`)
- Test: `middleware.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `middleware.test.ts` (mirror the kst_ cases):
```ts
describe('content-audit (cat_) public paths', () => {
  it('the three public routes are public', () => {
    expect(isPublicPath('/api/content-audit/audit_1/manifest')).toBe(true)
    expect(isPublicPath('/api/content-audit/audit_1/page')).toBe(true)
    expect(isPublicPath('/api/content-audit/audit_1/findings')).toBe(true)
  })
  it('a deeper path is NOT public', () => {
    expect(isPublicPath('/api/content-audit/audit_1/manifest/extra')).toBe(false)
    expect(isPublicPath('/api/content-audit')).toBe(false)
  })
  it('the mint + poll routes stay cookie-gated (not public)', () => {
    expect(isPublicPath('/api/site-audit/audit_1/content-audit')).toBe(false)
    expect(isPublicPath('/api/site-audit/audit_1/content-audit/mint-token')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run middleware.test.ts -t content-audit`
Expected: FAIL — the public routes return false.

- [ ] **Step 3: Add the matchers**

In `middleware.ts` `isPublicPath`, after the keyword-strategy block:
```ts
  // content-audit (cat_): GET manifest + GET page + PATCH findings. mint-token +
  // the cookie-gated poll (/api/site-audit/[id]/content-audit) stay gated —
  // they run from the authenticated dashboard. NEVER an /api/content-audit/
  // prefix (that would expose future gated sub-routes).
  if (/^\/api\/content-audit\/[^/]+\/manifest$/.test(pathname)) return true
  if (/^\/api\/content-audit\/[^/]+\/page$/.test(pathname)) return true
  if (/^\/api\/content-audit\/[^/]+\/findings$/.test(pathname)) return true
```

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run middleware.test.ts`
Expected: PASS (all, incl. the new block).

- [ ] **Step 5: Commit**

```bash
git add middleware.ts middleware.test.ts
git commit -m "feat(c12): cat_ public middleware matchers + positive/negative tests"
```

---

### Task 10: ContentAuditCard UI + prompt builder

**Files:**
- Create: `lib/content-audit-prompt.ts`
- Create: `components/site-audit/ContentAuditCard.tsx`
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx` (`seoContent`, ~line 293)
- Test: `components/site-audit/ContentAuditCard.test.tsx`

**Interfaces:**
- Consumes: mint route `{token, expiresAt, textAvailable}`, poll route `{minted, contentAuditJson}`.
- `ContentAuditCard` props: `{ siteAuditId: string; hasLiveScanRun: boolean; initialContentAuditJson: string | null }`.

- [ ] **Step 1: Write the prompt builder**

Create `lib/content-audit-prompt.ts` (mirror `lib/keyword-strategy-prompt.ts`):
```ts
// Clipboard payload the ContentAuditCard copies. The er-handoff-memo skill's
// cat_ branch parses the "Content Audit ID:" + "Access token: cat_..." lines.
export function buildContentAuditPrompt(opts: { siteAuditId: string; token: string; appUrl: string }): string {
  return [
    'Webapp: er-seo-tools',
    `Content Audit ID: ${opts.siteAuditId}`,
    `Access token: ${opts.token}`,
    `Base URL: ${opts.appUrl}`,
    '',
    'Run the er-handoff-memo skill: fetch the content-audit manifest, review the pages,',
    'and PATCH back cross-page consistency / stale-claim / quality findings.',
  ].join('\n')
}
```

- [ ] **Step 2: Write the failing component test**

Create `components/site-audit/ContentAuditCard.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ContentAuditCard } from './ContentAuditCard'

afterEach(cleanup)

describe('ContentAuditCard', () => {
  it('renders a mint control when a live-scan run exists', () => {
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    expect(screen.getByRole('button', { name: /content audit/i })).toBeTruthy()
  })
  it('renders nothing actionable when there is no live-scan run', () => {
    const { container } = render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={false} initialContentAuditJson={null} />)
    expect(container.querySelector('button')).toBeNull()
  })
  it('renders ingested findings grouped by type', () => {
    const json = JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), findings: [
      { type: 'data_inconsistency', severity: 'warning', title: 'Tuition differs', detail: 'd', evidence: [{ url: 'https://x/a', snippet: 's' }], recommendation: 'r' },
    ] })
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={json} />)
    expect(screen.getAllByText(/Tuition differs/).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ContentAuditCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the component**

Create `components/site-audit/ContentAuditCard.tsx` (client component; mint fetch, clipboard copy, findings render; full dark-mode variants). Key shape:
```tsx
'use client'
import { useState } from 'react'
import { buildContentAuditPrompt } from '@/lib/content-audit-prompt'

interface CardProps { siteAuditId: string; hasLiveScanRun: boolean; initialContentAuditJson: string | null }
type Finding = { type: string; severity: string; title: string; detail: string; evidence: { url: string; snippet: string }[]; recommendation: string }

const TYPE_LABEL: Record<string, string> = {
  data_inconsistency: 'Data inconsistency', stale_claim: 'Stale claim', quality_issue: 'Content quality',
}

// NEXT_PUBLIC_APP_URL is inlined at build (client-safe). Repo rule: share/handoff
// URLs use NEXT_PUBLIC_APP_URL, never window.location.origin (reverse-proxy trap).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

export function ContentAuditCard({ siteAuditId, hasLiveScanRun, initialContentAuditJson }: CardProps) {
  const [prompt, setPrompt] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [json, setJson] = useState<string | null>(initialContentAuditJson)
  const [polling, setPolling] = useState(false)

  const findings: Finding[] = (() => {
    if (!json) return []
    try { return JSON.parse(json).findings ?? [] } catch { return [] }
  })()

  // Codex plan #4: bounded poll after mint until findings arrive (surfaces the
  // skill's PATCH without a reload). Mirrors the kst_ memo poller.
  useEffect(() => {
    if (!polling || findings.length > 0) return
    let stop = false
    const iv = setInterval(async () => {
      if (stop) return
      const res = await fetch(`/api/site-audit/${siteAuditId}/content-audit`)
      if (!res.ok) return
      const body = await res.json()
      if (body.minted && body.contentAuditJson) { setJson(body.contentAuditJson); setPolling(false) }
    }, 8000)
    return () => { stop = true; clearInterval(iv) }
  }, [polling, siteAuditId, findings.length])

  if (!hasLiveScanRun) return null

  async function mint() {
    const res = await fetch(`/api/site-audit/${siteAuditId}/content-audit/mint-token`, { method: 'POST' })
    if (!res.ok) { setNote('Could not start a content audit.'); return }
    const body = await res.json()
    setPrompt(buildContentAuditPrompt({ siteAuditId, token: body.token, appUrl: APP_URL }))
    setNote(body.textAvailable === false ? 'Retained page text expired — the analysis will fetch pages live.' : null)
    setPolling(true)
  }

  async function copy() {
    if (!prompt) return
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
      <h3 className="font-semibold text-gray-900 dark:text-white">Content audit</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-white/70">
        Hand off this audit's page content to a Claude session for consistency, stale-claim, and quality review.
      </p>
      <button onClick={mint} className="mt-3 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
        Start content audit
      </button>
      {note && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{note}</p>}
      {prompt && (
        <div className="mt-3">
          <button onClick={copy} className="mb-2 rounded border border-gray-300 px-2 py-1 text-xs dark:border-navy-border dark:text-white/80">
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
          <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs text-gray-800 dark:bg-navy-950 dark:text-white/80">{prompt}</pre>
        </div>
      )}
      {findings.length > 0 && (
        <div className="mt-4 space-y-3">
          {findings.map((f, i) => (
            <div key={i} className="rounded border border-gray-100 p-3 dark:border-navy-border">
              <div className="flex items-center gap-2">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-navy-800 dark:text-white/80">{TYPE_LABEL[f.type] ?? f.type}</span>
                <span className="text-xs uppercase text-gray-500 dark:text-white/50">{f.severity}</span>
              </div>
              <p className="mt-1 font-medium text-gray-900 dark:text-white">{f.title}</p>
              <p className="text-sm text-gray-600 dark:text-white/70">{f.detail}</p>
              <ul className="mt-1 text-xs text-gray-500 dark:text-white/50">
                {f.evidence.map((e, j) => <li key={j}>{e.url}</li>)}
              </ul>
              <p className="mt-1 text-sm text-gray-700 dark:text-white/80"><strong>Recommendation:</strong> {f.recommendation}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```
Add `useEffect` to the React import: `import { useEffect, useState } from 'react'`.

- [ ] **Step 5: Run to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ContentAuditCard.test.tsx`
Expected: PASS (3 tests). The mint/poll fetches use the global `fetch`; the three
render tests don't trigger them. If jsdom lacks `navigator.clipboard`, the `copy`
handler's try/catch swallows it — the render assertions still pass.

- [ ] **Step 6: Wire into the SEO tab**

In `app/(app)/ada-audit/site/[id]/page.tsx`, import the card and add it to the `seoContent` stack after `<TopicOverlapSection>` (~line 293):
```tsx
import { ContentAuditCard } from '@/components/site-audit/ContentAuditCard'
// … inside seoContent, after <TopicOverlapSection run={liveScanRun} />:
      <ContentAuditCard
        siteAuditId={audit.id}
        hasLiveScanRun={liveScanRun != null}
        initialContentAuditJson={liveScanRun?.contentAuditJson ?? null}
      />
```
Ensure the `liveScanRun` select (~line 221) includes `contentAuditJson: true` (add it to the `select`).

- [ ] **Step 7: Run gates**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run components/site-audit/ContentAuditCard.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/content-audit-prompt.ts components/site-audit/ContentAuditCard.tsx components/site-audit/ContentAuditCard.test.tsx "app/(app)/ada-audit/site/[id]/page.tsx"
git commit -m "feat(c12): ContentAuditCard on the results SEO tab + cat_ prompt builder"
```

---

### Task 11: er-handoff-memo skill `cat_` branch (release prerequisite)

**Files:**
- Modify: `~/.claude/skills/er-handoff-memo/SKILL.md` (+ `handoff.py` if the skill routes tokens there)
- Create: `~/.claude/skills/er-handoff-memo/references/content-audit.md`

**Note:** This is skill work, not app code — it does NOT go through the app gates, but it MUST land before the deploy that exposes the card (the kst_ precedent — a minted token no skill understands is a dead end). It is committed to the skill repo, not er-seo-tools.

- [ ] **Step 1: Add the cat_ branch to the skill description + routing**

In `SKILL.md`, extend the token-family list to include `cat_` (client-scoped content audit): recognize the `Content Audit ID:` + `Access token: cat_...` lines. Document the flow:
1. `GET {base}/api/content-audit/{id}/manifest` with `Authorization: Bearer cat_…`.
2. For each eligible page, `GET …/page?url=…` (fall back to web-fetch when `textAvailable:false`).
3. Analyze: cross-page fact consistency, stale claims, quality issues.
4. `PATCH …/findings` with `{ findings: [{ type, severity, title, detail, evidence:[{url,snippet}], recommendation }] }` — `type ∈ {data_inconsistency, stale_claim, quality_issue}`, `severity ∈ {info,warning,critical}`, evidence URLs MUST be from the manifest page set.

- [ ] **Step 2: Write the references doc**

Create `references/content-audit.md` with the manifest/page/findings contract, the finding schema, the honest-phrasing rules (a not-detected fact is "verify", never "confirmed wrong"), and the evidence-URL-must-be-in-audit constraint.

- [ ] **Step 3: Bump the skill version + commit in the skill repo**

Bump the `er-handoff-memo` version; commit in the skills repo (separate from er-seo-tools). Record the version in the er-seo-tools handoff doc as a deploy prerequisite.

---

## Self-Review

**Spec coverage** (each spec section → task):
- §2 token → Task 2; shared helper §2 → Task 4.
- §3 retention (stamp-before-write, DELETE-at-expiry sweep, mint extension, recovery efficiency) → Task 5 (+ mint extension in Task 6).
- §4 endpoints (mint, poll, manifest, page, findings; middleware; body-before-auth) → Tasks 6, 7, 8, 9.
- §5 ingest schema (types, caps, aggregate byte cap, evidence-URL binding, last-writer-wins, no_live_scan_run) → Task 3 (validator) + Task 8 (route).
- §6 UI → Task 10.
- §7 skill → Task 11.
- §8 config (CONTENT_AUDIT_BASE_TTL_MS, CONTENT_AUDIT_TOKEN_TTL_MS) → Task 5 / Task 2.
- §9 testing → each task's tests.
- §10 migration → Task 1.
- §11 security checklist → distributed (token audience Task 2, helper Task 4, evidence binding Task 3/8, middleware Task 9, crash-safe stamp Task 5).
- §13 Kevin-verify → deploy checklist (recorded in the handoff, not a code task).

**Placeholder scan:** no TBD/TODO; every code step has real code. The only "optional" is the poll `useEffect` in Task 10 (on-load render already covers correctness).

**Type consistency:** `mintContentAuditToken`/`verifyContentAuditToken`/`CONTENT_AUDIT_TOKEN_SCOPES`/`CONTENT_AUDIT_TOKEN_TTL_MS` (Task 2) used verbatim in Tasks 4/6. `validateContentAuditFindings(input, allowedUrls, now)` (Task 3) matches the call in Task 8. `contentAuditEligibleUrls` / `loadContentAuditManifest` / `loadContentAuditPageText` (Task 7) match Tasks 7/8. `requireContentAuditToken(req, siteAuditId, scope)` (Task 4) matches Tasks 7/8. `sweepExpiredContentAudit(now)` (Task 5) matches `cleanup.ts` + `stale-audit-reset.ts` wiring. `ContentAuditCard` prop names match Task 10's page wiring.

**Gate note:** run the full `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npm test && npm run build` once at the end (before PR), not only per-task subsets.
