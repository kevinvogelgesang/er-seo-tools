// lib/findings/seo-findings-fallback.ts
//
// C5 findings-fallback (mirrors lib/ada-audit/findings-fallback.ts): rebuild
// a DEGRADED AggregatedResult from CrawlRun/CrawlPage/Finding rows once the
// Session.result blob is pruned. Degraded-by-contract: unknowns are OMITTED
// (render "—"/hidden), never fabricated as 0; arrays/objects the UI assumes
// always exist (safe shape). Run-centric so a future blob-less live-scan run
// renders through the same path.
import { prisma } from '@/lib/db'
import type { AggregatedResult, Issue, IssuesResult } from '@/lib/types'

interface RunFacts { pagesTotal: number; score: number | null; domain: string | null }
interface PageFacts { url: string; statusCode: number | null; wordCount: number | null; crawlDepth: number | null; indexable: boolean | null }
interface FindingFacts { scope: string; type: string; severity: string; url: string | null; count: number; affectedComplete: boolean | null; affectedSource: string | null; detail: string | null }
interface OriginContext { siteName: string | null; files: string[] }

const SEVERITY_TO_BUCKET = { critical: 'critical', warning: 'warnings', notice: 'notices' } as const

export function buildSeoResultFromRun(
  run: RunFacts,
  pages: PageFacts[],
  findings: FindingFacts[],
  origin: OriginContext,
): AggregatedResult {
  // --- crawl_summary ---
  const summary: AggregatedResult['crawl_summary'] = { total_urls: run.pagesTotal }
  const indexKnown = pages.filter((p) => p.indexable !== null)
  if (indexKnown.length > 0) {
    summary.indexable_urls = indexKnown.filter((p) => p.indexable === true).length
    summary.non_indexable_urls = indexKnown.filter((p) => p.indexable === false).length
  }
  const words = pages.map((p) => p.wordCount).filter((w): w is number => w !== null)
  if (words.length > 0) summary.avg_word_count = Math.round(words.reduce((a, b) => a + b, 0) / words.length)
  const depths = pages.map((p) => p.crawlDepth).filter((d): d is number => d !== null)
  if (depths.length > 0) {
    summary.avg_crawl_depth = Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 10) / 10
    summary.max_crawl_depth = Math.max(...depths)
  }
  // Status buckets are OPPORTUNISTIC: computed only when page status codes
  // exist (future live-scan pages carry them; SF-derived rows are null),
  // never inferred from issue types.
  const statuses = pages.map((p) => p.statusCode).filter((s): s is number => s !== null)
  if (statuses.length > 0) {
    summary.ok_responses = statuses.filter((s) => s >= 200 && s < 300).length
    summary.redirects = statuses.filter((s) => s >= 300 && s < 400).length
    summary.client_errors = statuses.filter((s) => s >= 400 && s < 500).length
    summary.server_errors = statuses.filter((s) => s >= 500).length
  }

  // --- issues: run-scope rows are authoritative; page-scope rows supply URLs ---
  const urlsByType = new Map<string, string[]>()
  for (const f of findings) {
    if (f.scope !== 'page' || !f.url) continue
    const list = urlsByType.get(f.type) ?? []
    list.push(f.url)
    urlsByType.set(f.type, list)
  }
  const issues: IssuesResult = { critical: [], warnings: [], notices: [] }
  for (const f of findings) {
    if (f.scope !== 'run') continue
    let description = ''
    try { description = JSON.parse(f.detail ?? '{}')?.description ?? '' } catch { /* keep '' */ }
    const issue: Issue = {
      type: f.type,
      severity: f.severity as Issue['severity'],
      count: f.count,
      description,
      urls: (urlsByType.get(f.type) ?? []).sort(),
    }
    if (f.affectedComplete !== null) issue.affectedUrlRefsComplete = f.affectedComplete
    if (f.affectedSource !== null) issue.affectedUrlSource = f.affectedSource as Issue['affectedUrlSource']
    const bucket = SEVERITY_TO_BUCKET[f.severity as keyof typeof SEVERITY_TO_BUCKET]
    if (bucket) issues[bucket].push(issue)
  }
  for (const bucket of Object.values(issues)) {
    bucket.sort((a: Issue, b: Issue) => b.count - a.count || a.type.localeCompare(b.type))
  }

  // --- site_structure: depth distribution is cheaply reconstructible ---
  const site_structure: AggregatedResult['site_structure'] = {}
  if (depths.length > 0) {
    const dist: Record<number, number> = {}
    for (const d of depths) dist[d] = (dist[d] ?? 0) + 1
    site_structure.crawl_depth_distribution = dist
  }

  return {
    crawl_summary: summary,
    issues,
    site_structure,
    resources: {},
    technical_seo: {},
    performance: {},
    recommendations: [],
    metadata: {
      files_processed: origin.files,
      parsers_used: [],
      total_parsers_available: 0,
      site_name: origin.siteName ?? run.domain ?? undefined,
      health_score: run.score ?? undefined,
    },
    archived: true,
    // completeness intentionally ABSENT: the builder never sets a verdict;
    // ResultsView suppresses its computeCompleteness() recompute when
    // result.archived — the archived banner replaces the completeness banner.
  }
}

/** Session-origin loader. Returns null when no CrawlRun exists (pre-A2). */
export async function loadArchivedSeoResult(sessionId: string): Promise<AggregatedResult | null> {
  const run = await prisma.crawlRun.findUnique({
    where: { sessionId },
    select: {
      pagesTotal: true, score: true, domain: true,
      pages: { select: { url: true, statusCode: true, wordCount: true, crawlDepth: true, indexable: true } },
      findings: { select: { scope: true, type: true, severity: true, url: true, count: true, affectedComplete: true, affectedSource: true, detail: true } },
    },
  })
  if (!run) return null
  // Origin context is loaded per run type — session origin here. A future
  // siteAudit-origin caller enriches from SiteAudit instead (never assume
  // a Session exists for every run).
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { siteName: true, files: true } })
  let files: string[] = []
  try {
    const p = JSON.parse(session?.files ?? '[]')
    files = Array.isArray(p) ? p : []
  } catch { files = [] }
  return buildSeoResultFromRun(run, run.pages, run.findings, { siteName: session?.siteName ?? null, files })
}
