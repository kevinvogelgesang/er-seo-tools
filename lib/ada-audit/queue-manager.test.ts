// Focused test for the runAudit claim race:
//
//   1. processNext() reads SiteAudit A while status='queued'
//   2. user cancels A (status flips to 'cancelled') before runAudit fires
//   3. runAudit must NOT resurrect A back to 'running'
//
// Exercised by calling runAudit directly on a row whose status has already
// been flipped to 'cancelled' — runAudit's conditional claim should observe
// status≠'queued', count===0, and return without touching the row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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

const { failOrphanAdaAudits } = await import('./queue-manager')

async function clearOrphanTestState() {
  await prisma.pdfAudit.deleteMany({ where: { url: { startsWith: 'https://orphan-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://orphan-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'orphan-test-' } } })
  // New cascade tests
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://orphan-axe-complete.' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'orphan-axe-complete.' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://orphan-a.' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://orphan-b.' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'orphan-a.' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'orphan-b.' } } })
}

describe('failOrphanAdaAudits', () => {
  beforeEach(clearOrphanTestState)

  it('marks pending and running children as error; leaves complete/error children alone', async () => {
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-mixed.example', status: 'error', wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-mixed.example/a', status: 'running', wcagLevel: 'wcag21aa', siteAuditId: parent.id },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-mixed.example/b', status: 'pending', wcagLevel: 'wcag21aa', siteAuditId: parent.id },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-mixed.example/c', status: 'complete', wcagLevel: 'wcag21aa', siteAuditId: parent.id, result: '{}' },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-mixed.example/d', status: 'error', wcagLevel: 'wcag21aa', siteAuditId: parent.id, error: 'pre-existing' },
    })

    await failOrphanAdaAudits(parent.id)

    const after = await prisma.adaAudit.findMany({ where: { siteAuditId: parent.id }, orderBy: { url: 'asc' } })
    const byUrl = Object.fromEntries(after.map((c) => [c.url, c]))

    expect(byUrl['https://orphan-test-mixed.example/a'].status).toBe('error')
    expect(byUrl['https://orphan-test-mixed.example/a'].error).toMatch(/site audit/i)
    expect(byUrl['https://orphan-test-mixed.example/b'].status).toBe('error')
    expect(byUrl['https://orphan-test-mixed.example/b'].error).toMatch(/site audit/i)
    expect(byUrl['https://orphan-test-mixed.example/c'].status).toBe('complete')      // untouched
    expect(byUrl['https://orphan-test-mixed.example/d'].error).toBe('pre-existing')   // untouched
  })

  it('is a no-op when there are no orphan children', async () => {
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-empty.example', status: 'error', wcagLevel: 'wcag21aa' },
    })
    await expect(failOrphanAdaAudits(parent.id)).resolves.toBeUndefined()
  })

  it('flips axe-complete children to error with a lighthouseError set', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'orphan-axe-complete.example', status: 'lighthouse-running', wcagLevel: 'wcag21aa' },
    })
    const row = await prisma.adaAudit.create({
      data: {
        url: 'https://orphan-axe-complete.example/p',
        status: 'axe-complete',
        siteAuditId: site.id,
        wcagLevel: 'wcag21aa',
        result: '{"violations":[]}',
      },
    })

    const { failOrphanAdaAudits } = await import('./queue-manager')
    await failOrphanAdaAudits(site.id)

    const after = await prisma.adaAudit.findUnique({ where: { id: row.id } })
    expect(after?.status).toBe('error')
    expect(after?.error).toContain('Audit interrupted')
    expect(after?.lighthouseError).toContain('Lighthouse interrupted')
    // axe result is preserved.
    expect(after?.result).toBe('{"violations":[]}')
  })

  it('does not flip axe-complete children of OTHER site audits', async () => {
    const a = await prisma.siteAudit.create({ data: { domain: 'orphan-a.example', status: 'error', wcagLevel: 'wcag21aa' } })
    const b = await prisma.siteAudit.create({ data: { domain: 'orphan-b.example', status: 'running', wcagLevel: 'wcag21aa' } })
    const aRow = await prisma.adaAudit.create({ data: { url: 'https://orphan-a.example/p', status: 'axe-complete', siteAuditId: a.id, wcagLevel: 'wcag21aa' } })
    const bRow = await prisma.adaAudit.create({ data: { url: 'https://orphan-b.example/p', status: 'axe-complete', siteAuditId: b.id, wcagLevel: 'wcag21aa' } })

    const { failOrphanAdaAudits } = await import('./queue-manager')
    await failOrphanAdaAudits(a.id)

    expect((await prisma.adaAudit.findUnique({ where: { id: aRow.id } }))?.status).toBe('error')
    expect((await prisma.adaAudit.findUnique({ where: { id: bRow.id } }))?.status).toBe('axe-complete')
  })
})

