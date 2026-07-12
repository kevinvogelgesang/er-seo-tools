// lib/jobs/handlers/site-audit-discover.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/ada-audit/sitemap-crawler', () => ({ discoverPages: vi.fn() }))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({ finalizeSiteAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))

const { prisma } = await import('@/lib/db')
const { discoverPages } = await import('@/lib/ada-audit/sitemap-crawler')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { publishInvalidation } = await import('@/lib/events/bus')
const { runSiteAuditDiscoverJob, onSiteAuditDiscoverExhausted } = await import('./site-audit-discover')

const PREFIX = 'sad-handler-test-'

async function clearTestState() {
  // groupKeys are site-audit:<id> and payloads carry IDs, not domains —
  // resolve the test sites' IDs first, then delete their jobs by groupKey.
  const sites = await prisma.siteAudit.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  if (sites.length > 0) {
    await prisma.job.deleteMany({
      where: { groupKey: { in: sites.map((s) => `site-audit:${s.id}`) } },
    })
  }
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  // The discover claim's one-active guard is GLOBAL (NOT EXISTS over all
  // transient audits). Stray transient rows left behind by other test files
  // in the shared dev DB would block every claim here — neutralize them.
  // (Those files delete their rows by prefix at their own next run.)
  await prisma.siteAudit.updateMany({
    where: { status: { in: ['running', 'pdfs-running', 'lighthouse-running'] } },
    data: { status: 'error', error: 'neutralized by site-audit-discover.test.ts (one-active guard)' },
  })
}

async function seedQueued(name: string, extra: Record<string, unknown> = {}) {
  return prisma.siteAudit.create({
    data: { domain: `${PREFIX}${name}`, status: 'queued', wcagLevel: 'wcag21aa', ...extra },
  })
}

