// lib/jobs/handlers/site-audit-page.ts
//
// Durable-queue page handler for site audits — replaces the in-memory page
// loop that lived in lib/ada-audit/queue-manager.ts (deleted in Phase 3).
// One job per AdaAudit child row; the site-audit-discover handler fans
// these out.
//
// Idempotency: the conditional claim on AdaAudit.status IN
// ('pending','running') re-audits an unfinished page on re-run (crash
// recovery, zombie attempts) and no-ops on settled rows. 'running' is
// claimable because a crashed attempt leaves the row there. The claim-0 path
// repairs the legacy lost-PSI-enqueue window: an 'axe-complete' child whose
// PSI job vanished (crash between settle and enqueue) gets its PSI job
// re-enqueued (dedupKey psi:<adaAuditId> absorbs the case where it exists).
//
// Error semantics (mirrors handlers/psi.ts and pdf-scan.ts):
// - runAxeAudit throwing (navigation failure, axe crash) is a DOMAIN result:
//   the child settles as 'error', pagesError bumps, the job completes — same
//   no-retry-per-page semantics as the legacy loop's catch.
// - DB failures THROW → the queue retries (covers transient SQLITE_BUSY).
// - dispatchPdfScans runs BEFORE the page settle so pdfsTotal is current
//   before pagesComplete signals "this page is settled" (drain invariant).
// - The child settle + SiteAudit counter bumps run in ONE short array-form
//   transaction, raw parent bump FIRST (EXISTS over pre-flip child state),
//   conditional child flip second. NEVER interactive transactions
//   (2026-06-10 write-lock starvation incident). updatedAt is set manually —
//   raw SQL bypasses @updatedAt; storage is integer ms.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { runAxeAudit } from '@/lib/ada-audit/runner'
import { dispatchPdfScans } from '@/lib/ada-audit/pdf-orchestrator'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { enqueuePsiJob } from '@/lib/ada-audit/lighthouse-queue'
import { getLighthouseProvider } from '@/lib/ada-audit/lighthouse-provider'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import type { HarvestedTarget } from '@/lib/ada-audit/link-harvest'

// C6: chunk size for HarvestedLink inserts. 300 targets/page x 5 cols > SQLite's
// 999-variable limit, so chunk at 50 (matches the findings writer).
const HARVEST_CHUNK = 50
function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n))
  return out
}

/**
 * Persist harvested link/image targets — best-effort, fenced to a SUCCESSFUL
 * page settle (callers invoke this only after settlePage() returned true, i.e.
 * this attempt won the flip). Not in the settle txn: harvest is scaffolding for
 * the verifier; a lost row just means that link isn't checked. harvestTruncated
 * is denormalized onto every row so the verifier can recover the run-level flag.
 */
async function persistHarvest(
  siteAuditId: string,
  sourcePageUrl: string,
  targets: HarvestedTarget[],
  truncated: boolean,
): Promise<void> {
  if (!targets || targets.length === 0) return
  const src = normalizeFindingUrl(sourcePageUrl)
  const rows = targets.map((t) => ({
    siteAuditId,
    sourcePageUrl: src,
    targetUrl: t.targetUrl,
    kind: t.kind,
    harvestTruncated: truncated,
  }))
  try {
    for (const data of chunk(rows, HARVEST_CHUNK)) await prisma.harvestedLink.createMany({ data })
  } catch (e) {
    console.warn('[c6] harvest persist failed for', siteAuditId, ':', (e as Error).message)
  }
}

export const SITE_AUDIT_PAGE_JOB_TYPE = 'site-audit-page'

export interface SiteAuditPageJob {
  adaAuditId: string
  siteAuditId: string
  url: string
  wcagLevel: string
}

function assertSiteAuditPagePayload(payload: unknown): SiteAuditPageJob {
  const p = payload as Partial<SiteAuditPageJob> | null
  if (
    !p ||
    typeof p.adaAuditId !== 'string' ||
    typeof p.siteAuditId !== 'string' ||
    typeof p.url !== 'string' ||
    typeof p.wcagLevel !== 'string'
  ) {
    throw new Error('Invalid site-audit-page job payload')
  }
  return p as SiteAuditPageJob
}

// Parent counters this handler may bump — fixed allowlist, never user input,
// safe to splice into raw SQL via Prisma.raw.
type PageCounter = 'pagesComplete' | 'pagesError' | 'pagesRedirected' | 'lighthouseTotal'

/**
 * Atomically settle the child row and bump the matching SiteAudit counters.
 * Returns false when no row matched the claimable statuses (recovery beat
 * us / idempotent re-run). On true, the caller must invoke finalizeSiteAudit
 * (outside the transaction).
 */
