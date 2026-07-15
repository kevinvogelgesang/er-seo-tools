// C14: pure site-wide roll-up of per-page Lighthouse summaries. LAB data —
// TBT proxy, no INP, not CrUX. Copy in the UI must say "Lighthouse-measured".
import { isRootUrl, canonicalRootUrl } from '@/lib/sales/root-url'
import type { CwvStatus, LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'

export const MIN_MEASURED_PAGES = 3

export interface PerformanceRollup {
  measuredPages: number
  medianPerformance: number
  p75LcpMs: number
  p75Cls: number
  p75TbtMs: number
  pctPassing: number // % of measured pages with all three statuses 'pass'
  scoreBuckets: { good: number; fair: number; poor: number }
  worstPages: { url: string; performance: number }[] // up to 5, ascending score
}

export interface HomepageCwv {
  performance: number
  lcpMs: number
  cls: number
  tbtMs: number
  lcpStatus: CwvStatus
  clsStatus: CwvStatus
  tbtStatus: CwvStatus
}

function p75(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(0.75 * sorted.length) - 1)]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export function aggregatePerformance(
  rows: { url: string; summary: LighthouseSummary }[],
): PerformanceRollup | null {
  if (rows.length < MIN_MEASURED_PAGES) return null
  const perf = rows.map((r) => r.summary.scores.performance)
  const passing = rows.filter(
    (r) => r.summary.cwv.lcpStatus === 'pass' && r.summary.cwv.clsStatus === 'pass' && r.summary.cwv.tbtStatus === 'pass',
  ).length
  return {
    measuredPages: rows.length,
    medianPerformance: median(perf),
    p75LcpMs: p75(rows.map((r) => r.summary.cwv.lcp)),
    p75Cls: p75(rows.map((r) => r.summary.cwv.cls)),
    p75TbtMs: p75(rows.map((r) => r.summary.cwv.tbt)),
    pctPassing: Math.round((passing / rows.length) * 100),
    scoreBuckets: {
      good: perf.filter((s) => s >= 90).length,
      fair: perf.filter((s) => s >= 50 && s < 90).length,
      poor: perf.filter((s) => s < 50).length,
    },
    worstPages: rows
      .map((r) => ({ url: r.url, performance: r.summary.scores.performance }))
      .sort((a, b) => a.performance - b.performance)
      .slice(0, 5),
  }
}

/**
 * C14 redesign: the homepage's own Lighthouse numbers, resolved from the
 * raw child rows INDEPENDENT of aggregatePerformance (which nulls under 3
 * measured pages — the homepage card must not vanish with it). Deterministic
 * selection (spec Codex fix 6): among root-URL variants prefer the exact
 * canonical root `https://<domain>/`, then fall back by stable (url, id)
 * ordering.
 */
export function pickHomepageCwv(
  rows: { url: string; id: string; summary: LighthouseSummary }[],
  domain: string,
): HomepageCwv | null {
  const roots = rows.filter((r) => isRootUrl(r.url, domain))
  if (roots.length === 0) return null
  const canonical = canonicalRootUrl(domain)
  const chosen =
    roots.find((r) => r.url === canonical) ??
    [...roots].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : a.id < b.id ? -1 : 1))[0]
  const { scores, cwv } = chosen.summary
  return {
    performance: scores.performance,
    lcpMs: cwv.lcp,
    cls: cwv.cls,
    tbtMs: cwv.tbt,
    lcpStatus: cwv.lcpStatus,
    clsStatus: cwv.clsStatus,
    tbtStatus: cwv.tbtStatus,
  }
}
