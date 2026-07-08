// lib/jobs/handlers/scheduled-site-audit.test.ts
//
// C2 wrapper-handler semantics: Schedule resolved via the Job row, config
// rot disables the schedule (never destructive), duplicates consume the
// slot, DB errors propagate to the worker.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const queueMock = vi.hoisted(() => ({
  queueSiteAuditRequest: vi.fn(),
}))
vi.mock('@/lib/ada-audit/queue-request', () => queueMock)

const { prisma } = await import('@/lib/db')
const { getJobHandler } = await import('../registry')
const { registerScheduledSiteAuditHandler, SCHEDULED_SITE_AUDIT_JOB_TYPE } = await import('./scheduled-site-audit')

const PREFIX = 'c2sched-h-'

// Cleanup is scoped to rows THIS file created (tracked ids / prefix) — never
// broad deleteMany on shared tables like Job/Schedule (other test files and
// local dev rows share them).
const createdScheduleIds: string[] = []
const createdJobIds: string[] = []

function ctxFor(jobId: string) {
  return { jobId, attempt: 1, signal: new AbortController().signal }
}

async function makeSchedule(overrides: Record<string, unknown> = {}) {
  const sched = await prisma.schedule.create({
    data: {
      jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE,
      cadence: 'weekly:1@06:00',
      payload: '{}',
      nextRunAt: new Date('2099-01-01T00:00:00Z'),
      ...overrides,
    },
  })
  createdScheduleIds.push(sched.id)
  return sched
}

async function makeJob(scheduleId: string | null) {
  const job = await prisma.job.create({
    data: {
      type: SCHEDULED_SITE_AUDIT_JOB_TYPE,
      status: 'running',
      payload: '{}',
      scheduleId,
      scheduledFor: scheduleId ? new Date() : null,
    },
  })
  createdJobIds.push(job.id)
  return job
}

describe('scheduled-site-audit handler', () => {
  let handler: (payload: unknown, ctx: ReturnType<typeof ctxFor>) => Promise<void>
  let client: { id: number }

  beforeAll(async () => {
    registerScheduledSiteAuditHandler()
    handler = getJobHandler(SCHEDULED_SITE_AUDIT_JOB_TYPE)!.handler
    // Pre-clean leftovers from a failed prior run (Client delete cascades
    // its Schedule rows).
    await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
    client = await prisma.client.create({
      data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}ok.example.edu`]) },
    })
  })

  beforeEach(() => {
    queueMock.queueSiteAuditRequest.mockReset()
    queueMock.queueSiteAuditRequest.mockResolvedValue({ kind: 'queued', id: 'audit-1' })
  })

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } })
    await prisma.schedule.deleteMany({ where: { id: { in: createdScheduleIds } } })
    await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
  })

  it('registers with the expected config (concurrency 1, 3 attempts, 30s timeout, onExhausted)', () => {
    const cfg = getJobHandler(SCHEDULED_SITE_AUDIT_JOB_TYPE)!
    expect(cfg.concurrency).toBe(1)
    expect(cfg.maxAttempts).toBe(3)
    expect(cfg.timeoutMs).toBe(30_000)
    expect(cfg.onExhausted).toBeDefined()
  })

  it('onExhausted is log-only and never throws', async () => {
    const cfg = getJobHandler(SCHEDULED_SITE_AUDIT_JOB_TYPE)!
    await expect(
      cfg.onExhausted!(null, { jobId: 'j1', attempts: 3, lastError: 'boom' }),
    ).resolves.toBeUndefined()
  })

  it('enqueues via queueSiteAuditRequest with scheduleId + requestedBy scheduled', async () => {
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler(
      { clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' },
      ctxFor(job.id),
    )
    expect(queueMock.queueSiteAuditRequest).toHaveBeenCalledWith({
      domain: `${PREFIX}ok.example.edu`,
      clientId: client.id,
      wcagLevel: 'wcag21aa',
      requestedBy: 'scheduled',
      scheduleId: sched.id,
      seoIntent: false,
      seoOnly: false,
    })
  })

  it('forwards seoOnly:true from the payload to queueSiteAuditRequest', async () => {
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler(
      { clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa', seoOnly: true },
      ctxFor(job.id),
    )
    expect(queueMock.queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ seoOnly: true }),
    )
  })

  it('forwards seoOnly:false when absent from the payload (control)', async () => {
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler(
      { clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' },
      ctxFor(job.id),
    )
    expect(queueMock.queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ seoOnly: false }),
    )
  })

  it('no-ops when the job has no scheduleId', async () => {
    const job = await makeJob(null)
    await handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
  })

  it('no-ops when the schedule was disabled since enqueue (stays disabled, no re-disable churn)', async () => {
    const sched = await makeSchedule({ clientId: client.id, enabled: false })
    const job = await makeJob(sched.id)
    await handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
  })

  it('disables the schedule on malformed payload', async () => {
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler({ nonsense: true }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
  })

  it('disables the schedule when the client is archived', async () => {
    const archived = await prisma.client.create({
      data: {
        name: `${PREFIX}archived`,
        domains: JSON.stringify([`${PREFIX}arch.example.edu`]),
        archivedAt: new Date(),
      },
    })
    const sched = await makeSchedule({ clientId: archived.id })
    const job = await makeJob(sched.id)
    await handler({ clientId: archived.id, domain: `${PREFIX}arch.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
  })

  it('disables the schedule when the domain is no longer listed on the client', async () => {
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler({ clientId: client.id, domain: `${PREFIX}gone.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect(queueMock.queueSiteAuditRequest).not.toHaveBeenCalled()
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
  })

  it('duplicate result consumes the slot quietly (schedule stays enabled)', async () => {
    queueMock.queueSiteAuditRequest.mockResolvedValue({ kind: 'duplicate', existingId: 'x' })
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(true)
  })

  it('invalid result disables the schedule', async () => {
    queueMock.queueSiteAuditRequest.mockResolvedValue({ kind: 'invalid', reason: 'bad domain' })
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id))
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
  })

  it('DB error from queueSiteAuditRequest propagates (worker retries)', async () => {
    queueMock.queueSiteAuditRequest.mockRejectedValue(new Error('SQLITE_BUSY'))
    const sched = await makeSchedule({ clientId: client.id })
    const job = await makeJob(sched.id)
    await expect(
      handler({ clientId: client.id, domain: `${PREFIX}ok.example.edu`, wcagLevel: 'wcag21aa' }, ctxFor(job.id)),
    ).rejects.toThrow('SQLITE_BUSY')
  })
})
