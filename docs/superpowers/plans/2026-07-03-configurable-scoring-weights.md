# Configurable SEO Scoring Weights + Explanation Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two factor-weighted SEO scorers read an operator-editable global weight profile and persist a per-factor breakdown so each score can be explained on the results pages.

**Architecture:** One global `ScoringWeights` singleton row (id=1) + a `CrawlRun.scoreBreakdown` JSON column. Both scorers become pure `(inputs, weights) → {score, factors}`; the DB-aware callers (`writeSeoFindings`, `broken-link-verify`) resolve weights and persist `score` + `scoreBreakdown` from one call. A `/settings` card edits the weights via a cookie-gated route. A `ScoreExplanation` component reads the persisted breakdown (archived-safe, no recompute).

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Tailwind (class-based dark mode), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-configurable-scoring-weights-design.md` (Codex-reviewed). **This plan incorporates the Codex plan-review fixes (2026-07-03):** compile-green commit boundaries (scorer refactor + callers land together), split pure-vs-server weights modules (client card must not bundle Prisma), accurate `parity.ts`/`seo-write.test.ts` edits, an added health-score display on the parser results page, `ScoreExplanation` empty-factors semantics, jsdom pragma, and exact wiring names.

## Global Constraints

- **Array-form `$transaction([...])` only** — never interactive. (The weights write is a single `upsert`.)
- **Local prisma CLI + vitest MUST be prefixed** `DATABASE_URL="file:./local-dev.db"` (resolves to `prisma/local-dev.db`).
- **`prisma migrate dev` is interactive-only here** — hand-author migration SQL, apply with `migrate deploy` + `generate`.
- **SQLite:** additive only (new table + nullable column) — no `ALTER COLUMN`.
- **Dark mode:** every new UI element carries `dark:` variants (`bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, `border-gray-*`→`dark:border-navy-border`).
- **New route:** NOT in `middleware.ts` `isPublicPath` (cookie-gated); add a `middleware.test.ts` assertion it stays non-public.
- **DB-backed tests that write a score** (any test calling `writeSeoFindings` or the broken-link builder, and the weights tests) MUST reset the `ScoringWeights` singleton to defaults / delete `id=1` in `afterEach`, so a stored profile can never skew an expected score and tests stay order-independent.
- **Every commit must be compile-green** (`npm run lint` passes) — a scorer whose return type changes lands in the SAME commit as all its updated callers.
- **Client/server split:** pure scoring constants/types/validation live in `lib/scoring/weights.ts` (NO `prisma` import — safe to import from client components). The DB read `resolveScoringWeights` lives in a separate server module `lib/scoring/resolve-weights.ts`.
- **Gate before PR:** `npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`, all green.
- **Purity invariant:** the two scorers never touch the DB — weights are passed in.
- **"Perfect inputs → exactly 100"** holds for any valid weights.

---

### Task 1: Schema — `ScoringWeights` table + `CrawlRun.scoreBreakdown`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_configurable_scoring_weights/migration.sql`
- Modify: `lib/findings/types.ts:42` (add `scoreBreakdown` to `CrawlRunInput`)

**Interfaces:**
- Produces: model `ScoringWeights`; `CrawlRun.scoreBreakdown String?`; `CrawlRunInput.scoreBreakdown?: string | null`.

- [ ] **Step 1: Add the Prisma model + column**

In `prisma/schema.prisma`:
```prisma
model ScoringWeights {
  id           Int      @id @default(1)   // singleton — all writes use upsert({ where: { id: 1 } })
  indexability Float    @default(20)
  errorRate    Float    @default(20)
  missingTitle Float    @default(10)
  missingMeta  Float    @default(8)
  missingH1    Float    @default(7)
  crawlDepth   Float    @default(15)      // health-score only; live SEO ignores it
  thinContent  Float    @default(10)
  schema       Float    @default(10)
  updatedAt    DateTime @updatedAt
}
```
On `model CrawlRun`, after the `score` line:
```prisma
  scoreBreakdown  String?    // JSON { version, scorer, score, factors[] }; sf-upload + live-scan only
```

- [ ] **Step 2: Hand-author the migration SQL**

