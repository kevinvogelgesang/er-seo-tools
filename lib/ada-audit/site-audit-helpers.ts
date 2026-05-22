import type { AuditScorecard, SiteAuditSummary, SitePageResult, SitePagePdfState, SiteAuditPdfAggregate } from './types'
import type { LighthouseSummary } from './lighthouse-types'
import type { PdfIssue } from './pdf-types'
import { detectCommonIssues } from './common-issues'

export const SITE_AUDIT_PAGE_CAP = 1000

interface ChildPdfAudit {
  status: string
  issues: string | null
}

interface ChildRow {
  id: string
  url: string
  status: string
  error: string | null
  result: string | null
  lighthouseSummary: string | null
  pdfAudits: ChildPdfAudit[]
  finalUrl?: string | null
}

export function normaliseSiteAuditDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
}

export function isAllowedSiteAuditUrl(url: string, domain: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

    const host = parsed.hostname.toLowerCase()
    return host === domain || host === `www.${domain}` || domain === `www.${host}`
  } catch {
    return false
  }
}

export function normaliseDiscoveredSiteAuditUrls(urls: string[], domain: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const rawUrl of urls) {
    if (typeof rawUrl !== 'string') continue

    let parsed: URL
    try {
      parsed = new URL(rawUrl.trim())
    } catch {
      continue
    }

    parsed.hash = ''
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((param) => {
      parsed.searchParams.delete(param)
    })

    const url = parsed.toString()
    if (!isAllowedSiteAuditUrl(url, domain) || seen.has(url)) continue

    seen.add(url)
    result.push(url)

    if (result.length >= SITE_AUDIT_PAGE_CAP) break
  }

  return result
}

export function parseAxeScorecardFromResult(result: string | null): AuditScorecard | null {
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

function safeParseIssues(json: string | null): PdfIssue[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed as PdfIssue[] : []
  } catch {
    return []
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
    // Redirected children carry no axe data and no harvested PDFs — emit a
    // minimal row so the consumer can render the Redirects section without
    // trying to parse a missing result blob.
    if (child.status === 'redirected') {
      return {
        adaAuditId: child.id,
        url: child.url,
        status: 'redirected' as const,
        error: null,
        scorecard: null,
        lighthouse: null,
        pdfs: { total: 0, complete: 0, errored: 0, withIssues: 0 },
        finalUrl: child.finalUrl ?? null,
      }
    }

    const scorecard = child.status === 'complete' ? parseAxeScorecardFromResult(child.result) : null

    let lighthouse: LighthouseSummary | null = null
    if (child.lighthouseSummary) {
      try { lighthouse = JSON.parse(child.lighthouseSummary) as LighthouseSummary }
      catch { lighthouse = null }
    }

    const pdfs: SitePagePdfState = {
      total: child.pdfAudits.length,
      complete: 0,
      errored: 0,
      withIssues: 0,
    }
    for (const p of child.pdfAudits) {
      if (p.status === 'complete') {
        pdfs.complete++
        const issues = safeParseIssues(p.issues)
        if (issues.length > 0) pdfs.withIssues++
      } else if (p.status === 'error') {
        pdfs.errored++
      }
      // 'skipped' rows are terminal but not counted in complete/errored;
      // they are captured in pdfsAggregate.skipped below.
    }

    return {
      adaAuditId: child.id,
      url: child.url,
      status: (child.status === 'complete' ? 'complete' : 'error') as 'complete' | 'error',
      error: child.error ?? null,
      scorecard,
      lighthouse,
      pdfs,
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

  // Count skipped PDFs across all child pdfAudits (not tracked in SitePagePdfState).
  const pdfsSkippedCount = children.reduce(
    (acc, child) => acc + child.pdfAudits.filter((p) => p.status === 'skipped').length,
    0,
  )

  const pdfsAggregate: SiteAuditPdfAggregate = pages.reduce(
    (acc, p) => ({
      total:      acc.total      + p.pdfs.total,
      complete:   acc.complete   + p.pdfs.complete,
      errored:    acc.errored    + p.pdfs.errored,
      skipped:    acc.skipped,
      withIssues: acc.withIssues + p.pdfs.withIssues,
    }),
    { total: 0, complete: 0, errored: 0, skipped: pdfsSkippedCount, withIssues: 0 },
  )

  // Site-wide common-issue analysis: rules that hit >= COMMON_ISSUE_THRESHOLD
  // of complete pages, with best-effort shared-ancestor hint. Stored alongside
  // aggregate/pdfsAggregate/pages so the callout renders without extra fetch.
  const commonIssues = detectCommonIssues(
    children.map((c) => ({ id: c.id, status: c.status, result: c.result })),
  )

  return { aggregate, pdfsAggregate, pages, commonIssues }
}
