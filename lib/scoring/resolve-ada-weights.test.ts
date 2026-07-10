import { it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { DEFAULT_ADA_V4_WEIGHTS } from './ada-v4'
import { resolveAdaScoringWeights } from './resolve-ada-weights'

afterEach(async () => { await prisma.adaScoringWeights.deleteMany({ where: { id: 1 } }) })

it('returns defaults when no row exists', async () => {
  await prisma.adaScoringWeights.deleteMany({ where: { id: 1 } })
  expect(await resolveAdaScoringWeights()).toEqual(DEFAULT_ADA_V4_WEIGHTS)
})
it('returns the stored row when present', async () => {
  await prisma.adaScoringWeights.upsert({
    where: { id: 1 },
    create: { id: 1, critical: 55, advisoryDiscount: 0.2 },
    update: { critical: 55, advisoryDiscount: 0.2 },
  })
  const w = await resolveAdaScoringWeights()
  expect(w.critical).toBe(55)
  expect(w.advisoryDiscount).toBe(0.2)
  expect(w.serious).toBe(30) // column default fills unspecified keys
})
