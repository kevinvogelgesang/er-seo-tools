// lib/seo-report-recovery.test.ts — DB-backed TDD for recoverSeoReports()
//
// Prefix: 'c10rec-' on client names to scope all seed/cleanup rows.
// Pass an explicit `now` to recoverSeoReports for deterministic threshold math.
// To simulate a stranded (old) report, we backdate updatedAt via $executeRaw
// so it falls before the threshold. Recent reports (within threshold) are
// left alone to prove the threshold guard.
//
// enqueueSeoReportRender is partially mocked to avoid the full job machinery,
// while still verifying that a Job row lands in the correct group.
//
// Run:
//   DATABASE_URL="file:./local-dev.db" npx vitest run lib/seo-report-recovery.test.ts

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'

// ── Partial mock: enqueueSeoReportRender returns a fake EnqueueJobResult ──────
// We still let the real enqueueJob run (no DB mock), so job rows land in the
// DB and can be asserted against. The spy lets us count calls directly.
vi.mock('@/lib/jobs/handlers/seo-report-render', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/jobs/handlers/seo-report-render')>()
  return {
    ...original,
    enqueueSeoReportRender: vi.fn(async (seoReportId: string) => {
      // Call the real enqueueJob so Job rows are visible in the DB
      const { enqueueJob } = await import('@/lib/jobs/queue')
      return enqueueJob({
        type: original.SEO_REPORT_RENDER_JOB_TYPE,
        payload: { seoReportId },
        dedupKey: `seo-report:${seoReportId}`,
        groupKey: `seo-report:${seoReportId}`,
      })
    }),
  }
})

import { recoverSeoReports, SEO_REPORT_RECOVERY_THRESHOLD_MS } from './seo-report-recovery'

// ── Constants ──────────────────────────────────────────────────────────────────
const PREFIX = 'c10rec-'

// ── Seed helpers ───────────────────────────────────────────────────────────────

