// lib/jobs/handlers/report-render.test.ts
//
// DB-backed tests for the report-render durable job. Browser pool and the
// data loader are mocked; SiteAudit rows are real (domain prefix c4job-) and
// REPORTS_DIR points at a per-run tmpdir.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

vi.mock('@/lib/ada-audit/browser-pool', () => ({
  acquirePage: vi.fn(),
  releasePage: vi.fn(async () => undefined),
}))
vi.mock('@/lib/report/report-data', () => ({
  loadSiteReportData: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { acquirePage, releasePage } = await import('@/lib/ada-audit/browser-pool')
const { loadSiteReportData } = await import('@/lib/report/report-data')
const { reportPath } = await import('@/lib/report/report-file')
const {
  runReportRenderJob, registerReportRenderHandler, REPORT_RENDER_JOB_TYPE,
} = await import('./report-render')
const { getJobHandler, clearJobRegistryForTests } = await import('../registry')
const { registerBuiltInJobHandlers } = await import('./register')
import type { SiteReportData } from '@/lib/report/report-html'

const PREFIX = 'c4job-'
const siteAuditIds: string[] = []
let tmpDir: string

function makePage(pdfImpl?: () => Promise<Buffer>) {
  return {
    setContent: vi.fn(async () => undefined),
    pdf: pdfImpl
      ? vi.fn(pdfImpl)
      : vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  }
}

function reportData(siteAuditId: string, domain: string): SiteReportData {
  return {
    siteAuditId,
    domain,
    clientName: null,
    wcagLevel: 'wcag21aa',
    auditDate: '2026-06-01T00:00:00.000Z',
    generatedAt: '2026-06-12T00:00:00.000Z',
    requestedBy: null,
    score: 92,
    compliant: false,
    archived: false,
    pagesTotal: 3,
    pagesError: 0,
    aggregate: { critical: 1, serious: 0, moderate: 0, minor: 0, total: 1, passed: 10, incomplete: 0 },
    archivedCounts: null,
    trend: [{ date: '2026-06-01T00:00:00.000Z', score: 92 }],
    diff: null,
    previousCompletedAt: null,
    topIssues: [],
    worstPages: [],
    issuePagesTotal: 0,
    pdfsTotal: 0,
    pdfsWithIssues: 0,
  }
}

async function seedAudit(name: string, status = 'complete') {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}${name}.example`,
      status,
      wcagLevel: 'wcag21aa',
      completedAt: status === 'complete' ? new Date('2026-06-01T00:00:00Z') : null,
    },
  })
  siteAuditIds.push(audit.id)
  return audit
}

beforeAll(async () => {
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'er-report-render-'))
  vi.stubEnv('REPORTS_DIR', tmpDir)
  vi.mocked(acquirePage).mockReset()
  vi.mocked(releasePage).mockClear()
  vi.mocked(releasePage).mockResolvedValue(undefined)
  vi.mocked(loadSiteReportData).mockReset()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

afterAll(async () => {
  if (siteAuditIds.length) {
    await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  }
})

describe('jobs/handlers/report-render', () => {
  it('happy path: writes the file, stamps reportGeneratedAt, releases the page once', async () => {
    const audit = await seedAudit('happy')
    const page = makePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    vi.mocked(loadSiteReportData).mockResolvedValue(reportData(audit.id, audit.domain))

    await runReportRenderJob({ siteAuditId: audit.id })

    const buf = await fs.readFile(reportPath(audit.id))
    expect(buf.toString()).toBe('%PDF-fake')
    expect(page.setContent).toHaveBeenCalledTimes(1)
    expect(releasePage).toHaveBeenCalledTimes(1)
    const row = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(row?.reportGeneratedAt).not.toBeNull()
  })

  it('audit missing: returns cleanly without acquiring a page', async () => {
    await expect(runReportRenderJob({ siteAuditId: 'c4job-does-not-exist' })).resolves.toBeUndefined()
    expect(acquirePage).not.toHaveBeenCalled()
    expect(loadSiteReportData).not.toHaveBeenCalled()
  })

  it('audit not complete: returns cleanly without acquiring a page (no retry)', async () => {
    const audit = await seedAudit('running', 'running')
    await expect(runReportRenderJob({ siteAuditId: audit.id })).resolves.toBeUndefined()
    expect(acquirePage).not.toHaveBeenCalled()
    expect(loadSiteReportData).not.toHaveBeenCalled()
  })

  it('loadSiteReportData null: returns cleanly, no page, no file', async () => {
    const audit = await seedAudit('nodata')
    vi.mocked(loadSiteReportData).mockResolvedValue(null)
    await expect(runReportRenderJob({ siteAuditId: audit.id })).resolves.toBeUndefined()
    expect(acquirePage).not.toHaveBeenCalled()
    await expect(fs.access(reportPath(audit.id))).rejects.toThrow()
  })

  it('audit deleted mid-render: stamp matches zero rows, file is deleted, no throw', async () => {
    const audit = await seedAudit('deleted')
    const page = makePage(async () => {
      // Simulate the audit being deleted while Chrome renders.
      await prisma.siteAudit.delete({ where: { id: audit.id } })
      return Buffer.from('%PDF-fake')
    })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    vi.mocked(loadSiteReportData).mockResolvedValue(reportData(audit.id, audit.domain))

    await expect(runReportRenderJob({ siteAuditId: audit.id })).resolves.toBeUndefined()
    expect(releasePage).toHaveBeenCalledTimes(1)
    await expect(fs.access(reportPath(audit.id))).rejects.toThrow()
  })

  it('pdf() throwing: releasePage still runs (finally) and the error propagates', async () => {
    const audit = await seedAudit('pdferr')
    const page = makePage(async () => { throw new Error('render boom') })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    vi.mocked(loadSiteReportData).mockResolvedValue(reportData(audit.id, audit.domain))

    await expect(runReportRenderJob({ siteAuditId: audit.id })).rejects.toThrow('render boom')
    expect(releasePage).toHaveBeenCalledTimes(1)
    await expect(fs.access(reportPath(audit.id))).rejects.toThrow()
    const row = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(row?.reportGeneratedAt).toBeNull()
  })

  it('registration: report-render is in the registry with the agreed knobs', () => {
    clearJobRegistryForTests()
    registerReportRenderHandler()
    const h = getJobHandler(REPORT_RENDER_JOB_TYPE)
    expect(h).toBeDefined()
    expect(h!.concurrency).toBe(1)
    expect(h!.maxAttempts).toBe(2)
    expect(h!.backoffBaseMs).toBe(15_000)
    expect(h!.timeoutMs).toBe(120_000)
    expect(h!.onExhausted).toBeDefined()
    // Built-in registration includes it too (register.ts wiring).
    clearJobRegistryForTests()
    registerBuiltInJobHandlers()
    expect(getJobHandler(REPORT_RENDER_JOB_TYPE)).toBeDefined()
  })
})
