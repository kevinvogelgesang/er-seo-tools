// app/ada-audit/site/share/[token]/page.seo-unavailable.test.tsx
//
// Verifier-memory-loop fix (Task 5): the share page must never render the
// full SEO section stack for an exhausted-verifier terminal placeholder run
// (source: 'live-scan-placeholder') — one SeoUnavailableNotice card instead.
// A real live-scan run must still render the full stack (regression guard).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSiteFindings } from '@/lib/findings/ada-write'
import SharedSiteAuditPage from './page'
import SeoUnavailableNotice from '@/components/site-audit/SeoUnavailableNotice'
import { BrokenLinksSection } from '@/components/site-audit/BrokenLinksSection'
import { AnchorTextSection } from '@/components/site-audit/AnchorTextSection'

const DOMAIN = 'c21ph-share-seo-unavail.example'

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
  await prisma.adaAudit.deleteMany({ where: { url: { contains: 'c21ph-share-seo-unavail' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

async function seedShareableSite(shareToken: string) {
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
      shareToken,
      shareExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
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

async function renderPage(token: string) {
  return SharedSiteAuditPage({ params: Promise.resolve({ token }) })
}

describe('SharedSiteAuditPage — SEO-unavailable page-level branch', () => {
  beforeEach(clearState)
  afterEach(clearState)

  it('renders SeoUnavailableNotice, not the section stack, for an exhausted-verifier placeholder run', async () => {
    const token = 'c21ph-share-token-placeholder'
    const site = await seedShareableSite(token)
    await prisma.crawlRun.create({
      data: { siteAuditId: site.id, tool: 'seo-parser', source: 'live-scan-placeholder', domain: DOMAIN, status: 'partial', seoIntent: false },
    })

    const tree = await renderPage(token)
    expect(findByType(tree, SeoUnavailableNotice)).not.toBeNull()
    expect(findByType(tree, BrokenLinksSection)).toBeNull()
    expect(findByType(tree, AnchorTextSection)).toBeNull()
  })

  it('renders the full section stack for a real live-scan run (regression guard)', async () => {
    const token = 'c21ph-share-token-real'
    const site = await seedShareableSite(token)
    await prisma.crawlRun.create({
      data: {
        siteAuditId: site.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete',
        anchorSummaryJson: '{"v":1,"targetsObserved":3}',
      },
    })

    const tree = await renderPage(token)
    expect(findByType(tree, BrokenLinksSection)).not.toBeNull()
    expect(findByType(tree, SeoUnavailableNotice)).toBeNull()
    const anchorEl = findByType(tree, AnchorTextSection)
    expect(anchorEl).not.toBeNull()
    expect(anchorEl.props.run.anchorSummaryJson).toBe('{"v":1,"targetsObserved":3}')
  })
})
