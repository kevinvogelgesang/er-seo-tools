# C19 PR2 — SEO Recalibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recalibrate both SEO scorers to the school-grade anchor through one shared curve core, add the live broken-links factor (with persisted verification denominators), move SEO breakdowns to version 2 (weightsHash + inputsSnapshot), and make sparkline delta-suppression actually work for SEO (it is structurally dead today).

**Architecture:** New pure client-safe curve core `lib/scoring/seo-core.ts` with parameterized knees; `computeHealthScore` (SF adapter) and `scoreLiveSeo` (live adapter) become thin input-mappers over it, with contract tests proving identical knees. The live-scan builder (`broken-link-verify.ts`) persists a `linkVerification` snapshot and feeds the new factor. `buildSeries` gains `comparabilityBreak: 'version' | 'weights' | null`; both SEO series call sites stop dropping `scoreBreakdown`.

**Tech Stack:** TypeScript, vitest, Prisma/SQLite. NO schema migration (the `brokenLinks` weight is a code default in PR2; its DB column + settings card are PR3).

**Spec:** `docs/superpowers/specs/2026-07-09-c19-scoring-overhaul-design.md` (Codex ×7). PR2 covers Part 2, the SEO half of Part 3, and the SEO replay half of Part 5. PR1 (ADA v4) shipped 2026-07-10 (PR #142); reuse its `hashWeights` (`lib/scoring/weights-hash.ts`, server-only).

## Recon facts (verified 2026-07-10 — trust these over memory)

- `computeHealthScore(result: AggregatedResult, weights: ScoringWeights)` has ONE production caller: `lib/findings/seo-mapper.ts:117`, serialized at `:131` via `serializeBreakdown('health', …)`.
- `scoreLiveSeo(inp: LiveScoreInputs, weights)` has ONE call site: `lib/jobs/handlers/broken-link-verify.ts:452-462`; persisted at `:509` via `serializeBreakdown('live-seo', …)`; `writeFindingsRun` spreads `run` verbatim so new breakdown content persists with zero writer changes.
- In scope at that call site: `capped`, `harvestTruncated`, `cappedValidation`, `internalBudgetHit`, `externalCapped`, `externalHarvestTruncated`, `checked`, `unconfirmed`, `externalChecked`, `externalUnconfirmed`; the run's `status: 'partial'` decision (`:508`) = `capped || harvestTruncated || cappedValidation || externalCapped || externalHarvestTruncated || internalBudgetHit`.
- `PersistedBreakdown.version` is a hardcoded literal 1; `LIVE_ELIGIBLE_KEYS` = all keys except `crawlDepth`.
- `buildSeoSeries` points NEVER carry `scoreVersion` — and both call sites (`lib/services/client-fleet.ts:139-148`, `lib/services/client-dashboard.ts:130-139`) SELECT `scoreBreakdown` then DROP it in the `.map()`. `formulaChanged` is structurally unreachable for SEO.
- `formulaChanged` has ZERO consumers in components/ or app/ — its only effect is `delta: null` suppression. No UI copy work needed.
- `ScoreExplanation.tsx` renders any factor-array breakdown generically (no version gate) — v2 with the same `factors` shape renders unchanged. SEO panel *enrichment* is deferred to PR3 (with the Score Lab).
- Knee-literal tests live in `lib/services/scoring.service.test.ts` `describe('computeHealthScore — threshold boundaries')` (~line 343): fixtures pin 95% indexability, crawl-depth 3.0/6.0, schema 30%. These assert the CURRENT formula → they MOVE with the recalibration (they are not historical pins). `lib/findings/live-seo-score.test.ts`'s 11 tests are relative/gate tests — safe under monotonic curve changes.
- `CrawlPage` has `statusCode/title/h1/metaDescription/wordCount/indexable` (all optional); `CrawlRun.schemaTypesJson` exists (live-scan only).
- The settings route (`app/api/settings/scoring-weights/route.ts`) persists validated weights to the singleton row — the row has ONLY the 8 existing columns. Adding `brokenLinks` to `DEFAULT_WEIGHTS` makes `validateWeights` emit it: the route MUST explicitly pick the 8 persistable columns or Prisma rejects the unknown field at runtime (tsc-invisible if the route spreads). Task 2 handles this.

## Global Constraints

- Gates: `npx tsc --noEmit` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- `lib/scoring/seo-core.ts` stays pure + client-safe (no `@/lib/db`, no node-only imports). `hashWeights` stays server-only — call it only in the two persist paths (seo-mapper is invoked server-side via seo-write; broken-link-verify is a job handler).
- Historical scores/breakdowns are NEVER recomputed or backfilled. v1 breakdowns keep rendering as today.
- The SEO archetype calibration tests (Task 1) are the band contract — never widen a band to make a curve fit.
- `scoreLiveSeo` null-gates are UNCHANGED: attempted ≤ 0 → null; observed/attempted < 0.5 → null; indexableScored ≤ 0 → null.
- `unconfirmed` link outcomes NEVER count as broken and NEVER enter the broken-links denominator.
- Array-form `$transaction` only; never `git add -A`; commit prefix `feat(c19-pr2):`/`test(c19-pr2):`.

---

### Task 1: Shared curve core + v2 breakdown types + SEO archetype bands

**Files:**
- Create: `lib/scoring/seo-core.ts`
- Create: `lib/scoring/seo-core.test.ts`
- Create: `lib/scoring/seo-calibration.test.ts`
- Modify: `lib/scoring/breakdown-version.ts` (add `parseScoreMeta`)
- Test: extend `lib/scoring/breakdown-version.test.ts`

**Interfaces (Produces — exact, later tasks consume verbatim):**

```ts
// lib/scoring/seo-core.ts — pure, client-safe. THE single home of SEO factor
// curves (C19 PR2). Both scorers adapt inputs onto these functions; contract
// tests in the adapter suites prove identical knees. Knee constants are
// exported so tests pin them explicitly.
export const SEO_KNEES = {
  indexabilityFull: 0.98,        // was 0.95 — full points at ≥98% indexable
  errorRateFull: 0.01,           // unchanged — full points below 1% errors
  errorRateZero: 0.20,           // was 1.0 — zero points at ≥20% errors
  missingElementFull: 0.02,      // was 0 — full points at ≤2% missing
  missingElementZero: 0.30,      // was 1.0 — zero points at ≥30% missing
  crawlDepthFull: 3.0,           // unchanged
  crawlDepthZero: 6.0,           // unchanged
  thinFull: 0.05,                // unchanged
  thinZero: 0.25,                // was 0.40
  schemaFull: 0.30,              // unchanged
  brokenLinksZero: 0.05,         // NEW — zero points at ≥5% broken-of-checked
} as const

// Each returns earned points in [0, weight]; linear between its knees.
export function indexabilityPoints(ratio: number, weight: number): number
export function errorRatePoints(rate: number, weight: number): number
export function missingElementPoints(pct: number, weight: number): number   // pct = count/base
export function crawlDepthPoints(depth: number, weight: number): number
export function thinContentPoints(ratio: number, weight: number): number
export function schemaPoints(ratio: number, weight: number): number
export function brokenLinksPoints(ratio: number, weight: number): number    // ratio = broken/checked; full at 0

// v2 persisted breakdown (spec Part 3). factors keep the v1 row shape so
// ScoreExplanation renders v2 unchanged; inputsSnapshot carries the raw
// ratios (Codex spec-fix #5 — the Score Lab's SEO data source).
export interface SeoInputsSnapshot {
  totalUrls?: number; indexableUrls?: number; clientErrors?: number; serverErrors?: number
  base?: number; missingTitle?: number; missingMeta?: number; missingH1?: number
  avgCrawlDepth?: number; thinCount?: number; pagesWithSchema?: number
  linkVerification?: LinkVerificationSnapshot
}
export interface LinkVerificationSnapshot {
  internalChecked: number; internalBroken: number
  imagesChecked: number; imagesBroken: number
  passComplete: boolean
}
export interface PersistedBreakdownV2 {
  version: 2; scorer: 'health' | 'live-seo'; score: number | null
  weightsHash: string; factors: ScoreBreakdownFactor[]; inputsSnapshot: SeoInputsSnapshot
}
export function serializeBreakdownV2(
  scorer: 'health' | 'live-seo', r: ScoreResult, weightsHash: string, inputsSnapshot: SeoInputsSnapshot,
): string
```

(`ScoreBreakdownFactor`/`ScoreResult` are imported from `./weights` — unchanged.)

```ts
// breakdown-version.ts addition — client-safe, tolerant like parseScoreVersion:
export function parseScoreMeta(scoreBreakdown: string | null | undefined): { version: number; weightsHash: string | null }
// missing/malformed → { version: 1, weightsHash: null }
```

Curve semantics (tests pin these exactly):
- indexability: `ratio ≥ 0.98 → weight`, else linear `(ratio / 0.98) × weight` (same shape as today, knee moved).
- errorRate: `rate < 0.01 → weight`; `rate ≥ 0.20 → 0`; linear between 0.01 and 0.20.
- missingElement: `pct ≤ 0.02 → weight`; `pct ≥ 0.30 → 0`; linear between.
- crawlDepth / thin / schema: today's shapes with the constants above.
- brokenLinks: `ratio ≤ 0 → weight`; `ratio ≥ 0.05 → 0`; linear between.

- [ ] **Step 1: Failing tests** — `seo-core.test.ts`: for EACH curve fn: full-points boundary, zero-points boundary, one interior point computed by hand (e.g. errorRate 0.105 → weight × (1 − (0.105−0.01)/0.19) = weight × 0.5), monotonicity (decreasing in badness), and clamping (never <0, never >weight). `breakdown-version.test.ts`: parseScoreMeta on a v1 blob → {1, null}; on a PR1 ADA v4 blob with weightsHash → {4, hash}; malformed → {1, null}. `seo-calibration.test.ts` — the SEO band contract over the CORE fns with DEFAULT weights (indexability 20/errorRate 20/missingTitle 10/missingMeta 8/missingH1 7/crawlDepth 15/thinContent 10/schema 10):

```ts
// Bands (Kevin 2026-07-09 anchor, SEO edition). Score = round(100 × earned/possible)
// over the 8 SF factors. Never widen a band.
// CLEAN: 100% indexable, 0 errors, 0 missing, depth 2.5, 2% thin, 40% schema → ≥95
// LIGHTLY FLAWED: 96% indexable, 2% errors, 5% missing meta+h1, depth 3.5, 8% thin, 25% schema → 85–92
// VISIBLY FLAWED: 90% indexable, 6% errors, 12% missing title+meta+h1, depth 4.5, 18% thin, 10% schema → 70–80
// BROKEN: 70% indexable, 25% errors, 35% missing all, depth 6.5, 30% thin, 0% schema → ≤50
```

Compose these via the core fns summed/normalized exactly as `computeHealthScore` does (earned/possible). If a band fails, adjust `SEO_KNEES` (never the band) and re-verify the boundary tests.

- [ ] **Step 2: Verify fail → implement `seo-core.ts` + `parseScoreMeta` → all pass.** `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git add lib/scoring/seo-core.ts lib/scoring/seo-core.test.ts lib/scoring/seo-calibration.test.ts lib/scoring/breakdown-version.ts lib/scoring/breakdown-version.test.ts` → `feat(c19-pr2): shared SEO curve core, v2 breakdown types, band contract`

---

### Task 2: `brokenLinks` weight key + settings-route persistence guard

**Files:**
- Modify: `lib/scoring/weights.ts`, `lib/scoring/resolve-weights.ts`, `app/api/settings/scoring-weights/route.ts`
- Test: extend `lib/scoring/weights.test.ts`, `lib/scoring/resolve-weights.test.ts`, and the settings route's existing test file

**Interfaces:**
- Produces: `ScoringWeights` gains `brokenLinks: number`; `DEFAULT_WEIGHTS.brokenLinks = 10`; `WEIGHT_LABELS.brokenLinks = 'Broken links'`; `LIVE_ELIGIBLE_KEYS` includes it (crawlDepth stays the only exclusion). `resolveScoringWeights()` returns `brokenLinks: DEFAULT_WEIGHTS.brokenLinks` unconditionally (NO DB column until PR3 — document with a `// PR3` comment).
- CRITICAL (recon): the settings route must persist ONLY the 8 existing row columns — write an explicit pick of `{indexability, errorRate, missingTitle, missingMeta, missingH1, crawlDepth, thinContent, schema}` from the validated object (a spread would hit Prisma's unknown-arg at RUNTIME, invisible to tsc). `validateWeights` accepts `brokenLinks` like any key (finite ≥ 0).

- [ ] **Step 1: Failing tests** — weights: DEFAULT sums to 110 pre-normalization is FINE (the scorers normalize earned/possible; assert `DEFAULT_WEIGHTS.brokenLinks === 10` + label + live-eligible membership + validateWeights accepts/rejects it like others). resolve-weights: DB row present → still returns `brokenLinks: 10`. Settings route: PATCH with a body including `brokenLinks: 25` → 200, row updated for the 8 columns, and a follow-up `resolveScoringWeights()` still yields `brokenLinks: 10` (not persisted, documented behavior until PR3).
- [ ] **Step 2: Verify fail → implement → pass; tsc clean.**
- [ ] **Step 3: Commit** — `feat(c19-pr2): brokenLinks weight key (code default; DB column lands in PR3)`

---

### Task 3: SF adapter — `computeHealthScore` onto the core, v2 persistence

**Files:**
- Modify: `lib/services/scoring.service.ts`, `lib/findings/seo-mapper.ts`
- Test: `lib/services/scoring.service.test.ts` (move the threshold-boundary suite to the NEW knees), extend `lib/findings/seo-mapper.test.ts`

**Interfaces:**
- Consumes: all Task 1 core fns + `serializeBreakdownV2` + `SeoInputsSnapshot`; `hashWeights` from `@/lib/scoring/weights-hash` (PR1, server-only — imported by seo-mapper NOT scoring.service, keeping scoring.service client-safe).
- Produces: `computeHealthScore(result, weights)` — SAME signature, SAME factor keys/labels/skip-and-renormalize semantics, curves now delegated to the core fns; ADDITIONALLY returns the raw inputs it derived: signature becomes `computeHealthScore(result, weights): ScoreResult & { inputsSnapshot: SeoInputsSnapshot }` (additive — existing callers unaffected). `brokenLinks` factor is NEVER available on the SF path (no verification data) → renormalizes away by the existing skip rule.
- seo-mapper `:117-131`: persists `serializeBreakdownV2('health', healthResult, hashWeights(ctx.weights), healthResult.inputsSnapshot)`.

Behavior contract:
- Factor availability rules are UNCHANGED (missing data → factor skipped → weights renormalize). Only the curve shapes/knees move.
- Contract test (the Codex #4 requirement): for a grid of ratios per factor, `computeHealthScore` fed a synthetic `AggregatedResult` produces `earned` identical (±1e-9) to calling the core fn directly. Grid: both knees, two interior points, per factor.
- Threshold-boundary suite: rewrite fixtures to the new knees (98% indexability boundary, 2%/30% missing-element boundaries, 1%/20% error-rate, 5%/25% thin; crawl-depth 3.0/6.0 and schema 30% keep their existing assertions).
- seo-mapper test: fresh bundle's `run.scoreBreakdown` parses to `{version: 2, scorer: 'health', weightsHash: /^[0-9a-f]{12}$/, inputsSnapshot: {...counts from the fixture}}`.

- [ ] **Step 1: failing tests → Step 2: implement → Step 3: full sweep** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services lib/findings lib/scoring` all green; tsc clean.
- [ ] **Step 4: Commit** — `feat(c19-pr2): SF health score onto the shared core; persists v2 breakdown + snapshot`

---

### Task 4: Live adapter + broken-links factor + builder snapshot

**Files:**
- Modify: `lib/findings/live-seo-score.ts`, `lib/jobs/handlers/broken-link-verify.ts`
- Test: extend `lib/findings/live-seo-score.test.ts`, extend the builder's existing DB-backed test file (`lib/jobs/handlers/broken-link-verify.test.ts` or the house equivalent — locate it first)

**Interfaces:**
- Produces: `LiveScoreInputs` gains `linkVerification?: LinkVerificationSnapshot | null` (absent/null or `passComplete: false` or zero checked → factor unavailable → renormalizes). `scoreLiveSeo` — same null-gates, curves via the core, returns `ScoreResult & { inputsSnapshot: SeoInputsSnapshot }` (snapshot includes `linkVerification` when provided).
- Builder (`broken-link-verify.ts` around `:452-509`): constructs `linkVerification` from in-scope values —
  - `passComplete = !(capped || harvestTruncated || cappedValidation || internalBudgetHit)` (EXTERNAL flags deliberately excluded: the external pass never feeds this factor),
  - internal/images checked + broken counts split by target kind: broken from the existing `runCounts.get('broken_internal_links'|'broken_images')`; checked split derived from the internal pass's per-kind outcome counts — derive from existing structures (`toCheck`/cache kinds); if a per-kind confirmed-checked split isn't cleanly available, count outcomes by kind at the same place `checked`/`unconfirmed` are derived. INVARIANT: `unconfirmed` outcomes are excluded from BOTH numerator and denominator.
  - Threads `linkVerification` into the `scoreLiveSeo` call; persists `serializeBreakdownV2('live-seo', scoreResult, hashWeights(weights), scoreResult.inputsSnapshot)` at `:509`.
- Factor math: ratio = (internalBroken + imagesBroken) / (internalChecked + imagesChecked); points via `brokenLinksPoints(ratio, weights.brokenLinks)`.

Tests:
- live-seo-score: factor present+clean (0 broken of 200) → contributes full 10 to possible/earned; 5%+ broken → 0 earned but 10 possible (score drops); `passComplete: false` → factor ABSENT from factors[] (renormalized — assert possible excludes it); zero checked → absent; the 11 existing tests stay green (no `linkVerification` supplied → absent).
- Contract tests vs core knees (same grid pattern as Task 3).
- Builder DB test: run the real handler on a seeded harvest (house pattern — synthetic rows, no network; see the existing builder tests + C17's precedent of running the real job on an empty harvest) → persisted run's breakdown parses to v2 with `linkVerification.passComplete: true` and zero counts; and a capped scenario (`BROKEN_LINK_MAX_CHECKS` env or seeded overflow) → `passComplete: false` + factor absent + run status 'partial' unchanged.

- [ ] Steps: failing tests → implement → `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings lib/jobs lib/scoring` green → tsc → **Commit** `feat(c19-pr2): live SEO score onto the core + broken-links factor with persisted verification snapshot`

---

### Task 5: Series comparability — thread SEO breakdowns, version+weights suppression

**Files:**
- Modify: `lib/services/scorecard-shared.ts`, `lib/services/client-fleet.ts:139-148`, `lib/services/client-dashboard.ts:130-139`
- Test: extend `lib/services/scorecard-shared.test.ts`; extend the fleet/dashboard service tests only if they assert point shapes

**Interfaces:**
- `ScorePoint` gains `weightsHash?: string | null`. `ScoreSeries` gains `comparabilityBreak: 'version' | 'weights' | null`; `formulaChanged` KEPT as a derived alias (`comparabilityBreak !== null`) — zero UI consumers exist (recon fact 6), so no copy work.
- `buildSeries`: version mismatch → break 'version'; same version but `(a.weightsHash ?? null) !== (b.weightsHash ?? null)` → break 'weights'; either → `delta: null`.
- `SeoRunRow` gains `scoreBreakdown?: string | null`; `buildSeoSeries` maps points with `...parseScoreMeta(r.scoreBreakdown)` (version + weightsHash). `buildAdaSeries` point mappers ALSO switch `parseScoreVersion` → `parseScoreMeta` so ADA v4 hash changes suppress (PR1 breakdowns already carry weightsHash).
- Both call sites pass `scoreBreakdown: r.scoreBreakdown` through their existing `.map()` (the select already fetches it — recon fact 5).

Tests: two v1 SEO points (no breakdown) → no break, real delta (regression guard); v1 → v2 adjacent → break 'version', delta null; two v2 same hash → real delta; two v2 different hash → break 'weights'; ADA v4 pair with differing hash → 'weights'; `formulaChanged === (comparabilityBreak !== null)` invariant test.

- [ ] Steps: failing tests → implement → `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services` green → tsc → **Commit** `feat(c19-pr2): SEO series carry breakdown meta; delta suppression on version or weights change`

---

### Task 6: Replay script — SEO section

**Files:**
- Modify: `scripts/score-replay.ts`

**Interfaces:**
- Consumes: `computeHealthScore` (new curves) + Session blobs; existing script structure (mode=ro guard, dynamic db import, --json).
- Produces: after the ADA section, an SEO section:
  - **SF runs** (`tool:'seo-parser'`, `source:'sf-upload'`): old = stamped `run.score`; new = `computeHealthScore(JSON.parse(session.result), DEFAULT_WEIGHTS).score` for sessions with an unpruned blob (read-only allowed per spec); pruned/missing blob → skipped with reason.
  - **Live runs** (`source:'live-scan'`): reported as SKIPPED with reason 'inputs not reconstructible pre-C19' — the observed/attempted coverage inputs and verification denominators do not exist for historical runs, and a partial reconstruction would misstate the flip (spec Codex-fix #5's honesty rule). Post-C19 runs list under 'already-v2'.
  - Same band histogram + skipped-vs-scored separation; `--json` extended with an `seo` key.

- [ ] Steps: implement → dry-run `DATABASE_URL="file:./local-dev.db?mode=ro" npx tsx scripts/score-replay.ts` (ADA section unchanged, SEO section prints; refusal path still exits 1) → tsc → **Commit** `feat(c19-pr2): replay script SEO section (SF blob replay; live runs honestly skipped)`

---

### Task 7: Gates, prod SEO replay evidence, PR

- [ ] Full gates (tsc / DATABASE_URL-prefixed npm test / build) — all green.
- [ ] PR `feat(c19-pr2): SEO recalibration — shared curve core, broken-links factor, v2 breakdowns, series comparability`; merge when gate-green (rule 1); deploy with the OOM-safe recipe; post-deploy checklist.
- [ ] Prod replay (read-only) → SEO distribution table → tracker entry. If the SF distribution violates Kevin's bands fleet-wide, STOP and present to Kevin (same protocol as PR1's calibration ruling).
- [ ] Prod behavioral verify: next live-scan run (or a triggered one) persists a v2 breakdown with linkVerification; docs ritual (tracker + handoff same commit).
