// Pure helper for the live-children table rendered while a SiteAudit is in
// flight. Caller (the GET /api/site-audit/[id] route) does the prisma query
// and passes the rows in — this module does no I/O so it stays trivially
// unit-testable.

import type { LiveAuditChild } from './types'
import { parseAxeScorecardFromResult } from './site-audit-helpers'

/** Cap the live-children response to a recent slice. Sites larger than this
 *  will only see the most recent rows until the audit finalizes. */
export const LIVE_CHILDREN_LIMIT = 100

const LIVE_STATUSES = ['pending', 'running', 'complete', 'error', 'redirected'] as const
type LiveStatus = typeof LIVE_STATUSES[number]

/** Row shape the route should `select` from `prisma.adaAudit.findMany`. */
export interface LiveChildInputRow {
  id: string
  url: string
  status: string
  result: string | null
  error: string | null
}

/**
 * Map the DB-side status to the UI's narrow status union.
 *
 * `'axe-complete'` is the persistence state on the PSI Lighthouse path:
 * the runner writes the axe result and flips status to `'axe-complete'`
 * while the LH worker is still scoring the page. For the live table, the
 * row is functionally terminal — the axe data is in `result` already, so
 * we surface it as `'complete'` so the row is clickable and shows counts.
 * Once Lighthouse finishes the runner flips it to `'complete'`; the wire
 * shape doesn't change.
 */
function coerceStatus(s: string): LiveStatus {
  if (s === 'axe-complete') return 'complete'
  return (LIVE_STATUSES as readonly string[]).includes(s) ? (s as LiveStatus) : 'pending'
}

/**
 * Pure transform from pre-fetched AdaAudit rows to the wire shape for the
 * live-children table. No DB access. Order preservation is the caller's
 * responsibility (route fetches with `orderBy: createdAt desc`).
 */
export function buildLiveChildren(rows: LiveChildInputRow[]): LiveAuditChild[] {
  return rows.map((r) => {
    const hasAxeResult = r.status === 'complete' || r.status === 'axe-complete'
    return {
      adaAuditId: r.id,
      url: r.url,
      status: coerceStatus(r.status),
      scorecard: hasAxeResult ? parseAxeScorecardFromResult(r.result) : null,
      error: r.error,
    }
  })
}
