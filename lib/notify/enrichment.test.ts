import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { loadCompleteEnrichment } from './enrichment'

const DOM = 'enrich-test.example'
afterEach(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: DOM } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOM } })
})

async function mkRun(data: Record<string, unknown>) {
  return prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', domain: DOM, ...data } })
}

describe('loadCompleteEnrichment', () => {
  it('counts broken (summed count) + on-page + ada, and flags partial', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 5, pagesTotal: 6 } })
    const live = await mkRun({ siteAuditId: audit.id, status: 'partial', score: 80,
      findings: { create: [
        { scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 3, dedupKey: 'a' },
        { scope: 'run', type: 'broken_images', severity: 'critical', count: 2, dedupKey: 'b' },
        { scope: 'run', type: 'duplicate_title', severity: 'warning', count: 1, dedupKey: 'c' },
        { scope: 'run', type: 'missing_h1', severity: 'warning', count: 4, dedupKey: 'd' },
      ] } })
    const ada = await prisma.crawlRun.create({ data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', domain: DOM, wcagLevel: 'wcag21aa', siteAuditId: audit.id, score: 100,
      findings: { create: [{ scope: 'page', type: 'image-alt', severity: 'critical', url: 'https://x/a', count: 1, dedupKey: 'e' }] } } })
    const input = {
      id: audit.id, domain: DOM, seoOnly: false, pagesComplete: 5, pagesTotal: 6,
      crawlRuns: [
        { id: live.id, tool: 'seo-parser', source: 'live-scan', status: 'partial', score: 80, scoreBreakdown: null, domain: DOM, completedAt: null, createdAt: live.createdAt },
        { id: ada.id, tool: 'ada-audit', source: 'site-audit', status: 'complete', score: 100, scoreBreakdown: null, domain: DOM, completedAt: null, createdAt: ada.createdAt },
      ],
    }
    const e = await loadCompleteEnrichment(input)
    expect(e.counts.brokenLinks).toBe(5)   // 3 + 2, summed count (not row count)
    expect(e.counts.onPageIssues).toBe(5)  // 1 + 4
    expect(e.counts.adaViolations).toBe(1)
    expect(e.partial.seo).toBe(true)
    expect(e.partial.ada).toBe(false)
    expect(e.pagesComplete).toBe(5)
    expect(e.pagesTotal).toBe(6)
  })

  it('null counts (not 0) when the relevant run is absent', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 0, pagesTotal: 0 } })
    const live = await mkRun({ siteAuditId: audit.id, score: 70 })
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 0, pagesTotal: 0,
      crawlRuns: [{ id: live.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 70, scoreBreakdown: null, domain: DOM, completedAt: null, createdAt: live.createdAt }] }
    const e = await loadCompleteEnrichment(input)
    expect(e.counts.adaViolations).toBeNull()   // no ada run → unknown
    expect(e.counts.brokenLinks).toBe(0)         // live run present, none found → 0
  })

  it('SEO delta picks the latest earlier same-domain live run with a non-null score', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 1, pagesTotal: 1 } })
    const cur = await mkRun({ siteAuditId: audit.id, score: 90, completedAt: new Date('2026-07-08') })
    await mkRun({ score: 80, completedAt: new Date('2026-07-01') })      // older
    await mkRun({ score: null, completedAt: new Date('2026-07-05') })    // newer but null score — skipped
    await mkRun({ score: 85, completedAt: new Date('2026-07-03') })      // the winner
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 1, pagesTotal: 1,
      crawlRuns: [{ id: cur.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 90, scoreBreakdown: null, domain: DOM, completedAt: cur.completedAt, createdAt: cur.createdAt }] }
    const e = await loadCompleteEnrichment(input)
    expect(e.change.seoDelta).toBe(5) // 90 - 85
  })

  it('rejects a later candidate for SEO delta (only strictly-earlier runs count)', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 1, pagesTotal: 1 } })
    const ts = new Date('2026-07-08')
    const cur = await mkRun({ siteAuditId: audit.id, score: 90, completedAt: ts })
    await mkRun({ score: 60, completedAt: new Date('2026-07-10') })  // later → excluded
    await mkRun({ score: 70, completedAt: new Date('2026-07-02') })  // earlier → the winner
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 1, pagesTotal: 1,
      crawlRuns: [{ id: cur.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 90, scoreBreakdown: null, domain: DOM, completedAt: ts, createdAt: cur.createdAt }] }
    const e = await loadCompleteEnrichment(input)
    expect(e.change.seoDelta).toBe(20) // 90 - 70, never the later 60
  })

  it('suppresses seoDelta on score-breakdown version mismatch', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 1, pagesTotal: 1 } })
    const cur = await mkRun({ siteAuditId: audit.id, score: 90, completedAt: new Date('2026-07-08'),
      scoreBreakdown: JSON.stringify({ version: 2, scorer: 'live-seo', score: 90, factors: [] }) })
    await mkRun({ score: 80, completedAt: new Date('2026-07-01'),
      scoreBreakdown: JSON.stringify({ version: 1, scorer: 'live-seo', score: 80, factors: [] }) })
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 1, pagesTotal: 1,
      crawlRuns: [{ id: cur.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 90,
        scoreBreakdown: JSON.stringify({ version: 2, scorer: 'live-seo', score: 90, factors: [] }),
        domain: DOM, completedAt: new Date('2026-07-08'), createdAt: cur.createdAt }] }
    const e = await loadCompleteEnrichment(input)
    expect(e.change.seoDelta).toBeNull() // version 2 vs 1 → suppressed
  })

  it('suppresses seoDelta on a same-version weights-hash mismatch (C19)', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 1, pagesTotal: 1 } })
    const cur = await mkRun({ siteAuditId: audit.id, score: 90, completedAt: new Date('2026-07-08'),
      scoreBreakdown: JSON.stringify({ version: 2, weightsHash: 'hash-b', scorer: 'live-seo', score: 90, factors: [] }) })
    await mkRun({ score: 70, completedAt: new Date('2026-07-01'),
      scoreBreakdown: JSON.stringify({ version: 2, weightsHash: 'hash-a', scorer: 'live-seo', score: 70, factors: [] }) })
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 1, pagesTotal: 1,
      crawlRuns: [{ id: cur.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 90,
        scoreBreakdown: JSON.stringify({ version: 2, weightsHash: 'hash-b', scorer: 'live-seo', score: 90, factors: [] }),
        domain: DOM, completedAt: new Date('2026-07-08'), createdAt: cur.createdAt }] }
    const e = await loadCompleteEnrichment(input)
    // Numeric delta would be 20 (90 - 70), but same-version differing weightsHash suppresses it.
    expect(e.change.seoDelta).toBeNull()
  })
})
