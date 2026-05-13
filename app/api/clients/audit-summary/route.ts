// app/api/clients/audit-summary/route.ts
//
// Fetches every client and joins their most recent complete SiteAudit.
// Used by the Clients section on /ada-audit to show one row per client.
//
// Score is derived from summary.aggregate via computeScoreFromCounts (same
// as /api/site-audit). SiteAudit.score is not persisted by the queue, so
// reading `a.score` directly would always be null on freshly-completed audits.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { ClientAuditSummary, SiteAuditSummary } from '@/lib/ada-audit/types'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'

export const dynamic = 'force-dynamic'

export async function GET() {
  const clients = await prisma.client.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, domains: true },
  })

  // ~30 clients, indexed on (clientId, createdAt) — per-client findFirst is
  // fast enough. Avoids a SQLite-incompatible window-function approach.
  const summaries: ClientAuditSummary[] = await Promise.all(
    clients.map(async (c) => {
      const latest = await prisma.siteAudit.findFirst({
        where: { clientId: c.id, status: 'complete' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          pagesTotal: true,
          pagesError: true,
          wcagLevel: true,
          summary: true,
        },
      })

      let domains: string[] = []
      try { domains = JSON.parse(c.domains) } catch { /* keep [] */ }

      let parsedSummary: SiteAuditSummary | null = null
      let score: number | null = null
      if (latest?.summary) {
        try {
          parsedSummary = JSON.parse(latest.summary) as SiteAuditSummary
          const agg = parsedSummary?.aggregate
          if (agg) score = computeScoreFromCounts(agg, latest.wcagLevel).score
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
          pagesTotal: latest.pagesTotal,
          pagesError: latest.pagesError,
          summary: parsedSummary,
        } : null,
      }
    }),
  )

  return NextResponse.json(summaries)
}
