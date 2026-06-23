// app/api/reports/[id]/prospects/route.test.ts
//
// DB-backed tests for PUT /api/reports/[id]/prospects (manual ProspectsEntry).
// Real Client/SeoReportBatch/SeoReport rows (client name prefix t24pros-).
// enqueueSeoReportRender is mocked.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jobs/handlers/seo-report-render', () => ({
  enqueueSeoReportRender: vi.fn().mockResolvedValue({ jobId: 'mocked' }),
}))

const { prisma } = await import('@/lib/db')
const { enqueueSeoReportRender } = await import('@/lib/jobs/handlers/seo-report-render')
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
// PUT — upsert ProspectsEntry + critical invariants
// ---------------------------------------------------------------------------

describe('PUT /api/reports/[id]/prospects', () => {
  it('upserts ProspectsEntry and resets metricsJson/status/prospectsStatus', async () => {
    const clientId = await seedClient('upsert-ok')
    const { report } = await seedReport(clientId)

    const res = await put(report.id, { total: 250, organic: 100 })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify ProspectsEntry was created
    const entry = await prisma.prospectsEntry.findUnique({
      where: {
        clientId_periodStart_periodEnd: {
          clientId,
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-05-31T00:00:00.000Z'),
        },
      },
    })
    expect(entry).not.toBeNull()
    expect(entry?.total).toBe(250)
    expect(entry?.organic).toBe(100)

    // CRITICAL: metricsJson must be null after update
    const updatedReport = await prisma.seoReport.findUnique({
      where: { id: report.id },
      select: { metricsJson: true, status: true, prospectsStatus: true },
    })
    expect(updatedReport?.metricsJson).toBeNull()
    expect(updatedReport?.status).toBe('queued')
    expect(updatedReport?.prospectsStatus).toBe('pending')

    // enqueueSeoReportRender must have been called with the report id
    expect(enqueueSeoReportRender).toHaveBeenCalledWith(report.id)
  })

  it('second PUT updates the same entry (upsert — no duplicate)', async () => {
    const clientId = await seedClient('upsert-second')
    const { report } = await seedReport(clientId)

    // First PUT
    const res1 = await put(report.id, { total: 100, organic: 50 })
    expect(res1.status).toBe(200)

    // Second PUT — updates the same window
    const res2 = await put(report.id, { total: 200, organic: 80 })
    expect(res2.status).toBe(200)

    // Should still be exactly 1 ProspectsEntry for this window
    const count = await prisma.prospectsEntry.count({
      where: {
        clientId,
        periodStart: new Date('2026-05-01T00:00:00.000Z'),
        periodEnd: new Date('2026-05-31T00:00:00.000Z'),
      },
    })
    expect(count).toBe(1)

    // And values should reflect the second PUT
    const entry = await prisma.prospectsEntry.findUnique({
      where: {
        clientId_periodStart_periodEnd: {
          clientId,
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-05-31T00:00:00.000Z'),
        },
      },
    })
    expect(entry?.total).toBe(200)
    expect(entry?.organic).toBe(80)
  })

  it('accepts total with organic omitted (organic defaults to null)', async () => {
    const clientId = await seedClient('upsert-no-organic')
    const { report } = await seedReport(clientId)

    const res = await put(report.id, { total: 500 })
    expect(res.status).toBe(200)

    const entry = await prisma.prospectsEntry.findUnique({
      where: {
        clientId_periodStart_periodEnd: {
          clientId,
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-05-31T00:00:00.000Z'),
        },
      },
    })
    expect(entry?.total).toBe(500)
    expect(entry?.organic).toBeNull()
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
