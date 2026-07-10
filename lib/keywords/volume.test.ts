// lib/keywords/volume.test.ts
//
// DB-backed tests for the KS-2 cache-first keyword volume service (Task 5).
// Transport (dataforseo-client) and the process-wide throttle are mocked;
// prisma is real (house convention — lib/keywords/gsc-snapshot.test.ts).
// Every test keyword is prefixed `ks2test-` so cleanup can target this
// suite's rows precisely (deleteMany startsWith, beforeAll AND afterAll).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { PROVIDER_VERSION, VOLUME_CHUNK_SIZE, VOLUME_MAX_CHUNKS_PER_CALL } from './volume-config'
import type { FetchVolumesResult, VolumeOutcome } from './dataforseo-client'

const { mockFetchSearchVolume } = vi.hoisted(() => ({
  mockFetchSearchVolume: vi.fn(),
}))
vi.mock('./dataforseo-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dataforseo-client')>()
  return { ...actual, fetchSearchVolume: mockFetchSearchVolume }
})

const { mockAcquire } = vi.hoisted(() => ({
  mockAcquire: vi.fn(async () => {}),
}))
vi.mock('./volume-throttle', () => ({
  volumeThrottle: { acquire: mockAcquire },
}))

import { getKeywordVolumes } from './volume'

const PREFIX = 'ks2test-'
const locale = { locationCode: 2840, languageCode: 'en' }

function stubEnabled() {
  vi.stubEnv('DATAFORSEO_LOGIN', 'testlogin')
  vi.stubEnv('DATAFORSEO_PASSWORD', 'testpass')
}
function stubDisabled() {
  vi.stubEnv('DATAFORSEO_LOGIN', '')
  vi.stubEnv('DATAFORSEO_PASSWORD', '')
}

function notReturnedOutcomes(keywords: string[]): VolumeOutcome[] {
  return keywords.map((keyword) => ({ keyword, outcome: 'not_returned' as const }))
}

function returnedOutcome(keyword: string, overrides: Partial<Extract<VolumeOutcome, { outcome: 'returned' }>> = {}) {
  return {
    keyword,
    outcome: 'returned' as const,
    searchVolume: 100,
    cpc: 1.5,
    competitionIndex: 40,
    monthlySearches: null,
    spell: null,
    ...overrides,
  }
}

function okResult(outcomes: VolumeOutcome[], cost: number | null = 0.1): FetchVolumesResult {
  return { ok: true, outcomes, cost }
}

async function cleanup() {
  await prisma.keywordVolumeCache.deleteMany({ where: { keyword: { startsWith: PREFIX } } })
}

beforeAll(cleanup)
afterAll(cleanup)

