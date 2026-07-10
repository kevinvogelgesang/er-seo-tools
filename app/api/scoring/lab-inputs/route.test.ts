// app/api/scoring/lab-inputs/route.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { GET } from './route'

const DOMAIN = 'lab-inputs.test'
const get = (qs: string) => GET(new Request(`http://x/api/scoring/lab-inputs${qs}`) as never)

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
}

describe('GET /api/scoring/lab-inputs', () => {
  let adaRunId: string
  let emptyAdaRunId: string
  let seoV2RunId: string
  let seoV1RunId: string
  let partialRunId: string
  let malformedSnapshotRunId: string

  beforeAll(async () => {
    await clearTestState()

    // ada-audit run with one scored page + one page-scope Finding+Violation
    const adaRun = await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'page-audit', domain: DOMAIN, status: 'complete', pagesTotal: 1 },
    })
    const adaPage = await prisma.crawlPage.create({
      data: { runId: adaRun.id, url: `https://${DOMAIN}/${randomUUID()}`, score: 90, incompleteCount: 0 },
    })
    const findingId = randomUUID()
    await prisma.finding.create({
      data: {
        id: findingId, runId: adaRun.id, pageId: adaPage.id, scope: 'page', type: 'color-contrast',
        severity: 'critical', dedupKey: 'lab-k1',
      },
    })
    await prisma.violation.create({
      data: {
        findingId, runId: adaRun.id, pageId: adaPage.id, ruleId: 'color-contrast',
        impact: 'critical', wcagTags: JSON.stringify(['wcag2a']),
      },
    })
    adaRunId = adaRun.id

    // ada-audit run with zero scored pages
    const emptyAdaRun = await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'page-audit', domain: DOMAIN, status: 'complete', pagesTotal: 1 },
    })
    await prisma.crawlPage.create({
      data: { runId: emptyAdaRun.id, url: `https://${DOMAIN}/${randomUUID()}`, score: null, incompleteCount: null },
    })
    emptyAdaRunId = emptyAdaRun.id

    // seo-parser run with a v2 live-seo breakdown carrying a valid snapshot
    const seoV2Run = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 5,
        score: 80,
        scoreBreakdown: JSON.stringify({
          version: 2, scorer: 'live-seo', score: 80, weightsHash: 'abc123',
          factors: [],
          inputsSnapshot: {
            source: 'live', attempted: 5, observed: 5, indexableScored: 5, pagesError: 0,
            missingTitle: 0, missingMeta: 0, missingH1: 0, thin: 0, pagesWithSchema: 2,
            linkVerification: null,
          },
        }),
      },
    })
    seoV2RunId = seoV2Run.id

    // seo-parser run scored before C19 — no v2 breakdown
    const seoV1Run = await prisma.crawlRun.create({
      data: { tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, status: 'complete', pagesTotal: 5, score: 70 },
    })
    seoV1RunId = seoV1Run.id

    // a non-complete run
    const partialRun = await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'page-audit', domain: DOMAIN, status: 'partial', pagesTotal: 1 },
    })
    partialRunId = partialRun.id

    // a v2 breakdown whose inputsSnapshot is malformed (non-finite field)
    const malformedRun = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1,
        scoreBreakdown: JSON.stringify({
          version: 2, scorer: 'live-seo',
          inputsSnapshot: { source: 'live', attempted: 'nope' },
        }),
      },
    })
    malformedSnapshotRunId = malformedRun.id
  })

  afterAll(clearTestState)

  it('?list=1 returns recent complete runs, newest first, capped at 25', async () => {
    const res = await get('?list=1')
    expect(res.status).toBe(200)
    const { runs } = await res.json()
    expect(Array.isArray(runs)).toBe(true)
    expect(runs.length).toBeLessThanOrEqual(25)
  })

  it('400s without runId or list', async () => {
    expect((await get('')).status).toBe(400)
  })

  it('404s on an unknown runId', async () => {
    expect((await get('?runId=nope')).status).toBe(404)
  })

  it('returns kind ada with rebuilt inputs for an ada-audit run with scored pages', async () => {
    const res = await get(`?runId=${adaRunId}`)
    const body = await res.json()
    expect(body.kind).toBe('ada')
    expect(body.inputs.pagesAudited).toBe(1)
    expect(body.current.tool).toBe('ada-audit')
  })

  it('returns kind unavailable for an ada run with zero scored pages', async () => {
    const res = await get(`?runId=${emptyAdaRunId}`)
    expect((await res.json()).kind).toBe('unavailable')
  })

  it('returns kind seo with the v2 inputsSnapshot for a post-C19 seo run', async () => {
    const res = await get(`?runId=${seoV2RunId}`)
    const body = await res.json()
    expect(body.kind).toBe('seo')
    expect(body.scorer).toBe('live-seo')
    expect(body.snapshot.source).toBe('live')
  })

  it('returns kind unavailable ("scored before C19") for a v1/blank-breakdown seo run', async () => {
    const res = await get(`?runId=${seoV1RunId}`)
    const body = await res.json()
    expect(body.kind).toBe('unavailable')
    expect(body.reason).toMatch(/before C19/)
  })

  it('returns kind unavailable for a non-complete run (Codex #4)', async () => {
    const res = await get(`?runId=${partialRunId}`)
    expect((await res.json()).kind).toBe('unavailable')
  })

  it('returns kind unavailable for a v2 breakdown whose snapshot is malformed (Codex #4)', async () => {
    const res = await get(`?runId=${malformedSnapshotRunId}`)
    expect((await res.json()).kind).toBe('unavailable')
  })
})
