// lib/ada-audit/pdf-orchestrator.ts
//
// Takes harvested PDF URLs from a page, dedupes against existing PdfAudit
// rows for this audit, inserts pending rows, and dispatches scans through
// the PDF worker pool. Updates SiteAudit pdf counters as scans settle.
//
// After the last PDF for a site-audit settles, the orchestrator kicks
// `finalizeSiteAudit` (via dynamic import) so the site-audit can flip from
// `pdfs-running` → `complete`.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { withPdfSlot } from './pdf-worker-pool'
import { scanPdfUrl } from './pdf-runner'

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

  // Insert pending rows. Wrap each create in try/catch so a concurrent insert
  // from another page racing on the same URL silently no-ops via P2002 instead
  // of failing the audit. After the race, the row is attributed to whichever
  // page won — that's the desired behavior.
  const inserted: string[] = []
  await prisma.$transaction(async (tx) => {
    for (const url of fresh) {
      try {
        await tx.pdfAudit.create({
          data: { siteAuditId, adaAuditId, url, status: 'pending' },
        })
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
    if (siteAuditId && inserted.length > 0) {
      await tx.siteAudit.update({
        where: { id: siteAuditId },
        data: { pdfsTotal: { increment: inserted.length } },
      })
    }
  })

  if (inserted.length === 0) return

  // Fire scans through the pool — do NOT await here; let caller continue.
  for (const url of inserted) {
    void withPdfSlot(async () => {
      try {
        await prisma.pdfAudit.updateMany({
          where: { url, ...(siteAuditId ? { siteAuditId } : { adaAuditId }) },
          data: { status: 'scanning' },
        })
        const result = await scanPdfUrl(url, { referer: sourcePageUrl })
        const matches = await prisma.pdfAudit.updateMany({
          where: { url, ...(siteAuditId ? { siteAuditId } : { adaAuditId }) },
          data: {
            fileSize: result.fileSize,
            pageCount: result.pageCount,
            issues: JSON.stringify(result.issues),
            status: result.scanError ? 'error' : 'complete',
            scanError: result.scanError,
          },
        })
        if (siteAuditId && matches.count > 0) {
          await prisma.siteAudit.update({
            where: { id: siteAuditId },
            data: result.scanError
              ? { pdfsError: { increment: 1 } }
              : { pdfsComplete: { increment: 1 } },
          })
        }
      } catch (e) {
        // Last-resort: don't leave row in 'scanning' forever.
        await prisma.pdfAudit.updateMany({
          where: { url, ...(siteAuditId ? { siteAuditId } : { adaAuditId }) },
          data: { status: 'error', scanError: (e as Error).message },
        }).catch(() => {})
        if (siteAuditId) {
          await prisma.siteAudit.update({
            where: { id: siteAuditId },
            data: { pdfsError: { increment: 1 } },
          }).catch(() => {})
        }
      } finally {
        // After each PDF settles, ask the centralized finalizer whether the
        // site audit is fully drained. Idempotent + handles all the state
        // logic (including transient lighthouse-running) internally. The
        // finalizer also kicks processNext when it actually finalizes.
        if (siteAuditId) {
          try {
            const { finalizeSiteAudit } = await import('./site-audit-finalizer')
            await finalizeSiteAudit(siteAuditId)
          } catch (e) {
            console.warn(
              '[ada-audit] post-pdf finalize check failed:',
              (e as Error).message,
            )
          }
        }
      }
    })
  }
}
