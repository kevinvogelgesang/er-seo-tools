// lib/scoring/resolve-ada-weights.ts — server-only DB read for the ADA v4
// weight profile (C19 PR3; mirrors resolve-weights.ts).
import { prisma } from '@/lib/db'
import { DEFAULT_ADA_V4_WEIGHTS, type AdaV4Weights } from './ada-v4'

export async function resolveAdaScoringWeights(): Promise<AdaV4Weights> {
  const row = await prisma.adaScoringWeights.findUnique({ where: { id: 1 } })
  if (!row) return { ...DEFAULT_ADA_V4_WEIGHTS }
  return {
    critical: row.critical, serious: row.serious, moderate: row.moderate,
    minor: row.minor, needsReview: row.needsReview, advisoryDiscount: row.advisoryDiscount,
  }
}
