// lib/findings/live-seo-score.ts
//
// C6 Phase 3: forked, coverage-aware live SEO health score (0–100 | null).
// Forked from computeHealthScore (lib/services/scoring.service.ts) with EXPLICIT
// factor availability — it must NOT (a) award full crawl-depth points for a
// missing/zero depth, or (b) skip thin content when no thin issue object exists.
// The live audit has no crawl graph, so the crawl-depth factor is never part of
// the denominator. Pure: all inputs are passed in by the builder.
//
// C8: threads the operator-configurable ScoringWeights profile (see
// lib/scoring/weights.ts) and returns a ScoreResult (score + per-factor
// breakdown) instead of a bare number, mirroring computeHealthScore's shape.
//
// C19 PR2 Task 4: curves now delegate to the shared core (lib/scoring/seo-core.ts)
// — this adapter only decides factor AVAILABILITY, deriving the ratios/counts fed
// to those curves (same split as the SF adapter, lib/services/scoring.service.ts).
// Also adds the broken-links factor, available only when the builder supplies a
// complete link-verification pass, and returns a v2 inputsSnapshot for persistence.

import type { ScoreBreakdownFactor, ScoreResult, ScoringWeights } from '@/lib/scoring/weights'
import { WEIGHT_LABELS } from '@/lib/scoring/weights'
import {
  indexabilityPoints, errorRatePoints, missingElementPoints,
  thinContentPoints, schemaPoints, brokenLinksPoints,
  type LinkVerificationSnapshot, type LiveInputsSnapshot,
} from '@/lib/scoring/seo-core'

export interface LiveScoreInputs {
  attempted: number        // SiteAudit.pagesTotal (discovered/attempted)
  observed: number         // HarvestedPageSeo row count (NOT pagesComplete)
  indexableScored: number  // observed rows that are indexable && !loginLike
  pagesError: number       // SiteAudit.pagesError
  missingTitle: number     // over the eligible (indexable && !login) set
  missingMeta: number
  missingH1: number
  thin: number             // 0 < wordCount < 300, over the eligible set
  pagesWithSchema: number  // observed rows with schemaCount > 0
  linkVerification?: LinkVerificationSnapshot | null // C19 PR2: broken-links factor input
}

const MIN_OBSERVED_COVERAGE = 0.5

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function scoreLiveSeo(
  inp: LiveScoreInputs,
  weights: ScoringWeights,
): ScoreResult & { inputsSnapshot: LiveInputsSnapshot } {
  const linkVerification = inp.linkVerification ?? null

  // Null-guard: not enough to produce an honest number.
  if (inp.attempted <= 0) {
    return { score: null, factors: [], inputsSnapshot: emptySnapshot(inp, linkVerification) }
  }
  if (inp.observed / inp.attempted < MIN_OBSERVED_COVERAGE) {
    return { score: null, factors: [], inputsSnapshot: emptySnapshot(inp, linkVerification) }
  }
  if (inp.indexableScored <= 0) {
    return { score: null, factors: [], inputsSnapshot: emptySnapshot(inp, linkVerification) } // no indexable content → unscoreable
  }

  const base = inp.indexableScored
  const observed = inp.observed

  let earned = 0
  let possible = 0
  const factors: ScoreBreakdownFactor[] = []

  const addFactor = (key: keyof ScoringWeights, pts: number): void => {
    const weight = weights[key]
    const e = clamp(pts, 0, weight)
    earned += e
    possible += weight
    factors.push({ key, label: WEIGHT_LABELS[key], weight, earned: e, possible: weight })
  }

  // Indexability ratio — observed HTML pages that are indexable.
  if (weights.indexability > 0) {
    addFactor('indexability', indexabilityPoints(inp.indexableScored / observed, weights.indexability))
  }
  // Error rate.
  if (weights.errorRate > 0) {
    addFactor('errorRate', errorRatePoints(inp.pagesError / inp.attempted, weights.errorRate))
  }
  // Missing title / meta / H1 — over the indexable base.
  const missing = (key: keyof ScoringWeights, count: number): void => {
    const weight = weights[key]
    if (weight <= 0) return
    addFactor(key, missingElementPoints(count / base, weight))
  }
  missing('missingTitle', inp.missingTitle)
  missing('missingMeta', inp.missingMeta)
  missing('missingH1', inp.missingH1)
  // Thin content.
  if (weights.thinContent > 0) {
    addFactor('thinContent', thinContentPoints(inp.thin / base, weights.thinContent))
  }
  // Schema coverage — over observed.
  if (weights.schema > 0) {
    addFactor('schema', schemaPoints(inp.pagesWithSchema / observed, weights.schema))
  }
  // NOTE: crawlDepth is intentionally NEVER included — live SEO has no crawl graph.

  // Broken links — ONLY when the builder supplied a complete verification pass
  // with something actually checked. An incomplete/absent pass must NOT be
  // treated as "zero broken links" (that would be a false-clean signal).
  if (
    weights.brokenLinks > 0 &&
    linkVerification !== null &&
    linkVerification.passComplete === true &&
    (linkVerification.internalChecked + linkVerification.imagesChecked) > 0
  ) {
    const totalChecked = linkVerification.internalChecked + linkVerification.imagesChecked
    const totalBroken = linkVerification.internalBroken + linkVerification.imagesBroken
    addFactor('brokenLinks', brokenLinksPoints(totalBroken / totalChecked, weights.brokenLinks))
  }

  const inputsSnapshot: LiveInputsSnapshot = {
    source: 'live',
    attempted: inp.attempted, observed: inp.observed, indexableScored: inp.indexableScored,
    pagesError: inp.pagesError,
    missingTitle: inp.missingTitle, missingMeta: inp.missingMeta, missingH1: inp.missingH1,
    thin: inp.thin, pagesWithSchema: inp.pagesWithSchema,
    linkVerification,
  }

  if (possible === 0) return { score: null, factors, inputsSnapshot }
  return { score: clamp(Math.round((earned / possible) * 100), 0, 100), factors, inputsSnapshot }
}

function emptySnapshot(inp: LiveScoreInputs, linkVerification: LinkVerificationSnapshot | null): LiveInputsSnapshot {
  return {
    source: 'live',
    attempted: inp.attempted, observed: inp.observed, indexableScored: inp.indexableScored,
    pagesError: inp.pagesError,
    missingTitle: inp.missingTitle, missingMeta: inp.missingMeta, missingH1: inp.missingH1,
    thin: inp.thin, pagesWithSchema: inp.pagesWithSchema,
    linkVerification,
  }
}
