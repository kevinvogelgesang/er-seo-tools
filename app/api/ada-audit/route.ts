import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { AuditListItem, AuditScorecard } from '@/lib/ada-audit/types'
import { computeScore } from '@/lib/ada-audit/scoring'
import { enqueueJob } from '@/lib/jobs/queue'
import { ADA_AUDIT_JOB_TYPE, failStandaloneAudit } from '@/lib/jobs/handlers/ada-audit'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ─── POST /api/ada-audit ──────────────────────────────────────────────────────
// Creates the audit record, enqueues a durable ada-audit job (C1 — the audit
// survives restarts; lib/jobs/handlers/ada-audit.ts owns the run), and
// returns { id, status: 'pending' }. The client polls for completion.

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const url = typeof raw?.url === 'string' ? raw.url.trim() : ''
  const wcagLevel = typeof raw?.wcagLevel === 'string' && raw.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'

  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  // Normalize: prepend https:// if no protocol present
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`

  // Validate URL scheme and structure
  let parsed: URL
  try {
    parsed = new URL(normalized)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only http:// and https:// URLs are supported.' }, { status: 400 })
    }
    if (!parsed.hostname.includes('.')) {
      return NextResponse.json({ error: `"${parsed.hostname}" doesn't look like a valid domain — try something like federico.edu` }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: `"${url}" isn't a valid URL — try federico.edu or https://federico.edu/programs` }, { status: 400 })
  }

  // Auto-match client by domain
  const hostname = parsed.hostname.replace(/^www\./, '')
  const allClients = await prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, domains: true } })
  const matchedClient = allClients.find((c) => {
    const domains: string[] = JSON.parse(c.domains || '[]')
    return domains.some((d) => d.replace(/^www\./, '') === hostname)
  })
  const clientId = matchedClient?.id ?? null

  const requestedBy = sanitizeOperatorName(request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value)

  const audit = await prisma.adaAudit.create({
    data: { url: parsed.toString(), status: 'pending', clientId, wcagLevel, requestedBy },
  })

  // Durable enqueue (C1): the worker claims the job and runs the audit; a
  // deploy mid-audit pauses it instead of destroying it. dedup/group key
  // ada-audit:<id> is shared with the standalone PDF dispatch group, so
  // countActiveJobsByGroup measures whole-audit liveness for recovery.
  try {
    await enqueueJob({
      type: ADA_AUDIT_JOB_TYPE,
      payload: { adaAuditId: audit.id, url: audit.url, wcagLevel },
      dedupKey: `ada-audit:${audit.id}`,
      groupKey: `ada-audit:${audit.id}`,
    })
  } catch (err) {
    console.error('[ada-audit] durable enqueue failed for', audit.id, ':', (err as Error).message)
    try {
      await failStandaloneAudit(audit.id, 'Failed to enqueue audit job')
    } catch (settleErr) {
      console.error('[ada-audit] enqueue-failure settle also failed for', audit.id, ':', (settleErr as Error).message)
    }
    return NextResponse.json({ error: 'Failed to queue audit' }, { status: 500 })
  }

  return NextResponse.json({ id: audit.id, status: 'pending' }, { status: 202 })
}

// ─── GET /api/ada-audit ───────────────────────────────────────────────────────
// Returns last 50 audits. Supports ?clientId= filter.

export async function GET(request: NextRequest) {
  const clientIdParam = request.nextUrl.searchParams.get('clientId')
  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(request.nextUrl.searchParams.get('pageSize') ?? '25', 10) || 25
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

  // Exclude child page records that belong to a site audit
  const where: { siteAuditId: null; clientId?: number } = { siteAuditId: null }
  if (clientIdParam) where.clientId = parseInt(clientIdParam, 10)

  const [audits, totalCount] = await Promise.all([
    prisma.adaAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { client: { select: { name: true } } },
    }),
    prisma.adaAudit.count({ where }),
  ])

  const items = audits.map((a) => {
    let scorecard: AuditScorecard | null = null
    let score: number | null = null
    const wcagLevel = a.wcagLevel ?? 'wcag21aa'

    if (a.status === 'complete' && a.result) {
      try {
        const r = JSON.parse(a.result)
        const violations = Array.isArray(r?.violations) ? r.violations : []
        scorecard = {
          critical: violations.filter((v: { impact: string }) => v.impact === 'critical').length,
          serious:  violations.filter((v: { impact: string }) => v.impact === 'serious').length,
          moderate: violations.filter((v: { impact: string }) => v.impact === 'moderate').length,
          minor:    violations.filter((v: { impact: string }) => v.impact === 'minor').length,
          total:    violations.length,
          passed:   Array.isArray(r?.passes) ? r.passes.length : 0,
          incomplete: Array.isArray(r?.incomplete) ? r.incomplete.length : 0,
        }
        score = computeScore(violations, wcagLevel).score
      } catch { /* malformed result — leave scorecard null */ }
    }

    return {
      id: a.id,
      createdAt: a.createdAt.toISOString(),
      url: a.url,
      status: a.status,
      error: a.error ?? null,
      clientId: a.clientId ?? null,
      clientName: a.client?.name ?? null,
      scorecard,
      score,
      wcagLevel,
      requestedBy: a.requestedBy ?? null,
      startedAt: a.startedAt?.toISOString() ?? null,
      completedAt: a.completedAt?.toISOString() ?? null,
    } satisfies AuditListItem & { score: number | null; wcagLevel: string }
  })

  return NextResponse.json({ items, totalCount, page, pageSize })
}
