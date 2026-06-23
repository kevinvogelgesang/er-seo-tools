// lib/jobs/handlers/seo-report-render.ts
//
// Durable SEO performance report render job (C10).
//
// SNAPSHOT RULE (Codex fix #8): if metricsJson is already present when the
// handler starts, the entire fetch phase is SKIPPED and the snapshot is
// reused. This means a retry after a render failure never re-hits the Google
// APIs. INVARIANT: any operation that changes the inputs (e.g. a manual
// ProspectsEntry update, Task 24 re-run) MUST null metricsJson so the next
// render refetches fresh data.
//
// PER-SOURCE STATUS (v1 mapping):
//   GA4/GSC: ok → 'ok', unmapped → 'skipped', auth/quota/error → 'error'
//   Prospects: ok → 'manual' (only source in v1 is manual ProspectsEntry;
//     CRM stub never returns ok), not-ok → 'missing'
//
// PARTIAL vs TOTAL failure (spec §9):
//   All three sources not-ok → status='error', no render.
//   At least one ok → render proceeds, gaps are labeled in the PDF,
//   final status is 'ready'.
//
// retainUntil: SEO_REPORT_RETENTION_SCHEDULED_DAYS (default 730) for
//   trigger='scheduled'; SEO_REPORT_RETENTION_ADHOC_DAYS (default 90) for
//   all others.
//
// Error semantics: row-gone is a clean no-op; all render/db errors throw
// (→ retry); onExhausted is log-only.

import { prisma } from '@/lib/db'
import { acquirePage, releasePage } from '@/lib/ada-audit/browser-pool'
import { fetchGa4 } from '@/lib/analytics/google/ga4-provider'
import { fetchGsc } from '@/lib/analytics/google/gsc-provider'
import { fetchProspects } from '@/lib/analytics/prospects/prospects-provider'
import { formatYmd } from '@/lib/analytics/dates'
import type { DateWindow } from '@/lib/analytics/dates'
import type { PerformanceAnalyticsBundle } from '@/lib/analytics/types'
import { buildSeoReportData } from '@/lib/report/seo/report-data'
import { buildSeoReportHtml } from '@/lib/report/seo/seo-report-html'
import { writeSeoReportFile, deleteSeoReportFile } from '@/lib/report/seo/seo-report-file'
import { enqueueJob } from '@/lib/jobs/queue'
import type { EnqueueJobResult } from '@/lib/jobs/types'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

// ---------------------------------------------------------------------------
// Public constants + enqueue helper
// ---------------------------------------------------------------------------

export const SEO_REPORT_RENDER_JOB_TYPE = 'seo-report-render'

export async function enqueueSeoReportRender(seoReportId: string): Promise<EnqueueJobResult> {
  return enqueueJob({
    type: SEO_REPORT_RENDER_JOB_TYPE,
    payload: { seoReportId },
    dedupKey: `seo-report:${seoReportId}`,
    groupKey: `seo-report:${seoReportId}`,
  })
}

// ---------------------------------------------------------------------------
// Per-source status mapping helpers
// ---------------------------------------------------------------------------

function ga4StatusFrom(ok: boolean, reason?: string): string {
  if (ok) return 'ok'
  if (reason === 'unmapped') return 'skipped'
  return 'error'
}

function gscStatusFrom(ok: boolean, reason?: string): string {
  if (ok) return 'ok'
  if (reason === 'unmapped') return 'skipped'
  return 'error'
}

function prospectsStatusFrom(ok: boolean): string {
  return ok ? 'manual' : 'missing'
}

