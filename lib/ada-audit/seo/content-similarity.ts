// lib/ada-audit/seo/content-similarity.ts
//
// C6 Phase 5: pure lexical near/exact-duplicate detection for the live SEO scan.
// MinHash candidate pairs refined with EXACT Jaccard over boilerplate-DF-filtered
// word shingles. Deterministic (fixed seeds, sorted output). No I/O, no Math.random.
import { createHash } from 'crypto'

export interface SimilarityPageInput { url: string; contentText: string | null; contentTruncated: boolean }
export interface ContentSimilarityOptions {
  shingleSize?: number; minTokens?: number; boilerplateDfRatio?: number; boilerplateDfMin?: number
  nearThreshold?: number; minhashPerms?: number; maxPages?: number; maxGroups?: number; maxUrlsPerGroup?: number
}
export interface ExactGroup { urls: string[]; count: number }
export interface NearGroup { urls: string[]; similarity: number; exactSubgroups?: string[][] }
export interface ContentSimilarityResult {
  algorithm: string; shingleSize: number; nearThreshold: number; minTokens: number
  boilerplateDfRatio: number; boilerplateDfMin: number; pagesEligible: number
  pagesSkipped: { noText: number; thin: number }; boilerplateShinglesDropped: number
  exactDuplicateGroups: ExactGroup[]; nearDuplicateGroups: NearGroup[]; truncatedPages: number; capped: boolean
}

const D = { shingleSize: 5, minTokens: 50, boilerplateDfRatio: 0.5, boilerplateDfMin: 3, nearThreshold: 0.9, minhashPerms: 128, maxPages: 1000, maxGroups: 100, maxUrlsPerGroup: 50 }
const REFINE_MARGIN = 0.15 // MinHash estimate within this of threshold → refine with exact Jaccard

function normalize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
}
// deterministic 32-bit hash (FNV-1a + final avalanche via Math.imul)
function hash32(s: string): number {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13
  return h >>> 0
}
// fixed permutation seeds (a odd, b any) derived deterministically — NEVER Math.random
function permSeeds(m: number): { a: number[]; b: number[] } {
  const a: number[] = [], b: number[] = []; let s = 0x9e3779b9 >>> 0
  for (let i = 0; i < m; i++) {
    s = (Math.imul(s, 0x01000193) ^ (i + 1)) >>> 0; a.push((s | 1) >>> 0)
    s = (Math.imul(s, 0x85ebca6b) ^ (i + 7)) >>> 0; b.push(s >>> 0)
  }
  return { a, b }
}
function shingleHashes(tokens: string[], k: number): number[] {
  const set = new Set<number>()
  for (let i = 0; i + k <= tokens.length; i++) set.add(hash32(tokens.slice(i, i + k).join(' ')))
  return Array.from(set)
}
function minhash(hashes: number[], a: number[], b: number[]): Uint32Array {
  const m = a.length, sig = new Uint32Array(m).fill(0xffffffff)
  for (const x of hashes) for (let i = 0; i < m; i++) {
    const v = (Math.imul(a[i], x) + b[i]) >>> 0
    if (v < sig[i]) sig[i] = v
  }
  return sig
}
function estJaccard(x: Uint32Array, y: Uint32Array): number {
  let eq = 0; for (let i = 0; i < x.length; i++) if (x[i] === y[i]) eq++
  return eq / x.length
}
function exactJaccard(x: number[], y: number[]): number {
  if (!x.length && !y.length) return 1
  const sx = new Set(x); let inter = 0
  for (const v of y) if (sx.has(v)) inter++
  return inter / (x.length + y.length - inter)
}

