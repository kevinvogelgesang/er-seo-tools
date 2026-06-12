import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { POST } from '@/app/api/diff/route'
import { NextRequest } from 'next/server'

const FRESH_ID = '44444444-4444-4444-8444-c5a000000005'
const ARCHIVED_ID = '44444444-4444-4444-8444-c5a000000006'
const DOMAIN = 'c5df-diff.example.com'
const BLOB = JSON.stringify({ crawl_summary: { total_urls: 1 }, issues: { critical: [], warnings: [], notices: [] }, metadata: {} })

async function cleanup() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: { in: [FRESH_ID, ARCHIVED_ID] } } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.session.create({ data: { id: FRESH_ID, files: '[]', status: 'complete', result: BLOB, workflow: 'technical' } })
  await prisma.session.create({ data: { id: ARCHIVED_ID, files: '[]', status: 'complete', result: null, workflow: 'technical' } })
  // session_archived requires the prune stamp
  await prisma.crawlRun.create({ data: { id: 'c5df-run-1', tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, sessionId: ARCHIVED_ID, status: 'complete', pagesTotal: 0, archivePrunedAt: new Date() } })
})
afterAll(cleanup)

function req(a: string, b: string) {
  return new NextRequest('http://test/api/diff', { method: 'POST', body: JSON.stringify({ sessionAId: a, sessionBId: b }) })
}

describe('POST /api/diff with an archived side', () => {
  it('refuses with 409 session_archived', async () => {
    const res = await POST(req(FRESH_ID, ARCHIVED_ID))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('session_archived')
  })

  it('still diffs two fresh sessions', async () => {
    const res = await POST(req(FRESH_ID, FRESH_ID))
    expect(res.status).toBe(200)
  })
})
