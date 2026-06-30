import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
export interface LinkGraphRow { inlinks: number; outlinks: number; crawlDepth: number | null }
export interface LinkGraphResult { byUrl: Map<string, LinkGraphRow>; depthAvailable: boolean }
export function computeLinkGraph(
  rows: { sourcePageUrl: string; targetUrl: string; kind: string }[],
  auditedUrls: string[], homepageUrl: string | null,
): LinkGraphResult {
  // Build a map from normalized URL → original URL (first seen wins)
  const normToOrig = new Map<string, string>()
  for (const u of auditedUrls) {
    const n = normalizeFindingUrl(u)
    if (!normToOrig.has(n)) normToOrig.set(n, u)
  }
  const audited = new Set(normToOrig.keys())
  const inSets = new Map<string, Set<string>>(), outSets = new Map<string, Set<string>>()
  const adj = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.kind !== 'internal-link') continue
    const s = normalizeFindingUrl(r.sourcePageUrl), t = normalizeFindingUrl(r.targetUrl)
    if (!audited.has(s) || !audited.has(t)) continue
    ;(inSets.get(t) ?? inSets.set(t, new Set()).get(t)!).add(s)
    ;(outSets.get(s) ?? outSets.set(s, new Set()).get(s)!).add(t)
    ;(adj.get(s) ?? adj.set(s, new Set()).get(s)!).add(t)
  }
  const home = homepageUrl ? normalizeFindingUrl(homepageUrl) : null
  const depthAvailable = !!home && audited.has(home)
  const depth = new Map<string, number>()
  if (depthAvailable) {
    const q = [home!]; depth.set(home!, 0)
    while (q.length) {
      const cur = q.shift()!, d = depth.get(cur)!
      for (const nxt of adj.get(cur) ?? []) if (!depth.has(nxt)) { depth.set(nxt, d + 1); q.push(nxt) }
    }
  }
  const byUrl = new Map<string, LinkGraphRow>()
  for (const [norm, orig] of normToOrig) {
    byUrl.set(orig, {
      inlinks: inSets.get(norm)?.size ?? 0, outlinks: outSets.get(norm)?.size ?? 0,
      crawlDepth: depthAvailable ? (depth.get(norm) ?? null) : null,
    })
  }
  return { byUrl, depthAvailable }
}
