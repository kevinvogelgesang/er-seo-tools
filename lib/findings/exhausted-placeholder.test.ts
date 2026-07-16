import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { ensureExhaustedPlaceholder, LIVE_SCAN_PLACEHOLDER_SOURCE } from './exhausted-placeholder'
import { onBrokenLinkVerifyExhausted } from '@/lib/jobs/handlers/broken-link-verify'

const DOMAIN = 'exhausted-placeholder.test.example.com'

async function cleanup() {
  // Job.dedupKey is keyed by siteAuditId (a cuid), not domain — find this
  // test's SiteAudit ids first so the notify-email Job row it created is
  // swept too, then clean the domain-scoped rows.
  const sites = await prisma.siteAudit.findMany({ where: { domain: DOMAIN }, select: { id: true } })
  if (sites.length > 0) {
    await prisma.job.deleteMany({
      where: { dedupKey: { in: sites.map((s) => `notify-email:${s.id}:complete`) } },
    })
  }
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(cleanup)
afterAll(cleanup)

describe('ensureExhaustedPlaceholder', () => {
  it('creates a minimal placeholder run for a complete audit', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', seoIntent: true } })
    expect(await ensureExhaustedPlaceholder(sa.id)).toBe('created')
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } } })
    expect(run).toMatchObject({
      source: LIVE_SCAN_PLACEHOLDER_SOURCE, status: 'partial', score: null,
      scoreBreakdown: null, pagesTotal: 0, seoIntent: false, domain: DOMAIN,
    })
    expect(run!.startedAt).not.toBeNull()
    expect(run!.completedAt).not.toBeNull()
  })

  it('is a no-op when a real run already exists (P2002 path)', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', siteAuditId: sa.id, domain: DOMAIN } })
    expect(await ensureExhaustedPlaceholder(sa.id)).toBe('exists')
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: sa.id, tool: 'seo-parser' } })
    expect(runs).toHaveLength(1)
    expect(runs[0].source).toBe('live-scan')
  })

  it('skips a deleted audit and never throws', async () => {
    expect(await ensureExhaustedPlaceholder('nonexistent-id')).toBe('skipped')
  })
})

describe('onBrokenLinkVerifyExhausted', () => {
  it('writes a placeholder run for a complete audit with no run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await onBrokenLinkVerifyExhausted({ siteAuditId: sa.id }, { jobId: 'x', attempts: 2, lastError: 'oom' })
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } } })
    expect(run?.source).toBe(LIVE_SCAN_PLACEHOLDER_SOURCE)
  })

  it('still enqueues notify-email when the placeholder write fails (notify independence)', async () => {
    const sa = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', notifyEmail: `notify-${DOMAIN}@example.com` },
    })
    const spy = vi.spyOn(prisma.crawlRun, 'create').mockRejectedValueOnce(new Error('db down'))
    try {
      await expect(
        onBrokenLinkVerifyExhausted({ siteAuditId: sa.id }, { jobId: 'x', attempts: 2, lastError: 'oom' })
      ).resolves.toBeUndefined()
    } finally {
      spy.mockRestore()
    }
    const job = await prisma.job.findFirst({ where: { dedupKey: `notify-email:${sa.id}:complete` } })
    expect(job).not.toBeNull()
    expect(job?.type).toBe('notify-email')
  })
})
