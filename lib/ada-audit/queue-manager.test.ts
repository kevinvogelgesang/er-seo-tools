// lib/ada-audit/queue-manager.test.ts
//
// Phase 3: the promoter is stateless (no mutex) — one-at-a-time is enforced
// by the discover handler's claim. These tests cover the promoter's enqueue
// behavior, generic transient recovery (running included), and failSiteAudit.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { processNext, recoverQueue, resetStaleAudits, failSiteAudit } = await import('./queue-manager')

const PREFIX = 'qm3-test-'

async function clearTestState() {
  // groupKeys are site-audit:<id> and payloads carry IDs, not domains —
  // resolve the test sites' IDs first, then delete their jobs by groupKey.
  const sites = await prisma.siteAudit.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  if (sites.length > 0) {
    await prisma.job.deleteMany({
      where: { groupKey: { in: sites.map((s) => `site-audit:${s.id}`) } },
    })
  }
  await prisma.pdfAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.auditBatch.updateMany({ where: { closedAt: null }, data: { closedAt: new Date() } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  // The promoter bails whenever ANY audit is transient — neutralize stray
  // transient rows left behind by other test files in the shared dev DB.
  await prisma.siteAudit.updateMany({
    where: { status: { in: ['running', 'pdfs-running', 'lighthouse-running'] } },
    data: { status: 'error', error: 'neutralized by queue-manager.test.ts (one-active invariant)' },
  })
  // Stray queued audits from other files would out-rank ours in the
  // oldest-queued pick — neutralize those too.
  await prisma.siteAudit.updateMany({
    where: { status: 'queued' },
    data: { status: 'cancelled' },
  })
}

async function seedSite(name: string, status: string, extra: Record<string, unknown> = {}) {
  return prisma.siteAudit.create({
    data: { domain: `${PREFIX}${name}`, status, wcagLevel: 'wcag21aa', ...extra },
  })
}

function discoverJobsFor(siteAuditId: string) {
  return prisma.job.findMany({
    where: { type: 'site-audit-discover', groupKey: `site-audit:${siteAuditId}` },
  })
}

describe('processNext — stateless promoter', () => {
  beforeEach(async () => {
    vi.mocked(finalizeSiteAudit).mockClear()
    vi.mocked(finalizeSiteAudit).mockResolvedValue(undefined)
    await clearTestState()
  })

  it('enqueues a discover job for the oldest queued audit when idle', async () => {
    const older = await seedSite('older', 'queued', { createdAt: new Date(Date.now() - 60_000) })
    await seedSite('newer', 'queued')
    await processNext()
    expect(await discoverJobsFor(older.id)).toHaveLength(1)
  })

  it('double-call dedups to one discover job', async () => {
    const site = await seedSite('dedup', 'queued')
    await processNext()
    await processNext()
    expect(await discoverJobsFor(site.id)).toHaveLength(1)
  })

  it.each(['running', 'pdfs-running', 'lighthouse-running'])(
    'does not promote while an audit is %s',
    async (status) => {
      await seedSite(`active-${status}`, status)
      const queued = await seedSite(`queued-${status}`, 'queued')
      await processNext()
      expect(await discoverJobsFor(queued.id)).toHaveLength(0)
    },
  )

  it('no-ops when nothing is queued', async () => {
    await expect(processNext()).resolves.toBeUndefined()
  })
})

describe('recovery — generic transient treatment', () => {
  beforeEach(async () => {
    vi.mocked(finalizeSiteAudit).mockClear()
    vi.mocked(finalizeSiteAudit).mockResolvedValue(undefined)
    await clearTestState()
  })

  it.each(['running', 'pdfs-running', 'lighthouse-running'])(
    'recoverQueue resumes a %s parent with outstanding durable jobs',
    async (status) => {
      const site = await seedSite(`resume-${status}`, status, { discoveredUrls: '[]' })
      await prisma.job.create({
        data: { type: 'site-audit-page', payload: '{}', status: 'queued', groupKey: `site-audit:${site.id}` },
      })
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe(status)
    },
  )

  it('recoverQueue gives a drained running parent one finalize attempt before failing', async () => {
    const site = await seedSite('finalize-first', 'running', { discoveredUrls: '[]' })
    // finalize mock flips it to complete — simulates a drained audit.
    vi.mocked(finalizeSiteAudit).mockImplementationOnce(async (id: string) => {
      await prisma.siteAudit.update({ where: { id }, data: { status: 'complete' } })
    })
    await recoverQueue()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('complete')
  })

  it('recoverQueue fails a running parent with zero jobs that will not finalize, cascading children', async () => {
    const site = await seedSite('dead-running', 'running', { discoveredUrls: '[]', pagesTotal: 2 })
    await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}dead-running/a`, status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}dead-running/b`, status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await recoverQueue()
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.status).toBe('error')
    const children = await prisma.adaAudit.findMany({ where: { siteAuditId: site.id } })
    expect(children.every((c) => c.status === 'error')).toBe(true)
  })

  it('resetStaleAudits skips fresh transient audits and fails stale drained ones', async () => {
    const fresh = await seedSite('fresh', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    const stale = await seedSite('stale', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    const backdated = Date.now() - 10 * 60 * 1000
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${backdated} WHERE "id" = ${stale.id}`
    await resetStaleAudits()
    expect((await prisma.siteAudit.findUnique({ where: { id: fresh.id } }))?.status).toBe('running')
    expect((await prisma.siteAudit.findUnique({ where: { id: stale.id } }))?.status).toBe('error')
  })

  it('resetStaleAudits resumes a stale parent that still has active jobs (backoff window)', async () => {
    const site = await seedSite('backoff', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    await prisma.job.create({
      data: {
        type: 'site-audit-page', payload: '{}', status: 'queued',
        runAfter: new Date(Date.now() + 10 * 60 * 1000), // backoff-delayed
        groupKey: `site-audit:${site.id}`,
      },
    })
    const backdated = Date.now() - 10 * 60 * 1000
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${backdated} WHERE "id" = ${site.id}`
    await resetStaleAudits()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('running')
  })

  it('recoverQueue re-queues legacy pending audits', async () => {
    const site = await seedSite('legacy', 'pending')
    await recoverQueue()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('queued')
  })
})

describe('failSiteAudit', () => {
  beforeEach(async () => {
    vi.mocked(finalizeSiteAudit).mockClear()
    await clearTestState()
  })

  it('flips parent, cascades children + pdfs, cancels queued group jobs', async () => {
    const site = await seedSite('fail', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}fail/a`, status: 'running', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await prisma.pdfAudit.create({
      data: { url: `https://${PREFIX}fail/a.pdf`, status: 'pending', siteAuditId: site.id },
    })
    const job = await prisma.job.create({
      data: { type: 'site-audit-page', payload: '{}', status: 'queued', groupKey: `site-audit:${site.id}` },
    })
    await failSiteAudit(site.id, 'test failure')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('error')
    expect((await prisma.adaAudit.findUnique({ where: { id: child.id } }))?.status).toBe('error')
    expect((await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id } }))?.status).toBe('error')
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
  })

  it('never clobbers a terminal parent — and does not cascade its children or jobs', async () => {
    const site = await seedSite('terminal', 'complete')
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}terminal/a`, status: 'complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    const job = await prisma.job.create({
      data: { type: 'site-audit-page', payload: '{}', status: 'queued', groupKey: `site-audit:${site.id}` },
    })
    await failSiteAudit(site.id, 'should not land')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('complete')
    expect((await prisma.adaAudit.findUnique({ where: { id: child.id } }))?.status).toBe('complete')
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('queued')
  })
})
