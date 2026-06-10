// lib/ada-audit/pdf-orchestrator.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Spy-wrap enqueueJob so the failure test can reject once; default
// implementation passes through to the real queue.
vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(actual.enqueueJob) }
})
// settlePdfFailure → finalizeSiteAudit would touch the real queue manager;
// stub the finalizer like every other ada-audit test.
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({
  finalizeSiteAudit: vi.fn(async () => undefined),
}))

const { prisma } = await import('@/lib/db')
const { enqueueJob } = await import('@/lib/jobs/queue')
const { dispatchPdfScans } = await import('./pdf-orchestrator')

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: 'pdf-scan', payload: { contains: 'pdf-orch-test-' } } })
  await prisma.pdfAudit.deleteMany({ where: { url: { startsWith: 'https://pdf-orch-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://pdf-orch-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'pdf-orch-test-' } } })
}

describe('pdf-orchestrator (durable dispatch)', () => {
  beforeEach(async () => {
    vi.mocked(enqueueJob).mockClear()
    await clearTestState()
  })

  it('inserts pending rows, bumps pdfsTotal, and enqueues one pdf-scan job per URL', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'pdf-orch-test-site.example', status: 'running', wcagLevel: 'wcag21aa' },
    })
    const urls = [
      'https://pdf-orch-test-site.example/a.pdf',
      'https://pdf-orch-test-site.example/b.pdf',
    ]
    await dispatchPdfScans({ urls, siteAuditId: site.id, sourcePageUrl: 'https://pdf-orch-test-site.example/page' })

    const rows = await prisma.pdfAudit.findMany({ where: { siteAuditId: site.id } })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'pending')).toBe(true)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsTotal).toBe(2)

    for (const url of urls) {
      const job = await prisma.job.findFirst({
        where: { type: 'pdf-scan', dedupKey: `pdf:${site.id}:${url}` },
      })
      expect(job).not.toBeNull()
      expect(job!.groupKey).toBe(`site-audit:${site.id}`)
      expect(JSON.parse(job!.payload)).toMatchObject({
        url, siteAuditId: site.id, sourcePageUrl: 'https://pdf-orch-test-site.example/page',
      })
    }
  })

  it('dedups already-known URLs — no new row, no new job', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'pdf-orch-test-dedup.example', status: 'running', wcagLevel: 'wcag21aa', pdfsTotal: 1 },
    })
    const url = 'https://pdf-orch-test-dedup.example/a.pdf'
    await prisma.pdfAudit.create({ data: { siteAuditId: site.id, url, status: 'complete' } })

    await dispatchPdfScans({ urls: [url], siteAuditId: site.id })

    expect(await prisma.pdfAudit.count({ where: { siteAuditId: site.id } })).toBe(1)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pdfsTotal).toBe(1)
    expect(await prisma.job.count({ where: { type: 'pdf-scan', dedupKey: `pdf:${site.id}:${url}` } })).toBe(0)
  })

  it('standalone dispatch (adaAuditId) uses the ada-audit group + dedup keys', async () => {
    const ada = await prisma.adaAudit.create({
      data: { url: 'https://pdf-orch-test-solo.example/page', status: 'complete', wcagLevel: 'wcag21aa' },
    })
    const url = 'https://pdf-orch-test-solo.example/doc.pdf'
    await dispatchPdfScans({ urls: [url], adaAuditId: ada.id })

    const job = await prisma.job.findFirst({
      where: { type: 'pdf-scan', dedupKey: `pdf:ada:${ada.id}:${url}` },
    })
    expect(job).not.toBeNull()
    expect(job!.groupKey).toBe(`ada-audit:${ada.id}`)
  })

  it('enqueue failure settles the row as error + pdfsError++ (no stranded pending row)', async () => {
    vi.mocked(enqueueJob).mockRejectedValueOnce(new Error('disk full'))
    const site = await prisma.siteAudit.create({
      data: { domain: 'pdf-orch-test-fail.example', status: 'running', wcagLevel: 'wcag21aa' },
    })
    const url = 'https://pdf-orch-test-fail.example/a.pdf'
    await dispatchPdfScans({ urls: [url], siteAuditId: site.id })

    const row = await prisma.pdfAudit.findFirst({ where: { siteAuditId: site.id, url } })
    expect(row?.status).toBe('error')
    expect(row?.scanError).toContain('Failed to enqueue durable PDF scan job')
    const siteFinal = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(siteFinal?.pdfsTotal).toBe(1)
    expect(siteFinal?.pdfsError).toBe(1)
  })

  it('throws when neither siteAuditId nor adaAuditId is given', async () => {
    await expect(dispatchPdfScans({ urls: ['https://pdf-orch-test-x.example/a.pdf'] })).rejects.toThrow()
  })
})