// ---------------------------------------------------------------------------
// Period label builder (e.g. "May 1–31, 2026")
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function buildPeriodLabel(start: Date, end: Date): string {
  const sy = start.getUTCFullYear()
  const sm = start.getUTCMonth()
  const sd = start.getUTCDate()
  const ey = end.getUTCFullYear()
  const em = end.getUTCMonth()
  const ed = end.getUTCDate()

  if (sy === ey && sm === em) {
    // Same month-year: "May 1–31, 2026"
    return `${MONTH_NAMES[sm]} ${sd}–${ed}, ${sy}`
  }
  if (sy === ey) {
    // Same year, different months: "Apr 1 – May 31, 2026"
    return `${MONTH_NAMES[sm]} ${sd} – ${MONTH_NAMES[em]} ${ed}, ${sy}`
  }
  // Different years: "Dec 1, 2025 – Jan 31, 2026"
  return `${MONTH_NAMES[sm]} ${sd}, ${sy} – ${MONTH_NAMES[em]} ${ed}, ${ey}`
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

export async function runSeoReportRenderJob(payload: unknown): Promise<void> {
  const p = payload as Partial<{ seoReportId: string }> | null
  if (!p || typeof p.seoReportId !== 'string') {
    throw new Error('Invalid seo-report-render job payload')
  }
  const { seoReportId } = p

  // Capture timestamp once for both meta and DB stamp
  const now = new Date()

  // ── Step 1: Load the row ─────────────────────────────────────────────────

  const report = await prisma.seoReport.findUnique({
    where: { id: seoReportId },
    include: {
      batch: true,
      client: {
        select: {
          id: true,
          name: true,
          domains: true,
          ga4PropertyId: true,
          gscSiteUrl: true,
          crmClientRef: true,
        },
      },
    },
  })

  if (!report) return // Row gone — clean no-op

  const { batch, client } = report

  // ── Step 2: Fetch (or reuse snapshot) ───────────────────────────────────

  let bundle: PerformanceAnalyticsBundle

  if (report.metricsJson) {
    // SNAPSHOT RULE: reuse the persisted snapshot — never re-hit APIs
    try {
      bundle = JSON.parse(report.metricsJson) as PerformanceAnalyticsBundle
    } catch {
      throw new Error(`[jobs/seo-report-render] metricsJson for ${seoReportId} is malformed JSON`)
    }
  } else {
    // Build DateWindows from the row's DateTime fields (already Date objects)
    const period: DateWindow = { start: report.periodStart, end: report.periodEnd }
    const comparison: DateWindow = { start: report.comparisonStart, end: report.comparisonEnd }

    // Fetch all three sources in parallel
    const [ga4Result, gscResult, prospectsResult] = await Promise.all([
      fetchGa4(client.ga4PropertyId, period, comparison),
      fetchGsc(client.gscSiteUrl, period, comparison),
      fetchProspects({ id: client.id, crmClientRef: client.crmClientRef }, period),
    ])

    // Map per-source statuses
    const ga4Status = ga4StatusFrom(ga4Result.ok, ga4Result.ok ? undefined : (ga4Result as { ok: false; reason: string }).reason)
    const gscStatus = gscStatusFrom(gscResult.ok, gscResult.ok ? undefined : (gscResult as { ok: false; reason: string }).reason)
    const prospectsStatus = prospectsStatusFrom(prospectsResult.ok)

    // Check for total failure (all three sources not-ok)
    const anyOk = ga4Result.ok || gscResult.ok || prospectsResult.ok
    if (!anyOk) {
      await prisma.seoReport.updateMany({
        where: { id: seoReportId },
        data: {
          status: 'error',
          ga4Status,
          gscStatus,
          prospectsStatus,
          error: 'All analytics sources failed to fetch',
        },
      })
      // Trigger batch rollup even on total failure
      await rollupBatchStatus(batch.id)
      return
    }

    // Build the bundle
    const metricWindow = (w: DateWindow) => ({ start: formatYmd(w.start), end: formatYmd(w.end) })
    bundle = {
      period: metricWindow(period),
      comparison: metricWindow(comparison),
      ga4: ga4Result,
      gsc: gscResult,
      prospects: prospectsResult,
    }

    // Persist metricsJson + per-source statuses (before acquiring page)
    await prisma.seoReport.updateMany({
      where: { id: seoReportId },
      data: {
        status: 'rendering',
        ga4Status,
        gscStatus,
        prospectsStatus,
        metricsJson: JSON.stringify(bundle),
      },
    })
  }

  // ── Step 3: Build data + HTML (ALL data work before acquirePage) ─────────

  // Parse client.domains (JSON-serialized string array)
  let domains: string[] = []
  try {
    domains = JSON.parse(client.domains) as string[]
  } catch {
    domains = []
  }

  const periodLabel = buildPeriodLabel(report.periodStart, report.periodEnd)
  const comparisonLabel = buildPeriodLabel(report.comparisonStart, report.comparisonEnd)

  const meta = {
    clientName: client.name,
    domain: domains[0] ?? '',
    periodLabel,
    comparisonLabel,
    generatedAt: now.toISOString(),
    operator: batch.createdBy ?? null,
  }

  const data = buildSeoReportData(bundle, meta)
  const html = buildSeoReportHtml(data)

  // ── Step 4: Acquire page → setContent → pdf → release (finally) ─────────

  const page = await acquirePage()
  let pdf: Buffer
  try {
    await page.setContent(html, { waitUntil: 'load' })
    pdf = Buffer.from(await page.pdf({
      format: 'letter',
      printBackground: true,
      margin: { top: '0.4in', bottom: '0.5in', left: '0.4in', right: '0.4in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="width:100%;font-size:8px;color:#9ca3af;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    }))
  } finally {
    await releasePage(page)
  }

  // ── Step 5: Write file + fenced stamp ────────────────────────────────────

  await writeSeoReportFile(seoReportId, pdf)

  const retentionDays = batch.trigger === 'scheduled'
    ? parseInt(process.env.SEO_REPORT_RETENTION_SCHEDULED_DAYS ?? '730', 10)
    : parseInt(process.env.SEO_REPORT_RETENTION_ADHOC_DAYS ?? '90', 10)

  const retainUntil = new Date(now.getTime() + retentionDays * 86400_000)

  const stamped = await prisma.seoReport.updateMany({
    where: { id: seoReportId },
    data: {
      status: 'ready',
      generatedAt: now,
      retainUntil,
    },
  })

  if (stamped.count === 0) {
    // Row vanished mid-render — delete the orphan file and settle clean
    await deleteSeoReportFile(seoReportId)
    return
  }

  // ── Step 6: Batch rollup (after child settles) ───────────────────────────

  await rollupBatchStatus(batch.id)
}

// ---------------------------------------------------------------------------
// Batch rollup helper
// ---------------------------------------------------------------------------

async function rollupBatchStatus(batchId: string): Promise<void> {
  const children = await prisma.seoReport.findMany({
    where: { batchId },
    select: { status: true },
  })

  if (children.length === 0) return

  const statuses = children.map((c) => c.status)
  const TRANSIENT = ['queued', 'fetching', 'rendering']

  const hasTransient = statuses.some((s) => TRANSIENT.includes(s))
  const allError = statuses.every((s) => s === 'error')

  let batchStatus: string
  if (hasTransient) {
    batchStatus = 'running'
  } else if (allError) {
    batchStatus = 'error'
  } else {
    batchStatus = 'complete'
  }

  await prisma.$transaction([
    prisma.seoReportBatch.updateMany({
      where: { id: batchId },
      data: { status: batchStatus },
    }),
  ])
}

// ---------------------------------------------------------------------------
// onExhausted — log-only
// ---------------------------------------------------------------------------

async function onSeoReportRenderExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  const p = payload as Partial<{ seoReportId: string }> | null
  console.warn(
    `[jobs/seo-report-render] report ${p?.seoReportId} failed after ${ctx.attempts} attempts: ${ctx.lastError}`
  )
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSeoReportRenderHandler(): void {
  registerJobHandler({
    type: SEO_REPORT_RENDER_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 2,
    backoffBaseMs: 15_000,
    timeoutMs: 600_000,
    handler: runSeoReportRenderJob,
    onExhausted: onSeoReportRenderExhausted,
  })
}