Create `prisma/migrations/20260703120000_configurable_scoring_weights/migration.sql`:
```sql
-- CreateTable
CREATE TABLE "ScoringWeights" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "indexability" REAL NOT NULL DEFAULT 20,
    "errorRate" REAL NOT NULL DEFAULT 20,
    "missingTitle" REAL NOT NULL DEFAULT 10,
    "missingMeta" REAL NOT NULL DEFAULT 8,
    "missingH1" REAL NOT NULL DEFAULT 7,
    "crawlDepth" REAL NOT NULL DEFAULT 15,
    "thinContent" REAL NOT NULL DEFAULT 10,
    "schema" REAL NOT NULL DEFAULT 10,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
ALTER TABLE "CrawlRun" ADD COLUMN "scoreBreakdown" TEXT;
```
(No raw `CHECK (id=1)` — Codex flagged it as drift-risk vs the Prisma schema; the `upsert` enforces the singleton.)

- [ ] **Step 3: Apply migration, regenerate, and confirm no drift**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate && \
DATABASE_URL="file:./local-dev.db" npx prisma migrate status
```
Expected: "1 migration applied", client regenerated, and `migrate status` reports "Database schema is up to date!" (no drift between the hand SQL and the schema).

- [ ] **Step 4: Add `scoreBreakdown` to `CrawlRunInput`**

In `lib/findings/types.ts`, after `score: number | null`:
```ts
  scoreBreakdown?: string | null   // JSON breakdown; sf-upload + live-scan runs only
```
`writeFindingsRun` spreads `bundle.run` into `crawlRun.create` (writer.ts:40) → the field flows through with no writer change.

- [ ] **Step 5: Verify compile + commit**

```bash
npm run lint   # expect PASS
git add prisma/schema.prisma prisma/migrations lib/findings/types.ts
git commit -m "feat(scoring): ScoringWeights singleton + CrawlRun.scoreBreakdown (C8 schema)"
```

---

### Task 2: Weights modules — pure `weights.ts` + server `resolve-weights.ts`

**Files:**
- Create: `lib/scoring/weights.ts` (pure, no prisma), `lib/scoring/resolve-weights.ts` (server, prisma)
- Test: `lib/scoring/weights.test.ts` (no DB), `lib/scoring/resolve-weights.test.ts` (DB-backed)

**Interfaces:**
- Produces from `weights.ts`: `ScoringWeights`, `DEFAULT_WEIGHTS`, `WEIGHT_LABELS`, `LIVE_ELIGIBLE_KEYS`, `ScoreBreakdownFactor`, `ScoreResult { score: number|null; factors: ScoreBreakdownFactor[] }`, `PersistedBreakdown { version:1; scorer:'health'|'live-seo'; score; factors }`, `serializeBreakdown(scorer, result): string`, `validateWeights(input): ScoringWeights | { error }`.
- Produces from `resolve-weights.ts`: `resolveScoringWeights(): Promise<ScoringWeights>`.

- [ ] **Step 1: Write failing pure tests** — `lib/scoring/weights.test.ts` (node env, no prisma import):
```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_WEIGHTS, LIVE_ELIGIBLE_KEYS, validateWeights, serializeBreakdown } from './weights'

describe('validateWeights', () => {
  it('accepts a full valid set', () => expect(validateWeights({ ...DEFAULT_WEIGHTS })).toMatchObject(DEFAULT_WEIGHTS))
  it('fills missing keys from defaults', () => {
    const r = validateWeights({ indexability: 30 }) as typeof DEFAULT_WEIGHTS
    expect(r.indexability).toBe(30); expect(r.errorRate).toBe(DEFAULT_WEIGHTS.errorRate)
  })
  it('rejects negative', () => expect(validateWeights({ ...DEFAULT_WEIGHTS, indexability: -1 })).toHaveProperty('error'))
  it('rejects non-number', () => expect(validateWeights({ ...DEFAULT_WEIGHTS, schema: 'x' })).toHaveProperty('error'))
  it('rejects when only crawlDepth is positive', () => {
    const only = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0])); only.crawlDepth = 15
    expect(validateWeights(only)).toHaveProperty('error')
  })
  it('accepts a positive live-eligible factor with crawlDepth 0', () => {
    const w = { ...Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0])), indexability: 5 }
    expect(validateWeights(w)).toMatchObject({ indexability: 5, crawlDepth: 0 })
  })
})
describe('serializeBreakdown', () => {
  it('wraps with version/scorer/score', () => {
    const j = serializeBreakdown('health', { score: 72, factors: [{ key:'indexability', label:'Indexability', weight:20, earned:18, possible:20 }] })
    expect(JSON.parse(j)).toEqual({ version:1, scorer:'health', score:72, factors:[{ key:'indexability', label:'Indexability', weight:20, earned:18, possible:20 }] })
  })
})
describe('LIVE_ELIGIBLE_KEYS', () => {
  it('excludes crawlDepth', () => { expect(LIVE_ELIGIBLE_KEYS).not.toContain('crawlDepth'); expect(LIVE_ELIGIBLE_KEYS).toContain('indexability') })
})
```
And `lib/scoring/resolve-weights.test.ts` (DB-backed):
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { DEFAULT_WEIGHTS } from './weights'
import { resolveScoringWeights } from './resolve-weights'

afterEach(async () => { await prisma.scoringWeights.deleteMany({ where: { id: 1 } }) })

it('returns defaults when no row exists', async () => {
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
  expect(await resolveScoringWeights()).toEqual(DEFAULT_WEIGHTS)
})
it('returns the stored row when present', async () => {
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...DEFAULT_WEIGHTS, indexability: 42 }, update: { indexability: 42 } })
  expect((await resolveScoringWeights()).indexability).toBe(42)
})
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './weights'` / `'./resolve-weights'`):
```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/weights.test.ts lib/scoring/resolve-weights.test.ts
```