const { failOrphanPdfAudits } = await import('./queue-manager')

describe('failOrphanPdfAudits', () => {
  beforeEach(clearOrphanTestState)

  it('marks pending and scanning PDFs as error; leaves complete/error PDFs alone', async () => {
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-pdf.example', status: 'error', wcagLevel: 'wcag21aa' },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-pdf.example/a.pdf', status: 'scanning', siteAuditId: parent.id },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-pdf.example/b.pdf', status: 'pending', siteAuditId: parent.id },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-pdf.example/c.pdf', status: 'complete', siteAuditId: parent.id, issues: '[]' },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-pdf.example/d.pdf', status: 'error', siteAuditId: parent.id, scanError: 'pre-existing' },
    })

    await failOrphanPdfAudits(parent.id)

    const after = await prisma.pdfAudit.findMany({ where: { siteAuditId: parent.id }, orderBy: { url: 'asc' } })
    const byUrl = Object.fromEntries(after.map((c) => [c.url, c]))

    expect(byUrl['https://orphan-test-pdf.example/a.pdf'].status).toBe('error')
    expect(byUrl['https://orphan-test-pdf.example/a.pdf'].scanError).toMatch(/site audit/i)
    expect(byUrl['https://orphan-test-pdf.example/b.pdf'].status).toBe('error')
    expect(byUrl['https://orphan-test-pdf.example/b.pdf'].scanError).toMatch(/site audit/i)
    expect(byUrl['https://orphan-test-pdf.example/c.pdf'].status).toBe('complete')      // untouched
    expect(byUrl['https://orphan-test-pdf.example/d.pdf'].scanError).toBe('pre-existing')  // untouched
  })

  it('is a no-op when there are no orphan PDFs', async () => {
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-pdf-empty.example', status: 'error', wcagLevel: 'wcag21aa' },
    })
    await expect(failOrphanPdfAudits(parent.id)).resolves.toBeUndefined()
  })
})

const { recoverQueue } = await import('./queue-manager')

describe('recoverQueue — immediate interrupt on startup', () => {
  beforeEach(clearOrphanTestState)

  it('marks running/pdfs-running parents as interrupted immediately (no 5-min threshold), with full cascade', async () => {
    // A row whose updatedAt is RECENT — under the old 5-min threshold this would survive recovery
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-fresh.example', status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-fresh.example/in-flight', status: 'running', wcagLevel: 'wcag21aa', siteAuditId: parent.id },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-fresh.example/doc.pdf', status: 'scanning', siteAuditId: parent.id },
    })

    await recoverQueue()

    const refreshedParent = await prisma.siteAudit.findUnique({ where: { id: parent.id } })
    expect(refreshedParent?.status).toBe('error')
    expect(refreshedParent?.error).toMatch(/interrupted/i)

    const ada = await prisma.adaAudit.findFirst({ where: { siteAuditId: parent.id } })
    expect(ada?.status).toBe('error')

    const pdf = await prisma.pdfAudit.findFirst({ where: { siteAuditId: parent.id } })
    expect(pdf?.status).toBe('error')
  })
})

const { processNext } = await import('./queue-manager')

describe('processNext — recognizes lighthouse-running as in-flight', () => {
  beforeEach(async () => {
    // Reuse whatever clearTestState the file already defines, or inline:
    await prisma.auditBatch.updateMany({ where: { closedAt: null }, data: { closedAt: new Date() } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'lh-running-' } } })
  })

  async function cleanupAfter() {
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'lh-running-' } } })
  }

  it('does not pick a queued audit when one is in lighthouse-running', async () => {
    await prisma.siteAudit.create({
      data: { domain: 'lh-running-active.example', status: 'lighthouse-running', wcagLevel: 'wcag21aa' },
    })
    const queued = await prisma.siteAudit.create({
      data: { domain: 'lh-running-queued.example', status: 'queued', wcagLevel: 'wcag21aa' },
    })

    const { processNext } = await import('./queue-manager')
    await processNext()
    // Yield once in case processNext fires its self-tail.
    await new Promise((r) => setImmediate(r))

    const stillQueued = await prisma.siteAudit.findUnique({ where: { id: queued.id } })
    expect(stillQueued?.status).toBe('queued')

    await cleanupAfter()
  })
})

const { getQueueStatus } = await import('./queue-manager')

describe('getQueueStatus — lighthouse counters + lighthouse-running phase', () => {
  beforeEach(async () => {
    await prisma.auditBatch.updateMany({ where: { closedAt: null }, data: { closedAt: new Date() } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'qstatus-' } } })
  })

  it('reports lighthouse-running as the active phase with lighthouse counters', async () => {
    await prisma.siteAudit.create({
      data: {
        domain: 'qstatus-lh.example',
        status: 'lighthouse-running',
        wcagLevel: 'wcag21aa',
        pagesTotal: 5, pagesComplete: 5,
        pdfsTotal: 0,
        lighthouseTotal: 5, lighthouseComplete: 2, lighthouseError: 1,
      },
    })

    const { getQueueStatus } = await import('./queue-manager')
    const status = await getQueueStatus()

    expect(status.active?.status).toBe('lighthouse-running')
    expect(status.active?.lighthouseTotal).toBe(5)
    expect(status.active?.lighthouseComplete).toBe(2)
    expect(status.active?.lighthouseError).toBe(1)
  })
})

