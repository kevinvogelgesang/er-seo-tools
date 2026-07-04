// lib/report/report-data.ts — assembles SiteReportData through the SAME read
// paths the views use (summary-or-fallback, CrawlRun.score, level-matched
// trend, C3 instance diff). Screenshots best-effort from child AdaAudit
// blobs (fresh audits only — Violation.nodes never carries screenshotPath).
//
// Contract (Codex plan fix #3): reports are findings-run-only. Returns null
// iff the audit is missing, the CrawlRun is missing (pre-A2), or no summary
// can be built — the POST route 409s `no_findings_run` up front, so a queued
// job that no-ops here is a crash-window backstop, not the user-visible path.
// The report-render handler checks status === 'complete' before calling.

import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import { getSiteAuditInstanceDiff } from '@/lib/services/site-audit-diff'
import { buildSeries, type ScorePoint } from '@/lib/services/scorecard-shared'
import { parseScoreVersion } from '@/lib/scoring/breakdown-version'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'
import type { SiteAuditSummary, StoredAxeResults } from '@/lib/ada-audit/types'
import type { SiteReportData, ReportTopIssue, ReportWorstPage } from './report-html'

const TOP_ISSUES = 10
const SAMPLE_URLS = 5
const NODE_SAMPLES = 2
const MAX_SCREENSHOTS = 6
const MAX_SCREENSHOT_BYTES = 300 * 1024
const WORST_PAGES = 50

const IMPACT_RANK: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }
const impactRank = (impact: string) => IMPACT_RANK[impact] ?? 4 // 'unknown' sentinel sorts last

interface RuleAgg {
  ruleId: string
  impact: string
  help: string | null
  helpUrl: string | null
  urls: Set<string>
  nodeSamples: string[]
  /** First violation row's child audit id — screenshot source. */
  firstAdaAuditId: string | null
}

function parseNodeHtmlSamples(nodes: string | null, max: number): string[] {
  if (!nodes) return []
  try {
    const parsed = JSON.parse(nodes)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((n) => (typeof n?.html === 'string' ? n.html : ''))
      .filter((html) => html.length > 0)
      .slice(0, max)
  } catch {
    return []
  }
}

type ViolationRow = {
  ruleId: string
  impact: string
  help: string | null
  helpUrl: string | null
  nodes: string | null
  page: { url: string; adaAuditId: string | null }
}

function aggregateTopIssues(violations: ViolationRow[]): RuleAgg[] {
  const byRule = new Map<string, RuleAgg>()
  for (const v of violations) {
    let agg = byRule.get(v.ruleId)
    if (!agg) {
      agg = {
        ruleId: v.ruleId, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
        urls: new Set(), nodeSamples: [], firstAdaAuditId: v.page.adaAuditId,
      }
      byRule.set(v.ruleId, agg)
    }
    agg.urls.add(v.page.url)
    if (agg.nodeSamples.length < NODE_SAMPLES) {
      agg.nodeSamples.push(
        ...parseNodeHtmlSamples(v.nodes, NODE_SAMPLES - agg.nodeSamples.length))
    }
  }
  return [...byRule.values()]
    .sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || b.urls.size - a.urls.size)
    .slice(0, TOP_ISSUES)
}

/** Best-effort child-blob screenshots, in top-issue order, capped at
 *  MAX_SCREENSHOTS successes. Every failure silently skips. */
async function attachScreenshots(issues: ReportTopIssue[], aggs: RuleAgg[]): Promise<void> {
  const childByRule = new Map(aggs.map((a) => [a.ruleId, a.firstAdaAuditId]))
  const blobCache = new Map<string, StoredAxeResults | null>()
  let successes = 0
  for (const issue of issues) {
    if (successes >= MAX_SCREENSHOTS) break
    const adaAuditId = childByRule.get(issue.ruleId) ?? null
    if (!adaAuditId) continue
    try {
      if (!blobCache.has(adaAuditId)) {
        const child = await prisma.adaAudit.findUnique({
          where: { id: adaAuditId }, select: { result: true },
        })
        let parsed: StoredAxeResults | null = null
        if (child?.result) {
          try { parsed = JSON.parse(child.result) as StoredAxeResults } catch { parsed = null }
        }
        blobCache.set(adaAuditId, parsed)
      }
      const results = blobCache.get(adaAuditId)
      if (!results || !Array.isArray(results.violations)) continue
      const violation = results.violations.find((v) => v.id === issue.ruleId)
      const node = violation?.nodes?.find(
        (n) => typeof n.screenshotPath === 'string' && n.screenshotPath.length > 0)
      if (!node?.screenshotPath) continue
      // screenshotPath is a BARE FILENAME; files live at SCREENSHOTS_DIR/<adaAuditId>/<filename>.
      const base = path.resolve(SCREENSHOTS_DIR, adaAuditId)
      const resolved = path.resolve(SCREENSHOTS_DIR, adaAuditId, node.screenshotPath)
      if (!resolved.startsWith(base + path.sep)) continue // traversal guard
      const stat = await fs.stat(resolved)
      if (stat.size > MAX_SCREENSHOT_BYTES) continue
      const buf = await fs.readFile(resolved)
      issue.screenshot = `data:image/png;base64,${buf.toString('base64')}`
      successes++
    } catch {
      // missing file / parse error / db error — silently skip
    }
  }
}

