// lib/jobs/handlers/report-render.ts
//
// Durable branded-PDF render for a completed SiteAudit. On-demand (POST
// /api/site-audit/[id]/report), one file per audit under REPORTS_DIR,
// regeneration overwrites. groupKey 'report:<id>' — deliberately NOT
// 'site-audit:<id>': recovery treats that group as audit liveness.
//
// Error semantics: deleted/non-complete/pre-A2 audits are domain no-ops
// (settle clean, no retry burn — Codex spec fix #9); render/data/db errors
// throw → one retry; onExhausted is log-only (a failed report NEVER touches
// the audit row).

import { prisma } from '@/lib/db'
import { acquirePage, releasePage } from '@/lib/ada-audit/browser-pool'
import { loadSiteReportData } from '@/lib/report/report-data'
import { buildSiteReportHtml } from '@/lib/report/report-html'
import { writeReportFile, deleteReportFile } from '@/lib/report/report-file'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

export const REPORT_RENDER_JOB_TYPE = 'report-render'

export interface ReportRenderJob { siteAuditId: string }

function assertPayload(payload: unknown): ReportRenderJob {
  const p = payload as Partial<ReportRenderJob> | null
  if (!p || typeof p.siteAuditId !== 'string') throw new Error('Invalid report-render job payload')
  return p as ReportRenderJob
}

export async function runReportRenderJob(payload: unknown): Promise<void> {
  const { siteAuditId } = assertPayload(payload)

  const audit = await prisma.siteAudit.findUnique({ where: { id: siteAuditId }, select: { status: true } })
  if (!audit) return // deleted before we started — clean no-op
  if (audit.status !== 'complete') {
    console.warn(`[jobs/report-render] audit ${siteAuditId} is ${audit.status}, skipping`)
    return
  }

  const data = await loadSiteReportData(siteAuditId)
  if (!data) {
    console.warn(`[jobs/report-render] no report data for ${siteAuditId} (pre-A2?), skipping`)
    return
  }
  const html = buildSiteReportHtml(data)

  // All data work is done — only now take a browser page, and hold it for
  // nothing but setContent + pdf (browser-pool rule).
  const page = await acquirePage()
  let pdf: Buffer
  try {
    await page.setContent(html, { waitUntil: 'load' })
    pdf = Buffer.from(await page.pdf({
      format: 'letter',
      printBackground: true,
      margin: { top: '0.6in', bottom: '0.75in', left: '0.6in', right: '0.6in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#9ca3af;text-align:center;">
        <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    }))
  } finally {
    await releasePage(page)
  }

  await writeReportFile(siteAuditId, pdf)
  const stamped = await prisma.siteAudit.updateMany({
    where: { id: siteAuditId },
    data: { reportGeneratedAt: new Date() },
  })
  if (stamped.count === 0) {
    // Audit deleted mid-render — don't leave an orphan file.
    await deleteReportFile(siteAuditId)
  }
}

export async function onReportRenderExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  const p = payload as Partial<ReportRenderJob> | null
  console.warn(`[jobs/report-render] report for ${p?.siteAuditId} failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerReportRenderHandler(): void {
  registerJobHandler({
    type: REPORT_RENDER_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 2,
    backoffBaseMs: 15_000,
    timeoutMs: 120_000,
    handler: runReportRenderJob,
    onExhausted: onReportRenderExhausted,
  })
}
