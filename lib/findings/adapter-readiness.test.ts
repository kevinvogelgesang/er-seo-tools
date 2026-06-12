// Adapter-readiness pin (C5 § 2.3): a non-SF bundle (source 'live-scan') is a
// first-class citizen of the ingestion contract — it writes through
// writeFindingsRun() and renders through the findings-based report path.
// Also pins the DOCUMENTED LIMITATION the C6 migration must lift.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import { loadArchivedSeoResult } from './seo-findings-fallback'
import type { FindingsBundle } from './types'

const DOMAIN = 'c5ar-livescan.example.com'
const SESSION_ID = '66666666-6666-4666-8666-c5a000000008'
const SITE_AUDIT_DOMAIN = 'c5ar-siteaudit.example.com'

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: { in: [DOMAIN, SITE_AUDIT_DOMAIN] } } })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
  await prisma.siteAudit.deleteMany({ where: { domain: SITE_AUDIT_DOMAIN } })
}

beforeAll(async () => { await cleanup() })
afterAll(cleanup)

function liveScanBundle(
  runId: string,
  origin: { sessionId?: string; siteAuditId?: string },
  tool: 'seo-parser' | 'ada-audit' = 'seo-parser',
): FindingsBundle {
  const url = normalizeFindingUrl(`https://${origin.siteAuditId ? SITE_AUDIT_DOMAIN : DOMAIN}/page`)
  const pageId = `${runId}-p1`
  return {
    run: { id: runId, tool, source: 'live-scan', domain: origin.siteAuditId ? SITE_AUDIT_DOMAIN : DOMAIN, clientId: null, sessionId: origin.sessionId ?? null, siteAuditId: origin.siteAuditId ?? null, adaAuditId: null, status: 'complete', score: 88, wcagLevel: null, pagesTotal: 1, startedAt: new Date(), completedAt: new Date() },
    pages: [{ id: pageId, runId, url, status: null, error: null, finalUrl: null, statusCode: 200, title: 'Live', h1: 'Live', metaDescription: 'd', wordCount: 420, crawlDepth: null, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }],
    findings: [
      { id: `${runId}-f1`, runId, pageId: null, scope: 'run', type: 'missing_meta_description', severity: 'warning', url: null, count: 1, affectedComplete: true, affectedSource: 'parser-complete', detail: JSON.stringify({ description: 'Missing meta' }), dedupKey: runFindingKey('missing_meta_description') },
      { id: `${runId}-f2`, runId, pageId, scope: 'page', type: 'missing_meta_description', severity: 'warning', url, count: 1, affectedComplete: true, affectedSource: 'parser-complete', detail: null, dedupKey: pageFindingKey('missing_meta_description', url) },
    ],
    violations: [],
  }
}

describe('adapter readiness: a live-scan bundle is a first-class citizen', () => {
  it('writes via writeFindingsRun and renders through the findings-based report path', async () => {
    await prisma.session.create({ data: { id: SESSION_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, workflow: 'technical' } })
    await writeFindingsRun(liveScanBundle('c5ar-run-1', { sessionId: SESSION_ID }))

    const run = await prisma.crawlRun.findUnique({ where: { sessionId: SESSION_ID } })
    expect(run?.source).toBe('live-scan')

    const report = await loadArchivedSeoResult(SESSION_ID)
    expect(report).not.toBeNull()
    expect(report!.metadata.health_score).toBe(88)
    expect(report!.issues.warnings[0]).toMatchObject({ type: 'missing_meta_description', count: 1 })
    // live pages carry statusCode → status buckets are computed
    expect(report!.crawl_summary.ok_responses).toBe(1)
  })

  it('DOCUMENTED LIMITATION: a second run on the same SiteAudit origin replaces the first (C6 must migrate to @@unique([siteAuditId, tool]) before live-scan dual-write)', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: SITE_AUDIT_DOMAIN, status: 'complete' } })
    await writeFindingsRun(liveScanBundle('c5ar-run-2', { siteAuditId: sa.id }, 'ada-audit'))
    await writeFindingsRun(liveScanBundle('c5ar-run-3', { siteAuditId: sa.id }, 'seo-parser'))
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: sa.id } })
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe('c5ar-run-3') // delete-and-recreate by origin clobbered the ada run
  })
})
