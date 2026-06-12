// lib/ada-audit/findings-fallback.ts
//
// C3 read-time fallbacks for pruned origin/child blobs (spec § 5.2/5.3).
// Blob-first, findings-fallback: these run ONLY when a complete audit's blob
// is null and its CrawlRun exists. Degraded by contract: nodes capped 5×300,
// no screenshots, description = help, pass/incomplete via archivedCounts.

import { prisma } from '@/lib/db'
import type {
  ArchivedCounts, AuditScorecard, AxeNode, AxeViolation, ImpactLevel,
  SiteAuditSummary, SitePagePdfState, SitePageResult, StoredAxeResults,
} from './types'
import type { LighthouseSummary } from './lighthouse-types'
import type { PdfIssue } from './pdf-types'
import { ZERO_SCORECARD, addScorecards } from './site-audit-helpers'
import { detectCommonIssuesFromViolationRows, type ViolationRowInput } from './common-issues'

const REAL_IMPACTS: readonly string[] = ['critical', 'serious', 'moderate', 'minor']

type ViolationRow = {
  pageId: string
  ruleId: string
  impact: string
  wcagTags: string
  help: string | null
  helpUrl: string | null
  nodeCount: number
  nodes: string | null
}

function parseNodes(nodes: string | null): AxeNode[] {
  if (!nodes) return []
  try {
    const parsed = JSON.parse(nodes)
    if (!Array.isArray(parsed)) return []
    return parsed.map((n) => ({
      html: typeof n?.html === 'string' ? n.html : '',
      target: Array.isArray(n?.target) ? n.target : [],
    }))
  } catch {
    return []
  }
}

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function toAxeViolation(v: ViolationRow): AxeViolation {
  return {
    id: v.ruleId,
    impact: REAL_IMPACTS.includes(v.impact) ? (v.impact as ImpactLevel) : null,
    help: v.help ?? v.ruleId,
    description: v.help ?? '',
    helpUrl: v.helpUrl ?? '',
    tags: parseStringArray(v.wcagTags),
    nodes: parseNodes(v.nodes),
  }
}

function impactCounts(rows: ViolationRow[]): Pick<AuditScorecard, 'critical' | 'serious' | 'moderate' | 'minor'> {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const v of rows) {
    if (v.impact in counts) counts[v.impact as keyof typeof counts]++
  }
  return counts
}

/** Degraded StoredAxeResults from Violation rows; resolves both standalone
 *  audits and site-audit children via CrawlPage.adaAuditId. Null when the
 *  audit has no findings page (pre-A2 / dual-write failure). */
export async function buildArchivedAxeResults(adaAuditId: string): Promise<StoredAxeResults | null> {
  const page = await prisma.crawlPage.findFirst({
    where: { adaAuditId },
    orderBy: { id: 'desc' },
    select: {
      id: true, url: true, passCount: true, incompleteCount: true,
      run: { select: { completedAt: true } },
    },
  })
  if (!page) return null

  const rows = await prisma.violation.findMany({
    where: { pageId: page.id },
    orderBy: [{ ruleId: 'asc' }, { id: 'asc' }],
    select: {
      pageId: true, ruleId: true, impact: true, wcagTags: true,
      help: true, helpUrl: true, nodeCount: true, nodes: true,
    },
  })

  return {
    violations: rows.map(toAxeViolation),
    passes: [],
    incomplete: [],
    inapplicable: [],
    timestamp: page.run.completedAt?.toISOString() ?? '',
    url: page.url,
    testEngine: { name: 'axe-core', version: '' },
    testRunner: { name: 'archived-findings' },
    archived: true,
    archivedCounts: { passed: page.passCount, incomplete: page.incompleteCount },
  }
}

/** Degraded SiteAuditSummary from CrawlPage/Violation rows + unpruned child
 *  scalars (lighthouseSummary, PdfAudit). Null when no CrawlRun exists. */
