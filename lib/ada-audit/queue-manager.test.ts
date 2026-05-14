// Focused test for the runAudit claim race:
//
//   1. processNext() reads SiteAudit A while status='queued'
//   2. user cancels A (status flips to 'cancelled') before runAudit fires
//   3. runAudit must NOT resurrect A back to 'running'
//
// Exercised by calling runAudit directly on a row whose status has already
// been flipped to 'cancelled' — runAudit's conditional claim should observe
// status≠'queued', count===0, and return without touching the row.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub the work-doers so a successful claim path would call into them; if any
// fire, the test fails (proves we didn't return early when we should have).
vi.mock('@/lib/ada-audit/sitemap-crawler', () => ({
  discoverPages: vi.fn(async () => []),
}))
vi.mock('@/lib/ada-audit/runner', () => ({
  runAxeAudit: vi.fn(),
}))
vi.mock('@/lib/ada-audit/pdf-orchestrator', () => ({
  dispatchPdfScans: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ada-audit/browser-pool', () => ({
  closeBrowser: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { discoverPages } = await import('@/lib/ada-audit/sitemap-crawler')
const { runAudit } = await import('./queue-manager')

async function clearTestState() {
  await prisma.auditBatch.updateMany({
    where: { closedAt: null },
    data: { closedAt: new Date() },
  })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'claim-race-' } } })
}

describe('runAudit — conditional claim race', () => {
  beforeEach(async () => {
    vi.mocked(discoverPages).mockClear()
    await clearTestState()
  })

  it('does NOT resurrect a row that was cancelled before the claim landed', async () => {
    const audit = await prisma.siteAudit.create({
      data: {
        domain: 'claim-race-cancelled.example',
        status: 'cancelled',
        wcagLevel: 'wcag21aa',
      },
    })

    await runAudit(audit.id, audit.domain, audit.clientId, audit.wcagLevel)

    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    expect(after?.status).toBe('cancelled')
    // No URL discovery should have been triggered — the claim failed first.
    expect(discoverPages).not.toHaveBeenCalled()
  })

  it('claims and runs a row whose status is still queued', async () => {
    const audit = await prisma.siteAudit.create({
      data: {
        domain: 'claim-race-queued.example',
        status: 'queued',
        wcagLevel: 'wcag21aa',
      },
    })

    await runAudit(audit.id, audit.domain, audit.clientId, audit.wcagLevel)

    // discoverPages returned [] (mocked), so the audit progresses to
    // completion with zero pages — what matters here is that the claim
    // succeeded and the rest of the pipeline ran.
    expect(discoverPages).toHaveBeenCalledTimes(1)
    const after = await prisma.siteAudit.findUnique({ where: { id: audit.id } })
    // After the mocked empty discovery + finalize stub, status is left at
    // 'running' (finalize is mocked out). The relevant assertion is that
    // we LEFT 'queued', proving the claim was made.
    expect(after?.status).not.toBe('queued')
    expect(after?.status).not.toBe('cancelled')
  })
})
