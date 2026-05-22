/**
 * Global site audit queue manager.
 *
 * Only one site audit holds the queue slot at a time. The slot is held for
 * the 'running' phase (pages in flight), the 'pdfs-running' phase (PDF scans
 * still settling after the last page completed), and the 'lighthouse-running'
 * phase (PageSpeed Insights jobs still draining). The slot is released via
 * `finalizeSiteAudit` (in site-audit-finalizer.ts), which is the sole place
 * that flips a SiteAudit to 'complete' and kicks `processNext`.
 *
 * Status transitions:
 *   queued → running → (pdfs-running | lighthouse-running) → complete
 *                   ↓ (no PDFs and no LH outstanding)
 *                   complete
 *                   ↓ (top-level error)
 *                   error
 */

import { prisma } from '@/lib/db'
import { discoverPages } from '@/lib/ada-audit/sitemap-crawler'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { dispatchPdfScans } from '@/lib/ada-audit/pdf-orchestrator'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { closeBrowser } from '@/lib/ada-audit/browser-pool'
import { enqueuePsiJob } from './lighthouse-queue'
import { getLighthouseProvider } from './lighthouse-provider'
import { closeBatchIfDrained, ensureOpenBatch } from './audit-batch-helpers'
import type { QueueStatusWithBatch } from './types'

// ─── State ───────────────────────────────────────────────────────────────────

let processing = false

const SITE_AUDIT_CONCURRENCY = parsePositiveInt(process.env.SITE_AUDIT_CONCURRENCY, 1)
const SITE_AUDIT_BROWSER_RECYCLE_PAGES = parsePositiveInt(process.env.SITE_AUDIT_BROWSER_RECYCLE_PAGES, 25)

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// ─── Runner ──────────────────────────────────────────────────────────────────

