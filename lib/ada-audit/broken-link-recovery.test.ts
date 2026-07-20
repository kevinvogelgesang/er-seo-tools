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
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.harvestedPageError.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
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

  it('re-enqueues a stranded audit that has only HarvestedPageSeo rows', async () => {
    // seed complete SiteAudit + 1 harvestedPageSeo row, no harvestedLink, no live-scan run, no job
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedPageSeo.create({
      data: { siteAuditId: sa.id, url: 'https://c6blr.example.com/a', statusCode: 200, isHtml: true },
    })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    expect(job).not.toBeNull()
  })

  it('B1: re-enqueues a dead-only audit that has only HarvestedPageError rows', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedPageError.create({
      data: { siteAuditId: sa.id, url: 'https://c6blr.example.com/gone', statusCode: 404 },
    })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    expect(job).not.toBeNull()
  })

  it('B1: does NOT re-enqueue a dead-page audit whose live-scan run already committed', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedPageError.create({
      data: { siteAuditId: sa.id, url: 'https://c6blr.example.com/gone', statusCode: 410 },
    })
    await prisma.crawlRun.create({
      data: { id: 'c6blr-dead-run', tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', siteAuditId: sa.id, pagesTotal: 0 },
    })
    const before = await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    await recoverBrokenLinkVerifies()
    expect(await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })).toBe(before)
  })

  it('C11: recovery re-enqueues a complete zero-harvest seoOnly audit', async () => {
    // Arrange: complete seoOnly SiteAudit, NO HarvestedLink/HarvestedPageSeo rows,
    // NO seo-parser CrawlRun, NO active verify job. Today's transient-keyed scan
    // never sees this row (all pages failed/redirected or harvest returned null,
    // then the process crashed before enqueueBrokenLinkVerify).
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', seoOnly: true } })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({
      where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` },
      select: { id: true },
    })
    expect(job).not.toBeNull()
  })

  it('C11: does not double-enqueue a seoOnly audit that also has transient rows', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', seoOnly: true } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' },
    })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBe(1)
    expect(await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })).toBe(1)
  })

  it('C12 D1: does NOT re-enqueue a completed audit that already has a live-scan run + retained pageSeo', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(Date.now() + 3600_000) } })
    await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
    await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', contentText: 'body' } })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBe(0)
    const jobs = await prisma.job.count({ where: { groupKey: `site-audit:${sa.id}` } })
    expect(jobs).toBe(0)
  })

  it('does not re-enqueue when a terminal errored verifier exists; repairs the placeholder instead', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({ data: { siteAuditId: sa.id, sourcePageUrl: `https://${DOMAIN}/`, targetUrl: `https://${DOMAIN}/a`, kind: 'internal-link' } })
    await prisma.job.create({ data: {
      type: 'broken-link-verify', status: 'error', attempts: 2, maxAttempts: 2,
      payload: JSON.stringify({ siteAuditId: sa.id, domain: DOMAIN }),
      groupKey: `site-audit:${sa.id}`, dedupKey: null,
    } })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBe(0)
    const jobs = await prisma.job.findMany({ where: { groupKey: `site-audit:${sa.id}`, status: { in: ['queued', 'running'] } } })
    expect(jobs).toHaveLength(0) // no fresh verifier
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } } })
    expect(run?.source).toBe('live-scan-placeholder') // placeholder repaired by the sweep
    // Codex plan-fix #5: this arrange (errored job + no run) IS the failed-hook
    // state — the sweep is the self-repair. Prove idempotence with a second pass:
    expect(await recoverBrokenLinkVerifies()).toBe(0)
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: sa.id, tool: 'seo-parser' } })
    expect(runs).toHaveLength(1)
  })

  it('still prefers an ACTIVE job over the errored-job fence', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({ data: { siteAuditId: sa.id, sourcePageUrl: `https://${DOMAIN}/`, targetUrl: `https://${DOMAIN}/a`, kind: 'internal-link' } })
    await prisma.job.create({ data: { type: 'broken-link-verify', status: 'error', attempts: 2, maxAttempts: 2, payload: '{}', groupKey: `site-audit:${sa.id}` } })
    await prisma.job.create({ data: { type: 'broken-link-verify', status: 'queued', attempts: 0, maxAttempts: 2, payload: '{}', groupKey: `site-audit:${sa.id}` } })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBe(0) // active job — leave alone
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } } })
    expect(run).toBeNull() // fence not reached; active attempt may still write the real run
  })
})
