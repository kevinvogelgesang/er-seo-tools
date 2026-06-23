// app/api/reports/batch/[id]/route.test.ts
//
// DB-backed tests for GET /api/reports/batch/[id] — rollup status.
// Seed SeoReportBatch + SeoReport rows in various combinations.
// Rollup rules (from spec §7.2 / task brief):
//   running  → any child in queued|fetching|rendering
//   complete → no transient children, at least one non-error
//   error    → no transient children, ALL children are error
// 404 for unknown batch.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jobs/queue', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(), cancelJobsByGroup: vi.fn(), countActiveJobsByGroup: vi.fn() }
})

const { prisma } = await import('@/lib/db')
const { GET } = await import('./route')

const PREFIX = 't21batch-'
const seededClientIds: number[] = []

interface BatchReport {
  batchId: string
  reportIds: string[]
}

async function seedBatchWithStatuses(statuses: string[]): Promise<BatchReport> {
  // Create one client per report
  const clients = await Promise.all(
    statuses.map((_, i) =>
      prisma.client.create({
        data: {
          name: `${PREFIX}client-${Date.now()}-${i}`,
          domains: JSON.stringify([`example${i}.com`]),
        },
      })
    )
  )
  clients.forEach((c) => seededClientIds.push(c.id))

  const batch = await prisma.seoReportBatch.create({
    data: {
      trigger: 'manual',
      periodStart: new Date('2026-05-01'),
      periodEnd: new Date('2026-05-31'),
      comparisonMode: 'prev_period',
      comparisonStart: new Date('2026-04-01'),
      comparisonEnd: new Date('2026-04-30'),
      totalReports: statuses.length,
    },
  })

  const reportIds: string[] = []
  for (let i = 0; i < statuses.length; i++) {
    const report = await prisma.seoReport.create({
      data: {
        batchId: batch.id,
        clientId: clients[i].id,
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-05-31'),
        comparisonStart: new Date('2026-04-01'),
        comparisonEnd: new Date('2026-04-30'),
        status: statuses[i],
      },
    })
    reportIds.push(report.id)
  }

  return { batchId: batch.id, reportIds }
}

function makeGetRequest(batchId: string) {
  return new NextRequest(`http://localhost/api/reports/batch/${batchId}`, { method: 'GET' })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeAll(async () => {
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReportBatch.deleteMany({
    where: { reports: { some: { client: { name: { startsWith: PREFIX } } } } },
  })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

afterAll(async () => {
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReportBatch.deleteMany({
    where: { reports: { none: {} } },
  })
  if (seededClientIds.length) {
    await prisma.client.deleteMany({ where: { id: { in: seededClientIds } } })
  }
})

describe('GET /api/reports/batch/[id]', () => {
  it('returns 404 for unknown batch id', async () => {
    const res = await GET(makeGetRequest('nonexistent-batch'), makeParams('nonexistent-batch'))
    expect(res.status).toBe(404)
  })

  it('rollup status = "complete" when all children are ready', async () => {
    const { batchId } = await seedBatchWithStatuses(['ready', 'ready'])
    const res = await GET(makeGetRequest(batchId), makeParams(batchId))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      status: string
      counts: Record<string, number>
      reports: unknown[]
    }
    expect(body.status).toBe('complete')
    expect(body.counts.ready).toBe(2)
    expect(body.counts.queued).toBe(0)
    expect(body.counts.rendering).toBe(0)
    expect(body.counts.error).toBe(0)
    expect(Array.isArray(body.reports)).toBe(true)
    expect(body.reports).toHaveLength(2)
  })

  it('rollup status = "error" when ALL children are error', async () => {
    const { batchId } = await seedBatchWithStatuses(['error', 'error'])
    const res = await GET(makeGetRequest(batchId), makeParams(batchId))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; counts: Record<string, number> }
    expect(body.status).toBe('error')
    expect(body.counts.error).toBe(2)
  })

  it('rollup status = "running" when any child is queued', async () => {
    const { batchId } = await seedBatchWithStatuses(['queued', 'ready'])
    const res = await GET(makeGetRequest(batchId), makeParams(batchId))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; counts: Record<string, number> }
    expect(body.status).toBe('running')
    expect(body.counts.queued).toBe(1)
    expect(body.counts.ready).toBe(1)
  })

  it('rollup status = "running" when any child is fetching', async () => {
    const { batchId } = await seedBatchWithStatuses(['fetching', 'ready'])
    const res = await GET(makeGetRequest(batchId), makeParams(batchId))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; counts: Record<string, number> }
    expect(body.status).toBe('running')
    // fetching is bucketed under 'rendering'
    expect(body.counts.rendering).toBe(1)
  })

  it('rollup status = "running" when any child is rendering', async () => {
    const { batchId } = await seedBatchWithStatuses(['rendering', 'error'])
    const res = await GET(makeGetRequest(batchId), makeParams(batchId))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; counts: Record<string, number> }
    expect(body.status).toBe('running')
    expect(body.counts.rendering).toBe(1)
  })

  it('rollup status = "complete" when mix of ready + error (not all error)', async () => {
    const { batchId } = await seedBatchWithStatuses(['ready', 'error'])
    const res = await GET(makeGetRequest(batchId), makeParams(batchId))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; counts: Record<string, number> }
    expect(body.status).toBe('complete')
    expect(body.counts.ready).toBe(1)
    expect(body.counts.error).toBe(1)
  })

  it('reports array contains expected shape fields', async () => {
    const { batchId } = await seedBatchWithStatuses(['ready'])
    const res = await GET(makeGetRequest(batchId), makeParams(batchId))
    expect(res.status).toBe(200)
    const body = await res.json() as { reports: Array<Record<string, unknown>> }
    const report = body.reports[0]
    expect(report).toHaveProperty('id')
    expect(report).toHaveProperty('clientId')
    expect(report).toHaveProperty('status')
    expect(report).toHaveProperty('ga4Status')
    expect(report).toHaveProperty('gscStatus')
    expect(report).toHaveProperty('prospectsStatus')
    expect(report).toHaveProperty('periodStart')
    expect(report).toHaveProperty('periodEnd')
  })
})
