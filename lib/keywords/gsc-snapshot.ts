// lib/keywords/gsc-snapshot.ts
//
// KS-1 snapshot service — spec §5.2. Fetches + persists a client's GSC
// query×page keyword snapshot, and reads the latest mapping-matched one back.
// No I/O in derive.ts/window.ts; this is the one file that touches the DB
// and the provider.
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { fetchGscQueryPage } from '@/lib/analytics/google/gsc-provider'
import type { GscQueryRow, GscQueryPageRow } from '@/lib/analytics/google/gsc-provider'
import type { GscSnapshot } from '@prisma/client'
import {
  GSC_QUERY_ROW_LIMIT,
  GSC_QUERY_PAGE_ROW_LIMIT,
  GSC_MIN_IMPRESSIONS,
  CANNIBALIZATION_REPORT_CAP,
  type KeywordSignals,
  type GscSnapshotSummary,
  type CannibalizationReport,
} from './types'
import { computeSnapshotWindow } from './window'
import { deriveKeywordSignals } from './derive'

// Re-exported so existing importers (route handlers, tests) keep working;
// the type is DEFINED in ./types (client-safe: no runtime/server-only
// imports in its chain) so `GscKeywordCard` can `import type` it directly
// from there without any transitive dependency on this module, which does
// import the (server-only) GSC provider.
export type { GscSnapshotSummary } from './types'

/** List caps applied at THIS boundary (never in derive.ts) — card/route payload bound. */
const SUMMARY_LIST_CAP = 50
const CANNIBALIZATION_LIST_CAP = 20

export type RefreshGscSnapshotResult =
  | { ok: true; summary: GscSnapshotSummary }
  | {
      ok: false
      reason: 'client_not_found' | 'not_mapped' | 'access_denied' | 'auth' | 'quota' | 'error'
      message?: string
    }

type SnapshotRowLike = {
  fetchedAt: Date
  gscSiteUrl: string
  windowStart: Date
  windowEnd: Date
  queryAtLimit: boolean
  queryPageAtLimit: boolean
}

function buildSummary(row: SnapshotRowLike, signals: KeywordSignals): GscSnapshotSummary {
  return {
    fetchedAt: row.fetchedAt.toISOString(),
    gscSiteUrl: row.gscSiteUrl,
    window: { start: row.windowStart.toISOString(), end: row.windowEnd.toISOString() },
    thresholds: signals.thresholds,
    counts: signals.counts,
    queryAtLimit: row.queryAtLimit,
    queryPageAtLimit: row.queryPageAtLimit,
    wins: signals.wins.slice(0, SUMMARY_LIST_CAP),
    opportunities: signals.opportunities.slice(0, SUMMARY_LIST_CAP),
    quickWins: signals.quickWins.slice(0, SUMMARY_LIST_CAP),
    cannibalization: signals.cannibalization.slice(0, CANNIBALIZATION_LIST_CAP),
  }
}

// ─── Payload validation (Codex #4 / plan #3 — atomic publish) ──────────────
// Runs on the provider's response BEFORE prisma.gscSnapshot.create. Zero/
// non-positive positions are intentionally KEPT (finite is all that's
// required here) — discarding them is derive.ts's job, not the validator's.

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

function isNonEmptyString(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0
}

function isValidQueryRow(row: unknown): row is GscQueryRow {
  if (!row || typeof row !== 'object') return false
  const r = row as Record<string, unknown>
  return (
    isNonEmptyString(r.query) &&
    isFiniteNonNegative(r.clicks) &&
    isFiniteNonNegative(r.impressions) &&
    typeof r.position === 'number' &&
    Number.isFinite(r.position)
  )
}

function isValidQueryPageRow(row: unknown): row is GscQueryPageRow {
  if (!row || typeof row !== 'object') return false
  const r = row as Record<string, unknown>
  return (
    isNonEmptyString(r.query) &&
    isNonEmptyString(r.page) &&
    isFiniteNonNegative(r.clicks) &&
    isFiniteNonNegative(r.impressions) &&
    typeof r.position === 'number' &&
    Number.isFinite(r.position)
  )
}

function isValidPayload(
  input: { queryRows: unknown; queryPageRows: unknown },
): input is { queryRows: GscQueryRow[]; queryPageRows: GscQueryPageRow[] } {
  const { queryRows, queryPageRows } = input
  if (!Array.isArray(queryRows) || !Array.isArray(queryPageRows)) return false
  if (!queryRows.every(isValidQueryRow)) return false
  if (!queryPageRows.every(isValidQueryPageRow)) return false
  return true
}

// ─── Single-flight (Codex #7 / plan #4) ────────────────────────────────────
// Module-level map, entry installed SYNCHRONOUSLY on call — refreshGscSnapshot
// is NOT itself async, so there is zero await between the map lookup and the
// map.set below. Two concurrent calls for the same clientId therefore always
// observe the same in-flight promise; different clientIds never share one.

const inFlight = new Map<number, Promise<RefreshGscSnapshotResult>>()

