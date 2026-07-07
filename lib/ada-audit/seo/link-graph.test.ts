import { describe, it, expect } from 'vitest'
import { computeLinkGraph } from './link-graph'

const H = 'https://x.test/'            // homepage (exact)
const A = 'https://x.test/a', B = 'https://x.test/b', C = 'https://x.test/c'
const D = 'https://x.test/d', PDF = 'https://x.test/file.pdf'
const idx = (...u: string[]) => new Set(u)

describe('computeLinkGraph — full-graph reachability', () => {
  it('counts inlinks from a discovered-but-unfetched source node', () => {
    // C is a node (discovered) but not in indexable set (unfetched); its link to B still counts.
    const edges = [
      { sourcePageUrl: H, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: C, targetUrl: B, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(edges, [H, B, C], H, idx(H, B))
    expect(g.byUrl.get(B)!.inlinks).toBe(2)   // both H and C count
  })

  it('clicks-from-home depth is correct through a non-audited intermediary', () => {
    // H -> A (unfetched) -> B (fetched). B's depth must be 2, not null.
    const edges = [
      { sourcePageUrl: H, targetUrl: A, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(edges, [H, A, B], H, idx(H, B))
    expect(g.byUrl.get(B)!.crawlDepth).toBe(2)
  })

  it('orphan = indexable, non-homepage node with 0 inlinks', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    // B indexable, no inlinks -> orphan. A has an inlink. H is homepage (never orphan).
    const g = computeLinkGraph(edges, [H, A, B], H, idx(H, A, B))
    expect(g.summary.orphanCount).toBe(1)
    expect(g.summary.orphanSample).toContain(B)
  })

  it('homepage with 0 inlinks is NOT an orphan (Codex #1)', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [H, A], H, idx(H, A))
    expect(g.summary.orphanSample).not.toContain(H)
    expect(g.summary.orphanCount).toBe(0)   // A has an inlink; H excluded
  })

  it('edge-only / non-indexable-known node is never an orphan', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    // C is a bare node with no indexability signal, 0 inlinks -> NOT orphan.
    const g = computeLinkGraph(edges, [H, A, C], H, idx(H, A))
    expect(g.summary.orphanSample).not.toContain(C)
  })

  it('unreachable = indexable node with null depth; reconciles with histogram null bucket', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [H, A, B], H, idx(H, A, B))   // B unreachable
    expect(g.summary.unreachableCount).toBe(1)
    expect(g.summary.depthHistogram['null']).toBe(1)
    expect(g.summary.unreachableSample).toContain(B)
  })

  it('exact homepage absent → homepageResolved:false, all depths null, NO shallowest fallback (Codex #2)', () => {
    const edges = [{ sourcePageUrl: A, targetUrl: B, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [A, B], H, idx(A, B))   // H not among nodes
    expect(g.summary.homepageResolved).toBe(false)
    expect(g.depthAvailable).toBe(false)
    expect(g.byUrl.get(A)!.crawlDepth).toBeNull()
    expect(g.byUrl.get(B)!.crawlDepth).toBeNull()
  })

  it('excludes non-page targets from nodes and edges (Codex #3)', () => {
    const edges = [
      { sourcePageUrl: H, targetUrl: PDF, kind: 'internal-link' },
      { sourcePageUrl: H, targetUrl: A, kind: 'internal-link' },
    ]
    const g = computeLinkGraph(edges, [H, A, PDF], H, idx(H, A))
    expect(g.byUrl.has(PDF)).toBe(false)
    expect(g.byUrl.get(H)!.outlinks).toBe(1)   // PDF edge dropped
    expect(g.summary.nodeCount).toBe(2)        // H, A only
  })

  it('collapses bare-root slash variants and excludes self-links (normalizeFindingUrl semantics)', () => {
    // normalizeFindingUrl ONLY strips the trailing slash on a bare root path
    // (not www, not scheme, not non-root slashes). So 'https://x.test/' and
    // 'https://x.test' are the same node; '/a/' and '/a' would NOT be.
    const edges = [
      { sourcePageUrl: 'https://x.test/', targetUrl: A, kind: 'internal-link' },
      { sourcePageUrl: 'https://x.test', targetUrl: A, kind: 'internal-link' }, // same source node as above
      { sourcePageUrl: A, targetUrl: A, kind: 'internal-link' },               // self-link excluded
    ]
    const g = computeLinkGraph(edges, [H, A], H, idx(H, A))
    expect(g.summary.homepageResolved).toBe(true)
    expect(g.byUrl.get(A)!.inlinks).toBe(1)     // one distinct source (homepage); self-link not counted
    expect(g.summary.edgeCount).toBe(1)          // distinct home->A edge counted once (Codex #4)
  })

  it('null-bucket reconciles with unreachableCount when homepage is unresolved (Codex #3)', () => {
    const edges = [{ sourcePageUrl: A, targetUrl: B, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [A, B], null, idx(A, B))   // no homepage
    expect(g.summary.homepageResolved).toBe(false)
    expect(g.summary.depthHistogram['null']).toBe(g.summary.unreachableCount)
    expect(g.summary.unreachableCount).toBe(2)   // homepage not a node → not excluded
  })

  it('empty edges/nodes → zeroed summary, no throw', () => {
    const g = computeLinkGraph([], [], null, idx())
    expect(g.summary.nodeCount).toBe(0)
    expect(g.summary.orphanCount).toBe(0)
    expect(g.summary.maxDepth).toBeNull()
  })

  it('www-canonical homepage resolves scheme/www-insensitively (Fix 1)', () => {
    // Actual homepage node is www-canonical; builder passes the bare apex.
    const WWW_H = 'https://www.x.test'
    const edges = [{ sourcePageUrl: WWW_H, targetUrl: A, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [WWW_H, A], 'https://x.test', idx(WWW_H, A))
    expect(g.summary.homepageResolved).toBe(true)
    expect(g.byUrl.get(A)!.crawlDepth).toBe(1)
  })

  it('http-only homepage resolves scheme/www-insensitively (Fix 1)', () => {
    const HTTP_H = 'http://x.test'
    const edges = [{ sourcePageUrl: HTTP_H, targetUrl: A, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [HTTP_H, A], 'https://x.test', idx(HTTP_H, A))
    expect(g.summary.homepageResolved).toBe(true)
    expect(g.byUrl.get(A)!.crawlDepth).toBe(1)
  })

  it('rootKey excludes a query-string URL from the homepage-anchor match (Fix 1)', () => {
    // True bare-root node ('https://x.test' / 'https://x.test/') is ABSENT from
    // the node set. A query-string homepage link (?ref=nav) IS present, as an
    // edge target — normalizeFindingUrl treats it as a DISTINCT node (only a
    // bare root with no search gets its trailing slash stripped). rootKey must
    // NOT collapse it to root, or the BFS anchors on a dead-end node and
    // falsely reports full reachability instead of an honest unresolved homepage.
    const QS = 'https://x.test/?ref=nav'
    const edges = [{ sourcePageUrl: A, targetUrl: QS, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [A], 'https://x.test', idx(A, QS))
    expect(g.summary.homepageResolved).toBe(false)
  })

  it('regression: exact-apex homepage still resolves (Fix 1)', () => {
    const edges = [{ sourcePageUrl: H, targetUrl: A, kind: 'internal-link' }]
    const g = computeLinkGraph(edges, [H, A], H, idx(H, A))
    expect(g.summary.homepageResolved).toBe(true)
    expect(g.byUrl.get(A)!.crawlDepth).toBe(1)
  })

  it('depthHistogram buckets ≥4 into 4plus', () => {
    const edges = [
      { sourcePageUrl: H, targetUrl: A, kind: 'internal-link' },
      { sourcePageUrl: A, targetUrl: B, kind: 'internal-link' },
      { sourcePageUrl: B, targetUrl: C, kind: 'internal-link' },
      { sourcePageUrl: C, targetUrl: D, kind: 'internal-link' },   // D at depth 4
    ]
    const g = computeLinkGraph(edges, [H, A, B, C, D], H, idx(H, A, B, C, D))
    expect(g.summary.depthHistogram['4plus']).toBe(1)
    expect(g.summary.maxDepth).toBe(4)
    expect(g.summary.deepSample.some((d) => d.url === D && d.depth === 4)).toBe(true)
  })
})