- [ ] **Step 3: Implement `lib/scoring/weights.ts`** (NO prisma import):
```ts
// lib/scoring/weights.ts — pure, client-safe. Shared weight profile + breakdown types.
export interface ScoringWeights {
  indexability: number; errorRate: number; missingTitle: number; missingMeta: number
  missingH1: number; crawlDepth: number; thinContent: number; schema: number
}
export const DEFAULT_WEIGHTS: ScoringWeights = {
  indexability: 20, errorRate: 20, missingTitle: 10, missingMeta: 8, missingH1: 7, crawlDepth: 15, thinContent: 10, schema: 10,
}
export const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  indexability: 'Indexability', errorRate: 'Error rate', missingTitle: 'Missing title',
  missingMeta: 'Missing meta description', missingH1: 'Missing H1', crawlDepth: 'Crawl depth',
  thinContent: 'Thin content', schema: 'Schema coverage',
}
const ALL_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]
export const LIVE_ELIGIBLE_KEYS = ALL_KEYS.filter((k) => k !== 'crawlDepth')

export interface ScoreBreakdownFactor { key: string; label: string; weight: number; earned: number; possible: number }
export interface ScoreResult { score: number | null; factors: ScoreBreakdownFactor[] }
export interface PersistedBreakdown { version: 1; scorer: 'health' | 'live-seo'; score: number | null; factors: ScoreBreakdownFactor[] }

export function serializeBreakdown(scorer: 'health' | 'live-seo', r: ScoreResult): string {
  const p: PersistedBreakdown = { version: 1, scorer, score: r.score, factors: r.factors }
  return JSON.stringify(p)
}
export function validateWeights(input: Record<string, unknown>): ScoringWeights | { error: string } {
  const out = { ...DEFAULT_WEIGHTS }
  for (const key of ALL_KEYS) {
    const v = input[key]
    if (v === undefined || v === null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { error: `Weight "${key}" must be a finite number ≥ 0.` }
    out[key] = v
  }
  if (!LIVE_ELIGIBLE_KEYS.some((k) => out[k] > 0)) return { error: 'At least one non-crawl-depth weight must be greater than 0.' }
  return out
}
```
Implement `lib/scoring/resolve-weights.ts` (server):
```ts
// lib/scoring/resolve-weights.ts — server-only DB read for the weight profile.
import { prisma } from '@/lib/db'
import { DEFAULT_WEIGHTS, type ScoringWeights } from './weights'

export async function resolveScoringWeights(): Promise<ScoringWeights> {
  const row = await prisma.scoringWeights.findUnique({ where: { id: 1 } })
  if (!row) return { ...DEFAULT_WEIGHTS }
  return {
    indexability: row.indexability, errorRate: row.errorRate, missingTitle: row.missingTitle,
    missingMeta: row.missingMeta, missingH1: row.missingH1, crawlDepth: row.crawlDepth,
    thinContent: row.thinContent, schema: row.schema,
  }
}
```

- [ ] **Step 4: Run — expect PASS.** Then commit:
```bash
git add lib/scoring
git commit -m "feat(scoring): pure weights module + server resolveScoringWeights (C8)"
```

---

### Task 3: `computeHealthScore` refactor + ALL its callers (one compile-green commit)

