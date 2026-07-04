# ADA Scoring v2 — Design Spec

**Date:** 2026-07-04 · **Roadmap item:** C9-A (ADA roadmap §5, first of two — the
frontend consolidation half is deferred to a follow-up C9-B) · **Status:** spec

---

## 1. Problem

The ADA audit score (`lib/ada-audit/scoring.ts`) is blunt and, in one case,
perverse:

```ts
// computeScore(violations, wcagLevel)
totalPenalty = crit×4 + serious×3 + moderate×2 + minor×1        // per-RULE counts
divisor      = log10(max(10, Σ violating-node counts))
score        = max(0, round(100 − totalPenalty / divisor))
```

Concrete defects (all in `02-ada-audit.md` §"Score formula is blunt", verified
against the code 2026-07-04):

1. **No page-size normalization the right way.** The divisor is `log10(sum of
   failing-node counts)`, so a rule that fails on 500 nodes is penalized *less
   per node* than one failing on 5 — more breakage divides the penalty by a
   bigger number. `domElementCount` (the real DOM size, captured in the blob) is
   never used. `computeScoreFromCounts` is blunter still: it divides by the
   *number of violations*.
2. **WCAG level is ignored.** Both functions take `wcagLevel` and both bind it
   to `_wcagLevel` (unused). A `wcag22aa` ("Aspirational") audit runs
   `best-practice` + `wcag22aa` rules on top of the conformance set; those
   best-practice findings are *advisory*, not conformance failures, yet they
   penalize identically — so choosing the stricter level mechanically lowers the
   score for non-conformance reasons.
3. **Passes / incomplete are invisible to the score.** `StoredAxeResults`
   carries `passes[]` (rule-level; nodes empty because the runner sets
   `resultTypes: ['violations','incomplete']`) and `incomplete[]` (full nodes).
   `AuditScorecard` already surfaces `passed`/`incomplete` counts, but neither
   informs the number.

### Why now / why this shape

- The roadmap (`02-ada-audit.md` §"Phase 5") scopes exactly this: "rule-level
  weights, WCAG-level-aware, pass/incomplete visibility, page-type normalization
  instead of raw `log10(elements)`. Keep v1 alongside for continuity; label
  which formula produced each historical score."
- Brainstorm decision (2026-07-04, Kevin): **do not** build a curated per-axe-rule
  weight table (§"Formula scope" → "Fix the 3 real defects"). axe already maps
  every rule to an impact; a bespoke ~90-rule table is high-maintenance,
  low-ROI, and needs SME curation. v2 keeps **impact-level** weights and fixes
  the three defects above.

## 2. Goals / non-goals

**Goals**
- A per-page, size-normalized, WCAG-level-aware score that is monotonic in
  severity and stable across page sizes for the same *proportion* of breakage.
- Pass/incomplete signal folded into the number (incomplete as a light penalty)
  and surfaced next to it.
- **Freeze history as v1** (brainstorm decision, §"Continuity"): no existing
  audit score moves; each score is labeled with the formula version that
  produced it; trend/delta surfaces never silently compare v1 against v2.
- No schema migration if avoidable (reuse `CrawlRun.scoreBreakdown`).

**Non-goals**
- No curated per-rule weight table.
- **No frontend consolidation** (the `useAuditPoller` hook, `SiteAuditForm` /
  `SiteAuditResultsView` splits, memoization) — that is C9-B, a separate cycle.
- No change to what axe runs, to `wcagLevel` tag expansion, or to the
  runner/finalizer/queue mechanics.
- No retroactive recomputation of historical scores.

## 3. The v2 formula

### 3.1 Per-page score (`computeScoreV2`)

Inputs available per page (from `StoredAxeResults`): `violations[]` (each with
`impact`, `tags[]`, `nodes[]`), `incomplete[]`, `domElementCount`, `wcagLevel`.

