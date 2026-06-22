// lib/jobs/handlers/seo-report-render.test.ts
//
// DB-backed tests for the seo-report-render durable job. Browser pool and
// analytics providers are mocked; SeoReport/SeoReportBatch/Client rows are
// real (domain prefix seo-rj-) and REPORTS_DIR points at a per-run tmpdir.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

vi.mock('@/lib/ada-audit/browser-pool', () => ({
  acquirePage: vi.fn(),
  releasePage: vi.fn(async () => undefined),
}))
vi.mock('@/lib/analytics/google/ga4-provider', () => ({
  fetchGa4: vi.fn(),
}))
vi.mock('@/lib/analytics/google/gsc-provider', () => ({
  fetchGsc: vi.fn(),
}))
vi.mock('@/lib/analytics/prospects/prospects-provider', () => ({
  fetchProspects: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { acquirePage, releasePage } = await import('@/lib/ada-audit/browser-pool')
const { fetchGa4 } = await import('@/lib/analytics/google/ga4-provider')
const { fetchGsc } = await import('@/lib/analytics/google/gsc-provider')
const { fetchProspects } = await import('@/lib/analytics/prospects/prospects-provider')
const { seoReportPath } = await import('@/lib/report/seo/seo-report-file')
const {
  runSeoReportRenderJob,
  registerSeoReportRenderHandler,
  SEO_REPORT_RENDER_JOB_TYPE,
} = await import('./seo-report-render')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')
const { registerBuiltInJobHandlers } = await import('./register')

import type { SourceResult } from '@/lib/analytics/types'
import type { Ga4Bundle, GscBundle, ProspectsBundle } from '@/lib/analytics/types'

// ─── Mock return value helpers ───────────────────────────────────────────────

function okGa4(): SourceResult<Ga4Bundle> {
  return {
    ok: true,
    data: {
      totals: { sessions: 100, engagedSessions: 50, averageSessionDuration: 120, eventsPerSession: 3, bounceRate: 0.4, keyEvents: 5 },
      comparisonTotals: { sessions: 80, engagedSessions: 40, averageSessionDuration: 100, eventsPerSession: 2, bounceRate: 0.45, keyEvents: 4 },
      sessionsSeries: [],
      sessionsSeriesPrev: [],
      landingPages: [],
      cities: [],
      newVsReturning: [],
      devices: [],
    },
  }
}

function okGsc(): SourceResult<GscBundle> {
  return {
    ok: true,
    data: {
      totals: { clicks: 200, impressions: 5000, ctr: 0.04, position: 8.5 },
      comparisonTotals: { clicks: 150, impressions: 4000, ctr: 0.0375, position: 9.0 },
      clicksSeries: [],
      clicksSeriesPrev: [],
      impressionsSeries: [],
      impressionsSeriesPrev: [],
      positionSeries: [],
      positionSeriesPrev: [],
      queries: [],
    },
  }
}

function okProspects(): SourceResult<ProspectsBundle> {
  return { ok: true, data: { total: 12, organic: 8 } }
}

function errGa4(): SourceResult<Ga4Bundle> { return { ok: false, reason: 'error' } }
function errGsc(): SourceResult<GscBundle> { return { ok: false, reason: 'error' } }
function errProspects(): SourceResult<ProspectsBundle> { return { ok: false, reason: 'unmapped' } }

// ─── Seeding helpers ─────────────────────────────────────────────────────────

const PREFIX = 'seo-rj-'
const clientIds: number[] = []
const batchIds: string[] = []
const reportIds: string[] = []
let tmpDir: string

async function seedClient(suffix: string) {
  const client = await prisma.client.create({
    data: {
      name: `${PREFIX}client-${suffix}`,
      domains: '["example.com"]',
      ga4PropertyId: 'prop-123',
      gscSiteUrl: 'sc-domain:example.com',
      crmClientRef: null,
    },
  })
  clientIds.push(client.id)
  return client
}

async function seedBatch(suffix: string, trigger = 'manual') {
  const batch = await prisma.seoReportBatch.create({
    data: {
      trigger,
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T00:00:00Z'),
      comparisonMode: 'prev_period',
      comparisonStart: new Date('2026-04-01T00:00:00Z'),
      comparisonEnd: new Date('2026-04-30T00:00:00Z'),
      status: 'running',
      createdBy: trigger === 'manual' ? 'operator' : null,
    },
  })
  batchIds.push(batch.id)
  return batch
}

async function seedReport(
  clientId: number,
  batchId: string,
  extra?: Partial<{
    status: string
    metricsJson: string
    ga4Status: string
    gscStatus: string
    prospectsStatus: string
  }>
) {
  const report = await prisma.seoReport.create({
    data: {
      batchId,
      clientId,
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T00:00:00Z'),
      comparisonStart: new Date('2026-04-01T00:00:00Z'),
      comparisonEnd: new Date('2026-04-30T00:00:00Z'),
      status: 'queued',
      ...extra,
    },
  })
  reportIds.push(report.id)
  return report
}

function makePage(pdfImpl?: () => Promise<Buffer>) {
  return {
    setContent: vi.fn(async () => undefined),
    pdf: pdfImpl
      ? vi.fn(pdfImpl)
      : vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  await prisma.seoReport.deleteMany({ where: { batch: { trigger: { startsWith: 'manual' } }, client: { name: { startsWith: PREFIX } } } })
  await prisma.seoReportBatch.deleteMany({ where: { reports: { some: { client: { name: { startsWith: PREFIX } } } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'er-seo-report-render-'))
  vi.stubEnv('REPORTS_DIR', tmpDir)
  vi.mocked(acquirePage).mockReset()
  vi.mocked(releasePage).mockClear()
  vi.mocked(releasePage).mockResolvedValue(undefined)
  vi.mocked(fetchGa4).mockReset()
  vi.mocked(fetchGsc).mockReset()
  vi.mocked(fetchProspects).mockReset()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

afterAll(async () => {
  if (reportIds.length) {
    await prisma.seoReport.deleteMany({ where: { id: { in: reportIds } } })
  }
  if (batchIds.length) {
    await prisma.seoReportBatch.deleteMany({ where: { id: { in: batchIds } } })
  }
  if (clientIds.length) {
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
  }
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('jobs/handlers/seo-report-render', () => {
  it('happy path (scheduled batch): writes file, stamps generatedAt, retainUntil ~730d, status ready', async () => {
    const client = await seedClient('happy-scheduled')
    const batch = await seedBatch('happy-scheduled', 'scheduled')
    const report = await seedReport(client.id, batch.id)

    const page = makePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    vi.mocked(fetchGa4).mockResolvedValue(okGa4())
    vi.mocked(fetchGsc).mockResolvedValue(okGsc())
    vi.mocked(fetchProspects).mockResolvedValue(okProspects())

    await runSeoReportRenderJob({ seoReportId: report.id })

    // File written
    const buf = await fs.readFile(seoReportPath(report.id))
    expect(buf.toString()).toBe('%PDF-fake')

    // DB row updated
    const row = await prisma.seoReport.findUnique({ where: { id: report.id } })
    expect(row?.status).toBe('ready')
    expect(row?.generatedAt).not.toBeNull()

    // retainUntil ~ 730 days from now
    const daysFromNow = (row!.retainUntil!.getTime() - Date.now()) / 86400_000
    expect(daysFromNow).toBeGreaterThan(728)
    expect(daysFromNow).toBeLessThan(732)

    // Providers called
    expect(fetchGa4).toHaveBeenCalledTimes(1)
    expect(fetchGsc).toHaveBeenCalledTimes(1)
    expect(fetchProspects).toHaveBeenCalledTimes(1)

    // Page released
    expect(releasePage).toHaveBeenCalledTimes(1)

    // metricsJson persisted
    const refreshed = await prisma.seoReport.findUnique({ where: { id: report.id } })
    expect(refreshed?.metricsJson).not.toBeNull()
  })

  it('happy path (manual batch): retainUntil ~90 days', async () => {
    const client = await seedClient('happy-manual')
    const batch = await seedBatch('happy-manual', 'manual')
    const report = await seedReport(client.id, batch.id)

    const page = makePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    vi.mocked(fetchGa4).mockResolvedValue(okGa4())
    vi.mocked(fetchGsc).mockResolvedValue(okGsc())
    vi.mocked(fetchProspects).mockResolvedValue(okProspects())

    await runSeoReportRenderJob({ seoReportId: report.id })

    const row = await prisma.seoReport.findUnique({ where: { id: report.id } })
    expect(row?.status).toBe('ready')
    const daysFromNow = (row!.retainUntil!.getTime() - Date.now()) / 86400_000
    expect(daysFromNow).toBeGreaterThan(88)
    expect(daysFromNow).toBeLessThan(92)
  })

  it('metricsJson already present → providers NOT called, file still written + status ready', async () => {
    const client = await seedClient('snapshot')
    const batch = await seedBatch('snapshot', 'manual')

    // Pre-populate a valid bundle snapshot
    const bundle = {
      period: { start: '2026-05-01', end: '2026-05-31' },
      comparison: { start: '2026-04-01', end: '2026-04-30' },
      ga4: okGa4(),
      gsc: okGsc(),
      prospects: okProspects(),
    }
    const report = await seedReport(client.id, batch.id, {
      metricsJson: JSON.stringify(bundle),
    })

    const page = makePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)

    await runSeoReportRenderJob({ seoReportId: report.id })

    // Providers NOT called
    expect(fetchGa4).not.toHaveBeenCalled()
    expect(fetchGsc).not.toHaveBeenCalled()
    expect(fetchProspects).not.toHaveBeenCalled()

    // File still written
    const buf = await fs.readFile(seoReportPath(report.id))
    expect(buf.toString()).toBe('%PDF-fake')

    // Status ready
    const row = await prisma.seoReport.findUnique({ where: { id: report.id } })
    expect(row?.status).toBe('ready')
  })

  it('per-source error: GA4 not-ok → ga4Status=error, report still renders + ready', async () => {
    const client = await seedClient('ga4err')
    const batch = await seedBatch('ga4err', 'manual')
    const report = await seedReport(client.id, batch.id)

    const page = makePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    vi.mocked(fetchGa4).mockResolvedValue(errGa4())
    vi.mocked(fetchGsc).mockResolvedValue(okGsc())
    vi.mocked(fetchProspects).mockResolvedValue(okProspects())

    await runSeoReportRenderJob({ seoReportId: report.id })

    const row = await prisma.seoReport.findUnique({ where: { id: report.id } })
    expect(row?.ga4Status).toBe('error')
    expect(row?.status).toBe('ready')

    // File still written
    await expect(fs.access(seoReportPath(report.id))).resolves.toBeUndefined()
    // acquirePage was called
    expect(acquirePage).toHaveBeenCalledTimes(1)
  })

  it('total failure: all three sources not-ok → status=error, acquirePage NOT called', async () => {
    const client = await seedClient('totalfail')
    const batch = await seedBatch('totalfail', 'manual')
    const report = await seedReport(client.id, batch.id)

    vi.mocked(fetchGa4).mockResolvedValue(errGa4())
    vi.mocked(fetchGsc).mockResolvedValue(errGsc())
    vi.mocked(fetchProspects).mockResolvedValue(errProspects())

    await runSeoReportRenderJob({ seoReportId: report.id })

    expect(acquirePage).not.toHaveBeenCalled()

    const row = await prisma.seoReport.findUnique({ where: { id: report.id } })
    expect(row?.status).toBe('error')
    await expect(fs.access(seoReportPath(report.id))).rejects.toThrow()
  })

  it('row deleted mid-render → file cleaned up, settles without throwing', async () => {
    const client = await seedClient('deleted')
    const batch = await seedBatch('deleted', 'manual')
    const report = await seedReport(client.id, batch.id)

    const page = makePage(async () => {
      // Simulate the row being deleted while Chrome renders.
      await prisma.seoReport.delete({ where: { id: report.id } })
      // Remove from cleanup list since we already deleted it
      const idx = reportIds.indexOf(report.id)
      if (idx !== -1) reportIds.splice(idx, 1)
      return Buffer.from('%PDF-fake')
    })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    vi.mocked(fetchGa4).mockResolvedValue(okGa4())
    vi.mocked(fetchGsc).mockResolvedValue(okGsc())
    vi.mocked(fetchProspects).mockResolvedValue(okProspects())

    await expect(runSeoReportRenderJob({ seoReportId: report.id })).resolves.toBeUndefined()
    expect(releasePage).toHaveBeenCalledTimes(1)
    // File should have been deleted
    await expect(fs.access(seoReportPath(report.id))).rejects.toThrow()
  })

  it('releasePage always called (finally), including when page.pdf throws', async () => {
    const client = await seedClient('pdferr')
    const batch = await seedBatch('pdferr', 'manual')
    const report = await seedReport(client.id, batch.id)

    const page = makePage(async () => { throw new Error('render boom') })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    vi.mocked(fetchGa4).mockResolvedValue(okGa4())
    vi.mocked(fetchGsc).mockResolvedValue(okGsc())
    vi.mocked(fetchProspects).mockResolvedValue(okProspects())

    await expect(runSeoReportRenderJob({ seoReportId: report.id })).rejects.toThrow('render boom')
    expect(releasePage).toHaveBeenCalledTimes(1)
    // No file written
    await expect(fs.access(seoReportPath(report.id))).rejects.toThrow()
  })

  it('row missing: returns cleanly without acquiring a page or calling providers', async () => {
    await expect(runSeoReportRenderJob({ seoReportId: 'seo-rj-does-not-exist' })).resolves.toBeUndefined()
    expect(acquirePage).not.toHaveBeenCalled()
    expect(fetchGa4).not.toHaveBeenCalled()
  })

  it('registration: seo-report-render is in the registry with correct knobs', () => {
    clearJobRegistryForTests()
    registerSeoReportRenderHandler()
    const h = getJobHandler(SEO_REPORT_RENDER_JOB_TYPE)
    expect(h).toBeDefined()
    expect(h!.concurrency).toBe(1)
    expect(h!.maxAttempts).toBe(2)
    expect(h!.backoffBaseMs).toBe(15_000)
    expect(h!.timeoutMs).toBe(600_000)
    expect(h!.onExhausted).toBeDefined()
    // Built-in registration includes it too
    clearJobRegistryForTests()
    registerBuiltInJobHandlers()
    expect(getJobHandler(SEO_REPORT_RENDER_JOB_TYPE)).toBeDefined()
  })

  it('enqueueSeoReportRender guards group/dedup key to seo-report:<id>', async () => {
    const { enqueueSeoReportRender } = await import('./seo-report-render')
    const testId = 'seo-rj-enqueue-key-test'

    const result = await enqueueSeoReportRender(testId)
    expect(result.id).toBeDefined()

    // Read the Job row from DB to verify both keys
    const job = await prisma.job.findFirst({
      where: { dedupKey: `seo-report:${testId}` },
    })
    expect(job).toBeDefined()
    expect(job!.type).toBe(SEO_REPORT_RENDER_JOB_TYPE)
    expect(job!.dedupKey).toBe(`seo-report:${testId}`)
    expect(job!.groupKey).toBe(`seo-report:${testId}`)

    // Clean up
    await prisma.job.delete({ where: { id: job!.id } })
  })
})