**Files:**
- Modify: `lib/services/scoring.service.ts`, `lib/findings/seo-mapper.ts`, `lib/findings/seo-write.ts`, `lib/findings/parity.ts`
- Test: `lib/services/scoring.service.test.ts`, `lib/findings/seo-mapper.test.ts`, `lib/findings/seo-write.test.ts`, `lib/findings/parity.test.ts`

**Interfaces:**
- Consumes: `ScoringWeights`, `ScoreResult`, `WEIGHT_LABELS`, `DEFAULT_WEIGHTS`, `serializeBreakdown` from `@/lib/scoring/weights`; `resolveScoringWeights` from `@/lib/scoring/resolve-weights`.
- Produces: `computeHealthScore(result, weights): ScoreResult`; `SeoMapContext` gains `weights: ScoringWeights`; the SF-upload run carries `score` + `scoreBreakdown`.

- [ ] **Step 1: Update all four test files together**
  - `scoring.service.test.ts`: change every `computeHealthScore(x)` → `computeHealthScore(x, DEFAULT_WEIGHTS).score`; add a `makePerfectResult()` helper; add "perfect → 100 under default AND doubled weights", "breakdown factors have possible === weight and earned ≤ possible", and "a zeroed factor drops out (perfect stays 100)".
  - `seo-mapper.test.ts`: add `weights: DEFAULT_WEIGHTS` to every `mapSeoResult` context; assert `bundle.run.scoreBreakdown` parses to `{ scorer:'health', score: bundle.run.score }`.
  - `seo-write.test.ts:18,49`: the blob sets `metadata.health_score: 91`. Since C8 **drops** that precedence, change the expectation — the run's `score` is now `computeHealthScore(blob, DEFAULT_WEIGHTS).score`. Compute that value from the fixture (import `computeHealthScore` + `DEFAULT_WEIGHTS`) and assert `run!.score === computeHealthScore(blob, DEFAULT_WEIGHTS).score` (do NOT hardcode 91). Also `afterEach` reset `ScoringWeights` id=1.
  - `parity.test.ts`: add `weights: DEFAULT_WEIGHTS` to the `mapSeoResult` context(s) in the test setup so it compiles.

- [ ] **Step 2: Run — expect FAIL** (signature mismatch / `.score` undefined):
```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scoring.service.test.ts lib/findings/seo-mapper.test.ts lib/findings/seo-write.test.ts lib/findings/parity.test.ts
```

- [ ] **Step 3: Refactor `computeHealthScore`** — signature `(result, weights)`, accumulate a `ScoreBreakdownFactor[]`. Each factor pushes only when its data is available AND `weights.<key> > 0`; `possible = weights.<key>`, `earned = ratioMultiplier * weights.<key>` (reuse the existing ratio math, replacing the literal with the weight). Return `{ score: possible === 0 ? 0 : clamp(Math.round(earned/possible*100),0,100), factors }`. Factor→weight map: indexability→`indexability`, error→`errorRate`, missing title→`missingTitle`, meta→`missingMeta`, h1→`missingH1`, crawl depth→`crawlDepth`, thin→`thinContent`, schema→`schema`. Labels from `WEIGHT_LABELS`.

- [ ] **Step 4: Update `seo-mapper.ts`** — add `weights: ScoringWeights` to `SeoMapContext`; just before `return { run: {…} }` compute `const healthResult = computeHealthScore(result, ctx.weights)`; set `score: healthResult.score` and `scoreBreakdown: serializeBreakdown('health', healthResult)`. **Delete** the `result.metadata?.health_score ??` precedence.

- [ ] **Step 5: Update `seo-write.ts`** — `import { resolveScoringWeights } from '@/lib/scoring/resolve-weights'`; `const weights = await resolveScoringWeights()`; pass `weights` in the `mapSeoResult` context.

- [ ] **Step 6: Update `parity.ts`** — the `mapSeoResult(blob, { … })` call (parity.ts:35) needs `weights: DEFAULT_WEIGHTS` in its context (import `DEFAULT_WEIGHTS`). Add a one-line comment above the `run.score !== expected.run.score` diff (parity.ts:48): parity recomputes the expected score at DEFAULT weights, so a score diff is only meaningful when the profile is at defaults; the structural (pages/findings/violations) parity is authoritative. (Do not remove the diff line.) Note the weight-sensitivity is a documented follow-up in the spec §9.

