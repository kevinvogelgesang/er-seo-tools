import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { GET } from '@/app/api/parse/history/route'

const DOMAIN_SF = 't7-sf-session.example.com'
const DOMAIN_LIVE = 't7-live-run.example.com'
const SESSION_ID = '77777777-7777-4777-8777-t7000000001a'
const SESSION_RUN_ID = 't7-sf-crawlrun-001'
const LIVE_RUN_ID = 't7-live-crawlrun-001'
const LIVE_RUN_NO_INTENT_ID = 't7-live-crawlrun-no-intent'

async function cleanup() {
  await prisma.crawlRun.deleteMany({
    where: { id: { in: [SESSION_RUN_ID, LIVE_RUN_ID, LIVE_RUN_NO_INTENT_ID] } },
  })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

beforeAll(async () => {
  await cleanup()

  // SF session + its crawlRun (sf-upload source, seoIntent false by default)
  await prisma.session.create({
    data: {
      id: SESSION_ID,
      files: '["crawl.csv"]',
      status: 'complete',
      siteName: DOMAIN_SF,
      totalUrls: 42,
      workflow: 'technical',
      result: null,
    },
  })
  await prisma.crawlRun.create({
    data: {
      id: SESSION_RUN_ID,
      tool: 'seo-parser',
      source: 'sf-upload',
      seoIntent: false,
      domain: DOMAIN_SF,
      sessionId: SESSION_ID,
      status: 'complete',
      score: 78,
      pagesTotal: 42,
      completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
    },
  })

  // Live-scan run (seoIntent true) — newer than the session
  await prisma.crawlRun.create({
    data: {
      id: LIVE_RUN_ID,
      tool: 'seo-parser',
      source: 'live-scan',
      seoIntent: true,
      domain: DOMAIN_LIVE,
      sessionId: null,
      status: 'complete',
      score: 65,
      pagesTotal: 30,
      completedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1h ago (newer)
    },
  })

  // Live-scan run with seoIntent=false — must NOT appear in history
  await prisma.crawlRun.create({
    data: {
      id: LIVE_RUN_NO_INTENT_ID,
      tool: 'seo-parser',
      source: 'live-scan',
      seoIntent: false,
      domain: 't7-excluded.example.com',
      sessionId: null,
      status: 'complete',
      score: 99,
      pagesTotal: 100,
      completedAt: new Date(),
    },
  })
})

afterAll(cleanup)

describe('GET /api/parse/history — merged source-labeled history', () => {
  it('includes both the SF session (kind=session) and the live-scan run (kind=run)', async () => {
    const res = await GET()
    const body = await res.json() as Array<{ id: string; kind: string; source: string; status: string; healthScore?: number; urlCount?: number }>

    const sessionEntry = body.find((e) => e.id === SESSION_ID)
    const runEntry = body.find((e) => e.id === LIVE_RUN_ID)

    expect(sessionEntry).toBeDefined()
    expect(sessionEntry?.kind).toBe('session')
    expect(sessionEntry?.source).toBe('sf-upload')
    expect(sessionEntry?.healthScore).toBe(78)
    expect(sessionEntry?.urlCount).toBe(42)

    expect(runEntry).toBeDefined()
    expect(runEntry?.kind).toBe('run')
    expect(runEntry?.source).toBe('live-scan')
    expect(runEntry?.healthScore).toBe(65)
    expect(runEntry?.urlCount).toBe(30)
    expect(runEntry?.status).toBe('complete')
  })

  it('excludes live-scan runs where seoIntent=false', async () => {
    const res = await GET()
    const body = await res.json() as Array<{ id: string }>
    const excluded = body.find((e) => e.id === LIVE_RUN_NO_INTENT_ID)
    expect(excluded).toBeUndefined()
  })

  it('returns entries sorted newest-first', async () => {
    const res = await GET()
    const body = await res.json() as Array<{ id: string; createdAt: string }>

    const relevant = body.filter((e) => [SESSION_ID, LIVE_RUN_ID].includes(e.id))
    expect(relevant).toHaveLength(2)

    // live-scan run is 1h ago, session is 2h ago → live run should appear first
    expect(relevant[0].id).toBe(LIVE_RUN_ID)
    expect(relevant[1].id).toBe(SESSION_ID)
  })
})