async function settlePage(
  job: SiteAuditPageJob,
  counters: PageCounter[], // never empty — every settle bumps at least one
  childData: Prisma.AdaAuditUpdateManyMutationInput,
  claimable: string[],
): Promise<boolean> {
  const bumps = counters.map((c) => `"${c}" = "${c}" + 1`).join(', ')
  const [, flipped] = await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "SiteAudit"
      SET ${Prisma.raw(bumps)}, "updatedAt" = ${Date.now()}
      WHERE "id" = ${job.siteAuditId}
        AND EXISTS (
          SELECT 1 FROM "AdaAudit"
          WHERE "id" = ${job.adaAuditId} AND "status" IN (${Prisma.join(claimable)})
        )`,
    prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: { in: claimable } },
      data: childData,
    }),
  ])
  return flipped.count === 1
}

async function finalizeWarn(siteAuditId: string, context: string): Promise<void> {
  try {
    await finalizeSiteAudit(siteAuditId)
  } catch (err) {
    console.warn(`[jobs/site-audit-page] finalize after ${context} failed:`, (err as Error).message)
  }
}

export async function runSiteAuditPageJob(payload: unknown): Promise<void> {
  const job = assertSiteAuditPagePayload(payload)

  // Claim: pending (normal) or running (crash re-run).
  const claimed = await prisma.adaAudit.updateMany({
    where: { id: job.adaAuditId, status: { in: ['pending', 'running'] } },
    data: { status: 'running', startedAt: new Date() },
  })
  if (claimed.count !== 1) {
    // Already settled (or cascaded by recovery). Repair the two crash
    // windows that leave settled state without follow-through:
    //  - axe-complete with no PSI job (crash between settle and enqueue)
    //  - settled but finalize never ran (crash between settle and finalize)
    const child = await prisma.adaAudit.findUnique({
      where: { id: job.adaAuditId },
      select: { status: true },
    })
    if (child?.status === 'axe-complete') {
      enqueuePsiJob(job)
    }
    await finalizeWarn(job.siteAuditId, 'claim no-op')
    return
  }

  const detachPsi = getLighthouseProvider() === 'pagespeed'

  let runResult: Awaited<ReturnType<typeof runAxeAudit>>
  try {
    runResult = await runAxeAudit(job.url, job.wcagLevel, undefined, {
      auditId: job.adaAuditId,
      siteAudit: detachPsi,
    })
  } catch (err) {
    // Domain failure: settle and complete the job — no per-page retry,
    // matching the legacy loop's catch.
    const msg = err instanceof Error ? err.message : 'Audit failed'
    const settled = await settlePage(
      job,
      ['pagesError'],
      { status: 'error', error: msg, completedAt: new Date() },
      ['running'],
    )
    if (settled) await finalizeWarn(job.siteAuditId, 'axe-error settle')
    return
  }

  if (runResult.kind === 'redirected') {
    const settled = await settlePage(
      job,
      ['pagesRedirected'],
      {
        status: 'redirected',
        finalUrl: runResult.finalUrl,
        redirected: true,
        completedAt: new Date(),
        runnerType: 'browser',
      },
      ['running'],
    )
    if (settled) await finalizeWarn(job.siteAuditId, 'redirect settle')
    return
  }

  const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls, harvestedLinks, harvestedLinksTruncated } = runResult

  // PDFs FIRST: dispatchPdfScans commits PdfAudit rows + pdfsTotal++ and
  // enqueues durable pdf-scan jobs before returning. This must land before
  // the page settle below so the finalizer can never observe
  // pagesComplete=total with pdfsTotal still missing rows.
  await dispatchPdfScans({
    urls: harvestedPdfUrls,
    siteAuditId: job.siteAuditId,
    adaAuditId: job.adaAuditId,
    sourcePageUrl: job.url,
  })

  if (detachPsi) {
    const settled = await settlePage(
      job,
      ['lighthouseTotal', 'pagesComplete'],
      { status: 'axe-complete', result: JSON.stringify(axe), runnerType: 'browser' },
      ['running'],
    )
    if (!settled) return
    enqueuePsiJob(job)
  } else {
    const settled = await settlePage(
      job,
      ['pagesComplete'],
      {
        status: 'complete',
        result: JSON.stringify(axe),
        lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
        lighthouseError,
        runnerType: 'browser',
        completedAt: new Date(),
      },
      ['running'],
    )
    if (!settled) return
  }

  // Reached only when this attempt won the settle (both branches return on
  // !settled) — fence the harvest persistence to that (fix #3).
  await persistHarvest(job.siteAuditId, job.url, harvestedLinks, harvestedLinksTruncated)

  await finalizeWarn(job.siteAuditId, 'page settle')
}

/**
 * Settle a page failure that happened OUTSIDE the audit path — job
 * exhaustion, or a failed durable enqueue (discover handler's fallback).
 * Without this the parent strands in 'running' because finalizeSiteAudit
 * only counts pagesComplete + pagesError + pagesRedirected.
 */
export async function settlePageFailure(payload: unknown, message: string): Promise<void> {
  const job = assertSiteAuditPagePayload(payload)
  const settled = await settlePage(
    job,
    ['pagesError'],
    { status: 'error', error: message, completedAt: new Date() },
    ['pending', 'running'],
  )
  if (!settled) return
  await finalizeWarn(job.siteAuditId, 'failure settle')
}

export async function onSiteAuditPageExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  await settlePageFailure(payload, `Page audit job failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerSiteAuditPageHandler(): void {
  registerJobHandler({
    type: SITE_AUDIT_PAGE_JOB_TYPE,
    concurrency: parsePositiveInt(process.env.SITE_AUDIT_CONCURRENCY, 1),
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    // navigation (30s) + settle (5s) + axe on heavy DOMs + a possible
    // browser-recycle drain wait; with LIGHTHOUSE_PROVIDER=local the inline
    // Lighthouse run holds the page longer — the budget covers that branch.
    timeoutMs: 300_000,
    handler: runSiteAuditPageJob,
    onExhausted: onSiteAuditPageExhausted,
  })
}