export function refreshGscSnapshot(clientId: number): Promise<RefreshGscSnapshotResult> {
  const existing = inFlight.get(clientId)
  if (existing) return existing

  const promise = (async (): Promise<RefreshGscSnapshotResult> => {
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) return { ok: false, reason: 'client_not_found' }

    const gscSiteUrl = client.gscSiteUrl
    if (gscSiteUrl === null) {
      return { ok: false, reason: 'not_mapped', message: 'No GSC site URL mapped for this client' }
    }

    const window = computeSnapshotWindow(new Date())
    const result = await fetchGscQueryPage(gscSiteUrl, window)
    if (!result.ok) return result

    const { queryRows, queryPageRows, queryAtLimit, queryPageAtLimit } = result.data

    // Atomic publish: validate + derive BEFORE create — a fetch that
    // returned ok:true but a malformed payload publishes NOTHING, and any
    // previously-stored valid snapshot stays exactly as it was.
    if (!isValidPayload({ queryRows, queryPageRows })) {
      return { ok: false, reason: 'error', message: 'invalid_payload' }
    }

    const signals = deriveKeywordSignals(queryRows, queryPageRows, { minImpressions: GSC_MIN_IMPRESSIONS })

    const row = await prisma.gscSnapshot.create({
      data: {
        clientId,
        gscSiteUrl, // verbatim string used for the fetch (Codex #1)
        windowStart: window.start,
        windowEnd: window.end,
        queryRowLimit: GSC_QUERY_ROW_LIMIT,
        queryPageRowLimit: GSC_QUERY_PAGE_ROW_LIMIT,
        queryAtLimit,
        queryPageAtLimit,
        minImpressions: GSC_MIN_IMPRESSIONS,
        queryRowsJson: JSON.stringify(queryRows),
        queryPageRowsJson: JSON.stringify(queryPageRows),
      },
    })

    return { ok: true, summary: buildSummary(row, signals) }
  })()

  inFlight.set(clientId, promise)
  // Cleanup rides a DERIVED promise: `.finally()` returns a NEW promise that
  // re-rejects with the original reason, and that derived promise is
  // discarded here. It therefore needs its own no-op catch — without it a
  // rejected refresh becomes an unhandledRejection and crashes this
  // single-PM2-process app, even though every caller handles the ORIGINAL
  // `promise`. The catch is attached to the derived chain only; the original
  // promise (cached above, returned below) still rejects into its callers.
  promise
    .finally(() => {
      // Only clear the entry if it's still ours (a defensive no-op guard —
      // in practice nothing else ever replaces it while in flight).
      if (inFlight.get(clientId) === promise) {
        inFlight.delete(clientId)
      }
    })
    .catch(() => {
      /* rejection observed by callers of the original promise */
    })

  return promise
}

// ─── Reads (Codex #1 / #4 / #6) ────────────────────────────────────────────

type LoadedSnapshot = {
  clientExists: boolean
  gscMapped: boolean
  row: GscSnapshot | null
  payload: { queryRows: GscQueryRow[]; queryPageRows: GscQueryPageRow[] } | null
}

/** Shared newest-valid-snapshot resolver. Distinguishes unknown client
 *  (clientExists:false) from unmapped (gscMapped:false) from no-usable-snapshot
 *  (both true, row/payload null). Corrupt-newest falls through to the next valid. */
async function loadLatestValidSnapshot(clientId: number): Promise<LoadedSnapshot> {
  const client = await prisma.client.findUnique({ where: { id: clientId } })
  if (!client) return { clientExists: false, gscMapped: false, row: null, payload: null }
  if (client.gscSiteUrl === null) return { clientExists: true, gscMapped: false, row: null, payload: null }

  const rows = await prisma.gscSnapshot.findMany({
    where: { clientId, gscSiteUrl: client.gscSiteUrl },
    orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
    take: 3,
  })

  for (const row of rows) {
    let queryRows: unknown
    let queryPageRows: unknown
    try {
      queryRows = JSON.parse(row.queryRowsJson)
      queryPageRows = JSON.parse(row.queryPageRowsJson)
    } catch (err) {
      logError({ clientId, gscSnapshotId: row.id }, err)
      continue
    }
    const payload = { queryRows, queryPageRows }
    if (!isValidPayload(payload)) {
      logError({ clientId, gscSnapshotId: row.id }, new Error('gsc_snapshot_invalid_stored_payload'))
      continue
    }
    return { clientExists: true, gscMapped: true, row, payload }
  }
  return { clientExists: true, gscMapped: true, row: null, payload: null }
}

export async function getLatestGscSnapshot(
  clientId: number,
): Promise<{ gscMapped: boolean; summary: GscSnapshotSummary | null }> {
  const loaded = await loadLatestValidSnapshot(clientId)
  if (!loaded.gscMapped || !loaded.row || !loaded.payload) return { gscMapped: loaded.gscMapped, summary: null }
  const signals = deriveKeywordSignals(loaded.payload.queryRows, loaded.payload.queryPageRows, {
    minImpressions: loaded.row.minImpressions,
  })
  return { gscMapped: true, summary: buildSummary(loaded.row, signals) }
}

export async function getCannibalizationReport(clientId: number): Promise<CannibalizationReport> {
  const loaded = await loadLatestValidSnapshot(clientId)
  if (!loaded.clientExists) return { clientExists: false, gscMapped: false, report: null }
  if (!loaded.gscMapped || !loaded.row || !loaded.payload) {
    return { clientExists: true, gscMapped: loaded.gscMapped, report: null }
  }
  const signals = deriveKeywordSignals(loaded.payload.queryRows, loaded.payload.queryPageRows, {
    minImpressions: loaded.row.minImpressions,
  })
  const all = signals.cannibalization
  return {
    clientExists: true,
    gscMapped: true,
    report: {
      fetchedAt: loaded.row.fetchedAt.toISOString(),
      windowStart: loaded.row.windowStart.toISOString(),
      windowEnd: loaded.row.windowEnd.toISOString(),
      queryAtLimit: loaded.row.queryAtLimit,
      queryPageAtLimit: loaded.row.queryPageAtLimit,
      thresholds: signals.thresholds,
      totalCannibalizedQueries: all.length,
      capped: all.length > CANNIBALIZATION_REPORT_CAP,
      entries: all.slice(0, CANNIBALIZATION_REPORT_CAP),
    },
  }
}
