// Which of the 13 plan weeks contains `now`, or null if the plan has no start
// date or today falls outside the window. startDate is 'YYYY-MM-DD' = Monday of
// week 1, parsed at local midnight to match grid-ops.getWeekDates.
import { NUM_WEEKS } from './state'

export function resolveCurrentWeek(startDate: string, now: Date): number | null {
  if (!startDate) return null
  const start = new Date(startDate + 'T00:00:00')
  if (Number.isNaN(start.getTime())) return null
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.floor((now.getTime() - start.getTime()) / dayMs)
  if (diffDays < 0) return null
  const week = Math.floor(diffDays / 7) + 1
  if (week < 1 || week > NUM_WEEKS) return null
  return week
}
