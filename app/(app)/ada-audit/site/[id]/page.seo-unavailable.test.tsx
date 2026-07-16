// app/ada-audit/site/[id]/page.seo-unavailable.test.tsx
//
// Verifier-memory-loop fix (Task 5): when the audit's only seo-parser run is
// the exhausted-verifier terminal placeholder (source: 'live-scan-placeholder'),
// the results page's SEO tab must render ONE SeoUnavailableNotice card instead
// of the full section stack — none of BrokenLinksSection/OnPageSeoSection/etc
// may render a misleading empty state. A real live-scan run must still render
// the full stack (regression guard).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSiteFindings } from '@/lib/findings/ada-write'
import SiteAuditResultPage from './page'
import SeoUnavailableNotice from '@/components/site-audit/SeoUnavailableNotice'
import { BrokenLinksSection } from '@/components/site-audit/BrokenLinksSection'

const DOMAIN = 'c21ph-seo-unavailable.example'

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
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: 'c21ph-seo-unavailable' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

async function seedCompleteSite() {
  const site = await prisma.siteAudit.create({
    data: {
      domain: DOMAIN,
      status: 'complete',
      wcagLevel: 'wcag21aa',
      pagesTotal: 1,
      pagesComplete: 1,
      summary: null, // pruned — findings-fallback path
      startedAt: new Date('2026-07-01T00:00:00Z'),
      completedAt: new Date('2026-07-01T00:10:00Z'),
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
  const el = node as { type?: unknown; props?: Record<string, unknown> }
  if (el.type === type) return el
  if (el.props) {
    for (const key of Object.keys(el.props)) {
      const found = findByType(el.props[key], type)
      if (found) return found
    }
  }
  return null
}

async function renderPage(id: string) {
  return SiteAuditResultPage({ params: Promise.resolve({ id }) })
}

describe('SiteAuditResultPage — SEO-unavailable page-level branch', () => {
  beforeEach(clearState)
  afterEach(clearState)

  it('renders SeoUnavailableNotice, not the section stack, for an exhausted-verifier placeholder run', async () => {
    const site = await seedCompleteSite()
    await prisma.crawlRun.create({
      data: { siteAuditId: site.id, tool: 'seo-parser', source: 'live-scan-placeholder', domain: DOMAIN, status: 'partial', seoIntent: false },
    })

    const tree = await renderPage(site.id)
    expect(findByType(tree, SeoUnavailableNotice)).not.toBeNull()
    expect(findByType(tree, BrokenLinksSection)).toBeNull()
  })

  it('renders the full section stack for a real live-scan run (regression guard)', async () => {
    const site = await seedCompleteSite()
    await prisma.crawlRun.create({
      data: { siteAuditId: site.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete' },
    })

    const tree = await renderPage(site.id)
    expect(findByType(tree, BrokenLinksSection)).not.toBeNull()
    expect(findByType(tree, SeoUnavailableNotice)).toBeNull()
  })
})
