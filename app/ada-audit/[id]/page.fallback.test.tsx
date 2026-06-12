// app/ada-audit/[id]/page.fallback.test.tsx
//
// DB-backed tests for the standalone results page's C3 behavior:
// - ?from= previousScore prefers the baseline's CrawlRun.score (blob fallback pre-A2)
// - archived fallback: pruned blob → buildArchivedAxeResults + CrawlRun.score
// The page is an async server component — we invoke it directly and inspect
// the AuditResultsView element's props in the returned tree (no DOM render).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSingleFindings } from '@/lib/findings/ada-write'
import AdaAuditResultPage from './page'
import AuditResultsView from '@/components/ada-audit/AuditResultsView'

const DOMAIN = 'c3det-from.example'

function cleanBlob(url: string): string {
  return JSON.stringify({
    violations: [],
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
}

async function seedCompleteAudit(path: string) {
  const url = `https://${DOMAIN}/${path}`
  return prisma.adaAudit.create({
    data: { url, status: 'complete', wcagLevel: 'wcag21aa', result: cleanBlob(url) },
  })
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

async function renderPage(id: string, from?: string) {
  return AdaAuditResultPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(from ? { from } : {}),
  })
}

describe('AdaAuditResultPage — ?from= score source + archived fallback', () => {
  beforeEach(clearState)
  afterEach(clearState)

  it('previousScore prefers the baseline CrawlRun.score over the blob-derived score', async () => {
    const current = await seedCompleteAudit('current')
    const baseline = await seedCompleteAudit('baseline-with-run') // blob-derived score would be 100
    await prisma.crawlRun.create({
      data: {
        tool: 'ada-audit', source: 'page-audit', domain: DOMAIN,
        status: 'complete', adaAuditId: baseline.id, score: 73, wcagLevel: 'wcag21aa',
      },
    })

    const tree = await renderPage(current.id, baseline.id)
    const view = findByType(tree, AuditResultsView)
    expect(view).not.toBeNull()
    expect(view.props.previousScore).toBe(73)
  })

  it('falls back to the blob-derived score when the baseline has no CrawlRun (pre-A2)', async () => {
    const current = await seedCompleteAudit('current2')
    const baseline = await seedCompleteAudit('baseline-no-run')

    const tree = await renderPage(current.id, baseline.id)
    const view = findByType(tree, AuditResultsView)
    expect(view.props.previousScore).toBe(100)
  })

  it('renders archived results with CrawlRun.score when the blob is pruned', async () => {
    const audit = await seedCompleteAudit('archived')
    await writeAdaSingleFindings(audit.id)
    await prisma.crawlRun.update({ where: { adaAuditId: audit.id }, data: { score: 42 } })
    await prisma.adaAudit.update({ where: { id: audit.id }, data: { result: null } })

    const tree = await renderPage(audit.id)
    const view = findByType(tree, AuditResultsView)
    expect(view).not.toBeNull()
    expect(view.props.results.archived).toBe(true)
    expect(view.props.score).toBe(42)
    // Archived compliance = zero violation rows, not the node-based formula.
    expect(view.props.compliant).toBe(true)
  })
})
