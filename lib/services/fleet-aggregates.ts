// lib/services/fleet-aggregates.ts
//
// A8 PR 3.5 — two pure reductions over the B1 fleet loader (getClientFleet)
// feeding the homepage KPI-strip and Needs-attention widgets. No new DB
// queries, no blob reads: getClientFleet already reads scores from the
// canonical CrawlRun.score via the scorecard-shared builders. The pure
// functions (computeFleetKpi / rankNeedsAttention) are unit-tested directly;
// the thin async wrappers just fetch + delegate.
import { getClientFleet, type FleetRow } from './client-fleet'
import { getQueueStatus } from '@/lib/ada-audit/queue-manager'

export interface FleetKpi {
  /** null iff the queue sub-fetch failed — fault-isolated from the fleet scores. */
  activeScans: number | null
  /** Mean of non-null FleetRow.ada.latest, rounded; null when none. */
  avgAda: number | null
  avgSeo: number | null
  /** Σ (FleetRow.openCritical ?? 0). */
  openCriticals: number
}

export interface NeedsAttentionRow {
  clientId: number
  name: string
  firstDomain: string | null
  score: number | null
  /** The (negative) drop that ranks this row, or null (included via criticals/alerts). */
  delta: number | null
  metric: 'seo' | 'ada' | null
  openCritical: number
  /** alerts[0]?.detail — a one-line "why". */
  topAlert: string | null
}

// Only the shape computeFleetKpi needs — decoupled from QueueStatusWithBatch so
// the pure function stays trivially testable.
interface QueueSnapshot {
  active: unknown | null
  queued: readonly unknown[]
}

function mean(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

export function computeFleetKpi(fleet: FleetRow[], queue: QueueSnapshot | null): FleetKpi {
  const isNum = (n: number | null): n is number => n != null
  return {
    activeScans: queue == null ? null : (queue.active ? 1 : 0) + queue.queued.length,
    avgAda: mean(fleet.map((r) => r.ada.latest).filter(isNum)),
    avgSeo: mean(fleet.map((r) => r.seo.latest).filter(isNum)),
    openCriticals: fleet.reduce((sum, r) => sum + (r.openCritical ?? 0), 0),
  }
}

const ALERT_PRIORITY: Record<string, number> = { error: 3, regression: 2, 'score-drop': 1, stale: 0 }
function alertPriority(row: FleetRow): number {
  return row.alerts.reduce((max, a) => Math.max(max, ALERT_PRIORITY[a.kind] ?? 0), 0)
}

// Most-negative of the two non-null deltas; SEO wins ties (Codex fix 3).
// The metric is still reported for non-negative deltas, but callers only use
// it when the value is actually a drop.
function worstDelta(row: FleetRow): { value: number | null; metric: 'seo' | 'ada' | null } {
  const s = row.seo.delta
  const a = row.ada.delta
  if (s == null && a == null) return { value: null, metric: null }
  if (s == null) return { value: a, metric: 'ada' }
  if (a == null) return { value: s, metric: 'seo' }
  return s <= a ? { value: s, metric: 'seo' } : { value: a, metric: 'ada' }
}

export function rankNeedsAttention(fleet: FleetRow[], limit = Number.MAX_SAFE_INTEGER): NeedsAttentionRow[] {
  const candidates = fleet
    .map((row) => {
      const wd = worstDelta(row)
      const openCritical = row.openCritical ?? 0
      const include = (wd.value != null && wd.value < 0) || openCritical > 0 || row.alerts.length > 0
      return { row, wd, openCritical, include }
    })
    .filter((c) => c.include)

  // Only a genuine drop (< 0) contributes to the primary sort key; everything
  // else is treated as 0 so criticals/alerts rows sort after real movers.
  const dropKey = (v: number | null) => (v != null && v < 0 ? v : 0)

  candidates.sort((x, y) => {
    const dx = dropKey(x.wd.value)
    const dy = dropKey(y.wd.value)
    if (dx !== dy) return dx - dy // ascending — most negative first
    if (x.openCritical !== y.openCritical) return y.openCritical - x.openCritical // desc
    const ax = alertPriority(x.row)
    const ay = alertPriority(y.row)
    if (ax !== ay) return ay - ax // desc
    if (x.row.name !== y.row.name) return x.row.name.localeCompare(y.row.name)
    return x.row.id - y.row.id // final, guaranteed-unique tie-break (Codex fix 2)
  })

  return candidates.slice(0, limit).map(({ row, wd, openCritical }) => {
    const isDrop = wd.value != null && wd.value < 0
    let metric: 'seo' | 'ada' | null
    let score: number | null
    let delta: number | null
    if (isDrop) {
      metric = wd.metric
      score = metric === 'seo' ? row.seo.latest : row.ada.latest
      delta = metric === 'seo' ? row.seo.delta : row.ada.delta
    } else {
      score = row.seo.latest ?? row.ada.latest
      delta = null
      metric = row.seo.latest != null ? 'seo' : row.ada.latest != null ? 'ada' : null
    }
    return {
      clientId: row.id,
      name: row.name,
      firstDomain: row.firstDomain,
      score,
      delta,
      metric,
      openCritical,
      topAlert: row.alerts[0]?.detail ?? null,
    }
  })
}

export async function getFleetKpi(now: Date = new Date()): Promise<FleetKpi> {
  const fleet = await getClientFleet(now)
  let queue: QueueSnapshot | null = null
  try {
    const q = await getQueueStatus()
    queue = { active: q.active, queued: q.queued }
  } catch {
    // Queue is fault-isolated from the fleet scores — a queue hiccup yields
    // activeScans: null, never a blanked KPI strip.
    queue = null
  }
  return computeFleetKpi(fleet, queue)
}

export async function getNeedsAttention(now: Date = new Date()): Promise<NeedsAttentionRow[]> {
  const fleet = await getClientFleet(now)
  return rankNeedsAttention(fleet)
}
