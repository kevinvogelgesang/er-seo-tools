/**
 * Pure UTC snapshot-window math for the KS-1 GSC query snapshot (D4/D2).
 * Uses only Date.UTC and getUTC* methods — never local-tz APIs — matching
 * the style of lib/analytics/dates.ts.
 */

import type { DateWindow } from '@/lib/analytics/dates'
import { GSC_WINDOW_DAYS, GSC_WINDOW_LAG_DAYS } from './types'

/**
 * Compute the trailing snapshot window: end = the UTC calendar day that is
 * GSC_WINDOW_LAG_DAYS (3) days before `now` (time truncated to 00:00:00 UTC),
 * start = end minus (GSC_WINDOW_DAYS - 1) days, giving GSC_WINDOW_DAYS (91)
 * inclusive days — sidesteps GSC's fresh-data lag.
 */
export function computeSnapshotWindow(now: Date): DateWindow {
  const nowUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const endTime = nowUtcMidnight - GSC_WINDOW_LAG_DAYS * 86400000
  const startTime = endTime - (GSC_WINDOW_DAYS - 1) * 86400000

  return { start: new Date(startTime), end: new Date(endTime) }
}
