// lib/services/site-audit-diff.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { pageFindingKey, normalizeFindingUrl } from '@/lib/findings/keys'
import { getSiteAuditInstanceDiff, getRunPairInstanceDiff } from './site-audit-diff'

const PREFIX = 'c3diff-'
const siteAuditIds: string[] = []

beforeAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

afterAll(async () => {
  // CrawlRun by domain BEFORE origin rows (subtree cascades from CrawlRun).
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  if (siteAuditIds.length) {
    await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  }
})

interface SeedPage {
  url: string
  findings?: { type: string; severity?: string }[]
}

// Seeds a complete SiteAudit origin + its CrawlRun with complete CrawlPages
// and page-scope Findings, using the real pageFindingKey so dedupKeys match
// across runs (the same identity the A2 mappers write).
async function seedSiteRun(opts: {
  domain: string
  completedAt: Date
  pages: SeedPage[]
  wcagLevel?: string
  runId?: string
}) {
  const wcagLevel = opts.wcagLevel ?? 'wcag21aa'
  const audit = await prisma.siteAudit.create({
    data: { domain: opts.domain, status: 'complete', wcagLevel, completedAt: opts.completedAt },
  })
  siteAuditIds.push(audit.id)
  const run = await prisma.crawlRun.create({
    data: {
      ...(opts.runId ? { id: opts.runId } : {}),
      tool: 'ada-audit', source: 'site-audit', domain: opts.domain, wcagLevel,
      status: 'complete', pagesTotal: opts.pages.length,
      completedAt: opts.completedAt, siteAuditId: audit.id,
    },
  })
  for (const p of opts.pages) {
    const url = normalizeFindingUrl(p.url)
    const page = await prisma.crawlPage.create({
      data: { runId: run.id, url, status: 'complete' },
    })
    for (const f of p.findings ?? []) {
      await prisma.finding.create({
        data: {
          runId: run.id, pageId: page.id, scope: 'page', type: f.type,
          severity: f.severity ?? 'critical', url,
          dedupKey: pageFindingKey(f.type, url),
        },
      })
    }
  }
  return { runId: run.id, siteAuditId: audit.id }
}

describe('getSiteAuditInstanceDiff', () => {
  it('diffs against the most recent earlier same-domain same-level run', async () => {
    const domain = `${PREFIX}t1.example`
    const base = `https://${domain}`
    const oldest = await seedSiteRun({
      domain, completedAt: new Date('2026-04-01T00:00:00Z'),
      pages: [{ url: `${base}/a`, findings: [{ type: 'image-alt' }] }],
    })
    const middle = await seedSiteRun({
      domain, completedAt: new Date('2026-05-01T00:00:00Z'),
      pages: [{ url: `${base}/a`, findings: [{ type: 'label' }] }],
    })
    const current = await seedSiteRun({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [
        { url: `${base}/a`, findings: [{ type: 'label' }, { type: 'color-contrast' }] },
      ],
    })

    const result = await getSiteAuditInstanceDiff(current.siteAuditId)
    expect(result).not.toBeNull()
    // previous = middle (most recent earlier), not oldest
    expect(result!.previous.runId).toBe(middle.runId)
    expect(result!.previous.siteAuditId).toBe(middle.siteAuditId)
    expect(result!.previous.completedAt).toBe('2026-05-01T00:00:00.000Z')
    expect(result!.previous.siteAuditId).not.toBe(oldest.siteAuditId)
    // label /a unchanged; color-contrast /a regressed (page scanned before)
    expect(result!.diff.unchangedCount).toBe(1)
    expect(result!.diff.regressedCount).toBe(1)
    expect(result!.diff.newCount).toBe(1)
    expect(result!.diff.resolvedCount).toBe(0)
  })

  it('skips earlier runs with a different wcagLevel → null when none match', async () => {
    const domain = `${PREFIX}t2.example`
    const base = `https://${domain}`
    await seedSiteRun({
      domain, wcagLevel: 'wcag22aa', completedAt: new Date('2026-05-01T00:00:00Z'),
      pages: [{ url: `${base}/a`, findings: [{ type: 'image-alt' }] }],
    })
    const current = await seedSiteRun({
      domain, wcagLevel: 'wcag21aa', completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [{ url: `${base}/a`, findings: [{ type: 'image-alt' }] }],
    })
    expect(await getSiteAuditInstanceDiff(current.siteAuditId)).toBeNull()
  })

  it('returns null when the siteAuditId has no CrawlRun (pre-A2 audit)', async () => {
    const audit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}t4.example`, status: 'complete', wcagLevel: 'wcag21aa' },
    })
    siteAuditIds.push(audit.id)
    expect(await getSiteAuditInstanceDiff(audit.id)).toBeNull()
  })

  it('breaks identical-completedAt ties by id desc', async () => {
    const domain = `${PREFIX}t5.example`
    const base = `https://${domain}`
    const tie = new Date('2026-05-01T00:00:00Z')
    await seedSiteRun({
      domain, completedAt: tie, runId: `${PREFIX}tie-aaa`,
      pages: [{ url: `${base}/a` }],
    })
    await seedSiteRun({
      domain, completedAt: tie, runId: `${PREFIX}tie-zzz`,
      pages: [{ url: `${base}/a` }],
    })
    const current = await seedSiteRun({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [{ url: `${base}/a` }],
    })
    const result = await getSiteAuditInstanceDiff(current.siteAuditId)
    expect(result!.previous.runId).toBe(`${PREFIX}tie-zzz`)
  })

  it('classification round-trip: prev-only finding → resolved when page rescanned, not-rescanned when absent', async () => {
    const domain = `${PREFIX}t6.example`
    const base = `https://${domain}`
    await seedSiteRun({
      domain, completedAt: new Date('2026-05-01T00:00:00Z'),
      pages: [
        { url: `${base}/kept`, findings: [{ type: 'image-alt' }] },
        { url: `${base}/dropped`, findings: [{ type: 'image-alt' }] },
      ],
    })
    const current = await seedSiteRun({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [{ url: `${base}/kept` }], // rescanned clean; /dropped not rescanned
    })
    const result = await getSiteAuditInstanceDiff(current.siteAuditId)
    expect(result!.diff.resolvedCount).toBe(1)
    expect(result!.diff.notRescannedCount).toBe(1)
    expect(result!.diff.newCount).toBe(0)
    expect(result!.diff.unchangedCount).toBe(0)
  })
})

