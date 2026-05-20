import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub the PSI provider so the test controls timing.
vi.mock('@/lib/ada-audit/lighthouse-pagespeed', () => ({
  runPageSpeedInsights: vi.fn(),
}))
// Stub the finalizer so we can assert it was called without exercising the real one.
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { runPageSpeedInsights } = await import('@/lib/ada-audit/lighthouse-pagespeed')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { enqueuePsiJob, getPsiQueueState } = await import('./lighthouse-queue')

async function clearTestState() {
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://psi-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'psi-test-' } } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('lighthouse-queue', () => {
  beforeEach(async () => {
    vi.mocked(runPageSpeedInsights).mockReset()
    vi.mocked(finalizeSiteAudit).mockReset()
    await clearTestState()
  })

  it('honors PSI_CONCURRENCY cap — never runs more than N workers at once', async () => {
    // Reset the module so it re-reads PSI_CONCURRENCY=2 from the test env.
    vi.resetModules()
    process.env.PSI_CONCURRENCY = '2'
    const { enqueuePsiJob, getPsiQueueState } = await import('./lighthouse-queue')

    const gates = [deferred<{ summary: null; error: string | null }>(), deferred<{ summary: null; error: string | null }>(), deferred<{ summary: null; error: string | null }>(), deferred<{ summary: null; error: string | null }>()]
    vi.mocked(runPageSpeedInsights)
      .mockImplementationOnce(async () => gates[0].promise)
      .mockImplementationOnce(async () => gates[1].promise)
      .mockImplementationOnce(async () => gates[2].promise)
      .mockImplementationOnce(async () => gates[3].promise)

    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-cap.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 4 },
    })
    const rows = await Promise.all([0, 1, 2, 3].map((i) =>
      prisma.adaAudit.create({
        data: { url: `https://psi-test-cap.example/p${i}`, status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
      })
    ))

    rows.forEach((r, i) =>
      enqueuePsiJob({ adaAuditId: r.id, siteAuditId: site.id, url: r.url, wcagLevel: 'wcag21aa' })
    )

    // Yield once so the workers can pick up jobs.
    await new Promise((r) => setImmediate(r))
    expect(getPsiQueueState().active).toBeLessThanOrEqual(2)
    expect(getPsiQueueState().queued).toBeGreaterThanOrEqual(2)

    // Release one — that frees a slot, the next job should start.
    gates[0].resolve({ summary: null, error: 'test' })
    await new Promise((r) => setImmediate(r))
    expect(getPsiQueueState().active).toBeLessThanOrEqual(2)

    // Release the rest.
    gates[1].resolve({ summary: null, error: 'test' })
    gates[2].resolve({ summary: null, error: 'test' })
    gates[3].resolve({ summary: null, error: 'test' })
    // Yield repeatedly until drained. Prisma's native engine uses many internal
    // async ticks, so we poll with setTimeout to give it enough elapsed time.
    for (let i = 0; i < 10 && getPsiQueueState().active + getPsiQueueState().queued > 0; i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(getPsiQueueState()).toEqual({ active: 0, queued: 0 })
  })

  it('writes lighthouseSummary, flips AdaAudit to complete, bumps lighthouseComplete on success', async () => {
    vi.resetModules()
    process.env.PSI_CONCURRENCY = '1'
    const { enqueuePsiJob } = await import('./lighthouse-queue')
    vi.mocked(runPageSpeedInsights).mockResolvedValue({
      summary: { performance: 90, accessibility: 95, bestPractices: 92 } as never,
      error: null,
    })

    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-success.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
    })
    const row = await prisma.adaAudit.create({
      data: { url: 'https://psi-test-success.example/p', status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })

    enqueuePsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setImmediate(r))
      const fresh = await prisma.adaAudit.findUnique({ where: { id: row.id } })
      if (fresh?.status === 'complete') break
    }
    const final = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(final?.status).toBe('complete')
    expect(final?.lighthouseSummary).toContain('performance')
    expect(final?.lighthouseError).toBeNull()
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.lighthouseComplete).toBe(1)
    expect(siteFinal?.lighthouseError).toBe(0)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('writes lighthouseError, still flips AdaAudit to complete, bumps lighthouseError on failure', async () => {
    vi.resetModules()
    process.env.PSI_CONCURRENCY = '1'
    const { enqueuePsiJob } = await import('./lighthouse-queue')
    vi.mocked(runPageSpeedInsights).mockResolvedValue({
      summary: null,
      error: 'PSI timed out after 90000ms.',
    })

    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-fail.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
    })
    const row = await prisma.adaAudit.create({
      data: { url: 'https://psi-test-fail.example/p', status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })

    enqueuePsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setImmediate(r))
      const fresh = await prisma.adaAudit.findUnique({ where: { id: row.id } })
      if (fresh?.status === 'complete') break
    }
    const final = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(final?.status).toBe('complete')
    expect(final?.lighthouseSummary).toBeNull()
    expect(final?.lighthouseError).toContain('PSI timed out')
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.lighthouseError).toBe(1)
    expect(siteFinal?.lighthouseComplete).toBe(0)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })
})
