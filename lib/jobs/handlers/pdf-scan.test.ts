// lib/jobs/handlers/pdf-scan.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/pdf-runner', () => ({
  scanPdfUrl: vi.fn(),
}))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { scanPdfUrl } = await import('@/lib/ada-audit/pdf-runner')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { runPdfScanJob, onPdfScanExhausted, settlePdfFailure } = await import('./pdf-scan')

async function clearTestState() {
  await prisma.pdfAudit.deleteMany({ where: { url: { startsWith: 'https://pdf-handler-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://pdf-handler-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'pdf-handler-test-' } } })
}

async function seedSite(domain: string, pdfStatus = 'pending') {
  const site = await prisma.siteAudit.create({
    data: { domain: `pdf-handler-test-${domain}`, status: 'pdfs-running', wcagLevel: 'wcag21aa', pdfsTotal: 1 },
  })
  const url = `https://pdf-handler-test-${domain}/doc.pdf`
  const pdf = await prisma.pdfAudit.create({
    data: { siteAuditId: site.id, url, status: pdfStatus },
  })
  return { site, pdf, url }
}

describe('jobs/handlers/pdf-scan', () => {
  beforeEach(async () => {
    vi.mocked(scanPdfUrl).mockReset()
    vi.mocked(finalizeSiteAudit).mockReset()
    vi.mocked(finalizeSiteAudit).mockResolvedValue(undefined)
    await clearTestState()
  })

  it('success: settles row with scan fields, bumps pdfsComplete, finalizes', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 1234, pageCount: 3,
      issues: [{ code: 'no-title', severity: 'medium', title: 't', description: 'd', remediation: 'r' }],
    } as never)
    const { site, url } = await seedSite('ok.example')
    await runPdfScanJob({ url, siteAuditId: site.id, sourcePageUrl: 'https://pdf-handler-test-ok.example/page' })
    expect(scanPdfUrl).toHaveBeenCalledWith(url, { referer: 'https://pdf-handler-test-ok.example/page' })
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('complete')
    expect(row?.fileSize).toBe(1234)
    expect(row?.pageCount).toBe(3)
    expect(JSON.parse(row!.issues!)).toHaveLength(1)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsComplete).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('scan error: domain result — row error, pdfsError++, job completes (no throw)', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: null, pageCount: null, issues: [], scanError: 'HTTP 403',
    } as never)
    const { site, url } = await seedSite('err.example')
    await expect(runPdfScanJob({ url, siteAuditId: site.id })).resolves.toBeUndefined()
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toBe('HTTP 403')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('skip (oversize): row skipped with skipReason, pdfsSkipped++', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: null, pageCount: null, issues: [], skipReason: 'oversize',
    } as never)
    const { site, url } = await seedSite('skip.example')
    await runPdfScanJob({ url, siteAuditId: site.id })
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('skipped')
    expect(row?.skipReason).toBe('oversize')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsSkipped).toBe(1)
  })

  it('standalone (adaAuditId only): settles the row, no finalize call', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 10, pageCount: 1, issues: [],
    } as never)
    const ada = await prisma.adaAudit.create({
      data: { url: 'https://pdf-handler-test-solo.example/page', status: 'complete', wcagLevel: 'wcag21aa' },
    })
    const url = 'https://pdf-handler-test-solo.example/doc.pdf'
    await prisma.pdfAudit.create({ data: { adaAuditId: ada.id, url, status: 'pending' } })
    await runPdfScanJob({ url, adaAuditId: ada.id })
    const row = await prisma.pdfAudit.findFirst({ where: { adaAuditId: ada.id, url } })
    expect(row?.status).toBe('complete')
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('re-run on a scanning row (crash retry): claims and settles', async () => {
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 10, pageCount: 1, issues: [],
    } as never)
    const { site, url } = await seedSite('rerun.example', 'scanning')
    await runPdfScanJob({ url, siteAuditId: site.id })
    expect((await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } }))?.status).toBe('complete')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsComplete).toBe(1)
  })

  it('row already terminal: no scan, no counter bump, no finalize (idempotent)', async () => {
    const { site, url } = await seedSite('terminal.example', 'error')
    await runPdfScanJob({ url, siteAuditId: site.id })
    expect(scanPdfUrl).not.toHaveBeenCalled()
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.pdfsComplete).toBe(0)
    expect(siteFinal?.pdfsError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('onPdfScanExhausted: settles the row as error, bumps pdfsError, finalizes', async () => {
    const { site, url } = await seedSite('exhausted.example', 'scanning')
    await onPdfScanExhausted(
      { url, siteAuditId: site.id },
      { jobId: 'j1', attempts: 3, lastError: 'kept failing' },
    )
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toContain('PDF scan job failed after 3 attempts')
    expect(row?.scanError).toContain('kept failing')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('onPdfScanExhausted no-ops when the row is already terminal', async () => {
    const { site, url } = await seedSite('exhausted-noop.example', 'complete')
    await onPdfScanExhausted(
      { url, siteAuditId: site.id },
      { jobId: 'j1', attempts: 3, lastError: 'x' },
    )
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('settlePdfFailure claims a pending row too (enqueue-failure path)', async () => {
    const { site, url } = await seedSite('enqueue-fail.example', 'pending')
    await settlePdfFailure({ url, siteAuditId: site.id }, 'Failed to enqueue durable PDF scan job: boom')
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toContain('Failed to enqueue')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsError).toBe(1)
  })

  it('settle failure leaves the row reclaimable with no counter drift, and the job throws (retryable)', async () => {
    // The legacy PSI path's wedge class: row flips terminal but the counter
    // bump fails, and a retry no-ops forever. The one-transaction settle
    // makes that impossible — prove the failure half: a failed settle
    // transaction leaves the row in 'scanning' (the next attempt reclaims
    // it) and never bumps a counter.
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 10, pageCount: 1, issues: [],
    } as never)
    const { site, url } = await seedSite('tx-fail.example')
    const txSpy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    try {
      await expect(runPdfScanJob({ url, siteAuditId: site.id })).rejects.toThrow('SQLITE_BUSY')
    } finally {
      txSpy.mockRestore()
    }
    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('scanning') // non-terminal — the retry reclaims it
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.pdfsComplete).toBe(0)
    expect(siteFinal?.pdfsError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('settle bumps SiteAudit.updatedAt (stale-recovery heartbeat)', async () => {
    // The counter bump is raw SQL (array-form txn), which bypasses Prisma's
    // @updatedAt — the statement must set updatedAt manually, in the integer
    // ms format Prisma uses for SQLite, or resetStaleAudits mis-orders it.
    vi.mocked(scanPdfUrl).mockResolvedValue({
      url: 'x', fileSize: 10, pageCount: 1, issues: [],
    } as never)
    const { site, url } = await seedSite('heartbeat.example')
    const backdated = Date.now() - 60 * 60 * 1000
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${backdated} WHERE "id" = ${site.id}`
    await runPdfScanJob({ url, siteAuditId: site.id })
    const fresh = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(fresh!.updatedAt).toBeInstanceOf(Date)
    expect(fresh!.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('rejects a malformed payload', async () => {
    await expect(runPdfScanJob({ nope: true } as never)).rejects.toThrow(/payload/i)
    await expect(runPdfScanJob({ url: 'https://x/doc.pdf' } as never)).rejects.toThrow(/payload/i)
  })
})
