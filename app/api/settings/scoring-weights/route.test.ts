// app/api/settings/scoring-weights/route.test.ts
//
// DB-backed tests for GET/PUT /api/settings/scoring-weights: GET returns defaults
// when unset; PUT persists valid changes; PUT rejects malformed JSON and invalid weights.
import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { DEFAULT_WEIGHTS } from '@/lib/scoring/weights'
import { resolveScoringWeights } from '@/lib/scoring/resolve-weights'
import { GET, PUT } from './route'

afterEach(async () => {
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
})

describe('GET /api/settings/scoring-weights', () => {
  it('returns DEFAULT_WEIGHTS when no row exists', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json() as { weights: typeof DEFAULT_WEIGHTS }
    expect(json.weights).toEqual(DEFAULT_WEIGHTS)
  })

  it('returns persisted weights after PUT', async () => {
    const newWeights = { ...DEFAULT_WEIGHTS, indexability: 30, errorRate: 15 }
    const putRes = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: JSON.stringify(newWeights),
    }))
    expect(putRes.status).toBe(200)

    const getRes = await GET()
    expect(getRes.status).toBe(200)
    const json = await getRes.json() as { weights: typeof DEFAULT_WEIGHTS }
    expect(json.weights.indexability).toBe(30)
    expect(json.weights.errorRate).toBe(15)
    expect(json.weights.missingTitle).toBe(10) // unchanged default
  })
})

describe('PUT /api/settings/scoring-weights', () => {
  it('rejects malformed JSON with 400', async () => {
    const res = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: 'not json',
    }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toBe('Invalid JSON.')
  })

  it('rejects weights with only crawlDepth positive (400)', async () => {
    const res = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({
        indexability: 0,
        errorRate: 0,
        missingTitle: 0,
        missingMeta: 0,
        missingH1: 0,
        crawlDepth: 15,
        thinContent: 0,
        schema: 0,
      }),
    }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toMatch(/At least one non-crawl-depth weight/)
  })

  it('returns 400 on invalid weight type', async () => {
    const res = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ indexability: 'not a number' }),
    }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toMatch(/must be a finite number/)
  })

  it('persists a valid partial update', async () => {
    const res = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ indexability: 40 }),
    }))
    expect(res.status).toBe(200)
    const json = await res.json() as { weights: typeof DEFAULT_WEIGHTS }
    expect(json.weights.indexability).toBe(40)
    expect(json.weights.errorRate).toBe(20) // unchanged default

    // Verify persistence
    const getRes = await GET()
    const getJson = await getRes.json() as { weights: typeof DEFAULT_WEIGHTS }
    expect(getJson.weights.indexability).toBe(40)
  })

  it('ignores a submitted brokenLinks: the 8 columns persist, brokenLinks stays the code default', async () => {
    const res = await PUT(new NextRequest('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ indexability: 33, errorRate: 12, brokenLinks: 25 }),
    }))
    expect(res.status).toBe(200)
    const json = await res.json() as { weights: typeof DEFAULT_WEIGHTS }
    expect(json.weights.indexability).toBe(33)
    expect(json.weights.errorRate).toBe(12)
    expect(json.weights.brokenLinks).toBe(10) // never the submitted 25

    // The 8 persistable columns actually landed in the DB row.
    const getRes = await GET()
    const getJson = await getRes.json() as { weights: typeof DEFAULT_WEIGHTS }
    expect(getJson.weights.indexability).toBe(33)
    expect(getJson.weights.errorRate).toBe(12)

    // resolveScoringWeights() (the shared read path) still yields the code default too.
    expect((await resolveScoringWeights()).brokenLinks).toBe(10)
  })
})
