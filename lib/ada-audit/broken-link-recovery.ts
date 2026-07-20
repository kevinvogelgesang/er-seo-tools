// lib/ada-audit/broken-link-recovery.ts
//
// Closes the fire-and-forget enqueue crash window (C6 spec §5.2): a 'complete'
// SiteAudit with HarvestedLink rows but no verify job and no live-scan run never
// self-heals (finalizeSiteAudit early-returns on 'complete'). Run at boot
// (recoverQueue) and in the 10-min stale-audit sweep.
import { prisma } from '@/lib/db'
import { ensureExhaustedPlaceholder } from '@/lib/findings/exhausted-placeholder'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { enqueueJob } from '@/lib/jobs/queue'
import { JOB_ACTIVE_STATUSES } from '@/lib/jobs/types'

export async function recoverBrokenLinkVerifies(): Promise<number> {
  // Distinct siteAuditIds that still have EITHER transient table populated
  // (the verifier/builder deletes both only on success).
  const [links, seo, deadPages] = await Promise.all([
    prisma.harvestedLink.findMany({ distinct: ['siteAuditId'], select: { siteAuditId: true } }),
    // C12 D1: HarvestedPageSeo now survives past a successful build (retained
    // for the content-audit window), so a populated row no longer means "the
    // builder never finished" on its own. Bound this scan at the DB level to
    // audits with NO seo-parser live-scan run yet -- otherwise every completed
    // audit within its retention window gets re-scanned every 10 min. The
    // per-id `if (liveRun) continue` guard below stays as belt-and-suspenders.
    prisma.harvestedPageSeo.findMany({
      where: { siteAudit: { crawlRuns: { none: { tool: 'seo-parser' } } } },
      distinct: ['siteAuditId'], select: { siteAuditId: true },
    }),
    // sweep-error-triage Bucket 1: a dead-only audit (every page 404/410) can
    // strand with ONLY HarvestedPageError rows. Same DB-level fence as
    // HarvestedPageSeo — once the live-scan run commits, a surviving error row
    // must NOT re-trigger scans (the run deletes them on success; the 7-d prune
    // backstops orphans).
    prisma.harvestedPageError.findMany({
      where: { siteAudit: { crawlRuns: { none: { tool: 'seo-parser' } } } },
      distinct: ['siteAuditId'], select: { siteAuditId: true },
    }),
  ])
  const pending = [...new Set([...links, ...seo, ...deadPages].map((r) => r.siteAuditId))].map((siteAuditId) => ({ siteAuditId }))
  // C11: complete seoOnly audits can strand with ZERO transient rows — if every
  // page failed/redirected (or harvest returned null) and the process crashed
  // after 'complete' but before enqueueBrokenLinkVerify, nothing was written to
  // HarvestedLink/HarvestedPageSeo, so the transient-keyed scan above misses them
  // and no live-scan run is ever built. Union these ids in; the per-id body below
  // still skips any that already have a seo-parser run or an active verifier, and
  // the Set de-dupes a seoOnly audit already covered by transient rows. An
  // empty-harvest verify still writes a clean run (the builder handles it).
  //
  // Codex note (re-enqueue bound): a permanently errored verifier is not "active",
  // so without the self-repair fence below a seoOnly audit whose verify keeps
  // failing would get re-enqueued every sweep. The per-id errored-job check now
  // catches this for ALL candidates (transient-path and seoOnly-zero-harvest
  // alike): a terminal 'error' job repairs the placeholder instead of retrying.
  const seoOnlyComplete = await prisma.siteAudit.findMany({
    where: { seoOnly: true, status: 'complete' },
    select: { id: true },
  })
  const candidateIds = new Set<string>([
    ...pending.map((r) => r.siteAuditId),
    ...seoOnlyComplete.map((s) => s.id),
  ])
  let enqueued = 0
  for (const siteAuditId of candidateIds) {
    const site = await prisma.siteAudit.findUnique({
      where: { id: siteAuditId },
      select: { status: true, domain: true },
    })
    if (!site || site.status !== 'complete') continue
    const liveRun = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { id: true },
    })
    if (liveRun) continue
    const activeJob = await prisma.job.findFirst({
      where: {
        type: BROKEN_LINK_VERIFY_JOB_TYPE,
        groupKey: `site-audit:${siteAuditId}`,
        status: { in: [...JOB_ACTIVE_STATUSES] },
      },
      select: { id: true },
    })
    if (activeJob) continue
    // Spec §3.2 (Codex #1) — self-repair fence: onExhausted hooks are
    // best-effort (runOnExhausted swallows failures), so a crashed placeholder
    // write must be repaired HERE, and an exhausted verifier must never be
    // re-enqueued. Terminal errored job present -> retry the placeholder,
    // skip the enqueue. Active jobs take precedence (checked above).
    const erroredJob = await prisma.job.findFirst({
      where: { type: BROKEN_LINK_VERIFY_JOB_TYPE, groupKey: `site-audit:${siteAuditId}`, status: 'error' },
      select: { id: true },
    })
    if (erroredJob) {
      await ensureExhaustedPlaceholder(siteAuditId)
      continue
    }
    // AWAIT a real enqueue — this sweep closes the fire-and-forget window, so it
    // must confirm the job is durably queued before counting it. dedupKey makes
    // it idempotent against a racing enqueue.
    await enqueueJob({
      type: BROKEN_LINK_VERIFY_JOB_TYPE,
      payload: { siteAuditId, domain: site.domain },
      dedupKey: `${BROKEN_LINK_VERIFY_JOB_TYPE}:${siteAuditId}`,
      groupKey: `site-audit:${siteAuditId}`,
    })
    enqueued++
  }
  if (enqueued > 0) console.log(`[broken-link-verify] recovery re-enqueued ${enqueued} verifier(s)`)
  return enqueued
}
