// lib/jobs/handlers/seo-report-monthly-run.test.ts
//
// DB-backed TDD tests for the seo-report-monthly-run wrapper handler.
// Covers:
//   - Resolves slot + last-full-month period; creates ONE batch + one report per
//     eligible client; enqueues renders.
//   - Re-run for the SAME slot creates NO duplicates (idempotency).
//   - Paused/deleted schedule → no-op.
//   - Archived or unmapped clients are skipped.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Mock the render enqueue so we don't touch the job queue's real enqueue path.
// We just track which report IDs had renders enqueued.
const enqueuedRenderIds: string[] = []

vi.mock('@/lib/jobs/handlers/seo-report-render', () => ({
  enqueueSeoReportRender: vi.fn(async (id: string) => {
    enqueuedRenderIds.push(id)
    return { id: `job-${id}`, deduped: false }
  }),
}))

const { prisma } = await import('@/lib/db')
const {
  SEO_REPORT_MONTHLY_RUN_JOB_TYPE,
  registerSeoReportMonthlyRunHandler,
} = await import('./seo-report-monthly-run')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')

// ── Shared seed state ────────────────────────────────────────────────────────

const PREFIX = 't23-mrun-'

// IDs to clean up
const clientIds: number[] = []
const jobIds: string[] = []
const scheduleIds: string[] = []

async function seedSchedule(opts: { enabled?: boolean } = {}) {
  const s = await prisma.schedule.create({
    data: {
      name: null, // non-system; no unique name needed for handler tests
      jobType: SEO_REPORT_MONTHLY_RUN_JOB_TYPE,
      cadence: 'monthly:1@06:00',
      payload: JSON.stringify({ comparisonMode: 'prev_period' }),
      enabled: opts.enabled ?? true,
      nextRunAt: new Date('2026-07-01T06:00:00Z'),
    },
    select: { id: true },
  })
  scheduleIds.push(s.id)
  return s
}

async function seedJob(scheduleId: string, scheduledFor: Date) {
  const j = await prisma.job.create({
    data: {
      type: SEO_REPORT_MONTHLY_RUN_JOB_TYPE,
      payload: JSON.stringify({ comparisonMode: 'prev_period' }),
      status: 'running',
      scheduleId,
      scheduledFor,
    },
    select: { id: true },
  })
  jobIds.push(j.id)
  return j
}

async function seedClient(opts: {
  name: string
  ga4?: string | null
  gscUrl?: string | null
  archived?: boolean
}) {
  const c = await prisma.client.create({
    data: {
      name: `${PREFIX}${opts.name}`,
      domains: JSON.stringify([`${PREFIX}${opts.name}.example.edu`]),
      // When explicitly passed null, store null (unmapped). When omitted,
      // default to a valid property so clients are eligible by default.
      ga4PropertyId: 'ga4' in opts ? opts.ga4 : 'properties/123',
      gscSiteUrl: 'gscUrl' in opts ? opts.gscUrl : null,
      archivedAt: opts.archived ? new Date() : null,
    },
    select: { id: true },
  })
  clientIds.push(c.id)
  return c
}

// ── Handler invocation helper ─────────────────────────────────────────────────

async function runHandler(jobId: string, payload: unknown = { comparisonMode: 'prev_period' }) {
  const h = getJobHandler(SEO_REPORT_MONTHLY_RUN_JOB_TYPE)
  if (!h) throw new Error('handler not registered')
  await h.handler(payload, {
    jobId,
    attempt: 1,
    signal: new AbortController().signal,
  })
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Pre-clean any leftover rows from a failed run.
  await prisma.seoReport.deleteMany({ where: { batch: { trigger: 'scheduled', scheduleId: { not: null } } } })
  await prisma.seoReportBatch.deleteMany({ where: { trigger: 'scheduled' } })
  await prisma.job.deleteMany({ where: { type: SEO_REPORT_MONTHLY_RUN_JOB_TYPE } })
  await prisma.schedule.deleteMany({ where: { jobType: SEO_REPORT_MONTHLY_RUN_JOB_TYPE, name: null } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })

  clearJobRegistryForTests?.()
  registerSeoReportMonthlyRunHandler()
})

