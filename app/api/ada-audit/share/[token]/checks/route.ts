import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAdaAuditChecks } from '@/lib/ada-audit/checks-store'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const audit = await prisma.adaAudit.findUnique({
    where: { shareToken: token },
    select: { id: true, status: true, shareExpiresAt: true },
  })
  if (!audit || audit.status !== 'complete' || !audit.shareExpiresAt || audit.shareExpiresAt < new Date()) {
    return NextResponse.json({ error: 'Share link not found or expired' }, { status: 404 })
  }
  const checks = await getAdaAuditChecks(audit.id)
  return NextResponse.json({ checks })
}
