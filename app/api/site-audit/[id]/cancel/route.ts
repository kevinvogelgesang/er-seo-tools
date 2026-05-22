import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { closeBatchIfDrained } from '@/lib/ada-audit/audit-batch-helpers'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const existing = await prisma.siteAudit.findUnique({
    where: { id },
    select: { batchId: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  }

  // Conditional update: only flip if still queued. Catches the race where the
  // audit transitions queued → running between findUnique and updateMany.
  const updated = await prisma.siteAudit.updateMany({
    where: { id, status: 'queued' },
    data: { status: 'cancelled', completedAt: new Date() },
  })

  if (updated.count === 0) {
    // Refetch — status may have transitioned since the existence check, so
    // we can't trust the value we read above.
    const fresh = await prisma.siteAudit.findUnique({
      where: { id },
      select: { status: true },
    })
    const currentStatus = fresh?.status ?? 'unknown'
    return NextResponse.json(
      {
        error: `Site audit is not queued (current status: ${currentStatus})`,
        currentStatus,
      },
      { status: 409 },
    )
  }

  // Cancelling drops one in-flight member. If it was the last, close the batch.
  if (existing.batchId) {
    await closeBatchIfDrained(existing.batchId).catch(() => {})
  }

  return NextResponse.json({ ok: true, id, status: 'cancelled' })
}
