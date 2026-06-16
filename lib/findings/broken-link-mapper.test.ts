import { describe, it, expect } from 'vitest'
import { mapBrokenLinkFindings, type BrokenTarget } from './broken-link-mapper'
import type { CrawlPageInput } from './types'

function harness() {
  const pages: CrawlPageInput[] = []
  const byUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string): CrawlPageInput => {
    let p = byUrl.get(url)
    if (!p) { p = { id: `p-${byUrl.size}`, runId: 'R', url, status: null, error: null, finalUrl: null,
      statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null, crawlDepth: null,
      indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }
      pages.push(p); byUrl.set(url, p) }
    return p
  }
  return { pages, ensurePage }
}

describe('mapBrokenLinkFindings', () => {
  it('emits run-scope distinct-target counts + source-page-keyed page findings', () => {
    const { pages, ensurePage } = harness()
    const broken: BrokenTarget[] = [
      { targetUrl: 'https://x.com/dead', kind: 'internal-link', sourcePageUrls: ['https://x.com/a', 'https://x.com/b'] },
    ]
    const findings = mapBrokenLinkFindings(broken, {
      runId: 'R', ensurePage, affectedComplete: true,
      confidence: { checked: 1, broken: 1, unconfirmed: 0, capped: false, harvestTruncated: false },
    })
    const run = findings.find((f) => f.scope === 'run' && f.type === 'broken_internal_links')!
    expect(run.count).toBe(1)
    expect(findings.filter((f) => f.scope === 'page' && f.type === 'broken_internal_links').length).toBe(2)
    expect(pages.length).toBe(2) // keyed by SOURCE page
  })
})
