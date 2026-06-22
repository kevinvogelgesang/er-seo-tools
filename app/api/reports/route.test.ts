// app/api/reports/route.test.ts
//
// DB-backed tests for POST /api/reports (single-client generate).
// Real Client/SeoReportBatch/SeoReport rows (client name prefix t16post-).
// Queue is partial-mocked so no job ever runs; enqueueSeoReportRender also
// mocked to test enqueue-failure handling. REPORTS_DIR → tmpdir.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

vi.mock('@/lib/jobs/queue', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/jobs/queue')>()
  return {
    ...actual,
    enqueueJob: vi.fn(),
    cancelJobsByGroup: vi.fn(),
    countActiveJobsByGroup: vi.fn(),
  }
})

vi.mock('@/lib/jobs/handlers/seo-report-render', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/jobs/handlers/seo-report-render')>()
  return {
    ...actual,
    enqueueSeoReportRender: vi.fn(),
  }
})

const { prisma } = await import('@/lib/db')
const { enqueueSeoReportRender } = await import('@/lib/jobs/handlers/seo-report-render')
const { POST } = await import('./route')

const PREFIX = 't16post-'
const clientIds: number[] = []
let tmpDir: string

async function seedClient(suffix: string): Promise<number> {
  const client = await prisma.client.create({
    data: {
      name: `${PREFIX}${suffix}`,
      domains: JSON.stringify([`${PREFIX}${suffix}.example.com`]),
      ga4PropertyId: 'properties/999',
    },
  })
  clientIds.push(client.id)
  return client.id
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  // Clean up any leftover rows from a previous failed run
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReportBatch.deleteMany({
    where: { reports: { some: { client: { name: { startsWith: PREFIX } } } } },
  })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'er-seo-post-route-'))
  vi.stubEnv('REPORTS_DIR', tmpDir)
  vi.mocked(enqueueSeoReportRender).mockReset()
  vi.mocked(enqueueSeoReportRender).mockResolvedValue({ id: 'job-1', deduped: false })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
  // Clean up created rows
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReportBatch.deleteMany({
    where: { reports: { none: {} } },
  })
})

afterAll(async () => {
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  if (clientIds.length) {
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
  }
})

describe('POST /api/reports', () => {
  it('creates batch + report + calls enqueue; returns { batchId, reportIds }', async () => {
    const clientId = await seedClient('create-ok')
    const res = await POST(makePostRequest({
      clientId,
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      comparisonMode: 'prev_period',
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as { batchId: string; reportIds: string[] }
    expect(body.batchId).toBeTruthy()
    expect(Array.isArray(body.reportIds)).toBe(true)
    expect(body.reportIds).toHaveLength(1)
    // Verify the batch exists in DB
    const batch = await prisma.seoReportBatch.findUnique({ where: { id: body.batchId } })
    expect(batch).toBeTruthy()
    expect(batch!.trigger).toBe('manual')
    // Verify the report exists in DB
    const report = await prisma.seoReport.findUnique({ where: { id: body.reportIds[0] } })
    expect(report).toBeTruthy()
    expect(report!.clientId).toBe(clientId)
    // Verify enqueue was called
    expect(enqueueSeoReportRender).toHaveBeenCalledTimes(1)
    expect(enqueueSeoReportRender).toHaveBeenCalledWith(body.reportIds[0])
  })

  it('also accepts clientIds array with one element', async () => {
    const clientId = await seedClient('array-form')
    const res = await POST(makePostRequest({
      clientIds: [clientId],
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      comparisonMode: 'prev_year',
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as { batchId: string; reportIds: string[] }
    expect(body.reportIds).toHaveLength(1)
    expect(enqueueSeoReportRender).toHaveBeenCalledTimes(1)
  })

  it('flips report to error when enqueueSeoReportRender throws', async () => {
    const clientId = await seedClient('enq-fail')
    vi.mocked(enqueueSeoReportRender).mockRejectedValue(new Error('queue full'))
    const res = await POST(makePostRequest({
      clientId,
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      comparisonMode: 'prev_period',
    }))
    // Route still returns the batch/report info (does not 500)
    expect(res.status).toBe(201)
    const body = await res.json() as { batchId: string; reportIds: string[] }
    expect(body.reportIds).toHaveLength(1)
    // The report status must be flipped to 'error'
    const report = await prisma.seoReport.findUnique({ where: { id: body.reportIds[0] } })
    expect(report).toBeTruthy()
    expect(report!.status).toBe('error')
  })

  it('returns 400 on missing body', async () => {
    const res = await POST(new NextRequest('http://localhost/api/reports', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid comparisonMode', async () => {
    const clientId = await seedClient('bad-mode')
    const res = await POST(makePostRequest({
      clientId,
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      comparisonMode: 'invalid_mode',
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when no clientId/clientIds provided', async () => {
    const res = await POST(makePostRequest({
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      comparisonMode: 'prev_period',
    }))
    expect(res.status).toBe(400)
  })
})
