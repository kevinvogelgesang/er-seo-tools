// lib/seo-report-retention.test.ts — DB-backed TDD for pruneSeoReports()
//
// Prefix: 'c10ret-' on client names to scope all seed/cleanup rows.
// Pass an explicit `now` for deterministic retention windows.
// Tmp REPORTS_DIR is stubbed via vi.stubEnv so deleteSeoReportFile reads it.
// cancelJobsByGroup is partially mocked (vi.mock on @/lib/jobs/queue) to
// assert cancellation is called for doomed ids.
//
// Run: DATABASE_URL="file:./local-dev.db" npx vitest run lib/seo-report-retention.test.ts

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { prisma } from '@/lib/db'
import { seoReportPath } from '@/lib/report/seo/seo-report-file'

// ── Partial mock: cancelJobsByGroup is spied on; all other queue exports pass through ──
vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return {
    ...original,
    cancelJobsByGroup: vi.fn().mockResolvedValue(0),
  }
})

import { cancelJobsByGroup } from '@/lib/jobs/queue'
import { pruneSeoReports } from './seo-report-retention'

// ── Constants ──────────────────────────────────────────────────────────────────
const PREFIX = 'c10ret-'
const NOW = new Date('2026-06-22T12:00:00Z')
const DAY_MS = 86_400_000

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS)
}

function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * DAY_MS)
}

// ── Tmp REPORTS_DIR ────────────────────────────────────────────────────────────
let tmpReportsDir: string

// ── Seed helpers ───────────────────────────────────────────────────────────────
let clientId: number

async function ensureClient(): Promise<number> {
  const name = `${PREFIX}test-client`
  const existing = await prisma.client.findUnique({ where: { name }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.client.create({ data: { name, domains: '[]' } })
  return created.id
}

async function makeBatch(): Promise<string> {
  const now = new Date()
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
  batchId: string
  retainUntil: Date | null
  clientOverride?: number
}): Promise<{ id: string }> {
  const report = await prisma.seoReport.create({
    data: {
      batchId: opts.batchId,
      clientId: opts.clientOverride ?? clientId,
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T00:00:00Z'),
      comparisonStart: new Date('2026-04-01T00:00:00Z'),
      comparisonEnd: new Date('2026-04-30T00:00:00Z'),
      retainUntil: opts.retainUntil,
    },
  })
  return { id: report.id }
}

async function writeFakePdf(id: string): Promise<string> {
  const p = seoReportPath(id)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, 'fake-pdf-content')
  return p
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false)
}

// ── Cleanup helpers ────────────────────────────────────────────────────────────
async function cleanPrefixRows(): Promise<void> {
  // SeoReport rows cascade delete from SeoReportBatch.
  // We need to delete via client, then batches with no remaining reports.
  const clients = await prisma.client.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } })
  if (clients.length > 0) {
    await prisma.seoReport.deleteMany({ where: { clientId: { in: clients.map((c) => c.id) } } })
  }
  await prisma.seoReportBatch.deleteMany({ where: { reports: { none: {} } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────
beforeAll(async () => {
  await cleanPrefixRows() // survive prior failed run
  tmpReportsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c10ret-reports-'))
  vi.stubEnv('REPORTS_DIR', tmpReportsDir)
  clientId = await ensureClient()
})

afterEach(async () => {
  vi.mocked(cancelJobsByGroup).mockClear()
  // Delete all SeoReport/SeoReportBatch rows seeded this test, keeping the client
  const clients = await prisma.client.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } })
  if (clients.length > 0) {
    await prisma.seoReport.deleteMany({ where: { clientId: { in: clients.map((c) => c.id) } } })
  }
  await prisma.seoReportBatch.deleteMany({ where: { reports: { none: {} } } })
})

