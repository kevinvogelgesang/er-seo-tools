// Pure UI-layer helpers for queue/active-audit display. No DB access, no
// imports beyond the shared type. Consumed by both `SiteAuditForm` (banner)
// and `DashboardQueueStatus` (current-scan card) so they stay in sync.

import type { QueueStatusWithBatch } from './types'

type ActiveAudit = NonNullable<QueueStatusWithBatch['active']>

export interface ActivePhaseSummary {
  /** Display label for the active phase (e.g. "Scanning pages"). */
  label: string
  /** Unit noun for the count (e.g. "pages", "PDFs"). */
  unit: string
  /** Items completed (success + error) in this phase. */
  complete: number
  /** Total items expected in this phase. 0 means "not yet discovered". */
  total: number
  /** Integer percent 0..100. `0` when total is 0. */
  pct: number
}

/**
 * Pick the current drain phase off an active SiteAudit and project it into a
 * uniform `{ label, unit, complete, total, pct }` shape. Used to render the
 * progress chrome in two distinct UIs.
 *
 * Phase selection:
 * - `lighthouse-running` → Lighthouse phase
 * - `pdfs-running`       → PDF phase
 * - anything else        → pages phase (running, pending, queued-to-active,
 *                          and unknown states fall through here on purpose)
 */
export function computeActivePhaseSummary(active: ActiveAudit): ActivePhaseSummary {
  if (active.status === 'lighthouse-running') {
    const complete = active.lighthouseComplete + active.lighthouseError
    const total = active.lighthouseTotal
    return {
      label: 'Running Lighthouse',
      unit: 'pages',
      complete,
      total,
      pct: total > 0 ? Math.round((complete / total) * 100) : 0,
    }
  }

  if (active.status === 'pdfs-running') {
    const complete = active.pdfsComplete + active.pdfsError + active.pdfsSkipped
    const total = active.pdfsTotal
    return {
      label: 'Scanning PDFs',
      unit: 'PDFs',
      complete,
      total,
      pct: total > 0 ? Math.round((complete / total) * 100) : 0,
    }
  }

  // Pages phase — covers running, pending, and any unrecognized status.
  const complete = active.pagesComplete + active.pagesError
  const total = active.pagesTotal
  return {
    label: 'Scanning pages',
    unit: 'pages',
    complete,
    total,
    pct: total > 0 ? Math.round((complete / total) * 100) : 0,
  }
}
