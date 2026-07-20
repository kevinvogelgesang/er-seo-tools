// lib/sweep/advance.ts
//
// Compute-on-drain for manual sweeps + orphan recovery. Called from
// stale-audit-reset (every 10 min) and recoverQueue (boot), each through a
// caught dynamic import — these functions never throw into their caller.
//
// A manual sweep has no fixed digest time; its snapshot is computed once its
// cohort's audits drain (all terminal, and each complete full audit has BOTH
// its ada-audit and seo-parser runs), or a max-wait cap elapses. The baseline
// is the most recent SCHEDULED sweep (loadPreviousScheduledSnapshot). No email.

import { prisma } from '@/lib/db'
import { parseMembership, type SweepMember } from '@/lib/sweep/types'
import { computeSweepSnapshot, publishSweepSnapshot, loadPreviousScheduledSnapshot } from '@/lib/sweep/snapshot'
import { enqueueJob } from '@/lib/jobs/queue'
import { MANUAL_SWEEP_JOB_TYPE } from '@/lib/jobs/handlers/manual-sweep'
import { parsePositiveInt } from '@/lib/jobs/config'
import { logError } from '@/lib/log'

const TERMINAL = ['complete', 'error', 'cancelled'] // SiteAudit has NO 'failed' status
// Never Number(env)||fallback — that accepts negatives (would publish immediately).
export const MANUAL_SWEEP_MAX_WAIT_MS = parsePositiveInt(
  process.env.MANUAL_SWEEP_MAX_WAIT_MS,
  13 * 60 * 60 * 1000, // 13h — matches the scheduled fan-out→digest window
)
// A manual row younger than this is still inside the route's create→enqueue
// window — recovery must not race it.
const RECOVERY_GRACE_MS = 2 * 60 * 1000

interface AuditSettle {
  status: string
  hasAda: boolean
  hasSeo: boolean
  seoOnly: boolean
}

/** Load status + run existence for a set of siteAuditIds, ONCE each (shared-domain safe). */
async function loadAuditSettles(ids: string[]): Promise<Map<string, AuditSettle>> {
  const out = new Map<string, AuditSettle>()
  if (ids.length === 0) return out
  const audits = await prisma.siteAudit.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, seoOnly: true },
  })
  const runs = await prisma.crawlRun.findMany({
    where: { siteAuditId: { in: ids }, tool: { in: ['ada-audit', 'seo-parser'] } },
    select: { siteAuditId: true, tool: true },
  })
  const runsBy = new Map<string, Set<string>>()
  for (const r of runs) {
    if (!r.siteAuditId) continue
    const s = runsBy.get(r.siteAuditId) ?? new Set<string>()
    s.add(r.tool)
    runsBy.set(r.siteAuditId, s)
  }
  for (const a of audits) {
    const s = runsBy.get(a.id) ?? new Set<string>()
    out.set(a.id, { status: a.status, seoOnly: a.seoOnly, hasAda: s.has('ada-audit'), hasSeo: s.has('seo-parser') })
  }
  return out
}

/**
 * Drain state for a manual cohort.
 * - skipped-archived / skipped-delisted → out of cohort (never block).
 * - siteAuditId === null: invalid-domain / skipped-conflict / error → settled-failed;
 *   pending / enqueued / duplicate / shared-domain with a null id is an INVARIANT
 *   VIOLATION → block + record (should never happen post-fanout).
 * - siteAuditId set but audit row GONE → settled-failed (it cannot reappear;
 *   computeSweepSnapshot classifies its runs as missing → failed coverage).
 * - complete full (¬seoOnly) audit → needs BOTH ada-audit AND seo-parser runs.
 * - complete seoOnly audit → needs the seo-parser run.
 */
function drainState(members: SweepMember[], settles: Map<string, AuditSettle>): { drained: boolean; violations: string[] } {
  const violations: string[] = []
  let drained = true
  for (const m of members) {
    if (m.outcome === 'skipped-archived' || m.outcome === 'skipped-delisted') continue
    if (m.siteAuditId === null) {
      if (m.outcome === 'invalid-domain' || m.outcome === 'skipped-conflict' || m.outcome === 'error') continue // settled-failed
      violations.push(`${m.domain}:${m.outcome}:null-id`)
      drained = false
      continue
    }
    const st = settles.get(m.siteAuditId)
    if (!st) continue // audit row gone → settled-failed (cannot reappear)
    if (!TERMINAL.includes(st.status)) {
      drained = false
      continue
    }
    if (st.status === 'complete') {
      if (st.seoOnly) {
        if (!st.hasSeo) drained = false
      } else if (!(st.hasAda && st.hasSeo)) {
        drained = false
      }
    }
  }
  return { drained, violations }
}

