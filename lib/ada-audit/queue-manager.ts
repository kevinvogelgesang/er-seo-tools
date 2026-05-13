/**
 * Global site audit queue manager.
 *
 * Only one site audit holds the queue slot at a time. The slot is held for
 * BOTH the 'running' phase (pages in flight) and the 'pdfs-running' phase
 * (PDF scans still settling after the last page completed). The slot is
 * released via `finalizeSiteAudit` (in site-audit-finalizer.ts), which is the
 * sole place that flips a SiteAudit to 'complete' and kicks `processNext`.
 *
 * Status transitions: queued → running → pdfs-running → complete
 *                                     ↓ (no PDFs at all)
 *                                     complete
 *                                     ↓ (top-level error)
 *                                     error
 */

import { prisma } from '@/lib/db'
import { discoverPages } from '@/lib/ada-audit/sitemap-crawler'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { dispatchPdfScans } from '@/lib/ada-audit/pdf-orchestrator'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { closeBrowser } from '@/lib/ada-audit/browser-pool'
import { closeBatchIfDrained, ensureOpenBatch } from './audit-batch-helpers'

// ─── State ───────────────────────────────────────────────────────────────────

let processing = false

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runAudit(id: string, domain: string, clientId: number | null, wcagLevel: string, preDiscoveredUrls?: string[]) {
  try {
    await prisma.siteAudit.update({ where: { id }, data: { status: 'running' } })

    const urls = preDiscoveredUrls ?? await discoverPages(domain)
    await prisma.siteAudit.update({ where: { id }, data: { pagesTotal: urls.length } })

    const CONCURRENCY = 2
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      await Promise.all(urls.slice(i, i + CONCURRENCY).map(async (url) => {
        const child = await prisma.adaAudit.create({
          data: { url, status: 'pending', clientId, siteAuditId: id, wcagLevel },
        })
        try {
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'running' } })
          const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = await runAxeAudit(
            url, wcagLevel, undefined, { auditId: child.id },
          )
          await prisma.adaAudit.update({
            where: { id: child.id },
            data: {
              status: 'complete',
              result: JSON.stringify(axe),
              lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
              lighthouseError,
              runnerType: 'browser',
            },
          })
          await prisma.siteAudit.update({ where: { id }, data: { pagesComplete: { increment: 1 } } })

          // Dispatch harvested PDFs. Pass BOTH ids so each PdfAudit is
          // attributed to whichever page first discovered it (per-page
          // summary.pages[i].pdfs counts), while still deduping site-wide
          // via @@unique([siteAuditId, url]).
          //
          // AWAITED on purpose: dispatchPdfScans returns after it has
          // inserted PdfAudit rows and incremented SiteAudit.pdfsTotal. It
          // does NOT wait for actual scans — those run via withPdfSlot()
          // fire-and-forget inside dispatchPdfScans. Awaiting here closes a
          // race where the page-complete check below could observe
          // pdfsTotal=0 and finalize the audit before any PdfAudit rows
          // landed.
          await dispatchPdfScans({
            urls: harvestedPdfUrls,
            siteAuditId: id,
            adaAuditId: child.id,
            sourcePageUrl: url,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Audit failed'
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'error', error: msg } })
          await prisma.siteAudit.update({ where: { id }, data: { pagesError: { increment: 1 } } })
        }
      }))
    }

    // All pages settled. Decide whether to finalize now or wait for PDFs.
    const pageState = await prisma.siteAudit.findUnique({ where: { id } })
    if (!pageState) {
      await closeBrowser().catch(() => {})
      return
    }

    const pdfsOutstanding = pageState.pdfsTotal > 0
      && pageState.pdfsComplete + pageState.pdfsError < pageState.pdfsTotal

    if (pdfsOutstanding) {
      // PDFs still in flight — flip to pdfs-running. The pdf-orchestrator's
      // per-PDF settle callback will invoke finalizeSiteAudit once the last
      // one resolves.
      await prisma.siteAudit.update({
        where: { id },
        data: { status: 'pdfs-running' },
      })
    } else {
      // No PDFs (or all already settled) — finalize now.
      await finalizeSiteAudit(id)
    }

    // Restart browser between site audits to reclaim Chrome memory leaks.
    // Safe even mid-pdfs-running because PDF scanning is pure Node (pdfjs),
    // independent of the browser pool.
    await closeBrowser().catch(() => {})
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Site audit failed'
    console.error(`[site-audit] id=${id} error:`, message)
    await prisma.siteAudit.update({
      where: { id },
      data: { status: 'error', error: message },
    }).catch(() => {})
    // Read back the batchId — we may not have it in scope if the audit errored
    // before any local variable captured it.
    const errored = await prisma.siteAudit.findUnique({
      where: { id },
      select: { batchId: true },
    }).catch(() => null)
    if (errored?.batchId) {
      await closeBatchIfDrained(errored.batchId).catch(() => {})
    }
    await closeBrowser().catch(() => {})
  }
}

