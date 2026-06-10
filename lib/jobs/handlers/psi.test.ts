// lib/jobs/handlers/psi.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/lighthouse-pagespeed', () => ({
  runPageSpeedInsights: vi.fn(),
}))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { runPageSpeedInsights } = await import('@/lib/ada-audit/lighthouse-pagespeed')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { runPsiJob, onPsiExhausted } = await import('./psi')

async function clearTestState() {
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://psi-handler-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'psi-handler-test-' } } })
}

async function seed(domain: string) {
  const site = await prisma.siteAudit.create({
    data: { domain: `psi-handler-test-${domain}`, status: 'lighthouse-running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
  })
  const row = await prisma.adaAudit.create({
    data: { url: `https://psi-handler-test-${domain}/p`, status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
  })
  return { site, row }
}

describe('jobs/handlers/psi', () => {
  beforeEach(async () => {
    vi.mocked(runPageSpeedInsights).mockReset()
    vi.mocked(finalizeSiteAudit).mockReset()
    vi.mocked(finalizeSiteAudit).mockResolvedValue(undefined)
    await clearTestState()
  })

  it('success: writes summary, completes row, bumps lighthouseComplete, finalizes', async () => {
    vi.mocked(runPageSpeedInsights).mockResolvedValue({
      summary: { performance: 90 } as never,
      error: null,
    })
    const { site, row } = await seed('ok.example')
    await runPsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    const final = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(final?.status).toBe('complete')
    expect(final?.lighthouseSummary).toContain('performance')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseComplete).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('PSI fetch error: records lighthouseError, completes row + job (no throw), bumps lighthouseError', async () => {
    vi.mocked(runPageSpeedInsights).mockResolvedValue({ summary: null, error: 'PSI timed out' })
    const { site, row } = await seed('fetch-err.example')
    await expect(
      runPsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' }),
    ).resolves.toBeUndefined()
    const final = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(final?.status).toBe('complete')
    expect(final?.lighthouseError).toContain('PSI timed out')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('PSI fetch throw: also recorded as lighthouseError, job completes', async () => {
    vi.mocked(runPageSpeedInsights).mockRejectedValue(new Error('network down'))
    const { site, row } = await seed('fetch-throw.example')
    await runPsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    expect((await prisma.adaAudit.findUnique({ where: { id: row.id } }))?.lighthouseError).toContain('network down')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseError).toBe(1)
  })

  it('row already terminal: no counter bump, no finalize (idempotent re-run)', async () => {
    vi.mocked(runPageSpeedInsights).mockResolvedValue({ summary: null, error: 'x' })
    const { site, row } = await seed('terminal.example')
    await prisma.adaAudit.update({ where: { id: row.id }, data: { status: 'error' } })
    await runPsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.lighthouseComplete).toBe(0)
    expect(siteFinal?.lighthouseError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('onPsiExhausted: settles the axe-complete row, bumps lighthouseError, finalizes', async () => {
    const { site, row } = await seed('exhausted.example')
    await onPsiExhausted(
      { adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' },
      { jobId: 'j1', attempts: 3, lastError: 'kept failing' },
    )
    const final = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(final?.status).toBe('complete')
    expect(final?.lighthouseError).toContain('PSI job failed after 3 attempts')
    expect(final?.lighthouseError).toContain('kept failing')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('onPsiExhausted no-ops when the row is already terminal', async () => {
    const { site, row } = await seed('exhausted-noop.example')
    await prisma.adaAudit.update({ where: { id: row.id }, data: { status: 'error' } })
    await onPsiExhausted(
      { adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' },
      { jobId: 'j1', attempts: 3, lastError: 'x' },
    )
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.lighthouseError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('rejects a malformed payload', async () => {
    await expect(runPsiJob({ nope: true } as never)).rejects.toThrow(/payload/i)
  })
})
