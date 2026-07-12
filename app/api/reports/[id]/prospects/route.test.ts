// app/api/reports/[id]/prospects/route.test.ts
//
// DB-backed tests for PUT /api/reports/[id]/prospects (per-report manual prospects).
// Real Client/SeoReportBatch/SeoReport rows (client name prefix t24pros-).
// enqueueSeoReportRender is mocked.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jobs/handlers/seo-report-render', () => ({
  enqueueSeoReportRender: vi.fn().mockResolvedValue({ jobId: 'mocked' }),
}))
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))

const { prisma } = await import('@/lib/db')
const { enqueueSeoReportRender } = await import('@/lib/jobs/handlers/seo-report-render')
const { publishInvalidation } = await import('@/lib/events/bus')
const { PUT } = await import('./route')

const PREFIX = 't24pros-'
const clientIds: number[] = []

type Params = { params: Promise<{ id: string }> }

function makeParams(id: string): Params {
  return { params: Promise.resolve({ id }) }
}

function put(id: string, body: Record<string, unknown>) {
  return PUT(
    new NextRequest(`http://localhost/api/reports/${id}/prospects`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    makeParams(id),
  )
}

async function seedClient(suffix: string): Promise<number> {
  const client = await prisma.client.create({
    data: {
      name: `${PREFIX}${suffix}`,
      domains: JSON.stringify([`${PREFIX}${suffix}.example.com`]),
    },
  })
  clientIds.push(client.id)
  return client.id
}

async function seedReport(clientId: number) {
  const batch = await prisma.seoReportBatch.create({
    data: {
      trigger: 'manual',
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-31T00:00:00.000Z'),
      comparisonMode: 'prev_period',
      comparisonStart: new Date('2026-04-01T00:00:00.000Z'),
      comparisonEnd: new Date('2026-04-30T00:00:00.000Z'),
    },
  })
  const report = await prisma.seoReport.create({
    data: {
      batchId: batch.id,
      clientId,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-31T00:00:00.000Z'),
      comparisonStart: new Date('2026-04-01T00:00:00.000Z'),
      comparisonEnd: new Date('2026-04-30T00:00:00.000Z'),
      status: 'ready',
      ga4Status: 'ok',
      gscStatus: 'skipped',
      prospectsStatus: 'missing',
      metricsJson: JSON.stringify({ someKey: 'someValue' }),
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
    },
  })
  return { batch, report }
}

beforeAll(async () => {
  // Clean up leftover rows from a previous failed run
  await prisma.prospectsEntry.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

beforeEach(async () => {
  vi.mocked(enqueueSeoReportRender).mockReset()
  vi.mocked(enqueueSeoReportRender).mockResolvedValue({ jobId: 'mocked' } as Awaited<ReturnType<typeof enqueueSeoReportRender>>)
  vi.mocked(publishInvalidation).mockClear()
})

afterEach(async () => {
  // Clean up ProspectsEntry + report rows for this prefix
  await prisma.prospectsEntry.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReportBatch.deleteMany({ where: { reports: { none: {} } } })
})

afterAll(async () => {
  await prisma.prospectsEntry.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  if (clientIds.length) {
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
  }
})

// ---------------------------------------------------------------------------
// PUT — per-report prospects + critical invariants
// ---------------------------------------------------------------------------

describe('PUT /api/reports/[id]/prospects', () => {
  it('writes prospectsTotal/Organic onto the report and resets metricsJson/status/prospectsStatus', async () => {
    const clientId = await seedClient('perreport-ok')
    const { report } = await seedReport(clientId)

    const res = await put(report.id, { total: 250, organic: 100 })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    const updatedReport = await prisma.seoReport.findUnique({
      where: { id: report.id },
      select: {
        prospectsTotal: true,
        prospectsOrganic: true,
        metricsJson: true,
        status: true,
        prospectsStatus: true,
      },
    })
    // Values stored ON THE REPORT (per-report)
    expect(updatedReport?.prospectsTotal).toBe(250)
    expect(updatedReport?.prospectsOrganic).toBe(100)
    // CRITICAL: metricsJson must be null after update so the next render rebuilds
    expect(updatedReport?.metricsJson).toBeNull()
    expect(updatedReport?.status).toBe('queued')
    expect(updatedReport?.prospectsStatus).toBe('pending')

    // No shared ProspectsEntry is written by the per-report path
    const entryCount = await prisma.prospectsEntry.count({ where: { clientId } })
    expect(entryCount).toBe(0)

    // enqueueSeoReportRender must have been called with the report id
    expect(enqueueSeoReportRender).toHaveBeenCalledWith(report.id)

    // A5 Task 18: a regenerate (via manual prospects) invalidates the shared list.
    expect(publishInvalidation).toHaveBeenCalledWith('report-list')
  })

  it('is per-report: editing one report does NOT affect a sibling report for the same client+period', async () => {
    const clientId = await seedClient('perreport-isolation')
    const { report: reportA } = await seedReport(clientId)
    const { report: reportB } = await seedReport(clientId)

    await put(reportA.id, { total: 111, organic: 11 })
    await put(reportB.id, { total: 222, organic: 22 })

    const a = await prisma.seoReport.findUnique({
      where: { id: reportA.id },
      select: { prospectsTotal: true, prospectsOrganic: true },
    })
    const b = await prisma.seoReport.findUnique({
      where: { id: reportB.id },
      select: { prospectsTotal: true, prospectsOrganic: true },
    })

    // Each report keeps its own value — no cross-contamination
    expect(a?.prospectsTotal).toBe(111)
    expect(a?.prospectsOrganic).toBe(11)
    expect(b?.prospectsTotal).toBe(222)
    expect(b?.prospectsOrganic).toBe(22)
  })

  it('second PUT overwrites the report values', async () => {
    const clientId = await seedClient('perreport-second')
    const { report } = await seedReport(clientId)

    const res1 = await put(report.id, { total: 100, organic: 50 })
    expect(res1.status).toBe(200)
    const res2 = await put(report.id, { total: 200, organic: 80 })
    expect(res2.status).toBe(200)

    const updated = await prisma.seoReport.findUnique({
      where: { id: report.id },
      select: { prospectsTotal: true, prospectsOrganic: true },
    })
    expect(updated?.prospectsTotal).toBe(200)
    expect(updated?.prospectsOrganic).toBe(80)
  })

  it('accepts total with organic omitted (organic defaults to null)', async () => {
    const clientId = await seedClient('perreport-no-organic')
    const { report } = await seedReport(clientId)

    const res = await put(report.id, { total: 500 })
    expect(res.status).toBe(200)

    const updated = await prisma.seoReport.findUnique({
      where: { id: report.id },
      select: { prospectsTotal: true, prospectsOrganic: true },
    })
    expect(updated?.prospectsTotal).toBe(500)
    expect(updated?.prospectsOrganic).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  it('returns 400 for negative total', async () => {
    const clientId = await seedClient('val-neg-total')
    const { report } = await seedReport(clientId)
    const res = await put(report.id, { total: -1 })
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-integer total (float)', async () => {
    const clientId = await seedClient('val-float-total')
    const { report } = await seedReport(clientId)
    const res = await put(report.id, { total: 10.5 })
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-integer total (string)', async () => {
    const clientId = await seedClient('val-str-total')
    const { report } = await seedReport(clientId)
    const res = await put(report.id, { total: '250' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for negative organic', async () => {
    const clientId = await seedClient('val-neg-organic')
    const { report } = await seedReport(clientId)
    const res = await put(report.id, { total: 100, organic: -5 })
    expect(res.status).toBe(400)
  })

  it('accepts organic: null explicitly', async () => {
    const clientId = await seedClient('val-null-organic')
    const { report } = await seedReport(clientId)
    const res = await put(report.id, { total: 100, organic: null })
    expect(res.status).toBe(200)
  })

  // ---------------------------------------------------------------------------
  // 404 for unknown report
  // ---------------------------------------------------------------------------

  it('returns 404 for an unknown report id', async () => {
    const res = await put('t24-no-such-report-id', { total: 100 })
    expect(res.status).toBe(404)
  })
})
