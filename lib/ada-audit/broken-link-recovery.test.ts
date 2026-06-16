import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { recoverBrokenLinkVerifies } from './broken-link-recovery'

const DOMAIN = 'c6blr.example.com'

async function clean() {
  // Scope job cleanup to THIS test's site audits — never blanket-delete.
  const sas = await prisma.siteAudit.findMany({ where: { domain: DOMAIN }, select: { id: true } })
  const groups = sas.map((s) => `site-audit:${s.id}`)
  if (groups.length) await prisma.job.deleteMany({ where: { type: 'broken-link-verify', groupKey: { in: groups } } })
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean)
afterAll(clean)

describe('recoverBrokenLinkVerifies', () => {
  it('re-enqueues for a complete audit with harvest rows + no verify job + no live-scan run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' },
    })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    expect(job).not.toBeNull()
  })

  it('skips audits that already have a live-scan run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' },
    })
    await prisma.crawlRun.create({
      data: { id: 'c6blr-run', tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', siteAuditId: sa.id, pagesTotal: 0 },
    })
    const before = await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    await recoverBrokenLinkVerifies()
    expect(await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })).toBe(before)
  })

  it('skips non-complete audits', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'running' } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' },
    })
    await recoverBrokenLinkVerifies()
    expect(await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })).toBe(0)
  })
})
