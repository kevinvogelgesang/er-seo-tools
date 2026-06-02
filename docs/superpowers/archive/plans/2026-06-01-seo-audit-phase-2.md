# SEO Audit Overhaul — Phase 2 Implementation Plan (Roadmap Handoff)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the loop — a "Generate Roadmap" action mints a short-lived token, an external `seo-audit-roadmap` Claude skill fetches the audit payload and writes a prioritized technical-SEO roadmap back via PATCH, and the app renders it in a card on the results page.

**Architecture:** A direct mirror of the existing **pillar-analysis** handoff (`PillarAnalysis` model + `lib/pillar-token.ts` + mint-token/GET-payload/PATCH-narrative routes + clipboard prompt + `MemoPoller` + `MemoMarkdown`). Two deliberate differences: (1) **no deterministic pre-analysis** — the GET payload is simply `buildTechnicalAuditExport(session.result)` (built in Phase 1); (2) the roadmap **renders as a card on the SEO results page** (not a separate page). The token/auth pattern is **copied, not abstracted** (per spec).

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, `jose` (JWT, already a dep), `react-markdown` (already a dep), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-seo-audit-overhaul-design.md` (Phase 2 + §8). **Template feature:** `app/pillar-analysis/`, `lib/pillar-token.ts`, `lib/pillar-prompt.ts`, `app/api/pillar-analysis/**`.

**Verify with:** `npx tsc --noEmit` · `npx vitest run <path>` · `npm run build`. Migrations: `npx prisma migrate dev --name <name>` (regenerates client).

> **Note on the Claude skill (Task 10):** the `seo-audit-roadmap` skill lives in `~/.claude/skills/` (user-scoped, like `pillar-analysis-narrative`) — it is NOT part of the repo PR. It's listed here for completeness of the feature.

---

## Design decisions (locked)

- **One roadmap per session** — `SeoRoadmap.sessionId @unique` (mirrors `PillarAnalysis`).
- **Created lazily on mint** — no auto-trigger. The results page knows `sessionId`; mint is keyed by `sessionId`, creates-or-loads the row, returns its `id` + token.
- **Token:** separate secret `SEO_ROADMAP_TOKEN_SECRET`, prefix `srt_`, audience `seo-audit-roadmap`, scopes `['read','roadmap-write']`, 1h TTL. Copied from `lib/pillar-token.ts`.
- **Status lifecycle:** `pending` (row created) → `processing` (token minted / prompt copied; `tokenMintedAt` set) → `complete` (PATCH received) → `error` (explicit). Mint is gated on `session.status === 'complete'`.
- **Routes** (mirroring pillar; `by-session` static segment coexists with `[id]` dynamic, exactly as pillar does):
  - `POST /api/seo-roadmap/by-session/[sessionId]/mint-token`
  - `GET  /api/seo-roadmap/[id]` (payload for the skill)
  - `PATCH /api/seo-roadmap/[id]/roadmap` (write-back)
  - `GET  /api/seo-roadmap/by-session/[sessionId]` (polling)
- **Render:** `SeoRoadmapCard` (client) in `ResultsView`, reusing the existing `lib/memo-poller-machine.ts` + `lib/memo-poller-events.ts`; markdown via `react-markdown`.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `prisma/schema.prisma` + migration | `SeoRoadmap` model; `Session.seoRoadmap` relation | 1 |
| `lib/seo-roadmap-token.ts` (+ test) | mint/verify `srt_` JWT (copy of pillar-token) | 2 |
| `lib/seo-roadmap-prompt.ts` (+ test) | `composeRoadmapPayload()` clipboard text | 3 |
| `app/api/seo-roadmap/by-session/[sessionId]/mint-token/route.ts` (+ test) | get-or-create row, gate, mint | 4 |
| `app/api/seo-roadmap/[id]/route.ts` (+ test) | GET payload = `buildTechnicalAuditExport` | 5 |
| `app/api/seo-roadmap/[id]/roadmap/route.ts` (+ test) | PATCH write-back | 6 |
| `app/api/seo-roadmap/by-session/[sessionId]/route.ts` (+ test) | poll status/markdown | 7 |
| `components/seo-parser/GenerateRoadmapButton.tsx` | mint + copy prompt (client) | 8 |
| `components/seo-parser/SeoRoadmapCard.tsx` + `RoadmapMarkdown.tsx` | render + poll | 9 |
| `app/seo-parser/results/[sessionId]/page.tsx` + `components/seo-parser/ResultsView.tsx` | wire button + card | 9 |
| `~/.claude/skills/seo-audit-roadmap/` (out of repo) | the Claude skill | 10 |

---

## Task 1: `SeoRoadmap` Prisma model + migration

**Files:** Modify `prisma/schema.prisma`; generate a migration.

- [ ] **Step 1: Add the model** (place near `PillarAnalysis`, ~line 137):

```prisma
model SeoRoadmap {
  id                String   @id @default(cuid())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  sessionId         String   @unique
  session           Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  status            String   @default("pending") // pending | processing | complete | error
  error             String?
  tokenMintedAt     DateTime?

  // Write-back from the Claude skill
  roadmapMarkdown   String?
  structured        String?   // JSON (optional; Teamwork uses this in Phase 4)
  roadmapUpdatedAt  DateTime?

  @@index([sessionId, status])
  @@index([status])
  @@index([createdAt])
}
```

- [ ] **Step 2: Add the relation field to `Session`** (in the `Session` model, next to `pillarAnalyses`):

```prisma
  seoRoadmap      SeoRoadmap?
```

- [ ] **Step 3: Generate the migration**

Run: `npx prisma migrate dev --name seo_roadmap`
Expected: creates `prisma/migrations/<ts>_seo_roadmap/migration.sql` and regenerates the client. Verify the SQL has a `CREATE TABLE "SeoRoadmap"` and a unique index on `sessionId`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (the regenerated client now knows `prisma.seoRoadmap`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(seo): SeoRoadmap model + migration"
```
(End every commit body in this plan with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: `lib/seo-roadmap-token.ts` (+ test)

**Files:** Create `lib/seo-roadmap-token.ts`, `lib/seo-roadmap-token.test.ts`. This is a near-verbatim copy of `lib/pillar-token.ts` with renamed constants — read `lib/pillar-token.ts` first.

- [ ] **Step 1: Write the failing test** `lib/seo-roadmap-token.test.ts` — mirror `lib/pillar-token.test.ts` (read it for structure). Cover: mint returns `srt_`-prefixed token + ISO `expiresAt`; verify round-trips and returns scopes; verify rejects a token whose `sub` ≠ expected id; verify rejects a non-`srt_` token. Example core cases:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { mintSeoRoadmapToken, verifySeoRoadmapToken, SeoRoadmapTokenError } from './seo-roadmap-token';

beforeAll(() => { process.env.SEO_ROADMAP_TOKEN_SECRET = 'test-secret-seo-roadmap'; });

describe('seo-roadmap-token', () => {
  it('mints a srt_-prefixed token and verifies it round-trip', async () => {
    const { token, expiresAt } = await mintSeoRoadmapToken('rm_123');
    expect(token.startsWith('srt_')).toBe(true);
    expect(typeof expiresAt).toBe('string');
    const payload = await verifySeoRoadmapToken(token, 'rm_123');
    expect(payload.sub).toBe('rm_123');
    expect(payload.scope).toEqual(['read', 'roadmap-write']);
  });
  it('rejects a token for a different roadmap id', async () => {
    const { token } = await mintSeoRoadmapToken('rm_123');
    await expect(verifySeoRoadmapToken(token, 'rm_999')).rejects.toBeInstanceOf(SeoRoadmapTokenError);
  });
  it('rejects a token without the srt_ prefix', async () => {
    await expect(verifySeoRoadmapToken('pat_whatever', 'rm_123')).rejects.toBeInstanceOf(SeoRoadmapTokenError);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run lib/seo-roadmap-token.test.ts`; verify FAIL.

- [ ] **Step 3: Implement** `lib/seo-roadmap-token.ts` (copy of pillar-token with these changes: `ISSUER='er-seo-tools'`, `AUDIENCE='seo-audit-roadmap'`, `TOKEN_PREFIX='srt_'`, secret env `SEO_ROADMAP_TOKEN_SECRET`, dev fallback `'dev-seo-roadmap-secret-do-not-use-in-prod'`, scopes `['read','roadmap-write']`, class `SeoRoadmapTokenError`, functions `mintSeoRoadmapToken(roadmapId)` / `verifySeoRoadmapToken(token, expectedRoadmapId)`, `MintedToken` interface identical). Keep the production-requires-secret guard and the dev-fallback warning exactly as in pillar-token.

- [ ] **Step 4:** Run the test; PASS. `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/seo-roadmap-token.ts lib/seo-roadmap-token.test.ts
git commit -m "feat(seo): seo-roadmap JWT mint/verify (srt_ tokens)"
```

---

## Task 3: `lib/seo-roadmap-prompt.ts` (+ test)

**Files:** Create `lib/seo-roadmap-prompt.ts`, `lib/seo-roadmap-prompt.test.ts`. Mirror `lib/pillar-prompt.ts` (`composePayload`).

- [ ] **Step 1: Failing test:**

```typescript
import { describe, it, expect } from 'vitest';
import { composeRoadmapPayload } from './seo-roadmap-prompt';

describe('composeRoadmapPayload', () => {
  it('includes webapp, roadmap id, token, and the srt_ line', () => {
    const out = composeRoadmapPayload({ webappUrl: 'https://app.example', roadmapId: 'rm_1', token: 'srt_abc' });
    expect(out).toContain('Webapp: https://app.example');
    expect(out).toContain('Roadmap ID: rm_1');
    expect(out).toContain('Access token: srt_abc');
  });
});
```

- [ ] **Step 2:** Run `npx vitest run lib/seo-roadmap-prompt.test.ts`; FAIL.

- [ ] **Step 3: Implement:**

```typescript
export interface RoadmapPromptArgs {
  webappUrl: string;
  roadmapId: string;
  token: string;
}

export function composeRoadmapPayload({ webappUrl, roadmapId, token }: RoadmapPromptArgs): string {
  return [
    'Generate a technical SEO roadmap for this site.',
    '',
    `Webapp: ${webappUrl}`,
    `Roadmap ID: ${roadmapId}`,
    `Access token: ${token}`,
    '(Expires in 1h)',
    '',
    'Fetch the audit payload, write the prioritized technical-SEO roadmap, and post it back to the dashboard.',
  ].join('\n');
}
```

- [ ] **Step 4:** Test PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/seo-roadmap-prompt.ts lib/seo-roadmap-prompt.test.ts
git commit -m "feat(seo): roadmap clipboard prompt composer"
```

---

## Task 4: Mint-token route (by session)

**Files:** Create `app/api/seo-roadmap/by-session/[sessionId]/mint-token/route.ts` + `route.test.ts`. Mirror `app/api/pillar-analysis/[id]/mint-token/route.ts` (read it + its test for the auth-cookie mock pattern).

- [ ] **Step 1: Implement the route:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTH_COOKIE_NAME, isValidAuthCookie } from '@/lib/auth';
import { mintSeoRoadmapToken, SeoRoadmapTokenError } from '@/lib/seo-roadmap-token';

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  if (!(await isValidAuthCookie(req.cookies.get(AUTH_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (session.status !== 'complete') {
    return NextResponse.json({ error: 'session_not_complete', status: session.status }, { status: 409 });
  }

  // Get-or-create the roadmap row (one per session) as 'pending'. Catch ONLY the unique race (P2002);
  // rethrow any other Prisma/DB error so real schema/migration failures aren't swallowed.
  let roadmap = await prisma.seoRoadmap.findUnique({ where: { sessionId } });
  if (!roadmap) {
    try {
      roadmap = await prisma.seoRoadmap.create({ data: { sessionId } }); // defaults to status='pending'
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        roadmap = await prisma.seoRoadmap.findUnique({ where: { sessionId } });
      } else {
        throw err;
      }
      if (!roadmap) return NextResponse.json({ error: 'roadmap_unavailable' }, { status: 500 });
    }
  }

  // Mint FIRST — only flip to 'processing' once we actually have a token to hand out.
  let minted;
  try {
    minted = await mintSeoRoadmapToken(roadmap.id);
  } catch (err) {
    if (err instanceof SeoRoadmapTokenError) {
      console.error('[seo-roadmap-token] mint failed:', err.message);
      await prisma.seoRoadmap.update({
        where: { id: roadmap.id },
        data: { status: 'error', error: 'token_service_unavailable' },
      });
      return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
    }
    throw err;
  }

  await prisma.seoRoadmap.update({
    where: { id: roadmap.id },
    data: { status: 'processing', tokenMintedAt: new Date(), error: null }, // clear any stale error on a fresh run
  });
  return NextResponse.json({ ...minted, roadmapId: roadmap.id });
}
```

- [ ] **Step 2: Test** `route.test.ts` — mirror the pillar mint-token test EXACTLY (read `app/api/pillar-analysis/[id]/mint-token/route.test.ts`). IMPORTANT: pillar's mint test does **not** `vi.mock('@/lib/auth')` — it builds a real valid cookie via `createAuthCookieValue()` with `APP_AUTH_PASSWORD` stubbed in the env. Copy that exact auth-setup pattern (real cookie), not a mock of `isValidAuthCookie`. Cover:
  - 401 when no/invalid auth cookie
  - 404 for missing session; 409 when `session.status !== 'complete'`
  - 200 returns `{ token: 'srt_…', expiresAt, roadmapId }` and the row is now `status: 'processing'` with `tokenMintedAt` set — for (a) **no existing row** (create path) and (b) **an existing row** (regenerate path)
  - the **unique-race** path: `create` throws a `Prisma.PrismaClientKnownRequestError` with `code: 'P2002'`, then `findUnique` returns the row → still 200 (mock prisma to simulate this)
  - mint failure: `mintSeoRoadmapToken` throws `SeoRoadmapTokenError` → 500 and the row is set to `status: 'error'`
  Mock `@/lib/db` `prisma` for session + seoRoadmap calls following pillar's prisma-mock style.

- [ ] **Step 3:** Run the test → PASS; `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/seo-roadmap/by-session/[sessionId]/mint-token/route.ts" "app/api/seo-roadmap/by-session/[sessionId]/mint-token/route.test.ts"
git commit -m "feat(seo): roadmap mint-token route (get-or-create per session)"
```

---

## Task 5: GET payload route

**Files:** Create `app/api/seo-roadmap/[id]/route.ts` + `route.test.ts`. Mirror `app/api/pillar-analysis/[id]/route.ts` (Bearer parse + verify + scope check), but the payload is `buildTechnicalAuditExport`.

- [ ] **Step 1: Implement:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifySeoRoadmapToken, SeoRoadmapTokenError } from '@/lib/seo-roadmap-token';
import { buildTechnicalAuditExport } from '@/lib/parsers/claude-export-builder';
import type { AggregatedResult } from '@/lib/types';

function tokenErrorCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('expired')) return 'token_expired';
  if (m.includes('does not match')) return 'token_wrong_roadmap_id';
  if (m.includes('signature')) return 'token_invalid_signature';
  return 'token_invalid';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'auth_missing' }, { status: 401 });
  const match = authHeader.match(/^Bearer\s+(srt_\S+)$/);
  if (!match) return NextResponse.json({ error: 'auth_malformed' }, { status: 401 });

  let payload;
  try {
    payload = await verifySeoRoadmapToken(match[1], id);
  } catch (err) {
    if (err instanceof SeoRoadmapTokenError) return NextResponse.json({ error: tokenErrorCode(err.message) }, { status: 401 });
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
  }
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
  if (!scopes.includes('read')) return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 });

  const roadmap = await prisma.seoRoadmap.findUnique({ where: { id }, include: { session: true } });
  if (!roadmap) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!roadmap.session.result) return NextResponse.json({ error: 'session_result_missing' }, { status: 409 });

  let result: AggregatedResult;
  try {
    result = JSON.parse(roadmap.session.result) as AggregatedResult;
  } catch {
    return NextResponse.json({ error: 'session_result_invalid' }, { status: 500 });
  }

  return NextResponse.json({
    id: roadmap.id,
    sessionId: roadmap.sessionId,
    siteName: roadmap.session.siteName,
    status: roadmap.status,
    audit: buildTechnicalAuditExport(result),
  });
}
```

- [ ] **Step 2: Test** — mirror `app/api/pillar-analysis/[id]/route.test.ts`. Cover: 401 missing/malformed auth; 401 invalid token; 401 token_missing_scope (mint a token then strip scope — or mock verify to return a scopeless payload); 200 returns `audit` with the embedded `url_registry`/`page_index` for a valid token + a session whose `result` is a JSON `AggregatedResult`. Mint a real token via `mintSeoRoadmapToken(id)` and pass `Authorization: Bearer <token>`; mock prisma to return a roadmap with `session.result = JSON.stringify(minimalAggregatedResult)`.

- [ ] **Step 3:** Test PASS; `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/seo-roadmap/[id]/route.ts" "app/api/seo-roadmap/[id]/route.test.ts"
git commit -m "feat(seo): roadmap GET payload route (buildTechnicalAuditExport)"
```

---

## Task 6: PATCH write-back route

**Files:** Create `app/api/seo-roadmap/[id]/roadmap/route.ts` + `route.test.ts`. Mirror `app/api/pillar-analysis/[id]/narrative/route.ts` (validate body before auth, Bearer + `roadmap-write` scope, 50k cap).

- [ ] **Step 1: Implement:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifySeoRoadmapToken, SeoRoadmapTokenError } from '@/lib/seo-roadmap-token';

const REQUIRED_SCOPE = 'roadmap-write';
const MAX_ROADMAP_CHARS = 50_000;
const MAX_STRUCTURED_CHARS = 200_000; // generous cap; structured JSON still must not be unbounded

function tokenErrorCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('expired')) return 'token_expired';
  if (m.includes('does not match')) return 'token_wrong_roadmap_id';
  if (m.includes('signature')) return 'token_invalid_signature';
  return 'token_invalid';
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { roadmap?: unknown; structured?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (typeof body.roadmap !== 'string' || body.roadmap.length === 0) {
    return NextResponse.json({ error: 'roadmap_required' }, { status: 400 });
  }
  if (body.roadmap.length > MAX_ROADMAP_CHARS) {
    return NextResponse.json({ error: 'roadmap_too_long' }, { status: 400 });
  }
  const roadmapMarkdown = body.roadmap;
  let structured: string | undefined;
  if (body.structured !== undefined) {
    structured = JSON.stringify(body.structured);
    if (structured.length > MAX_STRUCTURED_CHARS) {
      return NextResponse.json({ error: 'structured_too_long' }, { status: 400 });
    }
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'auth_missing' }, { status: 401 });
  const match = authHeader.match(/^Bearer\s+(srt_\S+)$/);
  if (!match) return NextResponse.json({ error: 'auth_malformed' }, { status: 401 });

  let payload;
  try {
    payload = await verifySeoRoadmapToken(match[1], id);
  } catch (err) {
    if (err instanceof SeoRoadmapTokenError) return NextResponse.json({ error: tokenErrorCode(err.message) }, { status: 401 });
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
  }
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
  if (!scopes.includes(REQUIRED_SCOPE)) return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 });

  const existing = await prisma.seoRoadmap.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const now = new Date();
  const updated = await prisma.seoRoadmap.update({
    where: { id },
    data: { roadmapMarkdown, ...(structured !== undefined ? { structured } : {}), status: 'complete', error: null, roadmapUpdatedAt: now },
  });
  return NextResponse.json({ ok: true, updatedAt: (updated.roadmapUpdatedAt ?? now).toISOString() });
}
```

- [ ] **Step 2: Test** — mirror `app/api/pillar-analysis/[id]/narrative/route.test.ts`. Cover: 400 invalid_json; 400 roadmap_required (empty/missing); 400 roadmap_too_long (>50k); 401 missing/malformed/invalid token; 401 token_missing_scope; 200 writes `roadmapMarkdown`, sets `status='complete'`, returns `updatedAt`. Mint a real token for the id.

- [ ] **Step 3:** Test PASS; `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/seo-roadmap/[id]/roadmap/route.ts" "app/api/seo-roadmap/[id]/roadmap/route.test.ts"
git commit -m "feat(seo): roadmap PATCH write-back route"
```

---

## Task 7: by-session polling route

**Files:** Create `app/api/seo-roadmap/by-session/[sessionId]/route.ts` + `route.test.ts`. Mirror `app/api/pillar-analysis/by-session/[sessionId]/route.ts`.

- [ ] **Step 1: Implement:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const rm = await prisma.seoRoadmap.findUnique({ where: { sessionId } });
  if (!rm) return NextResponse.json({ seoRoadmap: null });
  return NextResponse.json({
    seoRoadmap: {
      id: rm.id,
      sessionId: rm.sessionId,
      status: rm.status,
      error: rm.error,
      roadmapMarkdown: rm.roadmapMarkdown,
      roadmapUpdatedAt: rm.roadmapUpdatedAt,
      createdAt: rm.createdAt,
      updatedAt: rm.updatedAt,
    },
  });
}
```

- [ ] **Step 2: Test** — mirror the pillar by-session test: returns `{ seoRoadmap: null }` when none; returns the shaped object when present.

- [ ] **Step 3:** Test PASS; `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/seo-roadmap/by-session/[sessionId]/route.ts" "app/api/seo-roadmap/by-session/[sessionId]/route.test.ts"
git commit -m "feat(seo): roadmap by-session polling route"
```

---

## Task 8: "Generate Roadmap" button (client)

**Files:** Create `components/seo-parser/GenerateRoadmapButton.tsx`. Mirror `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx` (mint → compose → clipboard, with `emitMemoPollerTrigger()` to wake the poller).

- [ ] **Step 1: Implement** (read CopyClaudePromptButton.tsx + ClipboardFallbackModal.tsx for the exact clipboard/fallback pattern; reuse `emitMemoPollerTrigger` from `@/lib/memo-poller-events`):

```tsx
'use client';
import { useState } from 'react';
import { composeRoadmapPayload } from '@/lib/seo-roadmap-prompt';
import { emitMemoPollerTrigger } from '@/lib/memo-poller-events';

export function GenerateRoadmapButton({ sessionId, hasRoadmap }: { sessionId: string; hasRoadmap: boolean }) {
  const [state, setState] = useState<'idle' | 'minting' | 'copied' | 'mint-failed' | 'service-error'>('idle');
  const webappUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  const onClick = async () => {
    if (state === 'minting') return;
    setState('minting');
    try {
      const res = await fetch(`/api/seo-roadmap/by-session/${sessionId}/mint-token`, { method: 'POST' });
      if (res.status === 500) { setState('service-error'); setTimeout(() => setState('idle'), 4000); return; }
      if (!res.ok) { setState('mint-failed'); setTimeout(() => setState('idle'), 3000); return; }
      const { token, roadmapId } = (await res.json()) as { token: string; roadmapId: string };
      const payload = composeRoadmapPayload({ webappUrl, roadmapId, token });
      try {
        await navigator.clipboard.writeText(payload);
        setState('copied');
        emitMemoPollerTrigger();
        setTimeout(() => setState('idle'), 2000);
      } catch {
        // Minimal fallback: prompt() so the user can copy manually (or mirror ClipboardFallbackModal if richer UX desired)
        window.prompt('Copy this prompt for the seo-audit-roadmap skill:', payload);
        emitMemoPollerTrigger();
        setState('idle');
      }
    } catch {
      setState('mint-failed'); setTimeout(() => setState('idle'), 3000);
    }
  };

  const label = state === 'minting' ? 'Minting…'
    : state === 'copied' ? 'Copied!'
    : state === 'mint-failed' ? 'Mint failed — retry'
    : state === 'service-error' ? 'Token service unavailable'
    : hasRoadmap ? 'Regenerate Roadmap' : 'Generate Roadmap';

  return (
    <button onClick={onClick} disabled={state === 'minting'}
      className="px-4 py-2 rounded-lg text-sm font-medium bg-[#1c2d4a] hover:bg-[#0f1d30] text-white disabled:opacity-60">
      {label}
    </button>
  );
}
```

NOTE: confirm `emitMemoPollerTrigger` is exported from `@/lib/memo-poller-events` and is generic (not pillar-specific). If it's coupled to pillar, either reuse as-is (it's a global pub/sub) or skip the call — the poller also self-starts. Report which.

- [ ] **Step 2:** `npx tsc --noEmit` (UI compiles).

- [ ] **Step 3: Commit**

```bash
git add components/seo-parser/GenerateRoadmapButton.tsx
git commit -m "feat(seo): Generate Roadmap button (mint + copy prompt)"
```

---

## Task 9: Roadmap card + poller, wired into results page

**Files:** Create `components/seo-parser/RoadmapMarkdown.tsx`, `components/seo-parser/SeoRoadmapCard.tsx`; modify `components/seo-parser/ResultsView.tsx` and `app/seo-parser/results/[sessionId]/page.tsx`.

- [ ] **Step 1: `RoadmapMarkdown.tsx`** — mirror `app/pillar-analysis/[id]/components/MemoMarkdown.tsx` (read it): a `react-markdown` renderer with the same component overrides (h2/h3/p/ul/ol/li/strong/em/code, dark-mode classes, no `rehype-raw`).

- [ ] **Step 2: `SeoRoadmapCard.tsx`** (client) — mirror `StrategicMemoCard.tsx` + `MemoPoller.tsx`. It receives `{ sessionId, initialStatus, initialRoadmapMarkdown, initialRoadmapUpdatedAt }` (note `initialStatus`: `'none' | 'pending' | 'processing' | 'complete' | 'error'`). Renders the markdown when present, else a "not yet generated — click Generate Roadmap" empty state. Reuses the existing poller machine (read `lib/memo-poller-machine.ts` — the real factory export is **`createPollingMachine`**, NOT `createMemoPollerMachine`) but polls `/api/seo-roadmap/by-session/${sessionId}` and reads `body?.seoRoadmap?.roadmapUpdatedAt`; on change calls `router.refresh()`. Read `MemoPoller.tsx` and copy its poller wiring exactly, swapping ONLY the endpoint and the response field path. **Do NOT import `MemoPoller` directly** — it hardcodes the pillar endpoint/response; copy the wiring into this component.

  **Auto-start rule (important — differs from pillar):** SEO roadmap rows are lazy/manual, so do NOT auto-poll on every results page that lacks a roadmap. Auto-start polling only when `initialStatus === 'processing'`. Otherwise start polling on the `onMemoPollerTrigger` event the `GenerateRoadmapButton` emits after a successful mint. (Pillar auto-starts whenever there's no memo because its analysis row always pre-exists; ours does not.)

  Include `GenerateRoadmapButton` in this card's header; pass `hasRoadmap={!!initialRoadmapMarkdown}`.

```tsx
'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPollingMachine } from '@/lib/memo-poller-machine'; // real export name — verify on read
import { onMemoPollerTrigger } from '@/lib/memo-poller-events';
import { RoadmapMarkdown } from './RoadmapMarkdown';
import { GenerateRoadmapButton } from './GenerateRoadmapButton';

// ... poller wiring copied from MemoPoller.tsx:
//   endpoint = `/api/seo-roadmap/by-session/${sessionId}`
//   latest   = body?.seoRoadmap?.roadmapUpdatedAt
//   on change -> router.refresh()
//   autoStartOnMount = initialStatus === 'processing'
//   also start on onMemoPollerTrigger(...) (button emits after mint)
```
(Read `MemoPoller.tsx` + `lib/memo-poller-machine.ts` for the exact machine API and copy it faithfully — do not invent a new poller. Confirm the real factory/export names on read and use them.)

- [ ] **Step 3: Wire into `ResultsView.tsx`** — add a `roadmap?: React.ReactNode` prop (mirroring the existing `pillarButton?` prop pattern) and render `{roadmap}` as a full-width section below `SuggestedPriorities` (or near the recommendations). Keep the header buttons as-is.

- [ ] **Step 4: Wire into the page** `app/seo-parser/results/[sessionId]/page.tsx` — server-load the existing roadmap (`prisma.seoRoadmap.findUnique({ where: { sessionId } })`), and pass `roadmap={<SeoRoadmapCard sessionId={sessionId} initialStatus={rm?.status ?? 'none'} initialRoadmapMarkdown={rm?.roadmapMarkdown ?? null} initialRoadmapUpdatedAt={rm?.roadmapUpdatedAt?.toISOString() ?? null} />}` into `ResultsView`.

- [ ] **Step 5:** `npx tsc --noEmit && npm run build`. Both PASS.

- [ ] **Step 6: Commit**

```bash
git add components/seo-parser/RoadmapMarkdown.tsx components/seo-parser/SeoRoadmapCard.tsx components/seo-parser/ResultsView.tsx "app/seo-parser/results/[sessionId]/page.tsx"
git commit -m "feat(seo): roadmap card + poller rendered on results page"
```

---

## Task 10: `seo-audit-roadmap` Claude skill (out of repo)

**Files:** Create `~/.claude/skills/seo-audit-roadmap/SKILL.md` (+ README.md, version.txt). Mirror `~/.claude/skills/pillar-analysis-narrative/`.

- [ ] **Step 1:** Read `~/.claude/skills/pillar-analysis-narrative/SKILL.md` and `README.md`. Create a parallel skill that:
  - Activates on a clipboard payload containing the lines `Webapp:`, `Roadmap ID:`, and `Access token: srt_…`.
  - `GET {webappUrl}/api/seo-roadmap/{roadmapId}` with `Authorization: Bearer {token}` → receives `{ siteName, audit }` where `audit` is the `TechnicalAuditExport` (crawl_summary, issues with `affectedUrlRefs`/`affectedUrlSource`, url_registry, page_index, performance, duplicate_content, recommendations).
  - Writes a **prioritized technical-SEO roadmap** in markdown: grouped by impact×effort, each item = issue, severity, affected-URL count (rehydrate refs via `url_registry`; **honor `affectedUrlSource` — say "sample" when not `derived-page-index`**), and concrete fix guidance. Include a short exec summary.
  - `PATCH {webappUrl}/api/seo-roadmap/{roadmapId}/roadmap` with `{ "roadmap": "<markdown>" }` (optionally `structured`).
  - Re-PATCHes automatically on in-chat revision (dashboard is source of truth).

- [ ] **Step 2:** This is documentation/skill content — no repo tests. Verify the GET→PATCH round-trip manually against a dev session during Phase 2 verification (see exit checklist). Not committed to the repo PR; note its path in the PR description.

---

## Phase 2 Exit Verification

- [ ] `npx tsc --noEmit` clean; `npx vitest run lib app/api/seo-roadmap` green; `npm run build` succeeds.
- [ ] Migration applied cleanly; `prisma.seoRoadmap` available.
- [ ] Manual end-to-end on a real parsed session: click **Generate Roadmap** → prompt copied (token `srt_…`) → run the `seo-audit-roadmap` skill in Claude Desktop → it GETs the payload, writes a roadmap, PATCHes back → the **SeoRoadmapCard polls and renders the markdown** without a manual refresh → button now reads "Regenerate Roadmap".
- [ ] Token negative cases: expired/wrong-id/wrong-scope return 401 with the right codes.
- [ ] `SEO_ROADMAP_TOKEN_SECRET` documented for production (add to deploy env notes / `ecosystem.config.js` the same way `PILLAR_TOKEN_SECRET` is set).

## Out of scope (later phases)
- Structured roadmap → Teamwork task push (Phase 4; `structured` column is reserved now).
- Per-client history/trend (Phase 5). Keyword research route (Phase 6).

## Notes / risk
- **`emitMemoPollerTrigger`/`memo-poller-machine` reuse:** these are generic (global pub/sub + pure state machine). Reuse as-is; if any pillar-specific coupling surfaces, copy the ~40-line machine into a shared util rather than forking behavior. Report if reuse isn't clean.
- **Route namespace:** `by-session` (static) and `[id]` (dynamic) coexist under `/api/seo-roadmap/` — verified safe because pillar-analysis does the identical thing. Static wins, so a roadmap id literally equal to `by-session` is impossible (cuid()).
- **`NEXT_PUBLIC_APP_URL`** must be set so the copied prompt points the skill at the right host (same requirement as pillar). Fall back to `window.location.origin` client-side.
