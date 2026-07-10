import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyAda = vi.fn()
const findManySite = vi.fn()
const findManySession = vi.fn()
const findManyRun = vi.fn()
const findManyJob = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { findMany: (...a: unknown[]) => findManyAda(...a) },
    siteAudit: { findMany: (...a: unknown[]) => findManySite(...a) },
    session: { findMany: (...a: unknown[]) => findManySession(...a) },
    crawlRun: { findMany: (...a: unknown[]) => findManyRun(...a) },
    job: { findMany: (...a: unknown[]) => findManyJob(...a) },
  },
}))

const { fetchAllRecents, encodeRecentsCursor, decodeRecentsCursor } = await import('./recents-query')

beforeEach(() => {
  findManyAda.mockReset().mockResolvedValue([])
  findManySite.mockReset().mockResolvedValue([])
  findManySession.mockReset().mockResolvedValue([])
  findManyRun.mockReset().mockResolvedValue([])
  findManyJob.mockReset().mockResolvedValue([])
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

  // C17: server-computed inFlight flag.
  it('marks transient rows inFlight and terminal rows not', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a1', createdAt: new Date('2026-07-08T00:00:00Z'), url: 'https://x.com',
      status: 'running', wcagLevel: 'wcag21aa', result: null,
      startedAt: null, completedAt: null, client: null, requestedBy: null,
    }])
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [] : [{
        id: 's1', createdAt: new Date('2026-07-08T00:00:01Z'), domain: 'a.com',
        status: 'lighthouse-running', wcagLevel: 'wcag21aa', summary: null,
        startedAt: null, completedAt: null, client: null, requestedBy: null, crawlRuns: [],
      }, {
        id: 's2', createdAt: new Date('2026-07-08T00:00:02Z'), domain: 'b.com',
        status: 'complete', wcagLevel: 'wcag21aa', summary: null,
        startedAt: null, completedAt: null, client: null, requestedBy: null, crawlRuns: [],
      }]
    })
    const { items } = await fetchAllRecents({ limit: 10 })
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId.a1.inFlight).toBe(true)
    expect(byId.s1.inFlight).toBe(true)
    expect(byId.s2.inFlight).toBe(false)
  })

  it('site-seo complete without a run is inFlight while a verify job is queued/running', async () => {
    const staleCompleted = new Date(Date.now() - 60 * 60_000) // 1h ago — outside grace
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [{
        id: 'seo1', createdAt: new Date('2026-07-08T00:00:00Z'), domain: 'c.com',
        status: 'complete', startedAt: null, completedAt: staleCompleted,
        client: null, requestedBy: null, crawlRuns: [],
      }, {
        id: 'seo2', createdAt: new Date('2026-07-08T00:00:01Z'), domain: 'd.com',
        status: 'complete', startedAt: null, completedAt: staleCompleted,
        client: null, requestedBy: null, crawlRuns: [],
      }] : []
    })
    findManyJob.mockResolvedValue([{ groupKey: 'site-audit:seo1' }])
    const { items } = await fetchAllRecents({ limit: 10 })
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId.seo1.inFlight).toBe(true)    // verifier alive → live row
    expect(byId.seo2.inFlight).toBe(false)   // dead verifier, past grace → settled
    expect(findManyJob).toHaveBeenCalledTimes(1)  // one batched lookup
  })

  it('site-seo complete without a run or job stays inFlight within the enqueue grace window', async () => {
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [{
        id: 'seo3', createdAt: new Date(), domain: 'e.com',
        status: 'complete', startedAt: null, completedAt: new Date(), // just now — inside grace
        client: null, requestedBy: null, crawlRuns: [],
      }] : []
    })
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items[0].inFlight).toBe(true)
  })

  it('site-seo complete WITH a run is not inFlight and links the run page', async () => {
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [{
        id: 'seo4', createdAt: new Date('2026-07-08T00:00:00Z'), domain: 'f.com',
        status: 'complete', startedAt: null, completedAt: new Date(),
        client: null, requestedBy: null, crawlRuns: [{ id: 'run3', score: 88 }],
      }] : []
    })
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items[0].inFlight).toBe(false)
    expect(items[0].href).toBe('/seo-audits/results/run/run3')
    expect(findManyJob).not.toHaveBeenCalled()  // no candidates → no job query
  })

  it('sessions and orphan runs are never inFlight', async () => {
    findManySession.mockResolvedValue([{
      id: 'sess1', createdAt: new Date('2026-07-08T00:00:00Z'), status: 'pending',
      siteName: 'x', files: '[]', requestedBy: null, client: null, crawlRun: null,
    }])
    findManyRun.mockResolvedValue([{
      id: 'orph1', createdAt: new Date('2026-07-08T00:00:01Z'), status: 'complete',
      domain: 'g.com', score: null, client: null,
    }])
    const { items } = await fetchAllRecents({ limit: 10 })
    expect(items.every((i) => i.inFlight === false)).toBe(true)
  })

  // C14: additive badge — SiteAudit-origin rows carry prospectLinked.
  it('marks SiteAudit-origin rows prospectLinked from prospectId, both seoOnly branches', async () => {
    findManySite.mockImplementation((q: { where: { AND: Array<Record<string, unknown>> } }) => {
      const seoOnly = q.where.AND.some((c) => (c as { seoOnly?: boolean }).seoOnly === true)
      return seoOnly ? [{
        id: 'seo5', createdAt: new Date('2026-07-08T00:00:03Z'), domain: 'h.com',
        status: 'complete', startedAt: null, completedAt: new Date(),
        client: null, requestedBy: null, crawlRuns: [], prospectId: 7,
      }] : [{
        id: 'ada5', createdAt: new Date('2026-07-08T00:00:04Z'), domain: 'i.com',
        status: 'complete', wcagLevel: 'wcag21aa', summary: null,
        startedAt: null, completedAt: null, client: null, requestedBy: null,
        crawlRuns: [], prospectId: null,
      }]
    })
    const { items } = await fetchAllRecents({ limit: 10 })
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId.seo5.prospectLinked).toBe(true)
    expect(byId.ada5.prospectLinked).toBe(false)
  })

  it('non-SiteAudit-origin rows leave prospectLinked undefined', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a9', createdAt: new Date('2026-07-08T00:00:00Z'), url: 'https://x.com',
      status: 'complete', wcagLevel: 'wcag21aa', result: null,
      startedAt: null, completedAt: null, client: null, requestedBy: null,
    }])
    findManyRun.mockResolvedValue([{
      id: 'orph9', createdAt: new Date('2026-07-08T00:00:01Z'), status: 'complete',
      domain: 'j.com', score: null, client: null,
    }])
    const { items } = await fetchAllRecents({ limit: 10 })
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId.a9.prospectLinked).toBeUndefined()
    expect(byId.orph9.prospectLinked).toBeUndefined()
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
