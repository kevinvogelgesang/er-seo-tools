import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { DEFAULT_WEIGHTS, PERSISTABLE_WEIGHT_KEYS } from './weights'
import { resolveScoringWeights } from './resolve-weights'

// The 9 persistable columns (brokenLinks included since C19 PR3) exist on the ScoringWeights
// row — DB-row fixtures are built from PERSISTABLE_WEIGHT_KEYS, which now equals all of
// DEFAULT_WEIGHTS's keys, but keep going through PERSISTABLE_WEIGHT_KEYS so this fixture
// still tracks the DB row shape rather than the wider ScoringWeights type.
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
it('returns the stored brokenLinks column (C19 PR3)', async () => {
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...persistedDefaults, brokenLinks: 22 }, update: { brokenLinks: 22 } })
  expect((await resolveScoringWeights()).brokenLinks).toBe(22)
})
