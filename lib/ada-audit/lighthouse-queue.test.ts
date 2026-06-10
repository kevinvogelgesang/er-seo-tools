import { describe, it, expect, beforeEach } from 'vitest'

const { prisma } = await import('@/lib/db')
const { enqueuePsiJob } = await import('./lighthouse-queue')

async function clearTestState() {
  await prisma.job.deleteMany({ where: { type: 'psi', payload: { contains: 'psi-test-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://psi-test-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'psi-test-' } } })
}

describe('lighthouse-queue (durable facade)', () => {
  beforeEach(clearTestState)

  it('creates a durable Job row with dedupKey + groupKey', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-enqueue.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
    })
    const row = await prisma.adaAudit.create({
      data: { url: 'https://psi-test-enqueue.example/p', status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    enqueuePsiJob({ adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' })
    // enqueue is async behind the sync facade — poll for the row.
    let job = null
    for (let i = 0; i < 20 && !job; i++) {
      await new Promise((r) => setTimeout(r, 25))
      job = await prisma.job.findFirst({ where: { type: 'psi', dedupKey: `psi:${row.id}` } })
    }
    expect(job).not.toBeNull()
    expect(job!.groupKey).toBe(`site-audit:${site.id}`)
    expect(JSON.parse(job!.payload)).toMatchObject({ adaAuditId: row.id, siteAuditId: site.id })
  })

  it('double enqueue dedups to one Job row', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: 'psi-test-dedup.example', status: 'running', wcagLevel: 'wcag21aa', lighthouseTotal: 1 },
    })
    const row = await prisma.adaAudit.create({
      data: { url: 'https://psi-test-dedup.example/p', status: 'axe-complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    const j = { adaAuditId: row.id, siteAuditId: site.id, url: row.url, wcagLevel: 'wcag21aa' }
    enqueuePsiJob(j)
    enqueuePsiJob(j)
    await new Promise((r) => setTimeout(r, 200))
    expect(await prisma.job.count({ where: { type: 'psi', dedupKey: `psi:${row.id}` } })).toBe(1)
  })
})
