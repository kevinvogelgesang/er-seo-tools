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

describe('mapBrokenLinkFindings — external links', () => {
  // Minimal ensurePage stub (mirror the file's existing one if present).
  const makeEnsure = () => {
    const byUrl = new Map<string, any>()
    return (url: string) => {
      let p = byUrl.get(url)
      if (!p) { p = { id: `p-${byUrl.size}`, runId: 'R', url } as any; byUrl.set(url, p) }
      return p
    }
  }
  const conf = { checked: 0, broken: 0, unconfirmed: 0, capped: false, harvestTruncated: false }

  it('maps external-link broken targets to broken_external_links at warning severity', () => {
    const broken: BrokenTarget[] = [
      { targetUrl: 'https://out.example/dead', kind: 'external-link', sourcePageUrls: ['https://site.example/a'] },
    ]
    const out = mapBrokenLinkFindings(broken, {
      runId: 'R', ensurePage: makeEnsure(), affectedComplete: true,
      confidence: { ...conf, broken: 1, checked: 1 }, severity: 'warning',
    })
    const run = out.find((f) => f.scope === 'run')!
    expect(run.type).toBe('broken_external_links')
    expect(run.severity).toBe('warning')
    expect(run.count).toBe(1)
    expect(out.some((f) => f.scope === 'page' && f.type === 'broken_external_links')).toBe(true)
  })

  it('emits nothing when there are no broken external targets (no zero-count finding)', () => {
    const out = mapBrokenLinkFindings([], {
      runId: 'R', ensurePage: makeEnsure(), affectedComplete: true,
      confidence: { ...conf, checked: 12, unconfirmed: 3 }, severity: 'warning',
    })
    expect(out).toHaveLength(0)
  })

  it('defaults internal-link severity to critical (unchanged) and emits nothing extra', () => {
    const broken: BrokenTarget[] = [
      { targetUrl: 'https://site.example/dead', kind: 'internal-link', sourcePageUrls: ['https://site.example/a'] },
    ]
    const out = mapBrokenLinkFindings(broken, {
      runId: 'R', ensurePage: makeEnsure(), affectedComplete: true, confidence: { ...conf, broken: 1, checked: 1 },
    })
    expect(out.find((f) => f.scope === 'run')!.severity).toBe('critical')
    expect(out.every((f) => f.type === 'broken_internal_links')).toBe(true)
  })
})