beforeEach(() => {
  stubEnabled()
  mockFetchSearchVolume.mockReset()
  mockAcquire.mockClear()
  mockAcquire.mockImplementation(async () => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getKeywordVolumes', () => {
  it('disabled gate: no DB/network, zeroed accounting', async () => {
    stubDisabled()
    const result = await getKeywordVolumes([`${PREFIX}disabled-kw`], locale)
    expect(result).toEqual({
      ok: false,
      reason: 'disabled',
      fromCache: 0,
      fetched: 0,
      skipped: [],
      attemptedChunks: 0,
      successfulChunks: 0,
      providerCost: null,
    })
    expect(mockFetchSearchVolume).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, NaN])('invalid locationCode %p → invalid_locale, no transport call', async (locationCode) => {
    const result = await getKeywordVolumes([`${PREFIX}loc-kw`], { locationCode, languageCode: 'en' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('error')
    expect(result.message).toBe('invalid_locale')
    expect(result.fromCache).toBe(0)
    expect(result.fetched).toBe(0)
    expect(result.skipped).toEqual([])
    expect(result.attemptedChunks).toBe(0)
    expect(result.successfulChunks).toBe(0)
    expect(result.providerCost).toBeNull()
    expect(mockFetchSearchVolume).not.toHaveBeenCalled()
  })

  it.each(['', 'english'])('invalid languageCode %p → invalid_locale, no transport call', async (languageCode) => {
    const result = await getKeywordVolumes([`${PREFIX}lang-kw`], { locationCode: 2840, languageCode })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('error')
    expect(result.message).toBe('invalid_locale')
    expect(mockFetchSearchVolume).not.toHaveBeenCalled()
  })

  it('normalizes + dedupes variant-cased/whitespace input into a single fetched outcome', async () => {
    const canonical = `${PREFIX}nursing program`
    mockFetchSearchVolume.mockResolvedValueOnce(okResult([returnedOutcome(canonical)]))

    const result = await getKeywordVolumes(
      [`${PREFIX}Nursing  Program`, `${PREFIX}nursing program`],
      locale,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.volumes).toHaveLength(1)
    expect(result.volumes[0].keyword).toBe(canonical)
    expect(result.fetched).toBe(1)
    expect(mockFetchSearchVolume).toHaveBeenCalledTimes(1)
    expect(mockFetchSearchVolume.mock.calls[0][0]).toEqual([canonical])
  })

  it('cache hit within TTL → zero transport calls, fromCache counted', async () => {
    const keyword = `${PREFIX}cached-hit`
    await prisma.keywordVolumeCache.create({
      data: {
        keyword,
        locationCode: locale.locationCode,
        languageCode: locale.languageCode,
        providerVersion: PROVIDER_VERSION,
        resultStatus: 'returned',
        searchVolume: 250,
        cpc: 2.1,
        competitionIndex: 55,
        monthlySearchesJson: null,
        spell: null,
        fetchedAt: new Date(),
      },
    })

    const result = await getKeywordVolumes([keyword], locale)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.volumes).toEqual([
      {
        keyword,
        outcome: 'returned',
        searchVolume: 250,
        cpc: 2.1,
        competitionIndex: 55,
        monthlySearches: null,
        spell: null,
        fromCache: true,
      },
    ])
    expect(result.fromCache).toBe(1)
    expect(result.fetched).toBe(0)
    expect(mockFetchSearchVolume).not.toHaveBeenCalled()
  })

  it('stale row (31d old) → refetch + fetchedAt refreshed', async () => {
    const keyword = `${PREFIX}stale-kw`
    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    await prisma.keywordVolumeCache.create({
      data: {
        keyword,
        locationCode: locale.locationCode,
        languageCode: locale.languageCode,
        providerVersion: PROVIDER_VERSION,
        resultStatus: 'returned',
        searchVolume: 10,
        cpc: null,
        competitionIndex: null,
        monthlySearchesJson: null,
        spell: null,
        fetchedAt: staleDate,
      },
    })
    mockFetchSearchVolume.mockResolvedValueOnce(okResult([returnedOutcome(keyword, { searchVolume: 999 })]))

    const result = await getKeywordVolumes([keyword], locale)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mockFetchSearchVolume).toHaveBeenCalledTimes(1)
    expect(result.volumes[0]).toMatchObject({ fromCache: false, searchVolume: 999 })

    const row = await prisma.keywordVolumeCache.findFirst({ where: { keyword, locationCode: locale.locationCode, languageCode: locale.languageCode, providerVersion: PROVIDER_VERSION } })
    expect(row).not.toBeNull()
    expect(row!.searchVolume).toBe(999)
    expect(row!.fetchedAt.getTime()).toBeGreaterThan(staleDate.getTime())
  })

  it('not_returned negative-cache hit → zero transport calls', async () => {
    const keyword = `${PREFIX}negative-cache`
    await prisma.keywordVolumeCache.create({
      data: {
        keyword,
        locationCode: locale.locationCode,
        languageCode: locale.languageCode,
        providerVersion: PROVIDER_VERSION,
        resultStatus: 'not_returned',
        searchVolume: null,
        cpc: null,
        competitionIndex: null,
        monthlySearchesJson: null,
        spell: null,
        fetchedAt: new Date(),
      },
    })

    const result = await getKeywordVolumes([keyword], locale)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.volumes).toEqual([{ keyword, outcome: 'not_returned', fromCache: true }])
    expect(mockFetchSearchVolume).not.toHaveBeenCalled()
  })

  it('invalid keywords are skipped with correct reasons; valid remainder still fetched', async () => {
    const tooLong = `${PREFIX}` + 'a'.repeat(90)
    const tooManyWords = `${PREFIX}` + Array.from({ length: 11 }, (_, i) => `w${i}`).join(' ')
    const valid = `${PREFIX}valid-keyword`
    mockFetchSearchVolume.mockResolvedValueOnce(okResult([returnedOutcome(valid)]))

    const result = await getKeywordVolumes(['', '   ', tooLong, tooManyWords, valid], locale)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { keyword: '', reason: 'empty' },
        { keyword: tooLong, reason: 'too_long' },
        { keyword: tooManyWords, reason: 'too_many_words' },
      ]),
    )
    // '' and '   ' both normalize to '' and dedupe to one skipped row.
    expect(result.skipped).toHaveLength(3)
    expect(result.volumes.map((v) => v.keyword)).toEqual([valid])
    expect(result.fetched).toBe(1)
  })

  it('1001 keywords → 2 transport calls (chunked at 1000)', async () => {
    const keywords = Array.from({ length: 1001 }, (_, i) => `${PREFIX}c1001-${i}`)
    mockFetchSearchVolume.mockImplementation(async (chunkKeywords: string[]) =>
      okResult(notReturnedOutcomes(chunkKeywords)),
    )

    const result = await getKeywordVolumes(keywords, locale)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mockFetchSearchVolume).toHaveBeenCalledTimes(2)
    expect(mockAcquire).toHaveBeenCalledTimes(2)
    expect(result.attemptedChunks).toBe(2)
    expect(result.successfulChunks).toBe(2)
    expect(result.fetched).toBe(1001)
    expect(result.volumes.map((v) => v.keyword)).toEqual(keywords)
  })

  it('3001 keywords → 3 transport calls, overflow skipped over_cap, output in first-seen order', async () => {
    const keywords = Array.from({ length: 3001 }, (_, i) => `${PREFIX}c3001-${i}`)
    mockFetchSearchVolume.mockImplementation(async (chunkKeywords: string[]) =>
      okResult(notReturnedOutcomes(chunkKeywords)),
    )

    const result = await getKeywordVolumes(keywords, locale)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mockFetchSearchVolume).toHaveBeenCalledTimes(VOLUME_MAX_CHUNKS_PER_CALL)
    expect(result.attemptedChunks).toBe(3)
    expect(result.successfulChunks).toBe(3)
    expect(result.skipped).toEqual([{ keyword: keywords[3000], reason: 'over_cap' }])
    expect(result.volumes).toHaveLength(3000)
    expect(result.volumes.map((v) => v.keyword)).toEqual(keywords.slice(0, 3000))
  })

  it('cache-read batching: >500 misses still resolve, findMany called with ≤500-keyword IN batches', async () => {
    // NOTE: does NOT use vi.spyOn on the live prisma delegate — Prisma's
    // dynamic proxy-based model accessors break for the rest of the suite
    // once spied (same gotcha called out in gsc-snapshot.test.ts). Instead,
    // temporarily shadow the method with a plain own-property assignment
    // that still calls through, and restore it by deleting the shadow.
    const keywords = Array.from({ length: 600 }, (_, i) => `${PREFIX}batch600-${i}`)
    mockFetchSearchVolume.mockImplementation(async (chunkKeywords: string[]) =>
      okResult(notReturnedOutcomes(chunkKeywords)),
    )

    const original = prisma.keywordVolumeCache.findMany.bind(prisma.keywordVolumeCache)
    const calls: unknown[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(prisma.keywordVolumeCache as any).findMany = (args: unknown) => {
      calls.push(args)
      return original(args as never)
    }

    try {
      const result = await getKeywordVolumes(keywords, locale)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.fetched).toBe(600)
      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        const where = (call as { where?: { keyword?: { in?: string[] } } })?.where
        const inList = where?.keyword?.in
        if (inList) expect(inList.length).toBeLessThanOrEqual(500)
      }
    } finally {
      // Reassign (not delete) — deleting the shadow leaves Prisma's
      // proxy-backed delegate permanently broken for the rest of this file.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(prisma.keywordVolumeCache as any).findMany = original
    }
  })

  it('providerCost sums across successful chunks', async () => {
    const keywords = Array.from({ length: VOLUME_CHUNK_SIZE + 100 }, (_, i) => `${PREFIX}cost-sum-${i}`)
    mockFetchSearchVolume
      .mockImplementationOnce(async (chunkKeywords: string[]) => okResult(notReturnedOutcomes(chunkKeywords), 0.5))
      .mockImplementationOnce(async (chunkKeywords: string[]) => okResult(notReturnedOutcomes(chunkKeywords), 0.3))

    const result = await getKeywordVolumes(keywords, locale)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mockFetchSearchVolume).toHaveBeenCalledTimes(2)
    expect(result.providerCost).toBeCloseTo(0.8)
  })

  it('providerCost is null when any successful chunk lacks a cost (unknown ≠ 0)', async () => {
    const keywords = Array.from({ length: VOLUME_CHUNK_SIZE + 100 }, (_, i) => `${PREFIX}cost-null-${i}`)
    mockFetchSearchVolume
      .mockImplementationOnce(async (chunkKeywords: string[]) => okResult(notReturnedOutcomes(chunkKeywords), 0.5))
      .mockImplementationOnce(async (chunkKeywords: string[]) => okResult(notReturnedOutcomes(chunkKeywords), null))

    const result = await getKeywordVolumes(keywords, locale)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.providerCost).toBeNull()
  })

  it('partial failure: chunk 2 error persists chunk 1 rows; accounting reflects attempted/successful; retry only refetches chunk 2', async () => {
    const keywords = Array.from({ length: VOLUME_CHUNK_SIZE + 100 }, (_, i) => `${PREFIX}partial-${i}`)
    const chunk1 = keywords.slice(0, VOLUME_CHUNK_SIZE)
    const chunk2 = keywords.slice(VOLUME_CHUNK_SIZE)

    mockFetchSearchVolume
      .mockImplementationOnce(async (chunkKeywords: string[]) => okResult(notReturnedOutcomes(chunkKeywords), 0.4))
      .mockImplementationOnce(async () => ({ ok: false, reason: 'rate_limited', message: 'too many requests' }) as FetchVolumesResult)

    const first = await getKeywordVolumes(keywords, locale)
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.reason).toBe('rate_limited')
    expect(first.attemptedChunks).toBe(2)
    expect(first.successfulChunks).toBe(1)

    const persisted = await prisma.keywordVolumeCache.findMany({
      where: { keyword: { in: chunk1 }, locationCode: locale.locationCode, languageCode: locale.languageCode, providerVersion: PROVIDER_VERSION },
    })
    expect(persisted).toHaveLength(chunk1.length)
    const persistedChunk2 = await prisma.keywordVolumeCache.findMany({
      where: { keyword: { in: chunk2 }, locationCode: locale.locationCode, languageCode: locale.languageCode, providerVersion: PROVIDER_VERSION },
    })
    expect(persistedChunk2).toHaveLength(0)

    // Retry: chunk 1 should now be all cache hits; only chunk 2 gets refetched.
    mockFetchSearchVolume.mockReset()
    mockFetchSearchVolume.mockImplementationOnce(async (chunkKeywords: string[]) =>
      okResult(notReturnedOutcomes(chunkKeywords), 0.1),
    )
    const second = await getKeywordVolumes(keywords, locale)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(mockFetchSearchVolume).toHaveBeenCalledTimes(1)
    expect(mockFetchSearchVolume.mock.calls[0][0]).toEqual(chunk2)
    expect(second.fromCache).toBe(chunk1.length)
    expect(second.fetched).toBe(chunk2.length)
  })

  it('unparseable_response chunk writes zero rows for that chunk', async () => {
    const keywords = Array.from({ length: 5 }, (_, i) => `${PREFIX}unparseable-${i}`)
    mockFetchSearchVolume.mockResolvedValueOnce({ ok: false, reason: 'error', message: 'unparseable_response' })

    const result = await getKeywordVolumes(keywords, locale)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('error')
    expect(result.message).toBe('unparseable_response')
    expect(result.attemptedChunks).toBe(1)
    expect(result.successfulChunks).toBe(0)

    const rows = await prisma.keywordVolumeCache.findMany({ where: { keyword: { in: keywords } } })
    expect(rows).toHaveLength(0)
  })

  it('locale-distinct rows: the same keyword under two locationCodes persists two rows', async () => {
    const keyword = `${PREFIX}locale-distinct`
    mockFetchSearchVolume
      .mockImplementationOnce(async () => okResult([returnedOutcome(keyword, { searchVolume: 111 })]))
      .mockImplementationOnce(async () => okResult([returnedOutcome(keyword, { searchVolume: 222 })]))

    const usResult = await getKeywordVolumes([keyword], { locationCode: 2840, languageCode: 'en' })
    const caResult = await getKeywordVolumes([keyword], { locationCode: 2124, languageCode: 'en' })
    expect(usResult.ok).toBe(true)
    expect(caResult.ok).toBe(true)
    if (!usResult.ok || !caResult.ok) return
    expect(usResult.volumes[0]).toMatchObject({ searchVolume: 111 })
    expect(caResult.volumes[0]).toMatchObject({ searchVolume: 222 })

    const rows = await prisma.keywordVolumeCache.findMany({ where: { keyword } })
    expect(rows).toHaveLength(2)
    expect(mockFetchSearchVolume).toHaveBeenCalledTimes(2)
  })

  it("'EN' and 'en' resolve to the same cache row (second call is a cache hit)", async () => {
    const keyword = `${PREFIX}en-case-kw`
    mockFetchSearchVolume.mockResolvedValueOnce(okResult([returnedOutcome(keyword, { searchVolume: 42 })]))

    const upper = await getKeywordVolumes([keyword], { locationCode: 2840, languageCode: 'EN' })
    expect(upper.ok).toBe(true)
    const lower = await getKeywordVolumes([keyword], { locationCode: 2840, languageCode: 'en' })
    expect(lower.ok).toBe(true)
    if (!upper.ok || !lower.ok) return

    expect(mockFetchSearchVolume).toHaveBeenCalledTimes(1)
    expect(lower.volumes[0]).toMatchObject({ fromCache: true, searchVolume: 42 })
  })
})
