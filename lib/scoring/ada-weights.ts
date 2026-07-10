// lib/scoring/ada-weights.ts — pure, client-safe. Validation + labels for the
// ADA v4 weight profile (C19 PR3). Unlike the SEO weights (normalized shares),
// the five caps are ABSOLUTE deductions — an unconstrained total would silently
// rescale the whole grade, hence sum(caps) ≤ 100 (spec Part 4 / Codex #2).
import { DEFAULT_ADA_V4_WEIGHTS, type AdaV4Weights } from './ada-v4'

export type AdaCapKey = Exclude<keyof AdaV4Weights, 'advisoryDiscount'>
export const ADA_CAP_KEYS: readonly AdaCapKey[] = ['critical', 'serious', 'moderate', 'minor', 'needsReview']

export const ADA_WEIGHT_LABELS: Record<keyof AdaV4Weights, string> = {
  critical: 'Critical cap',
  serious: 'Serious cap',
  moderate: 'Moderate cap',
  minor: 'Minor cap',
  needsReview: 'Needs-review cap',
  advisoryDiscount: 'Advisory discount (0–1)',
}

export function validateAdaWeights(input: Record<string, unknown> | Partial<AdaV4Weights>): AdaV4Weights | { error: string } {
  const inp = input as Record<string, unknown> // Lab passes a typed AdaV4Weights; route passes parsed JSON
  const out: AdaV4Weights = { ...DEFAULT_ADA_V4_WEIGHTS }
  for (const key of ADA_CAP_KEYS) {
    const v = inp[key]
    if (v === undefined || v === null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      return { error: `Cap "${key}" must be a finite number between 0 and 100.` }
    }
    out[key] = v
  }
  const d = inp.advisoryDiscount
  if (d !== undefined && d !== null) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 1) {
      return { error: 'Advisory discount must be a number between 0 and 1.' }
    }
    out.advisoryDiscount = d
  }
  const sum = ADA_CAP_KEYS.reduce((s, k) => s + out[k], 0)
  if (sum > 100) return { error: `Caps sum to ${sum} — they are absolute deductions and must sum to at most 100.` }
  if (!ADA_CAP_KEYS.some((k) => out[k] > 0)) return { error: 'At least one cap must be greater than 0.' }
  return out
}
