// lib/jobs/handlers/site-audit-page.test.ts
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

vi.mock('@/lib/ada-audit/runner', () => ({ runAxeAudit: vi.fn() }))
vi.mock('@/lib/ada-audit/pdf-orchestrator', () => ({ dispatchPdfScans: vi.fn(async () => undefined) }))
vi.mock('@/lib/ada-audit/site-audit-finalizer', () => ({ finalizeSiteAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/ada-audit/lighthouse-queue', () => ({ enqueuePsiJob: vi.fn() }))
vi.mock('@/lib/ada-audit/lighthouse-provider', () => ({ getLighthouseProvider: vi.fn(() => 'pagespeed') }))
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))

const { prisma } = await import('@/lib/db')
const { runAxeAudit } = await import('@/lib/ada-audit/runner')
const { dispatchPdfScans } = await import('@/lib/ada-audit/pdf-orchestrator')
const { finalizeSiteAudit } = await import('@/lib/ada-audit/site-audit-finalizer')
const { enqueuePsiJob } = await import('@/lib/ada-audit/lighthouse-queue')
const { getLighthouseProvider } = await import('@/lib/ada-audit/lighthouse-provider')
const { publishInvalidation } = await import('@/lib/events/bus')
const { runSiteAuditPageJob, onSiteAuditPageExhausted, persistPageSeo, publishHeroScreenshot } = await import('./site-audit-page')
import type { RawPageSeo } from '@/lib/ada-audit/seo/parse-seo-dom'

const PREFIX = 'sap-handler-test-'

async function clearTestState() {
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

async function seed(name: string, childStatus = 'pending', seoOnly = false) {
  const site = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}${name}`, status: 'running', wcagLevel: 'wcag21aa',
      discoveredUrls: JSON.stringify([`https://${PREFIX}${name}/p`]), pagesTotal: 1,
      seoOnly,
    },
  })
  const child = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}${name}/p`, status: childStatus, siteAuditId: site.id, wcagLevel: 'wcag21aa' },
  })
  return { site, child, payload: { adaAuditId: child.id, siteAuditId: site.id, url: child.url, wcagLevel: 'wcag21aa' } }
}

const AXE_OK = {
  kind: 'audited' as const,
  axe: { violations: [] } as never,
  lighthouseSummary: null,
  lighthouseError: null,
  harvestedPdfUrls: [] as string[],
  harvestedLinks: [
    { targetUrl: 'https://dead.example/x', kind: 'internal-link' as const },
    { targetUrl: 'https://img.example/y.png', kind: 'image' as const },
  ],
  harvestedLinksTruncated: false,
}

describe('jobs/handlers/site-audit-page', () => {
  beforeEach(async () => {
    vi.mocked(runAxeAudit).mockReset()
    vi.mocked(dispatchPdfScans).mockClear()
    vi.mocked(finalizeSiteAudit).mockClear()
    vi.mocked(enqueuePsiJob).mockClear()
    vi.mocked(getLighthouseProvider).mockReturnValue('pagespeed')
    vi.mocked(publishInvalidation).mockClear()
    await clearTestState()
  })

  it('detached PSI success: axe-complete, lighthouseTotal + pagesComplete bumped, PSI enqueued, finalized', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    const { site, child, payload } = await seed('ok')
    await runSiteAuditPageJob(payload)
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('axe-complete')
    expect(c?.runnerType).toBe('browser')
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.pagesComplete).toBe(1)
    expect(s?.lighthouseTotal).toBe(1)
    expect(enqueuePsiJob).toHaveBeenCalledWith(payload)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
    // PDF dispatch happened BEFORE the PSI enqueue (settle order invariant).
    expect(vi.mocked(dispatchPdfScans).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(enqueuePsiJob).mock.invocationCallOrder[0])
    // C6: harvested links persisted after the successful settle.
    expect(await prisma.harvestedLink.count({ where: { siteAuditId: site.id } })).toBe(2)
  })

  it('local provider: complete + inline LH fields, no lighthouseTotal, no PSI job', async () => {
    vi.mocked(getLighthouseProvider).mockReturnValue('local')
    vi.mocked(runAxeAudit).mockResolvedValue({
      ...AXE_OK,
      lighthouseSummary: { performance: 80 } as never,
      lighthouseError: null,
    })
    const { site, child, payload } = await seed('local')
    await runSiteAuditPageJob(payload)
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('complete')
    expect(c?.lighthouseSummary).toContain('performance')
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.pagesComplete).toBe(1)
    expect(s?.lighthouseTotal).toBe(0)
    expect(enqueuePsiJob).not.toHaveBeenCalled()
  })

  it('redirected: child redirected + pagesRedirected bumped, no PDFs, no PSI', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue({ kind: 'redirected', finalUrl: 'https://elsewhere.example/' })
    const { site, child, payload } = await seed('redir')
    await runSiteAuditPageJob(payload)
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('redirected')
    expect(c?.finalUrl).toBe('https://elsewhere.example/')
    expect(c?.redirected).toBe(true)
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.pagesRedirected).toBe(1)
    expect(s?.pagesComplete).toBe(0)
    expect(dispatchPdfScans).not.toHaveBeenCalled()
    expect(enqueuePsiJob).not.toHaveBeenCalled()
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
    // C6: a redirected page has no audited DOM — no harvest.
    expect(await prisma.harvestedLink.count({ where: { siteAuditId: site.id } })).toBe(0)
  })

  it('axe throw is a DOMAIN error: child error + pagesError bumped, job completes (no throw)', async () => {
    vi.mocked(runAxeAudit).mockRejectedValue(new Error('nav timeout'))
    const { site, child, payload } = await seed('axe-err')
    await expect(runSiteAuditPageJob(payload)).resolves.toBeUndefined()
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('error')
    expect(c?.error).toContain('nav timeout')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pagesError).toBe(1)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('B3: an INFRASTRUCTURE throw rethrows (no settle) so the durable queue retries', async () => {
    vi.mocked(runAxeAudit).mockRejectedValue(new Error('Protocol error (Target.createTarget): ...'))
    const { site, child, payload } = await seed('infra-err')
    await expect(runSiteAuditPageJob(payload)).rejects.toThrow(/Target\.createTarget/)
    // Child NOT settled to a domain error; counters untouched; no finalize.
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).not.toBe('error')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pagesError).toBe(0)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('claims a "running" child (crash re-run) and re-audits it', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    const { child, payload } = await seed('rerun', 'running')
    await runSiteAuditPageJob(payload)
    expect((await prisma.adaAudit.findUnique({ where: { id: child.id } }))?.status).toBe('axe-complete')
  })

  it('claim-0 with axe-complete child: re-enqueues PSI + finalizes, no re-audit', async () => {
    const { site, payload } = await seed('resume-psi', 'axe-complete')
    await runSiteAuditPageJob(payload)
    expect(runAxeAudit).not.toHaveBeenCalled()
    expect(enqueuePsiJob).toHaveBeenCalledWith(payload)
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
  })

  it('claim-0 with terminal child: finalize only', async () => {
    const { site, payload } = await seed('resume-term', 'complete')
    await runSiteAuditPageJob(payload)
    expect(runAxeAudit).not.toHaveBeenCalled()
    expect(enqueuePsiJob).not.toHaveBeenCalled()
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
    // C6 (fix #3): an attempt that never freshly audited/settled persists no harvest.
    expect(await prisma.harvestedLink.count({ where: { siteAuditId: site.id } })).toBe(0)
  })

  it('A5: emits site-audit/recents/queue after a winning settle', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    const { site, payload } = await seed('emit-ok')
    await runSiteAuditPageJob(payload)
    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).toContain(`site-audit:${site.id}`)
    expect(calls).toContain('recents')
    expect(calls).toContain('queue')
  })

  it('A5: does NOT emit on a lost fence (claim-0, no settle)', async () => {
    // Terminal child → settlePage never runs (claim-0 path), so no emit.
    const { payload } = await seed('emit-noop', 'complete')
    await runSiteAuditPageJob(payload)
    expect(publishInvalidation).not.toHaveBeenCalled()
  })

  it('onExhausted settles the child as error + pagesError + finalize; no-ops on terminal', async () => {
    const { site, child, payload } = await seed('exhausted')
    await onSiteAuditPageExhausted(payload, { jobId: 'j1', attempts: 3, lastError: 'boom' })
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('error')
    expect(c?.error).toContain('failed after 3 attempts')
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pagesError).toBe(1)
    // second call: terminal now — no double bump, no finalize
    vi.mocked(finalizeSiteAudit).mockClear()
    await onSiteAuditPageExhausted(payload, { jobId: 'j1', attempts: 3, lastError: 'boom' })
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.pagesError).toBe(1)
    expect(finalizeSiteAudit).not.toHaveBeenCalled()
  })

  it('settle bumps SiteAudit.updatedAt (stale-recovery heartbeat)', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    const { site, payload } = await seed('heartbeat')
    const backdated = Date.now() - 60 * 60 * 1000
    await prisma.$executeRaw`UPDATE "SiteAudit" SET "updatedAt" = ${backdated} WHERE "id" = ${site.id}`
    await runSiteAuditPageJob(payload)
    const fresh = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(fresh!.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('rejects a malformed payload', async () => {
    await expect(runSiteAuditPageJob({ nope: true } as never)).rejects.toThrow(/payload/i)
  })

  it('C11: seoOnly page settles complete with pagesComplete++ and no PDF/PSI', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue({
      kind: 'rendered',
      harvestedLinks: [
        { targetUrl: 'https://dead.example/x', kind: 'internal-link' as const },
        { targetUrl: 'https://img.example/y.png', kind: 'image' as const },
      ],
      harvestedLinksTruncated: false,
      harvestedPageSeo: null,
    })
    const { site, child, payload } = await seed('seo-only', 'pending', true)
    await runSiteAuditPageJob(payload)
    // Runner asked to render only.
    expect(vi.mocked(runAxeAudit).mock.calls[0][3]).toMatchObject({ renderOnly: true })
    const row = await prisma.adaAudit.findUnique({ where: { id: child.id }, select: { status: true, result: true } })
    expect(row).toEqual({ status: 'complete', result: null })
    const refreshedParent = await prisma.siteAudit.findUnique({
      where: { id: site.id },
      select: { pagesComplete: true, pdfsTotal: true, lighthouseTotal: true },
    })
    expect(refreshedParent).toEqual({ pagesComplete: 1, pdfsTotal: 0, lighthouseTotal: 0 })
    expect(dispatchPdfScans).not.toHaveBeenCalled()
    expect(enqueuePsiJob).not.toHaveBeenCalled()
    expect(finalizeSiteAudit).toHaveBeenCalledWith(site.id)
    // Harvest still persisted on the successful settle.
    expect(await prisma.harvestedLink.count({ where: { siteAuditId: site.id } })).toBe(2)
  })
})

describe('persistPageSeo — content similarity fields', () => {
  const seo = (over: Partial<RawPageSeo>): RawPageSeo => ({
    title: 't', metaDescription: undefined, robotsNoindex: false, canonicalUrl: undefined,
    h1: 'h', h1Count: 1, h2Count: 0, wordCount: 120, schemaTypes: [], programNames: [], hreflang: [],
    imageCount: 0, imagesMissingAlt: 0, imagesMissingDimensions: 0, loginLike: false,
    contentText: undefined, contentTruncated: false,
    faqSignals: { heading: false, container: false, questionHeadings: 0 }, ...over,
  })

  it('persists contentText + contentTruncated on the harvested row', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: 'persist.test', status: 'complete' } })
    await persistPageSeo(audit.id, 'https://persist.test/p', seo({ contentText: 'the nursing program prepares students', contentTruncated: true }))
    const row = await prisma.harvestedPageSeo.findFirst({ where: { siteAuditId: audit.id } })
    expect(row?.contentText).toBe('the nursing program prepares students')
    expect(row?.contentTruncated).toBe(true)
    await prisma.siteAudit.delete({ where: { id: audit.id } })
  })

  it('writes faqSignals into detailsJson', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: 'faq.test', status: 'complete' } })
    await persistPageSeo(audit.id, 'https://faq.test/p', seo({
      faqSignals: { heading: true, container: false, questionHeadings: 4 },
    }))
    const row = await prisma.harvestedPageSeo.findFirst({ where: { siteAuditId: audit.id } })
    const details = JSON.parse(row!.detailsJson!)
    expect(details.faqSignals).toEqual({ heading: true, container: false, questionHeadings: 4 })
    await prisma.siteAudit.delete({ where: { id: audit.id } })
  })
})

describe('C14 hero: capture request + fenced publication', () => {
  let heroDir: string
  const prevHeroEnv = process.env.HERO_SCREENSHOTS_DIR
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

  beforeAll(async () => {
    heroDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-pub-'))
    process.env.HERO_SCREENSHOTS_DIR = heroDir
  })
  // This describe is a SIBLING of `jobs/handlers/site-audit-page` above, not a
  // nested child — its beforeEach (mockReset on runAxeAudit) does not apply
  // here, so `mock.calls[0]` would otherwise pick up the first call from the
  // whole file. Reset the mock locally before each test in this block.
  beforeEach(() => {
    vi.mocked(runAxeAudit).mockReset()
  })
  afterAll(async () => {
    if (prevHeroEnv === undefined) delete process.env.HERO_SCREENSHOTS_DIR
    else process.env.HERO_SCREENSHOTS_DIR = prevHeroEnv
    await fs.rm(heroDir, { recursive: true, force: true })
    await prisma.prospect.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  })

  async function seedProspectRoot(name: string) {
    const prospect = await prisma.prospect.create({ data: { name, domain: `${PREFIX}${name}` } })
    const site = await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}${name}`, status: 'running', wcagLevel: 'wcag21aa',
        prospectId: prospect.id,
        discoveredUrls: JSON.stringify([`https://${PREFIX}${name}/`]), pagesTotal: 1,
      },
    })
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}${name}/`, status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    return { site, child, payload: { adaAuditId: child.id, siteAuditId: site.id, url: child.url, wcagLevel: 'wcag21aa' } }
  }

  it('requests capture on the prospect root page and publishes file + stamp after a winning settle', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue({ ...AXE_OK, heroScreenshotPng: PNG } as never)
    const { site, payload } = await seedProspectRoot('hero-ok')
    await runSiteAuditPageJob(payload)
    // capture was requested
    const opts = vi.mocked(runAxeAudit).mock.calls[0][3]
    expect(opts?.captureHeroScreenshot).toBe(true)
    // file + stamp published
    const buf = await fs.readFile(path.join(heroDir, `${site.id}.png`))
    expect([...buf]).toEqual([...PNG])
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.homepageScreenshot).toBe(`${site.id}.png`)
  })

  it('does NOT request capture for a non-prospect audit or a non-root page', async () => {
    vi.mocked(runAxeAudit).mockResolvedValue({ ...AXE_OK, heroScreenshotPng: null } as never)
    const { payload } = await seed('hero-nonprospect') // existing helper: no prospectId
    await runSiteAuditPageJob(payload)
    expect(vi.mocked(runAxeAudit).mock.calls[0][3]?.captureHeroScreenshot).toBeFalsy()
  })

  it('a LOST settle publishes no file and no stamp (zombie attempt)', async () => {
    const { site, child, payload } = await seedProspectRoot('hero-lost')
    // Zombie simulation: the "runner" flips the child terminal mid-run, so
    // this attempt's settle (claimable: ['running']) matches 0 rows.
    vi.mocked(runAxeAudit).mockImplementation(async () => {
      await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'complete' } })
      return { ...AXE_OK, heroScreenshotPng: PNG } as never
    })
    await runSiteAuditPageJob(payload)
    await expect(fs.access(path.join(heroDir, `${site.id}.png`))).rejects.toThrow()
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.homepageScreenshot).toBeNull()
  })

  it('root→www redirect: bytes on the redirected result are published after the winning redirect settle (plan Codex fix 1)', async () => {
    const { site, child, payload } = await seedProspectRoot('hero-redir')
    // The runner captured the rendered www root BEFORE returning redirected
    // (redirect-detect classifies www changes as redirects by design).
    vi.mocked(runAxeAudit).mockResolvedValue({
      kind: 'redirected', finalUrl: `https://www.${PREFIX}hero-redir/`, heroScreenshotPng: PNG,
    } as never)
    await runSiteAuditPageJob(payload)
    const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(c?.status).toBe('redirected') // redirect classification unchanged
    const buf = await fs.readFile(path.join(heroDir, `${site.id}.png`))
    expect([...buf]).toEqual([...PNG])
    const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
    expect(s?.homepageScreenshot).toBe(`${site.id}.png`)
  })

  it('off-domain / cross-path redirect: runner returned null bytes — nothing published', async () => {
    // The same-domain-root gate lives in the RUNNER (isRootUrl against the
    // original host — unit-covered in root-url.test.ts); the handler just
    // publishes whatever bytes it was handed. Null bytes ⇒ no file, no stamp.
    vi.mocked(runAxeAudit).mockResolvedValue({
      kind: 'redirected', finalUrl: 'https://elsewhere.example/landing', heroScreenshotPng: null,
    } as never)
    const { site, payload } = await seedProspectRoot('hero-offsite')
    await runSiteAuditPageJob(payload)
    await expect(fs.access(path.join(heroDir, `${site.id}.png`))).rejects.toThrow()
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.homepageScreenshot).toBeNull()
  })

  it('publish guard (plan Codex fix 2): audit no longer prospect-owned ⇒ no stamp AND the just-written file is removed', async () => {
    // Simulates a prospect DELETE racing the publish: SetNull already ran.
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}hero-orphan`, status: 'running', wcagLevel: 'wcag21aa', prospectId: null },
    })
    await publishHeroScreenshot(site.id, PNG)
    expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.homepageScreenshot).toBeNull()
    await expect(fs.access(path.join(heroDir, `${site.id}.png`))).rejects.toThrow() // orphan file cleaned up
  })
})