- [ ] **Step 7: Run — expect PASS** (same command as Step 2). Then `npm run lint` (expect PASS — all callers updated). Commit:
```bash
git add lib/services/scoring.service.ts lib/findings/seo-mapper.ts lib/findings/seo-write.ts lib/findings/parity.ts lib/services/scoring.service.test.ts lib/findings/seo-mapper.test.ts lib/findings/seo-write.test.ts lib/findings/parity.test.ts
git commit -m "feat(scoring): computeHealthScore weights+breakdown; SF-upload persists it (C8)"
```

---

### Task 4: `scoreLiveSeo` refactor + `broken-link-verify` caller (one compile-green commit)

**Files:**
- Modify: `lib/findings/live-seo-score.ts`, `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/findings/live-seo-score.test.ts`, `lib/jobs/handlers/broken-link-verify.test.ts`

**Interfaces:**
- Consumes: `ScoringWeights`, `ScoreResult`, `WEIGHT_LABELS`, `DEFAULT_WEIGHTS`, `serializeBreakdown` from `@/lib/scoring/weights`; `resolveScoringWeights` from `@/lib/scoring/resolve-weights`.
- Produces: `scoreLiveSeo(inp, weights): ScoreResult`; the live-scan run carries `score` + `scoreBreakdown` (scorer `'live-seo'`).

- [ ] **Step 1: Update both test files**
  - `live-seo-score.test.ts`: pass `DEFAULT_WEIGHTS`, assert `.score`; keep the three null-guard cases and assert they return `{ score: null, factors: [] }`; add "perfect → 100 under default & doubled weights (crawlDepth ignored)".
  - `broken-link-verify.test.ts`: assert the written live-scan run's `scoreBreakdown` parses to `{ scorer:'live-seo', score: run.score }`; a noindex/null-score run writes `scoreBreakdown` with `score: null, factors: []`. Add `afterEach` reset of `ScoringWeights` id=1.

- [ ] **Step 2: Run — expect FAIL**:
```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/live-seo-score.test.ts lib/jobs/handlers/broken-link-verify.test.ts
```

- [ ] **Step 3: Refactor `scoreLiveSeo`** — signature `(inp, weights)`; on each null-guard return `{ score: null, factors: [] }`; replace each literal with `weights.<key>` (indexability/errorRate/missingTitle/missingMeta/missingH1/thinContent/schema — never `crawlDepth`); push a `ScoreBreakdownFactor` per included `weight>0` factor; return `{ score: possible === 0 ? null : clamp(Math.round(earned/possible*100),0,100), factors }` (note: `possible===0` → `null` here, unlike health's 0).

- [ ] **Step 4: Update `broken-link-verify.ts`** — import `resolveScoringWeights` + `serializeBreakdown`; `const weights = await resolveScoringWeights()`; change `const score = scoreLiveSeo({…})` to `const scoreResult = scoreLiveSeo({…}, weights)`; in the bundle set `score: scoreResult.score` and `scoreBreakdown: serializeBreakdown('live-seo', scoreResult)`.

- [ ] **Step 5: Run — expect PASS**; then `npm run lint`. Commit:
```bash
git add lib/findings/live-seo-score.ts lib/jobs/handlers/broken-link-verify.ts lib/findings/live-seo-score.test.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(scoring): scoreLiveSeo weights+breakdown; live-scan persists it (C8)"
```

---

### Task 5: Cookie-gated route `GET/PUT /api/settings/scoring-weights`

**Files:**
- Create: `app/api/settings/scoring-weights/route.ts`, `app/api/settings/scoring-weights/route.test.ts`
- Modify: `middleware.test.ts`

**Interfaces:**
- Consumes: `validateWeights` from `@/lib/scoring/weights`; `resolveScoringWeights` from `@/lib/scoring/resolve-weights`; `prisma`.
- Produces: `GET` → `{ weights }`; `PUT` `Partial<ScoringWeights>` → 200 `{ weights }` | 400 `{ error }`.

- [ ] **Step 1: Write failing tests** — `route.test.ts` (DB-backed, `afterEach` delete id=1): GET returns defaults when unset; PUT persists a valid change and GET reflects it; PUT 400 when only crawlDepth positive; PUT 400 on malformed JSON. Add to `middleware.test.ts`:
```ts
it('scoring-weights settings route is NOT public (cookie-gated)', () => {
  expect(isPublicPath('/api/settings/scoring-weights')).toBe(false)
})
```

- [ ] **Step 2: Run — expect FAIL** (module missing):
```bash
DATABASE_URL="file:./local-dev.db" npx vitest run app/api/settings/scoring-weights/route.test.ts middleware.test.ts
```

- [ ] **Step 3: Implement the route** (`middleware.ts` already gates `/api/*` by cookie + blocks cross-site mutations — no in-handler auth needed):
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateWeights } from '@/lib/scoring/weights'
import { resolveScoringWeights } from '@/lib/scoring/resolve-weights'

