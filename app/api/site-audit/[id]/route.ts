import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { deleteAuditArtifacts } from '@/lib/ada-audit/screenshot-helpers'
import { cancelJobsByGroup } from '@/lib/jobs/queue'
import { deleteReportFile } from '@/lib/report/report-file'
import type { AuditPdfRow, SiteAuditDetail } from '@/lib/ada-audit/types'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'
import { buildLiveChildren, LIVE_CHILDREN_LIMIT } from '@/lib/ada-audit/live-children-helpers'
import { buildSummaryFromFindings } from '@/lib/ada-audit/findings-fallback'
import { classifySeoPhase, getLatestSeoVerifyJob, type SeoPhase } from '@/lib/ada-audit/seo-phase'

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
      crawlRuns: { where: { tool: 'seo-parser' }, select: { id: true } },
    },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  }

  let summary = null
  if (audit.status === 'complete' && audit.summary) {
    try { summary = JSON.parse(audit.summary) } catch { /* ignore */ }
  }
  if (audit.status === 'complete' && summary === null) {
    // Pruned blob (C3): degraded summary from findings tables.
    summary = await buildSummaryFromFindings(audit.id) // null when no CrawlRun (pre-A2)
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

  // While the audit is in flight, surface the per-page rows that already
  // exist in the DB so the detail page can show a live table beside the
  // progress card. Capped at LIVE_CHILDREN_LIMIT to keep the payload small.
  //
  // Includes lighthouse-running because the page still renders SiteAuditPoller
  // for that status. Without it, the live table would disappear for the 3-8
  // minutes of LH drain even though the per-page rows are already terminal.
  const isInFlight =
    audit.status === 'running' ||
    audit.status === 'pdfs-running' ||
    audit.status === 'lighthouse-running'
  const liveChildren = isInFlight
    ? buildLiveChildren(
        await prisma.adaAudit.findMany({
          where: { siteAuditId: audit.id },
          orderBy: { createdAt: 'desc' },
          take: LIVE_CHILDREN_LIMIT,
          select: { id: true, url: true, status: true, result: true, error: true },
        }),
      )
    : undefined

  const liveScanRunId = audit.crawlRuns[0]?.id ?? null
  const seoPhase: SeoPhase = liveScanRunId
    ? { state: 'done', progress: null, message: null }
    : classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(audit.id) })

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
    pagesRedirected: audit.pagesRedirected,
    summary,
    pdfs,
    pdfsTotal: audit.pdfsTotal,
    pdfsComplete: audit.pdfsComplete,
    pdfsError: audit.pdfsError,
    pdfsSkipped: audit.pdfsSkipped,
    lighthouseTotal: audit.lighthouseTotal,
    lighthouseComplete: audit.lighthouseComplete,
    lighthouseError: audit.lighthouseError,
    requestedBy: audit.requestedBy ?? null,
    startedAt: audit.startedAt?.toISOString() ?? null,
    completedAt: audit.completedAt?.toISOString() ?? null,
    queuePosition,
    activeAudit,
    seoOnly: audit.seoOnly,
    liveScanRunId,
    seoPhase,
    ...(liveChildren ? { liveChildren } : {}),
  } satisfies SiteAuditDetail & {
    queuePosition: number | null
    activeAudit: typeof activeAudit
    liveScanRunId: string | null
    seoPhase: SeoPhase
  })
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

  // Cancel any queued report renders BEFORE the row dies — a RUNNING render
  // is covered by the report handler's stamped.count === 0 cleanup.
  await cancelJobsByGroup(`report:${id}`)

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

  const reportCleanup = await Promise.allSettled([
    deleteReportFile(id),
  ])
  for (const result of reportCleanup) {
    if (result.status === 'rejected') {
      console.warn(`[site-audit] Failed report cleanup for deleted site audit ${id}:`, result.reason)
    }
  }

  return NextResponse.json({ ok: true })
}
