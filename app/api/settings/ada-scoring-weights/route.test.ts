// app/api/settings/ada-scoring-weights/route.test.ts
//
// DB-backed tests for GET/PUT /api/settings/ada-scoring-weights: GET returns
// defaults when unset; PUT validates + persists + round-trips; PUT rejects
// sum(caps) > 100 and malformed JSON.
import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { DEFAULT_ADA_V4_WEIGHTS } from '@/lib/scoring/ada-v4'
import { GET, PUT } from './route'

afterEach(async () => {
  await prisma.adaScoringWeights.deleteMany({ where: { id: 1 } })
})

describe('GET /api/settings/ada-scoring-weights', () => {
  it('returns DEFAULT_ADA_V4_WEIGHTS when no row exists', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json() as { weights: typeof DEFAULT_ADA_V4_WEIGHTS }
    expect(json.weights).toEqual(DEFAULT_ADA_V4_WEIGHTS)
  })
})

describe('PUT /api/settings/ada-scoring-weights', () => {
  it('validates, persists, and round-trips', async () => {
    // Defaults sum to exactly 100 (40+30+15+5+10); raising critical alone
    // without lowering another cap would push the sum over 100, so serious
    // is dropped to keep this a valid (sum === 100) combination.
    const res = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ critical: 50, serious: 20, advisoryDiscount: 0.5 }),
    }))
    expect(res.status).toBe(200)
    const json = await res.json() as { weights: typeof DEFAULT_ADA_V4_WEIGHTS }
    expect(json.weights.critical).toBe(50)

    const getRes = await GET()
    const getJson = await getRes.json() as { weights: typeof DEFAULT_ADA_V4_WEIGHTS }
    expect(getJson.weights).toMatchObject({ critical: 50, serious: 20, advisoryDiscount: 0.5 })
  })

  it('rejects sum(caps) > 100 with a 400', async () => {
    const res = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ critical: 90, serious: 30 }),
    }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toMatch(/sum/i)
  })

  it('rejects malformed JSON with 400 invalid_json', async () => {
    const res = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: 'nope',
    }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toBe('invalid_json')
  })
})
