/**
 * Pure UTC date-window math module for analytics reporting.
 * Uses only Date.UTC and getUTC* methods — never local-tz APIs.
 */

export type DateWindow = { start: Date; end: Date }

/**
 * Format a Date as YYYY-MM-DD (UTC).
 */
export function formatYmd(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Return the prior calendar month as a DateWindow (inclusive).
 * Example: called on 2026-06-22, returns 2026-05-01 to 2026-05-31.
 */
export function lastFullMonth(now: Date): DateWindow {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  // Month before now: subtract 1 (0-based, so month=5 is June)
  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear = month === 0 ? year - 1 : year

  // Start: first day of previous month
  const start = new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0, 0))

  // End: last day of previous month
  // Set to 1st of current month, subtract 1 day
  const nextMonthStart = new Date(Date.UTC(prevYear, prevMonth + 1, 1, 0, 0, 0, 0))
  const end = new Date(nextMonthStart.getTime() - 86400000) // 1 day in ms

  return { start, end }
}

/**
 * Calculate the number of days in a DateWindow (inclusive).
 * Formula: round((end - start) / 86400000) + 1
 */
export function dayCount(w: DateWindow): number {
  const diffMs = w.end.getTime() - w.start.getTime()
  const diffDays = Math.round(diffMs / 86400000)
  return diffDays + 1
}

/**
 * Get a comparison window for analytics (previous period or previous year).
 * - 'prev_period': previous same-length period immediately before
 * - 'prev_year': same dates but one year earlier
 */
export function comparisonWindow(period: DateWindow, mode: 'prev_period' | 'prev_year'): DateWindow {
  if (mode === 'prev_year') {
    // Subtract 1 year from both start and end
    const startYear = period.start.getUTCFullYear() - 1
    const startMonth = period.start.getUTCMonth()
    const startDay = period.start.getUTCDate()

    const endYear = period.end.getUTCFullYear() - 1
    const endMonth = period.end.getUTCMonth()
    const endDay = period.end.getUTCDate()

    const start = new Date(Date.UTC(startYear, startMonth, startDay, 0, 0, 0, 0))
    const end = new Date(Date.UTC(endYear, endMonth, endDay, 0, 0, 0, 0))

    return { start, end }
  }

  // mode === 'prev_period'
  // newEnd = start - 1 day
  // newStart = newEnd - (dayCount - 1) days
  const days = dayCount(period)
  const newEndTime = period.start.getTime() - 86400000
  const newEnd = new Date(newEndTime)

  const newStartTime = newEndTime - (days - 1) * 86400000
  const newStart = new Date(newStartTime)

  return { start: newStart, end: newEnd }
}
