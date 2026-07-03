# C8 — Configurable SEO Scoring Weights + Score-Explanation Panel

**Status:** Design (spec)
**Date:** 2026-07-03
**Roadmap item:** C8 (improvement-roadmap-tracker.md) — "Configurable scoring/priority weights + score-explanation panel (0.5–1 wk)"
**Author:** brainstorming session 2026-07-03 (Kevin approved scope + design)

## 1. Problem & goals

The two factor-weighted SEO scorers hardcode their weights inline:

- `computeHealthScore` (`lib/services/scoring.service.ts`) — the Screaming-Frog-upload
  SEO health score. 6 factors: indexability 20, error rate 20, missing title 10 /
  meta 8 / h1 7, crawl depth 15, thin content 10, schema 10. Skips unavailable
  factors and renormalizes `earned/possible*100`.
- `scoreLiveSeo` (`lib/findings/live-seo-score.ts`) — the C6 forked live-scan SEO
  score. Same factor family **minus** crawl-depth and broken-links (never in the
  denominator). Weights today: indexability 20, error 20, title 10, meta 8, h1 7,
  thin 10, schema 10.

Two gaps:

1. **Weights are not configurable.** Changing the emphasis of a factor requires a
   code edit + redeploy. Analysts cannot tune what the score rewards.
2. **The score is opaque.** A user sees `72/100` with no breakdown of which factors
   earned or lost points.

C8 closes both for the two SEO scorers, which share the same factor semantics.

### Goals
- One **global, operator-editable** weight profile that **both** SEO scorers read.
- A **score-explanation panel** on each SEO results surface showing the per-factor
  breakdown (weight, earned/possible, contribution).
- **Fixed history:** a weight edit changes only *future* scores; already-scored
  audits keep their score and breakdown as computed.
- Works on **archived audits** (relational-first; no dependency on pruned blobs).

### Non-goals (explicitly out of scope — YAGNI)
- **ADA scorer** (`lib/ada-audit/scoring.ts` `computeScore`) — structurally different
  (impact-penalty ÷ log10(elements)), separate config + explanation model. Deferred.
- **Per-client weights** — breaks cross-client score comparability; global only.
- **Retroactive recompute** of historical scores under new weights.
- **Issue-severity bucketing** (critical/warning/notice classification) — a separate
  fixed mapping, unrelated to the factor weights. Untouched.
- **Preview-under-draft-weights** in `/settings` — considered, dropped for v1
  (fixed-history without preview). Can be a fast-follow.

## 2. Data model

### 2.1 New `ScoringWeights` table (single global row)
A singleton row holding one weight per factor. Both scorers read it; live SEO
structurally ignores `crawlDepth` exactly as it does today.

```prisma
model ScoringWeights {
  id           Int      @id @default(1)   // singleton: always id=1
  indexability Float    @default(20)
  errorRate    Float    @default(20)
  missingTitle Float    @default(10)
  missingMeta  Float    @default(8)
  missingH1    Float    @default(7)
  crawlDepth   Float    @default(15)      // health score only; live SEO ignores it
  thinContent  Float    @default(10)
  schema       Float    @default(10)
  updatedAt    DateTime @updatedAt
}
```

- **Singleton discipline:** the app always reads/writes `id = 1`. `resolveScoringWeights()`
  (below) upserts / falls back to code defaults if the row is absent, so a fresh DB
  (or a deploy before anyone saves) scores identically to today.
- **Chosen over a generic key-value `Setting` table:** typed columns, trivial
  validation, one row to reason about. No other settings need a store yet (YAGNI).
- Reset-to-defaults = write the `DEFAULT_WEIGHTS` constants back to the row.

### 2.2 `CrawlRun.scoreBreakdown` (new nullable column)
```prisma
// on model CrawlRun
scoreBreakdown String?   // JSON: { factors: [{ key, label, weight, earned, possible }] }
```
- Written next to `score` for **sf-upload** (health) and **live-scan** (live SEO)
  runs. Not written for ADA runs.
- Because `possible === weight` for each factor, the persisted breakdown **is** the
  weight snapshot — this is what gives "fixed history" for free (no separate weights
  snapshot column).
