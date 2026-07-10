// lib/scoring/seo-core.ts — pure, client-safe. THE single home of SEO factor
// curves (C19 PR2). Both scorers adapt inputs onto these functions; contract
// tests in the adapter suites prove identical knees. Knee constants are
// exported so tests pin them explicitly.
import type { ScoreBreakdownFactor, ScoreResult } from './weights'

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

function clampPts(pts: number, weight: number): number {
  if (!Number.isFinite(pts)) return 0
  return Math.min(weight, Math.max(0, pts))
}

// Full points at/above `fullAt` (the "good" end), linear down to 0 at 0.
// Used for factors where MORE is better (indexability ratio, schema coverage).
function growthPoints(value: number, fullAt: number, weight: number): number {
  if (value >= fullAt) return clampPts(weight, weight)
  const v = Math.max(0, value)
  return clampPts((v / fullAt) * weight, weight)
}

// Full points at/below `fullAt` (the "good" end), zero at/above `zeroAt`,
// linear between. Used for factors where MORE is worse (error rate, missing
// elements, crawl depth, thin content, broken links).
function decayPoints(value: number, fullAt: number, zeroAt: number, weight: number): number {
  if (value <= fullAt) return clampPts(weight, weight)
  if (value >= zeroAt) return 0
  const frac = (value - fullAt) / (zeroAt - fullAt)
  return clampPts(weight * (1 - frac), weight)
}

export function indexabilityPoints(ratio: number, weight: number): number {
  return growthPoints(ratio, SEO_KNEES.indexabilityFull, weight)
}
export function errorRatePoints(rate: number, weight: number): number {
  return decayPoints(rate, SEO_KNEES.errorRateFull, SEO_KNEES.errorRateZero, weight)
}
export function missingElementPoints(pct: number, weight: number): number {
  return decayPoints(pct, SEO_KNEES.missingElementFull, SEO_KNEES.missingElementZero, weight)
}
export function crawlDepthPoints(depth: number, weight: number): number {
  return decayPoints(depth, SEO_KNEES.crawlDepthFull, SEO_KNEES.crawlDepthZero, weight)
}
export function thinContentPoints(ratio: number, weight: number): number {
  return decayPoints(ratio, SEO_KNEES.thinFull, SEO_KNEES.thinZero, weight)
}
export function schemaPoints(ratio: number, weight: number): number {
  return growthPoints(ratio, SEO_KNEES.schemaFull, weight)
}
export function brokenLinksPoints(ratio: number, weight: number): number {
  return decayPoints(ratio, 0, SEO_KNEES.brokenLinksZero, weight)
}

// ── v2 persisted breakdown (spec Part 3) ─────────────────────────────────
// factors keep the v1 row shape so ScoreExplanation renders v2 unchanged;
// inputsSnapshot carries the raw ratios (Codex spec-fix #5 — the Score Lab's
// SEO data source). Discriminated by source (Codex plan-fix #4) — an SF
// snapshot and a live snapshot carry different raw inputs; each must be able
// to re-score its run.
export interface LinkVerificationSnapshot {
  internalChecked: number; internalBroken: number
  imagesChecked: number; imagesBroken: number
  passComplete: boolean
}
export interface SfInputsSnapshot {
  source: 'sf'
  totalUrls: number; indexableUrls: number; clientErrors: number; serverErrors: number
  base: number; missingTitle: number; missingMeta: number; missingH1: number
  avgCrawlDepth: number | null; thinCount: number | null; pagesWithSchema: number | null
}
export interface LiveInputsSnapshot {
  source: 'live'
  attempted: number; observed: number; indexableScored: number; pagesError: number
  missingTitle: number; missingMeta: number; missingH1: number; thin: number
  pagesWithSchema: number
  linkVerification: LinkVerificationSnapshot | null
}
export type SeoInputsSnapshot = SfInputsSnapshot | LiveInputsSnapshot

export interface PersistedBreakdownV2 {
  version: 2; scorer: 'health' | 'live-seo'; score: number | null
  weightsHash: string; factors: ScoreBreakdownFactor[]; inputsSnapshot: SeoInputsSnapshot
}

export function serializeBreakdownV2(
  scorer: 'health' | 'live-seo', r: ScoreResult, weightsHash: string, inputsSnapshot: SeoInputsSnapshot,
): string {
  const p: PersistedBreakdownV2 = {
    version: 2, scorer, score: r.score, weightsHash, factors: r.factors, inputsSnapshot,
  }
  return JSON.stringify(p)
}
