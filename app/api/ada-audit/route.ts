import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'
import type { AuditListItem, AuditScorecard } from '@/lib/ada-audit/types'
import { computeScore } from '@/lib/ada-audit/scoring'

export const dynamic = 'force-dynamic'

// ─── Background audit runner ──────────────────────────────────────────────────
// Runs after the route handler has already responded with { id }.
// Updates the DB record directly; errors set status = 'error'.

async function runAuditInBackground(id: string, url: string, wcagLevel: string, captureScreenshots: boolean) {
  const onProgress = async (progress: number, progressMessage: string) => {
    await prisma.adaAudit.update({ where: { id }, data: { progress, progressMessage } }).catch(() => {})
  }

  try {
    await prisma.adaAudit.update({ where: { id }, data: { status: 'running', progress: 0, progressMessage: 'Starting…' } })
    const results = await runAxeAudit(url, wcagLevel, onProgress, captureScreenshots ? {
      captureScreenshots: true,
      screenshotDir: path.join(SCREENSHOTS_DIR, id),
    } : undefined)
    await prisma.adaAudit.update({
      where: { id },
      data: { status: 'complete', result: JSON.stringify(results), progress: 100, progressMessage: 'Complete', runnerType: 'browser' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ada-audit] id=${id} url=${url} error:`, err)
    await prisma.adaAudit.update({
      where: { id },
      data: { status: 'error', error: message },
    }).catch(() => {})
  }
}

// ─── POST /api/ada-audit ──────────────────────────────────────────────────────
// Creates the audit record and returns { id, status: 'pending' } immediately.
// The actual audit runs in the background and the client polls for completion.

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const url = typeof raw?.url === 'string' ? raw.url.trim() : ''
  const clientId = typeof raw?.clientId === 'number' ? raw.clientId : null
  const wcagLevel = typeof raw?.wcagLevel === 'string' && raw.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  const captureScreenshots = raw?.captureScreenshots === true

  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  // Validate URL scheme
  let parsed: URL
  try {
    parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only http/https URLs are allowed' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // Validate clientId exists if provided
  if (clientId !== null) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 400 })
    }
  }

  const audit = await prisma.adaAudit.create({
    data: { url: parsed.toString(), status: 'pending', clientId, wcagLevel },
  })

  // Fire-and-forget: audit runs in background, route returns immediately.
  // Node.js will keep the event loop alive while the promise is pending.
  void runAuditInBackground(audit.id, audit.url, wcagLevel, captureScreenshots)

  return NextResponse.json({ id: audit.id, status: 'pending' }, { status: 202 })
}

// ─── GET /api/ada-audit ───────────────────────────────────────────────────────
// Returns last 50 audits. Supports ?clientId= filter.

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('clientId')
  // Exclude child page records that belong to a site audit
  const where = clientId
    ? { clientId: parseInt(clientId, 10), siteAuditId: null }
    : { siteAuditId: null }

  const audits = await prisma.adaAudit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { client: { select: { name: true } } },
  })

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
    } satisfies AuditListItem & { score: number | null; wcagLevel: string }
  })

  return NextResponse.json(items)
}