- Tiny scalar (~8 factors) → **not** subject to blob pruning; survives 90-d archive.
- Pre-C8 runs have `scoreBreakdown = null` → the panel renders an "unavailable" state
  (no recompute).

### 2.3 Migration
SQLite, additive only (new table + new nullable column) — no `ALTER COLUMN`, no
table rebuild. Hand-authored migration SQL applied with
`DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy` locally
(migrate dev is interactive-only here); prod applies it automatically inside
`~/deploy.sh`. Name: `<timestamp>_configurable_scoring_weights`.

## 3. Scorer refactor (functions stay pure)

New module `lib/scoring/weights.ts`:
```ts
export interface ScoringWeights {
  indexability: number; errorRate: number;
  missingTitle: number; missingMeta: number; missingH1: number;
  crawlDepth: number; thinContent: number; schema: number;
}
export const DEFAULT_WEIGHTS: ScoringWeights = { indexability:20, errorRate:20,
  missingTitle:10, missingMeta:8, missingH1:7, crawlDepth:15, thinContent:10, schema:10 };
export async function resolveScoringWeights(): Promise<ScoringWeights>; // reads id=1, falls back to DEFAULT_WEIGHTS
export function validateWeights(w: Partial<ScoringWeights>): ScoringWeights | { error: string };
```

Both scorers change signature to **take a `ScoringWeights` and return a breakdown**:
```ts
export interface ScoreBreakdownFactor { key: string; label: string; weight: number; earned: number; possible: number; }
export interface ScoreResult { score: number | null; breakdown: ScoreBreakdownFactor[]; }

export function computeHealthScore(result: AggregatedResult, weights: ScoringWeights): ScoreResult; // score never null (0 when possible===0)
export function scoreLiveSeo(inp: LiveScoreInputs, weights: ScoringWeights): ScoreResult;            // score null on the existing guards
```

- **Purity preserved:** weights are passed in; the scorer never touches the DB. This
  keeps the existing pure-function test posture and the "injected/pure" invariants.
- **Callers resolve + persist** (both are already server-side with DB access):
  - `lib/findings/seo-mapper.ts:128` — `const w = await resolveScoringWeights();`
    then `score` + `scoreBreakdown` from `computeHealthScore(result, w)`. Preserve the
    existing `result.metadata?.health_score ?? …` precedence **only for the number**;
    the breakdown is always computed here so a stored score still gets an explanation.
    (Confirm in the plan whether `metadata.health_score` is ever pre-set on the fresh
    aggregator path — the code comment says it is not.)
  - `lib/jobs/handlers/broken-link-verify.ts:232` — resolve weights, pass to
    `scoreLiveSeo`, persist `run.score` + `run.scoreBreakdown`.
- **Invariant — "perfect inputs → exactly 100":** holds for any finite non-negative
  weights with at least one > 0, because the score is `round(earned/possible*100)`
  and `earned === possible` when every included factor is perfect. A pure test asserts
  this under several weight sets.
- **Invariant — live SEO null-guards unchanged:** `attempted<=0`,
  `observed/attempted<0.5`, `indexableScored<=0` still return `{score:null,…}`.

### Backward compatibility
`computeHealthScore` / `scoreLiveSeo` currently return a bare `number` / `number|null`.
All call sites (2 non-test each, enumerated in §1/§3) and their tests are updated in
the same change. No dual API — the return type changes to `ScoreResult`.

## 4. `/settings` UI + route

### 4.1 Route `GET/PUT /api/settings/scoring-weights`
- **Cookie-gated** (normal auth), **not public** → no `middleware.ts` `isPublicPath`
  entry. A `middleware.test.ts` (or route) case asserts an unauthenticated request is
  rejected (401/redirect), matching the repo's route-auth discipline.
- `GET` → current weights (resolved row or defaults).
- `PUT` → `validateWeights(body)`; on success upsert `id=1`, return the saved weights;
  on failure 400 with `{ error }`. Validation: every weight a finite number ≥ 0, at
  least one > 0 (so `possible` can never be 0). `JSON.parse` wrapped in try/catch.