```
impactWeight:      critical 10 · serious 6 · moderate 3 · minor 1 · (null → minor 1)
advisoryDiscount:  0.4  — applied to a violation whose tags include 'best-practice'
                   but NO wcag-conformance tag (no tag matching /^wcag\d/).
                   (This is the WCAG-level-aware fix; it is level-independent in
                   code — it keys off the violation's own tags, so a best-practice
                   rule is discounted wherever it appears.)

failNodeCount(v)  = v.nodeCount ?? v.nodes.length     // ← RAW count, see §3.4
weightedFailNodes = Σ over violations:
                      impactWeight(v) × min(failNodeCount(v), NODE_CAP) × (advisory(v) ? 0.4 : 1)
incompletePenalty = incomplete.length × INCOMPLETE_WEIGHT   // "needs review", calibrated (§6)
rawPenalty        = weightedFailNodes + incompletePenalty
density           = rawPenalty / max(domElementCount ?? DOM_FLOOR, DOM_FLOOR)
score             = round( 100 / (1 + K × density) )  // ∈ (0,100], monotonic, no hard clamp
compliant         = (no violation carries a wcag-conformance tag)
```

Rationale for the saturating form `100/(1+K·density)`:
- Always in `(0,100]`, strictly decreasing in `density`, smooth — no `max(0, …)`
  cliff, no discontinuity, and a clean 100 at zero density.
- `density` is "severity-weighted fraction of the page that is broken," so two
  pages with the same proportion of the same-severity issues score the same
  regardless of raw size (fixes defect 1).

**Constants** (`K`, `NODE_CAP`, `DOM_FLOOR`, `INCOMPLETE_WEIGHT`) are
**calibrated, not guessed** (see §6). Starting points for calibration:
`NODE_CAP = 200` (see §3.4 — with the raw count preserved, the cap now bounds
runaway single-rule pages *without* flattening 20-vs-200-node differences),
`DOM_FLOOR = 50` (matches the existing "<50 elements ⇒ unreliable SPA"
heuristic), `INCOMPLETE_WEIGHT ≈ 0.5` (calibrated so it stays meaningful after
DOM normalization on large pages — Codex flagged that a flat rule-level 0.5 can
vanish under a large denominator), `K` fit so representative real pages spread
across sensible bands.

### 3.4 Raw failing-node count (Codex fix — density fidelity)

**Problem Codex caught:** the runner truncates every violation's `nodes` to 20
before the blob is stored (`runner.ts:340`), while `domElementCount` is preserved
in full (`runner.ts:313`). If v2 divided *capped* failing nodes by the *full* DOM,
size-invariance would break the moment any single rule exceeds the cap: a rule
failing on 500 nodes and one failing on 20 would look identical, and the same
proportional breakage on a 100-element vs a 5000-element page would score
differently.

**Fix (no migration):** before slicing to 20, persist the raw pre-truncation count
onto each stored violation as `nodeCount: number`. This is a **JSON-blob shape
change**, not a schema change (`AdaAudit.result` / `SiteAudit.summary` are opaque
strings). `AxeViolation` in `lib/ada-audit/types.ts` gains an optional
`nodeCount?: number`. v2 reads `failNodeCount(v) = v.nodeCount ?? v.nodes.length`:
new runs use the true count; pre-v2 blobs (no `nodeCount`) fall back to the capped
length — and those are v1-era anyway, so the freeze (§4) is unaffected. The
`NODE_CAP` then bounds pathological single-rule pages *deliberately* rather than
as a storage artifact.

### 3.2 Site score (`computeSiteScoreV2`)

**Site score v2 = mean of per-page v2 scores** over the pages that were
successfully audited (a page's v2 score is computed from its own axe blob and its
own `domElementCount`). This is inherently page-size-fair and needs no aggregate
divisor. Computed in `ada-mapper` where per-page blobs are in hand.

- Pages with no blob / errored are excluded from the mean (not scored 0).
- Empty audit (zero scored pages) → `score = null` (consistent with existing
  null-score handling).
- Weighting: **unweighted mean** in v1-of-v2 (simple, explainable). A
  DOM-weighted mean is a documented future option, not built now.
