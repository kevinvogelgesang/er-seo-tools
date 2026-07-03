import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { DEFAULT_WEIGHTS } from './weights'
import { resolveScoringWeights } from './resolve-weights'

afterEach(async () => { await prisma.scoringWeights.deleteMany({ where: { id: 1 } }) })

it('returns defaults when no row exists', async () => {
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
  expect(await resolveScoringWeights()).toEqual(DEFAULT_WEIGHTS)
})
it('returns the stored row when present', async () => {
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...DEFAULT_WEIGHTS, indexability: 42 }, update: { indexability: 42 } })
  expect((await resolveScoringWeights()).indexability).toBe(42)
})
