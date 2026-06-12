import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/audit-batch-helpers', () => ({
  closeBatchIfDrained: vi.fn(async () => undefined),
}))
// finalizeSiteAudit dynamic-imports queue-manager to kick processNext.
// Mock it so the test doesn't pull the real queue runner (with side effects
// and a queue-manager → finalizer cycle) into scope.
vi.mock('@/lib/ada-audit/queue-manager', () => ({
  processNext: vi.fn(async () => undefined),
}))
// C2: neutralize the carry-forward completion hook so these tests don't hit
// the real module (ordering/isolation is covered in the .findings test file).
vi.mock('@/lib/ada-audit/carry-forward-checks', () => ({
  carryForwardSiteAuditChecks: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { finalizeSiteAudit } = await import('./site-audit-finalizer')
const { processNext } = await import('@/lib/ada-audit/queue-manager')

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: 'finalize-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://finalize-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'finalize-test-' } } })
}

async function makeAudit(overrides: Partial<{
  status: string
  discoveredUrls: string | null
  pagesTotal: number; pagesComplete: number; pagesError: number
  pdfsTotal: number; pdfsComplete: number; pdfsError: number; pdfsSkipped: number
  lighthouseTotal: number; lighthouseComplete: number; lighthouseError: number
}>) {
  return prisma.siteAudit.create({
    data: {
      domain: `finalize-test-${Math.random().toString(36).slice(2, 8)}.example`,
      status: overrides.status ?? 'running',
      // Discovery-done marker: a running audit with null discoveredUrls is
      // owned by the discover handler and the finalizer must not touch it.
      // Default to '[]' so the drain-predicate tests exercise what they mean.
      discoveredUrls: overrides.discoveredUrls === undefined ? '[]' : overrides.discoveredUrls,
      wcagLevel: 'wcag21aa',
      pagesTotal: overrides.pagesTotal ?? 0,
      pagesComplete: overrides.pagesComplete ?? 0,
      pagesError: overrides.pagesError ?? 0,
      pdfsTotal: overrides.pdfsTotal ?? 0,
      pdfsComplete: overrides.pdfsComplete ?? 0,
      pdfsError: overrides.pdfsError ?? 0,
      pdfsSkipped: overrides.pdfsSkipped ?? 0,
      lighthouseTotal: overrides.lighthouseTotal ?? 0,
      lighthouseComplete: overrides.lighthouseComplete ?? 0,
      lighthouseError: overrides.lighthouseError ?? 0,
    },
  })
}

describe('finalizeSiteAudit — centralized drain predicate', () => {
  beforeEach(async () => {
    vi.mocked(processNext).mockClear()
    await clearTestState()
  })

  it('does NOT finalize when lighthouse is still draining (pages done, lh pending)', async () => {
    const audit = await makeAudit({
      pagesTotal: 3, pagesComplete: 3,
      lighthouseTotal: 3, lighthouseComplete: 1,
    })
    await finalizeSiteAudit(audit.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.status).toBe('lighthouse-running')
    expect(after?.summary).toBeNull()
    expect(processNext).not.toHaveBeenCalled()
  })

  it('does NOT finalize when PDFs are still draining (pages done, pdfs pending, lh done)', async () => {
    const audit = await makeAudit({
      pagesTotal: 3, pagesComplete: 3,
      pdfsTotal: 2, pdfsComplete: 1,
      lighthouseTotal: 3, lighthouseComplete: 3,
    })
    await finalizeSiteAudit(audit.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.status).toBe('pdfs-running')
    expect(after?.summary).toBeNull()
    expect(processNext).not.toHaveBeenCalled()
  })

  it('PDFs win over lighthouse for transient status when both are outstanding', async () => {
    const audit = await makeAudit({
      pagesTotal: 3, pagesComplete: 3,
      pdfsTotal: 2, pdfsComplete: 1,
      lighthouseTotal: 3, lighthouseComplete: 1,
    })
    await finalizeSiteAudit(audit.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.status).toBe('pdfs-running')
    expect(processNext).not.toHaveBeenCalled()
  })

  it('finalizes to complete when pages, PDFs, and lighthouse are all drained', async () => {
    const audit = await makeAudit({
      pagesTotal: 2, pagesComplete: 2,
      pdfsTotal: 1, pdfsComplete: 1,
      lighthouseTotal: 2, lighthouseComplete: 1, lighthouseError: 1,
    })
    await finalizeSiteAudit(audit.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.status).toBe('complete')
    expect(after?.summary).not.toBeNull()
    expect(processNext).toHaveBeenCalled()
  })

  it('is idempotent — calling on an already-complete audit is a no-op', async () => {
    const audit = await makeAudit({
      status: 'complete',
      pagesTotal: 2, pagesComplete: 2,
      lighthouseTotal: 2, lighthouseComplete: 2,
    })
    // Manually set a summary so we can detect overwrites.
    await prisma.siteAudit.update({ where: { id: audit.id }, data: { summary: '{"sentinel":true}' } })
    await finalizeSiteAudit(audit.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.summary).toBe('{"sentinel":true}')
    expect(processNext).not.toHaveBeenCalled()
  })

  it('returns without changing status when pages are not done', async () => {
    const audit = await makeAudit({
      pagesTotal: 5, pagesComplete: 2,
      lighthouseTotal: 2, lighthouseComplete: 2,
    })
    await finalizeSiteAudit(audit.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.status).toBe('running')
    expect(processNext).not.toHaveBeenCalled()
  })

  it('finalizes a zero-work audit (no pages, no pdfs, no lighthouse)', async () => {
    const audit = await makeAudit({ pagesTotal: 0 })
    await finalizeSiteAudit(audit.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.status).toBe('complete')
    expect(processNext).toHaveBeenCalled()
  })

  it('treats skipped PDFs as terminal — site flips to complete when only skipped + complete remain', async () => {
    const audit = await makeAudit({
      pagesTotal: 3, pagesComplete: 3,
      pdfsTotal: 3, pdfsComplete: 2, pdfsError: 0, pdfsSkipped: 1,
      lighthouseTotal: 3, lighthouseComplete: 3,
    })
    await finalizeSiteAudit(audit.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.status).toBe('complete')
    expect(after?.summary).not.toBeNull()
    expect(processNext).toHaveBeenCalled()
  })
})

describe('finalizeSiteAudit — phase 3 guards', () => {
  beforeEach(async () => {
    vi.mocked(processNext).mockClear()
    await clearTestState()
  })

  it('leaves a running audit with null discoveredUrls untouched (discovery owns the row)', async () => {
    const audit = await makeAudit({ discoveredUrls: null })
    await finalizeSiteAudit(audit.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: audit.id } }))?.status).toBe('running')
  })

  it('leaves a queued audit untouched', async () => {
    const audit = await makeAudit({ status: 'queued', discoveredUrls: null })
    await finalizeSiteAudit(audit.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: audit.id } }))?.status).toBe('queued')
  })

  it('does not complete a pre-discovered running audit whose pages have not settled', async () => {
    const audit = await makeAudit({
      discoveredUrls: JSON.stringify(['https://finalize-test-guard.example/a']),
      pagesTotal: 1,
    })
    await finalizeSiteAudit(audit.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: audit.id } }))?.status).toBe('running')
  })

  it('completes a running audit with discoveredUrls=[] and zero pages', async () => {
    const audit = await makeAudit({ discoveredUrls: '[]', pagesTotal: 0 })
    await finalizeSiteAudit(audit.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: audit.id } }))?.status).toBe('complete')
  })
})