- **Known dilution** (Codex): a mean lets many clean pages hide a few badly
  broken key pages. Acceptable for MVP *because* the results view keeps per-page
  worst-offender lists and the by-issue view visible — the score is a headline,
  not the whole story. A percentile / min-page modifier is a documented future
  option if the score ever becomes SLA-like.

### 3.3 v1 stays exactly as-is

`computeScore` / `computeScoreFromCounts` are **not modified**. They remain the
frozen v1 implementation and the read-time fallback for pre-v2 / pruned data.

## 4. Versioning & continuity

### 4.1 The version label

Reuse the existing `CrawlRun.scoreBreakdown` JSON column (today: `{version,
scorer, score, factors[]}`, written for `sf-upload` + `live-scan` SEO runs;
ADA runs currently write plain `score` with a null breakdown).

- **New ADA runs** (site + standalone, written via `ada-mapper` → the findings
  dual-write) write `scoreBreakdown = {version: 2, scorer: 'ada-v2', score,
  factors: [...]}`. `factors` records the inputs for explainability
  (weightedFailNodes, incompletePenalty, domElementCount, density, K, and — for
  a site run — the per-page score list length / mean).
- **Runs with null `scoreBreakdown` (or version ≠ 2) = v1** by definition. No
  backfill.

**TypeScript type change (Codex — no DB migration, but not free):** the
`PersistedBreakdown` / `ScoreExplanation` types in `lib/scoring/weights.ts`
currently permit only `version: 1` and `scorer: 'health' | 'live-seo'`. They must
be widened to admit the ADA v2 shape (`version: 2`, `scorer: 'ada-v2'`) — either
by extending the union or by giving ADA a distinct discriminated breakdown type.
The plan picks one; a distinct ADA type is cleaner if the `factors[]` shape
diverges from SEO's. Existing SEO readers (`lib/services/pillarAnalysis/*`,
seo-parser results pages) only ever receive SEO-origin runs, so widening the type
does not change their behavior — confirm in the plan that none of them
`JSON.parse` a breakdown from an ADA-origin run.

### 4.2 The invariant that makes freezing (almost) automatic

> **v2 is only ever produced where per-page node + DOM data is present** — i.e.
> at write time (`ada-mapper`, which reads per-page blobs) or from an unpruned
> blob. Every **count-based read-time fallback stays v1** (`computeScoreFromCounts`
> over `summary.aggregate`), and that fallback is normally only reachable for
> pre-persisted / pruned audits, which are v1-era anyway.

So "freeze history as v1" mostly falls out of the data model rather than needing
a cutover timestamp: old audits either have a persisted v1 score (read it) or
only count-data survives (recompute v1). New audits persist a labeled v2 score.

**The one non-automatic edge (Codex):** if a v2-era audit's findings dual-write
*fails* but its origin blob is still present, a fallback recompute
(`recents-query.ts:77`, `crawlRun?.score ?? computeScore(...)`) would produce a
v1 number for a v2-era audit. This is an acceptable *error* fallback, not the
normal path — but the spec does **not** claim it's impossible. Treatment: label
any recompute-fallback score as **"v1 / breakdown unavailable"** (not silently v2),
and rely on the existing `[findings] dual-write failed` log + `findings-rebuild.ts`
remediation to close the gap. Freezing is a property of *labeling every score by
the version that actually produced it*, not of asserting v2 can never be missed.

### 4.3 Read-surface changes (the ~10 call sites)

Current callers of `computeScore` / `computeScoreFromCounts` (verified
2026-07-04): `lib/findings/ada-mapper.ts`, `lib/report/report-data.ts`,
`lib/ada-audit/recents-query.ts`, `app/api/clients/audit-summary/route.ts`,
`app/api/site-audit/route.ts`, `app/api/audit-batches/[id]/route.ts`,
`app/api/ada-audit/route.ts`, `app/ada-audit/[id]/page.tsx`,
`app/ada-audit/site/[id]/page.tsx`, `app/ada-audit/site/share/[token]/page.tsx`,
`app/ada-audit/share/[token]/page.tsx`.

Two behaviors exist today and must be reconciled:

