// app/api/audit-batches/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { customLabelOrNull, summarizeOperators } from '@/lib/ada-audit/audit-batch-helpers'
import type { AuditBatchSummary } from '@/lib/ada-audit/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

  const where = { closedAt: { not: null } }

  const [batches, totalCount] = await Promise.all([
    prisma.auditBatch.findMany({
      where,
      orderBy: { closedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        siteAudits: { select: { status: true, requestedBy: true } },
      },
    }),
    prisma.auditBatch.count({ where }),
  ])

  const items: AuditBatchSummary[] = batches.map((b) => {
    const auditCount = b.siteAudits.length
    let completeCount = 0
    let errorCount = 0
    for (const m of b.siteAudits) {
      if (m.status === 'complete') completeCount++
      else if (m.status === 'error') errorCount++
    }
    return {
      id: b.id,
      startedAt: b.startedAt.toISOString(),
      closedAt: b.closedAt!.toISOString(),
      label: customLabelOrNull(b),
      auditCount,
      completeCount,
      errorCount,
      operatorSummary: summarizeOperators(b.siteAudits),
    }
  })

  return NextResponse.json({ items, totalCount, page, pageSize })
}