export function computeContentSimilarity(pages: SimilarityPageInput[], opts: ContentSimilarityOptions = {}): ContentSimilarityResult | null {
  const o = { ...D, ...opts }
  let noText = 0, thin = 0, truncatedPages = 0
  type Row = { url: string; tokens: string[]; norm: string; truncated: boolean }
  const eligible: Row[] = []
  for (const pg of [...pages].sort((x, y) => (x.url < y.url ? -1 : x.url > y.url ? 1 : 0))) {
    if (pg.contentTruncated) truncatedPages++
    if (!pg.contentText) { noText++; continue }
    const tokens = normalize(pg.contentText)
    if (tokens.length < o.minTokens) { thin++; continue }
    eligible.push({ url: pg.url, tokens, norm: tokens.join(' '), truncated: pg.contentTruncated })
  }
  let capped = false
  if (eligible.length > o.maxPages) { eligible.length = o.maxPages; capped = true }
  if (eligible.length < 2) return null

  // Exact duplicates (non-truncated only)
  const byHash = new Map<string, string[]>()
  for (const r of eligible) {
    if (r.truncated) continue
    const h = createHash('sha256').update(r.norm).digest('hex')
    ;(byHash.get(h) ?? byHash.set(h, []).get(h)!).push(r.url)
  }
  const exactGroups: ExactGroup[] = [...byHash.values()].filter(u => u.length >= 2)
    .map(u => ({ urls: u.slice().sort(), count: u.length }))

  // Shingle sets + DF-based boilerplate filter
  const raw = eligible.map(r => ({ url: r.url, sh: shingleHashes(r.tokens, o.shingleSize) }))
  const df = new Map<number, number>()
  for (const r of raw) for (const h of new Set(r.sh)) df.set(h, (df.get(h) ?? 0) + 1)
  const dropped = new Set<number>()
  for (const [h, c] of df) if (c >= o.boilerplateDfMin && c / eligible.length > o.boilerplateDfRatio) dropped.add(h)
  // Drop pages whose filtered shingle set is EMPTY (all-boilerplate) — an empty set makes
  // minhash all-0xffffffff and exactJaccard([],[])===1, falsely grouping them. Exact-dup
  // detection above is unaffected (it hashes full `norm`, not shingles).
  const sets = raw
    .map(r => ({ url: r.url, sh: r.sh.filter(h => !dropped.has(h)).sort((a, b) => a - b) }))
    .filter(s => s.sh.length > 0)

  // MinHash signatures (only over pages with non-empty filtered shingles)
  const { a, b } = permSeeds(o.minhashPerms)
  const sigs = sets.map(s => ({ url: s.url, sh: s.sh, sig: minhash(s.sh, a, b) }))

  // Candidate pairs (MinHash) refined with exact Jaccard; union-find over edges
  const n = sigs.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (i: number, j: number) => { parent[find(i)] = find(j) }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const est = estJaccard(sigs[i].sig, sigs[j].sig)
    if (est < o.nearThreshold - REFINE_MARGIN) continue
    if (exactJaccard(sigs[i].sh, sigs[j].sh) >= o.nearThreshold) union(i, j)
  }

  // Connected components → near groups (size ≥ 2)
  const comps = new Map<number, number[]>()
  for (let i = 0; i < n; i++) { const r = find(i); (comps.get(r) ?? comps.set(r, []).get(r)!).push(i) }
  const exactKeySet = new Set(exactGroups.map(g => g.urls.join('\n')))
  const near: NearGroup[] = []
  for (const idxs of comps.values()) {
    if (idxs.length < 2) continue
    const urls = idxs.map(i => sigs[i].url).sort()
    // group similarity = MIN exact pairwise over ALL pairs in the component (honest weakest link)
    let minSim = 1
    for (let x = 0; x < idxs.length; x++) for (let y = x + 1; y < idxs.length; y++) {
      const sim = exactJaccard(sigs[idxs[x]].sh, sigs[idxs[y]].sh)
      if (sim < minSim) minSim = sim
    }
    const urlSet = new Set(urls)
    const subs = exactGroups.filter(g => g.urls.every(u => urlSet.has(u))).map(g => g.urls)
    // skip if the whole component IS exactly one exact group (represented by exactDuplicateGroups)
    if (subs.length === 1 && subs[0].length === urls.length && exactKeySet.has(urls.join('\n'))) continue
    const g: NearGroup = { urls, similarity: Math.round(minSim * 100) / 100 }
    if (subs.length) g.exactSubgroups = subs
    near.push(g)
  }

  // Deterministic ordering + output caps
  const cmpGroup = (x: { urls: string[] }, y: { urls: string[] }) =>
    y.urls.length - x.urls.length || (x.urls[0] < y.urls[0] ? -1 : x.urls[0] > y.urls[0] ? 1 : 0)
  exactGroups.sort(cmpGroup); near.sort(cmpGroup)
  // When a near group's urls are truncated, filter exactSubgroups to the RETAINED urls
  // (drop subgroups that fall below 2) so annotations never reference omitted URLs.
  const capGroups = <T extends { urls: string[]; exactSubgroups?: string[][] }>(arr: T[]): T[] => {
    if (arr.length > o.maxGroups) { arr = arr.slice(0, o.maxGroups); capped = true }
    return arr.map(g => {
      if (g.urls.length <= o.maxUrlsPerGroup) return g
      capped = true
      const urls = g.urls.slice(0, o.maxUrlsPerGroup)
      const kept = new Set(urls)
      const next: T = { ...g, urls }
      if (g.exactSubgroups) {
        const subs = g.exactSubgroups.map(s => s.filter(u => kept.has(u))).filter(s => s.length >= 2)
        if (subs.length) next.exactSubgroups = subs
        else delete (next as { exactSubgroups?: string[][] }).exactSubgroups
      }
      return next
    })
  }

  return {
    algorithm: 'minhash+exact-jaccard', shingleSize: o.shingleSize, nearThreshold: o.nearThreshold,
    minTokens: o.minTokens, boilerplateDfRatio: o.boilerplateDfRatio, boilerplateDfMin: o.boilerplateDfMin,
    pagesEligible: eligible.length, pagesSkipped: { noText, thin }, boilerplateShinglesDropped: dropped.size,
    exactDuplicateGroups: capGroups(exactGroups), nearDuplicateGroups: capGroups(near), truncatedPages, capped,
  }
}
