import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { SiteAuditDetail } from '@/lib/ada-audit/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    include: { client: { select: { name: true } } },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  }

  let summary = null
  if (audit.status === 'complete' && audit.summary) {
    try { summary = JSON.parse(audit.summary) } catch { /* ignore */ }
  }

  // If queued, calculate position
  let queuePosition: number | null = null
  if (audit.status === 'queued') {
    const ahead = await prisma.siteAudit.count({
      where: { status: 'queued', createdAt: { lt: audit.createdAt } },
    })
    queuePosition = ahead + 1
  }

  // If queued or waiting, include active audit info
  let activeAudit: { id: string; domain: string; pagesTotal: number; pagesComplete: number; pagesError: number } | null = null
  if (audit.status === 'queued') {
    activeAudit = await prisma.siteAudit.findFirst({
      where: { status: { in: ['running', 'pending'] } },
      select: { id: true, domain: true, pagesTotal: true, pagesComplete: true, pagesError: true },
    })
  }

  return NextResponse.json({
    id: audit.id,
    createdAt: audit.createdAt.toISOString(),
    domain: audit.domain,
    status: audit.status,
    error: audit.error ?? null,
    clientId: audit.clientId ?? null,
    clientName: audit.client?.name ?? null,
    pagesTotal: audit.pagesTotal,
    pagesComplete: audit.pagesComplete,
    pagesError: audit.pagesError,
    summary,
    queuePosition,
    activeAudit,
  } satisfies SiteAuditDetail & { queuePosition: number | null; activeAudit: typeof activeAudit })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const existing = await prisma.siteAudit.findUnique({ where: { id }, select: { id: true } })
  if (!existing) {
    return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  }

  // Cascade deletes all child AdaAudit rows (defined in schema)
  await prisma.siteAudit.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
