import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import { runFindingKey, pageFindingKey } from './keys'
import { loadArchivedSeoResult, buildSeoResultFromRun, loadRunSeoResult } from './seo-findings-fallback'
import type { FindingsBundle } from './types'

const DOMAIN = 'c5fb-fallback.example.com'
const SESSION_ID = 'c5fb-session-1'
const createdSessionIds: string[] = []

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({
    where: { id: { in: createdSessionIds.length ? createdSessionIds : [SESSION_ID] } },
  })
}

function bundle(runId: string, sessionId: string): FindingsBundle {
  const pageA = {
    id: `${runId}-p1`, runId, url: `https://${DOMAIN}/a`, status: null, error: null,
    finalUrl: null, statusCode: null as number | null, title: 'A', h1: 'A', metaDescription: null,
    wordCount: 100, crawlDepth: 1, indexable: true as boolean | null, score: null,
    passCount: null, incompleteCount: null, adaAuditId: null,
  }
  const pageB = { ...pageA, id: `${runId}-p2`, url: `https://${DOMAIN}/b`, wordCount: 300, crawlDepth: 3, indexable: false as boolean | null }
  return {
    run: {
      id: runId, tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: null,
      sessionId, siteAuditId: null, adaAuditId: null, status: 'complete', score: 72,
      wcagLevel: null, pagesTotal: 2, startedAt: new Date(), completedAt: new Date(),
    },
    pages: [pageA, pageB],
    findings: [
      { id: `${runId}-f1`, runId, pageId: null, scope: 'run', type: 'missing_title', severity: 'critical', url: null, count: 2, affectedComplete: true, affectedSource: 'derived-page-index', detail: JSON.stringify({ description: 'Pages missing titles' }), dedupKey: runFindingKey('missing_title') },
      { id: `${runId}-f2`, runId, pageId: pageA.id, scope: 'page', type: 'missing_title', severity: 'critical', url: pageA.url, count: 1, affectedComplete: true, affectedSource: 'derived-page-index', detail: null, dedupKey: pageFindingKey('missing_title', pageA.url) },
      { id: `${runId}-f3`, runId, pageId: null, scope: 'run', type: 'thin_content', severity: 'warning', url: null, count: 1, affectedComplete: null, affectedSource: null, detail: JSON.stringify({ description: 'Thin pages' }), dedupKey: runFindingKey('thin_content') },
    ],
    violations: [],
  }
}

beforeAll(async () => {
  createdSessionIds.push(SESSION_ID, 'c5fb-session-2', 'c5fb-session-3')
  await cleanup()
})
afterAll(async () => { await cleanup() })

describe('loadArchivedSeoResult', () => {
  it('rebuilds a safe degraded AggregatedResult from findings rows', async () => {
    await prisma.session.create({ data: { id: SESSION_ID, files: '["internal_all.csv"]', status: 'complete', result: null, siteName: DOMAIN, totalUrls: 2, workflow: 'technical' } })
    await writeFindingsRun(bundle('c5fb-run-1', SESSION_ID))

    const r = await loadArchivedSeoResult(SESSION_ID)
    expect(r).not.toBeNull()
    expect(r!.archived).toBe(true)
    // crawl_summary reconstruction
    expect(r!.crawl_summary.total_urls).toBe(2)
    expect(r!.crawl_summary.indexable_urls).toBe(1)
    expect(r!.crawl_summary.non_indexable_urls).toBe(1)
    expect(r!.crawl_summary.avg_word_count).toBe(200)
    expect(r!.crawl_summary.max_crawl_depth).toBe(3)
    // status-code counts UNAVAILABLE (all statusCode null) — never 0
    expect(r!.crawl_summary.ok_responses).toBeUndefined()
    expect(r!.crawl_summary.client_errors).toBeUndefined()
    // issues from run-scope rows, urls from page-scope rows
    expect(r!.issues.critical).toHaveLength(1)
    expect(r!.issues.critical[0]).toMatchObject({ type: 'missing_title', count: 2, description: 'Pages missing titles', affectedUrlRefsComplete: true })
    expect(r!.issues.critical[0].urls).toEqual([`https://${DOMAIN}/a`])
    expect(r!.issues.warnings).toHaveLength(1)
    expect(r!.issues.notices).toEqual([])
    // depth distribution
    expect(r!.site_structure.crawl_depth_distribution).toEqual({ 1: 1, 3: 1 })
    // safe shape: arrays/objects the UI assumes
    expect(r!.recommendations).toEqual([])
    expect(r!.metadata.parsers_used).toEqual([])
    expect(r!.metadata.files_processed).toEqual(['internal_all.csv'])
    expect(r!.metadata.health_score).toBe(72)
    expect(r!.metadata.site_name).toBe(DOMAIN)
    expect(r!.resources).toEqual({})
    expect(r!.technical_seo).toEqual({})
    expect(r!.performance).toEqual({})
    // never fabricated
    expect(r!.completeness).toBeUndefined()
    expect(r!.keyword_signals).toBeUndefined()
    expect(r!.duplicate_content).toBeUndefined()
  })

  it('computes status buckets opportunistically when statusCode is present', async () => {
    const id = 'c5fb-session-2'
    await prisma.session.create({ data: { id, files: '[]', status: 'complete', result: null, workflow: 'technical' } })
    const b = bundle('c5fb-run-2', id)
    b.pages[0].statusCode = 200
    b.pages[1].statusCode = 404
    await writeFindingsRun(b)
    const r = await loadArchivedSeoResult(id)
    expect(r!.crawl_summary.ok_responses).toBe(1)
    expect(r!.crawl_summary.client_errors).toBe(1)
    expect(r!.crawl_summary.redirects).toBe(0)
    expect(r!.crawl_summary.server_errors).toBe(0)
  })

  it('returns null when the session has no CrawlRun', async () => {
    const id = 'c5fb-session-3'
    await prisma.session.create({ data: { id, files: '[]', status: 'complete', result: null, workflow: 'technical' } })
    expect(await loadArchivedSeoResult(id)).toBeNull()
  })
})

