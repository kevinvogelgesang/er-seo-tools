// app/ada-audit/site/[id]/page.fallback.test.tsx
//
// DB-backed tests for the site results page's C3 behavior:
// - archived summary fallback (pruned blob → buildSummaryFromFindings)
// - score prefers CrawlRun.score over the counts-derived score
// - SiteAuditDiffPanel wiring (rendered only when a previous run exists)
// The page is an async server component — we invoke it directly and inspect
// the returned element tree (no DOM render).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSiteFindings } from '@/lib/findings/ada-write'
import SiteAuditResultPage from './page'
import SiteAuditResultsView from '@/components/ada-audit/SiteAuditResultsView'
import SiteAuditDiffPanel from '@/components/ada-audit/SiteAuditDiffPanel'

const DOMAIN = 'c3det-wire.example'

function axeBlob(url: string): string {
  return JSON.stringify({
    violations: [
      {
        id: 'image-alt',
        impact: 'critical',
        help: 'Images must have alternate text',
        description: 'd',
        helpUrl: 'https://example.org/ia',
        tags: ['wcag2a'],
        nodes: [{ html: '<img>', target: ['img'] }],
      },
    ],
    passes: [{ id: 'p1', help: 'p', nodes: [] }],
    incomplete: [],
    inapplicable: [],
    timestamp: '2026-06-12T00:00:00Z',
    url,
    testEngine: { name: 'axe-core', version: '4.10' },
    testRunner: { name: 'er-seo-tools' },
  })
}

async function clearState() {
  // CrawlRun first (subtree cascades from it), THEN the origin rows.
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: 'c3det-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: 'c3det-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'c3det-' } } })
}

async function seedCompleteSite(completedAt: Date) {
  const site = await prisma.siteAudit.create({
    data: {
      domain: DOMAIN,
      status: 'complete',
      wcagLevel: 'wcag21aa',
      pagesTotal: 1,
      pagesComplete: 1,
      summary: null, // pruned
      startedAt: new Date(completedAt.getTime() - 60_000),
      completedAt,
    },
  })
  await prisma.adaAudit.create({
    data: {
      url: `https://${DOMAIN}/page-0`,
      status: 'complete',
      result: axeBlob(`https://${DOMAIN}/page-0`),
      siteAuditId: site.id,
      wcagLevel: 'wcag21aa',
    },
  })
  await writeAdaSiteFindings(site.id)
  return site
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function findByType(node: unknown, type: unknown): any | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByType(child, type)
      if (found) return found
    }
    return null
  }
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === type) return el
  return el.props ? findByType(el.props.children, type) : null
}

async function renderPage(id: string) {
  return SiteAuditResultPage({ params: Promise.resolve({ id }) })
}

describe('SiteAuditResultPage — archived fallback + diff panel wiring', () => {
  beforeEach(clearState)
  afterEach(clearState)

  it('renders the archived summary fallback with the CrawlRun score; no diff panel without a previous run', async () => {
    const site = await seedCompleteSite(new Date('2026-06-01T00:10:00Z'))
    await prisma.crawlRun.update({ where: { siteAuditId: site.id }, data: { score: 42 } })

    const tree = await renderPage(site.id)
    const view = findByType(tree, SiteAuditResultsView)
    expect(view).not.toBeNull()
    expect(view.props.summary.archived).toBe(true)
    expect(view.props.score).toBe(42) // CrawlRun.score wins over counts-derived
    expect(findByType(tree, SiteAuditDiffPanel)).toBeNull()
  })

  it('renders the diff panel anchored at the previous same-domain run', async () => {
    const earlier = await seedCompleteSite(new Date('2026-06-01T00:10:00Z'))
    const later = await seedCompleteSite(new Date('2026-06-08T00:10:00Z'))

    const tree = await renderPage(later.id)
    const panel = findByType(tree, SiteAuditDiffPanel)
    expect(panel).not.toBeNull()
    expect(panel.props.previous.siteAuditId).toBe(earlier.id)
    // Identical seeded runs → all unchanged.
    expect(panel.props.diff.unchangedCount).toBe(1)
    expect(panel.props.diff.newCount).toBe(0)
  })
})