export async function GET() {
  return NextResponse.json({ weights: await resolveScoringWeights() })
}
export async function PUT(request: Request) {
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const v = validateWeights(body ?? {})
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...v }, update: { ...v } })
  return NextResponse.json({ weights: v })
}
```

- [ ] **Step 4: Run — expect PASS.** Commit:
```bash
git add app/api/settings/scoring-weights middleware.test.ts
git commit -m "feat(scoring): cookie-gated GET/PUT /api/settings/scoring-weights (C8)"
```

---

### Task 6: `/settings` — "SEO scoring weights" card

**Files:**
- Create: `components/settings/ScoringWeightsCard.tsx`
- Modify: `app/settings/page.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/settings/scoring-weights`; `WEIGHT_LABELS`, `DEFAULT_WEIGHTS`, `ScoringWeights` from `@/lib/scoring/weights` (pure module — client-safe; do NOT import `resolve-weights`).

- [ ] **Step 1: Implement the client card** — `'use client'`; fetch weights on mount into state; render 8 labeled number inputs (labels `WEIGHT_LABELS`, `min={0} step={1}`), **Save** (PUT; inline error on 400, "Saved." on 200) and **Reset to defaults** (set state to `DEFAULT_WEIGHTS`, no auto-save); helper copy: "Weights apply to future scores only; existing audits keep their scored breakdown. Crawl depth affects the SF score only." Card shell + input row:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { WEIGHT_LABELS, DEFAULT_WEIGHTS, type ScoringWeights } from '@/lib/scoring/weights'

export function ScoringWeightsCard() {
  const [weights, setWeights] = useState<ScoringWeights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { fetch('/api/settings/scoring-weights').then(r => r.json()).then(d => setWeights(d.weights)).catch(() => {}) }, [])
  if (!weights) return null
  const keys = Object.keys(WEIGHT_LABELS) as (keyof ScoringWeights)[]
  async function save() {
    setError(null); setSaved(false)
    const res = await fetch('/api/settings/scoring-weights', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(weights) })
    if (res.ok) setSaved(true); else setError((await res.json()).error ?? 'Save failed.')
  }
  return (
    <section className="mt-6 bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">SEO scoring weights</h2>
      <p className="text-[12px] font-body text-gray-500 dark:text-white/50 mb-4">Applied to both the Screaming Frog and live SEO health scores. Weights apply to future scores only; existing audits keep their scored breakdown. Crawl depth affects the SF score only.</p>
      <div className="grid grid-cols-2 gap-4">
        {keys.map((k) => (
          <label key={k} className="text-[13px] font-body text-navy dark:text-white">{WEIGHT_LABELS[k]}
            <input type="number" min={0} step={1} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-navy dark:text-white" />
          </label>
        ))}
      </div>
      {error && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="mt-3 text-[13px] text-green-700 dark:text-green-400">Saved.</p>}
      <div className="mt-4 flex gap-3">
        <button onClick={save} className="rounded-lg bg-navy text-white dark:bg-white dark:text-navy px-4 py-2 text-[13px] font-heading font-semibold">Save</button>
        <button onClick={() => { setWeights(DEFAULT_WEIGHTS); setSaved(false); setError(null) }} className="rounded-lg border border-gray-300 dark:border-navy-border px-4 py-2 text-[13px] font-body text-navy dark:text-white">Reset to defaults</button>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Render on `/settings`** — import + render `<ScoringWeightsCard />` after `<ScheduleControls />`; extend the page subtitle to mention "and SEO scoring weights".

- [ ] **Step 3: `npm run lint` (expect PASS). Commit:**
```bash
git add components/settings/ScoringWeightsCard.tsx app/settings/page.tsx
git commit -m "feat(scoring): /settings SEO scoring-weights editor card (C8)"
```

---

### Task 7: `ScoreExplanation` panel + wire into both results surfaces

**Files:**
- Create: `components/scoring/ScoreExplanation.tsx`, `components/scoring/ScoreExplanation.test.tsx`
- Modify: `components/seo-parser/ResultsView.tsx`, `app/seo-parser/results/[sessionId]/page.tsx`, `app/seo-parser/results/run/[runId]/page.tsx`, `components/site-audit/OnPageSeoSection.tsx`, `app/ada-audit/site/[id]/page.tsx`

**Interfaces:**
- Consumes: `PersistedBreakdown` from `@/lib/scoring/weights`.
- Produces: `ScoreExplanation({ breakdown: string | null })` — collapsible factor table; **`null`/malformed → "unavailable" line; parsed-but-empty factors → renders `null` (nothing).**

- [ ] **Step 1: Write the component test** — FIRST LINE must be the jsdom pragma (repo default env is node):
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScoreExplanation } from './ScoreExplanation'

const bd = JSON.stringify({ version:1, scorer:'health', score:72, factors:[{ key:'indexability', label:'Indexability', weight:20, earned:18, possible:20 }] })
describe('ScoreExplanation', () => {
  it('renders factor rows from a breakdown', () => { render(<ScoreExplanation breakdown={bd} />); expect(screen.getByText('Indexability')).toBeTruthy() })
  it('renders unavailable for null', () => { render(<ScoreExplanation breakdown={null} />); expect(screen.getByText(/unavailable/i)).toBeTruthy() })
  it('renders unavailable on malformed JSON', () => { render(<ScoreExplanation breakdown={'{'} />); expect(screen.getByText(/unavailable/i)).toBeTruthy() })
  it('renders nothing when factors are empty (live null-score case)', () => {
    const { container } = render(<ScoreExplanation breakdown={JSON.stringify({ version:1, scorer:'live-seo', score:null, factors:[] })} />)
    expect(container.firstChild).toBeNull()
  })
})
```
(Confirm `@testing-library/react` is the pattern used by e.g. `components/seo-parser/ResultsView.archived.test.tsx` and follow its imports.)

