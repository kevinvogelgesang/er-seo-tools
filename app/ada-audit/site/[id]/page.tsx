import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import SiteAuditPoller from '@/components/ada-audit/SiteAuditPoller'
import SiteAuditResultsView from '@/components/ada-audit/SiteAuditResultsView'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { getSiteAuditInstanceDiff } from '@/lib/services/site-audit-diff'
import SiteAuditDiffPanel from '@/components/ada-audit/SiteAuditDiffPanel'
import { BrokenLinksSection } from '@/components/site-audit/BrokenLinksSection'
import { OnPageSeoSection } from '@/components/site-audit/OnPageSeoSection'
import SiteAuditExportBar from '@/components/ada-audit/SiteAuditExportBar'
import { reportFileExists } from '@/lib/report/report-file'
import type { SiteAuditSummary, AuditPdfRow } from '@/lib/ada-audit/types'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function SiteAuditResultPage({ params }: Props) {
  const { id } = await params

  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    include: {
      client: { select: { name: true } },
      pdfAudits: {
        select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true },
      },
    },
  })

  if (!audit) notFound()

  const breadcrumb = (
    <div className="flex items-center gap-2 text-[13px] font-body text-navy/50 dark:text-white/50">
      <Link href="/ada-audit" className="hover:text-orange transition-colors">ADA Audit</Link>
      <span>/</span>
      <span className="text-navy/80 dark:text-white/80">Site — {audit.domain}</span>
    </div>
  )

  // ── Queued / Pending / running ────────────────────────────────────────────────
  if (
    audit.status === 'queued' ||
    audit.status === 'pending' ||
    audit.status === 'running' ||
    audit.status === 'pdfs-running' ||
    audit.status === 'lighthouse-running'
  ) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <SiteAuditPoller
          id={id}
          initialStatus={audit.status}
          initialPagesTotal={audit.pagesTotal}
          initialPagesComplete={audit.pagesComplete}
          initialPagesError={audit.pagesError}
        />
      </main>
    )
  }

  // ── Cancelled ─────────────────────────────────────────────────────────────────
  if (audit.status === 'cancelled') {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div className="bg-white dark:bg-navy-card border border-slate-200 dark:border-slate-500/30 rounded-2xl shadow-sm p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-500/15 flex items-center justify-center">
            <svg className="w-6 h-6 text-slate-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728A9 9 0 015.636 5.636" />
            </svg>
          </div>
          <div>
            <p className="font-display font-bold text-[18px] text-navy dark:text-white">Site audit cancelled</p>
            <p className="text-[13px] font-body text-navy/50 dark:text-white/50 mt-1">This audit was cancelled before it ran.</p>
            <p className="text-[12px] font-body text-navy/40 dark:text-white/40 mt-1">{audit.domain}</p>
          </div>
          <Link
            href="/ada-audit"
            className="mt-2 px-4 py-2 bg-orange hover:bg-orange-light text-white font-body font-semibold text-[13px] rounded-lg transition-colors"
          >
            Re-queue
          </Link>
        </div>
      </main>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (audit.status === 'error') {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div className="bg-white dark:bg-navy-card border border-red-200 dark:border-red-500/30 rounded-2xl shadow-sm p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-500/15 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div>
            <p className="font-display font-bold text-[18px] text-navy dark:text-white">Site audit failed</p>
            <p className="text-[13px] font-body text-red-600 dark:text-red-400 mt-1">{audit.error ?? 'An unknown error occurred'}</p>
            <p className="text-[12px] font-body text-navy/40 dark:text-white/40 mt-1">{audit.domain}</p>
          </div>
          <Link
            href="/ada-audit"
            className="mt-2 px-4 py-2 bg-orange hover:bg-orange-light text-white font-body font-semibold text-[13px] rounded-lg transition-colors"
          >
            Try again
          </Link>
        </div>
      </main>
    )
  }

  // ── Complete ─────────────────────────────────────────────────────────────────
  let summary: SiteAuditSummary | null = null
  if (audit.summary) {
    try { summary = JSON.parse(audit.summary) as SiteAuditSummary } catch { /* corrupted */ }
  }
  // Pruned blob (C3): degraded summary from findings tables. Null when no
  // CrawlRun exists (pre-A2) — the legacy "unavailable" card keeps rendering.
  if (!summary) summary = await buildSummaryFromFindings(audit.id)

  if (!summary) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 text-center">
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50">Result data is unavailable. Please run the audit again.</p>
        </div>
      </main>
    )
  }

  // Prefer the run score (identical formula, mapper-computed) so archived
  // (capped-pass) aggregates can't shift it; counts still drive compliance.
  const crawlRun = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'ada-audit' } }, select: { score: true } })
  const fromCounts = computeScoreFromCounts(summary.aggregate, audit.wcagLevel)
  const score = crawlRun?.score ?? fromCounts.score
  const compliant = fromCounts.compliant

  // Changes-since-previous panel — null hides it (no earlier same-domain
  // same-level run, or this audit predates the findings layer).
  const instanceDiff = await getSiteAuditInstanceDiff(audit.id)

  // C6: the out-of-band broken-link verifier writes a live-scan seo-parser run.
  // null = not yet verified (the section renders that state).
  const liveScanRun = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'seo-parser' } },
    select: {
      status: true,
      findings: { select: { scope: true, type: true, count: true, url: true, detail: true } },
      // Phase-2 marker: on-page extraction populates statusCode on every page it
      // writes; pre-Phase-2 runs have only broken-link source pages (statusCode null).
      pages: { where: { statusCode: { not: null } }, select: { id: true }, take: 1 },
    },
  })
  const onPageAnalyzed = !!liveScanRun && liveScanRun.pages.length > 0

  // Report button starts 'ready' only when the stamp AND the file agree
  // (Codex fix: never trust the column alone — retention may have deleted the PDF).
  const initialReportGeneratedAt =
    audit.reportGeneratedAt && (await reportFileExists(audit.id))
      ? audit.reportGeneratedAt.toISOString()
      : null

  const pdfs: AuditPdfRow[] = audit.pdfAudits.map((p) => {
    let issues: PdfIssue[] = []
    if (p.issues) {
      try {
        const parsed = JSON.parse(p.issues)
        if (Array.isArray(parsed)) issues = parsed as PdfIssue[]
      } catch {
        issues = []
      }
    }
    return {
      url: p.url,
      fileSize: p.fileSize,
      pageCount: p.pageCount,
      issues,
      scanError: p.scanError ?? null,
    }
  })

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      {breadcrumb}
      <SiteAuditExportBar
        siteAuditId={audit.id}
        hasPrevious={instanceDiff !== null}
        initialReportGeneratedAt={initialReportGeneratedAt}
      />
      {instanceDiff && <SiteAuditDiffPanel diff={instanceDiff.diff} previous={instanceDiff.previous} />}
      <BrokenLinksSection run={liveScanRun} />
      <OnPageSeoSection run={liveScanRun} analyzed={onPageAnalyzed} />
      <SiteAuditResultsView
        domain={audit.domain}
        clientName={audit.client?.name ?? null}
        createdAt={audit.createdAt.toISOString()}
        pagesTotal={audit.pagesTotal}
        pagesError={audit.pagesError}
        summary={summary}
        wcagLevel={audit.wcagLevel}
        score={score}
        compliant={compliant}
        pdfs={pdfs}
        siteAuditId={audit.id}
      />
    </main>
  )
}
