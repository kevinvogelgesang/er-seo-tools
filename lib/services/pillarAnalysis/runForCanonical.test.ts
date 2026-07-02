// lib/services/pillarAnalysis/runForCanonical.test.ts
//
// TDD for Task 11:
// (a) runForCanonical produces a PillarAnalysis with crawlRunId set + sessionId null
// (b) buildNarrativePayload works without a session (uses domain as siteName fallback)
// (c) /api/pillar-analysis/by-analysis/[analysisId] returns the poll shape

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { runForCanonical, PillarAnalysisRunError } from './runFromSession'
import { buildNarrativePayload } from './narrativePayload'

// ---------------------------------------------------------------------------
// DB fixture helpers
// ---------------------------------------------------------------------------

const DOMAIN = 'rfc-test-' + randomUUID().slice(0, 8) + '.example'
const PREFIX = 'test-rfc-'

async function clearTestState() {
  await prisma.pillarAnalysis.deleteMany({ where: { domain: DOMAIN } })
  await prisma.crawlPage.deleteMany({ where: { run: { domain: DOMAIN } } })
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeEach(clearTestState)
afterAll(clearTestState)

async function makeClient(): Promise<number> {
  const c = await prisma.client.create({
    data: { name: PREFIX + randomUUID().slice(0, 8), domains: JSON.stringify([DOMAIN]) },
  })
  return c.id
}

/** Seed a live-scan seoIntent CrawlRun with realistic page facts */
async function makeLiveScanRunWithPages(
  clientId: number,
): Promise<{ runId: string }> {
  const sa = await prisma.siteAudit.create({
    data: { domain: DOMAIN, status: 'complete', clientId, completedAt: new Date() },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'seo-parser',
      source: 'live-scan',
      seoIntent: true,
      domain: DOMAIN,
      clientId,
      siteAuditId: sa.id,
      status: 'complete',
      score: 72,
      pagesTotal: 5,
      completedAt: new Date(),
      createdAt: new Date(),
    },
  })

  // Program/location pages (anchors for pillar analysis)
  const programPage = {
    runId: run.id,
    url: `https://${DOMAIN}/programs/nursing`,
    title: 'Nursing Program',
    h1: 'Bachelor of Science in Nursing',
    metaDescription: 'Our BSN program prepares you for a nursing career.',
    wordCount: 800,
    crawlDepth: 1,
    inlinks: 25,
    outlinks: 12,
    indexable: true,
    statusCode: 200,
  }

  // Blog posts that should cluster under the program
  const blog1 = {
    runId: run.id,
    url: `https://${DOMAIN}/blog/become-rn`,
    title: 'How to Become an RN',
    h1: 'Become an RN',
    metaDescription: 'Guide to nursing.',
    wordCount: 1500,
    crawlDepth: 3,
    inlinks: 8,
    outlinks: 5,
    indexable: true,
    statusCode: 200,
  }

  const blog2 = {
    runId: run.id,
    url: `https://${DOMAIN}/blog/rn-salary`,
    title: 'RN Salary Guide',
    h1: 'Nursing Salary',
    metaDescription: 'How much RNs earn.',
    wordCount: 1100,
    crawlDepth: 3,
    inlinks: 4,
    outlinks: 5,
    indexable: true,
    statusCode: 200,
  }

  const blog3 = {
    runId: run.id,
    url: `https://${DOMAIN}/blog/nursing-school-tips`,
    title: 'Nursing School Tips',
    h1: 'Tips for Nursing Students',
    metaDescription: 'Survive nursing school.',
    wordCount: 900,
    crawlDepth: 3,
    inlinks: 2,
    outlinks: 5,
    indexable: true,
    statusCode: 200,
  }

  const homePage = {
    runId: run.id,
    url: `https://${DOMAIN}/`,
    title: 'Home',
    h1: 'Welcome',
    metaDescription: 'School home page.',
    wordCount: 300,
    crawlDepth: 0,
    inlinks: 50,
    outlinks: 20,
    indexable: true,
    statusCode: 200,
  }

  await prisma.$transaction([
    prisma.crawlPage.create({ data: programPage }),
    prisma.crawlPage.create({ data: blog1 }),
    prisma.crawlPage.create({ data: blog2 }),
    prisma.crawlPage.create({ data: blog3 }),
    prisma.crawlPage.create({ data: homePage }),
  ])

  return { runId: run.id }
}

// ---------------------------------------------------------------------------
// (a) runForCanonical: DB-level integration — persists PillarAnalysis keyed
//     by crawlRunId with sessionId null
// ---------------------------------------------------------------------------

