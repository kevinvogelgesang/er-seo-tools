import { useMemo } from 'react'
import type { SitePageResult, AuditScorecard } from '@/lib/ada-audit/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export type SortKey = 'total' | 'critical' | 'serious' | 'url'
export type ImpactFilter = 'all' | 'critical' | 'serious' | 'moderate' | 'minor' | 'error'
export type StatusFilter = 'all' | 'complete' | 'error'

export interface TreeNode {
  segment: string
  fullPath: string
  children: TreeNode[]
  pages: SitePageResult[]
  aggregate: AuditScorecard
  descendantCount: number
}

export interface FilterCounts {
  all: number
  critical: number
  serious: number
  moderate: number
  minor: number
  error: number
}

interface Options {
  sortKey: SortKey
  filterImpact: ImpactFilter
  filterStatus: StatusFilter
}

interface Result {
  issuePages: SitePageResult[]
  cleanPages: SitePageResult[]
  counts: FilterCounts
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

function sortPages(pages: SitePageResult[], key: SortKey): SitePageResult[] {
  return [...pages].sort((a, b) => {
    switch (key) {
      case 'total':
        return (b.scorecard?.total ?? -1) - (a.scorecard?.total ?? -1)
      case 'critical':
        return (b.scorecard?.critical ?? -1) - (a.scorecard?.critical ?? -1)
      case 'serious':
        return (b.scorecard?.serious ?? -1) - (a.scorecard?.serious ?? -1)
      case 'url':
        return a.url.localeCompare(b.url)
    }
  })
}

// ─── Filtering ───────────────────────────────────────────────────────────────

export function filterByImpact(pages: SitePageResult[], impact: ImpactFilter): SitePageResult[] {
  if (impact === 'all') return pages
  if (impact === 'error') return pages.filter((p) => p.status === 'error')
  // For specific impact levels (critical/serious/moderate/minor): include pages
  // where the impact count is > 0, AND any page where we couldn't classify
  // (status === 'error' OR complete with null scorecard from malformed JSON).
  // These are still "issue pages" by the hook's own classification — hiding
  // them when the user filters by impact is the bug being fixed.
  return pages.filter(
    (p) => p.scorecard === null || (p.scorecard !== null && p.scorecard[impact] > 0),
  )
}

function filterByStatus(pages: SitePageResult[], status: StatusFilter): SitePageResult[] {
  if (status === 'all') return pages
  return pages.filter((p) => p.status === status)
}

// ─── Counts ──────────────────────────────────────────────────────────────────

export function computeCounts(pages: SitePageResult[]): FilterCounts {
  const counts: FilterCounts = { all: 0, critical: 0, serious: 0, moderate: 0, minor: 0, error: 0 }
  for (const p of pages) {
    if (p.status === 'error') { counts.error++; counts.all++; continue }
    if (p.status === 'complete' && p.scorecard !== null && p.scorecard.total === 0) continue
    counts.all++
    if (!p.scorecard) continue
    if (p.scorecard.critical > 0) counts.critical++
    if (p.scorecard.serious > 0) counts.serious++
    if (p.scorecard.moderate > 0) counts.moderate++
    if (p.scorecard.minor > 0) counts.minor++
  }
  return counts
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSiteAuditPages(pages: SitePageResult[], options: Options): Result {
  const { sortKey, filterImpact, filterStatus } = options

  return useMemo(() => {
    // 1. Split clean vs issues
    const clean: SitePageResult[] = []
    const issues: SitePageResult[] = []

    for (const p of pages) {
      if (p.status === 'complete' && p.scorecard && p.scorecard.total === 0) {
        clean.push(p)
      } else {
        issues.push(p)
      }
    }

    // 2. Counts from full issue pages (before filtering)
    const counts = computeCounts(issues)

    // 3. Filter issue pages
    let filtered = filterByStatus(issues, filterStatus)
    filtered = filterByImpact(filtered, filterImpact)

    // 4. Sort
    const sorted = sortPages(filtered, sortKey)

    // 5. Sort clean pages alphabetically
    const sortedClean = [...clean].sort((a, b) => a.url.localeCompare(b.url))

    return {
      issuePages: sorted,
      cleanPages: sortedClean,
      counts,
    }
  }, [pages, sortKey, filterImpact, filterStatus])
}
