// lib/ada-audit/standalone-recovery.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

const countMock = vi.fn()
vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, countActiveJobsByGroup: (...a: unknown[]) => countMock(...a) }
})

const { prisma } = await import('@/lib/db')
const realQueue = await vi.importActual<typeof import('@/lib/jobs/queue')>('@/lib/jobs/queue')
const { recoverStandaloneAudits } = await import('./standalone-recovery')

const PREFIX = 'ada-recovery-test-'
const OLD = new Date(Date.now() - 10 * 60 * 1000)   // 10 min ago — past the 5-min guard

async function clearTestState() {
  const audits = await prisma.adaAudit.findMany({
    where: { url: { contains: PREFIX } }, select: { id: true },
  })
  if (audits.length > 0) {
    await prisma.job.deleteMany({
      where: { groupKey: { in: audits.map((a) => `ada-audit:${a.id}`) } },
    })
  }
  await prisma.pdfAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

async function seedAudit(name: string, status: string, createdAt: Date) {
  return prisma.adaAudit.create({
    data: { url: `https://${PREFIX}${name}.example/p`, status, createdAt, wcagLevel: 'wcag21aa' },
  })
}

describe('ada-audit/standalone-recovery', () => {
  beforeEach(async () => {
    countMock.mockReset()
    countMock.mockImplementation(realQueue.countActiveJobsByGroup)
    await clearTestState()
  })

  afterAll(clearTestState)

  it('flips an old pending standalone audit with no jobs in its group', async () => {
    const a = await seedAudit('dead', 'pending', OLD)
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('Audit interrupted (server restarted or job lost)')
    expect(row?.completedAt).not.toBeNull()
  })

  it('flips when the only Job row is terminal (failed onExhausted window)', async () => {
    const a = await seedAudit('terminal-job', 'running', OLD)
    await prisma.job.create({
      data: { type: 'ada-audit', status: 'error', groupKey: `ada-audit:${a.id}`, payload: '{}' },
    })
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('error')
  })

  it('resumes (leaves alone) an audit with an active job — even one in backoff', async () => {
    const a = await seedAudit('alive', 'running', OLD)
    await prisma.job.create({
      data: {
        type: 'ada-audit', status: 'queued', groupKey: `ada-audit:${a.id}`,
        payload: '{}', runAfter: new Date(Date.now() + 60_000),
      },
    })
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('running')
  })

  it('never touches young rows (create→enqueue race guard)', async () => {
    const a = await seedAudit('young', 'pending', new Date())
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('pending')
  })

  it('never touches site-audit children', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}site`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: {
        url: `https://${PREFIX}child.example/p`, status: 'pending',
        createdAt: OLD, siteAuditId: site.id, wcagLevel: 'wcag21aa',
      },
    })
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findFirst({ where: { url: { contains: `${PREFIX}child` } } })
    expect(row?.status).toBe('pending')
  })

  it('a job-count read error skips the row this pass (never biases destructive)', async () => {
    const a = await seedAudit('count-err', 'running', OLD)
    countMock.mockRejectedValue(new Error('db read failed'))
    await recoverStandaloneAudits()
    const row = await prisma.adaAudit.findUnique({ where: { id: a.id } })
    expect(row?.status).toBe('running')
  })

  // ── PDF sweep (Codex spec fix #5: mixed group states) ──

  async function seedPdf(audit: { id: string }, name: string, createdAt: Date) {
    return prisma.pdfAudit.create({
      data: {
        adaAuditId: audit.id, url: `https://${PREFIX}${name}.example/doc.pdf`,
        status: 'pending', createdAt,
      },
    })
  }

  it('flips stale standalone PDF rows when the group is drained', async () => {
    const a = await seedAudit('pdf-dead', 'complete', OLD)
    const p = await seedPdf(a, 'pdf-dead', OLD)
    await recoverStandaloneAudits()
    const row = await prisma.pdfAudit.findUnique({ where: { id: p.id } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toBe('PDF scan interrupted (server restarted or job lost)')
  })

  it('defers stale PDFs while the ada-audit job is still active', async () => {
    const a = await seedAudit('pdf-wait-audit', 'running', OLD)
    const p = await seedPdf(a, 'pdf-wait-audit', OLD)
    await prisma.job.create({
      data: { type: 'ada-audit', status: 'running', groupKey: `ada-audit:${a.id}`, payload: '{}' },
    })
    await recoverStandaloneAudits()
    expect((await prisma.pdfAudit.findUnique({ where: { id: p.id } }))?.status).toBe('pending')
  })

  it('defers stale PDFs while a sibling pdf-scan job is still active', async () => {
    const a = await seedAudit('pdf-wait-sib', 'complete', OLD)
    const p = await seedPdf(a, 'pdf-wait-sib', OLD)
    await prisma.job.create({
      data: { type: 'pdf-scan', status: 'queued', groupKey: `ada-audit:${a.id}`, payload: '{}' },
    })
    await recoverStandaloneAudits()
    expect((await prisma.pdfAudit.findUnique({ where: { id: p.id } }))?.status).toBe('pending')
  })

  it('leaves young and site-audit-attached PDFs alone', async () => {
    const a = await seedAudit('pdf-young', 'complete', OLD)
    const young = await seedPdf(a, 'pdf-young', new Date())
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}pdfsite`, status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    const siteAttached = await prisma.pdfAudit.create({
      data: {
        siteAuditId: site.id, url: `https://${PREFIX}site-attached.example/doc.pdf`,
        status: 'pending', createdAt: OLD,
      },
    })
    await recoverStandaloneAudits()
    expect((await prisma.pdfAudit.findUnique({ where: { id: young.id } }))?.status).toBe('pending')
    expect((await prisma.pdfAudit.findUnique({ where: { id: siteAttached.id } }))?.status).toBe('pending')
  })
})
