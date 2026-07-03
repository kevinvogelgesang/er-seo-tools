// lib/findings/seo-write.ts
//
// The parser's dual-write entry: fetch context, map, persist. Callers wrap
// this in try/catch — a findings failure must never fail the parse.
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { resolveScoringWeights } from '@/lib/scoring/resolve-weights'
import { mapSeoResult } from './seo-mapper'
import { writeFindingsRun } from './writer'

export async function writeSeoFindings(
  sessionId: string,
  result: AggregatedResult,
  clientId: number | null,
): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdAt: true },
  })
  const weights = await resolveScoringWeights()
  const bundle = mapSeoResult(result, {
    sessionId,
    clientId,
    startedAt: session?.createdAt ?? null,
    completedAt: new Date(),
    weights,
  })
  await writeFindingsRun(bundle)
}
