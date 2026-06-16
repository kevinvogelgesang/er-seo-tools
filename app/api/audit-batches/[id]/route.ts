// app/api/audit-batches/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { customLabelOrNull } from '@/lib/ada-audit/audit-batch-helpers'
import { computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import type { AuditBatchDetail, AuditBatchMember } from '@/lib/ada-audit/types'

export const dynamic = 'force-dynamic'

const MAX_LABEL_LENGTH = 200

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const batch = await prisma.auditBatch.findUnique({
    where: { id },
    include: {
      siteAudits: {
        orderBy: { createdAt: 'asc' },
        include: {
          client: { select: { name: true } },
          crawlRuns: { where: { tool: 'ada-audit' }, select: { score: true } },
        },
      },
    },
  })

  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const members: AuditBatchMember[] = batch.siteAudits.map((m) => {
    // C3: CrawlRun.score is the canonical score (same formula, mapper-computed);
    // the summary blob is only the pre-A2 fallback and may be pruned (null).
    let score: number | null = m.status === 'complete' ? m.crawlRuns[0]?.score ?? null : null
    if (score === null && m.status === 'complete' && m.summary) {
      try {
        const summary = JSON.parse(m.summary) as { aggregate?: unknown } | null
        const agg = summary?.aggregate
        if (agg) score = computeScoreFromCounts(agg as never, m.wcagLevel).score
      } catch {
        score = null
      }
    }
    return {
      id: m.id,
      domain: m.domain,
      clientId: m.clientId ?? null,
      clientName: m.client?.name ?? null,
      status: m.status,
      pagesTotal: m.pagesTotal,
      pagesComplete: m.pagesComplete,
      pagesError: m.pagesError,
      score,
      createdAt: m.createdAt.toISOString(),
      startedAt: m.startedAt?.toISOString() ?? null,
      completedAt: m.completedAt?.toISOString() ?? null,
      requestedBy: m.requestedBy ?? null,
    }
  })

  const response: AuditBatchDetail = {
    id: batch.id,
    startedAt: batch.startedAt.toISOString(),
    closedAt: batch.closedAt ? batch.closedAt.toISOString() : null,
    label: customLabelOrNull(batch),
    members,
  }

  return NextResponse.json(response)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = (body as { label?: unknown })?.label
  let nextLabel: string | null
  if (raw === null) {
    nextLabel = null
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length > MAX_LABEL_LENGTH) {
      return NextResponse.json({ error: `label must be ${MAX_LABEL_LENGTH} chars or fewer` }, { status: 400 })
    }
    nextLabel = trimmed === '' ? null : trimmed
  } else {
    return NextResponse.json({ error: 'label must be a string or null' }, { status: 400 })
  }

  const existing = await prisma.auditBatch.findUnique({ where: { id }, select: { id: true } })
  if (!existing) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const updated = await prisma.auditBatch.update({
    where: { id },
    data: { label: nextLabel },
    select: { id: true, label: true },
  })

  return NextResponse.json({ id: updated.id, label: updated.label })
}
