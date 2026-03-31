/**
 * Global site audit queue manager.
 *
 * Only one site audit runs at a time. When an audit is submitted, it enters
 * status 'queued'. The queue manager picks the oldest queued audit and runs it.
 * When it finishes (complete or error), the next queued audit starts automatically.
 *
 * Pre-discovered URLs are stored as JSON on the SiteAudit row so the queue
 * can pass them to the runner without re-crawling.
 */

import { prisma } from '@/lib/db'
import { discoverPages } from '@/lib/ada-audit/sitemap-crawler'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { buildSiteAuditSummary } from '@/lib/ada-audit/site-audit-helpers'

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
          const results = await runAxeAudit(url, wcagLevel)
          await prisma.adaAudit.update({
            where: { id: child.id },
            data: { status: 'complete', result: JSON.stringify(results), runnerType: 'browser' },
          })
          await prisma.siteAudit.update({ where: { id }, data: { pagesComplete: { increment: 1 } } })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Audit failed'
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'error', error: msg } })
          await prisma.siteAudit.update({ where: { id }, data: { pagesError: { increment: 1 } } })
        }
      }))
    }

    const children = await prisma.adaAudit.findMany({
      where: { siteAuditId: id },
      select: { id: true, url: true, status: true, error: true, result: true },
    })
    const summary = buildSiteAuditSummary(children)

    await prisma.siteAudit.update({
      where: { id },
      data: { status: 'complete', summary: JSON.stringify(summary) },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Site audit failed'
    console.error(`[site-audit] id=${id} error:`, message)
    await prisma.siteAudit.update({
      where: { id },
      data: { status: 'error', error: message },
    }).catch(() => {})
  }
}

// ─── Queue processing ────────────────────────────────────────────────────────

/**
 * Picks the next queued audit and runs it. Calls itself again on completion.
 * Only one instance of this loop runs at a time (guarded by `processing` flag).
 */
export async function processNext() {
  if (processing) return
  processing = true

  try {
    // Check if anything is already running
    const running = await prisma.siteAudit.findFirst({
      where: { status: 'running' },
      select: { id: true },
    })
    if (running) {
      processing = false
      return
    }

    // Pick the oldest queued audit
    const next = await prisma.siteAudit.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
    })

    if (!next) {
      processing = false
      return
    }

    // Parse pre-discovered URLs if stored
    let urls: string[] | undefined
    if (next.discoveredUrls) {
      try { urls = JSON.parse(next.discoveredUrls) } catch { /* re-discover */ }
    }

    // Run the audit — when done, process the next one
    await runAudit(next.id, next.domain, next.clientId, next.wcagLevel, urls)
  } catch (err) {
    console.error('[queue] processNext error:', err)
  } finally {
    processing = false
  }

  // After finishing, check for more queued audits
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
  const audit = await prisma.siteAudit.create({
    data: {
      domain,
      status: 'queued',
      clientId,
      wcagLevel,
      discoveredUrls: preDiscoveredUrls ? JSON.stringify(preDiscoveredUrls) : null,
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
    where: { status: { in: ['running', 'pending'] } },
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
 * Resets audits stuck in 'running' with no DB activity for 5+ minutes.
 * Called periodically from instrumentation.ts and on startup.
 */
export async function resetStaleAudits() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)
  const stale = await prisma.siteAudit.findMany({
    where: { status: 'running', updatedAt: { lt: staleThreshold } },
    select: { id: true },
  })
  for (const s of stale) {
    console.warn(`[queue] Resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit timed out (server may have restarted)' },
    }).catch(() => {})
  }
  if (stale.length > 0) void processNext()
}

/**
 * Called on server startup to recover from crashes.
 * Resets stale running audits, then kicks the processor.
 */
export async function recoverQueue() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)

  // Reset running audits that are stale (process crashed)
  const stale = await prisma.siteAudit.findMany({
    where: { status: 'running', updatedAt: { lt: staleThreshold } },
    select: { id: true },
  })
  for (const s of stale) {
    console.warn(`[queue] Startup recovery: resetting stale audit ${s.id}`)
    await prisma.siteAudit.update({
      where: { id: s.id },
      data: { status: 'error', error: 'Audit interrupted (server restarted)' },
    }).catch(() => {})
  }

  // Also reset any 'pending' audits (old status, shouldn't exist with new queue)
  await prisma.siteAudit.updateMany({
    where: { status: 'pending' },
    data: { status: 'queued' },
  })

  // Kick the processor in case there are queued audits
  void processNext()
}
