// lib/ada-audit/pdf-orchestrator.ts
//
// Takes harvested PDF URLs from a page, dedupes against existing PdfAudit
// rows for this audit, inserts pending rows, and enqueues one durable
// 'pdf-scan' job per row (lib/jobs/handlers/pdf-scan.ts owns scan +
// settle + counters + finalize). pdfsTotal is bumped here, at insert time,
// so the finalizer's drain predicate is correct before the page settles.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { enqueueJob } from '@/lib/jobs/queue'
import { PDF_SCAN_JOB_TYPE, settlePdfFailure } from '@/lib/jobs/handlers/pdf-scan'
import type { PdfScanJob } from '@/lib/jobs/handlers/pdf-scan'

interface DispatchArgs {
  urls: string[]              // already normalized + same-domain filtered
  siteAuditId?: string
  adaAuditId?: string         // for standalone single-page audits OR per-page attribution under a site audit
  sourcePageUrl?: string      // the audited page the PDFs were harvested from — used as Referer header to defeat anti-hotlinking WAFs
}

export async function dispatchPdfScans({ urls, siteAuditId, adaAuditId, sourcePageUrl }: DispatchArgs): Promise<void> {
  if (!siteAuditId && !adaAuditId) {
    throw new Error('pdf-orchestrator: need siteAuditId or adaAuditId')
  }
  if (urls.length === 0) return

  // Dedup against existing rows for this audit. For site-audit children we key
  // off siteAuditId (the @@unique([siteAuditId, url]) constraint), so a PDF
  // linked from multiple pages of the same site only spawns one scan — owned by
  // whichever page won the race.
  const existing = await prisma.pdfAudit.findMany({
    where: siteAuditId
      ? { siteAuditId, url: { in: urls } }
      : { adaAuditId, url: { in: urls } },
    select: { url: true },
  })
  const known = new Set(existing.map((r) => r.url))
  const fresh = urls.filter((u) => !known.has(u))
  if (fresh.length === 0) return

  // Insert pending rows. Per-URL ARRAY-FORM transaction: the row insert and
  // its pdfsTotal increment move together — a P2002 race (another page beat
  // us to the same URL) rolls back both and we skip the URL; the row is
  // attributed to whichever page won. Never use the interactive
  // $transaction(async tx => ...) form here: interactive transactions hold
  // SQLite's write lock across event-loop round-trips, and concurrent pdfjs
  // parsing starves the loop until every other writer times out (production
  // incident 2026-06-10). Array form runs BEGIN..COMMIT engine-side.
  const inserted: string[] = []
  for (const url of fresh) {
    try {
      if (siteAuditId) {
        await prisma.$transaction([
          prisma.pdfAudit.create({
            data: { siteAuditId, adaAuditId, url, status: 'pending' },
          }),
          prisma.siteAudit.update({
            where: { id: siteAuditId },
            data: { pdfsTotal: { increment: 1 } },
          }),
        ])
      } else {
        await prisma.pdfAudit.create({
          data: { siteAuditId, adaAuditId, url, status: 'pending' },
        })
      }
      inserted.push(url)
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Another page beat us to it — silent no-op.
        continue
      }
      throw e
    }
  }

  if (inserted.length === 0) return

  // Enqueue one durable job per inserted row. Awaited — these are cheap DB
  // inserts, and a failed enqueue must settle its row NOW: pdfsTotal already
  // committed above, so a row with no job would strand the audit in
  // pdfs-running forever. settlePdfFailure flips the row to error, bumps
  // pdfsError, and finalizes — mirroring the PSI enqueue-failure fallback.
  for (const url of inserted) {
    const job: PdfScanJob = { url, siteAuditId, adaAuditId, sourcePageUrl }
    try {
      await enqueueJob({
        type: PDF_SCAN_JOB_TYPE,
        payload: job,
        dedupKey: siteAuditId ? `pdf:${siteAuditId}:${url}` : `pdf:ada:${adaAuditId}:${url}`,
        groupKey: siteAuditId ? `site-audit:${siteAuditId}` : `ada-audit:${adaAuditId}`,
      })
    } catch (err) {
      console.error('[pdf-orchestrator] durable PDF enqueue failed for', url, ':', (err as Error).message)
      try {
        await settlePdfFailure(job, `Failed to enqueue durable PDF scan job: ${(err as Error).message}`)
      } catch (settleErr) {
        console.error('[pdf-orchestrator] PDF enqueue-failure settle also failed for', url, ':', (settleErr as Error).message)
      }
    }
  }
}
