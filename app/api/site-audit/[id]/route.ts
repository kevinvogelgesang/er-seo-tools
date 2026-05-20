import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { deleteAuditArtifacts } from '@/lib/ada-audit/screenshot-helpers'
import type { AuditPdfRow, SiteAuditDetail } from '@/lib/ada-audit/types'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    include: {
      client: { select: { name: true } },
      pdfAudits: {
        select: { url: true, fileSize: true, pageCount: true, issues: true, scanError: true },
      },
    },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  }

  let summary = null
  if (audit.status === 'complete' && audit.summary) {
    try { summary = JSON.parse(audit.summary) } catch { /* ignore */ }
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
      where: { status: { in: ['running', 'pending', 'pdfs-running', 'lighthouse-running'] } },
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
    pdfs,
    pdfsTotal: audit.pdfsTotal,
    pdfsComplete: audit.pdfsComplete,
    pdfsError: audit.pdfsError,
    lighthouseTotal: audit.lighthouseTotal,
    lighthouseComplete: audit.lighthouseComplete,
    lighthouseError: audit.lighthouseError,
    queuePosition,
    activeAudit,
  } satisfies SiteAuditDetail & { queuePosition: number | null; activeAudit: typeof activeAudit; lighthouseTotal: number; lighthouseComplete: number; lighthouseError: number })
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

  const children = await prisma.adaAudit.findMany({
    where: { siteAuditId: id },
    select: { id: true },
  })

  // Cascade deletes all child AdaAudit rows (defined in schema)
  await prisma.siteAudit.delete({ where: { id } })

  const artifactCleanup = await Promise.allSettled(
    children.map((child) => deleteAuditArtifacts(child.id)),
  )
  for (const result of artifactCleanup) {
    if (result.status === 'rejected') {
      console.warn(`[site-audit] Failed to clean artifacts for deleted site audit ${id}:`, result.reason)
    }
  }

  return NextResponse.json({ ok: true })
}