// Exported so the queue-manager.test.ts can assert the claim race directly.
// Not part of the public queue API — callers should go through `enqueueAudit`
// + `processNext`. The conditional claim below is the single source of truth
// for the queued → running transition; do not bypass it.
export async function runAudit(id: string, domain: string, clientId: number | null, wcagLevel: string, preDiscoveredUrls?: string[]) {
  try {
    // Conditional claim: only flip to 'running' if the row is still 'queued'.
    // Closes the race where processNext() picks this row, a concurrent cancel
    // flips status to 'cancelled', and an unconditional update would resurrect
    // it. processNext() will retry and pick the next queued row on its own.
    const claimed = await prisma.siteAudit.updateMany({
      where: { id, status: 'queued' },
      data: { status: 'running' },
    })
    if (claimed.count === 0) return

    const urls = preDiscoveredUrls ?? await discoverPages(domain)
    await prisma.siteAudit.update({ where: { id }, data: { pagesTotal: urls.length } })

    let nextBrowserRecycleAt = SITE_AUDIT_BROWSER_RECYCLE_PAGES
    for (let i = 0; i < urls.length; i += SITE_AUDIT_CONCURRENCY) {
      const batch = urls.slice(i, i + SITE_AUDIT_CONCURRENCY)
      await Promise.all(batch.map(async (url) => {
        const child = await prisma.adaAudit.create({
          data: { url, status: 'pending', clientId, siteAuditId: id, wcagLevel },
        })
        try {
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'running' } })

          // Detached PSI only applies to the pagespeed provider. local LH
          // still runs inline (uses the page slot); off skips LH entirely.
          const provider = getLighthouseProvider()
          const detachPsi = provider === 'pagespeed'

          // runAxeAudit's siteAudit flag suppresses its inline PSI fetch
          // (pagespeed branch only). In local/off modes, the flag is false
          // and the existing inline behavior is preserved.
          const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = await runAxeAudit(
            url, wcagLevel, undefined, { auditId: child.id, siteAudit: detachPsi },
          )

          // Dispatch harvested PDFs FIRST. dispatchPdfScans is awaited (its
          // inserts + pdfsTotal++ commit before this returns), which
          // preserves the invariant that pdfsTotal is current before
          // pagesComplete signals "this page is settled."
          //
          // AWAITED on purpose: dispatchPdfScans returns after it has
          // inserted PdfAudit rows and incremented SiteAudit.pdfsTotal. It
          // does NOT wait for actual scans — those run via withPdfSlot()
          // fire-and-forget inside dispatchPdfScans. Awaiting here closes a
          // race where the finalizer (called by a fast PSI return or by
          // end-of-page-loop) could observe pdfsTotal=0 and finalize the
          // audit before any PdfAudit rows landed.
          await dispatchPdfScans({
            urls: harvestedPdfUrls,
            siteAuditId: id,
            adaAuditId: child.id,
            sourcePageUrl: url,
          })

          // Now commit page-settle state. Transaction shape depends on
          // provider — detached PSI uses axe-complete + lighthouseTotal++;
          // local/off use complete + the inline LH fields.
          if (detachPsi) {
            await prisma.$transaction([
              prisma.adaAudit.update({
                where: { id: child.id },
                data: {
                  status: 'axe-complete',
                  result: JSON.stringify(axe),
                  runnerType: 'browser',
                },
              }),
              prisma.siteAudit.update({
                where: { id },
                data: {
                  lighthouseTotal: { increment: 1 },
                  pagesComplete: { increment: 1 },
                },
              }),
            ])
            enqueuePsiJob({ adaAuditId: child.id, siteAuditId: id, url, wcagLevel })
          } else {
            // local or off: inline LH already ran (or was skipped). Write
            // complete + LH fields + bump pagesComplete in one transaction.
            // No lighthouseTotal++ — this provider doesn't use the queue.
            await prisma.$transaction([
              prisma.adaAudit.update({
                where: { id: child.id },
                data: {
                  status: 'complete',
                  result: JSON.stringify(axe),
                  lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
                  lighthouseError,
                  runnerType: 'browser',
                },
              }),
              prisma.siteAudit.update({
                where: { id },
                data: { pagesComplete: { increment: 1 } },
              }),
            ])
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Audit failed'
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'error', error: msg } })
          await prisma.siteAudit.update({ where: { id }, data: { pagesError: { increment: 1 } } })
        }
      }))

      const pagesProcessed = Math.min(i + batch.length, urls.length)
      if (pagesProcessed < urls.length && pagesProcessed >= nextBrowserRecycleAt) {
        await closeBrowser().catch(() => {})
        while (nextBrowserRecycleAt <= pagesProcessed) {
          nextBrowserRecycleAt += SITE_AUDIT_BROWSER_RECYCLE_PAGES
        }
      }
    }

    // All pages settled. Ask the centralized finalizer to decide what
    // happens next — it may finalize immediately (no PDFs, no LH
    // outstanding), or flip to pdfs-running / lighthouse-running.
    await finalizeSiteAudit(id)

    // Restart browser between site audits to reclaim Chrome memory leaks.
    // Safe even mid-pdfs-running / lighthouse-running because PDF scanning
    // is pure Node (pdfjs) and PSI is a remote HTTP fetch — both
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
 * scanning (status = pdfs-running) or PSI jobs are still draining
 * (status = lighthouse-running). The "active?" check below treats both as
 * still holding the queue slot, so a subsequent processNext() invocation
 * bails. The post-PDF-settle path in pdf-orchestrator and the post-PSI-settle
 * path in lighthouse-queue both call finalizeSiteAudit, which kicks
 * processNext() once the drain predicate (pages + pdfs + lighthouse) is met.
 */
