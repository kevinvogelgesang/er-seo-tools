// app/api/site-audit/id-route.queue-position.test.ts
// PR3: GET /api/site-audit/[id] must report queuePosition under the SAME
// shared total ordering as processNext/getQueueStatus (queue-order.ts) —
// previously it counted all older queued audits by createdAt alone.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './[id]/route'

const PREFIX = 'pr3-route-'

async function clearTestState() {
  const prospects = await prisma.prospect.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.siteAudit.deleteMany({
    where: {
      OR: [
        { domain: { startsWith: PREFIX } },
        { prospectId: { in: prospects.map((p) => p.id) } },
      ],
    },
  })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
  await prisma.siteAudit.updateMany({
    where: { status: { in: ['running', 'pdfs-running', 'lighthouse-running'] } },
    data: { status: 'error', error: 'neutralized by id-route.queue-position.test.ts' },
  })
  await prisma.siteAudit.updateMany({ where: { status: 'queued' }, data: { status: 'cancelled' } })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (id: string) => new NextRequest(`http://localhost:3000/api/site-audit/${id}`)

// beforeEach alone would leak this file's FINAL seeded queued rows into the
// shared dev DB for whatever test file runs next — clean on the way out too.
afterAll(clearTestState)

describe('GET /api/site-audit/[id] — queuePosition under the shared ordering (PR3)', () => {
  beforeEach(clearTestState)

  it('a newer prospect-owned queued audit is position 1; the older non-prospect audit is position 2', async () => {
    const older = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}older`, status: 'queued', wcagLevel: 'wcag21aa', createdAt: new Date(Date.now() - 60_000) },
    })
    const prospect = await prisma.prospect.create({ data: { name: 'RT', domain: `${PREFIX}rt.test` } })
    const pAudit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}prospect`, status: 'queued', wcagLevel: 'wcag21aa', prospectId: prospect.id },
    })

    const rp = await GET(req(pAudit.id), params(pAudit.id))
    expect(rp.status).toBe(200)
    expect((await rp.json()).queuePosition).toBe(1)

    const ro = await GET(req(older.id), params(older.id))
    expect((await ro.json()).queuePosition).toBe(2)
  })

  it('non-queued audits report queuePosition null (unchanged behavior)', async () => {
    const done = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}done`, status: 'error', error: 'x', wcagLevel: 'wcag21aa' },
    })
    const r = await GET(req(done.id), params(done.id))
    expect((await r.json()).queuePosition).toBeNull()
  })
})