const { resetStaleAudits } = await import('./queue-manager')

describe('resetStaleAudits — orphan child cleanup', () => {
  beforeEach(clearOrphanTestState)

  it('cascade-fails AdaAudit and PdfAudit orphans when it errors a stale parent', async () => {
    const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000)
    const parent = await prisma.siteAudit.create({
      data: { domain: 'orphan-test-stale.example', status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    // Backdate updatedAt past the 5-minute threshold
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${sixMinAgo} WHERE "id" = ${parent.id}`

    await prisma.adaAudit.create({
      data: { url: 'https://orphan-test-stale.example/in-flight', status: 'running', wcagLevel: 'wcag21aa', siteAuditId: parent.id },
    })
    await prisma.pdfAudit.create({
      data: { url: 'https://orphan-test-stale.example/doc.pdf', status: 'scanning', siteAuditId: parent.id },
    })

    await resetStaleAudits()

    const refreshedParent = await prisma.siteAudit.findUnique({ where: { id: parent.id } })
    expect(refreshedParent?.status).toBe('error')

    const ada = await prisma.adaAudit.findFirst({ where: { siteAuditId: parent.id } })
    expect(ada?.status).toBe('error')
    expect(ada?.error).toMatch(/site audit/i)

    const pdf = await prisma.pdfAudit.findFirst({ where: { siteAuditId: parent.id } })
    expect(pdf?.status).toBe('error')
    expect(pdf?.scanError).toMatch(/site audit/i)
  })
})

describe('recoverQueue with JOB_QUEUE_PSI=1', () => {
  const original = process.env.JOB_QUEUE_PSI
  beforeEach(() => { process.env.JOB_QUEUE_PSI = '1' })
  afterEach(() => {
    if (original === undefined) delete process.env.JOB_QUEUE_PSI
    else process.env.JOB_QUEUE_PSI = original
  })

  async function makeParent(domain: string, status: string) {
    return prisma.siteAudit.create({
      data: { domain: `qm-jobs-test-${domain}`, status, wcagLevel: 'wcag21aa' },
    })
  }

  async function cleanup(siteIds: string[]) {
    await prisma.job.deleteMany({ where: { groupKey: { in: siteIds.map((id) => `site-audit:${id}`) } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'qm-jobs-test-' } } })
  }

  it('lighthouse-running parent with active group jobs survives (incl. backoff-delayed)', async () => {
    const parent = await makeParent('survives.example', 'lighthouse-running')
    await prisma.job.create({
      data: { type: 'psi', status: 'queued', groupKey: `site-audit:${parent.id}`, runAfter: new Date(Date.now() + 60_000) },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('lighthouse-running')
    } finally {
      await cleanup([parent.id])
    }
  })

  it('lighthouse-running parent with no active jobs is failed and orphans cascade', async () => {
    const parent = await makeParent('drained.example', 'lighthouse-running')
    const child = await prisma.adaAudit.create({
      data: { url: 'https://qm-jobs-test-drained.example/p', status: 'axe-complete', siteAuditId: parent.id, wcagLevel: 'wcag21aa' },
    })
    await prisma.job.create({
      data: { type: 'psi', status: 'error', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('error')
      expect((await prisma.adaAudit.findUnique({ where: { id: child.id } }))?.status).toBe('error')
    } finally {
      await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://qm-jobs-test-' } } })
      await cleanup([parent.id])
    }
  })

  it('mixed-outstanding: pdfs-running parent is failed even with active PSI jobs, and its queued jobs are cancelled', async () => {
    const parent = await makeParent('mixed.example', 'pdfs-running')
    const job = await prisma.job.create({
      data: { type: 'psi', status: 'queued', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('error')
      expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
    } finally {
      await cleanup([parent.id])
    }
  })

  it('flag off: lighthouse-running parent is failed even with active group jobs', async () => {
    delete process.env.JOB_QUEUE_PSI
    const parent = await makeParent('flag-off.example', 'lighthouse-running')
    const job = await prisma.job.create({
      data: { type: 'psi', status: 'queued', groupKey: `site-audit:${parent.id}` },
    })
    try {
      await recoverQueue()
      expect((await prisma.siteAudit.findUnique({ where: { id: parent.id } }))?.status).toBe('error')
      expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
    } finally {
      await cleanup([parent.id])
    }
  })
})
