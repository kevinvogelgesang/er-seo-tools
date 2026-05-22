import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { deleteAuditArtifacts } from '@/lib/ada-audit/screenshot-helpers'
import type { AuditDetail, AuditPdfRow, StoredAxeResults } from '@/lib/ada-audit/types'
import type { LighthouseSummary } from '@/lib/ada-audit/lighthouse-types'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'

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
    include: {
      client: { select: { name: true } },
      pdfAudits: {
        select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true },
      },
    },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }

  // Parse Lighthouse summary (tolerant of malformed JSON)
  let lighthouseSummary: LighthouseSummary | null = null
  if (audit.lighthouseSummary) {
    try {
      lighthouseSummary = JSON.parse(audit.lighthouseSummary) as LighthouseSummary
    } catch {
      lighthouseSummary = null
    }
  }

  const pdfs: AuditPdfRow[] = audit.pdfAudits.map((p) => {
    let issues: PdfIssue[] = []
    if (p.issues) {
      try {
        const parsed = JSON.parse(p.issues)
        if (Array.isArray(parsed)) issues = parsed as PdfIssue[]
      } catch {
        issues = []
      }
    }
    return {
      url: p.url,
      fileSize: p.fileSize,
      pageCount: p.pageCount,
      issues,
      scanError: p.scanError ?? null,
    }
  })

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
        lighthouseSummary,
        lighthouseError: audit.lighthouseError ?? null,
        pdfs,
        finalUrl: audit.finalUrl ?? null,
        redirected: audit.redirected,
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
    lighthouseSummary,
    lighthouseError: audit.lighthouseError ?? null,
    pdfs,
    finalUrl: audit.finalUrl ?? null,
    redirected: audit.redirected,
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
  const [artifactCleanup] = await Promise.allSettled([deleteAuditArtifacts(id)])
  if (artifactCleanup.status === 'rejected') {
    console.warn(`[ada-audit] Failed to clean artifacts for deleted audit ${id}:`, artifactCleanup.reason)
  }

  return NextResponse.json({ ok: true })
}