describe('getRunPairInstanceDiff', () => {
  it('returns null on wcagLevel mismatch (Codex spec-fix #1)', async () => {
    const domain = `${PREFIX}t3.example`
    const base = `https://${domain}`
    const prev = await seedSiteRun({
      domain, wcagLevel: 'wcag22aa', completedAt: new Date('2026-05-01T00:00:00Z'),
      pages: [{ url: `${base}/a`, findings: [{ type: 'image-alt' }] }],
    })
    const cur = await seedSiteRun({
      domain, wcagLevel: 'wcag21aa', completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [{ url: `${base}/a`, findings: [{ type: 'image-alt' }] }],
    })
    expect(await getRunPairInstanceDiff(cur.runId, prev.runId)).toBeNull()
  })

  it('returns null when either run is not an ada-audit run (Codex plan-fix #6)', async () => {
    const domain = `${PREFIX}t3b.example`
    const base = `https://${domain}`
    const ada = await seedSiteRun({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [{ url: `${base}/a` }],
    })
    const seo = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'sf-upload', domain,
        status: 'complete', completedAt: new Date('2026-05-01T00:00:00Z'),
      },
    })
    expect(await getRunPairInstanceDiff(ada.runId, seo.id)).toBeNull()
    expect(await getRunPairInstanceDiff(seo.id, ada.runId)).toBeNull()
  })

  it('returns null when either run id is missing', async () => {
    const domain = `${PREFIX}t3c.example`
    const ada = await seedSiteRun({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [{ url: `https://${domain}/a` }],
    })
    expect(await getRunPairInstanceDiff(ada.runId, 'no-such-run')).toBeNull()
    expect(await getRunPairInstanceDiff('no-such-run', ada.runId)).toBeNull()
  })

  it('computes the diff for a level-matched pair', async () => {
    const domain = `${PREFIX}t7.example`
    const base = `https://${domain}`
    const prev = await seedSiteRun({
      domain, completedAt: new Date('2026-05-01T00:00:00Z'),
      pages: [{ url: `${base}/a`, findings: [{ type: 'label' }] }],
    })
    const cur = await seedSiteRun({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      pages: [{ url: `${base}/a`, findings: [{ type: 'label' }, { type: 'image-alt' }] }],
    })
    const diff = await getRunPairInstanceDiff(cur.runId, prev.runId)
    expect(diff).not.toBeNull()
    expect(diff!.unchangedCount).toBe(1)
    expect(diff!.regressedCount).toBe(1)
    expect(diff!.rules.map((r) => r.type)).toEqual(['image-alt'])
  })
})
