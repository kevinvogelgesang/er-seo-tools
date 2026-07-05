/**
 * Global site audit queue manager.
 *
 * Only one site audit holds the queue slot at a time, enforced by the
 * site-audit-discover handler's conditional claim (a NOT EXISTS guard over
 * the transient statuses). The slot is held through 'running' (page jobs in
 * flight), 'pdfs-running', and 'lighthouse-running'; finalizeSiteAudit (in
 * site-audit-finalizer.ts) is the sole place that flips a SiteAudit to
 * 'complete' and kicks `processNext`.
 *
 * Status transitions:
 *   queued → running → (pdfs-running | lighthouse-running) → complete
 *                   ↓ (no PDFs and no LH outstanding)
 *                   complete
 *                   ↓ (top-level error)
 *                   error
 *
 * All page work is durable (Phase 3): discovery + fan-out run as a
 * site-audit-discover job, each page as a site-audit-page job
 * (lib/jobs/handlers/). A restart mid-audit resumes instead of failing —
 * recovery below only destroys parents with zero outstanding durable jobs
 * that still won't finalize.
 */

import { prisma } from '@/lib/db'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { recoverStandaloneAudits } from '@/lib/ada-audit/standalone-recovery'
import { cancelJobsByGroup, countActiveJobsByGroup, enqueueJob } from '@/lib/jobs/queue'
import { closeBatchIfDrained, ensureOpenBatch } from './audit-batch-helpers'
import type { QueueStatusWithBatch } from './types'

const TRANSIENT_STATUSES = ['running', 'pdfs-running', 'lighthouse-running'] as const

// ─── Queue processing ────────────────────────────────────────────────────────

/**
 * Stateless promoter: if no audit holds the slot, enqueue a discover job for
 * the oldest queued audit. Safe under concurrent callers without a mutex:
 * both pick the SAME oldest row (dedupKey discover:<id> collapses the
 * enqueues), and the one-active invariant is enforced by the discover
 * handler's claim, not here — a stray promotion of a second audit no-ops at
 * claim time and gets re-promoted by the next finalize kick.
 */
export async function processNext() {
  try {
    const active = await prisma.siteAudit.findFirst({
      where: { status: { in: [...TRANSIENT_STATUSES] } },
      select: { id: true },
    })
    if (active) return

    const next = await prisma.siteAudit.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!next) return

    await enqueueJob({
      type: 'site-audit-discover',
      payload: { siteAuditId: next.id },
      dedupKey: `discover:${next.id}`,
      groupKey: `site-audit:${next.id}`,
    })
  } catch (err) {
    console.error('[queue] processNext error:', err)
  }
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export interface EnqueueAuditOptions {
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
  /** C2: set when a Schedule row created this audit — attribution + retention marker. */
  scheduleId?: string | null
  /** D1: true when this audit was enqueued by the autonomous SEO pipeline. */
  seoIntent?: boolean
}

/**
 * Queue a new site audit. Creates the DB record in 'queued' status,
 * stores pre-discovered URLs if available, then kicks the promoter.
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
  const { requestedBy, scheduleId, seoIntent } = opts
  // Dedupe up front: pagesTotal must equal the number of UNIQUE children the
  // discover handler will fan out (the (siteAuditId,url) index collapses
  // duplicates). Written together with discoveredUrls so the finalizer's
  // discovery guard is meaningful from birth.
  const preDiscoveredUrls = opts.preDiscoveredUrls
    ? [...new Set(opts.preDiscoveredUrls)]
    : undefined

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
      pagesTotal: preDiscoveredUrls ? preDiscoveredUrls.length : 0,
      discoveryMode: preDiscoveredUrls ? 'pre-discovered' : null,
      batchId,
      requestedBy: requestedBy ?? null,
      scheduleId: scheduleId ?? null,
      seoIntent: seoIntent ?? false,
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

  void processNext()

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
      completedAt: new Date(),
    },
  })
  // axe-complete children have valid axe data but their PSI job never
  // settled (cancelled with the group, or never enqueued). Flip to error so
  // the per-page status is terminal, and record a lighthouseError so the UI
  // shows why LH is missing. The axe `result` column is preserved.
  await prisma.adaAudit.updateMany({
    where: {
      siteAuditId,
      status: 'axe-complete',
    },
    data: {
      status: 'error',
      error: 'Audit interrupted because the site audit was stopped or restarted',
      lighthouseError: 'Lighthouse interrupted because the site audit was stopped or restarted',
      completedAt: new Date(),
    },
  })
}

/**
 * Same idea as failOrphanAdaAudits, but for the PdfAudit table. When a parent
 * SiteAudit is failed, any PdfAudit rows still in `pending` or `scanning` are
 * orphans and would otherwise sit forever. PdfAudit uses `scanError` for its
 * failure message column.
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
 * Shared destructive path for a site audit that cannot proceed: flip the
 * parent to error (conditionally — never clobber a terminal row), cascade
 * orphan children + PDFs, cancel outstanding durable jobs, close the batch
 * if drained, and kick the promoter so the queue slot is released.
 */
