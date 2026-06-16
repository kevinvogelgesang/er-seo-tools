import { describe, it, expect } from 'vitest'
import { mapBrokenLinks, type BrokenTarget, type BrokenLinkMapContext } from './broken-link-mapper'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'

const ctx: BrokenLinkMapContext = {
  siteAuditId: 'sa1',
  domain: 'example.com',
  clientId: 7,
  startedAt: new Date(0),
  completedAt: new Date(1000),
  confidence: { checked: 3, broken: 2, unconfirmed: 0, capped: false, harvestTruncated: false },
}

describe('mapBrokenLinks', () => {
  it('one source-keyed page finding per (type, source page); run count = distinct targets', () => {
    const broken: BrokenTarget[] = [
      {
        targetUrl: 'https://example.com/dead',
        kind: 'internal-link',
        sourcePageUrls: ['https://example.com/a', 'https://example.com/b'],
      },
      { targetUrl: 'https://example.com/x.png', kind: 'image', sourcePageUrls: ['https://example.com/a'] },
    ]
    const b = mapBrokenLinks(broken, ctx)
    expect(b.run.source).toBe('live-scan')
    expect(b.run.tool).toBe('seo-parser')
    expect(b.run.score).toBeNull()
    expect(b.run.siteAuditId).toBe('sa1')

    const runFindings = b.findings.filter((f) => f.scope === 'run')
    const links = runFindings.find((f) => f.type === 'broken_internal_links')!
    expect(links.count).toBe(1) // one distinct broken internal-link target
    expect(links.dedupKey).toBe(runFindingKey('broken_internal_links'))
    expect(links.affectedSource).toBe('live-scan-verify')
    expect(JSON.parse(links.detail!).checked).toBe(3)

    // page-scope: keyed by source page -> /a has both types, /b has links only
    const pageKeys = b.findings.filter((f) => f.scope === 'page').map((f) => f.dedupKey)
    expect(new Set(pageKeys).size).toBe(pageKeys.length) // no collisions
    expect(pageKeys).toContain(pageFindingKey('broken_internal_links', normalizeFindingUrl('https://example.com/a')))
    expect(pageKeys).toContain(pageFindingKey('broken_internal_links', normalizeFindingUrl('https://example.com/b')))
    // /a's broken_internal_links page finding lists the dead target
    const aLinks = b.findings.find(
      (f) => f.scope === 'page' && f.type === 'broken_internal_links' && f.url === normalizeFindingUrl('https://example.com/a'),
    )!
    expect(JSON.parse(aLinks.detail!).brokenTargetUrls).toContain('https://example.com/dead')
    // every page-scope finding FKs a CrawlPage row
    for (const f of b.findings.filter((f) => f.scope === 'page')) expect(f.pageId).toBeTruthy()
  })

  it('zero broken targets -> empty findings, run still complete', () => {
    const b = mapBrokenLinks([], ctx)
    expect(b.findings).toHaveLength(0)
    expect(b.pages).toHaveLength(0)
    expect(b.run.status).toBe('complete')
  })

  it('capped OR harvest-truncated -> partial + affectedComplete false', () => {
    const cappedCtx = { ...ctx, confidence: { ...ctx.confidence, capped: true } }
    expect(mapBrokenLinks([], cappedCtx).run.status).toBe('partial')
    const truncCtx = { ...ctx, confidence: { ...ctx.confidence, harvestTruncated: true } }
    const b = mapBrokenLinks(
      [{ targetUrl: 'https://example.com/d', kind: 'internal-link', sourcePageUrls: ['https://example.com/a'] }],
      truncCtx,
    )
    expect(b.run.status).toBe('partial')
    expect(b.findings.find((f) => f.scope === 'run')!.affectedComplete).toBe(false)
  })

  it('external-link broken targets are ignored (not verified in v1)', () => {
    const b = mapBrokenLinks(
      [{ targetUrl: 'https://other.com/x', kind: 'external-link', sourcePageUrls: ['https://example.com/a'] }],
      ctx,
    )
    expect(b.findings).toHaveLength(0)
  })
})
