import type { AxeViolation } from './types'

export interface ScoreResult {
  score: number      // 0–100
  compliant: boolean // true if zero violations with wcag21aa tags
}

export function computeScore(violations: AxeViolation[], wcagLevel: string): ScoreResult {
  const criticalCount = violations.filter((v) => v.impact === 'critical').length
  const seriousCount  = violations.filter((v) => v.impact === 'serious').length
  const moderateCount = violations.filter((v) => v.impact === 'moderate').length
  const minorCount    = violations.filter((v) => v.impact === 'minor').length

  const totalPenalty = criticalCount * 4 + seriousCount * 3 + moderateCount * 2 + minorCount * 1

  const totalElements = violations.reduce((sum, v) => sum + v.nodes.length, 0)
  const divisor = Math.log10(Math.max(10, totalElements))
  const adjustedPenalty = totalPenalty / divisor

  const score = Math.max(0, Math.round(100 - adjustedPenalty))

  // compliant: zero violations (binary; wcagLevel param reserved for future filtering)
  const compliant = violations.length === 0

  return { score, compliant }
}
