// lib/notify/enrichment.ts
// D7 enrichment loader for the completion email. Pure reads of normalized tables
// (Finding / CrawlRun / SiteAudit) — no blobs. Every count is independently
// nullable: null = run absent (unknown), never 0. Caller wraps this in a
// deadline-bounded try/catch; a throw here degrades the email to base fields,
// never blocks the send.

import { prisma } from '@/lib/db'
import { parseScoreVersion } from '@/lib/scoring/breakdown-version'
import { getSiteAuditInstanceDiff } from '@/lib/services/site-audit-diff'

const ON_PAGE_TYPES = ['missing_title', 'missing_h1', 'missing_meta_description', 'thin_content',
  'duplicate_title', 'duplicate_meta_description', 'duplicate_h1']
const BROKEN_HEADLINE_TYPES = ['broken_internal_links', 'broken_images']

type Run = {
  id: string; tool: string; source: string; status: string
  score: number | null; scoreBreakdown: string | null
  domain: string | null; completedAt: Date | null; createdAt: Date
}
export interface EnrichAuditInput {
  id: string; domain: string; seoOnly: boolean
  pagesComplete: number; pagesTotal: number; crawlRuns: Run[]
}
export interface CompleteEnrichment {
  pagesComplete: number; pagesTotal: number
  counts: { brokenLinks: number | null; onPageIssues: number | null; adaViolations: number | null }
  partial: { seo: boolean; ada: boolean }
  change: { seoDelta: number | null; adaDelta: number | null; newIssues: number | null; resolvedIssues: number | null; previousDate: string | null }
}

const stamp = (r: { completedAt: Date | null; createdAt: Date }) => (r.completedAt ?? r.createdAt).getTime()

async function sumRunScope(runId: string, types: string[]): Promise<number> {
  const agg = await prisma.finding.aggregate({ _sum: { count: true }, where: { runId, scope: 'run', type: { in: types } } })
  return agg._sum.count ?? 0
}

export async function loadCompleteEnrichment(audit: EnrichAuditInput): Promise<CompleteEnrichment> {
  const live = audit.crawlRuns.find((r) => r.tool === 'seo-parser' && r.source === 'live-scan') ?? null
  const ada = audit.crawlRuns.find((r) => r.tool === 'ada-audit') ?? null

  const counts = {
    brokenLinks: live ? await sumRunScope(live.id, BROKEN_HEADLINE_TYPES) : null,
    onPageIssues: live ? await sumRunScope(live.id, ON_PAGE_TYPES) : null,
    adaViolations: ada ? await prisma.finding.count({ where: { runId: ada.id, scope: 'page' } }) : null,
  }
  const partial = { seo: live?.status === 'partial', ada: ada?.status === 'partial' }

  // --- change vs last scan ---
  let seoDelta: number | null = null
  let adaDelta: number | null = null
  let newIssues: number | null = null
  let resolvedIssues: number | null = null
  let previousDate: string | null = null

  // Baseline dates are tracked PER delta — ADA and SEO can compare against
  // different prior scans (SEO-only scans between full audits). A single strip
  // date is shown only when the present baselines agree.
  let adaDate: string | null = null
  let seoDate: string | null = null

  // ADA new/resolved + ADA score delta (full audits only; diff is ADA-anchored)
  const diff = await getSiteAuditInstanceDiff(audit.id)
  if (diff) {
    // newCount already partitions into regressedCount + newPageCount — do NOT
    // add newPageCount (verified findings-shared.ts:270-272).
    newIssues = diff.diff.newCount
    resolvedIssues = diff.diff.resolvedCount
    adaDate = diff.previous.completedAt ? new Date(diff.previous.completedAt).toISOString().slice(0, 10) : null
    if (ada?.score != null) {
      // Load the previous ADA run by its exact run id.
      const prevAda = await prisma.crawlRun.findUnique({
        where: { id: diff.previous.runId },
        select: { score: true, scoreBreakdown: true },
      })
      if (prevAda?.score != null && parseScoreVersion(ada.scoreBreakdown) === parseScoreVersion(prevAda.scoreBreakdown)) {
        adaDelta = ada.score - prevAda.score
      }
    }
  }

  // SEO score delta — deterministic earlier same-domain live-scan run, non-null scores
  if (live?.score != null) {
    const host = live.domain ?? audit.domain
    const cands = await prisma.crawlRun.findMany({
      where: { tool: 'seo-parser', source: 'live-scan', domain: host, score: { not: null }, id: { not: live.id } },
      select: { id: true, score: true, scoreBreakdown: true, completedAt: true, createdAt: true },
    })
    const cur = live
    const prev = cands
      .filter((c) => stamp(c) < stamp(cur) || (stamp(c) === stamp(cur) && c.id.localeCompare(cur.id) < 0))
      .sort((a, b) => stamp(b) - stamp(a) || b.id.localeCompare(a.id))[0] ?? null
    if (prev?.score != null && parseScoreVersion(live.scoreBreakdown) === parseScoreVersion(prev.scoreBreakdown)) {
      seoDelta = live.score - prev.score
      seoDate = (prev.completedAt ?? prev.createdAt).toISOString().slice(0, 10)
    }
  }

  // Reconcile: show a date only when every present baseline agrees.
  const dates = [adaDate, seoDate].filter((d): d is string => d != null)
  previousDate = dates.length > 0 && dates.every((d) => d === dates[0]) ? dates[0] : null

  return { pagesComplete: audit.pagesComplete, pagesTotal: audit.pagesTotal, counts, partial,
    change: { seoDelta, adaDelta, newIssues, resolvedIssues, previousDate } }
}