export async function advanceManualSweeps(now: Date = new Date()): Promise<void> {
  // The partial unique index guarantees AT MOST ONE unsnapshotted manual row,
  // so `candidates` has length ≤ 1 — the loop is defensive, not for concurrency.
  const candidates = await prisma.weeklySweep.findMany({
    where: { origin: 'manual', snapshotJson: null, fanoutCompletedAt: { not: null } },
  })
  for (const sweep of candidates) {
    try {
      const membership = parseMembership(sweep.membershipJson)
      if (!membership) {
        // A corrupt (non-null, unparseable) membership on a fanout-completed row
        // would otherwise loop forever — abandon it under an origin/snapshot fence.
        if (sweep.membershipJson !== null) {
          logError(
            { subsystem: 'sweep', scope: 'advanceManualSweeps.corruptMembership' },
            new Error(`manual sweep ${sweep.id} membership corrupt — abandoning`),
          )
          await prisma.weeklySweep.deleteMany({ where: { id: sweep.id, origin: 'manual', snapshotJson: null } })
        }
        continue
      }
      const ids = Array.from(new Set(membership.members.map((m) => m.siteAuditId).filter((x): x is string => !!x)))
      const settles = await loadAuditSettles(ids)
      const { drained, violations } = drainState(membership.members, settles)
      const maxWaitExceeded = now.getTime() - sweep.fanoutCompletedAt!.getTime() > MANUAL_SWEEP_MAX_WAIT_MS
      if (violations.length > 0) {
        logError(
          { subsystem: 'sweep', scope: 'advanceManualSweeps.invariant' },
          new Error(`manual sweep ${sweep.id} null-id members: ${violations.join(',')}`),
        )
      }
      if (!drained && !maxWaitExceeded) continue
      if (!drained && maxWaitExceeded) {
        logError(
          { subsystem: 'sweep', scope: 'advanceManualSweeps.maxWait' },
          new Error(`manual sweep ${sweep.id} not drained after max-wait; computing anyway`),
        )
      }
      const previous = await loadPreviousScheduledSnapshot(sweep.scheduledFor)
      const snapshot = await computeSweepSnapshot(sweep, previous, now)
      await publishSweepSnapshot(sweep.id, snapshot) // NO email
    } catch (err) {
      logError({ subsystem: 'sweep', scope: 'advanceManualSweeps' }, err) // fault isolation
    }
  }
}

/**
 * Recover a manual fan-out stranded by a crash BETWEEN the route's row-create
 * and enqueue: membership never frozen. Guards:
 *  - GRACE: ignore rows younger than RECOVERY_GRACE_MS (still inside the route window).
 *  - Query ALL jobs for the group (any status), not just active. Re-enqueue ONLY
 *    when NO job row ever landed. If a TERMINAL job exists (the handler ran and
 *    failed/exhausted), do NOT re-enqueue forever — abandon the membership-null
 *    row (fenced delete) to free the slot.
 */
export async function recoverManualSweeps(now: Date = new Date()): Promise<void> {
  try {
    const graceCutoff = new Date(now.getTime() - RECOVERY_GRACE_MS)
    const stranded = await prisma.weeklySweep.findMany({
      where: { origin: 'manual', snapshotJson: null, membershipJson: null, createdAt: { lt: graceCutoff } },
      select: { id: true, scheduledFor: true },
    })
    for (const s of stranded) {
      const iso = s.scheduledFor.toISOString()
      const anyJob = await prisma.job.findFirst({
        where: { type: MANUAL_SWEEP_JOB_TYPE, groupKey: `manual-sweep:${iso}` },
        select: { id: true, status: true },
      })
      if (!anyJob) {
        // True crash-before-enqueue — re-enqueue the fan-out.
        await enqueueJob({
          type: MANUAL_SWEEP_JOB_TYPE,
          payload: { scheduledFor: iso },
          dedupKey: `manual-sweep:${iso}`,
          groupKey: `manual-sweep:${iso}`,
        })
      } else if (anyJob.status === 'error' || anyJob.status === 'cancelled' || anyJob.status === 'complete') {
        // A terminal job ran but membership is still null — abandon rather than
        // re-enqueue forever.
        await prisma.weeklySweep.deleteMany({
          where: { id: s.id, origin: 'manual', snapshotJson: null, membershipJson: null },
        })
      }
      // active job (queued/running) → leave it alone.
    }
  } catch (err) {
    logError({ subsystem: 'sweep', scope: 'recoverManualSweeps' }, err)
  }
}
