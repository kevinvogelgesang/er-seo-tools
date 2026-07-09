import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyAda = vi.fn()
const findManySite = vi.fn()
const findManySession = vi.fn()
const findManyRun = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { findMany: (...a: unknown[]) => findManyAda(...a) },
    siteAudit: { findMany: (...a: unknown[]) => findManySite(...a) },
    session: { findMany: (...a: unknown[]) => findManySession(...a) },
    crawlRun: { findMany: (...a: unknown[]) => findManyRun(...a) },
  },
}))

const { fetchAllRecents, encodeRecentsCursor, decodeRecentsCursor } = await import('./recents-query')

beforeEach(() => {
  findManyAda.mockReset().mockResolvedValue([])
  findManySite.mockReset().mockResolvedValue([])
  findManySession.mockReset().mockResolvedValue([])
  findManyRun.mockReset().mockResolvedValue([])
})

describe('fetchAllRecents', () => {
  it('returns ISO strings and derives page score from result blob', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a1', createdAt: new Date('2026-05-13T00:00:00Z'),
      url: 'https://x.com', status: 'complete', wcagLevel: 'wcag21aa',
      result: JSON.stringify({ violations: [] }),
      startedAt: new Date('2026-05-13T00:00:00Z'),
      completedAt: new Date('2026-05-13T00:01:00Z'),
      client: { name: 'Acme' }, requestedBy: 'Alice',
    }])
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items).toHaveLength(1)
    expect(typeof items[0].createdAt).toBe('string')
    expect(items[0].createdAt).toBe('2026-05-13T00:00:00.000Z')
    expect(items[0].type).toBe('page')
    expect(items[0].label).toBe('https://x.com')
    expect(items[0].href).toBe('/ada-audit/a1')
    expect(items[0].score).toBe(100)
    expect(items[0].requestedBy).toBe('Alice')
    expect(items[0].deletable).toBe(false)
  })

  it('leaves score null for incomplete rows', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a2', createdAt: new Date('2026-05-13T00:00:00Z'),
      url: 'https://y.com', status: 'running', wcagLevel: 'wcag21aa',
      result: null, startedAt: null, completedAt: null,
      client: null, requestedBy: null,
    }])
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items[0].score).toBeNull()
    expect(items[0].startedAt).toBeNull()
  })

  it('never reads the Session.result blob — session score is CrawlRun.score or null', async () => {
    findManySession.mockResolvedValue([{
      id: 's1', createdAt: new Date('2026-05-13T00:00:00Z'), status: 'complete',
      siteName: null, files: JSON.stringify(['internal_all.csv']),
      requestedBy: null, client: null, crawlRun: null,
    }])
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items[0].type).toBe('sf-upload')
    expect(items[0].label).toBe('internal_all.csv')
    expect(items[0].score).toBeNull() // pre-A2 session: no blob parse in the list path
    const select = findManySession.mock.calls[0][0].select
    expect(select).not.toHaveProperty('result')
  })

  it('cursor codec round-trips and rejects malformed input', () => {
    const c = { createdAt: 1751990400000, type: 'site-ada' as const, id: 'abc' }
    expect(decodeRecentsCursor(encodeRecentsCursor(c))).toEqual(c)
    expect(decodeRecentsCursor(null)).toBeNull()
    expect(decodeRecentsCursor('')).toBeNull()
    expect(decodeRecentsCursor('notanumber~site-ada~x')).toBeNull()
    expect(decodeRecentsCursor('123~bogus-type~x')).toBeNull()
    expect(decodeRecentsCursor('123~site-ada')).toBeNull()
    // Codex plan-fix 4: timestamps outside the valid Date range must be
    // rejected — an Invalid Date must never reach Prisma from a public param.
    expect(decodeRecentsCursor('1e300~site-ada~x')).toBeNull()
    expect(decodeRecentsCursor(`${9e15}~site-ada~x`)).toBeNull()
    expect(decodeRecentsCursor('123.5~site-ada~x')).toBeNull()
  })
})
