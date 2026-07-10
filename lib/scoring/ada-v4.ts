// lib/scoring/ada-v4.ts — C19 ADA score v4: prevalence-weighted deductions.
// Pure + client-safe (Score Lab recomputes in-browser). The persisted
// breakdown IS the formula: score = 100 − Σ category deductions, each
// deduction = cap × min(1, Σ rule prevalences / saturation). Replaces the
// v2/v3 density model (lib/ada-audit/scoring-v2.ts, frozen for history).
// Spec: docs/superpowers/specs/2026-07-09-c19-scoring-overhaul-design.md

export type AdaV4Category = 'critical' | 'serious' | 'moderate' | 'minor' | 'needsReview'

export interface AdaV4RuleInput {
  ruleId: string
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | 'unknown'
  advisory: boolean
  pagesAffected: number
}
export interface AdaV4Inputs {
  pagesAudited: number
  pagesTotal: number | null
  meanIncomplete: number
  rules: AdaV4RuleInput[]
}
export interface AdaV4Weights {
  critical: number; serious: number; moderate: number; minor: number
  needsReview: number; advisoryDiscount: number
}
export const DEFAULT_ADA_V4_WEIGHTS: AdaV4Weights = {
  critical: 40, serious: 30, moderate: 15, minor: 5, needsReview: 10, advisoryDiscount: 0.4,
}
export const ADA_V4_SATURATION: Record<AdaV4Category, number> = {
  critical: 1, serious: 2, moderate: 3, minor: 4, needsReview: 4,
}
export const ADA_SCORE_VERSION = 4 as const
const TOP_CONTRIBUTIONS = 8

export interface AdaV4Contribution {
  ruleId: string
  impact: string
  prevalence: number
  weightedPrevalence: number
  pagesAffected: number
  advisory: boolean
  ruleCount?: number
}
export interface AdaV4DeductionLine {
  category: AdaV4Category
  cap: number
  points: number
  contributions: AdaV4Contribution[]
}
export interface AdaV4Breakdown {
  version: 4
  scorer: 'ada-v4'
  score: number | null
  weightsHash: string | null
  lowCoverage: boolean
  deductions: AdaV4DeductionLine[]
  inputsSummary: { pagesAudited: number; pagesTotal: number | null; meanIncomplete: number }
}

const IMPACT_CATEGORY: Record<AdaV4RuleInput['impact'], Exclude<AdaV4Category, 'needsReview'>> = {
  critical: 'critical', serious: 'serious', moderate: 'moderate', minor: 'minor', unknown: 'minor',
}
const round1 = (n: number) => Math.round(n * 10) / 10

export function computeAdaScoreV4(
  inputs: AdaV4Inputs,
  weights: AdaV4Weights = DEFAULT_ADA_V4_WEIGHTS,
): { score: number; breakdown: AdaV4Breakdown } {
  if (inputs.pagesAudited <= 0) {
    throw new Error('computeAdaScoreV4 requires pagesAudited > 0 — keep the run null-scored instead')
  }

  const byCategory = new Map<Exclude<AdaV4Category, 'needsReview'>, AdaV4Contribution[]>([
    ['critical', []], ['serious', []], ['moderate', []], ['minor', []],
  ])
  for (const r of inputs.rules) {
    const prevalence = Math.min(1, r.pagesAffected / inputs.pagesAudited)
    byCategory.get(IMPACT_CATEGORY[r.impact])!.push({
      ruleId: r.ruleId,
      impact: r.impact,
      prevalence,
      weightedPrevalence: prevalence * (r.advisory ? weights.advisoryDiscount : 1),
      pagesAffected: r.pagesAffected,
      advisory: r.advisory,
    })
  }

  const deductions: AdaV4DeductionLine[] = []
  let totalDeduction = 0
  for (const category of ['critical', 'serious', 'moderate', 'minor'] as const) {
    const cap = weights[category]
    const contributions = byCategory.get(category)!
      .sort((a, b) => b.prevalence - a.prevalence || a.ruleId.localeCompare(b.ruleId))
    const weighted = contributions.reduce((sum, c) => sum + c.weightedPrevalence, 0)
    const fill = Math.min(1, weighted / ADA_V4_SATURATION[category])
    const points = cap * fill
    totalDeduction += points

    let kept = contributions
    if (contributions.length > TOP_CONTRIBUTIONS) {
      const head = contributions.slice(0, TOP_CONTRIBUTIONS)
      const rest = contributions.slice(TOP_CONTRIBUTIONS)
      kept = [...head, {
        ruleId: 'other',
        impact: category,
        prevalence: rest.reduce((s, c) => s + c.prevalence, 0),
        weightedPrevalence: rest.reduce((s, c) => s + c.weightedPrevalence, 0),
        pagesAffected: Math.max(...rest.map((c) => c.pagesAffected)),
        advisory: false,
        ruleCount: rest.length,
      }]
    }
    deductions.push({ category, cap, points: round1(points), contributions: kept })
  }

  const nrFill = Math.min(1, inputs.meanIncomplete / ADA_V4_SATURATION.needsReview)
  const nrPoints = weights.needsReview * nrFill
  totalDeduction += nrPoints
  deductions.push({ category: 'needsReview', cap: weights.needsReview, points: round1(nrPoints), contributions: [] })

  const score = Math.round(Math.max(0, 100 - totalDeduction))
  return {
    score,
    breakdown: {
      version: ADA_SCORE_VERSION,
      scorer: 'ada-v4',
      score,
      weightsHash: null,
      lowCoverage: inputs.pagesTotal !== null && inputs.pagesAudited < 0.5 * inputs.pagesTotal,
      deductions,
      inputsSummary: { pagesAudited: inputs.pagesAudited, pagesTotal: inputs.pagesTotal, meanIncomplete: inputs.meanIncomplete },
    },
  }
}

export function serializeAdaV4Breakdown(b: AdaV4Breakdown, weightsHash: string | null): string {
  return JSON.stringify({ ...b, weightsHash })
}