export async function failSiteAudit(id: string, message: string): Promise<void> {
  let flipped: number
  try {
    const res = await prisma.siteAudit.updateMany({
      where: { id, status: { notIn: ['complete', 'error', 'cancelled'] } },
      data: { status: 'error', error: message, completedAt: new Date() },
    })
    flipped = res.count
  } catch {
    flipped = 0
  }
  if (flipped === 0) {
    // Parent already terminal (or flip failed) — do not cascade-fail the
    // children/jobs of an audit that completed or was cancelled cleanly.
    void processNext()
    return
  }
  await failOrphanAdaAudits(id).catch(() => {})
  await failOrphanPdfAudits(id).catch(() => {})
  await cancelJobsByGroup(`site-audit:${id}`).catch(() => {})
  const row = await prisma.siteAudit.findUnique({
    where: { id },
    select: { batchId: true },
  }).catch(() => null)
  if (row?.batchId) {
    await closeBatchIfDrained(row.batchId).catch(() => {})
  }
  void processNext()
}

/**
 * Generic transient-parent recovery (all of running / pdfs-running /
 * lighthouse-running — Phase 3 made the page loop durable, so 'running' is
 * no longer special):
 *   outstanding durable jobs → resume (leave alone);
 *   zero jobs → one finalize attempt (drained-but-unfinalized completes);
 *   still transient after that → failSiteAudit.
 * A failed job count NEVER destroys the parent (transient read errors must
 * not bias toward the destructive path) — skip and let the next pass retry.
 */
async function recoverOrFailTransient(
  audit: { id: string; status: string },
  source: string,
  failMessage: string,
): Promise<void> {
  let outstanding: number
  try {
    outstanding = await countActiveJobsByGroup(`site-audit:${audit.id}`)
  } catch (err) {
    console.warn(`[queue] ${source}: job count failed for ${audit.id}, skipping this pass:`, (err as Error).message)
    return
  }
  if (outstanding > 0) {
    console.warn(`[queue] ${source}: resuming audit ${audit.id} (${outstanding} durable job(s) outstanding)`)
    return
  }
  // No active jobs ≠ dead: the last job may have committed its row +
  // counters and the process (or the finalize call) died before
  // finalizeSiteAudit ran. Give the finalizer one chance; only fall
  // through to the fail path if the parent is still transient.
  try {
    await finalizeSiteAudit(audit.id)
  } catch (err) {
    console.warn(`[queue] ${source}: finalize attempt failed for ${audit.id}:`, (err as Error).message)
  }
  const refreshed = await prisma.siteAudit.findUnique({
    where: { id: audit.id },
    select: { status: true },
  })
  if (refreshed?.status === 'complete') {
    console.warn(`[queue] ${source}: finalized drained audit ${audit.id}`)
    return
  }
  if (!refreshed || !(TRANSIENT_STATUSES as readonly string[]).includes(refreshed.status)) return
  console.warn(`[queue] ${source}: failing audit ${audit.id}`)
  await failSiteAudit(audit.id, failMessage)
}

/**
 * Resets transient audits with no DB activity for 5+ minutes and no
 * outstanding durable jobs. Called every 10 min from instrumentation.ts.
 * Job settles bump SiteAudit.updatedAt (the raw-SQL counter bumps set it
 * manually), so a healthy audit never trips this; backoff windows are
 * covered by the outstanding-jobs check.
 */
export async function resetStaleAudits() {
  const STALE_MS = 5 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_MS)
  const stale = await prisma.siteAudit.findMany({
    where: {
      status: { in: [...TRANSIENT_STATUSES] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, status: true },
  })
  for (const s of stale) {
    await recoverOrFailTransient(s, 'Stale check', 'Audit timed out (server may have restarted)')
  }
  if (stale.length > 0) void processNext()

  // Standalone (siteAuditId = null) audits + their PDF rows — C1 remainder.
  // Caught: a standalone-recovery failure must never block site-audit recovery.
  await recoverStandaloneAudits().catch((err) => {
    console.warn('[queue] standalone recovery failed:', (err as Error).message)
  })
}

/**
 * Called once at server startup, AFTER recoverJobsOnStartup() (boot order in
 * instrumentation.ts) — orphaned durable jobs are already re-queued, so a
 * transient parent with outstanding jobs resumes seamlessly. Parents with no
 * jobs get finalize-then-fail. Legacy 'pending' audits are re-queued.
 */
export async function recoverQueue() {
  const orphans = await prisma.siteAudit.findMany({
    where: { status: { in: [...TRANSIENT_STATUSES] } },
    select: { id: true, status: true },
  })
  for (const o of orphans) {
    await recoverOrFailTransient(o, 'Startup recovery', 'Audit interrupted (server restarted)')
  }

  // Also reset any 'pending' audits (legacy status, shouldn't exist with the new queue)
  await prisma.siteAudit.updateMany({
    where: { status: 'pending' },
    data: { status: 'queued' },
  })

  // Standalone (siteAuditId = null) audits + their PDF rows — C1 remainder.
  // Caught: a standalone-recovery failure must never block site-audit recovery.
  await recoverStandaloneAudits().catch((err) => {
    console.warn('[queue] standalone recovery failed:', (err as Error).message)
  })

  // C6: re-enqueue broken-link verifiers stranded by a crash between the audit's
  // terminal write and the fire-and-forget enqueue. Guarded — never blocks recovery.
  await import('./broken-link-recovery')
    .then((m) => m.recoverBrokenLinkVerifies())
    .catch((err) => console.warn('[queue] broken-link verify recovery failed:', (err as Error).message))

  // C10: global stranded SEO-report recovery — re-enqueue seo-report-render jobs
  // for any non-terminal SeoReport whose heartbeat has gone cold. Guarded — never
  // blocks site-audit recovery.
  await import('@/lib/seo-report-recovery')
    .then((m) => m.recoverSeoReports())
    .catch((err) => console.warn('[queue] seo-report recovery failed:', (err as Error).message))

  void processNext()
}
