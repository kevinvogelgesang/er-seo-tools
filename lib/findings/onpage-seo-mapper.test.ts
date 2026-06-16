import { describe, it, expect } from 'vitest'
import { mapOnPageSeoFindings, type OnPageSeoRow } from './onpage-seo-mapper'
import type { CrawlPageInput, FindingInput } from './types'

function harness() {
  const pages: CrawlPageInput[] = []
  const byUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string, scalars?: Partial<CrawlPageInput>): CrawlPageInput => {
    let p = byUrl.get(url)
    if (!p) {
      p = { id: `p-${byUrl.size}`, runId: 'R', url, status: null, error: null, finalUrl: null,
        statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null,
        crawlDepth: null, indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }
      pages.push(p); byUrl.set(url, p)
    }
    if (scalars) for (const [k, v] of Object.entries(scalars)) if (v != null) (p as any)[k] = v
    return p
  }
  return { pages, ensurePage }
}

const row = (o: Partial<OnPageSeoRow> & { url: string }): OnPageSeoRow => ({
  url: o.url, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false,
  loginLike: false, title: 'T', h1: 'H', metaDescription: 'M', wordCount: 500, ...o,
})

describe('mapOnPageSeoFindings', () => {
  it('detects duplicate titles (run-scope count = GROUP count, SF semantics) + per-page findings', () => {
    const { pages, ensurePage } = harness()
    const findings = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', title: 'Same' }), row({ url: 'https://x.com/b', title: 'Same' })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    const dupRun = findings.find((f) => f.scope === 'run' && f.type === 'duplicate_title')!
    expect(dupRun.count).toBe(1) // one duplicate GROUP (matches SF pageTitles.parser)
    expect(dupRun.severity).toBe('warning')
    expect(findings.filter((f) => f.scope === 'page' && f.type === 'duplicate_title').length).toBe(2)
    expect(pages.length).toBe(2)
  })
  it('flags missing title/meta/h1 only on indexable pages, with right severities', () => {
    const { ensurePage } = harness()
    const findings = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', title: undefined, metaDescription: undefined, h1: undefined })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    expect(findings.find((f) => f.scope === 'run' && f.type === 'missing_title')!.severity).toBe('critical')
    expect(findings.find((f) => f.scope === 'run' && f.type === 'missing_meta_description')!.severity).toBe('warning')
    expect(findings.find((f) => f.scope === 'run' && f.type === 'missing_h1')!.severity).toBe('warning')
  })
  it('flags thin content for 0 < wordCount < 300 only (null/0 excluded)', () => {
    const { ensurePage } = harness()
    const f = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', wordCount: 100 }), row({ url: 'https://x.com/b', wordCount: 0 }),
       row({ url: 'https://x.com/c', wordCount: null })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    const thin = f.find((x) => x.scope === 'run' && x.type === 'thin_content')!
    expect(thin.count).toBe(1)
  })
  it('excludes login-like and non-indexable pages from the set', () => {
    const { ensurePage } = harness()
    const f = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', title: undefined, loginLike: true }),
       row({ url: 'https://x.com/b', title: undefined, robotsNoindex: true })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    expect(f.length).toBe(0)
  })
  it('duplicate comparison is trimmed-exact, not case-folded', () => {
    const { ensurePage } = harness()
    const f = mapOnPageSeoFindings(
      [row({ url: 'https://x.com/a', title: 'Hello' }), row({ url: 'https://x.com/b', title: 'hello' })],
      { runId: 'R', ensurePage, harvestTruncated: false },
    )
    expect(f.find((x) => x.scope === 'run' && x.type === 'duplicate_title')).toBeUndefined()
  })
  it('sets affectedComplete from !harvestTruncated and affectedSource live-scan-onpage', () => {
    const { ensurePage } = harness()
    const f = mapOnPageSeoFindings([row({ url: 'https://x.com/a', title: undefined })],
      { runId: 'R', ensurePage, harvestTruncated: true })
    const run = f.find((x) => x.scope === 'run' && x.type === 'missing_title')!
    expect(run.affectedComplete).toBe(false)
    expect(run.affectedSource).toBe('live-scan-onpage')
  })
})