describe('buildSeoResultFromRun', () => {
  it('omits indexable counts when every page indexable is null', () => {
    const b = bundle('c5fb-pure-1', 'unused')
    const pages = b.pages.map((p) => ({ url: p.url, statusCode: p.statusCode, wordCount: p.wordCount, crawlDepth: p.crawlDepth, indexable: null }))
    const r = buildSeoResultFromRun(
      { pagesTotal: 2, score: 50, domain: DOMAIN },
      pages,
      [],
      { siteName: null, files: [] },
    )
    expect(r.crawl_summary.indexable_urls).toBeUndefined()
    expect(r.crawl_summary.non_indexable_urls).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────────
// loadRunSeoResult — Task 6 (live-scan / run-native results)
// ────────────────────────────────────────────────────────────────────

const LIVE_DOMAIN = 'c5fb-livescan.example.com'

async function cleanupLiveScan() {
  await prisma.crawlRun.deleteMany({ where: { domain: LIVE_DOMAIN } })
}

describe('loadRunSeoResult', () => {
  beforeAll(async () => { await cleanupLiveScan() })
  afterAll(async () => { await cleanupLiveScan() })

  it('returns a non-null AggregatedResult with score from CrawlRun.score for a live-scan seo-parser run', async () => {
    // Live-scan runs have no origin FK (sessionId/siteAuditId/adaAuditId all null),
    // so we cannot use writeFindingsRun() — seed directly via Prisma.
    const runId = 'c5fb-live-run-1'
    const pageAId = 'c5fb-live-page-1'
    const pageBId = 'c5fb-live-page-2'
    const urlA = `https://${LIVE_DOMAIN}/a`
    const urlB = `https://${LIVE_DOMAIN}/b`

    await prisma.$transaction([
      prisma.crawlRun.create({
        data: {
          id: runId, tool: 'seo-parser', source: 'live-scan', domain: LIVE_DOMAIN,
          status: 'complete', score: 88, pagesTotal: 2,
          startedAt: new Date(), completedAt: new Date(),
        },
      }),
      prisma.crawlPage.createMany({
        data: [
          { id: pageAId, runId, url: urlA, wordCount: 100, crawlDepth: 1, indexable: true },
          { id: pageBId, runId, url: urlB, wordCount: 300, crawlDepth: 3, indexable: false },
        ],
      }),
      prisma.finding.createMany({
        data: [
          {
            id: `${runId}-f1`, runId, pageId: null, scope: 'run', type: 'missing_title',
            severity: 'critical', url: null, count: 2, affectedComplete: true,
            affectedSource: 'derived-page-index', detail: JSON.stringify({ description: 'Pages missing titles' }),
            dedupKey: runFindingKey('missing_title'),
          },
          {
            id: `${runId}-f2`, runId, pageId: pageAId, scope: 'page', type: 'missing_title',
            severity: 'critical', url: urlA, count: 1, affectedComplete: true,
            affectedSource: 'derived-page-index', detail: null,
            dedupKey: pageFindingKey('missing_title', urlA),
          },
        ],
      }),
    ])

    const r = await loadRunSeoResult(runId)
    expect(r).not.toBeNull()
    expect(r!.archived).toBe(true)
    expect(r!.metadata.health_score).toBe(88)
    expect(r!.crawl_summary.total_urls).toBe(2)
    expect(r!.issues.critical).toHaveLength(1)
    expect(r!.issues.critical[0].type).toBe('missing_title')
  })

  it('returns null for a non-seo-parser run id', async () => {
    const runId = 'c5fb-live-run-ada'
    await prisma.crawlRun.create({
      data: {
        id: runId, tool: 'ada-audit', source: 'site-audit', domain: LIVE_DOMAIN,
        status: 'complete', score: 75, pagesTotal: 0,
      },
    })
    const r = await loadRunSeoResult(runId)
    expect(r).toBeNull()
  })

  it('returns null for an unknown run id', async () => {
    const r = await loadRunSeoResult('c5fb-does-not-exist')
    expect(r).toBeNull()
  })
})
