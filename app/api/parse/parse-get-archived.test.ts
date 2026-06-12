import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { runFindingKey } from '@/lib/findings/keys'
import { GET } from '@/app/api/parse/[sessionId]/route'
import { NextRequest } from 'next/server'

const DOMAIN = 'c5pg-archived.example.com'
const SESSION_ID = '11111111-1111-4111-8111-c5a000000001'

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.session.create({ data: { id: SESSION_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, totalUrls: 1, workflow: 'technical' } })
  await writeFindingsRun({
    run: { id: 'c5pg-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null, status: 'complete', score: 64, wcagLevel: null, pagesTotal: 1, startedAt: null, completedAt: new Date() },
    pages: [{ id: 'c5pg-p1', runId: 'c5pg-run-1', url: `https://${DOMAIN}/`, status: null, error: null, finalUrl: null, statusCode: null, title: 'T', h1: null, metaDescription: null, wordCount: 50, crawlDepth: 0, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }],
    findings: [{ id: 'c5pg-f1', runId: 'c5pg-run-1', pageId: null, scope: 'run', type: 'thin_content', severity: 'warning', url: null, count: 1, affectedComplete: null, affectedSource: null, detail: JSON.stringify({ description: 'Thin' }), dedupKey: runFindingKey('thin_content') }],
    violations: [],
  })
})
afterAll(cleanup)

describe('GET /api/parse/[sessionId] on an archived session', () => {
  it('serves the degraded result with archived marker', async () => {
    const res = await GET(new NextRequest('http://test/api/parse/x'), { params: Promise.resolve({ sessionId: SESSION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('complete')
    expect(body.result.archived).toBe(true)
    expect(body.result.metadata.health_score).toBe(64)
    expect(body.result.issues.warnings).toHaveLength(1)
  })
})