async function ensureClient(suffix = 'default'): Promise<number> {
  const name = `${PREFIX}${suffix}`
  const existing = await prisma.client.findUnique({ where: { name }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.client.create({ data: { name, domains: '[]' } })
  return created.id
}

async function makeBatch(): Promise<string> {
  const batch = await prisma.seoReportBatch.create({
    data: {
      trigger: 'manual',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T00:00:00Z'),
      comparisonMode: 'prev_period',
      comparisonStart: new Date('2026-04-01T00:00:00Z'),
      comparisonEnd: new Date('2026-04-30T00:00:00Z'),
    },
  })
  return batch.id
}

async function makeReport(opts: {
  clientId: number
  batchId: string
  status: string
}): Promise<string> {
  const report = await prisma.seoReport.create({
    data: {
      batchId: opts.batchId,
      clientId: opts.clientId,
      status: opts.status,
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T00:00:00Z'),
      comparisonStart: new Date('2026-04-01T00:00:00Z'),
      comparisonEnd: new Date('2026-04-30T00:00:00Z'),
    },
  })
  return report.id
}

/**
 * Backdate updatedAt on a SeoReport row so it falls before the recovery
 * threshold. Prisma's @updatedAt auto-sets updatedAt on every write, so we
 * must use $executeRaw to bypass it.
 */
async function backdateReport(reportId: string, msAgo: number): Promise<void> {
  const ts = Date.now() - msAgo
  await prisma.$executeRaw`UPDATE "SeoReport" SET "updatedAt" = ${ts} WHERE id = ${reportId}`
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

async function clean() {
  const clients = await prisma.client.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  })
  const clientIds = clients.map((c) => c.id)
  if (clientIds.length === 0) return

  const reports = await prisma.seoReport.findMany({
    where: { clientId: { in: clientIds } },
    select: { id: true },
  })
  const reportIds = reports.map((r) => r.id)

  // Clean jobs in the seo-report group for these reports
  if (reportIds.length > 0) {
    const groupKeys = reportIds.map((id) => `seo-report:${id}`)
    await prisma.job.deleteMany({
      where: { type: 'seo-report-render', groupKey: { in: groupKeys } },
    })
  }

  // Cascade: SeoReport is deleted with Client (onDelete: Cascade)
  // but SeoReportBatch has no direct FK to Client — delete batches that own
  // these reports.
  const batches = await prisma.seoReportBatch.findMany({
    where: { reports: { some: { clientId: { in: clientIds } } } },
    select: { id: true },
  })
  const batchIds = batches.map((b) => b.id)

  await prisma.seoReport.deleteMany({ where: { clientId: { in: clientIds } } })
  if (batchIds.length > 0) {
    await prisma.seoReportBatch.deleteMany({ where: { id: { in: batchIds } } })
  }
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
}

beforeEach(clean)
afterAll(clean)

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('recoverSeoReports', () => {
  it('re-enqueues a stranded queued report (old, no active job)', async () => {
    const clientId = await ensureClient('stranded-queued')
    const batchId = await makeBatch()
    const reportId = await makeReport({ clientId, batchId, status: 'queued' })
    // Backdate so it is older than the threshold
    await backdateReport(reportId, SEO_REPORT_RECOVERY_THRESHOLD_MS + 60_000)

    const now = new Date()
    const result = await recoverSeoReports({ now })

    expect(result.requeued).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({
      where: { type: 'seo-report-render', groupKey: `seo-report:${reportId}` },
    })
    expect(job).not.toBeNull()
  })

  it('re-enqueues a stranded fetching report (old, no active job)', async () => {
    const clientId = await ensureClient('stranded-fetching')
    const batchId = await makeBatch()
    const reportId = await makeReport({ clientId, batchId, status: 'fetching' })
    await backdateReport(reportId, SEO_REPORT_RECOVERY_THRESHOLD_MS + 60_000)

    const now = new Date()
    const result = await recoverSeoReports({ now })

    expect(result.requeued).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({
      where: { type: 'seo-report-render', groupKey: `seo-report:${reportId}` },
    })
    expect(job).not.toBeNull()
  })

  it('re-enqueues a stranded rendering report (old, no active job)', async () => {
    const clientId = await ensureClient('stranded-rendering')
    const batchId = await makeBatch()
    const reportId = await makeReport({ clientId, batchId, status: 'rendering' })
    await backdateReport(reportId, SEO_REPORT_RECOVERY_THRESHOLD_MS + 60_000)

    const now = new Date()
    const result = await recoverSeoReports({ now })

    expect(result.requeued).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({
      where: { type: 'seo-report-render', groupKey: `seo-report:${reportId}` },
    })
    expect(job).not.toBeNull()
  })

  it('leaves alone a stranded report that already has an active job', async () => {
    const clientId = await ensureClient('active-job')
    const batchId = await makeBatch()
    const reportId = await makeReport({ clientId, batchId, status: 'rendering' })
    await backdateReport(reportId, SEO_REPORT_RECOVERY_THRESHOLD_MS + 60_000)

    // Seed an active (queued) job in the group so recoverSeoReports skips it
    await prisma.job.create({
      data: {
        type: 'seo-report-render',
        payload: JSON.stringify({ seoReportId: reportId }),
        status: 'queued',
        groupKey: `seo-report:${reportId}`,
        dedupKey: `seo-report:${reportId}`,
        maxAttempts: 2,
        attempts: 0,
        runAfter: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    const before = await prisma.job.count({
      where: { type: 'seo-report-render', groupKey: `seo-report:${reportId}` },
    })
    const now = new Date()
    await recoverSeoReports({ now })
    const after = await prisma.job.count({
      where: { type: 'seo-report-render', groupKey: `seo-report:${reportId}` },
    })
    // Job count must not increase (recovery skipped it)
    expect(after).toBe(before)
  })

  it('ignores terminal ready reports', async () => {
    const clientId = await ensureClient('terminal-ready')
    const batchId = await makeBatch()
    const reportId = await makeReport({ clientId, batchId, status: 'ready' })
    await backdateReport(reportId, SEO_REPORT_RECOVERY_THRESHOLD_MS + 60_000)

    const now = new Date()
    const result = await recoverSeoReports({ now })

    expect(result.requeued).toBe(0)
    const job = await prisma.job.findFirst({
      where: { type: 'seo-report-render', groupKey: `seo-report:${reportId}` },
    })
    expect(job).toBeNull()
  })

  it('ignores terminal error reports', async () => {
    const clientId = await ensureClient('terminal-error')
    const batchId = await makeBatch()
    const reportId = await makeReport({ clientId, batchId, status: 'error' })
    await backdateReport(reportId, SEO_REPORT_RECOVERY_THRESHOLD_MS + 60_000)

    const now = new Date()
    const result = await recoverSeoReports({ now })

    expect(result.requeued).toBe(0)
    const job = await prisma.job.findFirst({
      where: { type: 'seo-report-render', groupKey: `seo-report:${reportId}` },
    })
    expect(job).toBeNull()
  })

  it('leaves alone a recent non-terminal report (within threshold)', async () => {
    const clientId = await ensureClient('recent-queued')
    const batchId = await makeBatch()
    const reportId = await makeReport({ clientId, batchId, status: 'queued' })
    // Do NOT backdate — updatedAt is current, well within threshold

    const now = new Date()
    const result = await recoverSeoReports({ now })

    expect(result.requeued).toBe(0)
    const job = await prisma.job.findFirst({
      where: { type: 'seo-report-render', groupKey: `seo-report:${reportId}` },
    })
    expect(job).toBeNull()
  })
})
