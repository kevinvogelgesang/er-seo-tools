# C19 — ADA + SEO Scoring System Overhaul (design)

**Date:** 2026-07-09 · **Owner:** Kevin (commissioned mid-C13 session; approach + all five design sections approved in-session)
**Status:** approved design → Codex review → plan

## Motivation

Kevin (2026-07-09): *"a much larger and aggressive pass on the logic (ADA and SEO), as well as the explanation features and the levers for adjusting the weights — I don't fully understand how weighting works."* Concrete smell: sites that visibly need work still score ~98 ("no examples, but that's the vibe"). Surface unknown ("honestly not sure") → all formulas treated with equal suspicion.

Known softeners found during C13:
- ADA v2/v3 density model: big DOMs dilute (violations ÷ domElementCount), the site score is an unweighted mean (400 clean-ish pages bury 30 broken ones), and the incomplete penalty **never fired before 2026-07-09** (axe `no-passes` reporter stripped the input — fixed in PR #141, version bumped to v3).
- Live SEO score: documented +9..+27 generous vs SF (2026-07-06 parity run: manhattan 99, cambria 100) because broken links and crawl depth are never in its denominator.
- SEO factor curves are forgiving (missing-title at 10% of pages costs only 10% of that factor's points).

**Calibration anchor (Kevin):** school-grade 70s–80s for "most pages have a few visible problems, nothing catastrophic" (today ~95+). 90+ reserved for genuinely clean sites.

**Audience:** internal-first. Share views and the C14 sales report keep score-only (explanations there = later increment).

## Goals

1. **Trust:** both scoring systems recalibrated to the school-grade anchor, with executable evidence (golden archetype tests + a prod replay report) — not vibes.
2. **Explainability:** every authed score answers "why is it X, what moved it" from a persisted breakdown. For ADA, the formula *is* the explanation (deduction invoice).
3. **Levers:** ADA gets real weights (it has none today — all constants hardcoded); SEO's existing levers gain a what-if sandbox so Kevin learns the model by playing with it.

## Non-goals

- Pillar-fit scoring, GA4/GSC report metrics — untouched.
- Client-facing explanations (share/sales surfaces) — later increment.
- Per-client weight profiles — rejected in brainstorm (breaks cross-client comparison).
- Node-volume intensity multiplier inside ADA rules (page-prevalence is binary per rule in v4) — `// FUTURE`, keeps v1 of the model explainable.
- Recomputing/backfilling historical scores — never. Old points keep their stamped version/weights.
- Compliance logic and WCAG-level tag expansion — unchanged (v2 conformance semantics carry into v4).

## Part 1 — ADA v4: prevalence-weighted deductions

**Replaces** the v2/v3 saturating-density formula (`lib/ada-audit/scoring-v2.ts` stays frozen for history, like `scoring.ts` v1).

```
siteScore = round(max(0, 100 − Σ_c deduction_c))

deduction_c = cap_c × min(1, (Σ_{rules r in c} prevalence_r × advisory_r) / saturation_c)

prevalence_r = pagesAffected_r / pagesAudited          (0..1]
advisory_r   = advisoryDiscount if best-practice-only tags, else 1
               (existing isAdvisory predicate; advisoryDiscount is a LEVER, default 0.4)
```

| Category c | cap (LEVER, default) | saturation (fixed) |
|---|---|---|
| critical | 40 | 1.0 |
| serious | 30 | 2.0 |
| moderate | 15 | 3.0 |
| minor | 5 | 4.0 |
| needsReview | 10 | 4.0 (mean incomplete rules/page) |

- needsReview contribution = `mean(incompleteCount over complete pages) / 4`, capped at 1. Real incomplete data accrues only post-C13 (2026-07-09) — older inputs legitimately contribute 0.
- **Page score** = same model with per-page inputs (rule present → prevalence 1). Consistent drill-down; standalone single-page audits are the one-page case.
- `domElementCount` **drops out of scoring** (prevalence normalizes). The <50-DOM "unreliable result" warning stays display-only.
- Anchor check: critical on 30% + serious on 60% + moderate on 50% → 100 − (40×0.30 + 30×0.30 + 15×0.167) ≈ **76**. Clean site = 100. Everything saturated = 0.
- Version: **ADA_SCORE_VERSION → 4**. Badge renders v4; `buildSeries` suppression already version-generic.
- Null-score rules unchanged: no complete pages → null; malformed blob → page unscored (never a fake 100).

**Purity + placement:** new `lib/scoring/ada-v4.ts` — pure, client-safe (Score Lab reuses it in-browser). Signature `computeAdaScoreV4(inputs: AdaV4Inputs, weights: AdaScoringWeights): { score, breakdown }`. Two input builders, one scorer:
- scan path: `ada-mapper.ts` builds `AdaV4Inputs` from the parsed child blobs it already holds (per-rule pages-affected via its existing per-page violation walk; weights resolved server-side once per run);
- Lab path: a server loader builds the same shape from **findings tables** (`Finding` page-scope rows per rule + `Violation.impact/wcagTags` + `CrawlPage` counts) — works on 90-d-archived audits (relational rows survive pruning).

## Part 2 — SEO recalibration (model kept)

1. **Curves steepened** to the anchor in `computeHealthScore` (shared by `scoreLiveSeo`): missing-title/meta/H1 → full points only ≤2% missing, 0 points ≥30% (linear between); indexability full ≥98% (was 95%); error-rate 0 points at ≥20% (was linear to 100%); thin-content knee 5%→40% window narrowed to 5%→25%. Exact knees are pinned by the golden archetype tests, not these prose numbers — the tests are the contract.
2. **Live score gains a broken-links factor**: new `brokenLinks` weight key (default 10, live-eligible; the data — `broken_internal_links`/`broken_images` run-findings — is already in the same live-scan run). SF-upload health: factor unavailable → existing renormalization (by design). Live coverage/null-score gates (`observed/attempted ≥ 0.5`, indexable>0) unchanged.
3. **SEO version suppression**: `PersistedBreakdown` version → 2; `SeoRunRow` gains `scoreBreakdown`, `buildSeoSeries` threads `scoreVersion` into points (defaulting 1) exactly as the ADA series does. Recalibrated scores never produce false sparkline deltas against v1 points.
4. SF-parity campaign note: the parity log's live-vs-SF comparisons are per-version; cycles 2–3 record the breakdown version alongside scores.

## Part 3 — Breakdown contract + explanation UI (internal-only)

One versioned persisted contract (stored in `CrawlRun.scoreBreakdown`, written at scoring time, read verbatim — never recomputed):
- ADA v4: `{ version: 4, scorer: 'ada-v4', score, weightsHash, deductions: [{ category, cap, points, contributions: [{ ruleId, impact, prevalence, pagesAffected, advisory }] (top N=8 by prevalence, rest rolled into 'other') }], inputsSummary: { pagesAudited, meanIncomplete } }`
- SEO v2: existing factor rows + `weightsHash` + per-factor `detail` (the raw ratio behind the earned points, e.g. `{ missingCount: 12, base: 340 }`).

**ADA explanation panel** (new, internal pages only — site results header in the C18 shell + standalone page): renders the invoice — score, deduction lines ("Serious −10.5 — color-contrast on 164 of 407 pages, …"), expandable contributions. The existing SEO `ScoreExplanation` table stays, restyled to match and enriched with the factor `detail` line. Pre-v4/pre-v2 breakdowns render exactly as today (version-gated).

## Part 4 — Levers + Score Lab

- **Schema:** new `AdaScoringWeights` singleton row (id=1: five caps + `advisoryDiscount`), additive migration; `resolveAdaScoringWeights()` mirroring the C8 pattern; `validateWeights`-style guard (each cap 0..100, at least one > 0).
- **/settings:** ADA weights card beside the existing SEO card (same UX/validation); SEO card gains the `brokenLinks` key.
- **Score Lab** (new internal page, cookie-gated): pick a recent completed audit/run (search over CrawlRuns), server returns the compact scoring-inputs snapshot (`GET /api/scoring/lab-inputs?runId=` — findings-table-sourced, no blobs, archived-safe), sliders recompute score + full breakdown **live in the browser** via the same pure scorers. "Save as global defaults" persists through the settings endpoints. Banner: historical scores keep their stamped weights; only future scans use new ones.
- **Weights-change honesty:** every breakdown stamps `weightsHash` (short sha256 of the canonical weights JSON). `buildSeries` suppresses deltas when version **or** weightsHash differs between adjacent points (extends `formulaChanged`).

## Part 5 — Calibration evidence + rollout

- **Golden archetype suite** (both scorers): clean ≈95+, lightly-flawed 85–92, visibly-flawed 70–80, broken ≤50 — fixtures encode the bands; failing them blocks the merge. These tests are the executable definition of Kevin's anchor.
- **Replay script** `scripts/score-replay.ts` (read-only, `npx tsx`): recomputes proposed v4/v2 scores across all real CrawlRuns and prints before/after distributions (per client, per band). Runbook: run on the server against prod DB read-only *before* the flip PR merges; the distribution table goes into the tracker entry as the "aggressive review" evidence.
- **Rollout:** version boundaries everywhere; no backfill; badges v4/v2; sparkline deltas suppressed across the boundary; `formulaChanged` copy already exists.
- **Packaging (plan pins it):** PR1 ADA v4 scorer + breakdown contract + archetype suite + replay script; PR2 SEO recalibration + series version threading; PR3 levers (schema + cards) + Score Lab + explanation panels. Each PR gate-green + deployed per the standing recipe.

## Edge cases

- seoOnly audits: no ada run → no ADA score (unchanged).
- Redirected/error children: excluded from `pagesAudited` (only complete pages count — matches current mapper semantics).
- Mixed-shape transitional audits (old children without incomplete data): needsReview underweights — acceptable, self-heals on next scan.
- Zero-weight categories: cap 0 → category contributes nothing (lever can disable a category).
- Live in-run page table (`live-children-helpers`) shows transient per-page numbers during a run — display-only, out of scope.
- `computeScoreFromCounts`/v1 paths: legacy read-surfaces only, untouched.

## Risks

- **All client scores drop** at the boundary — intended (anchor), honest (version suppression), but worth a heads-up before client-facing conversations. The replay report quantifies it in advance.
- needsReview category is data-starved until sites re-scan post-C13 — scores will tighten slightly again as that data arrives (within-version input growth, same class as C13; documented, no extra version bump).
- Score Lab requires pure/client-safe scorers — enforced by module placement (`lib/scoring/`, no server imports) + a test asserting no server-only imports.
