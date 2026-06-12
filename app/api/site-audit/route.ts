import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { SiteAuditDetail } from '@/lib/ada-audit/types'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ─── POST /api/site-audit ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const domain = typeof raw?.domain === 'string' ? raw.domain.trim() : ''
  const clientId = typeof raw?.clientId === 'number' ? raw.clientId : null
  const wcagLevel = typeof raw?.wcagLevel === 'string' && raw.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  const rawPreDiscoveredUrls = Array.isArray(raw?.urls)
    ? (raw.urls as string[]).filter((u) => typeof u === 'string')
    : undefined

  if (clientId !== null) {
    // findFirst, not findUnique — archived clients are rejected like missing ones
    const client = await prisma.client.findFirst({ where: { id: clientId, archivedAt: null }, select: { id: true } })
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 400 })
    }
  }

  const requestedBy = sanitizeOperatorName(request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value)

  const result = await queueSiteAuditRequest({
    domain,
    clientId,
    wcagLevel,
    preDiscoveredUrls: rawPreDiscoveredUrls,
    requestedBy,
  })

  if (result.kind === 'invalid') {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }
  if (result.kind === 'duplicate') {
    // Read the in-flight row to surface the existing domain in the response
    // body, preserving the original 409 shape for any existing callers.
    const existing = await prisma.siteAudit.findUnique({
      where: { id: result.existingId },
      select: { domain: true },
    })
    return NextResponse.json(
      {
        error: `A site audit for ${existing?.domain ?? 'this domain'} is already queued or running`,
        id: result.existingId,
      },
      { status: 409 },
    )
  }
  return NextResponse.json({ id: result.id, status: 'queued' }, { status: 202 })
}

// ─── GET /api/site-audit ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const clientIdParam = request.nextUrl.searchParams.get('clientId')
  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(request.nextUrl.searchParams.get('pageSize') ?? '25', 10) || 25
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

  const where = clientIdParam ? { clientId: parseInt(clientIdParam, 10) } : {}

  const [audits, totalCount] = await Promise.all([
    prisma.siteAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        client: { select: { name: true } },
        crawlRun: { select: { score: true } },
      },
    }),
    prisma.siteAudit.count({ where }),
  ])

  const items = audits.map((a) => {
    let summary = null
    // C3: CrawlRun.score is the canonical score (same formula, mapper-computed);
    // the summary blob is only the pre-A2 fallback and may be pruned (null).
    let score: number | null = a.status === 'complete' ? a.crawlRun?.score ?? null : null
    const wcagLevel = a.wcagLevel ?? 'wcag21aa'

    if (a.status === 'complete' && a.summary) {
      try {
        summary = JSON.parse(a.summary)
        const agg = summary?.aggregate
        if (score === null && agg) score = computeScoreFromCounts(agg, wcagLevel).score
      } catch { /* ignore */ }
    }

    return {
      id: a.id,
      createdAt: a.createdAt.toISOString(),
      domain: a.domain,
      status: a.status,
      error: a.error ?? null,
      clientId: a.clientId ?? null,
      clientName: a.client?.name ?? null,
      pagesTotal: a.pagesTotal,
      pagesComplete: a.pagesComplete,
      pagesError: a.pagesError,
      pagesRedirected: a.pagesRedirected,
      summary,
      score,
      wcagLevel,
      lighthouseTotal: a.lighthouseTotal,
      lighthouseComplete: a.lighthouseComplete,
      lighthouseError: a.lighthouseError,
      requestedBy: a.requestedBy ?? null,
      startedAt: a.startedAt?.toISOString() ?? null,
      completedAt: a.completedAt?.toISOString() ?? null,
    } satisfies SiteAuditDetail & { score: number | null; wcagLevel: string }
  })

  return NextResponse.json({ items, totalCount, page, pageSize })
}
