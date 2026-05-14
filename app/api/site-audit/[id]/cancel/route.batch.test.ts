// Integration-flavoured test: real prisma + real closeBatchIfDrained, no mocks.
// Verifies that cancelling the last queued row in an open batch actually closes
// the batch.
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { prisma } = await import('@/lib/db')
const { POST } = await import('./route')

async function clearTestState() {
  // Test-DB isolation: close any lingering open batches so each test can
  // create one without hitting the partial unique index.
  await prisma.auditBatch.updateMany({
    where: { closedAt: null },
    data: { closedAt: new Date() },
  })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'cancel-flow-' } } })
  await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__cancel_flow__' } } })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = () =>
  new NextRequest('http://localhost/api/site-audit/x/cancel', { method: 'POST' })

describe('POST /api/site-audit/[id]/cancel — batch closure', () => {
  beforeEach(clearTestState)

  it('closes the batch when the cancelled row is the only in-flight member', async () => {
    const batch = await prisma.auditBatch.create({
      data: { label: '__cancel_flow__solo' },
    })
    const audit = await prisma.siteAudit.create({
      data: {
        domain: 'cancel-flow-solo.example',
        status: 'queued',
        wcagLevel: 'wcag21aa',
        batchId: batch.id,
      },
    })

    const res = await POST(req(), ctx(audit.id))
    expect(res.status).toBe(200)

    const refreshedAudit = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(refreshedAudit?.status).toBe('cancelled')

    const refreshedBatch = await prisma.auditBatch.findUnique({ where: { id: batch.id } })
    expect(refreshedBatch?.closedAt).toBeTruthy()
  })

  it('leaves the batch open when other members are still in flight', async () => {
    const batch = await prisma.auditBatch.create({
      data: { label: '__cancel_flow__siblings' },
    })
    const toCancel = await prisma.siteAudit.create({
      data: {
        domain: 'cancel-flow-cancelme.example',
        status: 'queued',
        wcagLevel: 'wcag21aa',
        batchId: batch.id,
      },
    })
    await prisma.siteAudit.create({
      data: {
        domain: 'cancel-flow-sibling.example',
        status: 'running',
        wcagLevel: 'wcag21aa',
        batchId: batch.id,
      },
    })

    const res = await POST(req(), ctx(toCancel.id))
    expect(res.status).toBe(200)

    const refreshedBatch = await prisma.auditBatch.findUnique({ where: { id: batch.id } })
    expect(refreshedBatch?.closedAt).toBeNull()
  })
})
