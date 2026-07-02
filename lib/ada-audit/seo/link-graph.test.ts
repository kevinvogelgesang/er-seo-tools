import { describe, it, expect } from 'vitest'
import { computeLinkGraph } from './link-graph'
const A='https://x.test/', B='https://x.test/b', C='https://x.test/c', D='https://x.test/d'
describe('computeLinkGraph', () => {
  it('counts distinct inlinks/outlinks over audited internal links only', () => {
    const rows = [
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: C, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: 'https://ext.test/', kind: 'external-link' },
      { sourcePageUrl: A, targetUrl: C, kind: 'image' },
    ]
    const g = computeLinkGraph(rows, [A, B, C], A)
    expect(g.byUrl.get(B)!.inlinks).toBe(2)
    expect(g.byUrl.get(A)!.outlinks).toBe(1)
    expect(g.byUrl.get(B)!.outlinks).toBe(0)
  })
  it('BFS depth from homepage; null unreachable', () => {
    const rows = [
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: B, targetUrl: C, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(rows, [A, B, C, D], A)
    expect(g.depthAvailable).toBe(true)
    expect(g.byUrl.get(A)!.crawlDepth).toBe(0)
    expect(g.byUrl.get(C)!.crawlDepth).toBe(2)
    expect(g.byUrl.get(D)!.crawlDepth).toBeNull()
  })
  it('cycles terminate; homepage missing → depthUnavailable', () => {
    const rows = [
      { sourcePageUrl: B, targetUrl: C, kind: 'internal-link' },
      { sourcePageUrl: C, targetUrl: B, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(rows, [B, C], null)
    expect(g.depthAvailable).toBe(false)
    expect(g.byUrl.get(B)!.crawlDepth).toBeNull()
  })
})
