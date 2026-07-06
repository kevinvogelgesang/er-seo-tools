// lib/ops/health-summary.ts
//
// A4 observability — the public /api/health degraded flag. Guardrails for an
// UNAUTHENTICATED poller: a 10 s in-memory TTL cache, a lookback-window `since`
// so historical errors don't pin it degraded forever, and fail-open to `ok` on
// any error/timeout. This computes ONLY the degraded flag — the hard DB ping
// lives in the route and is never cached.
import { collectHealthSignals, evaluateHealth, healthEvalOpts, type HealthSignals } from './health-check'

const TTL_MS = 10_000
let cache: { at: number; value: { status: 'ok' | 'degraded' } } | null = null

// Test-only: clear the module cache between cases.
export function __resetHealthSummaryCache(): void {
  cache = null
}

// Single source of truth for the degraded-flag computation, shared by the public
// /api/health summary (below) and the /admin/ops panel (lib/ops/ops-snapshot).
// Keeping it here prevents the two surfaces from silently disagreeing on whether
// the system is degraded. Uses a lookback-window `since` (never 0) and a synthetic
// zero-cooldown state so the read is stateless (never mutates the alert dedup file).
export async function computeHealthAlerts(now: Date): Promise<{ signals: HealthSignals; alerts: string[] }> {
  const opts = healthEvalOpts()
  const since = now.getTime() - opts.lookbackMs // window, never 0
  const signals = await collectHealthSignals(now, since)
  const { alerts } = evaluateHealth(signals, { lastCheckAt: 0, cooldowns: {} }, now, opts)
  return { signals, alerts }
}

export async function getLivenessSummary(now: Date = new Date()): Promise<{ status: 'ok' | 'degraded' }> {
  const nowMs = now.getTime()
  if (cache && nowMs - cache.at < TTL_MS) return cache.value
  let value: { status: 'ok' | 'degraded' } = { status: 'ok' }
  try {
    const { alerts } = await computeHealthAlerts(now)
    value = alerts.length > 0 ? { status: 'degraded' } : { status: 'ok' }
  } catch {
    value = { status: 'ok' } // fail open
  }
  cache = { at: nowMs, value }
  return value
}