export async function loadSiteReportData(siteAuditId: string): Promise<SiteReportData | null> {
  // 2. Origin audit + client + PDF children.
  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: {
      id: true, domain: true, status: true, wcagLevel: true, summary: true,
      createdAt: true, completedAt: true, requestedBy: true,
      pagesTotal: true, pagesError: true, pdfsTotal: true,
      client: { select: { name: true } },
      pdfAudits: { select: { status: true, issues: true } },
    },
  })
  if (!audit) return null

  // 3. Findings run (reports are findings-run-only) + summary-or-fallback.
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'ada-audit' } },
    select: { id: true, score: true, scoreBreakdown: true },
  })
  if (!run) return null

  let summary: SiteAuditSummary | null = null
  if (audit.summary) {
    try { summary = JSON.parse(audit.summary) as SiteAuditSummary } catch { summary = null }
  }
  if (!summary) summary = await buildSummaryFromFindings(siteAuditId)
  if (!summary) return null

  const scored = computeScoreFromCounts(summary.aggregate, audit.wcagLevel)
  const score = run.score ?? scored.score
  const compliant = scored.compliant
  const archived = summary.archived === true

  // 4. Top issues from Violation rows (relational — works on archived audits).
  const violations = await prisma.violation.findMany({
    where: { runId: run.id },
    select: {
      ruleId: true, impact: true, help: true, helpUrl: true, nodes: true,
      page: { select: { url: true, adaAuditId: true } },
    },
  })
  const aggs = aggregateTopIssues(violations)
  const topIssues: ReportTopIssue[] = aggs.map((a) => ({
    ruleId: a.ruleId,
    impact: a.impact,
    help: a.help,
    helpUrl: a.helpUrl,
    pageCount: a.urls.size,
    sampleUrls: [...a.urls].sort().slice(0, SAMPLE_URLS),
    nodeSamples: a.nodeSamples,
    screenshot: null,
  }))

  // 5. Screenshots — fresh audits only (archived child blobs are pruned by contract).
  if (!archived) await attachScreenshots(topIssues, aggs)

  // 6. Trend: same-domain same-level scored site runs.
  const trendRuns = await prisma.crawlRun.findMany({
    where: {
      tool: 'ada-audit', source: 'site-audit',
      domain: audit.domain, wcagLevel: audit.wcagLevel,
      score: { not: null }, completedAt: { not: null },
    },
    select: { score: true, completedAt: true, createdAt: true, scoreBreakdown: true },
  })
  const points: ScorePoint[] = trendRuns.map((r) => ({
    date: (r.completedAt ?? r.createdAt).toISOString(),
    score: r.score as number,
    scoreVersion: parseScoreVersion(r.scoreBreakdown),
  }))
  const trend = buildSeries(points).points

  // 7. Changes since previous audit (C3 selection — null when no comparable run).
  const diffResult = await getSiteAuditInstanceDiff(siteAuditId)

  // 8. Worst pages from summary.pages (already sorted by total desc).
  const issuePages = summary.pages.filter((p) => (p.scorecard?.total ?? 0) > 0)
  const worstPages: ReportWorstPage[] = issuePages.slice(0, WORST_PAGES).map((p) => ({
    url: p.url,
    critical: p.scorecard?.critical ?? 0,
    serious: p.scorecard?.serious ?? 0,
    moderate: p.scorecard?.moderate ?? 0,
    minor: p.scorecard?.minor ?? 0,
    total: p.scorecard?.total ?? 0,
  }))

  // 9. PDFs with issues.
  let pdfsWithIssues = 0
  for (const pdf of audit.pdfAudits) {
    if (pdf.status !== 'complete') continue
    try {
      const issues = pdf.issues ? JSON.parse(pdf.issues) : []
      if (Array.isArray(issues) && issues.length > 0) pdfsWithIssues++
    } catch { /* unparseable issues — not counted */ }
  }

  // 10. Stamps.
  return {
    siteAuditId: audit.id,
    domain: audit.domain,
    clientName: audit.client?.name ?? null,
    wcagLevel: audit.wcagLevel,
    auditDate: (audit.completedAt ?? audit.createdAt).toISOString(),
    generatedAt: new Date().toISOString(),
    requestedBy: audit.requestedBy,
    score,
    compliant,
    archived,
    pagesTotal: audit.pagesTotal,
    pagesError: audit.pagesError,
    aggregate: summary.aggregate,
    archivedCounts: summary.archivedCounts ?? null,
    trend,
    diff: diffResult?.diff ?? null,
    previousCompletedAt: diffResult?.previous.completedAt ?? null,
    topIssues,
    worstPages,
    issuePagesTotal: issuePages.length,
    pdfsTotal: audit.pdfsTotal,
    pdfsWithIssues,
  }
}
