// lib/ada-audit/queue-manager.test.ts
//
// Phase 3: the promoter is stateless (no mutex) — one-at-a-time is enforced
// by the discover handler's claim. These tests cover the promoter's enqueue
// behavior, generic transient recovery (running included), and failSiteAudit.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

// Mocked so the standalone sweep can't flip other test files' stray
// standalone rows in the shared dev DB; the wiring tests assert call-through.
vi.mock('@/lib/ada-audit/standalone-recovery', () => ({
  recoverStandaloneAudits: vi.fn(async () => undefined),
}))
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))

const { prisma } = await import('@/lib/db')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { recoverStandaloneAudits } = await import('./standalone-recovery')
const { publishInvalidation } = await import('@/lib/events/bus')
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
    // D7 notify-email jobs carry NO site-audit group key — clean them by dedupKey.
    await prisma.job.deleteMany({
      where: { type: 'notify-email', dedupKey: { in: sites.flatMap((s) => [`notify-email:${s.id}:complete`, `notify-email:${s.id}:failed`]) } },
    })
  }
  await prisma.pdfAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.auditBatch.updateMany({ where: { closedAt: null }, data: { closedAt: new Date() } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.prospect.deleteMany({ where: { domain: { startsWith: PREFIX } } })
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
    vi.mocked(publishInvalidation).mockClear()
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
    // A5: the flip emits site-audit + recents, and the final queue after close.
    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).toContain(`site-audit:${site.id}`)
    expect(calls).toContain('recents')
    expect(calls).toContain('queue')
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
    // A5: a lost fence (parent already terminal) emits nothing.
    expect(publishInvalidation).not.toHaveBeenCalled()
  })

  it('D7: enqueues a failed notify job when the audit opted in', async () => {
    const site = await seedSite('fail-notify', 'running', { discoveredUrls: '[]', pagesTotal: 1, notifyEmail: 'r@example.com' })
    await failSiteAudit(site.id, 'boom')
    const notifyJob = await prisma.job.findFirst({ where: { type: 'notify-email', dedupKey: `notify-email:${site.id}:failed` } })
    expect(notifyJob).not.toBeNull()
  })

  it('D7: does NOT enqueue a notify job when notifyEmail is null', async () => {
    const site = await seedSite('fail-silent', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    await failSiteAudit(site.id, 'boom')
    const notifyJob = await prisma.job.findFirst({ where: { type: 'notify-email', dedupKey: `notify-email:${site.id}:failed` } })
    expect(notifyJob).toBeNull()
  })

  it('A5 Task 19: also emits prospect-list when the failed audit is prospect-owned', async () => {
    const prospect = await prisma.prospect.create({ data: { name: 'Acme', domain: `${PREFIX}fail-prospect` } })
    const site = await seedSite('fail-prospect', 'running', { discoveredUrls: '[]', pagesTotal: 1, prospectId: prospect.id })
    await failSiteAudit(site.id, 'boom')
    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).toContain('prospect-list')
  })

  it('A5 Task 19: does NOT emit prospect-list for a client-owned (non-prospect) failed audit', async () => {
    const site = await seedSite('fail-no-prospect', 'running', { discoveredUrls: '[]', pagesTotal: 1 })
    await failSiteAudit(site.id, 'boom')
    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).not.toContain('prospect-list')
  })
})

describe('standalone recovery wiring (C1)', () => {
  it('resetStaleAudits and recoverQueue both run standalone recovery', async () => {
    vi.mocked(recoverStandaloneAudits).mockClear()
    await resetStaleAudits()
    expect(recoverStandaloneAudits).toHaveBeenCalledTimes(1)
    await recoverQueue()
    expect(recoverStandaloneAudits).toHaveBeenCalledTimes(2)
  })

  it('a standalone-recovery failure never blocks site-audit recovery (both call sites)', async () => {
    vi.mocked(recoverStandaloneAudits).mockRejectedValueOnce(new Error('boom'))
    await expect(resetStaleAudits()).resolves.toBeUndefined()
    vi.mocked(recoverStandaloneAudits).mockRejectedValueOnce(new Error('boom'))
    await expect(recoverQueue()).resolves.toBeUndefined()
  })
})

describe('enqueueAudit scheduleId attribution (C2)', () => {
  it('creates the SiteAudit with scheduleId set at birth (not a follow-up update)', async () => {
    const { enqueueAudit } = await import('./queue-manager')
    const sched = await prisma.schedule.create({
      data: {
        jobType: 'scheduled-site-audit',
        cadence: 'weekly:1@06:00',
        payload: '{}',
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    const { id } = await enqueueAudit(`${PREFIX}born.example.edu`, null, 'wcag21aa', {
      scheduleId: sched.id,
    })
    const audit = await prisma.siteAudit.findUnique({ where: { id }, select: { scheduleId: true } })
    expect(audit?.scheduleId).toBe(sched.id)
    await prisma.siteAudit.delete({ where: { id } })
    await prisma.schedule.delete({ where: { id: sched.id } })
  })
})

describe('enqueueAudit seoOnly persistence (C11)', () => {
  it('C11: enqueueAudit writes seoOnly + seoIntent to the row', async () => {
    const { enqueueAudit } = await import('./queue-manager')
    const { id } = await enqueueAudit(`${PREFIX}seoonly2.example.edu`, null, 'wcag21aa', { seoOnly: true, seoIntent: true })
    const row = await prisma.siteAudit.findUnique({ where: { id }, select: { seoOnly: true, seoIntent: true } })
    expect(row).toEqual({ seoOnly: true, seoIntent: true })
    await prisma.siteAudit.delete({ where: { id } })
  })

  it('C11: enqueueAudit defaults seoOnly to false when omitted', async () => {
    const { enqueueAudit } = await import('./queue-manager')
    const { id } = await enqueueAudit(`${PREFIX}seoonly3.example.edu`, null, 'wcag21aa', {})
    const row = await prisma.siteAudit.findUnique({ where: { id }, select: { seoOnly: true } })
    expect(row).toEqual({ seoOnly: false })
    await prisma.siteAudit.delete({ where: { id } })
  })
})

describe('enqueueAudit A5 queue emit', () => {
  it('emits queue after the create + batch verification settles', async () => {
    const { enqueueAudit } = await import('./queue-manager')
    vi.mocked(publishInvalidation).mockClear()
    const { id } = await enqueueAudit(`${PREFIX}emit.example.edu`, null, 'wcag21aa', {})
    expect(publishInvalidation).toHaveBeenCalledWith('queue')
    await prisma.siteAudit.delete({ where: { id } })
  })
})
