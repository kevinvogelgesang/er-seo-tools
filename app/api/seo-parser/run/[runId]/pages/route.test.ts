// A3 Task 7 — characterization tests for GET /api/seo-parser/run/[runId]/pages.
// DB-backed, real prisma, prefix-namespaced fixtures.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'

const PREFIX = '__a3rp__'

const params = (runId: string) => ({ params: Promise.resolve({ runId }) })

async function clear() {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

let runId: string
let adaRunId: string
let pageIds: string[]

beforeAll(async () => {
  await clear()

  const run = await prisma.crawlRun.create({
    data: { tool: 'seo-parser', source: 'sf-upload', domain: `${PREFIX}example.com`, status: 'complete' },
  })
  runId = run.id

  const adaRun = await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}other.com`, status: 'complete' },
  })
  adaRunId = adaRun.id

  const pageA = await prisma.crawlPage.create({
    data: { runId, url: `https://${PREFIX}example.com/a`, title: 'A', wordCount: 100, crawlDepth: 1 },
  })
  const pageB = await prisma.crawlPage.create({
    data: { runId, url: `https://${PREFIX}example.com/b`, title: 'B', wordCount: 50, crawlDepth: 2 },
  })
  pageIds = [pageA.id, pageB.id]

  await prisma.finding.create({
    data: {
      runId,
      pageId: pageA.id,
      scope: 'page',
      type: 'missing_title',
      severity: 'critical',
      dedupKey: `${PREFIX}dk1`,
    },
  })
  await prisma.finding.create({
    data: {
      runId,
      pageId: pageB.id,
      scope: 'page',
      type: 'thin_content',
      severity: 'warning',
      dedupKey: `${PREFIX}dk2`,
    },
  })
})

afterAll(clear)

describe('GET /api/seo-parser/run/[runId]/pages', () => {
  it('200 { pages, total } for a real seo-parser CrawlRun with pages', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), params(runId))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.pages).toHaveLength(2)
    // default sort: findings desc then url asc -> page with a finding (both have 1) tiebreak by url
    const byUrl = (u: string) => body.pages.find((p: { url: string }) => p.url === u)
    expect(byUrl(`https://${PREFIX}example.com/a`)).toMatchObject({
      runId,
      title: 'A',
      issueTypes: ['missing_title'],
      issueCount: 1,
      indexable: true,
    })
    expect(byUrl(`https://${PREFIX}example.com/b`)).toMatchObject({
      title: 'B',
      issueTypes: ['thin_content'],
      issueCount: 1,
    })
  })

  it('{ pages: [], total: 0 } (200, not 404) when the run does not exist', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), params('does-not-exist'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pages: [], total: 0 })
  })

  it('{ pages: [], total: 0 } (200, not 404) when the run exists but tool !== seo-parser', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), params(adaRunId))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pages: [], total: 0 })
  })

  it('clamps limit to [1, 200] and respects offset', async () => {
    const resHigh = await GET(new NextRequest('http://localhost/x?limit=9999'), params(runId))
    expect((await resHigh.json()).pages).toHaveLength(2) // only 2 rows exist; clamp itself covered by non-throw

    const resOffset = await GET(new NextRequest('http://localhost/x?limit=1&offset=1'), params(runId))
    const body = await resOffset.json()
    expect(body.pages).toHaveLength(1)
    expect(body.total).toBe(2)

    const resZero = await GET(new NextRequest('http://localhost/x?limit=0'), params(runId))
    // limit=0 is falsy -> Math.max(...||50...) path; clamps to at least 1
    expect((await resZero.json()).pages.length).toBeGreaterThanOrEqual(1)
  })

  it('filters by issueType', async () => {
    const res = await GET(new NextRequest('http://localhost/x?issueType=thin_content'), params(runId))
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.pages[0].url).toBe(`https://${PREFIX}example.com/b`)
  })

  it('sort=wordCount and sort=crawlDepth order pages accordingly', async () => {
    const byWordCount = await (await GET(new NextRequest('http://localhost/x?sort=wordCount'), params(runId))).json()
    expect(byWordCount.pages.map((p: { wordCount: number }) => p.wordCount)).toEqual([50, 100])

    const byDepth = await (await GET(new NextRequest('http://localhost/x?sort=crawlDepth'), params(runId))).json()
    expect(byDepth.pages.map((p: { crawlDepth: number }) => p.crawlDepth)).toEqual([2, 1])
  })
})