// ─── Queue processing ────────────────────────────────────────────────────────

/**
 * Picks the next queued audit and runs it. Calls itself again on completion.
 * Only one instance of this loop runs at a time (guarded by `processing` flag).
 *
 * Note: runAudit() returns once page work is done, even if PDFs are still
 * scanning (status = pdfs-running). The "active?" check below treats
 * pdfs-running as still holding the queue slot, so a subsequent processNext()
 * invocation bails. The post-PDF-settle path in pdf-orchestrator calls
 * finalizeSiteAudit and then kicks processNext() itself once truly done
 * (finalizer is a leaf module with no queue-manager import — keeps the
 * dependency graph acyclic).
 */
export async function processNext() {
  if (processing) return
  processing = true

  try {
    const active = await prisma.siteAudit.findFirst({
      where: { status: { in: ['running', 'pdfs-running'] } },
      select: { id: true },
    })
    if (active) {
      processing = false
      return
    }

    const next = await prisma.siteAudit.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
    })

    if (!next) {
      processing = false
      return
    }

    let urls: string[] | undefined
    if (next.discoveredUrls) {
      try { urls = JSON.parse(next.discoveredUrls) } catch { /* re-discover */ }
    }

    await runAudit(next.id, next.domain, next.clientId, next.wcagLevel, urls)
  } catch (err) {
    console.error('[queue] processNext error:', err)
  } finally {
    processing = false
  }

  void processNext()
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

/**
 * Queue a new site audit. Creates the DB record in 'queued' status,
 * stores pre-discovered URLs if available, then kicks the processor.
 */
export async function enqueueAudit(
  domain: string,
  clientId: number | null,
  wcagLevel: string,
  preDiscoveredUrls?: string[],
): Promise<{ id: string; status: string }> {
  // Attach to the open batch (or create one). `ensureOpenBatch` handles the
  // race-safe creation via the partial unique index.
  const batchId = await ensureOpenBatch()

  const audit = await prisma.siteAudit.create({
    data: {
      domain,
      status: 'queued',
      clientId,
      wcagLevel,
      discoveredUrls: preDiscoveredUrls ? JSON.stringify(preDiscoveredUrls) : null,
      batchId,
    },
  })

  // Kick the processor (non-blocking). Retry after 2s in case the first kick
  // was dropped because processNext() was mid-execution.
  void processNext()
  setTimeout(() => void processNext(), 2000)

  return { id: audit.id, status: 'queued' }
}

// ─── Query helpers ───────────────────────────────────────────────────────────

export interface QueueStatus {
  active: {
    id: string
    domain: string
    pagesTotal: number
    pagesComplete: number
    pagesError: number
  } | null
  queued: {
    id: string
    domain: string
    position: number
  }[]
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const active = await prisma.siteAudit.findFirst({
    where: { status: { in: ['running', 'pending', 'pdfs-running'] } },
    select: { id: true, domain: true, pagesTotal: true, pagesComplete: true, pagesError: true },
    orderBy: { createdAt: 'asc' },
  })

  const queuedRows = await prisma.siteAudit.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, domain: true },
  })

  return {
    active,
    queued: queuedRows.map((q, i) => ({ id: q.id, domain: q.domain, position: i + 1 })),
  }
}

// ─── Recovery ────────────────────────────────────────────────────────────────

/**
 * Resets audits stuck in 'running' or 'pdfs-running' with no DB activity for
 * 5+ minutes. Called periodically from instrumentation.ts and on startup.
 */
export async function resetStaleAudits() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)
  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running'] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, batchId: true },
  })
  for (const s of stale) {
    console.warn(`[queue] Resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit timed out (server may have restarted)' },
    }).catch(() => {})
    if (s.batchId) {
      await closeBatchIfDrained(s.batchId).catch(() => {})
    }
  }
  if (stale.length > 0) void processNext()
}

/**
 * Called on server startup to recover from crashes.
 * Resets stale running/pdfs-running audits, then kicks the processor.
 */
export async function recoverQueue() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)

  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running'] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, batchId: true },
  })
  for (const s of stale) {
    console.warn(`[queue] Startup recovery: resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit interrupted (server restarted)' },
    }).catch(() => {})
    if (s.batchId) {
      await closeBatchIfDrained(s.batchId).catch(() => {})
    }
  }

  // Also reset any 'pending' audits (old status, shouldn't exist with new queue)
  await prisma.siteAudit.updateMany({
    where: { status: 'pending' },
    data: { status: 'queued' },
  })

  void processNext()
}
