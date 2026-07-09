// app/api/clients/audit-summary/route.ts
//
// Fetches every client and joins their most recent complete SiteAudit.
// Used by the Clients section on /ada-audit to show one row per client.
//
// Score prefers CrawlRun.score (mapper-computed, survives blob pruning) and
// falls back to summary.aggregate via computeScoreFromCounts for pre-A2
// audits (same as /api/site-audit). SiteAudit.score is not persisted by the
// queue, so reading `a.score` directly would always be null on
// freshly-completed audits.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { ClientAuditSummary, SiteAuditSummary } from '@/lib/ada-audit/types'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'

export const dynamic = 'force-dynamic'

export async function GET() {
  const clients = await prisma.client.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, domains: true },
  })

  // ~30 clients, indexed on (clientId, createdAt) — per-client findFirst is
  // fast enough. Avoids a SQLite-incompatible window-function approach.
  const summaries: ClientAuditSummary[] = await Promise.all(
    clients.map(async (c) => {
      const latest = await prisma.siteAudit.findFirst({
        // C11: exclude seoOnly audits — this table shows the latest *ADA* site
        // audit per client (null ADA score + deep-link to /ada-audit/site/[id]).
        where: { clientId: c.id, status: 'complete', seoOnly: false },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          pagesTotal: true,
          pagesError: true,
          wcagLevel: true,
          summary: true,
          // C18: load ADA + live-scan runs so the clients view can show both
          // the accessibility score and the live SEO score (both coexist on the
          // same SiteAudit via the C6 compound unique).
          crawlRuns: { select: { tool: true, source: true, score: true } },
        },
      })

      let domains: string[] = []
      try { domains = JSON.parse(c.domains) } catch { /* keep [] */ }

      // C3: CrawlRun.score is the canonical score (same formula, mapper-
      // computed); the summary blob is only the pre-A2 fallback and may be
      // pruned (null) — consumers must tolerate a null summary.
      let parsedSummary: SiteAuditSummary | null = null
      const adaRun = latest?.crawlRuns.find((r) => r.tool === 'ada-audit')
      // C18 (Codex #5): match BOTH tool and source, not source alone.
      const liveRun = latest?.crawlRuns.find((r) => r.tool === 'seo-parser' && r.source === 'live-scan')
      let score: number | null = adaRun?.score ?? null
      const seoScore: number | null = liveRun?.score ?? null
      if (latest?.summary) {
        try {
          parsedSummary = JSON.parse(latest.summary) as SiteAuditSummary
          const agg = parsedSummary?.aggregate
          if (score === null && agg) score = computeScoreFromCounts(agg, latest.wcagLevel).score
        } catch { parsedSummary = null }
      }

      return {
        clientId: c.id,
        clientName: c.name,
        firstDomain: domains[0] ?? null,
        latestSiteAudit: latest ? {
          id: latest.id,
          createdAt: latest.createdAt.toISOString(),
          score,
          seoScore,
          pagesTotal: latest.pagesTotal,
          pagesError: latest.pagesError,
          summary: parsedSummary,
        } : null,
      }
    }),
  )

  return NextResponse.json(summaries)
}
