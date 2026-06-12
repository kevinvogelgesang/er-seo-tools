// lib/jobs/handlers/ada-audit.ts
//
// Durable-queue handler for standalone single-page ADA audits — replaces the
// fire-and-forget runAuditInBackground() that lived in
// app/api/ada-audit/route.ts (C1 remainder; spec
// docs/superpowers/specs/2026-06-11-standalone-ada-durable-design.md).
//
// Idempotency: the conditional claim on AdaAudit.status IN
// ('pending','running') re-audits an unfinished standalone audit on re-run
// (crash recovery) and no-ops on settled rows. Every later write — progress
// included — is fenced by status = 'running': first terminal writer wins, so
// a zombie attempt (runAxeAudit ignores the job timeout) can never clobber a
// row recovery or a retry already flipped.
//
// Error semantics (mirrors site-audit-page.ts):
// - runAxeAudit throwing is a DOMAIN result: settle 'error', job completes —
//   same one-shot semantics as the legacy route's catch.
// - DB failures THROW → the queue retries (covers transient SQLITE_BUSY).
// - dispatchPdfScans runs BEFORE the complete settle: a crash between the
//   two re-runs the audit and the dispatch dedupes; settle-first would lose
//   the PDFs forever (the claim guard won't re-enter a 'complete' row).
// - The findings dual-write stays fire-and-forget LAST (A2 invariant).

import { prisma } from '@/lib/db'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { dispatchPdfScans } from '@/lib/ada-audit/pdf-orchestrator'
import { writeAdaSingleFindings } from '@/lib/findings/ada-write'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

export const ADA_AUDIT_JOB_TYPE = 'ada-audit'

export interface AdaAuditJob {
  adaAuditId: string
  url: string
  wcagLevel: string
}

function assertAdaAuditPayload(payload: unknown): AdaAuditJob {
  const p = payload as Partial<AdaAuditJob> | null
  if (
    !p ||
    typeof p.adaAuditId !== 'string' ||
    typeof p.url !== 'string' ||
    typeof p.wcagLevel !== 'string'
  ) {
    throw new Error('Invalid ada-audit job payload')
  }
  return p as AdaAuditJob
}

function dualWriteFindings(id: string): void {
  void writeAdaSingleFindings(id).catch((e) => {
    console.error('[findings] dual-write failed for ada audit', id, e)
  })
}

export async function runAdaAuditJob(payload: unknown): Promise<void> {
  const job = assertAdaAuditPayload(payload)

  // Claim: pending (normal) or running (crash re-run). Count 0 → settled.
  // siteAuditId: null — a malformed/manual ada-audit job pointing at a
  // site-audit child must never bypass the parent counters/finalizer.
  const claimed = await prisma.adaAudit.updateMany({
    where: { id: job.adaAuditId, siteAuditId: null, status: { in: ['pending', 'running'] } },
    data: { status: 'running', startedAt: new Date(), progress: 0, progressMessage: 'Starting…' },
  })
  if (claimed.count !== 1) return

  const onProgress = async (progress: number, progressMessage: string) => {
    await prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'running' },
      data: { progress, progressMessage },
    }).catch(() => {})
  }

  let result: Awaited<ReturnType<typeof runAxeAudit>>
  try {
    result = await runAxeAudit(job.url, job.wcagLevel, onProgress, { auditId: job.adaAuditId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[jobs/ada-audit] id=${job.adaAuditId} url=${job.url} error:`, err)
    await prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'running' },
      data: { status: 'error', error: message, completedAt: new Date() },
    })
    return
  }

  if (result.kind === 'redirected') {
    const settled = await prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'running' },
      data: {
        status: 'redirected',
        finalUrl: result.finalUrl,
        redirected: true,
        progress: 100,
        progressMessage: 'Redirected',
        runnerType: 'browser',
        completedAt: new Date(),
      },
    })
    if (settled.count === 1) dualWriteFindings(job.adaAuditId)
    return
  }

  const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = result

  // PDFs FIRST — see header. Standalone completion is NOT gated on PDFs;
  // they update PdfAudit rows in the background via durable pdf-scan jobs.
  await dispatchPdfScans({
    urls: harvestedPdfUrls,
    adaAuditId: job.adaAuditId,
    sourcePageUrl: job.url,
  })

  const settled = await prisma.adaAudit.updateMany({
    where: { id: job.adaAuditId, status: 'running' },
    data: {
      status: 'complete',
      result: JSON.stringify(axe),
      lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
      lighthouseError,
      progress: 100,
      progressMessage: 'Complete',
      runnerType: 'browser',
      completedAt: new Date(),
    },
  })
  if (settled.count === 1) dualWriteFindings(job.adaAuditId)
}

/**
 * Flip a standalone audit to error unless it already settled. Used by
 * onExhausted and the POST route's enqueue-failure fallback. The
 * siteAuditId: null guard means this can never touch a site-audit child.
 */
export async function failStandaloneAudit(adaAuditId: string, message: string): Promise<void> {
  await prisma.adaAudit.updateMany({
    where: { id: adaAuditId, siteAuditId: null, status: { in: ['pending', 'running'] } },
    data: { status: 'error', error: message, completedAt: new Date() },
  })
}

export async function onAdaAuditExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  const job = assertAdaAuditPayload(payload)
  await failStandaloneAudit(job.adaAuditId, `Audit job failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerAdaAuditHandler(): void {
  registerJobHandler({
    type: ADA_AUDIT_JOB_TYPE,
    concurrency: parsePositiveInt(process.env.ADA_AUDIT_CONCURRENCY, 2),
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    // navigation (30s) + settle (5s) + axe + inline Lighthouse (standalone
    // audits run LH inside runAxeAudit regardless of provider) — same budget
    // as site-audit-page's local-LH branch.
    timeoutMs: 300_000,
    handler: runAdaAuditJob,
    onExhausted: onAdaAuditExhausted,
  })
}
