# C6 Phase 3 — Live SEO score (forked scorer) — Design Spec

**Date:** 2026-06-17
**Status:** Active (spec under review)
**Author:** Kevin + Claude, Codex peer review (turns 68–69, ACCEPT-WITH-FIXES — all fixes folded in)
**Track:** C6 (Live SEO / Screaming-Frog-retirement), Phase 3.
**Builds on:** C6 Phase 1 (broken-link verifier, PR #70) + Phase 2 (on-page SEO
extraction, PR #71). Realizes the score deferred by Phase 2 (`CrawlRun.score`
was hardcoded `null`).
**Reconciles:** the forked-scorer design in
`docs/superpowers/nyi/plans/2026-06-02-live-seo-on-ada.md` §6 (which assumed its
own `SiteSeoResult` model + runner-path coverage capture) — landed instead in the
findings model with coverage derived from existing scalars.

---

## 1. Problem & goal

The live-scan `CrawlRun` (`tool:'seo-parser'`, `source:'live-scan'`) produced by
the ADA site audit carries on-page + broken-link `Finding`s but **no score**
(`null` since Phase 2). This phase gives it a real **live SEO health score**
(0–100, or `null`) computed from the on-page signals already harvested.

**Goal:** a forked, coverage-aware scorer that (a) never awards points for signals
the live audit cannot measure (crawl depth, link graph), (b) returns `null` rather
than a misleadingly precise number when there isn't enough to score, and (c) stays
**structurally comparable to the SF `computeHealthScore`** so a future SF-vs-Live
parallel-run trust gate is meaningful.

**Non-replacement of the canonical SEO score.** The sf-upload (Screaming Frog CSV)
run stays the canonical SEO score everywhere (`selectRuns`, B1 series, dashboard).
The live-scan score is **additive and segregated** — it surfaces only on the site
audit's results page and NEVER displaces the sf-upload score. No `selectRuns`
change.

---

## 2. Scope

### In scope (MVP)
- A pure `scoreLiveSeo(inputs): number | null` (forked from `computeHealthScore`,
  explicit factor-availability).
- Called in the builder (`broken-link-verify.ts`) at build time; result written to
  the live-scan `CrawlRun.score`.
- Read-time coverage/confidence line on the results page (`OnPageSeoSection`).

### Out of scope (explicit non-goals)
- **Runner-path surgery.** Coverage is derived from existing `SiteAudit` counters +
  the harvested rows — NO capture on the runner's redirect/non-HTML/error exits
  (Phase 2 deliberately avoided this; the counts suffice — §4).
- **New models / migration.** Score → existing `CrawlRun.score`; coverage
  recomputed at read time. No persisted coverage/confidence/reason-codes (a future
  phase can add a detail column if factor breakdowns are wanted).
- **Crawl depth / link-graph / authority factors** (no graph in the live audit —
  roadmap Phase 3a).
- **Broken links as a scored factor.** They stay high-priority *findings* but are
  NOT in the score (capped/unconfirmed/WAF-sensitive/source-sampled — would distort
  live-vs-SF comparison). A future "live health" score may add them after the trust
  gate.
- **`selectRuns` / B1 / dashboard / SF-vs-Live comparison UI** — untouched.

---

## 3. Architecture

```
broken-link-verify.ts (the live-scan run builder, post-terminal)
  … verify broken links … read HarvestedPageSeo (seoRows) …
  build CrawlPages (scalars) + on-page findings + broken findings  [Phase 2]
  [NEW] coverage = deriveCoverage(siteAudit counters, seoRows)
  [NEW] score = scoreLiveSeo(scoreInputs)            ← pure, all inputs in hand
  run.score = score                                   ← was null
  writeFindingsRun(bundle); delete transient tables   [Phase 2, unchanged]

results page (app/ada-audit/site/[id]/page.tsx)
  [NEW] select liveScanRun.score + page counts; pass to OnPageSeoSection
  [NEW] OnPageSeoSection shows score (or "not enough coverage") + coverage line
```

The scorer is a **pure function** (`lib/findings/live-seo-score.ts`), unit-tested in
isolation. The builder assembles its inputs from data it already holds (no new
queries beyond what Phase 2 reads). Confidence/coverage is **recomputed at read
time** from `CrawlPage` + `SiteAudit` — never persisted.

---

## 4. Coverage (the null-guard inputs)

Computed at **build time** from data in hand:

- `attempted = SiteAudit.pagesTotal` — the discovered/attempted page count. Stable
  at build time: `finalizeSiteAudit` only reaches terminal `complete` when
  `pagesComplete + pagesError + pagesRedirected >= pagesTotal`.