describe('jobs/handlers/site-audit-discover', () => {
  beforeEach(async () => {
    vi.mocked(discoverPages).mockReset()
    vi.mocked(finalizeSiteAudit).mockClear()
    vi.mocked(publishInvalidation).mockClear()
    await clearTestState()
  })

  it('fresh claim: discovers, persists discoveredUrls+pagesTotal, creates children, enqueues page jobs', async () => {
    const site = await seedQueued('fresh')
    const urls = [`https://${PREFIX}fresh/a`, `https://${PREFIX}fresh/b`]
    vi.mocked(discoverPages).mockResolvedValue({ urls, mode: 'sitemap', capped: false })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })

    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.status).toBe('running')
    expect(s?.pagesTotal).toBe(2)
    expect(s?.discoveryMode).toBe('sitemap')
    expect(s?.discoveryCapped).toBe(false)
    expect(JSON.parse(s!.discoveredUrls!)).toEqual(urls)
    const children = await prisma.adaAudit.findMany({ where: { siteAuditId: site.id } })
    expect(children).toHaveLength(2)
    expect(children.every((c) => c.status === 'pending')).toBe(true)
    const jobs = await prisma.job.findMany({ where: { groupKey: `site-audit:${site.id}`, type: 'site-audit-page' } })
    expect(jobs).toHaveLength(2)
  })

  it('one-active guard: claim no-ops while another audit is transient; audit stays queued', async () => {
    await prisma.siteAudit.create({
      data: { domain: `${PREFIX}active`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    const site = await seedQueued('blocked')
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('queued')
    expect(discoverPages).not.toHaveBeenCalled()
    expect(await prisma.job.count({ where: { groupKey: `site-audit:${site.id}` } })).toBe(0)
    // A5: a lost claim (another audit holds the slot) emits nothing.
    expect(publishInvalidation).not.toHaveBeenCalledWith(`site-audit:${site.id}`)
  })

  it('A5: emits queue + site-audit after a winning queued→running claim', async () => {
    const site = await seedQueued('emit')
    vi.mocked(discoverPages).mockResolvedValue({ urls: [], mode: 'sitemap', capped: false })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).toContain('queue')
    expect(calls).toContain(`site-audit:${site.id}`)
  })

  it('resume: running row with partial children/jobs gets topped up without duplicates', async () => {
    const urls = [`https://${PREFIX}resume/a`, `https://${PREFIX}resume/b`]
    const site = await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}resume`, status: 'running', wcagLevel: 'wcag21aa',
        discoveredUrls: JSON.stringify(urls), pagesTotal: 2,
      },
    })
    // Simulate a crash after one child was created (no jobs enqueued).
    await prisma.adaAudit.create({
      data: { url: urls[0], status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(discoverPages).not.toHaveBeenCalled() // stored set reused
    const children = await prisma.adaAudit.findMany({ where: { siteAuditId: site.id } })
    expect(children).toHaveLength(2)
    const jobs = await prisma.job.findMany({ where: { groupKey: `site-audit:${site.id}`, type: 'site-audit-page' } })
    expect(jobs).toHaveLength(2)
    // Re-run again (zombie): nothing duplicates, jobs dedup via active window.
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(await prisma.adaAudit.count({ where: { siteAuditId: site.id } })).toBe(2)
    expect(await prisma.job.count({ where: { groupKey: `site-audit:${site.id}`, type: 'site-audit-page' } })).toBe(2)
  })

  it('does not enqueue jobs for already-settled children on resume', async () => {
    const urls = [`https://${PREFIX}settled/a`, `https://${PREFIX}settled/b`]
    const site = await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}settled`, status: 'running', wcagLevel: 'wcag21aa',
        discoveredUrls: JSON.stringify(urls), pagesTotal: 2, pagesComplete: 1,
      },
    })
    await prisma.adaAudit.create({
      data: { url: urls[0], status: 'complete', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    const jobs = await prisma.job.findMany({ where: { groupKey: `site-audit:${site.id}`, type: 'site-audit-page' } })
    expect(jobs).toHaveLength(1) // only the unsettled URL
    expect(JSON.parse(jobs[0].payload).url).toBe(urls[1])
  })

  it('dedupes duplicate URLs from discovery (pagesTotal matches unique children)', async () => {
    const site = await seedQueued('dupes')
    vi.mocked(discoverPages).mockResolvedValue({
      urls: [`https://${PREFIX}dupes/a`, `https://${PREFIX}dupes/a`, `https://${PREFIX}dupes/b`],
      mode: 'sitemap',
      capped: false,
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.pagesTotal).toBe(2)
    expect(await prisma.adaAudit.count({ where: { siteAuditId: site.id } })).toBe(2)
  })

  it('zero URLs: finalizes immediately', async () => {
    const site = await seedQueued('empty')
    vi.mocked(discoverPages).mockResolvedValue({ urls: [], mode: 'sitemap', capped: false })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('pre-discovered URLs skip discovery', async () => {
    const urls = [`https://${PREFIX}prediscovered/a`]
    const site = await seedQueued('prediscovered', {
      discoveredUrls: JSON.stringify(urls), pagesTotal: 1,
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(discoverPages).not.toHaveBeenCalled()
    expect(await prisma.adaAudit.count({ where: { siteAuditId: site.id } })).toBe(1)
  })

  it('terminal status: no-op', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}cancelled`, status: 'cancelled', wcagLevel: 'wcag21aa' },
    })
    await runSiteAuditDiscoverJob({ siteAuditId: site.id })
    expect(discoverPages).not.toHaveBeenCalled()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.status).toBe('cancelled')
  })

  it('discoverPages throw propagates (queue retries)', async () => {
    const site = await seedQueued('boom')
    vi.mocked(discoverPages).mockRejectedValue(new Error('dns fail'))
    await expect(runSiteAuditDiscoverJob({ siteAuditId: site.id })).rejects.toThrow('dns fail')
  })

  it('onExhausted fails the audit and cascades', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}exhausted`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}exhausted/a`, status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await onSiteAuditDiscoverExhausted({ siteAuditId: site.id }, { jobId: 'j1', attempts: 3, lastError: 'dns fail' })
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.status).toBe('error')
    expect(s?.error).toContain('dns fail')
    const child = await prisma.adaAudit.findFirst({ where: { siteAuditId: site.id } })
    expect(child?.status).toBe('error')
  })

  it('rejects a malformed payload', async () => {
    await expect(runSiteAuditDiscoverJob({ nope: true } as never)).rejects.toThrow(/payload/i)
  })
})

describe('jobs/handlers/site-audit-discover — hybrid discovery wiring (Task 6)', () => {
  beforeEach(async () => {
    vi.mocked(discoverPages).mockReset()
    vi.mocked(finalizeSiteAudit).mockClear()
    vi.mocked(publishInvalidation).mockClear()
    await clearTestState()
  })

  it('seoIntent audit: calls discoverPages with hybrid:true and persists discoveryMode=hybrid + non-null discoverySourcesJson', async () => {
    const site = await seedQueued('hybrid-seo', { seoIntent: true })
    const urls = [`https://${PREFIX}hybrid-seo/a`, `https://${PREFIX}hybrid-seo/b`]
    vi.mocked(discoverPages).mockResolvedValue({
      urls,
      mode: 'hybrid',
      capped: false,
      coverage: {
        sources: { [urls[0]]: 'sitemap', [urls[1]]: 'linked' },
        sitemapCount: 1,
        sitemapCapped: false,
        stoppedBy: 'exhausted',
        fetches: 2,
      },
    })

    await runSiteAuditDiscoverJob({ siteAuditId: site.id })

    expect(discoverPages).toHaveBeenCalledWith(site.domain, { hybrid: true, timeBudgetMs: expect.any(Number) })
    // Regression guard: a fresh (non-pre-discovered) seoIntent discovery must
    // hybrid-expand exactly ONCE in this invocation — the pre-discovered
    // hybrid-expand branch must not re-fire off a stale in-memory `audit`
    // snapshot and re-crawl the set this same run just produced.
    expect(discoverPages).toHaveBeenCalledTimes(1)
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.discoveryMode).toBe('hybrid')
    expect(s?.discoverySourcesJson).not.toBeNull()
    const sources = JSON.parse(s!.discoverySourcesJson!)
    expect(sources).toMatchObject({
      v: 1,
      sources: { [urls[0]]: 'sitemap', [urls[1]]: 'linked' },
      sitemapCount: 1,
      sitemapCapped: false,
      stoppedBy: 'exhausted',
      fetches: 2,
    })
  })

  it('non-seoIntent audit: calls discoverPages with hybrid:false and discoverySourcesJson stays null', async () => {
    const site = await seedQueued('sitemap-only')
    const urls = [`https://${PREFIX}sitemap-only/a`]
    vi.mocked(discoverPages).mockResolvedValue({ urls, mode: 'sitemap', capped: false })

    await runSiteAuditDiscoverJob({ siteAuditId: site.id })

    expect(discoverPages).toHaveBeenCalledWith(site.domain, { hybrid: false, timeBudgetMs: expect.any(Number) })
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.discoveryMode).toBe('sitemap')
    expect(s?.discoverySourcesJson).toBeNull()
  })

  it('pre-discovered seoIntent audit (seeded discoveredUrls, no source map yet): hybrid-expands from the stored seeds', async () => {
    const seeds = [`https://${PREFIX}predisc-seo/a`]
    const site = await seedQueued('predisc-seo', {
      seoIntent: true,
      discoveredUrls: JSON.stringify(seeds),
      pagesTotal: 1,
    })
    const expanded = [...seeds, `https://${PREFIX}predisc-seo/b`]
    vi.mocked(discoverPages).mockResolvedValue({
      urls: expanded,
      mode: 'hybrid',
      capped: false,
      coverage: { sources: { [expanded[1]]: 'linked' }, sitemapCount: 1, sitemapCapped: false, stoppedBy: 'exhausted', fetches: 1 },
    })

    await runSiteAuditDiscoverJob({ siteAuditId: site.id })

    expect(discoverPages).toHaveBeenCalledTimes(1)
    expect(discoverPages).toHaveBeenCalledWith(site.domain, { hybrid: true, seeds, timeBudgetMs: expect.any(Number) })
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.discoveryMode).toBe('hybrid')
    expect(JSON.parse(s!.discoveredUrls!)).toEqual(expanded)
    expect(s?.pagesTotal).toBe(2)
    expect(s?.discoverySourcesJson).not.toBeNull()
    expect(await prisma.adaAudit.count({ where: { siteAuditId: site.id } })).toBe(2)
  })
})
