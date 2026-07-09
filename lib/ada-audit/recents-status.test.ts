import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyAda = vi.fn()
const findManySite = vi.fn()
const findManyJob = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { findMany: (...a: unknown[]) => findManyAda(...a) },
    siteAudit: { findMany: (...a: unknown[]) => findManySite(...a) },
    job: { findMany: (...a: unknown[]) => findManyJob(...a) },
  },
}))

const { fetchRecentsStatus } = await import('./recents-status')
const { parseStatusRefs, RECENTS_STATUS_MAX_IDS } = await import('./recents-status-shared')

beforeEach(() => {
  findManyAda.mockReset().mockResolvedValue([])
  findManySite.mockReset().mockResolvedValue([])
  findManyJob.mockReset().mockResolvedValue([])
})

describe('parseStatusRefs', () => {
  it('parses type:id pairs, dropping malformed and sf-upload entries', () => {
    expect(parseStatusRefs('page:a1,site-ada:s1,site-seo:s2,sf-upload:x,garbage,:,page:')).toEqual([
      { type: 'page', id: 'a1' },
      { type: 'site-ada', id: 's1' },
      { type: 'site-seo', id: 's2' },
    ])
  })

  it('caps at RECENTS_STATUS_MAX_IDS and handles null', () => {
    const raw = Array.from({ length: 60 }, (_, i) => `page:a${i}`).join(',')
    expect(parseStatusRefs(raw)).toHaveLength(RECENTS_STATUS_MAX_IDS)
    expect(parseStatusRefs(null)).toEqual([])
  })
})

describe('fetchRecentsStatus', () => {
  it('returns compact items per type with run-based scores, progress fields, and no blob selects', async () => {
    findManyAda.mockResolvedValue([{
      id: 'a1', status: 'running', progress: 42, progressMessage: 'Running axe…',
      startedAt: new Date('2026-07-08T00:00:00Z'), completedAt: null, crawlRun: null,
    }])
    findManySite.mockResolvedValue([{
      id: 's1', seoOnly: false, status: 'running',
      pagesComplete: 3, pagesError: 1, pagesTotal: 40,
      startedAt: new Date('2026-07-08T00:00:00Z'), completedAt: null,
      crawlRuns: [],
    }])
    const items = await fetchRecentsStatus([
      { type: 'page', id: 'a1' }, { type: 'site-ada', id: 's1' },
    ])
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId.a1).toMatchObject({
      type: 'page', status: 'running', score: null, href: '/ada-audit/a1',
      inFlight: true, progressPct: 42, phaseLabel: 'Running axe…',
    })
    expect(byId.s1).toMatchObject({
      type: 'site-ada', status: 'running', href: '/ada-audit/site/s1',
      inFlight: true, pagesDone: 4, pagesTotal: 40,
    })
    // selects must not include the legacy blobs:
    expect(JSON.stringify(findManyAda.mock.calls[0][0])).not.toContain('result')
    expect(JSON.stringify(findManySite.mock.calls[0][0])).not.toContain('summary')
  })

  it('site-seo href flips to the run page when the run lands, and settles', async () => {
    findManySite.mockResolvedValue([{
      id: 'seo1', seoOnly: true, status: 'complete',
      pagesComplete: 4, pagesError: 0, pagesTotal: 4,
      startedAt: null, completedAt: new Date(),
      crawlRuns: [{ id: 'run9', score: 77, tool: 'seo-parser' }],
    }])
    const items = await fetchRecentsStatus([{ type: 'site-seo', id: 'seo1' }])
    expect(items[0]).toMatchObject({
      href: '/seo-audits/results/run/run9', score: 77, inFlight: false,
    })
    expect(findManyJob).not.toHaveBeenCalled()
  })

  it('site-seo complete without a run reports the live verifier phase', async () => {
    const staleCompleted = new Date(Date.now() - 60 * 60_000) // outside grace — job decides
    findManySite.mockResolvedValue([{
      id: 'seo2', seoOnly: true, status: 'complete',
      pagesComplete: 4, pagesError: 0, pagesTotal: 4,
      startedAt: null, completedAt: staleCompleted, crawlRuns: [],
    }])
    findManyJob.mockResolvedValue([{ groupKey: 'site-audit:seo2', progress: 60, progressMessage: 'Checking links…' }])
    const items = await fetchRecentsStatus([{ type: 'site-seo', id: 'seo2' }])
    expect(items[0]).toMatchObject({
      href: '/ada-audit/site/seo2', inFlight: true,
      progressPct: 60, phaseLabel: 'Checking links…',
    })
  })

  it('site-seo complete with neither run nor job stays inFlight inside the grace window, settles after', async () => {
    findManySite.mockResolvedValue([{
      id: 'seo3', seoOnly: true, status: 'complete',
      pagesComplete: 4, pagesError: 0, pagesTotal: 4,
      startedAt: null, completedAt: new Date(), crawlRuns: [],
    }])
    const inGrace = await fetchRecentsStatus([{ type: 'site-seo', id: 'seo3' }])
    expect(inGrace[0]).toMatchObject({ inFlight: true, phaseLabel: 'Verifying links…' })

    findManySite.mockResolvedValue([{
      id: 'seo3', seoOnly: true, status: 'complete',
      pagesComplete: 4, pagesError: 0, pagesTotal: 4,
      startedAt: null, completedAt: new Date(Date.now() - 60 * 60_000), crawlRuns: [],
    }])
    const pastGrace = await fetchRecentsStatus([{ type: 'site-seo', id: 'seo3' }])
    expect(pastGrace[0].inFlight).toBe(false)
  })

  it('omits deleted rows and returns [] for no refs without querying', async () => {
    const items = await fetchRecentsStatus([{ type: 'page', id: 'gone' }])
    expect(items).toEqual([])
    expect(await fetchRecentsStatus([])).toEqual([])
    expect(findManyAda).toHaveBeenCalledTimes(1) // only the first call queried
  })
})