- **Fallback-only callers** (route handlers, `audit-summary`): already do
  `if (score === null) score = computeScoreFromCounts(...)`. These **prefer the
  persisted `CrawlRun.score`** and only fall back — leave the fallback as v1.
  No behavior change except: when a persisted score is shown, also read its
  `scoreBreakdown.version` for labeling.
- **Always-recompute callers** (`app/ada-audit/[id]/page.tsx:176`,
  `app/ada-audit/share/[token]/page.tsx:82`, the site pages): today they
  recompute from the blob on every view. Change them to **prefer the persisted
  score + version** and recompute **only** when no persisted score exists — and
  the recompute path is v1. This is the one real behavior change: a fresh v2
  audit's detail page shows the persisted v2 number instead of a live v1
  recompute.

`ada-mapper` (the write path) switches from `computeScore` / `computeScoreFromCounts`
to the v2 functions and writes the breakdown.

### 4.4 Trend / delta surfaces

C2 card delta (`client-schedules.ts` reads `CrawlRun.score`), C3 diffing, the
B1/B2 dashboard series, and the C4 PDF trend must not compare a v1 point to a v2
point:

- Read `scoreBreakdown.version` (default 1) alongside each score point.
- When two adjacent points differ in version, render a **formula-change marker**
  on the trend and **suppress the numeric delta** across that boundary (show
  "formula changed" instead of a `+N/−M`).
- Within a single version, behavior is unchanged.

**Concrete surfaces to widen (Codex — the shared point type carries no version
today, so the plan must touch each):**
- `lib/services/scorecard-shared.ts` `buildSeries` (`:23`) — the shared trend-point
  type gains a `scoreVersion`; delta computation becomes version-aware. This is
  the highest-leverage change (dashboard + fleet series flow through it).
- `lib/services/client-schedules.ts` `lastDelta` (`:93`) — computed directly from
  raw scores; must consult version before emitting a delta.
- `lib/report/report-data.ts` trend select (`:195`) — currently selects only
  `score`/`date`; add `scoreBreakdown` so the PDF trend can mark the boundary.
- Client dashboard / fleet queries that `select` only `score` — add breakdown.
- Verify **C3 instance-diffing** (`site-audit-diff.ts` / `findings-shared.ts`) is
  keyed on findings, not the numeric score, so it is version-agnostic (expected —
  confirm in the plan).

## 5. Surfacing (minimal, no new pages)