describe('runForCanonical', () => {
  it('throws no_canonical_facts when no qualifying run exists', async () => {
    const clientId = await makeClient()
    await expect(runForCanonical({ clientId, domain: DOMAIN })).rejects.toThrow(
      PillarAnalysisRunError,
    )
    try {
      await runForCanonical({ clientId, domain: DOMAIN })
    } catch (err) {
      if (err instanceof PillarAnalysisRunError) {
        expect(err.code).toBe('no_canonical_facts')
        expect(err.status).toBe(422)
      }
    }
  })

  it(
    'creates a PillarAnalysis with crawlRunId set, sessionId null, status complete',
    async () => {
      const clientId = await makeClient()
      const { runId } = await makeLiveScanRunWithPages(clientId)

      const result = await runForCanonical({ clientId, domain: DOMAIN })

      expect(result.status).toBe('complete')
      expect(typeof result.id).toBe('string')

      const pa = await prisma.pillarAnalysis.findUnique({ where: { id: result.id } })
      expect(pa).not.toBeNull()
      expect(pa!.sessionId).toBeNull()
      expect(pa!.crawlRunId).toBe(runId)
      expect(pa!.clientId).toBe(clientId)
      expect(pa!.domain).toBe(DOMAIN)
      expect(pa!.status).toBe('complete')
      expect(pa!.score).not.toBeNull()
      expect(pa!.urlVerdicts).not.toBeNull()
    },
    120_000, // embedding model can be slow
  )

  it(
    'is idempotent: second call returns the existing complete row',
    async () => {
      const clientId = await makeClient()
      await makeLiveScanRunWithPages(clientId)

      const first = await runForCanonical({ clientId, domain: DOMAIN })
      const second = await runForCanonical({ clientId, domain: DOMAIN })

      expect(second.id).toBe(first.id)
      expect(second.status).toBe('complete')
    },
    180_000,
  )
})

// ---------------------------------------------------------------------------
// (b) buildNarrativePayload: works without a session, falls back to domain
// ---------------------------------------------------------------------------

describe('buildNarrativePayload domain fallback', () => {
  it('returns domain as siteName when session is absent', () => {
    const row = {
      id: 'pa_test_live',
      sessionId: null,
      crawlRunId: 'run_abc',
      domain: 'www.testschool.example',
      status: 'complete',
      error: null,
      score: 7,
      subscores: '{"contentVolume":7,"topicalConcentration":6,"organicFootprint":5,"internalLinkGap":4,"programPageClarity":8,"backlinkDistribution":5}',
      subscorePresence: null,
      subscoreContext: null,
      dataCompleteness: 0.4,
      hubRecommendation: '{"primary":"hybrid","alternates":[],"reasoning":[]}',
      pillarTopics: '[]',
      urlVerdicts: '[]',
      createdAt: new Date('2026-06-30T10:00:00Z'),
      updatedAt: new Date('2026-06-30T10:00:00Z'),
      session: null,
    }

    const payload = buildNarrativePayload(row)
    expect(payload.siteName).toBe('www.testschool.example')
    expect(payload.sessionId).toBeNull()
    expect(payload.crawlRunId).toBe('run_abc')
  })

  it('prefers session.siteName over domain when session is present', () => {
    const row = {
      id: 'pa_test_session',
      sessionId: 'sess_xyz',
      crawlRunId: null,
      domain: 'www.testschool.example',
      status: 'complete',
      error: null,
      score: 7,
      subscores: '{"contentVolume":7,"topicalConcentration":6,"organicFootprint":5,"internalLinkGap":4,"programPageClarity":8,"backlinkDistribution":5}',
      subscorePresence: null,
      subscoreContext: null,
      dataCompleteness: 0.4,
      hubRecommendation: '{"primary":"hybrid","alternates":[],"reasoning":[]}',
      pillarTopics: '[]',
      urlVerdicts: '[]',
      createdAt: new Date('2026-06-30T10:00:00Z'),
      updatedAt: new Date('2026-06-30T10:00:00Z'),
      session: { siteName: 'www.real-site-name.example' },
    }

    const payload = buildNarrativePayload(row)
    expect(payload.siteName).toBe('www.real-site-name.example')
  })

  it('returns null siteName when both session and domain are absent', () => {
    const row = {
      id: 'pa_test_null',
      sessionId: null,
      crawlRunId: null,
      domain: null,
      status: 'complete',
      error: null,
      score: 7,
      subscores: '{"contentVolume":7,"topicalConcentration":6,"organicFootprint":5,"internalLinkGap":4,"programPageClarity":8,"backlinkDistribution":5}',
      subscorePresence: null,
      subscoreContext: null,
      dataCompleteness: 0.4,
      hubRecommendation: null,
      pillarTopics: '[]',
      urlVerdicts: '[]',
      createdAt: new Date('2026-06-30T10:00:00Z'),
      updatedAt: new Date('2026-06-30T10:00:00Z'),
      session: null,
    }

    const payload = buildNarrativePayload(row)
    expect(payload.siteName).toBeNull()
    expect(payload.crawlRunId).toBeNull()
  })
})
