import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import AuditResultsView from '@/components/ada-audit/AuditResultsView'
import AuditPoller from '@/components/ada-audit/AuditPoller'
import ReScanButton from '@/components/ada-audit/ReScanButton'
import type { StoredAxeResults, AuditPdfRow } from '@/lib/ada-audit/types'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'
import { computeScore } from '@/lib/ada-audit/scoring'
import { computeComplianceV2 } from '@/lib/ada-audit/scoring-v2'
import { resolveDisplayScore } from '@/lib/ada-audit/display-score'
import { buildArchivedAxeResults } from '@/lib/ada-audit/findings-fallback'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}

export default async function AdaAuditResultPage({ params, searchParams }: Props) {
  const { id } = await params
  const { from } = await searchParams

  const audit = await prisma.adaAudit.findUnique({
    where: { id },
    include: {
      client: { select: { name: true } },
      pdfAudits: {
        select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true },
      },
      crawlRun: { select: { score: true, scoreBreakdown: true } },
    },
  })

  if (!audit) notFound()

  // Fetch previous audit score when this page was reached via Re-scan.
  // Validate the `from` param is a CUID-shaped string before using it in a query.
  const fromId = typeof from === 'string' && /^[a-z0-9]{20,30}$/.test(from) ? from : undefined
  let previousScore: number | null = null
  if (fromId) {
    const prev = await prisma.adaAudit.findUnique({
      where: { id: fromId },
      select: { result: true, wcagLevel: true, crawlRun: { select: { score: true } } },
    })
    previousScore = prev?.crawlRun?.score ?? null
    if (previousScore === null && prev?.result) {
      try {
        const prevResults = JSON.parse(prev.result) as StoredAxeResults
        previousScore = computeScore(prevResults.violations, prev.wcagLevel ?? 'wcag21aa').score
      } catch { /* malformed result — leave null */ }
    }
  }

  const breadcrumb = (
    <div className="flex items-center gap-2 text-[13px] font-body text-navy/50 dark:text-white/50">
      <Link href="/ada-audit" className="hover:text-orange transition-colors">ADA Audit</Link>
      <span>/</span>
      <span className="text-navy/80 dark:text-white/80 truncate max-w-xs" title={audit.url}>
        {audit.url.replace(/^https?:\/\//, '')}
      </span>
    </div>
  )

  // ── Pending / running: show spinner + start polling ──────────────────────────
  if (audit.status === 'pending' || audit.status === 'running' || audit.status === 'axe-complete') {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <AuditPoller
          id={id}
          url={audit.url}
          createdAt={audit.createdAt.toISOString()}
          initialStatus={audit.status}
          initialProgress={audit.progress ?? 0}
          initialProgressMessage={audit.progressMessage ?? ''}
        />
      </main>
    )
  }

  // ── Redirected state ─────────────────────────────────────────────────────────
  if (audit.status === 'redirected' && audit.finalUrl) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div className="rounded-2xl border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-6">
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white mb-2">
            Page redirected
          </h2>
          <p className="text-[13px] font-body text-navy/70 dark:text-white/70">
            {audit.url} redirects to{' '}
            <a
              href={audit.finalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange hover:underline"
            >
              {audit.finalUrl}
            </a>
            . No accessibility scan was run — re-submit the final URL above to audit the destination.
          </p>
        </div>
      </main>
    )
  }

  // ── Error state ──────────────────────────────────────────────────────────────
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
            <p className="font-display font-bold text-[18px] text-navy dark:text-white">Audit failed</p>
            <p className="text-[13px] font-body text-red-600 dark:text-red-400 mt-1">{audit.error ?? 'An unknown error occurred'}</p>
            <p className="text-[12px] font-body text-navy/40 dark:text-white/40 mt-2 break-all">{audit.url}</p>
          </div>
          <div className="mt-2">
            <ReScanButton url={audit.url} wcagLevel={audit.wcagLevel} auditId={id} />
          </div>
        </div>
      </main>
    )
  }

  // ── Complete: parse results ──────────────────────────────────────────────────
  let results: StoredAxeResults | null = null
  if (audit.result) {
    try {
      results = JSON.parse(audit.result) as StoredAxeResults
    } catch {
      // Malformed JSON in DB — treat as error
      return (
        <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
          {breadcrumb}
          <div className="bg-white dark:bg-navy-card border border-red-200 dark:border-red-500/30 rounded-2xl shadow-sm p-8 text-center">
            <p className="font-display font-bold text-[18px] text-navy dark:text-white">Result data is corrupted</p>
            <p className="text-[13px] font-body text-red-600 dark:text-red-400 mt-1">
              The stored result could not be parsed. Please run the audit again.
            </p>
          </div>
        </main>
      )
    }
  }

  // Pruned blob (C3): degraded view from Violation rows. Null when the audit
  // predates A2 — the legacy "No results available" card keeps rendering.
  let archivedScore: number | null = null
  if (!results && audit.status === 'complete') {
    results = await buildArchivedAxeResults(id)
    if (results) {
      const run = await prisma.crawlRun.findUnique({ where: { adaAuditId: id }, select: { score: true } })
      archivedScore = run?.score ?? null
    }
  }

  if (!results) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 text-center">
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50">No results available.</p>
        </div>
      </main>
    )
  }

  // Prefer the persisted CrawlRun score + its version; fall back to the frozen
  // v1 formula only when nothing was persisted. Archived blobs carry capped
  // node samples — node-based v1 recompute would lie, so the fallback path
  // uses the mapper-computed archivedScore there instead.
  const { score, version, fromFallback } = resolveDisplayScore({
    persistedScore: audit.crawlRun?.score ?? null,
    scoreBreakdown: audit.crawlRun?.scoreBreakdown ?? null,
    recompute: () => (results.archived ? archivedScore ?? null : computeScore(results.violations, audit.wcagLevel).score),
  })
  // Compliance follows the score's version: v2 = no WCAG-conformance violation
  // (advisory best-practice findings don't break it); v1 fallback keeps the
  // legacy "zero violations" notion.
  const compliant = version >= 2
    ? computeComplianceV2(results.violations)
    : (results.archived ? results.violations.length === 0 : computeScore(results.violations, audit.wcagLevel).compliant)
  // C13: archived results synthesize passes/incomplete as [] — archivedCounts
  // is the truth there (an empty array must not shadow it as a literal 0).
  // Live results prefer the passCount scalar (post-C13 trimmed blobs).
  const passCount = results.archived
    ? results.archivedCounts?.passed ?? null
    : results.passCount ?? results.passes?.length ?? null
  const incompleteCount = results.archived
    ? results.archivedCounts?.incomplete ?? null
    : results.incomplete?.length ?? null

  // Parse Lighthouse summary (tolerant of malformed JSON)
  let lighthouseSummary: LighthouseSummary | null = null
  if (audit.lighthouseSummary) {
    try {
      lighthouseSummary = JSON.parse(audit.lighthouseSummary) as LighthouseSummary
    } catch {
      lighthouseSummary = null
    }
  }

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
      <AuditResultsView
        results={results}
        url={audit.url}
        clientName={audit.client?.name ?? null}
        createdAt={audit.createdAt.toISOString()}
        auditId={id}
        wcagLevel={audit.wcagLevel}
        score={score ?? undefined}
        compliant={compliant}
        previousScore={previousScore}
        fromAuditId={fromId ?? null}
        showRescan
        lighthouseSummary={lighthouseSummary}
        lighthouseError={audit.lighthouseError ?? null}
        pdfs={pdfs}
        scoreMeta={{ version, fromFallback, passCount, incompleteCount }}
      />
    </main>
  )
}
