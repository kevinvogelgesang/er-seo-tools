import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { runFindingKey } from '@/lib/findings/keys'
import { GET as shareGet } from '@/app/api/share/[token]/route'
import { POST as shareMint } from '@/app/api/share/route'
import { NextRequest } from 'next/server'

const DOMAIN = 'c5sh-archived.example.com'
const SESSION_ID = '22222222-2222-4222-8222-c5a000000002'
const TOKEN = 'c5sh-token-archived-0000000000000000'

async function cleanup() {
  await prisma.shareLink.deleteMany({ where: { sessionId: SESSION_ID } })
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.session.create({ data: { id: SESSION_ID, files: '[]', status: 'complete', result: null, siteName: DOMAIN, workflow: 'technical' } })
  await writeFindingsRun({
    run: { id: 'c5sh-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: null, sessionId: SESSION_ID, siteAuditId: null, adaAuditId: null, status: 'complete', score: 80, wcagLevel: null, pagesTotal: 1, startedAt: null, completedAt: new Date() },
    pages: [{ id: 'c5sh-p1', runId: 'c5sh-run-1', url: `https://${DOMAIN}/`, status: null, error: null, finalUrl: null, statusCode: null, title: 'T', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 0, indexable: true, score: null, passCount: null, incompleteCount: null, adaAuditId: null }],
    findings: [{ id: 'c5sh-f1', runId: 'c5sh-run-1', pageId: null, scope: 'run', type: 'missing_h1', severity: 'warning', url: null, count: 1, affectedComplete: null, affectedSource: null, detail: JSON.stringify({ description: 'Missing H1' }), dedupKey: runFindingKey('missing_h1') }],
    violations: [],
  })
  await prisma.shareLink.create({ data: { sessionId: SESSION_ID, token: TOKEN, expiresAt: new Date(Date.now() + 86400_000) } })
})
afterAll(cleanup)

describe('share surfaces on an archived session', () => {
  it('GET /api/share/[token] serves the degraded result', async () => {
    const res = await shareGet(new NextRequest('http://test/api/share/x'), { params: Promise.resolve({ token: TOKEN }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.archived).toBe(true)
    expect(body.result.issues.warnings).toHaveLength(1)
  })

  it('POST /api/share mints for an archived session (findings run exists)', async () => {
    const res = await shareMint(new NextRequest('http://test/api/share', { method: 'POST', body: JSON.stringify({ sessionId: SESSION_ID }) }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeTruthy()
    await prisma.shareLink.deleteMany({ where: { token: body.token } })
  })
})