- A small **"v2"** badge / tooltip beside the score on the audit detail + site
  results views, one-line explanation ("size-normalized, WCAG-aware; passes &
  needs-review shown"). v1-labeled scores get no badge (or a subtle "v1").
- Pass / incomplete counts rendered adjacent to the score (data already in
  `AuditScorecard`; this is a placement change, not new data).
- Dark-mode `dark:` variants on every new element; no hydration-mismatch
  patterns.
- Share views: same labeling, read-only, no new fetches.

## 6. Calibration (a build step, not a guess)

Constants `K`, `NODE_CAP`, `DOM_FLOOR`, `INCOMPLETE_WEIGHT` are fit against
**real data we already have**:

- The reusable Manhattan SF crawl
  (`/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25`,
  existing client) for page-shape realism, and a handful of real completed ADA
  audits already in the dev/prod DB (read-only) for violation realism.
- **Never scan a non-client site to calibrate** (change-control rule 3).
- Target: representative clean pages ≈ 90–100; a page with a few serious issues
  lands mid-band (≈ 55–75); a badly broken page lands low but rarely pins to 0.
- The chosen constants are frozen as named exports in `scoring.ts` with a
  comment recording the calibration basis. A golden test locks a few
  fixture-page → score pairs so future edits can't silently drift the scale.

## 7. Testing

**Pure unit (node env), `lib/ada-audit/scoring.v2.test.ts`:**
- Monotonicity: adding/worsening a violation never raises the score.
- **Size-invariance:** same proportion of same-severity breakage on a 100-element
  and a 5000-element page → equal (±1 rounding) score.
- **Raw-count fidelity (Codex):** a rule with 20 failing nodes vs the same rule
  with 200 failing nodes on the *same* DOM size → distinct scores (proves v2 reads
  `nodeCount`, not the truncated `nodes.length`); a pre-v2 violation with no
  `nodeCount` falls back to `nodes.length` without throwing.
- Best-practice discount: a best-practice-only violation penalizes ~0.4× an
  identical conformance violation.
- Incomplete penalty: N incompletes lower the score; 0 incompletes = no penalty;
  the penalty stays visible (>0 score delta) on a large-DOM page (guards Codex's
  "invisible after normalization" concern).
- Boundaries: zero violations → 100; null `impact` treated as minor; missing
  `domElementCount` → `DOM_FLOOR`.
- Golden calibration pairs (fixtures → expected band).

**Site score:** mean-of-pages; errored/blobless pages excluded; empty → null.

**Versioning / continuity (DB-backed where a run row is needed):**
- New ADA run writes `scoreBreakdown.version === 2`.
- Always-recompute pages prefer persisted score; recompute fallback is v1.
- **Parity guard:** a pre-existing persisted score is byte-unchanged after the
  change (v1 rows untouched).
- **Mixed-version trend tests (Codex):** for each widened surface —
  `buildSeries`, `client-schedules` `lastDelta`, dashboard/fleet series, and the
  C4 report trend — a v1→v2 boundary yields a marker and a suppressed delta, and
  a same-version pair still yields a numeric delta.
- Dual-write-failure fallback labels the recompute as "v1 / breakdown
  unavailable", not v2.

Gate: `npm run lint` · `npm test` · `npm run build`, all green.

## 8. Rollout & prod verification

- **No schema migration expected** — `scoreBreakdown` JSON exists; `AdaAudit.score`
  / `SiteAudit.score` columns exist; the version lives in free-form JSON, and the
  new per-violation `nodeCount` (§3.4) is a **JSON-blob shape change**, not a
  column. Confirm during planning; if a column *is* wanted, follow the
  schema-change procedure. Deploy is then plain `~/deploy.sh` (code-only).
- **`nodeCount` is only populated on runs made after deploy** — the calibration +
  size-invariance guarantees apply to new audits; pre-deploy blobs keep the
  truncated fallback (and are v1-scored anyway).
- Prod verification: run one real **client** audit (or use the weekly canary,
  client 31), confirm its `CrawlRun.scoreBreakdown.version === 2` and the detail
  view shows the v2 badge; confirm an older audit still shows its v1 number and a
  trend spanning the boundary renders the formula-change marker, not a bogus
  delta.

## 9. Risks

- **Scale feels wrong to analysts.** Mitigated by calibration against real data +
  golden test; `K` is a single tunable.
- **A surface still recomputes v1 where a v2 persisted score exists** (mixed
  display). Mitigated by auditing all ~10 call sites in one pass + the
  "prefer-persisted" rule + tests.
- **`scoreBreakdown` consumers assume SEO-only shape.** Check existing readers
  (`lib/services/pillarAnalysis/*`, seo-parser results pages) tolerate an ADA
  breakdown or are never handed one (ADA runs are `tool` / `source` distinct).
  Verify during planning.

## 10. Open items for the plan

1. Confirm no migration (grep every `scoreBreakdown` reader for shape
   assumptions; confirm `PersistedBreakdown`/`ScoreExplanation` widening in
   `lib/scoring/weights.ts` is the full type surface).
2. Exact `factors[]` shape for ADA breakdown (align with SEO's for reuse, or a
   distinct discriminated shape — §4.1).
3. Whether standalone `AdaAudit.score` should be persisted at completion (it is
   nullable and sometimes recomputed) or left to the CrawlRun as source of truth.
4. Final calibration constants (`K`, `NODE_CAP`, `DOM_FLOOR`, `INCOMPLETE_WEIGHT`)
   + the golden fixtures.
5. Where exactly the raw `nodeCount` is captured before truncation
   (`runner.ts:~340`) and that every writer of `AxeViolation` (runner + any
   fallback/archive path) sets or tolerates it.
6. Confirm C3 instance-diffing is score-agnostic (keyed on findings), so no
   version handling is needed there.
