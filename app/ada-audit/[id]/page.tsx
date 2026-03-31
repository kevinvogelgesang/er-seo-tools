import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import AuditResultsView from '@/components/ada-audit/AuditResultsView'
import AuditPoller from '@/components/ada-audit/AuditPoller'
import type { StoredAxeResults } from '@/lib/ada-audit/types'
import { computeScore } from '@/lib/ada-audit/scoring'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AdaAuditResultPage({ params }: Props) {
  const { id } = await params

  const audit = await prisma.adaAudit.findUnique({
    where: { id },
    include: { client: { select: { name: true } } },
  })

  if (!audit) notFound()

  const breadcrumb = (
    <div className="flex items-center gap-2 text-[13px] font-body text-navy/50">
      <Link href="/ada-audit" className="hover:text-orange transition-colors">ADA Audit</Link>
      <span>/</span>
      <span className="text-navy/80 truncate max-w-xs" title={audit.url}>
        {audit.url.replace(/^https?:\/\//, '')}
      </span>
    </div>
  )

  // ── Pending / running: show spinner + start polling ──────────────────────────
  if (audit.status === 'pending' || audit.status === 'running') {
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

  // ── Error state ──────────────────────────────────────────────────────────────
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
            <p className="font-display font-bold text-[18px] text-navy">Audit failed</p>
            <p className="text-[13px] font-body text-red-600 mt-1">{audit.error ?? 'An unknown error occurred'}</p>
            <p className="text-[12px] font-body text-navy/40 mt-2 break-all">{audit.url}</p>
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
          <div className="bg-white border border-red-200 rounded-2xl shadow-sm p-8 text-center">
            <p className="font-display font-bold text-[18px] text-navy">Result data is corrupted</p>
            <p className="text-[13px] font-body text-red-600 mt-1">
              The stored result could not be parsed. Please run the audit again.
            </p>
          </div>
        </main>
      )
    }
  }

  if (!results) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <p className="text-[13px] font-body text-navy/50">No results available.</p>
        </div>
      </main>
    )
  }

  const { score, compliant } = computeScore(results.violations, audit.wcagLevel)

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
        score={score}
        compliant={compliant}
      />
    </main>
  )
}
