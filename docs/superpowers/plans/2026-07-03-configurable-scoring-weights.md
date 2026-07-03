# Configurable SEO Scoring Weights + Explanation Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two factor-weighted SEO scorers read an operator-editable global weight profile and persist a per-factor breakdown so each score can be explained on the results pages.

**Architecture:** One global `ScoringWeights` singleton row (id=1) + a `CrawlRun.scoreBreakdown` JSON column. Both scorers become pure `(inputs, weights) → {score, factors}`; the DB-aware callers (`writeSeoFindings`, `broken-link-verify`) resolve weights and persist `score` + `scoreBreakdown` from one call. A `/settings` card edits the weights via a cookie-gated route. A `ScoreExplanation` component reads the persisted breakdown (archived-safe, no recompute).

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Tailwind (class-based dark mode), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-configurable-scoring-weights-design.md` (Codex-reviewed).

## Global Constraints

- **Array-form `$transaction([...])` only** — never interactive `$transaction(async tx => …)`. (Not expected in this plan; the weights upsert is a single call.)
- **Local prisma CLI + vitest MUST be prefixed** `DATABASE_URL="file:./local-dev.db"` (resolves to `prisma/local-dev.db`).
- **`prisma migrate dev` is interactive-only here** — hand-author the migration SQL, apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate`.
- **SQLite:** additive only (new table + nullable column) — no `ALTER COLUMN`.
- **Dark mode:** every new UI element carries `dark:` variants (`bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, `border-gray-*`→`dark:border-navy-border`).
- **New route:** must NOT be added to `middleware.ts` `isPublicPath` (it's cookie-gated); add a `middleware.test.ts` assertion that it stays non-public.
- **DB-backed tests:** unique id/domain prefixes, scoped cleanup; the weights singleton is global → reset id=1 to defaults in `afterEach`.
- **Gate before PR:** `npm run lint` (`tsc --noEmit`) + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`, all green.
- **Purity invariant:** `computeHealthScore` and `scoreLiveSeo` never touch the DB — weights are passed in.
- **"Perfect inputs → exactly 100"** must hold for any valid weights (score = `round(earned/possible*100)`).

---

### Task 1: Schema — `ScoringWeights` table + `CrawlRun.scoreBreakdown`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_configurable_scoring_weights/migration.sql`
- Modify: `lib/findings/types.ts:32-49` (add `scoreBreakdown` to `CrawlRunInput`)

**Interfaces:**
- Produces: Prisma model `ScoringWeights { id, indexability, errorRate, missingTitle, missingMeta, missingH1, crawlDepth, thinContent, schema, updatedAt }`; `CrawlRun.scoreBreakdown String?`; `CrawlRunInput.scoreBreakdown?: string | null`.

- [ ] **Step 1: Add the Prisma model + column**

In `prisma/schema.prisma`, add:
```prisma
model ScoringWeights {
  id           Int      @id @default(1)   // singleton — always id=1
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
On `model CrawlRun`, add after `scoreBreakdown`'s sibling `score`:
```prisma
  scoreBreakdown  String?    // JSON { version, scorer, score, factors[] }; sf-upload + live-scan only
```

- [ ] **Step 2: Hand-author the migration SQL**

Create `prisma/migrations/<timestamp>_configurable_scoring_weights/migration.sql` (use a UTC timestamp like `20260703120000`):
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

- [ ] **Step 3: Apply migration + regenerate client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: "1 migration applied" (the new one) + client regenerated, no errors.

- [ ] **Step 4: Add `scoreBreakdown` to `CrawlRunInput`**

In `lib/findings/types.ts`, inside `CrawlRunInput` (after `score`):
```ts
  score: number | null
  scoreBreakdown?: string | null   // JSON breakdown; sf-upload + live-scan runs only
```
`writeFindingsRun` spreads `bundle.run` into `crawlRun.create` (writer.ts:40), so no writer change is needed once the type + model carry the field.

- [ ] **Step 5: Verify it compiles**

Run: `npm run lint`
Expected: PASS (no type errors from the new optional field).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/findings/types.ts
git commit -m "feat(scoring): ScoringWeights singleton + CrawlRun.scoreBreakdown (C8 schema)"
```

---

### Task 2: `lib/scoring/weights.ts` — types, defaults, validate, resolve

**Files:**
- Create: `lib/scoring/weights.ts`
- Test: `lib/scoring/weights.test.ts`

**Interfaces:**
- Produces:
  - `interface ScoringWeights { indexability; errorRate; missingTitle; missingMeta; missingH1; crawlDepth; thinContent; schema: number }`
  - `const DEFAULT_WEIGHTS: ScoringWeights`
  - `const WEIGHT_LABELS: Record<keyof ScoringWeights, string>`
  - `const LIVE_ELIGIBLE_KEYS: (keyof ScoringWeights)[]` (all except `crawlDepth`)
  - `interface ScoreBreakdownFactor { key: string; label: string; weight: number; earned: number; possible: number }`
  - `interface ScoreResult { score: number | null; factors: ScoreBreakdownFactor[] }`
  - `interface PersistedBreakdown { version: 1; scorer: 'health' | 'live-seo'; score: number | null; factors: ScoreBreakdownFactor[] }`
  - `function serializeBreakdown(scorer, result): string`
  - `function validateWeights(input: Record<string, unknown>): ScoringWeights | { error: string }`
  - `async function resolveScoringWeights(): Promise<ScoringWeights>`

- [ ] **Step 1: Write failing tests**

Create `lib/scoring/weights.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import {
  DEFAULT_WEIGHTS, LIVE_ELIGIBLE_KEYS, validateWeights,
  resolveScoringWeights, serializeBreakdown,
} from './weights'

afterEach(async () => {
  // singleton is global — reset to defaults so other DB tests are deterministic
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
})

describe('validateWeights', () => {
  it('accepts a full valid set', () => {
    const r = validateWeights({ ...DEFAULT_WEIGHTS })
    expect(r).toMatchObject(DEFAULT_WEIGHTS)
  })
  it('fills missing keys from defaults', () => {
    const r = validateWeights({ indexability: 30 }) as typeof DEFAULT_WEIGHTS
    expect(r.indexability).toBe(30)
    expect(r.errorRate).toBe(DEFAULT_WEIGHTS.errorRate)
  })
  it('rejects negative', () => {
    expect(validateWeights({ ...DEFAULT_WEIGHTS, indexability: -1 })).toHaveProperty('error')
  })
  it('rejects NaN / non-number', () => {
    expect(validateWeights({ ...DEFAULT_WEIGHTS, schema: 'x' })).toHaveProperty('error')
  })
  it('rejects when only crawlDepth is positive (no live-eligible factor)', () => {
    const onlyDepth = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0]))
    onlyDepth.crawlDepth = 15
    expect(validateWeights(onlyDepth)).toHaveProperty('error')
  })
  it('accepts when a live-eligible factor is positive even if crawlDepth is 0', () => {
    const w = { ...Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0])), indexability: 5 }
    expect(validateWeights(w)).toMatchObject({ indexability: 5, crawlDepth: 0 })
  })
})

describe('resolveScoringWeights', () => {
  it('returns defaults when no row exists', async () => {
    await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
    expect(await resolveScoringWeights()).toEqual(DEFAULT_WEIGHTS)
  })
  it('returns the stored row when present', async () => {
    await prisma.scoringWeights.upsert({
      where: { id: 1 },
      create: { id: 1, ...DEFAULT_WEIGHTS, indexability: 42 },
      update: { indexability: 42 },
    })
    expect((await resolveScoringWeights()).indexability).toBe(42)
  })
})

describe('serializeBreakdown', () => {
  it('wraps a ScoreResult with version + scorer + score', () => {
    const json = serializeBreakdown('health', { score: 72, factors: [
      { key: 'indexability', label: 'Indexability', weight: 20, earned: 18, possible: 20 },
    ] })
    expect(JSON.parse(json)).toEqual({
      version: 1, scorer: 'health', score: 72,
      factors: [{ key: 'indexability', label: 'Indexability', weight: 20, earned: 18, possible: 20 }],
    })
  })
})

describe('LIVE_ELIGIBLE_KEYS', () => {
  it('excludes crawlDepth', () => {
    expect(LIVE_ELIGIBLE_KEYS).not.toContain('crawlDepth')
    expect(LIVE_ELIGIBLE_KEYS).toContain('indexability')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/weights.test.ts`
Expected: FAIL — `Cannot find module './weights'`.

- [ ] **Step 3: Implement `lib/scoring/weights.ts`**

```ts
// lib/scoring/weights.ts
//
// C8: the shared, operator-configurable weight profile for the two factor-weighted
// SEO scorers (computeHealthScore + scoreLiveSeo), plus the score-breakdown types.
import { prisma } from '@/lib/db'

export interface ScoringWeights {
  indexability: number
  errorRate: number
  missingTitle: number
  missingMeta: number
  missingH1: number
  crawlDepth: number
  thinContent: number
  schema: number
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  indexability: 20, errorRate: 20, missingTitle: 10, missingMeta: 8,
  missingH1: 7, crawlDepth: 15, thinContent: 10, schema: 10,
}

export const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  indexability: 'Indexability', errorRate: 'Error rate', missingTitle: 'Missing title',
  missingMeta: 'Missing meta description', missingH1: 'Missing H1', crawlDepth: 'Crawl depth',
  thinContent: 'Thin content', schema: 'Schema coverage',
}

const ALL_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]
// live SEO has no crawl graph → crawl depth is never one of its factors.
export const LIVE_ELIGIBLE_KEYS = ALL_KEYS.filter((k) => k !== 'crawlDepth')

export interface ScoreBreakdownFactor {
  key: string; label: string; weight: number; earned: number; possible: number
}
export interface ScoreResult { score: number | null; factors: ScoreBreakdownFactor[] }
export interface PersistedBreakdown {
  version: 1; scorer: 'health' | 'live-seo'; score: number | null; factors: ScoreBreakdownFactor[]
}

export function serializeBreakdown(scorer: 'health' | 'live-seo', r: ScoreResult): string {
  const payload: PersistedBreakdown = { version: 1, scorer, score: r.score, factors: r.factors }
  return JSON.stringify(payload)
}

export function validateWeights(input: Record<string, unknown>): ScoringWeights | { error: string } {
  const out = { ...DEFAULT_WEIGHTS }
  for (const key of ALL_KEYS) {
    if (!(key in input) || input[key] === undefined || input[key] === null) continue
    const v = input[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return { error: `Weight "${key}" must be a finite number ≥ 0.` }
    }
    out[key] = v
  }
  if (!LIVE_ELIGIBLE_KEYS.some((k) => out[k] > 0)) {
    return { error: 'At least one non-crawl-depth weight must be greater than 0.' }
  }
  return out
}

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

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/weights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/weights.ts lib/scoring/weights.test.ts
git commit -m "feat(scoring): shared weight profile — defaults, validate, resolve (C8)"
```

---

### Task 3: Refactor `computeHealthScore` → `(result, weights) → ScoreResult`

**Files:**
- Modify: `lib/services/scoring.service.ts`
- Test: `lib/services/scoring.service.test.ts`

**Interfaces:**
- Consumes: `ScoringWeights`, `ScoreResult`, `ScoreBreakdownFactor`, `WEIGHT_LABELS` from `lib/scoring/weights`.
- Produces: `computeHealthScore(result: AggregatedResult, weights: ScoringWeights): ScoreResult` (score always a number, 0 when no factors available).

- [ ] **Step 1: Update the existing tests to the new signature + add breakdown/weight tests**

In `lib/services/scoring.service.test.ts`, import `DEFAULT_WEIGHTS` and pass it; assert `.score`. Add:
```ts
import { DEFAULT_WEIGHTS } from '@/lib/scoring/weights'

it('perfect inputs → 100 under default AND doubled weights', () => {
  const perfect = /* build an AggregatedResult with all factors perfect */ makePerfectResult()
  expect(computeHealthScore(perfect, DEFAULT_WEIGHTS).score).toBe(100)
  const doubled = Object.fromEntries(Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, v * 2])) as typeof DEFAULT_WEIGHTS
  expect(computeHealthScore(perfect, doubled).score).toBe(100)
})

it('returns a factor breakdown with earned ≤ possible === weight', () => {
  const r = computeHealthScore(makePerfectResult(), DEFAULT_WEIGHTS)
  for (const f of r.factors) {
    expect(f.possible).toBe(f.weight)
    expect(f.earned).toBeLessThanOrEqual(f.possible)
  }
})

it('a zeroed factor contributes 0/0 and drops out of the denominator', () => {
  const w = { ...DEFAULT_WEIGHTS, schema: 0 }
  const r = computeHealthScore(makePerfectResult(), w)
  const schema = r.factors.find(f => f.key === 'schema')
  // either omitted or possible===0; must not drag the score below 100 when everything else is perfect
  expect(r.score).toBe(100)
})
```
Reuse/author a `makePerfectResult()` helper in the test file (all ratios perfect: 100% indexable, 0 errors, 0 missing, depth ≤ 3, 0 thin, ≥30% schema). Update every existing `computeHealthScore(x)` call in this file to `computeHealthScore(x, DEFAULT_WEIGHTS).score`.

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scoring.service.test.ts`
Expected: FAIL — signature mismatch / `.score` undefined.

- [ ] **Step 3: Implement the refactor**

Rewrite `computeHealthScore` to take `weights` and accumulate factors. Each factor pushes `{ key, label: WEIGHT_LABELS[key], weight, earned, possible: weight }` only when its data is available AND `weight > 0` (a zero-weight factor drops out entirely). Keep the existing ratio math but multiply by `weights.<key>` instead of the literal. Return `{ score: possible === 0 ? 0 : clamp(round(earned/possible*100),0,100), factors }`.

Key mapping (literal → weight field): indexability→`indexability`, error→`errorRate`, missing title→`missingTitle`, missing meta→`missingMeta`, missing h1→`missingH1`, crawl depth→`crawlDepth`, thin→`thinContent`, schema→`schema`. Example for the indexability factor:
```ts
if (weights.indexability > 0 && totalUrls > 0 && summary.indexable_urls !== undefined) {
  const ratio = indexableUrls / totalUrls
  const earnedPts = clamp((ratio >= 0.95 ? 1 : ratio / 0.95) * weights.indexability, 0, weights.indexability)
  factors.push({ key: 'indexability', label: WEIGHT_LABELS.indexability, weight: weights.indexability, earned: earnedPts, possible: weights.indexability })
}
```
Apply the same pattern to the other five factor blocks (the missing-title/meta/h1 trio stays gated by `base > 0`, thin by `indexableUrls > 0`, schema by structured-data presence, crawl depth by `avg_crawl_depth !== undefined`).

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/scoring.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/scoring.service.ts lib/services/scoring.service.test.ts
git commit -m "refactor(scoring): computeHealthScore takes weights, returns {score,factors} (C8)"
```

---

### Task 4: Refactor `scoreLiveSeo` → `(inputs, weights) → ScoreResult`

**Files:**
- Modify: `lib/findings/live-seo-score.ts`
- Test: `lib/findings/live-seo-score.test.ts`

**Interfaces:**
- Consumes: `ScoringWeights`, `ScoreResult`, `WEIGHT_LABELS` from `lib/scoring/weights`.
- Produces: `scoreLiveSeo(inp: LiveScoreInputs, weights: ScoringWeights): ScoreResult` (score null on the existing guards, else 0–100).

- [ ] **Step 1: Update tests to the new signature; keep null-guards, add breakdown**

In `lib/findings/live-seo-score.test.ts`, import `DEFAULT_WEIGHTS`, pass it, assert `.score`. Keep the three null-guard cases (`attempted<=0`, `observed/attempted<0.5`, `indexableScored<=0` → `.score === null`, and assert `.factors` is `[]` for those). Add a "perfect → 100 under default and doubled weights (crawlDepth ignored)" case.

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/live-seo-score.test.ts`
Expected: FAIL — signature mismatch.

- [ ] **Step 3: Implement**

Change the signature to `(inp, weights)`. On the null-guards, return `{ score: null, factors: [] }`. Replace each literal weight with the matching `weights.<key>` (indexability→`indexability`, error→`errorRate`, title→`missingTitle`, meta→`missingMeta`, h1→`missingH1`, thin→`thinContent`, schema→`schema`; **never** `crawlDepth`). Push a `ScoreBreakdownFactor` per included factor with `weight>0` (label from `WEIGHT_LABELS`). Return `{ score: possible === 0 ? null : clamp(round(earned/possible*100),0,100), factors }` — note `possible===0` maps to `null` here (live SEO's contract), whereas health returns 0.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/live-seo-score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/findings/live-seo-score.ts lib/findings/live-seo-score.test.ts
git commit -m "refactor(scoring): scoreLiveSeo takes weights, returns {score,factors} (C8)"
```

---

### Task 5: Wire the SF-upload path (resolve weights, persist breakdown, drop dead precedence)

**Files:**
- Modify: `lib/findings/seo-mapper.ts:13-18` (context type), `:126-130` (score/breakdown)
- Modify: `lib/findings/seo-write.ts:19-25`
- Modify: `lib/findings/parity.ts` (reads `computeHealthScore` — update to `.score`)
- Test: `lib/findings/seo-mapper.test.ts`

**Interfaces:**
- Consumes: `resolveScoringWeights`, `serializeBreakdown`, `ScoringWeights` from `lib/scoring/weights`; `computeHealthScore` (new `ScoreResult` shape).
- Produces: `mapSeoResult(result, ctx)` where `SeoMapContext` gains `weights: ScoringWeights`; the run carries `score` + `scoreBreakdown`.

- [ ] **Step 1: Update `seo-mapper.test.ts`**

Add `weights: DEFAULT_WEIGHTS` to every `mapSeoResult` context in the test. Add a case asserting `bundle.run.scoreBreakdown` is a JSON string whose parsed `.scorer === 'health'` and `.score === bundle.run.score`.

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-mapper.test.ts`
Expected: FAIL — `weights` missing / `scoreBreakdown` undefined.

- [ ] **Step 3: Implement**

In `seo-mapper.ts`:
```ts
import { computeHealthScore } from '@/lib/services/scoring.service'
import { serializeBreakdown, type ScoringWeights } from '@/lib/scoring/weights'

export interface SeoMapContext {
  sessionId: string
  clientId: number | null
  startedAt: Date | null
  completedAt: Date | null
  weights: ScoringWeights
}
```
Replace the score line (was `score: result.metadata?.health_score ?? computeHealthScore(result)`):
```ts
      // C8: one computeHealthScore call feeds BOTH the score and its breakdown, so
      // they can never disagree. The dead metadata.health_score precedence is gone
      // (the fresh aggregator never sets it).
      score: healthResult.score,
      scoreBreakdown: serializeBreakdown('health', healthResult),
```
Compute `const healthResult = computeHealthScore(result, ctx.weights)` just before the `return { run: {…} }`.

In `seo-write.ts`:
```ts
import { resolveScoringWeights } from '@/lib/scoring/weights'
// …
  const weights = await resolveScoringWeights()
  const bundle = mapSeoResult(result, {
    sessionId, clientId,
    startedAt: session?.createdAt ?? null,
    completedAt: new Date(),
    weights,
  })
```

In `lib/findings/parity.ts`: find the `computeHealthScore(` call and change it to `computeHealthScore(result, DEFAULT_WEIGHTS).score` (import `DEFAULT_WEIGHTS`). Parity compares blob-vs-tables score; using defaults here is correct because parity is a structural check, not a live-weight check. (Confirm the exact line while editing.)

- [ ] **Step 4: Run to verify pass**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-mapper.test.ts lib/findings/parity.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/findings/seo-mapper.ts lib/findings/seo-write.ts lib/findings/parity.ts lib/findings/seo-mapper.test.ts
git commit -m "feat(scoring): SF-upload path resolves weights + persists breakdown (C8)"
```

---

### Task 6: Wire the live-scan path (resolve weights, persist breakdown)

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts:26` (import), `:232-253` (score + breakdown)
- Test: `lib/jobs/handlers/broken-link-verify.test.ts`

**Interfaces:**
- Consumes: `resolveScoringWeights`, `serializeBreakdown` from `lib/scoring/weights`; `scoreLiveSeo` (new shape).
- Produces: the live-scan run carries `score` + `scoreBreakdown` (scorer `'live-seo'`).

- [ ] **Step 1: Update the builder test**

In `broken-link-verify.test.ts`, add/adjust an assertion that the written live-scan run's `scoreBreakdown` parses to `{ scorer: 'live-seo', score: <run.score> }`, and that a null-score (noindex) run still writes `scoreBreakdown` with `score: null` and `factors: []`.

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — `scoreBreakdown` not written / signature mismatch.

- [ ] **Step 3: Implement**

At the top of the builder (before `scoreLiveSeo`):
```ts
import { resolveScoringWeights, serializeBreakdown } from '@/lib/scoring/weights'
// …
  const weights = await resolveScoringWeights()
  const scoreResult = scoreLiveSeo({
    attempted: site.pagesTotal,
    observed: seoRows.length,
    indexableScored: seoRows.filter((r) => indexableOf(r) && !r.loginLike).length,
    pagesError: site.pagesError,
    missingTitle: runCounts.get('missing_title') ?? 0,
    missingMeta: runCounts.get('missing_meta_description') ?? 0,
    missingH1: runCounts.get('missing_h1') ?? 0,
    thin: runCounts.get('thin_content') ?? 0,
    pagesWithSchema: seoRows.filter((r) => (r.schemaCount ?? 0) > 0).length,
  }, weights)
```
Then in the bundle's `run`:
```ts
      status: capped || harvestTruncated ? 'partial' : 'complete',
      score: scoreResult.score,
      scoreBreakdown: serializeBreakdown('live-seo', scoreResult),
      wcagLevel: null,
```
(Replace the old `const score = scoreLiveSeo({…})` and the `score,` field.)

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(scoring): live-scan path resolves weights + persists breakdown (C8)"
```

---

### Task 7: Cookie-gated route `GET/PUT /api/settings/scoring-weights`

**Files:**
- Create: `app/api/settings/scoring-weights/route.ts`
- Modify: `middleware.test.ts` (assert non-public)
- Test: `app/api/settings/scoring-weights/route.test.ts`

**Interfaces:**
- Consumes: `resolveScoringWeights`, `validateWeights`, `DEFAULT_WEIGHTS` from `lib/scoring/weights`; `prisma`.
- Produces: `GET` → `{ weights: ScoringWeights }`; `PUT` body `Partial<ScoringWeights>` → 200 `{ weights }` | 400 `{ error }`.

- [ ] **Step 1: Write failing tests**

Create `app/api/settings/scoring-weights/route.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { GET, PUT } from './route'
import { DEFAULT_WEIGHTS } from '@/lib/scoring/weights'

afterEach(async () => { await prisma.scoringWeights.deleteMany({ where: { id: 1 } }) })

function req(body: unknown) {
  return new Request('http://x/api/settings/scoring-weights', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('scoring-weights route', () => {
  it('GET returns defaults when unset', async () => {
    const res = await GET()
    expect(await res.json()).toEqual({ weights: DEFAULT_WEIGHTS })
  })
  it('PUT persists valid weights and GET reflects them', async () => {
    const put = await PUT(req({ ...DEFAULT_WEIGHTS, indexability: 25 }))
    expect(put.status).toBe(200)
    const get = await GET()
    expect((await get.json()).weights.indexability).toBe(25)
  })
  it('PUT 400 on invalid (only crawlDepth positive)', async () => {
    const bad = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0]))
    bad.crawlDepth = 15
    const put = await PUT(req(bad))
    expect(put.status).toBe(400)
  })
  it('PUT 400 on malformed JSON', async () => {
    const res = await PUT(new Request('http://x', { method: 'PUT', body: '{' }))
    expect(res.status).toBe(400)
  })
})
```
Add to `middleware.test.ts`:
```ts
it('scoring-weights settings route is NOT public (cookie-gated)', () => {
  expect(isPublicPath('/api/settings/scoring-weights')).toBe(false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx vitest run app/api/settings/scoring-weights/route.test.ts middleware.test.ts
```
Expected: FAIL — route module missing.

- [ ] **Step 3: Implement the route**

Create `app/api/settings/scoring-weights/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveScoringWeights, validateWeights } from '@/lib/scoring/weights'

export async function GET() {
  const weights = await resolveScoringWeights()
  return NextResponse.json({ weights })
}

export async function PUT(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const validated = validateWeights(body ?? {})
  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }
  await prisma.scoringWeights.upsert({
    where: { id: 1 },
    create: { id: 1, ...validated },
    update: { ...validated },
  })
  return NextResponse.json({ weights: validated })
}
```
(No in-handler auth check needed — `middleware.ts` gates `/api/*` by the auth cookie and blocks cross-site mutations; the route is not in `isPublicPath`.)

- [ ] **Step 4: Run to verify pass**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx vitest run app/api/settings/scoring-weights/route.test.ts middleware.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/scoring-weights/route.ts app/api/settings/scoring-weights/route.test.ts middleware.test.ts
git commit -m "feat(scoring): cookie-gated GET/PUT /api/settings/scoring-weights (C8)"
```

---

### Task 8: `/settings` — "SEO scoring weights" card

**Files:**
- Create: `components/settings/ScoringWeightsCard.tsx`
- Modify: `app/settings/page.tsx` (render the card + update the subtitle)

**Interfaces:**
- Consumes: `GET/PUT /api/settings/scoring-weights`; `WEIGHT_LABELS`, `ScoringWeights`, `DEFAULT_WEIGHTS` from `lib/scoring/weights`.

- [ ] **Step 1: Implement the card (client component)**

Create `components/settings/ScoringWeightsCard.tsx` — a `'use client'` component that:
- On mount, `fetch('/api/settings/scoring-weights')` → sets local `weights` state (uses a `mounted` guard before rendering values to avoid hydration mismatch, mirroring `ThemeToggle`).
- Renders 8 labeled number inputs (labels from `WEIGHT_LABELS`, `min={0}`, `step={1}`), a **Save** button (`PUT`s the state; shows the returned `error` inline on 400 and a "Saved" confirmation on 200), and a **Reset to defaults** button (sets state to `DEFAULT_WEIGHTS`, does not auto-save).
- A helper line: "Weights apply to future scores only; existing audits keep their scored breakdown."
- Full dark-mode variants using the same card shell as `OnPageSeoSection` (`bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6`) and input styling consistent with existing settings components (match `ScheduleControls`).

Card shell + a representative input row:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { WEIGHT_LABELS, DEFAULT_WEIGHTS, type ScoringWeights } from '@/lib/scoring/weights'

export function ScoringWeightsCard() {
  const [weights, setWeights] = useState<ScoringWeights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    fetch('/api/settings/scoring-weights').then(r => r.json()).then(d => setWeights(d.weights)).catch(() => {})
  }, [])
  if (!weights) return null
  const keys = Object.keys(WEIGHT_LABELS) as (keyof ScoringWeights)[]
  async function save() {
    setError(null); setSaved(false)
    const res = await fetch('/api/settings/scoring-weights', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(weights),
    })
    if (res.ok) setSaved(true)
    else setError((await res.json()).error ?? 'Save failed.')
  }
  return (
    <section className="mt-6 bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">SEO scoring weights</h2>
      <p className="text-[12px] font-body text-gray-500 dark:text-white/50 mb-4">
        Applied to both the Screaming Frog and live SEO health scores. Weights apply to future scores only;
        existing audits keep their scored breakdown. Crawl depth affects the SF score only.
      </p>
      <div className="grid grid-cols-2 gap-4">
        {keys.map((k) => (
          <label key={k} className="text-[13px] font-body text-navy dark:text-white">
            {WEIGHT_LABELS[k]}
            <input type="number" min={0} step={1} value={weights[k]}
              onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-navy dark:text-white" />
          </label>
        ))}
      </div>
      {error && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="mt-3 text-[13px] text-green-700 dark:text-green-400">Saved.</p>}
      <div className="mt-4 flex gap-3">
        <button onClick={save} className="rounded-lg bg-navy text-white dark:bg-white dark:text-navy px-4 py-2 text-[13px] font-heading font-semibold">Save</button>
        <button onClick={() => { setWeights(DEFAULT_WEIGHTS); setSaved(false); setError(null) }}
          className="rounded-lg border border-gray-300 dark:border-navy-border px-4 py-2 text-[13px] font-body text-navy dark:text-white">Reset to defaults</button>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Render it on `/settings`**

In `app/settings/page.tsx`, import and render `<ScoringWeightsCard />` after `<ScheduleControls />`; extend the subtitle to mention "and SEO scoring weights".

- [ ] **Step 3: Verify build + typecheck**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/settings/ScoringWeightsCard.tsx app/settings/page.tsx
git commit -m "feat(scoring): /settings SEO scoring-weights editor card (C8)"
```

---

### Task 9: `ScoreExplanation` panel + wire into both results surfaces

**Files:**
- Create: `components/scoring/ScoreExplanation.tsx`
- Test: `components/scoring/ScoreExplanation.test.tsx`
- Modify: `components/seo-parser/ResultsView.tsx` (accept + render breakdown prop)
- Modify: `app/seo-parser/results/[sessionId]/page.tsx` + `app/seo-parser/results/run/[runId]/page.tsx` (read `CrawlRun.scoreBreakdown`, pass to `ResultsView`)
- Modify: `components/site-audit/OnPageSeoSection.tsx` (accept `breakdown` prop, render panel) + `app/ada-audit/site/[id]/page.tsx` (select `scoreBreakdown`, pass it)

**Interfaces:**
- Consumes: `PersistedBreakdown` from `lib/scoring/weights`.
- Produces: `ScoreExplanation({ breakdown: string | null })` — renders the factor table, an "unavailable" state for `null`, and nothing extra when a factor list is empty.

- [ ] **Step 1: Write the component test**

Create `components/scoring/ScoreExplanation.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScoreExplanation } from './ScoreExplanation'

const bd = JSON.stringify({ version: 1, scorer: 'health', score: 72, factors: [
  { key: 'indexability', label: 'Indexability', weight: 20, earned: 18, possible: 20 },
] })

describe('ScoreExplanation', () => {
  it('renders factor rows from a breakdown', () => {
    render(<ScoreExplanation breakdown={bd} />)
    expect(screen.getByText('Indexability')).toBeTruthy()
    expect(screen.getByText(/18/)).toBeTruthy()
  })
  it('renders unavailable state for null', () => {
    render(<ScoreExplanation breakdown={null} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
  it('renders unavailable on malformed JSON', () => {
    render(<ScoreExplanation breakdown={'{'} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
```
(This test uses jsdom + Testing Library — confirm they're already used elsewhere in `components/**/*.test.tsx`; follow that setup.)

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/scoring/ScoreExplanation.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the component**

```tsx
// components/scoring/ScoreExplanation.tsx
import type { PersistedBreakdown } from '@/lib/scoring/weights'

export function ScoreExplanation({ breakdown }: { breakdown: string | null }) {
  let parsed: PersistedBreakdown | null = null
  if (breakdown) {
    try { parsed = JSON.parse(breakdown) as PersistedBreakdown } catch { parsed = null }
  }
  if (!parsed || !Array.isArray(parsed.factors) || parsed.factors.length === 0) {
    return (
      <p className="text-[12px] font-body text-navy/45 dark:text-white/45">
        Score breakdown unavailable (scored before breakdowns were recorded).
      </p>
    )
  }
  return (
    <details className="mt-2">
      <summary className="text-[12px] font-body text-navy/60 dark:text-white/60 cursor-pointer">How this score was calculated</summary>
      <table className="mt-2 w-full text-[12px] font-body text-navy dark:text-white">
        <thead>
          <tr className="text-navy/45 dark:text-white/45 text-left">
            <th className="py-1">Factor</th><th>Weight</th><th>Earned</th><th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {parsed.factors.map((f) => {
            const totalPossible = parsed!.factors.reduce((a, x) => a + x.possible, 0)
            const contribution = totalPossible > 0 ? Math.round((f.earned / totalPossible) * 100) : 0
            return (
              <tr key={f.key} className="border-t border-gray-100 dark:border-navy-border/50">
                <td className="py-1">{f.label}</td>
                <td>{f.weight}</td>
                <td>{Math.round(f.earned * 10) / 10}/{f.possible}</td>
                <td>{contribution}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] font-body text-navy/40 dark:text-white/40">
        Weights as scored; current weights may differ.
      </p>
    </details>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/scoring/ScoreExplanation.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into the SEO parser results page**

- In both `app/seo-parser/results/[sessionId]/page.tsx` and `.../run/[runId]/page.tsx`: the page already resolves the `CrawlRun` for the archived fallback — extend that query's `select` with `scoreBreakdown`, and pass `scoreBreakdown` as a prop into `ResultsView` (read the file to find the exact `CrawlRun` read; if the session path only loads the blob, add a `prisma.crawlRun.findFirst({ where: { sessionId }, select: { scoreBreakdown: true } })`).
- In `components/seo-parser/ResultsView.tsx`: add an optional `scoreBreakdown?: string | null` prop and render `<ScoreExplanation breakdown={scoreBreakdown ?? null} />` immediately below the existing health-score display.

- [ ] **Step 6: Wire into `OnPageSeoSection`**

- In `components/site-audit/OnPageSeoSection.tsx`: add `breakdown: string | null` to the props, and render `<ScoreExplanation breakdown={breakdown} />` directly under `<ScoreLine …/>` in both the "clean" and "findings" branches.
- In `app/ada-audit/site/[id]/page.tsx`: add `scoreBreakdown: true` to the live-scan `CrawlRun` select and pass `breakdown={liveRun?.scoreBreakdown ?? null}` into `<OnPageSeoSection …/>`.

- [ ] **Step 7: Verify typecheck + the affected tests**

Run:
```bash
npm run lint && DATABASE_URL="file:./local-dev.db" npx vitest run components/scoring components/seo-parser components/site-audit
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/scoring app/seo-parser/results components/seo-parser/ResultsView.tsx components/site-audit/OnPageSeoSection.tsx app/ada-audit/site/[id]/page.tsx
git commit -m "feat(scoring): ScoreExplanation panel on SEO results + on-page section (C8)"
```

---

### Task 10: Full gate + PR

- [ ] **Step 1: Run all three gates**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: tsc clean; full vitest suite green (existing ~2893 + the new cases); build OK.

- [ ] **Step 2: Push + open PR (STOP — Kevin merges/deploys)**

```bash
git push -u origin feat/c8-configurable-scoring-weights
gh pr create --title "feat(scoring): configurable SEO scoring weights + explanation panel (C8)" --body "<summary + spec link + 'no new required env var; migration additive, applies automatically on deploy'>"
```

Do NOT merge or deploy. Hand off to Kevin with the tracker/handoff ritual.

---

## Self-Review

**Spec coverage:**
- §2.1 ScoringWeights table → Task 1. §2.2 scoreBreakdown + JSON shape + typing → Task 1 (schema/type) + serializer Task 2. §2.3 migration → Task 1.
- §3 scorer refactor (pure, weights passed) → Tasks 3–4; caller wiring + dropped precedence → Tasks 5–6; full call-site list covered (parity.ts T5; types/writer T1; live builder T6; readers T9).
- §4 route + validation (live-eligible rule) → Task 7 (+ validate in Task 2). §4.2 /settings card → Task 8.
- §5 explanation panel + plumbing (separate prop, both surfaces, live omits crawl depth, unavailable state) → Task 9.
- §6 testing → per-task tests + Task 10 gate. §8 acceptance criteria → all mapped.

**Placeholder scan:** the only "read the file to find the exact line" notes are in Task 5 (parity.ts) and Task 9 (results-page CrawlRun read) — these are genuine "follow the existing pattern in a file whose full body isn't reproduced here" instructions, with the exact edit specified (add a select field, pass a prop). No `TODO`/`add error handling`/`similar to Task N`.

**Type consistency:** `ScoreResult { score, factors }`, `ScoreBreakdownFactor`, `PersistedBreakdown { version, scorer, score, factors }`, `ScoringWeights`, `serializeBreakdown`, `resolveScoringWeights`, `validateWeights`, `WEIGHT_LABELS`, `LIVE_ELIGIBLE_KEYS` — defined in Task 2, used consistently in Tasks 3–9. `computeHealthScore(result, weights)` / `scoreLiveSeo(inp, weights)` signatures consistent across Tasks 3–6.
