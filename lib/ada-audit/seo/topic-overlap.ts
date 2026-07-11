// lib/ada-audit/seo/topic-overlap.ts
// C12 Tier-1: semantic topic-overlap clustering over MiniLM embeddings.
// PURE module — takes precomputed vectors, no model dependency, deterministic
// (no Math.random / Date.now). Measurement-only (CrawlRun.topicOverlapJson); NOT a Finding.
import { cosineSimilarity } from '@/lib/services/pillarAnalysis/embeddings'

export const TOPIC_OVERLAP_DEFAULTS = {
  wSig: 0.6,
  wBody: 0.4,
  threshold: 0.78,
  maxClusters: 50,
  maxMembers: 50,
} as const

export interface TopicOverlapPageVectors {
  url: string
  sigVec: number[] | null
  bodyVec: number[] | null
  bodyPrefixTruncated: boolean
}

export interface TopicOverlapOptions {
  wSig?: number
  wBody?: number
  threshold?: number
  maxClusters?: number
  maxMembers?: number
  inputCapped?: boolean
}

export interface TopicOverlapCluster {
  urls: string[]
  size: number
  membersTruncated: boolean
  minEdgeSimilarity: number
}

export interface TopicOverlapResult {
  observedPages: number
  clusteredCandidates: number
  threshold: number
  weights: { sig: number; body: number }
  bodyPrefixTruncatedPages: number
  inputCapped: boolean
  clustersCapped: boolean
  clusters: TopicOverlapCluster[]
}

export function clusterByTopicOverlap(
  pages: TopicOverlapPageVectors[],
  opts: TopicOverlapOptions = {},
): TopicOverlapResult | null {
  const wSig = opts.wSig ?? TOPIC_OVERLAP_DEFAULTS.wSig
  const wBody = opts.wBody ?? TOPIC_OVERLAP_DEFAULTS.wBody
  const threshold = opts.threshold ?? TOPIC_OVERLAP_DEFAULTS.threshold
  const maxClusters = opts.maxClusters ?? TOPIC_OVERLAP_DEFAULTS.maxClusters
  const maxMembers = opts.maxMembers ?? TOPIC_OVERLAP_DEFAULTS.maxMembers

  const observedPages = pages.length
  // Homogeneous metric: only pages with BOTH vectors are clustering candidates.
  const candidates = pages.filter((p) => p.sigVec && p.bodyVec)
  const clusteredCandidates = candidates.length
  const bodyPrefixTruncatedPages = candidates.filter((p) => p.bodyPrefixTruncated).length

  if (clusteredCandidates < 2) return null

  const n = clusteredCandidates
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const edges: { a: number; b: number; sim: number }[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim =
        wSig * cosineSimilarity(candidates[i].sigVec!, candidates[j].sigVec!) +
        wBody * cosineSimilarity(candidates[i].bodyVec!, candidates[j].bodyVec!)
      if (sim >= threshold) {
        edges.push({ a: i, b: j, sim })
        union(i, j)
      }
    }
  }

  const membersByRoot = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const arr = membersByRoot.get(r)
    if (arr) arr.push(i)
    else membersByRoot.set(r, [i])
  }
  // Weakest DIRECT edge per final component (single-linkage bridge, not weakest pair).
  const minEdgeByRoot = new Map<number, number>()
  for (const e of edges) {
    const r = find(e.a)
    const cur = minEdgeByRoot.get(r)
    minEdgeByRoot.set(r, cur === undefined ? e.sim : Math.min(cur, e.sim))
  }

  let clusters: TopicOverlapCluster[] = []
  for (const [root, members] of membersByRoot) {
    if (members.length < 2) continue
    const urls = members.map((i) => candidates[i].url).sort()
    const size = urls.length
    clusters.push({
      urls: urls.slice(0, maxMembers),
      size,
      membersTruncated: size > maxMembers,
      minEdgeSimilarity: minEdgeByRoot.get(root) ?? threshold,
    })
  }
  clusters.sort((a, b) => b.size - a.size || (a.urls[0] < b.urls[0] ? -1 : a.urls[0] > b.urls[0] ? 1 : 0))
  const clustersCapped = clusters.length > maxClusters
  clusters = clusters.slice(0, maxClusters)

  return {
    observedPages,
    clusteredCandidates,
    threshold,
    weights: { sig: wSig, body: wBody },
    bodyPrefixTruncatedPages,
    inputCapped: opts.inputCapped ?? false,
    clustersCapped,
    clusters,
  }
}
