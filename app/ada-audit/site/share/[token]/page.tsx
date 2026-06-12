import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import SiteAuditResultsView from '@/components/ada-audit/SiteAuditResultsView'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
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

  const crawlRun = await prisma.crawlRun.findUnique({ where: { siteAuditId: audit.id }, select: { score: true } })
  const fromCounts = computeScoreFromCounts(summary.aggregate, audit.wcagLevel)
  const score = crawlRun?.score ?? fromCounts.score

  const pdfs: AuditPdfRow[] = audit.pdfAudits.map((p) => {
    let issues: PdfIssue[] = []
    if (p.issues) {
      try { const parsed = JSON.parse(p.issues); if (Array.isArray(parsed)) issues = parsed as PdfIssue[] } catch { /* ignore */ }
    }
    return { url: p.url, fileSize: p.fileSize, pageCount: p.pageCount, issues, scanError: p.scanError ?? null }
  })

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div className="text-[13px] font-body text-navy/50 dark:text-white/50">
        Shared accessibility report — read-only
      </div>
      <SiteAuditResultsView
        domain={audit.domain}
        clientName={audit.client?.name ?? null}
        createdAt={audit.createdAt.toISOString()}
        pagesTotal={audit.pagesTotal}
        pagesError={audit.pagesError}
        summary={summary}
        wcagLevel={audit.wcagLevel}
        score={score}
        compliant={fromCounts.compliant}
        pdfs={pdfs}
        siteAuditId={audit.id}
        shareMode
      />
    </main>
  )
}
