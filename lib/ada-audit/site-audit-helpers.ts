import type { AuditScorecard, SiteAuditSummary, SitePageResult } from './types'

interface ChildRow {
  id: string
  url: string
  status: string
  error: string | null
  result: string | null
}

function parseScorecard(result: string | null): AuditScorecard | null {
  if (!result) return null
  try {
    const r = JSON.parse(result)
    const violations = Array.isArray(r?.violations) ? r.violations : []
    return {
      critical:   violations.filter((v: { impact: string }) => v.impact === 'critical').length,
      serious:    violations.filter((v: { impact: string }) => v.impact === 'serious').length,
      moderate:   violations.filter((v: { impact: string }) => v.impact === 'moderate').length,
      minor:      violations.filter((v: { impact: string }) => v.impact === 'minor').length,
      total:      violations.length,
      passed:     Array.isArray(r?.passes) ? r.passes.length : 0,
      incomplete: Array.isArray(r?.incomplete) ? r.incomplete.length : 0,
    }
  } catch {
    return null
  }
}

export function addScorecards(a: AuditScorecard, b: AuditScorecard): AuditScorecard {
  return {
    critical:   a.critical   + b.critical,
    serious:    a.serious    + b.serious,
    moderate:   a.moderate   + b.moderate,
    minor:      a.minor      + b.minor,
    total:      a.total      + b.total,
    passed:     a.passed     + b.passed,
    incomplete: a.incomplete + b.incomplete,
  }
}

export const ZERO_SCORECARD: AuditScorecard = {
  critical: 0, serious: 0, moderate: 0, minor: 0,
  total: 0, passed: 0, incomplete: 0,
}

export function buildSiteAuditSummary(children: ChildRow[]): SiteAuditSummary {
  const pages: SitePageResult[] = children.map((child) => {
    const scorecard = child.status === 'complete' ? parseScorecard(child.result) : null
    return {
      adaAuditId: child.id,
      url: child.url,
      status: (child.status === 'complete' ? 'complete' : 'error') as 'complete' | 'error',
      error: child.error ?? null,
      scorecard,
    }
  })

  // Sort pages by total violations descending (errors last)
  pages.sort((a, b) => {
    const at = a.scorecard?.total ?? -1
    const bt = b.scorecard?.total ?? -1
    return bt - at
  })

  const aggregate = pages.reduce(
    (acc, p) => p.scorecard ? addScorecards(acc, p.scorecard) : acc,
    { ...ZERO_SCORECARD }
  )

  return { aggregate, pages }
}
