import { prisma } from '@/lib/db'
import AuditResultsView from '@/components/ada-audit/AuditResultsView'
import type { StoredAxeResults } from '@/lib/ada-audit/types'
import { computeScore } from '@/lib/ada-audit/scoring'
import { buildArchivedAxeResults } from '@/lib/ada-audit/findings-fallback'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ token: string }>
}

export default async function SharedAuditPage({ params }: Props) {
  const { token } = await params

  const audit = await prisma.adaAudit.findUnique({
    where: { shareToken: token },
    include: { client: { select: { name: true } } },
  })

  if (!audit || audit.status !== 'complete' || !audit.shareExpiresAt || audit.shareExpiresAt < new Date()) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-10 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-navy-light flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div>
            <p className="font-display font-bold text-[18px] text-navy dark:text-white">Audit not found or link expired</p>
            <p className="text-[13px] font-body text-navy/50 dark:text-white/50 mt-1">
              This shared link is no longer valid.
            </p>
          </div>
        </div>
      </main>
    )
  }

  let results: StoredAxeResults | null = null
  if (audit.result) {
    try {
      results = JSON.parse(audit.result) as StoredAxeResults
    } catch {
      return (
        <main className="max-w-5xl mx-auto px-6 py-10">
          <div className="bg-white dark:bg-navy-card border border-red-200 dark:border-red-500/30 rounded-2xl shadow-sm p-8 text-center">
            <p className="font-display font-bold text-[18px] text-navy dark:text-white">Result data is corrupted</p>
            <p className="text-[13px] font-body text-red-600 dark:text-red-400 mt-1">
              The stored result could not be parsed.
            </p>
          </div>
        </main>
      )
    }
  }

  // Pruned blob (C3): degraded view from Violation rows. Null when the audit
  // predates A2 — the legacy "No results available" card keeps rendering.
  let archivedScore: number | null = null
  if (!results) {
    results = await buildArchivedAxeResults(audit.id)
    if (results) {
      const run = await prisma.crawlRun.findUnique({ where: { adaAuditId: audit.id }, select: { score: true } })
      archivedScore = run?.score ?? null
    }
  }

  if (!results) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 text-center">
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50">No results available.</p>
        </div>
      </main>
    )
  }

  // Archived results carry capped node samples — node-based scoring would lie.
  // CrawlRun.score is the mapper-computed original; compliant = zero rows.
  const computed = computeScore(results.violations, audit.wcagLevel)
  const score = results.archived ? archivedScore ?? computed.score : computed.score
  const compliant = results.archived ? results.violations.length === 0 : computed.compliant

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      {/* Read-only notice */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl text-[12px] font-body text-blue-700 dark:text-blue-400">
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        This is a read-only shared view.
      </div>

      <AuditResultsView
        results={results}
        url={audit.url}
        clientName={audit.client?.name ?? null}
        createdAt={audit.createdAt.toISOString()}
        auditId={audit.id}
        wcagLevel={audit.wcagLevel}
        score={score}
        compliant={compliant}
        readOnly
        shareToken={token}
      />
    </main>
  )
}
