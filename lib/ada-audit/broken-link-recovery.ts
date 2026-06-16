// lib/ada-audit/broken-link-recovery.ts
//
// Closes the fire-and-forget enqueue crash window (C6 spec §5.2): a 'complete'
// SiteAudit with HarvestedLink rows but no verify job and no live-scan run never
// self-heals (finalizeSiteAudit early-returns on 'complete'). Run at boot
// (recoverQueue) and in the 10-min stale-audit sweep.
import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { enqueueJob } from '@/lib/jobs/queue'
import { JOB_ACTIVE_STATUSES } from '@/lib/jobs/types'

export async function recoverBrokenLinkVerifies(): Promise<number> {
  // Distinct siteAuditIds that still have harvest rows (verifier never deleted them).
  const pending = await prisma.harvestedLink.findMany({
    distinct: ['siteAuditId'],
    select: { siteAuditId: true },
  })
  let enqueued = 0
  for (const { siteAuditId } of pending) {
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
