import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { DEFAULT_WEIGHTS, PERSISTABLE_WEIGHT_KEYS } from './weights'
import { resolveScoringWeights } from './resolve-weights'

// Only the 8 persistable columns exist on the ScoringWeights row — brokenLinks has no
// column until PR3, so DB-row fixtures must be built from PERSISTABLE_WEIGHT_KEYS, never
// a raw spread of DEFAULT_WEIGHTS (which now also carries brokenLinks).
const persistedDefaults = Object.fromEntries(PERSISTABLE_WEIGHT_KEYS.map((k) => [k, DEFAULT_WEIGHTS[k]]))

afterEach(async () => { await prisma.scoringWeights.deleteMany({ where: { id: 1 } }) })

it('returns defaults when no row exists', async () => {
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
  expect(await resolveScoringWeights()).toEqual(DEFAULT_WEIGHTS)
})
it('returns the stored row when present', async () => {
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...persistedDefaults, indexability: 42 }, update: { indexability: 42 } })
  expect((await resolveScoringWeights()).indexability).toBe(42)
})
it('returns brokenLinks: 10 unconditionally when a DB row is present', async () => {
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...persistedDefaults }, update: { ...persistedDefaults } })
  expect((await resolveScoringWeights()).brokenLinks).toBe(10)
})
