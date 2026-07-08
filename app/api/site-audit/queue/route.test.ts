// A3 Task 7 — characterization test for GET /api/site-audit/queue (no-arg GET).
// Runs against the real dev DB (shared across test files) — the shared-DB
// state (active/queued audits) is not controlled here, so this only pins the
// response SHAPE from getQueueStatus(), not specific row values.
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { GET } from './route'

describe('GET /api/site-audit/queue', () => {
  it('200 with the getQueueStatus() shape', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body).toHaveProperty('active')
    expect(body).toHaveProperty('queued')
    expect(body).toHaveProperty('batch')
    expect(Array.isArray(body.queued)).toBe(true)

    if (body.active !== null) {
      expect(typeof body.active).toBe('object')
      expect(body.active).toHaveProperty('id')
      expect(body.active).toHaveProperty('domain')
      expect(body.active).toHaveProperty('status')
      expect(body.active).toHaveProperty('pagesTotal')
    }

    for (const q of body.queued) {
      expect(q).toHaveProperty('id')
      expect(q).toHaveProperty('domain')
      expect(q).toHaveProperty('position')
      expect(q).toHaveProperty('clientId')
      expect(q).toHaveProperty('seoOnly')
    }

    if (body.batch !== null) {
      expect(body.batch).toHaveProperty('id')
      expect(body.batch).toHaveProperty('startedAt')
      expect(body.batch).toHaveProperty('label')
    }
  })

  // C11: a queued seoOnly audit is a legitimately in-flight audit and must
  // still surface in the shared queue view, tagged seoOnly so consumers route
  // it to /seo-parser instead of /ada-audit/site/[id].
  const CLEANUP_DOMAIN = 'c11-queue-seoonly.example'
  afterAll(async () => {
    await prisma.siteAudit.deleteMany({ where: { domain: CLEANUP_DOMAIN } })
  })

  it('C11: threads seoOnly on a queued audit', async () => {
    const created = await prisma.siteAudit.create({
      data: { domain: CLEANUP_DOMAIN, status: 'queued', wcagLevel: 'wcag21aa', seoOnly: true },
    })
    const res = await GET()
    const body = await res.json()
    const mine = body.queued.find((q: { id: string }) => q.id === created.id)
    expect(mine).toBeDefined()
    expect(mine.seoOnly).toBe(true)
  })
})
