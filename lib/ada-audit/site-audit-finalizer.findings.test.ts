// lib/ada-audit/site-audit-finalizer.findings.test.ts
//
// A2 Phase 2: the finalizer's fire-and-forget findings dual-write.
// Separate file from site-audit-finalizer.test.ts because it mocks
// lib/findings/writer with a failure-injectable wrapper.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/audit-batch-helpers', () => ({
  closeBatchIfDrained: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ada-audit/queue-manager', () => ({
  processNext: vi.fn(async () => undefined),
}))

// vi.mock factories are hoisted above module scope — a plain `let` would be
// in the temporal dead zone when the factory runs. vi.hoisted is the
// sanctioned escape hatch for mutable mock state.
const state = vi.hoisted(() => ({ failWrites: false }))
vi.mock('@/lib/findings/writer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/findings/writer')>()
  return {
    writeFindingsRun: vi.fn(async (bundle: Parameters<typeof real.writeFindingsRun>[0]) => {
      if (state.failWrites) throw new Error('injected findings failure')
      return real.writeFindingsRun(bundle)
    }),
  }
})

const { prisma } = await import('@/lib/db')
const { finalizeSiteAudit } = await import('./site-audit-finalizer')
const { processNext } = await import('@/lib/ada-audit/queue-manager')

const DOMAIN_PREFIX = 'finalize-findings-'

const AXE_BLOB = JSON.stringify({
  violations: [{
    id: 'color-contrast', impact: 'serious', help: 'contrast', description: 'c',
    helpUrl: 'https://example.org', tags: ['wcag2aa'],
    nodes: [{ html: '<a>x</a>', target: ['a'] }],
  }],
  passes: [], incomplete: [], inapplicable: [],
  timestamp: '2026-06-10T00:00:00Z', url: 'https://x/',
  testEngine: { name: 'axe-core', version: '4.10' },
  testRunner: { name: 'er-seo-tools' },
})

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: DOMAIN_PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN_PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: DOMAIN_PREFIX } } })
}

async function makeDrainedAudit() {
  const domain = `${DOMAIN_PREFIX}${Math.random().toString(36).slice(2, 8)}.example`
  const site = await prisma.siteAudit.create({
    data: {
      domain, status: 'running', discoveredUrls: '[]', wcagLevel: 'wcag21aa',
      pagesTotal: 2, pagesComplete: 1, pagesError: 1,
      startedAt: new Date(),
    },
  })
  await prisma.adaAudit.createMany({
    data: [
      { url: `https://${domain}/a`, status: 'complete', result: AXE_BLOB, siteAuditId: site.id, wcagLevel: 'wcag21aa' },
      { url: `https://${domain}/b`, status: 'error', error: 'timeout', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    ],
  })
  return site
}

describe('finalizeSiteAudit — findings dual-write hook', () => {
  beforeEach(async () => {
    state.failWrites = false
    vi.mocked(processNext).mockClear()
    await clearTestState()
  })

  it('writes a CrawlRun when the audit completes', async () => {
    const site = await makeDrainedAudit()
    await finalizeSiteAudit(site.id)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('complete')

    // The write is fire-and-forget — poll for it.
    await vi.waitFor(async () => {
      const run = await prisma.crawlRun.findUnique({
        where: { siteAuditId: site.id },
        include: { pages: true, findings: true, violations: true },
      })
      expect(run).not.toBeNull()
      expect(run!.status).toBe('partial') // pagesError = 1
      expect(run!.pages).toHaveLength(2)
      expect(run!.findings).toHaveLength(1)
      expect(run!.violations).toHaveLength(1)
      expect(run!.completedAt).not.toBeNull()
    })
  })

  it('a findings failure never affects completion, batch close, or the promoter kick', async () => {
    state.failWrites = true
    const site = await makeDrainedAudit()
    await finalizeSiteAudit(site.id)
    const after = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(after?.status).toBe('complete')
    expect(after?.summary).not.toBeNull()
    expect(processNext).toHaveBeenCalled()
    // give the rejected write a tick to surface if it were going to throw
    await new Promise((r) => setTimeout(r, 50))
    expect(await prisma.crawlRun.count({ where: { siteAuditId: site.id } })).toBe(0)
  })

  it('does not write a run for a non-drained audit', async () => {
    const site = await prisma.siteAudit.create({
      data: {
        domain: `${DOMAIN_PREFIX}pending.example`, status: 'running',
        discoveredUrls: '[]', wcagLevel: 'wcag21aa',
        pagesTotal: 2, pagesComplete: 1,
      },
    })
    await finalizeSiteAudit(site.id)
    await new Promise((r) => setTimeout(r, 50))
    expect(await prisma.crawlRun.count({ where: { siteAuditId: site.id } })).toBe(0)
  })
})
