// Pure helper for the live-children table rendered while a SiteAudit is in
// flight. Caller (the GET /api/site-audit/[id] route) does the prisma query
// and passes the rows in — this module does no I/O so it stays trivially
// unit-testable.

import type { LiveAuditChild } from './types'
import { parseAxeScorecardFromResult } from './site-audit-helpers'

/** Cap the live-children response to a recent slice. Sites larger than this
 *  will only see the most recent rows until the audit finalizes. */
export const LIVE_CHILDREN_LIMIT = 100

const LIVE_STATUSES = ['pending', 'running', 'complete', 'error'] as const
type LiveStatus = typeof LIVE_STATUSES[number]

/** Row shape the route should `select` from `prisma.adaAudit.findMany`. */
export interface LiveChildInputRow {
  id: string
  url: string
  status: string
  result: string | null
  error: string | null
}

function coerceStatus(s: string): LiveStatus {
  return (LIVE_STATUSES as readonly string[]).includes(s) ? (s as LiveStatus) : 'pending'
}

/**
 * Pure transform from pre-fetched AdaAudit rows to the wire shape for the
 * live-children table. No DB access. Order preservation is the caller's
 * responsibility (route fetches with `orderBy: createdAt desc`).
 */
export function buildLiveChildren(rows: LiveChildInputRow[]): LiveAuditChild[] {
  return rows.map((r) => ({
    adaAuditId: r.id,
    url: r.url,
    status: coerceStatus(r.status),
    scorecard: r.status === 'complete' ? parseAxeScorecardFromResult(r.result) : null,
    error: r.error,
  }))
}
