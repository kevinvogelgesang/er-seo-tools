// lib/keywords/dataforseo-client.ts
// KS-2 transport — DataForSEO Google Ads search-volume live endpoint over
// plain fetch (notify-transport pattern: injectable deps, AbortController
// timeout, credentials built inside the call, never attached to errors).
// See spec §5.2: docs/superpowers/specs/2026-07-10-ks2-dataforseo-volume-provider-design.md

import { DATAFORSEO_API_BASE, VOLUME_REQUEST_TIMEOUT_MS, dataForSeoAuthHeader } from './volume-config'
import { normalizeKeyword } from './volume-normalize'

const SEARCH_VOLUME_PATH = '/v3/keywords_data/google_ads/search_volume/live'
const MAX_MESSAGE_LENGTH = 200

export type MonthlySearch = { year: number; month: number; searchVolume: number | null }

export type VolumeOutcome =
  | {
      keyword: string
      outcome: 'returned'
      searchVolume: number | null
      cpc: number | null
      competitionIndex: number | null
      monthlySearches: MonthlySearch[] | null
      spell: string | null
    }
  | { keyword: string; outcome: 'not_returned' }

export type FetchVolumesResult =
  | { ok: true; outcomes: VolumeOutcome[]; cost: number | null }
  | { ok: false; reason: 'auth' | 'payment' | 'rate_limited' | 'error'; message?: string }

export interface FetchSearchVolumeDeps {
  fetch?: typeof fetch
  timeoutMs?: number
}

type StatusClass = 'ok' | 'payment' | 'rate_limited' | 'error'

function classifyStatusCode(code: unknown): StatusClass {
  if (code === 20000) return 'ok'
  if (typeof code !== 'number') return 'error'
  // 40202 is DataForSEO's rate-limit-class code even though it falls inside
  // the 402xx numeric range — it is called out ahead of the payment-class
  // check on purpose (spec §5.2 / Codex #4).
  if (code === 40202) return 'rate_limited'
  if (code >= 40200 && code < 40300) return 'payment'
  if (code >= 42900 && code < 43000) return 'rate_limited'
  return 'error'
}

function capMessage(msg: unknown): string | undefined {
  if (typeof msg !== 'string') return undefined
  return msg.length > MAX_MESSAGE_LENGTH ? msg.slice(0, MAX_MESSAGE_LENGTH) : msg
}

function buildMonthlySearches(raw: unknown): MonthlySearch[] | null {
  if (!Array.isArray(raw)) return null

  const entries = raw.filter(
    (m): m is { year: number; month: number; search_volume?: number | null } =>
      Boolean(m) && typeof m === 'object' && typeof (m as Record<string, unknown>).year === 'number' &&
      typeof (m as Record<string, unknown>).month === 'number',
  )

  entries.sort((a, b) => (a.year - b.year) || (a.month - b.month))
  const newest12 = entries.slice(-12)

  return newest12.map((m) => ({
    year: m.year,
    month: m.month,
    searchVolume: typeof m.search_volume === 'number' ? m.search_volume : null,
  }))
}

/**
 * One live request for <= 1,000 keywords against DataForSEO's Google Ads
 * search-volume endpoint. Never remaps a spell/similar-grouped response item
 * onto the requested keyword — see spec §5.2 (Codex #1).
 *
 * KS-5 consumes this via the volume.ts service — see spec §10.
 */
export async function fetchSearchVolume(
  keywords: string[],
  locale: { locationCode: number; languageCode: string },
  deps: FetchSearchVolumeDeps = {},
): Promise<FetchVolumesResult> {
  const doFetch = deps.fetch ?? fetch
  const timeoutMs = deps.timeoutMs ?? VOLUME_REQUEST_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await doFetch(`${DATAFORSEO_API_BASE}${SEARCH_VOLUME_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: dataForSeoAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          keywords,
          location_code: locale.locationCode,
          language_code: locale.languageCode,
        },
      ]),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'error', message: 'timeout' }
    }
    return { ok: false, reason: 'error', message: 'network_error' }
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401) {
    return { ok: false, reason: 'auth', message: 'authentication_failed' }
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, reason: 'error', message: 'unparseable_response' }
  }

  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'error', message: 'unparseable_response' }
  }
  const envelope = json as Record<string, unknown>

  const topClass = classifyStatusCode(envelope.status_code)
  if (topClass !== 'ok') {
    return { ok: false, reason: topClass, message: capMessage(envelope.status_message) }
  }

  const tasks = envelope.tasks
  if (!Array.isArray(tasks) || tasks.length === 0 || !tasks[0] || typeof tasks[0] !== 'object') {
    return { ok: false, reason: 'error', message: 'unparseable_response' }
  }
  const task = tasks[0] as Record<string, unknown>

  const taskClass = classifyStatusCode(task.status_code)
  if (taskClass !== 'ok') {
    return { ok: false, reason: taskClass, message: capMessage(task.status_message) }
  }

  const result = task.result
  if (!Array.isArray(result)) {
    return { ok: false, reason: 'error', message: 'unparseable_response' }
  }

  // Match response items to requested keywords by normalized equality only.
  // First item wins when multiple items normalize to the same keyword.
  const byNormalizedKeyword = new Map<string, Record<string, unknown>>()
  for (const item of result) {
    if (!item || typeof item !== 'object') continue
    const itemRecord = item as Record<string, unknown>
    if (typeof itemRecord.keyword !== 'string') continue
    const norm = normalizeKeyword(itemRecord.keyword)
    if (!byNormalizedKeyword.has(norm)) byNormalizedKeyword.set(norm, itemRecord)
  }

  const outcomes: VolumeOutcome[] = keywords.map((keyword) => {
    const norm = normalizeKeyword(keyword)
    const item = byNormalizedKeyword.get(norm)
    if (!item) return { keyword, outcome: 'not_returned' }

    return {
      keyword,
      outcome: 'returned',
      searchVolume: typeof item.search_volume === 'number' ? item.search_volume : null,
      cpc: typeof item.cpc === 'number' ? item.cpc : null,
      competitionIndex: typeof item.competition_index === 'number' ? item.competition_index : null,
      monthlySearches: buildMonthlySearches(item.monthly_searches),
      spell: typeof item.spell === 'string' ? item.spell : null,
    }
  })

  const cost = typeof task.cost === 'number' ? task.cost : null

  return { ok: true, outcomes, cost }
}
