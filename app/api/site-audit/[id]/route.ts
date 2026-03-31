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
  } satisfies SiteAuditDetail)
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
