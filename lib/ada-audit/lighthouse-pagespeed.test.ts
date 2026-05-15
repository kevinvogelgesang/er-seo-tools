import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runPageSpeedInsights } from './lighthouse-pagespeed'

const ORIG = { ...process.env }

// Minimal LHR payload matching what extractSummary expects.
const MINIMAL_LHR = {
  categories: {
    performance:      { score: 0.5,  auditRefs: [] },
    accessibility:    { score: 0.9,  auditRefs: [] },
    'best-practices': { score: 0.8,  auditRefs: [] },
  },
  categoryGroups: {},
  audits: {
    'largest-contentful-paint': { numericValue: 2400, score: 0.7 },
    'cumulative-layout-shift':  { numericValue: 0.08, score: 0.9 },
    'total-blocking-time':      { numericValue: 150, score: 0.85 },
  },
}

function mockFetch(response: { ok: boolean; status?: number; body?: unknown; jsonThrows?: boolean }) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => {
      if (response.jsonThrows) throw new SyntaxError('Unexpected token < in JSON at position 0')
      return response.body
    },
    text: async () => typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
  }) as unknown as Response)
}

beforeEach(() => {
  delete process.env.PAGESPEED_API_KEY
  delete process.env.PAGESPEED_TIMEOUT_MS
})
afterEach(() => {
  process.env = { ...ORIG }
  vi.unstubAllGlobals()
})

describe('runPageSpeedInsights', () => {
  it('returns summary when PSI returns a valid lighthouseResult', async () => {
    const fetchMock = mockFetch({ ok: true, body: { lighthouseResult: MINIMAL_LHR } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.error).toBeUndefined()
    expect(result.summary?.scores.performance).toBe(50)
    expect(result.summary?.scores.accessibility).toBe(90)
    expect(result.summary?.scores.bestPractices).toBe(80)
  })

  it('requests all three categories with strategy=DESKTOP', async () => {
    const fetchMock = mockFetch({ ok: true, body: { lighthouseResult: MINIMAL_LHR } })
    vi.stubGlobal('fetch', fetchMock)

    await runPageSpeedInsights('https://example.com/')

    const callArg = String(fetchMock.mock.calls[0][0])
    expect(callArg).toContain('strategy=DESKTOP')
    expect(callArg).toContain('category=PERFORMANCE')
    expect(callArg).toContain('category=ACCESSIBILITY')
    expect(callArg).toContain('category=BEST_PRACTICES')
  })

  it('includes API key when PAGESPEED_API_KEY is set', async () => {
    process.env.PAGESPEED_API_KEY = 'test-key-123'
    const fetchMock = mockFetch({ ok: true, body: { lighthouseResult: MINIMAL_LHR } })
    vi.stubGlobal('fetch', fetchMock)

    await runPageSpeedInsights('https://example.com/')

    const callArg = String(fetchMock.mock.calls[0][0])
    expect(callArg).toContain('key=test-key-123')
  })

  it('omits key param when PAGESPEED_API_KEY is unset', async () => {
    const fetchMock = mockFetch({ ok: true, body: { lighthouseResult: MINIMAL_LHR } })
    vi.stubGlobal('fetch', fetchMock)

    await runPageSpeedInsights('https://example.com/')

    const callArg = String(fetchMock.mock.calls[0][0])
    expect(callArg).not.toMatch(/[?&]key=/)
  })

  it('surfaces HTTP 429 as a rate-limit error', async () => {
    const fetchMock = mockFetch({ ok: false, status: 429, body: { error: { message: 'quota' } } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/rate limit/i)
  })

  it('surfaces HTTP 400 as an unfetchable-URL error', async () => {
    const fetchMock = mockFetch({ ok: false, status: 400, body: { error: { message: 'could not fetch' } } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/private')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/private|blocked|unfetch|HTTP 400/i)
  })

  it('surfaces HTTP 5xx as a server error', async () => {
    const fetchMock = mockFetch({ ok: false, status: 503, body: '' })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/server error|HTTP 5/i)
  })

  it('surfaces a malformed JSON body as a malformed-response error', async () => {
    const fetchMock = mockFetch({ ok: true, jsonThrows: true })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/malformed/i)
  })

  it('surfaces missing lighthouseResult in the body', async () => {
    const fetchMock = mockFetch({ ok: true, body: { somethingElse: true } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/no lighthouseResult/i)
  })

  it('surfaces an AbortError as a timeout', async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/timed out/i)
  })
})
