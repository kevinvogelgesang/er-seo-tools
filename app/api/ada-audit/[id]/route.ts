import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { deleteScreenshots } from '@/lib/ada-audit/screenshot-helpers'
import type { AuditDetail, StoredAxeResults } from '@/lib/ada-audit/types'

export const dynamic = 'force-dynamic'

// ─── GET /api/ada-audit/[id] ──────────────────────────────────────────────────
// Returns full audit detail including parsed results.
// Also used for polling: clients check status until it's 'complete' or 'error'.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const audit = await prisma.adaAudit.findUnique({
    where: { id },
    include: { client: { select: { name: true } } },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }

  let results: StoredAxeResults | null = null
  if (audit.status === 'complete' && audit.result) {
    try {
      results = JSON.parse(audit.result) as StoredAxeResults
    } catch {
      // Malformed stored result — treat as error
      return NextResponse.json({
        id: audit.id,
        createdAt: audit.createdAt.toISOString(),
        url: audit.url,
        status: 'error',
        error: 'Stored result could not be parsed',
        clientId: audit.clientId ?? null,
        clientName: audit.client?.name ?? null,
        results: null,
        progress: audit.progress ?? 0,
        progressMessage: audit.progressMessage ?? '',
        runnerType: audit.runnerType ?? 'jsdom',
      } satisfies AuditDetail)
    }
  }

  return NextResponse.json({
    id: audit.id,
    createdAt: audit.createdAt.toISOString(),
    url: audit.url,
    status: audit.status,
    error: audit.error ?? null,
    clientId: audit.clientId ?? null,
    clientName: audit.client?.name ?? null,
    results,
    progress: audit.progress ?? 0,
    progressMessage: audit.progressMessage ?? '',
    runnerType: audit.runnerType ?? 'jsdom',
  } satisfies AuditDetail)
}

// ─── DELETE /api/ada-audit/[id] ───────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const existing = await prisma.adaAudit.findUnique({ where: { id }, select: { id: true } })
  if (!existing) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }

  await prisma.adaAudit.delete({ where: { id } })
  await deleteScreenshots(id)
  return NextResponse.json({ ok: true })
}
