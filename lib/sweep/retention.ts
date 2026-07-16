// lib/sweep/retention.ts
//
// Task 11: WeeklySweep retention, run daily inside runCleanup(). There is no
// per-client scoping here — WeeklySweep is a single global sequence, one row
// per calendar week — so both rules operate over the whole table.
//
//  1. Keep the newest WEEKLY_SWEEP_SNAPSHOT_KEEP rows (ranked by
//     scheduledFor desc) that have a published snapshotJson; delete older
//     snapshotted rows. Rank-based, not age-based — a row can be well past
//     the dead-sweep TTL and still survive because it's within the newest N.
//  2. Delete "dead" sweeps — snapshotJson AND digestSentAt both still null —
//     once their scheduledFor slot is more than WEEKLY_SWEEP_DEAD_TTL_MS in
//     the past. A young dead sweep is the current in-progress week (the
//     fan-out has started but the snapshot isn't published/sent until the
//     Monday digest fires) and must never be swept just for being
//     unfinished.
//
// The two rules are disjoint by construction: rule 1 only ever touches rows
// with snapshotJson NOT NULL; rule 2 only ever touches rows with
// snapshotJson NULL. Neither can delete a row the other rule protects.

import { prisma } from '@/lib/db'

/** Roughly 6 months of weekly snapshots. */
export const WEEKLY_SWEEP_SNAPSHOT_KEEP = 26

/** Dead (unfinished, un-sent) sweeps older than this are considered abandoned. */
export const WEEKLY_SWEEP_DEAD_TTL_MS = 14 * 24 * 60 * 60 * 1000

export async function pruneWeeklySweeps(now: Date = new Date()): Promise<void> {
  const deadCutoff = new Date(now.getTime() - WEEKLY_SWEEP_DEAD_TTL_MS)

  const snapshotPruned = await prisma.$executeRaw`
    DELETE FROM "WeeklySweep"
    WHERE "snapshotJson" IS NOT NULL
      AND "id" NOT IN (
        SELECT "id" FROM "WeeklySweep"
        WHERE "snapshotJson" IS NOT NULL
        ORDER BY "scheduledFor" DESC
        LIMIT ${WEEKLY_SWEEP_SNAPSHOT_KEEP}
      )
  `
  const deadPruned = await prisma.weeklySweep.deleteMany({
    where: { scheduledFor: { lt: deadCutoff }, snapshotJson: null, digestSentAt: null },
  })

  if (snapshotPruned > 0 || deadPruned.count > 0) {
    console.log(`[sweep] retention pruned ${snapshotPruned} old snapshot(s), ${deadPruned.count} dead sweep(s)`)
  }
}
