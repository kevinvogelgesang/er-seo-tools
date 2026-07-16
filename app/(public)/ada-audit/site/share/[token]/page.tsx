import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import SiteAuditResultsView from '@/components/ada-audit/SiteAuditResultsView'
import SiteAuditResultsShell from '@/components/ada-audit/SiteAuditResultsShell'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import { parseScoreVersion } from '@/lib/scoring/breakdown-version'
import { BrokenLinksSection } from '@/components/site-audit/BrokenLinksSection'
import { OnPageSeoSection } from '@/components/site-audit/OnPageSeoSection'
import { TechnicalSeoSection } from '@/components/site-audit/TechnicalSeoSection'
import { DiscoveryCoverageSection } from '@/components/site-audit/DiscoveryCoverageSection'
import { ReachabilitySection } from '@/components/site-audit/ReachabilitySection'
import { ContentSimilaritySection } from '@/components/site-audit/ContentSimilaritySection'
import { SeoPhaseBanner } from '@/components/site-audit/SeoPhaseBanner'
import SeoUnavailableNotice from '@/components/site-audit/SeoUnavailableNotice'
import { classifySeoPhase, getLatestSeoVerifyJob } from '@/lib/ada-audit/seo-phase'
import { isPlaceholderRun } from '@/lib/findings/exhausted-placeholder'
import type { SiteAuditSummary, AuditPdfRow } from '@/lib/ada-audit/types'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'

export const dynamic = 'force-dynamic'

export default async function SharedSiteAuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { shareToken: token },
    include: {
      client: { select: { name: true } },
      pdfAudits: { select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true } },
    },
  })
  if (!audit || audit.status !== 'complete') notFound()
  if (!audit.shareExpiresAt || audit.shareExpiresAt <= new Date()) notFound()

  let summary: SiteAuditSummary | null = null
  if (audit.summary) {
    try { summary = JSON.parse(audit.summary) as SiteAuditSummary } catch { /* corrupted */ }
  }
  if (!summary) summary = await buildSummaryFromFindings(audit.id)
  if (!summary) notFound() // pre-A2 complete with no blob — nothing renderable publicly

  const crawlRun = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'ada-audit' } }, select: { score: true, scoreBreakdown: true } })
  const fromCounts = computeScoreFromCounts(summary.aggregate, audit.wcagLevel)
  const score = crawlRun?.score ?? fromCounts.score
  const scoreVersion = parseScoreVersion(crawlRun?.scoreBreakdown ?? null)
  const scoreFromFallback = crawlRun?.score == null
  const sitePassCount = summary.archived ? summary.archivedCounts?.passed ?? null : summary.aggregate.passed
  const siteIncompleteCount = summary.archived ? summary.archivedCounts?.incomplete ?? null : summary.aggregate.incomplete

  // C18: load the SEO tab data server-side (share view keeps its
  // zero-cookie-gated-fetch rule — the six SEO sections are prop-driven server
  // components). Codex #6: this — and the getLatestSeoVerifyJob call — MUST run
  // only after the token status/expiry guards above.
  const liveScanRun = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'seo-parser' } },
    select: {
      id: true, status: true, source: true, score: true, scoreBreakdown: true,
      discoveryCoverageJson: true, reachabilityJson: true, contentSimilarityJson: true,
      findings: { select: { scope: true, type: true, count: true, url: true, detail: true } },
      pages: { select: { statusCode: true, indexable: true } },
    },
  })
  const observedPages = liveScanRun?.pages.filter((p) => p.statusCode != null).length ?? 0
  const indexablePages = liveScanRun?.pages.filter((p) => p.indexable === true).length ?? 0
  const onPageAnalyzed = observedPages > 0
  const seoPhase = liveScanRun
    ? ({ state: 'done', progress: null, message: null } as const)
    : classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(audit.id), completedAt: audit.completedAt })

  const pdfs: AuditPdfRow[] = audit.pdfAudits.map((p) => {
    let issues: PdfIssue[] = []
    if (p.issues) {
      try { const parsed = JSON.parse(p.issues); if (Array.isArray(parsed)) issues = parsed as PdfIssue[] } catch { /* ignore */ }
    }
    return { url: p.url, fileSize: p.fileSize, pageCount: p.pageCount, issues, scanError: p.scanError ?? null }
  })

  // Codex plan-fix #3: an exhausted-verifier placeholder run must not let ANY
  // SEO section render a misleading empty/"pre-dates analysis" state — one
  // page-level branch replaces the whole stack (share view must never render
  // misleading empty SEO sections for a placeholder either).
  const liveScanUnavailable = liveScanRun != null && isPlaceholderRun(liveScanRun)
  const seoContent = liveScanUnavailable ? (
    <SeoUnavailableNotice />
  ) : liveScanRun ? (
    <>
      <BrokenLinksSection run={liveScanRun} />
      <OnPageSeoSection
        run={liveScanRun}
        analyzed={onPageAnalyzed}
        score={liveScanRun?.score ?? null}
        observed={observedPages}
        indexable={indexablePages}
        attempted={audit.pagesTotal}
        breakdown={liveScanRun?.scoreBreakdown ?? null}
      />
      <TechnicalSeoSection run={liveScanRun} analyzed={onPageAnalyzed} />
      <DiscoveryCoverageSection run={liveScanRun} />
      <ReachabilitySection run={liveScanRun} />
      <ContentSimilaritySection run={liveScanRun} />
    </>
  ) : (
    <SeoPhaseBanner phase={seoPhase} />
  )

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div className="text-[13px] font-body text-navy/50 dark:text-white/50">
        Shared accessibility report — read-only
      </div>
      <Suspense fallback={null}>
        <SiteAuditResultsShell
          domain={audit.domain}
          clientName={audit.client?.name ?? null}
          createdAt={audit.createdAt.toISOString()}
          pagesTotal={audit.pagesTotal}
          pagesError={audit.pagesError}
          wcagLevel={audit.wcagLevel}
          adaScore={score}
          seoScore={liveScanRun?.score ?? null}
          accessibility={
            <SiteAuditResultsView
              domain={audit.domain}
              summary={summary}
              wcagLevel={audit.wcagLevel}
              score={score}
              compliant={fromCounts.compliant}
              pdfs={pdfs}
              siteAuditId={audit.id}
              shareMode
              scoreMeta={{ version: scoreVersion, fromFallback: scoreFromFallback, passCount: sitePassCount, incompleteCount: siteIncompleteCount }}
            />
          }
          seo={seoContent}
          shareMode
        />
      </Suspense>
    </main>
  )
}
