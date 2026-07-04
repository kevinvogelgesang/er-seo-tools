// Pure ADA Scoring v2. v1 (scoring.ts) is frozen and untouched.
// Model: per-page saturating penalty over severity-weighted violation DENSITY.
//   density = (Σ impactWeight·min(rawNodeCount,NODE_CAP)·advisory + incomplete·W) / max(domElementCount, DOM_FLOOR)
//   score   = round( 100 / (1 + K·density) )    ∈ (0,100], monotonic, no cliff
// Site score = rounded unweighted mean of per-page scores.
//
// Calibration: K=14 (raised from the brief's starting value of 12). Basis —
// the golden `calibration bands` describe() below locks two representative
// inputs (dom=1500): a "few serious issues" page (serious×8 + moderate×4 +
// incomplete×2) must land in the 55-80 mid band, and a "badly broken" page
// (critical×120 + serious×90 + incomplete×10) must land in the 5-40 low
// band without being pinned to 0. At K=12 both bands already held (mid
// ≈67, low ≈7), but the Step-1 "applies a visible incomplete penalty even
// on a large DOM" assertion failed: 6 incomplete items over an 8000-element
// DOM produce a density of 0.000375, and 100/(1+12·0.000375) rounds back
// up to 100 — indistinguishable from a clean page. K=14 pushes that case to
// 99 (visibly less than the clean page's 100) while keeping the mid band
// at ≈64 and the low band at ≈6 — both still inside their required ranges
// — and leaves every other Step-1 assertion (monotonicity, size-invariance,
// node-cap truncation, advisory discount, null-impact handling, DOM floor,
// compliance) unaffected, since those are proportional/ordering checks
// rather than exact-value checks.
import type { AxeViolation, ImpactLevel } from './types'

export const ADA_SCORE_VERSION = 2 as const

export const IMPACT_WEIGHT: Record<Exclude<ImpactLevel, null> | 'null', number> = {
  critical: 10, serious: 6, moderate: 3, minor: 1, null: 1,
}
export const NODE_CAP = 200
export const DOM_FLOOR = 50
export const INCOMPLETE_WEIGHT = 0.5
export const ADVISORY_DISCOUNT = 0.4
export const K = 14 // calibration constant — see header comment above

export interface ScoreV2Input {
  violations: AxeViolation[]
  incompleteCount: number
  domElementCount: number | null | undefined
  wcagLevel: string
}
export interface AdaScoreFactors {
  weightedFailNodes: number
  incompletePenalty: number
  domElementCount: number
  density: number
  k: number
  pagesScored?: number
}
export interface AdaScoreV2Breakdown {
  version: typeof ADA_SCORE_VERSION
  scorer: 'ada-v2'
  score: number | null
  factors: AdaScoreFactors
}
export interface ScoreV2Result { score: number; compliant: boolean; breakdown: AdaScoreV2Breakdown }

// `impact` is nullable in the current AxeViolation type — accept null.
function impactWeight(impact: ImpactLevel | null): number {
  return impact ? IMPACT_WEIGHT[impact] : IMPACT_WEIGHT.null
}

function hasWcagConformanceTag(tags: string[]): boolean {
  return tags.some((t) => /^wcag\d/.test(t))
}

/** Advisory = best-practice tag present AND no WCAG-conformance tag. */
export function isAdvisory(tags: string[]): boolean {
  return tags.includes('best-practice') && !hasWcagConformanceTag(tags)
}

/** Compliant = no violation carries a WCAG-conformance tag. Best-practice-only
 *  (advisory) violations do NOT break compliance. */
export function computeComplianceV2(violations: AxeViolation[]): boolean {
  return !violations.some((v) => hasWcagConformanceTag(v.tags ?? []))
}

export function computeScoreV2(input: ScoreV2Input): ScoreV2Result {
  let weightedFailNodes = 0
  for (const v of input.violations) {
    const raw = v.nodeCount ?? v.nodes.length
    const capped = Math.min(raw, NODE_CAP)
    const advisory = isAdvisory(v.tags ?? []) ? ADVISORY_DISCOUNT : 1
    weightedFailNodes += impactWeight(v.impact) * capped * advisory
  }
  const incompletePenalty = input.incompleteCount * INCOMPLETE_WEIGHT
  const dom = Math.max(input.domElementCount ?? DOM_FLOOR, DOM_FLOOR)
  const density = (weightedFailNodes + incompletePenalty) / dom
  const score = Math.round(100 / (1 + K * density))
  return {
    score,
    compliant: computeComplianceV2(input.violations),
    breakdown: {
      version: ADA_SCORE_VERSION, scorer: 'ada-v2', score,
      factors: { weightedFailNodes, incompletePenalty, domElementCount: dom, density, k: K },
    },
  }
}

/** Site score = rounded unweighted mean of per-page scores; null if none. */
export function computeSiteScoreV2(pageScores: number[]): number | null {
  if (pageScores.length === 0) return null
  return Math.round(pageScores.reduce((a, b) => a + b, 0) / pageScores.length)
}

export function serializeAdaBreakdown(b: AdaScoreV2Breakdown): string {
  return JSON.stringify(b)
}