### 4.2 `/settings` card
- A **"SEO scoring weights"** section on the existing `app/settings/page.tsx`: 8
  labeled number inputs pre-filled with current values, **Save** and **Reset to
  defaults** buttons, inline validation + save confirmation/error.
- Full dark-mode variants (`bg-white`→`dark:bg-navy-card`, etc.); if it holds
  client state before hydration, use the `mounted` guard pattern.
- Copy notes that weight changes apply to **future** scores only.

## 5. Score-explanation panel

- New component `components/scoring/ScoreExplanation.tsx` (client) taking a parsed
  `ScoreBreakdownFactor[]` (+ the score) and rendering a compact table/bars: factor
  label, weight, `earned/possible`, and % contribution to the final score. A footer
  note: "Weights as scored on <date>; current weights may differ."
- **Placement:**
  - **SEO parser results page** — near the health-score display (exact host component
    identified in the plan; `CrawlRun.scoreBreakdown` added to that page's query).
  - **`components/site-audit/OnPageSeoSection.tsx`** — expandable, next to the live-SEO
    `ScoreLine`. The section's query selects `scoreBreakdown`.
- **States:** breakdown present → panel; `score === null` (live SEO unscoreable) →
  existing "not enough coverage" line, no panel; `scoreBreakdown === null` (pre-C8
  run) → "Score breakdown unavailable (scored before breakdowns were recorded)".
- **Archived-safe:** reads only the `scoreBreakdown` scalar + `score`; no blob, no
  recompute. Renders identically for archived and live runs.

## 6. Testing

- **Pure scorer tests** (`scoring.service.test.ts`, `live-seo-score.test.ts`):
  weights + inputs → expected score **and** breakdown; "perfect → 100" under ≥2
  distinct weight sets; renormalization when a factor is unavailable; live-SEO
  null-guards intact; a zeroed factor contributes 0/0 and drops out of the denominator.
- **`resolveScoringWeights` / `validateWeights`** — DB-backed: absent row → defaults;
  present row → its values; validation rejects negative / NaN / all-zero, accepts a
  valid partial-then-defaulted set. (Scoped cleanup; the singleton row is global, so
  the test resets it to defaults in `afterEach` to stay deterministic.)
- **Route test** — GET returns current; PUT validates + persists; unauthenticated
  rejected.
- **Panel render test** — breakdown → rows; null breakdown → unavailable; null score
  → no panel.
- **Migration** present and `prisma migrate status` clean locally.
- Gate-green: `npm run lint` + `npm test` + `npm run build`.

## 7. Risks & mitigations

- **Global singleton row contention** — writes are rare (operator settings); a single
  `id=1` upsert is fine on SQLite. No concurrency concern.
- **A weight test that mutates the global row** could bleed into other DB tests — the
  weights tests reset `id=1` to defaults in cleanup, and all *scoring* production reads
  pass weights explicitly (pure), so only the `resolveScoringWeights` tests touch the
  row.
- **`metadata.health_score` precedence** — if some path pre-sets it, the persisted
  *number* may differ from the freshly-computed breakdown's implied score. The plan
  confirms the fresh-aggregator path does not pre-set it (per the seo-mapper comment);
  if it can, we compute both from the same `computeHealthScore` call so they agree.
- **Merge-state note:** none of this touches canonical-run selection
  (`selectRuns`/`seo-canonical.ts`); the live score still never displaces the sf-upload
  canonical score.

## 8. Acceptance criteria

1. `ScoringWeights` singleton + `CrawlRun.scoreBreakdown` migrated; additive; prod
   deploy applies it automatically.
2. Both SEO scorers read the shared weights and persist `score` + `scoreBreakdown`;
   a fresh DB scores identically to pre-C8 (defaults).
3. Editing weights on `/settings` changes **future** scores only; existing audits keep
   their score + breakdown (fixed history).
4. The explanation panel renders the per-factor breakdown on the SEO parser results
   page and in `OnPageSeoSection`, works on archived runs, and degrades to an
   "unavailable" state for pre-C8 runs.
5. "Perfect inputs → 100" holds under any valid weights; live-SEO null-guards intact.
6. Gate-green; route auth-tested; no `isPublicPath` change.