- [ ] **Step 2: Run — expect FAIL** (module missing):
```bash
DATABASE_URL="file:./local-dev.db" npx vitest run components/scoring/ScoreExplanation.test.tsx
```

- [ ] **Step 3: Implement the component** — `null`/parse-fail → "unavailable" line; parsed with empty `factors` → return `null`:
```tsx
// components/scoring/ScoreExplanation.tsx
import type { PersistedBreakdown } from '@/lib/scoring/weights'

export function ScoreExplanation({ breakdown }: { breakdown: string | null }) {
  let parsed: PersistedBreakdown | null = null
  if (breakdown) { try { parsed = JSON.parse(breakdown) as PersistedBreakdown } catch { parsed = null } }
  if (!parsed || !Array.isArray(parsed.factors)) {
    return <p className="text-[12px] font-body text-navy/45 dark:text-white/45">Score breakdown unavailable (scored before breakdowns were recorded).</p>
  }
  if (parsed.factors.length === 0) return null   // live null-score: ScoreLine already explains it
  const totalPossible = parsed.factors.reduce((a, x) => a + x.possible, 0)
  return (
    <details className="mt-2">
      <summary className="text-[12px] font-body text-navy/60 dark:text-white/60 cursor-pointer">How this score was calculated</summary>
      <table className="mt-2 w-full text-[12px] font-body text-navy dark:text-white">
        <thead><tr className="text-navy/45 dark:text-white/45 text-left"><th className="py-1">Factor</th><th>Weight</th><th>Earned</th><th>Contribution</th></tr></thead>
        <tbody>
          {parsed.factors.map((f) => (
            <tr key={f.key} className="border-t border-gray-100 dark:border-navy-border/50">
              <td className="py-1">{f.label}</td><td>{f.weight}</td>
              <td>{Math.round(f.earned * 10) / 10}/{f.possible}</td>
              <td>{totalPossible > 0 ? Math.round((f.earned / totalPossible) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] font-body text-navy/40 dark:text-white/40">Weights as scored; current weights may differ.</p>
    </details>
  )
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Add a health-score display + panel on the SEO parser results pages** (there is NO existing health-score display — Codex confirmed):
  - `components/seo-parser/ResultsView.tsx`: add optional props `healthScore?: number | null` and `scoreBreakdown?: string | null`. Near the top of the results body (above/beside `MetricsBar`), render a small score line when `healthScore != null`: `SEO health score: {healthScore}/100`, followed by `<ScoreExplanation breakdown={scoreBreakdown ?? null} />`. Use the existing card styling.
  - `app/seo-parser/results/[sessionId]/page.tsx`: after loading the session (line 46), add `const run = await prisma.crawlRun.findFirst({ where: { sessionId, tool: 'seo-parser' }, select: { score: true, scoreBreakdown: true } })` and pass `healthScore={run?.score ?? null} scoreBreakdown={run?.scoreBreakdown ?? null}` into `<ResultsView />`.
  - `app/seo-parser/results/run/[runId]/page.tsx`: add `const run = await prisma.crawlRun.findUnique({ where: { id: runId }, select: { score: true, scoreBreakdown: true } })` and pass the same two props into `<ResultsView />`.

- [ ] **Step 6: Wire into `OnPageSeoSection`** (the live-scan surface):
  - `components/site-audit/OnPageSeoSection.tsx`: add `breakdown: string | null` to the props; render `<ScoreExplanation breakdown={breakdown} />` directly under `<ScoreLine …/>` in BOTH the "clean" and "findings" branches. (For a null-score run, `factors:[]` → the panel renders nothing, so the existing "not enough coverage" line stands alone — the intended behavior.)
  - `app/ada-audit/site/[id]/page.tsx`: add `scoreBreakdown: true` to the `liveScanRun` `crawlRun.findUnique` select (line 155), and add `breakdown={liveScanRun?.scoreBreakdown ?? null}` to the `<OnPageSeoSection …/>` props (line 206).

- [ ] **Step 7: Typecheck + affected tests**:
```bash
npm run lint && DATABASE_URL="file:./local-dev.db" npx vitest run components/scoring components/seo-parser components/site-audit
```
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add components/scoring app/seo-parser/results components/seo-parser/ResultsView.tsx components/site-audit/OnPageSeoSection.tsx "app/ada-audit/site/[id]/page.tsx"
git commit -m "feat(scoring): ScoreExplanation panel + health-score display on results surfaces (C8)"
```

