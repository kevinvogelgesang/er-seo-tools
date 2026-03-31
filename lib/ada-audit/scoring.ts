import type { AxeViolation } from './types'

export interface ScoreResult {
  score: number      // 0–100
  compliant: boolean // true if zero violations with wcag21aa tags
}

function scoreFromPenalty(totalPenalty: number, totalElements: number): ScoreResult {
  const divisor = Math.log10(Math.max(10, totalElements))
  const score = Math.max(0, Math.round(100 - totalPenalty / divisor))
  return { score, compliant: totalElements === 0 }
}

export function computeScore(violations: AxeViolation[], _wcagLevel: string): ScoreResult {
  let criticalCount = 0, seriousCount = 0, moderateCount = 0, minorCount = 0, totalElements = 0
  for (const v of violations) {
    if (v.impact === 'critical') criticalCount++
    else if (v.impact === 'serious') seriousCount++
    else if (v.impact === 'moderate') moderateCount++
    else if (v.impact === 'minor') minorCount++
    totalElements += v.nodes.length
  }
  const totalPenalty = criticalCount * 4 + seriousCount * 3 + moderateCount * 2 + minorCount
  return scoreFromPenalty(totalPenalty, totalElements)
}

/** Compute score from aggregate counts (e.g. site audit summary). */
export function computeScoreFromCounts(
  counts: { critical: number; serious: number; moderate: number; minor: number },
  _wcagLevel: string,
): ScoreResult {
  const total = counts.critical + counts.serious + counts.moderate + counts.minor
  const totalPenalty = counts.critical * 4 + counts.serious * 3 + counts.moderate * 2 + counts.minor
  return scoreFromPenalty(totalPenalty, total)
}
