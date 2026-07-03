// lib/findings/live-seo-score.ts
//
// C6 Phase 3: forked, coverage-aware live SEO health score (0–100 | null).
// Forked from computeHealthScore (lib/services/scoring.service.ts) with EXPLICIT
// factor availability — it must NOT (a) award full crawl-depth points for a
// missing/zero depth, or (b) skip thin content when no thin issue object exists.
// The live audit has no crawl graph, so crawl-depth and broken-link factors are
// never part of the denominator. Pure: all inputs are passed in by the builder.
//
// C8: threads the operator-configurable ScoringWeights profile (see
// lib/scoring/weights.ts) and returns a ScoreResult (score + per-factor
// breakdown) instead of a bare number, mirroring computeHealthScore's shape.

import type { ScoreBreakdownFactor, ScoreResult, ScoringWeights } from '@/lib/scoring/weights'
import { WEIGHT_LABELS } from '@/lib/scoring/weights'

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
}

const MIN_OBSERVED_COVERAGE = 0.5

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function scoreLiveSeo(inp: LiveScoreInputs, weights: ScoringWeights): ScoreResult {
  // Null-guard: not enough to produce an honest number.
  if (inp.attempted <= 0) return { score: null, factors: [] }
  if (inp.observed / inp.attempted < MIN_OBSERVED_COVERAGE) return { score: null, factors: [] }
  if (inp.indexableScored <= 0) return { score: null, factors: [] } // no indexable content → unscoreable

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
    const ratio = inp.indexableScored / observed
    const pts = ratio >= 0.95 ? weights.indexability : (ratio / 0.95) * weights.indexability
    addFactor('indexability', pts)
  }
  // Error rate — full if < 1%, linear to 0 at 100%.
  if (weights.errorRate > 0) {
    const errorRate = inp.pagesError / inp.attempted
    const pts = errorRate < 0.01 ? weights.errorRate : Math.max(0, weights.errorRate - errorRate * weights.errorRate)
    addFactor('errorRate', pts)
  }
  // Missing title / meta / H1 — over the indexable base.
  const missing = (key: keyof ScoringWeights, count: number): void => {
    const weight = weights[key]
    if (weight <= 0) return
    const pts = weight * (1 - Math.min(1, count / base))
    addFactor(key, pts)
  }
  missing('missingTitle', inp.missingTitle)
  missing('missingMeta', inp.missingMeta)
  missing('missingH1', inp.missingH1)
  // Thin content — full if < 5%, 0 if > 40%, linear between.
  if (weights.thinContent > 0) {
    const ratio = inp.thin / base
    const pts = ratio < 0.05 ? weights.thinContent : ratio > 0.4 ? 0 : weights.thinContent * (1 - (ratio - 0.05) / 0.35)
    addFactor('thinContent', pts)
  }
  // Schema coverage — full at >= 30% of observed.
  if (weights.schema > 0) {
    const ratio = inp.pagesWithSchema / observed
    const pts = ratio >= 0.3 ? weights.schema : (ratio / 0.3) * weights.schema
    addFactor('schema', pts)
  }
  // NOTE: crawlDepth is intentionally NEVER included — live SEO has no crawl graph.

  if (possible === 0) return { score: null, factors }
  return { score: clamp(Math.round((earned / possible) * 100), 0, 100), factors }
}
