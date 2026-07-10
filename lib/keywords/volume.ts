// lib/keywords/volume.ts
//
// KS-2 cache-first keyword search-volume service — spec §5.3
// (docs/superpowers/specs/2026-07-10-ks2-dataforseo-volume-provider-design.md).
// The flow order below is CONTRACTUAL (Codex #1-#6 / plan #1-#6):
//   disabled gate → locale validation → normalize+dedupe+validate keywords
//   → cache read (bounded IN-list batches) → miss chunking (≤1000/≤3 chunks)
//   → per-chunk throttle+fetch+upsert → merge in first-seen input order.
// One invalid keyword never fails a batch (D6); one failed chunk never
// destroys prior chunks' persisted rows (§7) — the cache is a cache, partial
// persistence is safe and saves money on retry.
import { prisma } from '@/lib/db'
import { fetchSearchVolume, type VolumeOutcome } from './dataforseo-client'
import { normalizeKeyword, normalizeLocale } from './volume-normalize'
import { volumeThrottle } from './volume-throttle'
import {
  isVolumeEnabled,
  PROVIDER_VERSION,
  VOLUME_MAX_CHUNKS_PER_CALL,
  VOLUME_CHUNK_SIZE,
  VOLUME_CACHE_TTL_DAYS,
  KEYWORD_MAX_CHARS,
  KEYWORD_MAX_WORDS,
} from './volume-config'

/** Bound on the `keyword IN (...)` predicate per cache-read findMany call —
 *  a single findMany over up to 3,000 misses risks SQLite bind-variable
 *  limits (Codex plan #2). Independent of VOLUME_CHUNK_SIZE (the provider
 *  fetch cap). */
const CACHE_READ_BATCH_SIZE = 500

export type SkippedKeyword = {
  keyword: string
  reason: 'empty' | 'too_long' | 'too_many_words' | 'over_cap'
}

export type MonthlySearch = { year: number; month: number; searchVolume: number | null }

export type KeywordVolume =
  | {
      keyword: string
      outcome: 'returned'
      searchVolume: number | null
      cpc: number | null
      competitionIndex: number | null
      monthlySearches: MonthlySearch[] | null
      spell: string | null
      fromCache: boolean
    }
  | { keyword: string; outcome: 'not_returned'; fromCache: boolean }

export type VolumeAccounting = {
  fromCache: number
  fetched: number
  skipped: SkippedKeyword[]
  attemptedChunks: number
  successfulChunks: number
  // Sum of provider-reported task costs from successful chunks. 0 when no
  // request was ever sent (attemptedChunks === 0: disabled, invalid_locale,
  // all-cache-hit — spend is KNOWN zero, the common production case). null
  // ONLY when spend is genuinely unresolved: a request went out but no chunk
  // succeeded (attemptedChunks > 0 && successfulChunks === 0), or a
  // successful chunk lacked a cost field (unknown ≠ 0, Codex plan #3).
  providerCost: number | null
}

export type GetKeywordVolumesResult =
  | ({ ok: true; volumes: KeywordVolume[] } & VolumeAccounting)
  | ({
      ok: false
      reason: 'disabled' | 'auth' | 'payment' | 'rate_limited' | 'error'
      message?: string
    } & VolumeAccounting)

