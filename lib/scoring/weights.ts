// lib/scoring/weights.ts — pure, client-safe. Shared weight profile + breakdown types.
export interface ScoringWeights {
  indexability: number; errorRate: number; missingTitle: number; missingMeta: number
  missingH1: number; crawlDepth: number; thinContent: number; schema: number
}
export const DEFAULT_WEIGHTS: ScoringWeights = {
  indexability: 20, errorRate: 20, missingTitle: 10, missingMeta: 8, missingH1: 7, crawlDepth: 15, thinContent: 10, schema: 10,
}
export const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  indexability: 'Indexability', errorRate: 'Error rate', missingTitle: 'Missing title',
  missingMeta: 'Missing meta description', missingH1: 'Missing H1', crawlDepth: 'Crawl depth',
  thinContent: 'Thin content', schema: 'Schema coverage',
}
const ALL_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]
export const LIVE_ELIGIBLE_KEYS = ALL_KEYS.filter((k) => k !== 'crawlDepth')

export interface ScoreBreakdownFactor { key: string; label: string; weight: number; earned: number; possible: number }
export interface ScoreResult { score: number | null; factors: ScoreBreakdownFactor[] }
export interface PersistedBreakdown { version: 1; scorer: 'health' | 'live-seo'; score: number | null; factors: ScoreBreakdownFactor[] }

export function serializeBreakdown(scorer: 'health' | 'live-seo', r: ScoreResult): string {
  const p: PersistedBreakdown = { version: 1, scorer, score: r.score, factors: r.factors }
  return JSON.stringify(p)
}
export function validateWeights(input: Record<string, unknown>): ScoringWeights | { error: string } {
  const out = { ...DEFAULT_WEIGHTS }
  for (const key of ALL_KEYS) {
    const v = input[key]
    if (v === undefined || v === null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { error: `Weight "${key}" must be a finite number ≥ 0.` }
    out[key] = v
  }
  if (!LIVE_ELIGIBLE_KEYS.some((k) => out[k] > 0)) return { error: 'At least one non-crawl-depth weight must be greater than 0.' }
  return out
}
