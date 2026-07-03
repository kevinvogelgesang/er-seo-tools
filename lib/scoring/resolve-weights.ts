// lib/scoring/resolve-weights.ts — server-only DB read for the weight profile.
import { prisma } from '@/lib/db'
import { DEFAULT_WEIGHTS, type ScoringWeights } from './weights'

export async function resolveScoringWeights(): Promise<ScoringWeights> {
  const row = await prisma.scoringWeights.findUnique({ where: { id: 1 } })
  if (!row) return { ...DEFAULT_WEIGHTS }
  return {
    indexability: row.indexability, errorRate: row.errorRate, missingTitle: row.missingTitle,
    missingMeta: row.missingMeta, missingH1: row.missingH1, crawlDepth: row.crawlDepth,
    thinContent: row.thinContent, schema: row.schema,
  }
}
