import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { discoverPages } from '@/lib/ada-audit/sitemap-crawler'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { buildSiteAuditSummary } from '@/lib/ada-audit/site-audit-helpers'
import type { SiteAuditDetail } from '@/lib/ada-audit/types'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'

export const dynamic = 'force-dynamic'

// ─── Background job ───────────────────────────────────────────────────────────

async function runSiteAuditInBackground(id: string, domain: string, clientId: number | null, wcagLevel: string, preDiscoveredUrls?: string[]) {
  try {
    await prisma.siteAudit.update({ where: { id }, data: { status: 'running' } })

    const urls = preDiscoveredUrls ?? await discoverPages(domain)
    await prisma.siteAudit.update({ where: { id }, data: { pagesTotal: urls.length } })

    const CONCURRENCY = 2
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      await Promise.all(urls.slice(i, i + CONCURRENCY).map(async (url) => {
        const child = await prisma.adaAudit.create({
          data: { url, status: 'pending', clientId, siteAuditId: id, wcagLevel },
        })
        try {
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'running' } })
          const results = await runAxeAudit(url, wcagLevel)
          await prisma.adaAudit.update({
            where: { id: child.id },
            data: { status: 'complete', result: JSON.stringify(results), runnerType: 'browser' },
          })
          await prisma.siteAudit.update({ where: { id }, data: { pagesComplete: { increment: 1 } } })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Audit failed'
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'error', error: msg } })
          await prisma.siteAudit.update({ where: { id }, data: { pagesError: { increment: 1 } } })
        }
      }))
    }

    const children = await prisma.adaAudit.findMany({
      where: { siteAuditId: id },
      select: { id: true, url: true, status: true, error: true, result: true },
    })
    const summary = buildSiteAuditSummary(children)

    await prisma.siteAudit.update({
      where: { id },
      data: { status: 'complete', summary: JSON.stringify(summary) },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Site audit failed'
    console.error(`[site-audit] id=${id} error:`, message)
    await prisma.siteAudit.update({
      where: { id },
      data: { status: 'error', error: message },
    }).catch(() => {})
  }
}

// ─── POST /api/site-audit ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  let domain = typeof raw?.domain === 'string' ? raw.domain.trim() : ''
  const clientId = typeof raw?.clientId === 'number' ? raw.clientId : null
  const wcagLevel = typeof raw?.wcagLevel === 'string' && raw.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  const preDiscoveredUrls = Array.isArray(raw?.urls) ? (raw.urls as string[]).filter(u => typeof u === 'string') : undefined

  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }

  // Strip scheme/path if user accidentally pasted a full URL
  domain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()

  // Basic hostname validation
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return NextResponse.json({ error: 'Invalid domain (e.g. example.edu)' }, { status: 400 })
  }

  if (clientId !== null) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 400 })
    }
  }

  // Prevent duplicate in-flight site audits for the same domain
  const inFlight = await prisma.siteAudit.findFirst({
    where: { domain, status: { in: ['pending', 'running'] } },
    select: { id: true },
  })
  if (inFlight) {
    return NextResponse.json(
      { error: `A site audit for ${domain} is already running`, id: inFlight.id },
      { status: 409 }
    )
  }

  const audit = await prisma.siteAudit.create({
    data: { domain, status: 'pending', clientId, wcagLevel },
  })

  void runSiteAuditInBackground(audit.id, domain, clientId, wcagLevel, preDiscoveredUrls)

  return NextResponse.json({ id: audit.id, status: 'pending' }, { status: 202 })
}

// ─── GET /api/site-audit ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('clientId')
  const where = clientId ? { clientId: parseInt(clientId, 10) } : {}

  const audits = await prisma.siteAudit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { client: { select: { name: true } } },
  })

  const items = audits.map((a) => {
    let summary = null
    let score: number | null = null
    const wcagLevel = a.wcagLevel ?? 'wcag21aa'

    if (a.status === 'complete' && a.summary) {
      try {
        summary = JSON.parse(a.summary)
        const agg = summary?.aggregate
        if (agg) {
          score = computeScoreFromCounts(agg, wcagLevel).score
        }
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
      summary,
      score,
      wcagLevel,
    } satisfies SiteAuditDetail & { score: number | null; wcagLevel: string }
  })

  return NextResponse.json(items)
}
