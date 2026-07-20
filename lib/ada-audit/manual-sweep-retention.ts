// lib/ada-audit/manual-sweep-retention.ts
//
// Retention for manual-sweep-originated SiteAudits (requestedBy='manual-sweep',
// scheduleId=null — deliberately OUT of pruneScheduledSiteAudits' per-(schedule,
// domain) pool so frequent manual sweeps can never prune a Sunday audit before
// the Monday digest reads it). Keep the latest N completed per (client,domain),
// delete older past TTL, and NEVER delete an audit still referenced by an
// unsnapshotted manual WeeklySweep. Mirrors pruneScheduledSiteAudits' artifact
// cleanup seam (report PDF + hero screenshot); CrawlRun findings survive via
// SetNull. In runCleanup().

import { prisma } from '@/lib/db'
import { deleteReportFile } from '@/lib/report/report-file'
import { deleteHeroScreenshot } from '@/lib/sales/hero-screenshot'
import { parseMembership } from '@/lib/sweep/types'
import { parsePositiveInt } from '@/lib/jobs/config'
import { logError } from '@/lib/log'

export const MANUAL_SWEEP_AUDIT_KEEP = parsePositiveInt(process.env.MANUAL_SWEEP_AUDIT_KEEP, 2)
export const MANUAL_SWEEP_AUDIT_TTL_MS = parsePositiveInt(process.env.MANUAL_SWEEP_AUDIT_TTL_MS, 14 * 24 * 60 * 60 * 1000)
const TERMINAL = ['complete', 'error', 'cancelled']
const CHUNK = 25

export async function pruneManualSweepAudits(now: Date = new Date()): Promise<void> {
  // Never delete an audit still referenced by an unsnapshotted manual sweep.
  const live = await prisma.weeklySweep.findMany({
    where: { origin: 'manual', snapshotJson: null },
    select: { membershipJson: true },
  })
  const protectedIds = new Set<string>()
  for (const s of live) {
    // Fail CLOSED on a corrupt (non-null, unparseable) membership — a silently
    // skipped row would leave protectedIds incomplete and could delete a
    // still-referenced audit.
    if (s.membershipJson !== null && parseMembership(s.membershipJson) === null) {
      logError(
        { subsystem: 'sweep', scope: 'pruneManualSweepAudits.corruptMembership' },
        new Error('aborting prune pass — corrupt in-flight manual membership'),
      )
      return
    }
    const m = parseMembership(s.membershipJson)
    m?.members.forEach((mem) => mem.siteAuditId && protectedIds.add(mem.siteAuditId))
  }

  const completed = await prisma.siteAudit.findMany({
    where: { requestedBy: 'manual-sweep', status: 'complete' },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, domain: true, clientId: true },
  })
  const keptPerKey = new Map<string, number>()
  const keepIds = new Set<string>()
  for (const a of completed) {
    const key = `${a.clientId ?? 'null'}\x00${a.domain}`
    const count = keptPerKey.get(key) ?? 0
    if (count >= MANUAL_SWEEP_AUDIT_KEEP) continue
    keepIds.add(a.id)
    keptPerKey.set(key, count + 1)
  }

  const cutoff = new Date(now.getTime() - MANUAL_SWEEP_AUDIT_TTL_MS)
  const candidates = await prisma.siteAudit.findMany({
    where: {
      requestedBy: 'manual-sweep',
      status: { in: TERMINAL },
      createdAt: { lt: cutoff },
      id: { notIn: [...keepIds, ...protectedIds] },
    },
    select: { id: true },
  })
  if (candidates.length === 0) return

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const ids = candidates.slice(i, i + CHUNK).map((c) => c.id)
    // Children cascade (AdaAudit/PdfAudit/checks); CrawlRun.siteAuditId is SetNull.
    await prisma.siteAudit.deleteMany({ where: { id: { in: ids } } })
    const cleanup = await Promise.allSettled(ids.flatMap((rid) => [deleteReportFile(rid), deleteHeroScreenshot(rid)]))
    for (const r of cleanup) {
      if (r.status === 'rejected') console.warn('[manual-sweep-retention] file cleanup failed:', r.reason)
    }
  }
  console.log(`[manual-sweep-retention] pruned ${candidates.length} manual-sweep audit(s)`)
}