afterAll(async () => {
  // Scoped cleanup only — delete in FK-safe order.
  await prisma.seoReport.deleteMany({ where: { batchId: { in: (await prisma.seoReportBatch.findMany({ where: { scheduleId: { in: scheduleIds } }, select: { id: true } })).map(b => b.id) } } })
  await prisma.seoReportBatch.deleteMany({ where: { scheduleId: { in: scheduleIds } } })
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } })
  await prisma.schedule.deleteMany({ where: { id: { in: scheduleIds } } })
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('seo-report-monthly-run handler', () => {
  it('is registered with type seo-report-monthly-run', () => {
    const h = getJobHandler(SEO_REPORT_MONTHLY_RUN_JOB_TYPE)
    expect(h).toBeDefined()
    expect(h!.concurrency).toBe(1)
    expect(h!.timeoutMs).toBeLessThanOrEqual(60_000)
    expect(h!.maxAttempts).toBe(3)
  })

  it('creates ONE batch + one report per eligible client and enqueues renders', async () => {
    // Seed: 2 eligible (GA4 mapped, active), 1 archived, 1 unmapped.
    // We track only the IDs from OUR seeded eligible clients.
    const clientA = await seedClient({ name: 'eligible-a', ga4: 'properties/11' })
    const clientB = await seedClient({ name: 'eligible-b', ga4: 'properties/22' })
    await seedClient({ name: 'archived-c', ga4: 'properties/33', archived: true })
    await seedClient({ name: 'unmapped-d', ga4: null, gscUrl: null })

    const schedule = await seedSchedule()
    const slotDate = new Date('2026-07-01T06:00:00Z')
    const job = await seedJob(schedule.id, slotDate)

    enqueuedRenderIds.length = 0
    await runHandler(job.id)

    // Exactly one batch for this schedule+slot
    const batches = await prisma.seoReportBatch.findMany({
      where: { scheduleId: schedule.id, scheduledFor: slotDate },
    })
    expect(batches).toHaveLength(1)

    // Our two eligible clients must appear in the batch. Other pre-existing
    // eligible clients from other test runs may also appear (the handler queries
    // ALL active eligible clients) — that is correct behavior. What we assert:
    // archived and unmapped clients from THIS seed are NOT included.
    const reports = await prisma.seoReport.findMany({
      where: { batchId: batches[0].id },
    })
    const reportClientIds = reports.map(r => r.clientId)
    expect(reportClientIds).toContain(clientA.id)
    expect(reportClientIds).toContain(clientB.id)

    // The archived and unmapped clients from this seed are NOT included
    const archivedId = clientIds[clientIds.length - 2] // archived-c (3rd seeded)
    const unmappedId = clientIds[clientIds.length - 1] // unmapped-d (4th seeded)
    expect(reportClientIds).not.toContain(archivedId)
    expect(reportClientIds).not.toContain(unmappedId)

    // Period = last full month before July 2026-07-01 = June 2026
    // 2026-07-01 → lastFullMonth → 2026-06-01 to 2026-06-30
    expect(batches[0].periodStart).toEqual(new Date('2026-06-01T00:00:00Z'))
    expect(batches[0].periodEnd).toEqual(new Date('2026-06-30T00:00:00Z'))

    // One render enqueued per report (including any pre-existing eligible clients)
    expect(enqueuedRenderIds.sort()).toEqual(reports.map(r => r.id).sort())
  })

  it('a re-run for the SAME slot creates NO duplicates (idempotency)', async () => {
    // Run the handler TWICE with the same jobId (same schedule+slot).
    // The Job @@unique([scheduleId, scheduledFor]) prevents two job rows for the
    // same slot — the idempotency contract is that calling the handler twice on
    // the SAME job (as in a retry) creates zero new batches/reports.
    //
    // Find the job created in the previous test.
    const schedule = await prisma.schedule.findFirst({
      where: { id: { in: scheduleIds } },
      select: { id: true },
    })
    const slotDate = new Date('2026-07-01T06:00:00Z')
    const existingJob = await prisma.job.findFirst({
      where: { scheduleId: schedule!.id, scheduledFor: slotDate },
      select: { id: true },
    })

    // Capture counts before re-run
    const batchesBefore = await prisma.seoReportBatch.count({
      where: { scheduleId: schedule!.id, scheduledFor: slotDate },
    })
    const batch = await prisma.seoReportBatch.findFirst({
      where: { scheduleId: schedule!.id, scheduledFor: slotDate },
    })
    const reportsBefore = await prisma.seoReport.count({ where: { batchId: batch!.id } })

    // Re-run the handler with the SAME job ID (retry semantics)
    enqueuedRenderIds.length = 0
    await runHandler(existingJob!.id)

    // Counts must be unchanged
    const batchesAfter = await prisma.seoReportBatch.count({
      where: { scheduleId: schedule!.id, scheduledFor: slotDate },
    })
    expect(batchesAfter).toBe(batchesBefore) // still exactly 1

    const reportsAfter = await prisma.seoReport.count({ where: { batchId: batch!.id } })
    expect(reportsAfter).toBe(reportsBefore) // no new reports
  })

  it('no-ops when the schedule is paused (enabled=false)', async () => {
    const pausedSched = await seedSchedule({ enabled: false })
    const slotDate = new Date('2026-08-01T06:00:00Z')
    const job = await seedJob(pausedSched.id, slotDate)

    enqueuedRenderIds.length = 0
    await runHandler(job.id)

    // No batch created for this schedule
    const batches = await prisma.seoReportBatch.count({ where: { scheduleId: pausedSched.id } })
    expect(batches).toBe(0)
    expect(enqueuedRenderIds).toHaveLength(0)
  })

  it('no-ops when the schedule has been deleted', async () => {
    // Create a schedule, capture its ID, then delete it before running the job.
    const tempSched = await prisma.schedule.create({
      data: {
        name: null,
        jobType: SEO_REPORT_MONTHLY_RUN_JOB_TYPE,
        cadence: 'monthly:1@06:00',
        payload: '{}',
        enabled: true,
        nextRunAt: new Date('2026-09-01T06:00:00Z'),
      },
      select: { id: true },
    })
    const slotDate = new Date('2026-09-01T06:00:00Z')
    const job = await prisma.job.create({
      data: {
        type: SEO_REPORT_MONTHLY_RUN_JOB_TYPE,
        payload: '{}',
        status: 'running',
        scheduleId: tempSched.id,
        scheduledFor: slotDate,
      },
      select: { id: true },
    })
    jobIds.push(job.id)

    // Delete the schedule (SetNull on job.scheduleId is handled by FK, but here
    // we're testing that a findUnique on the deleted schedule returns null → no-op).
    // Actually the FK is SetNull — so we need to delete after job creation,
    // then manually clear scheduleId to simulate the race:
    // In the real code, schedule.findUnique returns null → handler returns early.
    // Simulate: delete the schedule row, and update the job.scheduleId to point to
    // a deleted ID (it was SetNull'd — but we need scheduleId still set for the
    // job.findUnique path to find it).
    // Simplest: just delete the schedule; since FK onDelete=SetNull,
    // job.scheduleId becomes null → handler sees no scheduleId → logs + returns.
    await prisma.schedule.delete({ where: { id: tempSched.id } })

    enqueuedRenderIds.length = 0
    await runHandler(job.id)

    // No batch created
    const batches = await prisma.seoReportBatch.count({ where: { scheduleId: tempSched.id } })
    expect(batches).toBe(0)
    expect(enqueuedRenderIds).toHaveLength(0)
  })
})