---

### Task 8: Full gate + PR

- [ ] **Step 1: All three gates**
```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: tsc clean; full vitest suite green (existing + new cases); build OK.

- [ ] **Step 2: Push + open PR (STOP — Kevin merges/deploys)**
```bash
git push -u origin feat/c8-configurable-scoring-weights
gh pr create --title "feat(scoring): configurable SEO scoring weights + explanation panel (C8)" --body "<summary + spec link. Note: additive migration (auto-applies on deploy); NO new required env var; no isPublicPath change.>"
```
Do NOT merge or deploy. Hand off to Kevin with the tracker/handoff ritual.

---

## Self-Review

**Spec coverage:** §2.1 table → T1; §2.2 breakdown+JSON+typing → T1/T2; §2.3 migration → T1; §3 scorer refactor (pure) + callers + dropped precedence + full call sites → T3 (health incl. parity.ts + seo-write.test) & T4 (live); §4 route+validation (live-eligible) → T5(+T2); §4.2 card → T6; §5 panel+plumbing (separate prop, both surfaces incl. the added health-score display, live omits crawl depth, unavailable state, empty→nothing) → T7; §6 testing → per-task + T8; §8 acceptance → mapped.

**Codex plan-review fixes applied:** (1) compile-green commits — scorer refactor merged with callers (T3, T4); (2) split `weights.ts` (pure) vs `resolve-weights.ts` (server) so the client card is bundle-safe (T2, T6); (3) `parity.ts` edits the `mapSeoResult` call + weight-sensitivity comment, `seo-write.test.ts` 91→computed (T3); (4) added the missing health-score display on the parser results page (T7 Step 5); (5) `ScoreExplanation` empty-factors → nothing, null/malformed → unavailable (T7); (6) jsdom pragma (T7); (7) exact wiring names — `liveScanRun`, session `crawlRun.findFirst`, run `findUnique` (T7); (8) DB tests reset the `ScoringWeights` singleton (Global Constraints + T2/T3/T4/T5); (9) `migrate status` drift check (T1); no raw `CHECK`.

**Placeholder scan:** the only "read the file / confirm the pattern" notes (T7 Testing-Library import style; T3 exact parity line) specify the concrete edit; no `TODO`/`add error handling`/`similar to Task N`.

**Type consistency:** `ScoreResult {score,factors}`, `ScoreBreakdownFactor`, `PersistedBreakdown {version,scorer,score,factors}`, `ScoringWeights`, `serializeBreakdown`, `resolveScoringWeights`, `validateWeights`, `WEIGHT_LABELS`, `LIVE_ELIGIBLE_KEYS` — defined T2, used consistently T3–T7; `computeHealthScore(result,weights)` / `scoreLiveSeo(inp,weights)` consistent T3–T4.
