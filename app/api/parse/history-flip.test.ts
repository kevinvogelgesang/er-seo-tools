import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { GET } from '@/app/api/parse/history/route'

const DOMAIN = 'c5hi-history.example.com'
const A2_ID = '33333333-3333-4333-8333-c5a000000003'
const PRE_A2_ID = '33333333-3333-4333-8333-c5a000000004'

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: { in: [A2_ID, PRE_A2_ID] } } })
}

beforeAll(async () => {
  await cleanup()
  // A2 session: blob pruned, CrawlRun.score is the source
  await prisma.session.create({ data: { id: A2_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, totalUrls: 7, workflow: 'technical' } })
  await prisma.crawlRun.create({ data: { id: 'c5hi-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, sessionId: A2_ID, status: 'complete', score: 91, pagesTotal: 7, completedAt: new Date() } })
  // pre-A2-shaped session: no CrawlRun, blob carries the score
  await prisma.session.create({ data: { id: PRE_A2_ID, files: '[]', status: 'complete', siteName: DOMAIN, workflow: 'technical', result: JSON.stringify({ crawl_summary: { total_urls: 3 }, metadata: { health_score: 55 } }) } })
})
afterAll(cleanup)

describe('GET /api/parse/history', () => {
  it('serves healthScore from CrawlRun.score and urlCount from Session.totalUrls', async () => {
    const res = await GET()
    const body = await res.json() // the route returns a bare array
    const a2 = body.find((s: { id: string }) => s.id === A2_ID)
    expect(a2.healthScore).toBe(91)
    expect(a2.urlCount).toBe(7)
  })

  it('keeps the blob fallback for pre-A2 sessions', async () => {
    const res = await GET()
    const body = await res.json()
    const legacy = body.find((s: { id: string }) => s.id === PRE_A2_ID)
    expect(legacy.healthScore).toBe(55)
    expect(legacy.urlCount).toBe(3)
  })
})
