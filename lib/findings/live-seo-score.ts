// lib/findings/live-seo-score.ts
//
// C6 Phase 3: forked, coverage-aware live SEO health score (0–100 | null).
// Forked from computeHealthScore (lib/services/scoring.service.ts) with EXPLICIT
// factor availability — it must NOT (a) award full crawl-depth points for a
// missing/zero depth, or (b) skip thin content when no thin issue object exists.
// The live audit has no crawl graph, so crawl-depth and broken-link factors are
// never part of the denominator. Pure: all inputs are passed in by the builder.

export interface LiveScoreInputs {
  attempted: number        // SiteAudit.pagesTotal (discovered/attempted)
  observed: number         // HarvestedPageSeo row count (NOT pagesComplete)
  indexableScored: number  // observed rows that are indexable && !loginLike
  pagesError: number       // SiteAudit.pagesError
  missingTitle: number     // over the eligible (indexable && !login) set
  missingMeta: number
  missingH1: number
  thin: number             // 0 < wordCount < 300, over the eligible set
  pagesWithSchema: number  // observed rows with schemaCount > 0
}

const MIN_OBSERVED_COVERAGE = 0.5

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function scoreLiveSeo(inp: LiveScoreInputs): number | null {
  // Null-guard: not enough to produce an honest number.
  if (inp.attempted <= 0) return null
  if (inp.observed / inp.attempted < MIN_OBSERVED_COVERAGE) return null
  if (inp.indexableScored <= 0) return null // no indexable content → unscoreable

  const base = inp.indexableScored
  const observed = inp.observed
  const factors: Array<[number, number]> = [] // [earned, possible]

  // Indexability ratio (20) — observed HTML pages that are indexable.
  {
    const ratio = inp.indexableScored / observed
    const pts = ratio >= 0.95 ? 20 : (ratio / 0.95) * 20
    factors.push([clamp(pts, 0, 20), 20])
  }
  // Error rate (20) — full if < 1%, linear to 0 at 100%.
  {
    const errorRate = inp.pagesError / inp.attempted
    const pts = errorRate < 0.01 ? 20 : Math.max(0, 20 - errorRate * 20)
    factors.push([clamp(pts, 0, 20), 20])
  }
  // Missing title (10) / meta (8) / H1 (7) — over the indexable base.
  const missing = (count: number, weight: number) => {
    const pts = weight * (1 - Math.min(1, count / base))
    factors.push([clamp(pts, 0, weight), weight])
  }
  missing(inp.missingTitle, 10)
  missing(inp.missingMeta, 8)
  missing(inp.missingH1, 7)
  // Thin content (10) — full if < 5%, 0 if > 40%, linear between.
  {
    const ratio = inp.thin / base
    const pts = ratio < 0.05 ? 10 : ratio > 0.4 ? 0 : 10 * (1 - (ratio - 0.05) / 0.35)
    factors.push([clamp(pts, 0, 10), 10])
  }
  // Schema coverage (10) — full at >= 30% of observed.
  {
    const ratio = inp.pagesWithSchema / observed
    const pts = ratio >= 0.3 ? 10 : (ratio / 0.3) * 10
    factors.push([clamp(pts, 0, 10), 10])
  }

  const earned = factors.reduce((a, [e]) => a + e, 0)
  const possible = factors.reduce((a, [, p]) => a + p, 0)
  if (possible === 0) return null
  return clamp(Math.round((earned / possible) * 100), 0, 100)
}
