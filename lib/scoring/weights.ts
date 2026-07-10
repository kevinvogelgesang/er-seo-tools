// lib/scoring/weights.ts — pure, client-safe. Shared weight profile + breakdown types.
export interface ScoringWeights {
  indexability: number; errorRate: number; missingTitle: number; missingMeta: number
  missingH1: number; crawlDepth: number; thinContent: number; schema: number; brokenLinks: number
}
export const DEFAULT_WEIGHTS: ScoringWeights = {
  indexability: 20, errorRate: 20, missingTitle: 10, missingMeta: 8, missingH1: 7, crawlDepth: 15, thinContent: 10, schema: 10, brokenLinks: 10,
}
export const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  indexability: 'Indexability', errorRate: 'Error rate', missingTitle: 'Missing title',
  missingMeta: 'Missing meta description', missingH1: 'Missing H1', crawlDepth: 'Crawl depth',
  thinContent: 'Thin content', schema: 'Schema coverage', brokenLinks: 'Broken links',
}
// The 8 columns that exist on the ScoringWeights DB row (brokenLinks has no column until PR3).
export const PERSISTABLE_WEIGHT_KEYS: readonly Exclude<keyof ScoringWeights, 'brokenLinks'>[] = [
  'indexability', 'errorRate', 'missingTitle', 'missingMeta', 'missingH1', 'crawlDepth', 'thinContent', 'schema',
]
const ALL_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]
export const LIVE_ELIGIBLE_KEYS = ALL_KEYS.filter((k) => k !== 'crawlDepth')
// Persistable-only subset used by validateWeights's "at least one non-zero" guard (see below) —
// distinct from LIVE_ELIGIBLE_KEYS, which also includes the non-persistable brokenLinks.
const PERSISTABLE_LIVE_ELIGIBLE_KEYS = PERSISTABLE_WEIGHT_KEYS.filter((k) => k !== 'crawlDepth')

export interface ScoreBreakdownFactor { key: string; label: string; weight: number; earned: number; possible: number }
export interface ScoreResult { score: number | null; factors: ScoreBreakdownFactor[] }
export interface PersistedBreakdown { version: 1; scorer: 'health' | 'live-seo'; score: number | null; factors: ScoreBreakdownFactor[] }

export function serializeBreakdown(scorer: 'health' | 'live-seo', r: ScoreResult): string {
  const p: PersistedBreakdown = { version: 1, scorer, score: r.score, factors: r.factors }
  return JSON.stringify(p)
}
export function validateWeights(input: Record<string, unknown>): ScoringWeights | { error: string } {
  const out = { ...DEFAULT_WEIGHTS }
  for (const key of PERSISTABLE_WEIGHT_KEYS) {
    const v = input[key]
    if (v === undefined || v === null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { error: `Weight "${key}" must be a finite number ≥ 0.` }
    out[key] = v
  }
  // brokenLinks has no DB column yet (PR3) — never accept a submitted value, always the code default.
  out.brokenLinks = DEFAULT_WEIGHTS.brokenLinks
  // The "at least one non-crawl-depth weight > 0" rule keeps its PRE-brokenLinks meaning: it
  // guards against a submission with every persistable weight at 0 (crawlDepth aside). It must
  // NOT check over LIVE_ELIGIBLE_KEYS here — brokenLinks is always 10 (non-persistable, never
  // user-settable), which would make the guard vacuously true and defeat its purpose.
  if (!PERSISTABLE_LIVE_ELIGIBLE_KEYS.some((k) => out[k] > 0)) return { error: 'At least one non-crawl-depth weight must be greater than 0.' }
  return out
}
