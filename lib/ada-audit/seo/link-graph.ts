import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import { NON_PAGE_EXT } from '@/lib/ada-audit/seo/discovery-coverage'

export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }

export interface ReachabilitySummary {
  nodeCount: number
  indexableNodeCount: number
  edgeCount: number
  homepageResolved: boolean
  orphanCount: number
  orphanSample: string[]
  unreachableCount: number
  unreachableSample: string[]
  depthHistogram: Record<string, number>
  maxDepth: number | null
  deepSample: Array<{ url: string; depth: number }>
}

export interface LinkGraphResult {
  byUrl: Map<string, LinkGraphRow>
  depthAvailable: boolean
  summary: ReachabilitySummary
}

const SAMPLE_CAP = 50
const DEEP_THRESHOLD = 4

function isNonPage(normalizedUrl: string): boolean {
  try {
    return NON_PAGE_EXT.test(new URL(normalizedUrl).pathname)
  } catch {
    return false
  }
}

/**
 * Full-graph reachability. Nodes = (discovered `nodes` ∪ edge endpoints) minus
 * non-page targets, normalized via normalizeFindingUrl (first-seen original wins,
 * reconciling with CrawlPage.url). inlinks/outlinks span the whole page graph.
 * crawlDepth = clicks-from-home BFS from the EXACT homepage (no shallowest
 * fallback). Summary (orphan/unreachable/histogram) is over the eligible set =
 * indexable page nodes, so depthHistogram['null'] === unreachableCount.
 */
export function computeLinkGraph(
  edges: { sourcePageUrl: string; targetUrl: string; kind: string }[],
  nodes: string[],
  homepageUrl: string | null,
  indexableUrls: Set<string>,
): LinkGraphResult {
  // normalized indexable set
  const indexable = new Set<string>()
  for (const u of indexableUrls) indexable.add(normalizeFindingUrl(u))

  // node map: normalized -> original (first-seen wins). Seed from `nodes`, then
  // add edge endpoints. Non-page URLs are excluded.
  const normToOrig = new Map<string, string>()
  const addNode = (u: string): string | null => {
    const n = normalizeFindingUrl(u)
    if (isNonPage(n)) return null
    if (!normToOrig.has(n)) normToOrig.set(n, u)
    return n
  }
  for (const u of nodes) addNode(u)

  const inSets = new Map<string, Set<string>>()
  const outSets = new Map<string, Set<string>>()
  const adj = new Map<string, Set<string>>()
  let edgeCount = 0
  for (const e of edges) {
    if (e.kind !== 'internal-link') continue
    const s = addNode(e.sourcePageUrl)
    const t = addNode(e.targetUrl)
    if (s == null || t == null) continue   // non-page endpoint dropped
    if (s === t) continue                  // self-link excluded
    ;(inSets.get(t) ?? inSets.set(t, new Set()).get(t)!).add(s)
    ;(outSets.get(s) ?? outSets.set(s, new Set()).get(s)!).add(t)
    const a = adj.get(s) ?? adj.set(s, new Set()).get(s)!
    if (!a.has(t)) { a.add(t); edgeCount++ }   // distinct edges only (Codex #4)
  }

  // exact-homepage BFS (no fallback)
  const home = homepageUrl ? normalizeFindingUrl(homepageUrl) : null
  const homepageResolved = !!home && normToOrig.has(home)
  const depth = new Map<string, number>()
  if (homepageResolved) {
    const q = [home!]; depth.set(home!, 0)
    while (q.length) {
      const cur = q.shift()!, d = depth.get(cur)!
      for (const nxt of adj.get(cur) ?? []) if (!depth.has(nxt)) { depth.set(nxt, d + 1); q.push(nxt) }
    }
  }

  const byUrl = new Map<string, LinkGraphRow>()
  for (const [norm, orig] of normToOrig) {
    byUrl.set(orig, {
      inlinks: inSets.get(norm)?.size ?? 0,
      outlinks: outSets.get(norm)?.size ?? 0,
      crawlDepth: homepageResolved ? (depth.get(norm) ?? null) : null,
    })
  }

  // Summary over the eligible set = indexable page nodes.
  // Invariant (Codex #3): depthHistogram['null'] === unreachableCount. Holds in
  // both cases — when homepageResolved, the home node has depth 0 (never null, so
  // never in either count); when unresolved, the home isn't a node at all, so the
  // `!isHome` guard below excludes nothing from the eligible null set.
  const eligible: string[] = []
  for (const norm of normToOrig.keys()) if (indexable.has(norm)) eligible.push(norm)

  const orphanSample: string[] = []
  const unreachableSample: string[] = []
  const deep: Array<{ url: string; depth: number }> = []
  const histogram: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4plus': 0, 'null': 0 }
  let orphanCount = 0, unreachableCount = 0, maxDepth: number | null = null

  for (const norm of eligible) {
    const orig = normToOrig.get(norm)!
    const isHome = home != null && norm === home
    const inl = inSets.get(norm)?.size ?? 0
    const d = homepageResolved ? (depth.get(norm) ?? null) : null

    if (!isHome && inl === 0) {
      orphanCount++
      if (orphanSample.length < SAMPLE_CAP) orphanSample.push(orig)
    }
    if (!isHome && d == null) {
      unreachableCount++
      if (unreachableSample.length < SAMPLE_CAP) unreachableSample.push(orig)
    }
    if (d == null) histogram['null']++
    else {
      histogram[d >= 4 ? '4plus' : String(d)]++
      if (maxDepth == null || d > maxDepth) maxDepth = d
      if (d >= DEEP_THRESHOLD) deep.push({ url: orig, depth: d })
    }
  }
  deep.sort((a, b) => b.depth - a.depth || a.url.localeCompare(b.url))

  const summary: ReachabilitySummary = {
    nodeCount: normToOrig.size,
    indexableNodeCount: eligible.length,
    edgeCount,
    homepageResolved,
    orphanCount,
    orphanSample,
    unreachableCount,
    unreachableSample,
    depthHistogram: histogram,
    maxDepth,
    deepSample: deep.slice(0, SAMPLE_CAP),
  }
  return { byUrl, depthAvailable: homepageResolved, summary }
}