export async function processNext() {
  if (processing) return
  processing = true

  try {
    const active = await prisma.siteAudit.findFirst({
      where: { status: { in: ['running', 'pdfs-running', 'lighthouse-running'] } },
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

export interface EnqueueAuditOptions {
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
}

/**
 * Queue a new site audit. Creates the DB record in 'queued' status,
 * stores pre-discovered URLs if available, then kicks the processor.
 *
 * Optional fields live in an options object so the call signature stays
 * stable when we add more (avoids the trap of "the fourth positional arg
 * just changed meaning").
 */
export async function enqueueAudit(
  domain: string,
  clientId: number | null,
  wcagLevel: string,
  opts: EnqueueAuditOptions = {},
): Promise<{ id: string; status: string }> {
  const { preDiscoveredUrls, requestedBy } = opts

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
      requestedBy: requestedBy ?? null,
    },
  })

  // Race recovery: if `closeBatchIfDrained` ran between `ensureOpenBatch` and
  // the `create` above, it would have observed zero in-flight members and
  // closed the batch. Our atomic conditional UPDATE in closeBatchIfDrained
  // now refuses to close when any in-flight member exists at write-time —
  // but it can still have ALREADY closed the batch before our row landed.
  // Verify and reassign if needed.
  const verify = await prisma.auditBatch.findUnique({
    where: { id: batchId },
    select: { closedAt: true },
  })
  if (verify?.closedAt) {
    const newBatchId = await ensureOpenBatch()
    await prisma.siteAudit.update({
      where: { id: audit.id },
      data: { batchId: newBatchId },
    })
  }

  // Kick the processor (non-blocking). Retry after 2s in case the first kick
  // was dropped because processNext() was mid-execution.
  void processNext()
  setTimeout(() => void processNext(), 2000)

  return { id: audit.id, status: 'queued' }
}

// ─── Query helpers ───────────────────────────────────────────────────────────

export async function getQueueStatus(): Promise<QueueStatusWithBatch> {
  const { resolveBatchLabel } = await import('./audit-batch-helpers')

  const active = await prisma.siteAudit.findFirst({
    where: { status: { in: ['running', 'pending', 'pdfs-running', 'lighthouse-running'] } },
    select: {
      id: true, domain: true, status: true,
      pagesTotal: true, pagesComplete: true, pagesError: true,
      pdfsTotal: true, pdfsComplete: true, pdfsError: true, pdfsSkipped: true,
      lighthouseTotal: true, lighthouseComplete: true, lighthouseError: true,
      clientId: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const queuedRows = await prisma.siteAudit.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, domain: true, clientId: true },
  })

  const openBatch = await prisma.auditBatch.findFirst({
    where: { closedAt: null },
    select: { id: true, startedAt: true, label: true, closedAt: true },
  })

  return {
    active: active
      ? {
          id: active.id,
          domain: active.domain,
          status: active.status,
          pagesTotal: active.pagesTotal,
          pagesComplete: active.pagesComplete,
          pagesError: active.pagesError,
          pdfsTotal: active.pdfsTotal,
          pdfsComplete: active.pdfsComplete,
          pdfsError: active.pdfsError,
          pdfsSkipped: active.pdfsSkipped,
          lighthouseTotal: active.lighthouseTotal,
          lighthouseComplete: active.lighthouseComplete,
          lighthouseError: active.lighthouseError,
          clientId: active.clientId ?? null,
        }
      : null,
    queued: queuedRows.map((q, i) => ({
      id: q.id,
      domain: q.domain,
      position: i + 1,
      clientId: q.clientId ?? null,
    })),
    batch: openBatch
      ? {
          id: openBatch.id,
          startedAt: openBatch.startedAt.toISOString(),
          label: resolveBatchLabel(openBatch),
        }
      : null,
  }
}

// ─── Recovery ────────────────────────────────────────────────────────────────

/**
 * When a parent SiteAudit is forced into a terminal `error` state by recovery,
 * any of its AdaAudit children still in `pending` or `running` are orphans —
 * the runner that owned them is gone and they can never progress. Mark them
 * as `error` with a clear message so any open per-page poller stops spinning.
 */
export async function failOrphanAdaAudits(siteAuditId: string): Promise<void> {
  // Pending/running children never got their axe results.
  await prisma.adaAudit.updateMany({
    where: {
      siteAuditId,
      status: { in: ['pending', 'running'] },
    },
    data: {
      status: 'error',
      error: 'Audit interrupted because the site audit was stopped or restarted',
    },
  })
  // axe-complete children have valid axe data but their PSI job was
  // queued in-memory and never ran. Flip to error so the per-page status
  // is terminal, and record a lighthouseError so the UI shows why LH is
  // missing. The axe `result` column is preserved.
  await prisma.adaAudit.updateMany({
    where: {
      siteAuditId,
      status: 'axe-complete',
    },
    data: {
      status: 'error',
      error: 'Audit interrupted because the site audit was stopped or restarted',
      lighthouseError: 'Lighthouse interrupted because the site audit was stopped or restarted',
    },
  })
}

/**
 * Same idea as failOrphanAdaAudits, but for the PdfAudit table. When a parent
 * SiteAudit is interrupted during the `pdfs-running` or `lighthouse-running`
 * phase, any PdfAudit rows still in `pending` or `scanning` are orphans and
 * would otherwise sit forever. PdfAudit uses `scanError` for its failure
 * message column.
 */
export async function failOrphanPdfAudits(siteAuditId: string): Promise<void> {
  await prisma.pdfAudit.updateMany({
    where: {
      siteAuditId,
      status: { in: ['pending', 'scanning'] },
    },
    data: {
      status: 'error',
      scanError: 'Audit interrupted because the site audit was stopped or restarted',
    },
  })
}

/**
 * Resets audits stuck in 'running', 'pdfs-running', or 'lighthouse-running' with no DB activity for
 * 5+ minutes. Called periodically from instrumentation.ts and on startup.
 */
export async function resetStaleAudits() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)
  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running', 'lighthouse-running'] },
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
    await failOrphanAdaAudits(s.id).catch(() => {})
    await failOrphanPdfAudits(s.id).catch(() => {})
    if (s.batchId) {
      await closeBatchIfDrained(s.batchId).catch(() => {})
    }
  }
  if (stale.length > 0) void processNext()
}

