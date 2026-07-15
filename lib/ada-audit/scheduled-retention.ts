// lib/ada-audit/scheduled-retention.ts
//
// C2 cadence-aware retention (the DB-growth gate): schedule-originated
// SiteAudits accumulate without human intent, so they get a deletion
// policy manual audits don't have. Deleting the origin row cascades the
// blob-heavy children (AdaAudit + checks + PdfAudits); the CrawlRun
// subtree survives (origin FK SetNull) — scores/findings/trends are
// permanent, only the blob-backed results view ages out. On-disk
// screenshots are collected by the existing screenshot sweep (it removes
// directories whose AdaAudit row is gone). Report PDFs have NO sweep of
// their own, so they're deleted here explicitly (best-effort, from the
// pre-delete id snapshot) right after each chunk's deleteMany.
//
// Active immediately (no inert flag): scheduleId is new in this PR, so no
// pre-existing rows can match. Orphaned scheduled audits (schedule deleted
// → SetNull) are manual-class and never pruned here.

import { prisma } from '@/lib/db'
import { cadenceClass, type CadenceClass } from '@/lib/jobs/scheduler'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'
import { deleteReportFile } from '@/lib/report/report-file'
import { deleteHeroScreenshot } from '@/lib/sales/hero-screenshot'

/** ≈ a dozen retained runs per schedule at any cadence. 'daily' is
 * unreachable in v1 (CRUD rejects daily-class cadences) but priced in. */
export const RETENTION_DAYS: Record<CadenceClass, number> = {
  daily: 14,
  weekly: 90,
  monthly: 365,
}

/** Most recent completed audits per schedule that are never pruned —
 * preserves the latest results view and the carry-forward source. */
export const KEEP_LATEST_COMPLETED = 2

const TERMINAL = ['complete', 'error', 'cancelled']
const DAY_MS = 86_400_000
const CHUNK = 25

export async function pruneScheduledSiteAudits(now: Date = new Date()): Promise<void> {
  const schedules = await prisma.schedule.findMany({
    where: { jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, siteAudits: { some: {} } },
    select: { id: true, cadence: true },
  })
  for (const sched of schedules) {
    let cls: CadenceClass
    try {
      cls = cadenceClass(sched.cadence)
    } catch {
      cls = 'monthly' // unparseable cadence → most conservative window
    }
    const cutoff = new Date(now.getTime() - RETENTION_DAYS[cls] * DAY_MS)

    const keep = await prisma.siteAudit.findMany({
      where: { scheduleId: sched.id, status: 'complete' },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: KEEP_LATEST_COMPLETED,
      select: { id: true },
    })
    const candidates = await prisma.siteAudit.findMany({
      where: {
        scheduleId: sched.id,
        status: { in: TERMINAL },
        createdAt: { lt: cutoff },
        id: { notIn: keep.map((k) => k.id) },
      },
      select: { id: true },
    })
    if (candidates.length === 0) continue

    for (let i = 0; i < candidates.length; i += CHUNK) {
      const ids = candidates.slice(i, i + CHUNK).map((c) => c.id)
      // Children cascade at the DB level (AdaAudit/PdfAudit/checks);
      // CrawlRun.siteAuditId is SetNull — findings survive.
      await prisma.siteAudit.deleteMany({ where: { id: { in: ids } } })
      // Report PDFs have no sweep of their own (screenshots age out via the
      // 24-h sweep; reports don't) — delete from the pre-delete snapshot.
      // C14 hero (spec Codex fix 3c): prospect audits are manual-class and never
      // pruned here, but the artifact hook keeps "audit row gone ⇒ hero file gone"
      // true everywhere.
      const fileCleanup = await Promise.allSettled(
        ids.flatMap((rid) => [deleteReportFile(rid), deleteHeroScreenshot(rid)]),
      )
      for (const r of fileCleanup) {
        if (r.status === 'rejected') console.warn('[retention] report file cleanup failed:', r.reason)
      }
    }
    console.log(`[retention] pruned ${candidates.length} scheduled audit(s) (schedule ${sched.id}, ${cls} window)`)
  }
}
