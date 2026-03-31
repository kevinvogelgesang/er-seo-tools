import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import SiteAuditPoller from '@/components/ada-audit/SiteAuditPoller'
import SiteAuditResultsView from '@/components/ada-audit/SiteAuditResultsView'
import type { SiteAuditSummary } from '@/lib/ada-audit/types'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function SiteAuditResultPage({ params }: Props) {
  const { id } = await params

  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    include: { client: { select: { name: true } } },
  })

  if (!audit) notFound()

  const breadcrumb = (
    <div className="flex items-center gap-2 text-[13px] font-body text-navy/50">
      <Link href="/ada-audit" className="hover:text-orange transition-colors">ADA Audit</Link>
      <span>/</span>
      <span className="text-navy/80">Site — {audit.domain}</span>
    </div>
  )

  // ── Pending / running ────────────────────────────────────────────────────────
  if (audit.status === 'pending' || audit.status === 'running') {
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

  // ── Error ────────────────────────────────────────────────────────────────────
  if (audit.status === 'error') {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div className="bg-white border border-red-200 rounded-2xl shadow-sm p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div>
            <p className="font-display font-bold text-[18px] text-navy">Site audit failed</p>
            <p className="text-[13px] font-body text-red-600 mt-1">{audit.error ?? 'An unknown error occurred'}</p>
            <p className="text-[12px] font-body text-navy/40 mt-1">{audit.domain}</p>
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

  if (!summary) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <p className="text-[13px] font-body text-navy/50">Result data is unavailable. Please run the audit again.</p>
        </div>
      </main>
    )
  }

  const { score, compliant } = computeScoreFromCounts(summary.aggregate, audit.wcagLevel)

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      {breadcrumb}
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
      />
    </main>
  )
}
