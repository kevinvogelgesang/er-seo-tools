// lib/scoring/seo-recompute.ts — pure, client-safe (C19 PR3). Score Lab what-if:
// recompute a run's SEO score from its persisted v2 inputsSnapshot under
// arbitrary weights. Live snapshots delegate to the real adapter (scoreLiveSeo
// is pure and client-safe — the snapshot IS its input shape, so availability
// rules and null gates are literally the same code). SF snapshots get a local
// mirror of computeHealthScore's availability rules (that adapter takes the
// whole blob, which the Lab never loads).
//
// SF availability (Codex #3): post-PR3 snapshots carry indexableKnown/
// errorsKnown, making the availability mirror exact. Pre-PR3 v2 snapshots
// stored indexableUrls/clientErrors/serverErrors with a `?? 0` fallback and no
// booleans — for those, `?? true` retains the documented lossy assumption
// (treated as available whenever totalUrls > 0; SF crawl summaries in practice
// always carry these fields).
import type { ScoreBreakdownFactor, ScoreResult, ScoringWeights } from './weights'
import { WEIGHT_LABELS } from './weights'
import {
  indexabilityPoints, errorRatePoints, missingElementPoints, crawlDepthPoints,
  thinContentPoints, schemaPoints,
  type SeoInputsSnapshot, type SfInputsSnapshot,
} from './seo-core'
import { scoreLiveSeo } from '@/lib/findings/live-seo-score'

export function recomputeSeoScore(snapshot: SeoInputsSnapshot, weights: ScoringWeights): ScoreResult {
  if (snapshot.source === 'live') {
    const { score, factors } = scoreLiveSeo({
      attempted: snapshot.attempted, observed: snapshot.observed,
      indexableScored: snapshot.indexableScored, pagesError: snapshot.pagesError,
      missingTitle: snapshot.missingTitle, missingMeta: snapshot.missingMeta,
      missingH1: snapshot.missingH1, thin: snapshot.thin,
      pagesWithSchema: snapshot.pagesWithSchema, linkVerification: snapshot.linkVerification,
    }, weights)
    return { score, factors }
  }
  return recomputeSfScore(snapshot, weights)
}

function recomputeSfScore(s: SfInputsSnapshot, weights: ScoringWeights): ScoreResult {
  let earned = 0
  let possible = 0
  const factors: ScoreBreakdownFactor[] = []
  const addFactor = (key: keyof ScoringWeights, pts: number): void => {
    const weight = weights[key]
    const e = Math.min(weight, Math.max(0, pts))
    earned += e
    possible += weight
    factors.push({ key, label: WEIGHT_LABELS[key], weight, earned: e, possible: weight })
  }

  if (s.totalUrls > 0 && (s.indexableKnown ?? true) && weights.indexability > 0) {
    addFactor('indexability', indexabilityPoints(s.indexableUrls / s.totalUrls, weights.indexability))
  }
  if (s.totalUrls > 0 && (s.errorsKnown ?? true) && weights.errorRate > 0) {
    addFactor('errorRate', errorRatePoints((s.clientErrors + s.serverErrors) / s.totalUrls, weights.errorRate))
  }
  if (s.base > 0) {
    if (weights.missingTitle > 0) addFactor('missingTitle', missingElementPoints(s.missingTitle / s.base, weights.missingTitle))
    if (weights.missingMeta > 0) addFactor('missingMeta', missingElementPoints(s.missingMeta / s.base, weights.missingMeta))
    if (weights.missingH1 > 0) addFactor('missingH1', missingElementPoints(s.missingH1 / s.base, weights.missingH1))
  }
  if (s.avgCrawlDepth !== null && weights.crawlDepth > 0) {
    addFactor('crawlDepth', crawlDepthPoints(s.avgCrawlDepth, weights.crawlDepth))
  }
  if (s.thinCount !== null && s.indexableUrls > 0 && weights.thinContent > 0) {
    addFactor('thinContent', thinContentPoints(s.thinCount / s.indexableUrls, weights.thinContent))
  }
  if (s.pagesWithSchema !== null && s.totalUrls > 0 && weights.schema > 0) {
    addFactor('schema', schemaPoints(s.pagesWithSchema / s.totalUrls, weights.schema))
  }
  // brokenLinks: never available for SF runs — no verification pass exists there.

  const score = possible === 0 ? 0 : Math.min(100, Math.max(0, Math.round((earned / possible) * 100)))
  return { score, factors }
}