/**
 * Called on server startup to recover from crashes/restarts.
 *
 * Unlike resetStaleAudits (which runs during normal operation and uses a
 * 5-minute staleness threshold), startup recovery makes the strong assumption
 * that ANY SiteAudit in `running`, `pdfs-running`, or `lighthouse-running` is orphaned — the previous
 * Node process is gone and its in-memory page-work state (and the in-process PSI queue) with it. So every
 * such row is flipped to `error` immediately, no threshold. Both AdaAudit and
 * PdfAudit child rows are cascade-failed alongside.
 *
 * Old-status `pending` SiteAudits get re-queued in case any predate the
 * queue-batches feature.
 */
export async function recoverQueue() {
  const orphans = await prisma.siteAudit.findMany({
    where: {
      status: { in: ['running', 'pdfs-running', 'lighthouse-running'] },
    },
    select: { id: true, batchId: true },
  })
  for (const o of orphans) {
    console.warn(`[queue] Startup recovery: resetting orphan audit ${o.id}`)
    await prisma.siteAudit.update({
      where: { id: o.id },
      data: { status: 'error', error: 'Audit interrupted (server restarted)' },
    }).catch(() => {})
    await failOrphanAdaAudits(o.id).catch(() => {})
    await failOrphanPdfAudits(o.id).catch(() => {})
    if (o.batchId) {
      await closeBatchIfDrained(o.batchId).catch(() => {})
    }
  }

  // Also reset any 'pending' audits (legacy status, shouldn't exist with the new queue)
  await prisma.siteAudit.updateMany({
    where: { status: 'pending' },
    data: { status: 'queued' },
  })

  void processNext()
}
