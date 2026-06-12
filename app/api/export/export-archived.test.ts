import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { runFindingKey } from '@/lib/findings/keys'
import { GET as formatGet } from '@/app/api/export/[sessionId]/[format]/route'
import { GET as claudeGet } from '@/app/api/export/[sessionId]/claude/route'
import { NextRequest } from 'next/server'

const DOMAIN = 'c5ex-archived.example.com'
const SESSION_ID = '55555555-5555-4555-8555-c5a000000007'

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.session.create({ data: { id: SESSION_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, totalUrls: 1, workflow: 'technical' } })
  await writeFindingsRun({
    run: { id: 'c5ex-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null, status: 'complete', score: 70, wcagLevel: null, pagesTotal: 1, startedAt: null, completedAt: new Date() },
    pages: [{ id: 'c5ex-p1', runId: 'c5ex-run-1', url: `https://${DOMAIN}/`, status: null, error: null, finalUrl: null, statusCode: null, title: 'T', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 0, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }],
    findings: [{ id: 'c5ex-f1', runId: 'c5ex-run-1', pageId: null, scope: 'run', type: 'broken_pages', severity: 'critical', url: null, count: 1, affectedComplete: null, affectedSource: null, detail: JSON.stringify({ description: 'Broken' }), dedupKey: runFindingKey('broken_pages') }],
    violations: [],
  })
  // session_archived requires the prune stamp (CrawlRunInput cannot set it)
  await prisma.crawlRun.update({ where: { id: 'c5ex-run-1' }, data: { archivePrunedAt: new Date() } })
})
afterAll(cleanup)

const params = (format: string) => ({ params: Promise.resolve({ sessionId: SESSION_ID, format }) })

describe('exports on an archived session', () => {
  it('markdown export serves degraded data with an archived note', async () => {
    const res = await formatGet(new NextRequest('http://test/x'), params('markdown'))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Archived session')
    expect(text).toContain('broken_pages')
  })

  it('json export serves the degraded object', async () => {
    const res = await formatGet(new NextRequest('http://test/x'), params('json'))
    expect(res.status).toBe(200)
    const body = JSON.parse(await res.text())
    expect(body.archived).toBe(true)
  })

  it('claude export refuses with 409 session_archived', async () => {
    const res = await claudeGet(new NextRequest('http://test/x'), { params: Promise.resolve({ sessionId: SESSION_ID }) })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('session_archived')
  })
})