afterAll(async () => {
  await cleanPrefixRows()
  vi.unstubAllEnvs()
  await fs.rm(tmpReportsDir, { recursive: true, force: true })
})

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('pruneSeoReports', () => {
  it('deletes a past-retainUntil report and unlinks its PDF', async () => {
    const batchId = await makeBatch()
    const { id } = await makeReport({ batchId, retainUntil: daysAgo(1) })
    const pdfPath = await writeFakePdf(id)

    const result = await pruneSeoReports(NOW)

    expect(result).toEqual({ deleted: 1 })
    expect(await prisma.seoReport.findUnique({ where: { id } })).toBeNull()
    expect(await fileExists(pdfPath)).toBe(false)
  })

  it('keeps a future-retainUntil report and leaves its PDF intact', async () => {
    const batchId = await makeBatch()
    const { id } = await makeReport({ batchId, retainUntil: daysFromNow(30) })
    const pdfPath = await writeFakePdf(id)

    const result = await pruneSeoReports(NOW)

    expect(result).toEqual({ deleted: 0 })
    expect(await prisma.seoReport.findUnique({ where: { id } })).not.toBeNull()
    expect(await fileExists(pdfPath)).toBe(true)
  })

  it('keeps a null-retainUntil report (never pruned)', async () => {
    const batchId = await makeBatch()
    const { id } = await makeReport({ batchId, retainUntil: null })
    const pdfPath = await writeFakePdf(id)

    const result = await pruneSeoReports(NOW)

    expect(result).toEqual({ deleted: 0 })
    expect(await prisma.seoReport.findUnique({ where: { id } })).not.toBeNull()
    expect(await fileExists(pdfPath)).toBe(true)
  })

  it('cancels queued render jobs BEFORE deleting the report row', async () => {
    const batchId = await makeBatch()
    const { id } = await makeReport({ batchId, retainUntil: daysAgo(1) })

    // Track call order to verify cancel is called BEFORE delete
    const callOrder: string[] = []
    vi.mocked(cancelJobsByGroup).mockImplementation(async (groupKey) => {
      callOrder.push(`cancel:${groupKey}`)
      return 0
    })

    // Store the original $transaction implementation before spying
    const originalTransaction = (prisma.$transaction as any).bind(prisma)

    // Spy on $transaction to record when the delete happens
    const txSpy = vi.spyOn(prisma, '$transaction' as any)
    txSpy.mockImplementation(async (arg: any) => {
      callOrder.push('delete')
      // Delegate to the real implementation
      return originalTransaction(arg)
    })

    await pruneSeoReports(NOW)

    // Verify cancel was called with the correct key
    expect(vi.mocked(cancelJobsByGroup)).toHaveBeenCalledWith(`seo-report:${id}`)
    expect(callOrder).toContain(`cancel:seo-report:${id}`)

    // Verify ordering: cancel MUST come before delete
    const cancelIndex = callOrder.indexOf(`cancel:seo-report:${id}`)
    const deleteIndex = callOrder.indexOf('delete')
    expect(cancelIndex).toBeLessThan(deleteIndex)
    expect(cancelIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThanOrEqual(0)

    // Verify the row was actually deleted
    expect(await prisma.seoReport.findUnique({ where: { id } })).toBeNull()

    // Clean up the spy
    txSpy.mockRestore()
  })

  it('removes empty batches after all children are pruned', async () => {
    const batchId = await makeBatch()
    // Create a second client for this batch to test multi-child scenario
    const client2Name = `${PREFIX}test-client-2`
    const existingC2 = await prisma.client.findUnique({ where: { name: client2Name }, select: { id: true } })
    const client2 = existingC2 ?? await prisma.client.create({ data: { name: client2Name, domains: '[]' } })
    const client2Id = client2.id

    // Both children are doomed
    await makeReport({ batchId, retainUntil: daysAgo(1) })
    await makeReport({ batchId, retainUntil: daysAgo(2), clientOverride: client2Id })

    await pruneSeoReports(NOW)

    expect(await prisma.seoReportBatch.findUnique({ where: { id: batchId } })).toBeNull()
  })

  it('does NOT remove a batch that still holds a kept child', async () => {
    const batchId = await makeBatch()
    const client3Name = `${PREFIX}test-client-3`
    const existingC3 = await prisma.client.findUnique({ where: { name: client3Name }, select: { id: true } })
    const client3 = existingC3 ?? await prisma.client.create({ data: { name: client3Name, domains: '[]' } })
    const client3Id = client3.id

    // One doomed, one kept
    await makeReport({ batchId, retainUntil: daysAgo(1) })
    await makeReport({ batchId, retainUntil: daysFromNow(30), clientOverride: client3Id })

    await pruneSeoReports(NOW)

    // Batch survives because it still has a live child
    expect(await prisma.seoReportBatch.findUnique({ where: { id: batchId } })).not.toBeNull()
  })

  it('is ENOENT-tolerant when the PDF was already missing', async () => {
    const batchId = await makeBatch()
    const { id } = await makeReport({ batchId, retainUntil: daysAgo(1) })
    // Deliberately do NOT write a PDF file

    // Should not throw
    await expect(pruneSeoReports(NOW)).resolves.toEqual({ deleted: 1 })
    expect(await prisma.seoReport.findUnique({ where: { id } })).toBeNull()
  })

  it('returns { deleted: 0 } when there is nothing to prune', async () => {
    const result = await pruneSeoReports(NOW)
    expect(result).toEqual({ deleted: 0 })
  })
})