export async function buildSummaryFromFindings(siteAuditId: string): Promise<SiteAuditSummary | null> {
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId }, select: { id: true } })
  if (!run) return null

  const [pages, violations] = await Promise.all([
    prisma.crawlPage.findMany({
      where: { runId: run.id },
      orderBy: [{ url: 'asc' }],
      select: {
        id: true, url: true, status: true, error: true, finalUrl: true,
        adaAuditId: true, passCount: true, incompleteCount: true,
      },
    }),
    prisma.violation.findMany({
      where: { runId: run.id },
      orderBy: [{ ruleId: 'asc' }, { id: 'asc' }],
      select: {
        pageId: true, ruleId: true, impact: true, wcagTags: true,
        help: true, helpUrl: true, nodeCount: true, nodes: true,
      },
    }),
  ])

  const childIds = pages.map((p) => p.adaAuditId).filter((x): x is string => x !== null)
  const children = childIds.length
    ? await prisma.adaAudit.findMany({
        where: { id: { in: childIds } },
        select: { id: true, lighthouseSummary: true, pdfAudits: { select: { status: true, issues: true } } },
      })
    : []
  const childById = new Map(children.map((c) => [c.id, c]))

  const violationsByPage = new Map<string, ViolationRow[]>()
  for (const v of violations) {
    const list = violationsByPage.get(v.pageId) ?? []
    list.push(v)
    violationsByPage.set(v.pageId, list)
  }

  const pageResults: SitePageResult[] = pages.map((p) => {
    if (p.status === 'redirected') {
      return {
        adaAuditId: p.adaAuditId ?? '', url: p.url, status: 'redirected' as const,
        error: null, scorecard: null, lighthouse: null,
        pdfs: { total: 0, complete: 0, errored: 0, withIssues: 0 },
        finalUrl: p.finalUrl ?? null, violationIds: [],
      }
    }

    const mine = violationsByPage.get(p.id) ?? []
    const scorecard: AuditScorecard | null = p.status === 'complete'
      ? {
          ...impactCounts(mine),
          total: mine.length,
          passed: p.passCount ?? 0,
          incomplete: p.incompleteCount ?? 0,
        }
      : null

    const child = p.adaAuditId ? childById.get(p.adaAuditId) : undefined
    let lighthouse: LighthouseSummary | null = null
    if (child?.lighthouseSummary) {
      try { lighthouse = JSON.parse(child.lighthouseSummary) as LighthouseSummary } catch { lighthouse = null }
    }
    const pdfs: SitePagePdfState = { total: child?.pdfAudits.length ?? 0, complete: 0, errored: 0, withIssues: 0 }
    for (const pdf of child?.pdfAudits ?? []) {
      if (pdf.status === 'complete') {
        pdfs.complete++
        try {
          const issues = pdf.issues ? (JSON.parse(pdf.issues) as PdfIssue[]) : []
          if (Array.isArray(issues) && issues.length > 0) pdfs.withIssues++
        } catch { /* unparseable issues — counted complete, not withIssues */ }
      } else if (pdf.status === 'error') {
        pdfs.errored++
      }
    }

    return {
      adaAuditId: p.adaAuditId ?? '', url: p.url,
      status: (p.status === 'complete' ? 'complete' : 'error') as 'complete' | 'error',
      error: p.error ?? null, scorecard, lighthouse, pdfs,
      violationIds: [...new Set(mine.map((v) => v.ruleId))],
      archivedCounts: { passed: p.passCount, incomplete: p.incompleteCount },
    }
  })

  pageResults.sort((a, b) => (b.scorecard?.total ?? -1) - (a.scorecard?.total ?? -1))

  const aggregate = pageResults.reduce(
    (acc, p) => (p.scorecard ? addScorecards(acc, p.scorecard) : acc),
    { ...ZERO_SCORECARD },
  )

  const knownPass = pages.filter((p) => p.passCount !== null)
  const knownIncomplete = pages.filter((p) => p.incompleteCount !== null)
  const archivedCounts: ArchivedCounts = {
    passed: knownPass.length > 0 ? knownPass.reduce((s, p) => s + (p.passCount ?? 0), 0) : null,
    incomplete: knownIncomplete.length > 0 ? knownIncomplete.reduce((s, p) => s + (p.incompleteCount ?? 0), 0) : null,
  }

  const pdfsSkipped = children.reduce(
    (acc, c) => acc + c.pdfAudits.filter((pdf) => pdf.status === 'skipped').length, 0)
  const pdfsAggregate = pageResults.reduce(
    (acc, p) => ({
      total: acc.total + p.pdfs.total,
      complete: acc.complete + p.pdfs.complete,
      errored: acc.errored + p.pdfs.errored,
      skipped: acc.skipped,
      withIssues: acc.withIssues + p.pdfs.withIssues,
    }),
    { total: 0, complete: 0, errored: 0, skipped: pdfsSkipped, withIssues: 0 },
  )

  const completePageIds = new Set(pages.filter((p) => p.status === 'complete').map((p) => p.id))
  const pageUrlById = new Map(pages.map((p) => [p.id, p.url]))
  const commonRows: ViolationRowInput[] = violations
    .filter((v) => completePageIds.has(v.pageId))
    .map((v) => ({
      pageId: v.pageId, url: pageUrlById.get(v.pageId) ?? '',
      ruleId: v.ruleId, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes,
    }))
  const commonIssues = detectCommonIssuesFromViolationRows(commonRows, completePageIds.size)

  return { aggregate, pdfsAggregate, pages: pageResults, commonIssues, archived: true, archivedCounts }
}
