// lib/keywords/dataforseo-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchSearchVolume } from './dataforseo-client'
import { DATAFORSEO_API_BASE } from './volume-config'

const locale = { locationCode: 2840, languageCode: 'en' }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status })
}

function okEnvelope(task: Record<string, unknown>, topCost: number | null = 0.09) {
  return {
    status_code: 20000,
    status_message: 'Ok.',
    cost: topCost,
    tasks: [
      {
        status_code: 20000,
        status_message: 'Ok.',
        cost: 0.09,
        result: [],
        ...task,
      },
    ],
  }
}

describe('fetchSearchVolume', () => {
  beforeEach(() => {
    vi.stubEnv('DATAFORSEO_LOGIN', 'testlogin')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'testpass123')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('POSTs the correct URL, method, Basic auth header, and task body', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        okEnvelope({
          result: [
            { keyword: 'nursing program', search_volume: 100, cpc: 1.2, competition_index: 40, monthly_searches: null, spell: null },
          ],
        }),
      ),
    )

    await fetchSearchVolume(['nursing program'], locale, { fetch: fetchMock as unknown as typeof fetch })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${DATAFORSEO_API_BASE}/v3/keywords_data/google_ads/search_volume/live`)
    expect((init as RequestInit).method).toBe('POST')

    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Basic ' + Buffer.from('testlogin:testpass123').toString('base64'))
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse((init as RequestInit).body as string)
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]).toEqual({
      keywords: ['nursing program'],
      location_code: 2840,
      language_code: 'en',
    })
  })

  it('happy path: matched item with null search_volume → returned outcome, null-safe fields', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        okEnvelope({
          result: [
            {
              keyword: 'nursing program',
              search_volume: null,
              cpc: null,
              competition_index: null,
              monthly_searches: null,
              spell: null,
            },
          ],
        }),
      ),
    )

    const result = await fetchSearchVolume(['nursing program'], locale, {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.outcomes).toEqual([
      {
        keyword: 'nursing program',
        outcome: 'returned',
        searchVolume: null,
        cpc: null,
        competitionIndex: null,
        monthlySearches: null,
        spell: null,
      },
    ])
    expect(result.cost).toBe(0.09)
  })

  it('a requested keyword absent from the response items → not_returned', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        okEnvelope({
          result: [{ keyword: 'nursing program', search_volume: 50, cpc: 1, competition_index: 10, monthly_searches: null, spell: null }],
        }),
      ),
    )

    const result = await fetchSearchVolume(['nursing program', 'nonexistent phrase'], locale, {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.outcomes).toEqual([
      {
        keyword: 'nursing program',
        outcome: 'returned',
        searchVolume: 50,
        cpc: 1,
        competitionIndex: 10,
        monthlySearches: null,
        spell: null,
      },
      { keyword: 'nonexistent phrase', outcome: 'not_returned' },
    ])
  })

  it('spell-grouped item (response keyword differs from requested) → requested keyword not_returned, item ignored', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        okEnvelope({
          result: [
            {
              keyword: 'nurse practitioner',
              search_volume: 900,
              cpc: 2,
              competition_index: 60,
              monthly_searches: null,
              spell: 'nursing practicioner',
            },
          ],
        }),
      ),
    )

    const result = await fetchSearchVolume(['nursing practicioner'], locale, {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.outcomes).toEqual([{ keyword: 'nursing practicioner', outcome: 'not_returned' }])
  })

  it('monthlySearches: shuffled input >12 entries sorted by (year,month) ascending then sliced to newest 12', async () => {
    // Build 14 months, Jan 2024 .. Feb 2025, then shuffle.
    const all: { year: number; month: number; search_volume: number }[] = []
    let y = 2024
    let m = 1
    for (let i = 0; i < 14; i++) {
      all.push({ year: y, month: m, search_volume: i })
      m++
      if (m > 12) {
        m = 1
        y++
      }
    }
    const shuffled = [all[13], all[2], all[0], all[10], all[1], all[9], all[3], all[12], all[4], all[8], all[5], all[11], all[6], all[7]]

    const fetchMock = vi.fn(async () =>
      jsonResponse(
        okEnvelope({
          result: [
            {
              keyword: 'nursing program',
              search_volume: 100,
              cpc: 1,
              competition_index: 20,
              monthly_searches: shuffled,
              spell: null,
            },
          ],
        }),
      ),
    )

    const result = await fetchSearchVolume(['nursing program'], locale, {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const outcome = result.outcomes[0]
    if (outcome.outcome !== 'returned') throw new Error('expected returned')
    expect(outcome.monthlySearches).toHaveLength(12)
    // The newest 12 of a 14-month ascending run starting Jan 2024 are months 3..14
    // i.e. starting March 2024 (index 2, search_volume 2) through Feb 2025 (search_volume 13).
    expect(outcome.monthlySearches?.[0]).toEqual({ year: 2024, month: 3, searchVolume: 2 })
    expect(outcome.monthlySearches?.[11]).toEqual({ year: 2025, month: 2, searchVolume: 13 })
    // Ascending order preserved.
    for (let i = 1; i < (outcome.monthlySearches?.length ?? 0); i++) {
      const prev = outcome.monthlySearches![i - 1]
      const cur = outcome.monthlySearches![i]
      expect(cur.year * 12 + cur.month).toBeGreaterThan(prev.year * 12 + prev.month)
    }
  })

  it('well-formed task with an EMPTY result array is valid → all requested keywords not_returned, ok:true', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(okEnvelope({ result: [] })))

    const result = await fetchSearchVolume(['a', 'b'], locale, { fetch: fetchMock as unknown as typeof fetch })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.outcomes).toEqual([
      { keyword: 'a', outcome: 'not_returned' },
      { keyword: 'b', outcome: 'not_returned' },
    ])
  })

  it('missing result field → unparseable_response', async () => {
    const fetchMock = vi.fn(async () => {
      const envelope = okEnvelope({}) as Record<string, unknown>
      const tasks = envelope.tasks as Array<Record<string, unknown>>
      delete tasks[0].result
      return jsonResponse(envelope)
    })

    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('error')
    expect(result.message).toBe('unparseable_response')
  })

  it('null result field → unparseable_response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(okEnvelope({ result: null })))

    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('error')
    expect(result.message).toBe('unparseable_response')
  })

  it('missing/malformed tasks array → unparseable_response', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status_code: 20000, status_message: 'Ok.', cost: 0.09, tasks: null }),
    )

    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('error')
    expect(result.message).toBe('unparseable_response')
  })

  it('duplicate returned items normalizing to the same keyword → first item wins', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        okEnvelope({
          result: [
            {
              keyword: 'Nursing  Program',
              search_volume: 111,
              cpc: 1,
              competition_index: 5,
              monthly_searches: null,
              spell: null,
            },
            {
              keyword: 'nursing program',
              search_volume: 222,
              cpc: 2,
              competition_index: 10,
              monthly_searches: null,
              spell: null,
            },
          ],
        }),
      ),
    )

    const result = await fetchSearchVolume(['nursing program'], locale, {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const outcome = result.outcomes[0]
    if (outcome.outcome !== 'returned') throw new Error('expected returned')
    expect(outcome.searchVolume).toBe(111)
  })

  it('ok result carries the task-level cost verbatim', async () => {
    const fetchMock = vi.fn(async () => {
      const envelope = okEnvelope({ result: [] })
      ;(envelope.tasks[0] as Record<string, unknown>).cost = 0.27
      return jsonResponse(envelope)
    })
    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.cost).toBe(0.27)
  })

  it('ok result cost is null when task cost is absent', async () => {
    const fetchMock = vi.fn(async () => {
      const envelope = okEnvelope({ result: [] })
      delete (envelope.tasks[0] as Record<string, unknown>).cost
      return jsonResponse(envelope)
    })
    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.cost).toBeNull()
  })

  it('HTTP 401 → reason auth, generic message, no credential leak', async () => {
    const fetchMock = vi.fn(async () => textResponse('Unauthorized: bad login testlogin', 401))
    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('auth')
    expect(JSON.stringify(result)).not.toContain('testlogin')
    expect(JSON.stringify(result)).not.toContain('testpass123')
  })

  it('task status_code 40200 → reason payment', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(okEnvelope({ status_code: 40200, status_message: 'Payment required.', result: [] })),
    )
    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('payment')
  })

  it('task status_code 40202 → reason rate_limited', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(okEnvelope({ status_code: 40202, status_message: 'Too many requests.', result: [] })),
    )
    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('rate_limited')
  })

  it('other non-20000 status → reason error, message capped at 200 chars', async () => {
    const longMessage = 'x'.repeat(500)
    const fetchMock = vi.fn(async () =>
      jsonResponse(okEnvelope({ status_code: 50000, status_message: longMessage, result: [] })),
    )
    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('error')
    expect(result.message).toBeDefined()
    expect((result.message ?? '').length).toBeLessThanOrEqual(200)
  })

  it('non-JSON response body → unparseable_response', async () => {
    const fetchMock = vi.fn(async () => textResponse('<html>not json</html>', 200))
    const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('error')
    expect(result.message).toBe('unparseable_response')
  })

  it('timeout: abort-aware fetch mock rejects with AbortError when the signal fires, short injected timeoutMs', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }
      })
    })

    const result = await fetchSearchVolume(['a'], locale, {
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 20,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.reason).toBe('error')
    expect(result.message).toBe('timeout')
  })

  it('credentials never appear in any error result (auth/payment/rate_limited/error/unparseable)', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => textResponse('unauthorized', 401),
      async () => jsonResponse(okEnvelope({ status_code: 40200, result: [] })),
      async () => jsonResponse(okEnvelope({ status_code: 40202, result: [] })),
      async () => jsonResponse(okEnvelope({ status_code: 50000, status_message: 'boom', result: [] })),
      async () => textResponse('not json', 200),
    ]

    for (const makeResponse of cases) {
      const fetchMock = vi.fn(makeResponse)
      const result = await fetchSearchVolume(['a'], locale, { fetch: fetchMock as unknown as typeof fetch })
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain('testlogin')
      expect(JSON.stringify(result)).not.toContain('testpass123')
    }
  })
})