- `observed = seoRows.length` — the count of `HarvestedPageSeo` rows (one per
  successfully-settled HTML page). **NOT `SiteAudit.pagesComplete`** (Codex fix):
  `pagesComplete` is bumped inside the settle transaction, but `persistPageSeo` is
  best-effort *after* it, so a harvest failure leaves a completed page with no row.
  `observed` must be the actual row count.
- `indexableScored` = count of `seoRows` that are indexable AND not login-like,
  where indexable = `statusCode∈[200,300) ∧ isHtml ∧ ¬robotsNoindex ∧ ¬xRobotsNoindex`.
  (Same predicate the Phase 2 builder uses to set `CrawlPage.indexable`; these
  rows' `CrawlPage`s carry `indexable=true`.)

**Read-time recomputation** (for the coverage display): `observed` = count of the
run's `CrawlPage`s with `statusCode != null`; `indexableScored` = count with
`indexable === true`; `attempted` = `SiteAudit.pagesTotal`. These match the
build-time values (the builder materializes one `CrawlPage` per `seoRow` with those
scalars).

Error/redirect/non-HTML pages are reflected only in `attempted` (via the counters)
— they have no rows and are never scored. Redirects affect **coverage, not the
score** (documented; a redirect factor is a possible future addition).

---

## 5. The forked scorer `scoreLiveSeo`

```ts
interface LiveScoreInputs {
  attempted: number          // SiteAudit.pagesTotal
  observed: number           // seoRows.length
  indexableScored: number    // eligible (indexable && !loginLike) rows
  pagesError: number         // SiteAudit.pagesError
  missingTitle: number       // over the eligible set
  missingMeta: number
  missingH1: number
  thin: number               // 0 < wordCount < 300 over the eligible set
  pagesWithSchema: number    // eligible rows with schemaCount > 0
}
function scoreLiveSeo(inp: LiveScoreInputs): number | null
```

### Null-guard (return `null` — "not enough to score")
Return `null` when ANY of:
1. `attempted === 0` (nothing crawled), OR
2. `observed / attempted < 0.5` (couldn't observe enough of the site — login wall
   redirecting to a portal, mass errors), OR
3. `indexableScored === 0` (no indexable content → live SEO health is unscoreable).

Rule 3 unifies three cases into one honest answer: a fully-noindex site (the canary)
and a fully-login-walled site both → `null` rather than a misleading mid-range
number propped up by the schema/error factors. A **partially**-noindex site still
scores, with the indexability factor dragging it down (mirrors SF). `0.5` is a
documented starting threshold — revisit after a fleet sample.

### Factors (only included when their signal is available; never award for absent)
`base = indexableScored` (> 0 here, since rule 3 already returned null otherwise).
Accumulate `(earned, possible)`:

| Factor | Weight | Formula | Included when |
|---|---|---|---|
| Indexability ratio | 20 | full ≥0.95 of `indexableScored/observed`, linear to 0 | always (`observed>0`) |
| Error rate | 20 | full if `pagesError/attempted < 0.01`, linear to 0 at 100% | always |
| Missing title | 10 | `10·(1 − min(1, missingTitle/base))` | always (`base>0`) |
| Missing meta | 8 | `8·(1 − min(1, missingMeta/base))` | always |
| Missing H1 | 7 | `7·(1 − min(1, missingH1/base))` | always |
| Thin content | 10 | full if `thin/base < 0.05`, 0 if `>0.40`, linear between | always |
| Schema coverage | 10 | full if `pagesWithSchema/observed ≥ 0.30`, linear to 0 | always |

`score = round( earned / possible × 100 )`, clamped 0–100. Crawl depth (15 in SF) and
broken links are **never added** to `possible` — the denominator renormalizes over
the included factors (SF does the same for absent factors).

**Fork rationale (do NOT call `computeHealthScore`):** it (a) awards full crawl-depth
points for `avg_crawl_depth: 0` (a live run has none), and (b) only counts thin
content when a `thin_content` issue object exists — so "measured, zero thin" is
skipped instead of awarded full marks. The fork takes explicit numeric inputs and
always includes the available factors with their real (possibly zero) counts.

Indexability uses `observed` as the denominator (not `attempted`) so error pages
aren't double-penalized — they're already in the error-rate factor.

---

## 6. Builder integration (`broken-link-verify.ts`)

After building `seoRows` + the on-page partial (Phase 2), before/at the bundle
assembly:
- compute `pagesWithSchema` from `seoRows` (`schemaCount > 0`) — **must happen
  before the `HarvestedPageSeo` rows are deleted** (`CrawlPage` has no schema
  scalar; the transient rows are the only source).
- load the `SiteAudit` counters (`pagesTotal`, `pagesError`) — extend the existing
  `site` select (currently `id, domain, clientId`).
- compute `missing*/thin` counts from the eligible set (reuse the same
  `deriveIssueTypesForPage`-based counts the on-page mapper already produces, or
  recompute from `seoRows`).
- `run.score = scoreLiveSeo(inputs)` (replaces the hardcoded `null`).

The empty-harvest case (no rows) → `attempted` may be >0 but `observed=0` →
`observed/attempted < 0.5` → `null` (unchanged clean-run behavior; score stays null).

---

## 7. Surface (`OnPageSeoSection` + results page)

- The results-page query (`app/ada-audit/site/[id]/page.tsx`) extends the
  `liveScanRun` select to include `score` and a page aggregate sufficient to count
  `observed` (`statusCode != null`) and `indexableScored` (`indexable === true`)
  — e.g. `pages: { select: { statusCode: true, indexable: true } }` (the run has
  ≤ ~1000 pages) or two filtered `_count`s. `SiteAudit.pagesTotal` is already loaded.
- `OnPageSeoSection` gains `score: number | null` + the counts. It renders:
  - the score (0–100) as a small scorecard, OR "Not enough coverage to score"
    when `null`;
  - a one-line coverage note: "N of M pages analyzed · K indexable" (read-time
    recompute), with the existing "rendered, sitemap-bounded — not SF parity"
    caveat.
- `selectRuns` and every other surface (B1 series, dashboard, fleet) **unchanged**
  — the live score never displaces the sf-upload score.

---

## 8. Testing

**Pure scorer** (`live-seo-score.test.ts`):
- `attempted=0` → null; `observed/attempted < 0.5` → null; `indexableScored=0` →
  null (covers fully-noindex AND fully-login-wall).
- perfect on-page (0 missing/thin, ≥30% schema, ≥95% indexable, <1% errors) → 100.
- missing-title penalty lowers the score; thin penalty lowers it.
- **absent factors never awarded:** the score never includes crawl-depth or
  broken-link weight (a fixture with graph data absent still maxes at 100 from the
  included factors).
- partially-noindex (e.g. half indexable) → a real number, dragged down by the
  indexability factor (not null).
- indexability uses `observed` denominator (errors don't double-count).

**Builder** (`broken-link-verify.test.ts`):
- score persisted on `CrawlRun.score` (non-null) for an indexable seeded run.
- **`pagesComplete > HarvestedPageSeo rows`** (simulate a harvest failure): coverage
  uses the actual row count, not `pagesComplete`.
- schema coverage affects the score (seed rows with/without `schemaCount`) — proves
  it's computed before transient deletion.
- fully-noindex seeded run → `CrawlRun.score` is null.

**Surface** (component test): score scorecard renders; null → "not enough
coverage"; coverage line shows the counts.

`npx tsc --noEmit` + full suite + `npm run build` pass.

---

## 9. Acceptance criteria

1. A completed indexable site audit's live-scan `CrawlRun.score` is a 0–100 number
   computed from on-page signals (no crawl-depth/broken-link contribution).
2. A fully-noindex or fully-login-walled audit (or one with <50% observed) yields
   `CrawlRun.score = null`; a partially-noindex audit yields a real (lower) score.
3. The scorer never awards points for absent factors (unit-tested); schema coverage
   is computed before the transient rows are deleted.
4. Coverage uses the actual `HarvestedPageSeo` row count, not `pagesComplete`.
5. The results page shows the score (or "not enough coverage") + a coverage line;
   no other surface changes; the sf-upload score is never displaced.
6. `tsc --noEmit` + full suite + `npm run build` pass.

---

## 10. Decisions resolved (Codex turns 68–69)

- Coverage from existing scalars (no runner surgery) — **A**.
- Factor set mirrors SF minus crawl-depth and broken links — **A**.
- `observed = HarvestedPageSeo row count`, NOT `pagesComplete` (best-effort persist
  after the counter bump).
- `indexableScored === 0 → null` (unifies noindex + login-wall + the all-noindex
  "cap"); login walls now yield `null` via this rule (consistent with a noindex
  site), a documented change from the old spec's separate login guard.
- Indexability denominator = `observed` (errors not double-penalized).
- Score → `CrawlRun.score` only; coverage recomputed at read time; no migration.

## 11. Open (decide in the plan, low-risk)

- Exact read-time page-count shape (two filtered `_count`s vs a `pages` select) —
  pick the cheaper Prisma form during implementation.
- Whether the score scorecard reuses an existing component (e.g. `AuditScorecard`)
  or a small inline element — confirm against what `OnPageSeoSection` already imports.