function zeroAccounting(): VolumeAccounting {
  // providerCost 0, not null: nothing was ever sent, spend is KNOWN zero.
  return { fromCache: 0, fetched: 0, skipped: [], attemptedChunks: 0, successfulChunks: 0, providerCost: 0 }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

type CacheRow = {
  keyword: string
  resultStatus: string
  searchVolume: number | null
  cpc: number | null
  competitionIndex: number | null
  monthlySearchesJson: string | null
  spell: string | null
  fetchedAt: Date
}

function parseMonthlySearches(json: string | null): MonthlySearch[] | null {
  if (!json) return null
  try {
    return JSON.parse(json) as MonthlySearch[]
  } catch {
    return null
  }
}

function rowToKeywordVolume(keyword: string, row: CacheRow, fromCache: boolean): KeywordVolume {
  if (row.resultStatus === 'returned') {
    return {
      keyword,
      outcome: 'returned',
      searchVolume: row.searchVolume,
      cpc: row.cpc,
      competitionIndex: row.competitionIndex,
      monthlySearches: parseMonthlySearches(row.monthlySearchesJson),
      spell: row.spell,
      fromCache,
    }
  }
  return { keyword, outcome: 'not_returned', fromCache }
}

function outcomeToUpsertData(outcome: VolumeOutcome) {
  if (outcome.outcome === 'returned') {
    return {
      resultStatus: 'returned' as const,
      searchVolume: outcome.searchVolume,
      cpc: outcome.cpc,
      competitionIndex: outcome.competitionIndex,
      monthlySearchesJson: outcome.monthlySearches ? JSON.stringify(outcome.monthlySearches) : null,
      spell: outcome.spell,
      fetchedAt: new Date(),
    }
  }
  return {
    resultStatus: 'not_returned' as const,
    searchVolume: null,
    cpc: null,
    competitionIndex: null,
    monthlySearchesJson: null,
    spell: null,
    fetchedAt: new Date(),
  }
}

/**
 * Resolve search volume for a batch of keywords, cache-first, against
 * DataForSEO's Google Ads search-volume endpoint. KS-5 consumes this — see
 * spec §10.
 */
export async function getKeywordVolumes(
  keywords: string[],
  locale: { locationCode: number; languageCode: string },
): Promise<GetKeywordVolumesResult> {
  // 1. Disabled gate — NO DB/network.
  if (!isVolumeEnabled()) {
    return { ok: false, reason: 'disabled', ...zeroAccounting() }
  }

  // 2. Locale validation — NO DB/network on failure.
  const normalizedLocale = normalizeLocale(locale)
  if (!normalizedLocale) {
    return { ok: false, reason: 'error', message: 'invalid_locale', ...zeroAccounting() }
  }
  const { locationCode, languageCode } = normalizedLocale

  // 3. Normalize + dedupe (first-seen order preserved), then validate.
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const raw of keywords) {
    const norm = normalizeKeyword(raw)
    if (seen.has(norm)) continue
    seen.add(norm)
    ordered.push(norm)
  }

  const skipped: SkippedKeyword[] = []
  const candidates: string[] = []
  for (const keyword of ordered) {
    if (keyword.length === 0) {
      skipped.push({ keyword, reason: 'empty' })
    } else if (keyword.length > KEYWORD_MAX_CHARS) {
      skipped.push({ keyword, reason: 'too_long' })
    } else if (keyword.split(' ').length > KEYWORD_MAX_WORDS) {
      skipped.push({ keyword, reason: 'too_many_words' })
    } else {
      candidates.push(keyword)
    }
  }

  // 4. Cache read, batched into ≤500-keyword IN-lists (Codex plan #2).
  const cacheMap = new Map<string, CacheRow>()
  for (const batch of chunkArray(candidates, CACHE_READ_BATCH_SIZE)) {
    const rows = await prisma.keywordVolumeCache.findMany({
      where: { keyword: { in: batch }, locationCode, languageCode, providerVersion: PROVIDER_VERSION },
    })
    for (const row of rows) cacheMap.set(row.keyword, row)
  }

  const ttlCutoffMs = Date.now() - VOLUME_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
  const hits = new Map<string, KeywordVolume>()
  const misses: string[] = []
  for (const keyword of candidates) {
    const row = cacheMap.get(keyword)
    if (row && row.fetchedAt.getTime() >= ttlCutoffMs) {
      hits.set(keyword, rowToKeywordVolume(keyword, row, true))
    } else {
      misses.push(keyword)
    }
  }

  // 5. Miss chunking: ≤1000/chunk, ≤3 chunks; overflow → skipped 'over_cap'.
  const allMissChunks = chunkArray(misses, VOLUME_CHUNK_SIZE)
  const chunksToFetch = allMissChunks.slice(0, VOLUME_MAX_CHUNKS_PER_CALL)
  const overflowChunks = allMissChunks.slice(VOLUME_MAX_CHUNKS_PER_CALL)
  for (const overflow of overflowChunks) {
    for (const keyword of overflow) skipped.push({ keyword, reason: 'over_cap' })
  }

  const accounting: VolumeAccounting = {
    fromCache: hits.size,
    fetched: 0,
    skipped,
    attemptedChunks: 0,
    successfulChunks: 0,
    providerCost: 0, // known zero until a chunk is attempted
  }

  const fetched = new Map<string, KeywordVolume>()
  let costPoisoned = false
  let costSum = 0

  // 6. Per chunk: attempt → throttle → fetch → (on success) upsert + cost.
  for (const chunkKeywords of chunksToFetch) {
    accounting.attemptedChunks++
    await volumeThrottle.acquire()
    const result = await fetchSearchVolume(chunkKeywords, { locationCode, languageCode })

    if (!result.ok) {
      // STOP — no further chunks. Earlier chunks' rows stay persisted.
      // Zero successful chunks means a request went out but its spend is
      // genuinely unresolved → null; otherwise the successful chunks' sum
      // (or poison-null) already in accounting stands.
      if (accounting.successfulChunks === 0) accounting.providerCost = null
      return { ok: false, reason: result.reason, message: result.message, ...accounting }
    }

    accounting.successfulChunks++

    if (result.cost === null) {
      costPoisoned = true
    } else if (!costPoisoned) {
      costSum += result.cost
    }
    accounting.providerCost = costPoisoned ? null : costSum

    for (const outcome of result.outcomes) {
      const data = outcomeToUpsertData(outcome)
      const row = await prisma.keywordVolumeCache.upsert({
        where: {
          keyword_locationCode_languageCode_providerVersion: {
            keyword: outcome.keyword,
            locationCode,
            languageCode,
            providerVersion: PROVIDER_VERSION,
          },
        },
        create: {
          keyword: outcome.keyword,
          locationCode,
          languageCode,
          providerVersion: PROVIDER_VERSION,
          ...data,
        },
        update: data,
      })
      fetched.set(outcome.keyword, rowToKeywordVolume(outcome.keyword, row, false))
      accounting.fetched++
    }
  }

  // 7. Merge in first-seen input order; skipped keywords excluded.
  const volumes: KeywordVolume[] = []
  for (const keyword of candidates) {
    const hit = hits.get(keyword)
    if (hit) {
      volumes.push(hit)
      continue
    }
    const fetchedVolume = fetched.get(keyword)
    if (fetchedVolume) volumes.push(fetchedVolume)
    // else: keyword landed in an overflow chunk (skipped 'over_cap')
  }

  return { ok: true, volumes, ...accounting }
}
