// C17: client-safe contract for the compact recents status endpoint.
// NO prisma import — RecentsTable/useRecentsLivePoll import VALUES from here
// (recents-status.ts and recents-query.ts are server-only).
import type { RecentType } from './recents-query'

export interface RecentStatusRef { type: RecentType; id: string }

export interface RecentStatusItem {
  type: RecentType
  id: string
  status: string
  score: number | null
  href: string
  startedAt: string | null
  completedAt: string | null
  inFlight: boolean
  /** Site types while crawling: pagesComplete + pagesError. */
  pagesDone: number | null
  /** Site types while crawling: pagesTotal (null when 0/undiscovered). */
  pagesTotal: number | null
  /** page: AdaAudit.progress; site-seo verifying: Job.progress. */
  progressPct: number | null
  /** page: progressMessage; site-seo verifying: job message ?? 'Verifying links…'. */
  phaseLabel: string | null
}

export const RECENTS_STATUS_MAX_IDS = 50

const POLLABLE = ['page', 'site-ada', 'site-seo'] as const

export function parseStatusRefs(raw: string | null): RecentStatusRef[] {
  if (!raw) return []
  const refs: RecentStatusRef[] = []
  for (const pair of raw.split(',')) {
    const sep = pair.indexOf(':')
    if (sep <= 0) continue
    const type = pair.slice(0, sep) as RecentType
    const id = pair.slice(sep + 1)
    if (!id || !(POLLABLE as readonly string[]).includes(type)) continue
    refs.push({ type, id })
    if (refs.length >= RECENTS_STATUS_MAX_IDS) break
  }
  return refs
}
