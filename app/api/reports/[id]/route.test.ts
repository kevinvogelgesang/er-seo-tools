// app/api/reports/[id]/route.test.ts
//
// DB-backed tests for GET /api/reports/[id] (status), GET ?file=1 (stream),
// and DELETE /api/reports/[id].
// Real Client/SeoReportBatch/SeoReport rows (client name prefix t16id-).
// Queue cancelJobsByGroup is mocked. REPORTS_DIR → tmpdir.
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
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))

const { prisma } = await import('@/lib/db')
const { cancelJobsByGroup } = await import('@/lib/jobs/queue')
const { publishInvalidation } = await import('@/lib/events/bus')
const { seoReportPath } = await import('@/lib/report/seo/seo-report-file')
const { GET, DELETE } = await import('./route')

const PREFIX = 't16id-'
const clientIds: number[] = []
let tmpDir: string

type Params = { params: Promise<{ id: string }> }

function makeParams(id: string): Params {
  return { params: Promise.resolve({ id }) }
}

function getStatus(id: string) {
  return GET(
    new NextRequest(`http://localhost/api/reports/${id}`),
    makeParams(id),
  )
}

function getFile(id: string) {
  return GET(
    new NextRequest(`http://localhost/api/reports/${id}?file=1`),
    makeParams(id),
  )
}

function del(id: string) {
  return DELETE(
    new NextRequest(`http://localhost/api/reports/${id}`, { method: 'DELETE' }),
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

async function seedReport(clientId: number, suffix: string) {
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
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
    },
  })
  return { batch, report }
}

beforeAll(async () => {
  // Clean up leftover rows from a previous failed run
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'er-seo-id-route-'))
  vi.stubEnv('REPORTS_DIR', tmpDir)
  vi.mocked(cancelJobsByGroup).mockReset()
  vi.mocked(cancelJobsByGroup).mockResolvedValue(0)
  vi.mocked(publishInvalidation).mockClear()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
  // Clean up all seeded reports/batches for this prefix
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReportBatch.deleteMany({ where: { reports: { none: {} } } })
})

afterAll(async () => {
  await prisma.seoReport.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  if (clientIds.length) {
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
  }
})

// ---------------------------------------------------------------------------
// GET status (no ?file=1)
// ---------------------------------------------------------------------------

describe('GET /api/reports/[id] — status', () => {
  it('returns status fields + generatedAt for an existing report', async () => {
    const clientId = await seedClient('status-ok')
    const { report } = await seedReport(clientId, 'status-ok')
    const res = await getStatus(report.id)
    expect(res.status).toBe(200)
    const body = await res.json() as {
      status: string
      ga4Status: string
      gscStatus: string
      prospectsStatus: string
      generatedAt: string | null
    }
    expect(body.status).toBe('ready')
    expect(body.ga4Status).toBe('ok')
    expect(body.gscStatus).toBe('skipped')
    expect(body.prospectsStatus).toBe('missing')
    expect(body.generatedAt).toBe('2026-06-01T12:00:00.000Z')
  })

  it('returns 404 for an unknown report id', async () => {
    const res = await getStatus('t16-no-such-id')
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET ?file=1 — stream
// ---------------------------------------------------------------------------

describe('GET /api/reports/[id]?file=1 — stream', () => {
  it('returns 404 when no file exists on disk', async () => {
    const clientId = await seedClient('file-nofile')
    const { report } = await seedReport(clientId, 'file-nofile')
    const res = await getFile(report.id)
    expect(res.status).toBe(404)
  })

  it('streams application/pdf with Content-Disposition when file exists', async () => {
    const clientId = await seedClient('file-ok')
    const { report } = await seedReport(clientId, 'file-ok')
    // Write a fake PDF at the derived path
    const filePath = seoReportPath(report.id)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, Buffer.from('%PDF-fake-seo'))
    const res = await getFile(report.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    const cd = res.headers.get('Content-Disposition') ?? ''
    expect(cd).toContain(`filename="seo-report-${report.id}.pdf"`)
    const content = Buffer.from(await res.arrayBuffer()).toString()
    expect(content).toBe('%PDF-fake-seo')
  })

  it('returns 404 for an unknown report id', async () => {
    const res = await getFile('t16-no-such-id-file')
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/reports/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/reports/[id]', () => {
  it('cancels jobs, deletes the row, and unlinks the file', async () => {
    const clientId = await seedClient('delete-ok')
    const { report } = await seedReport(clientId, 'delete-ok')
    // Write a fake file so we can verify it gets deleted
    const filePath = seoReportPath(report.id)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, Buffer.from('%PDF-to-delete'))

    const res = await del(report.id)
    expect(res.status).toBe(200)

    // cancelJobsByGroup called with correct group key
    expect(cancelJobsByGroup).toHaveBeenCalledWith(`seo-report:${report.id}`)

    // Row deleted
    const gone = await prisma.seoReport.findUnique({ where: { id: report.id } })
    expect(gone).toBeNull()

    // File deleted
    const fileExists = await fs.access(filePath).then(() => true, () => false)
    expect(fileExists).toBe(false)

    // A5 Task 18: deleting a report invalidates the shared list.
    expect(publishInvalidation).toHaveBeenCalledWith('report-list')
  })

  it('returns 200 even when file does not exist (best-effort unlink)', async () => {
    const clientId = await seedClient('delete-nofile')
    const { report } = await seedReport(clientId, 'delete-nofile')
    // No file on disk
    const res = await del(report.id)
    expect(res.status).toBe(200)
    expect(cancelJobsByGroup).toHaveBeenCalledWith(`seo-report:${report.id}`)
    const gone = await prisma.seoReport.findUnique({ where: { id: report.id } })
    expect(gone).toBeNull()
  })

  it('returns 404 for an unknown report id and does not emit', async () => {
    const res = await del('t16-no-such-id-del')
    expect(res.status).toBe(404)
    expect(publishInvalidation).not.toHaveBeenCalled()
  })
})
