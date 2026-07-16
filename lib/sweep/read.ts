// lib/sweep/read.ts
//
// Task 12 (D8 weekly client sweep): the /issues read path. Serves the newest
// WeeklySweep row whose snapshotJson parses as a valid SweepSnapshot — a
// corrupt (non-null but unparseable) newest snapshot falls back to the next
// older valid one, never surfacing partial/garbage data. `inProgress` is a
// narrow signal: true only when a row STRICTLY NEWER than the served one has
// `snapshotJson: null` (a sweep that hasn't computed its snapshot yet) — a
// corrupt row is not "in progress", it's just broken, and doesn't set it.
//
// Bounded scan: WeeklySweep is one row per calendar week, so the newest
// SCAN_LIMIT rows are more than enough headroom for "how far back would we
// ever need to look for a valid snapshot" without an unbounded table scan.

import { prisma } from '@/lib/db'
import { parseSnapshot, type IssueGroup, type PairCoverage, type SweepSnapshot } from './types'

export interface IssuesPayload {
  sweep: {
    scheduledFor: string
    startedAt: string | null
    snapshotAt: string
    totals: SweepSnapshot['totals']
  } | null
  inProgress: boolean // a newer sweep exists without a snapshot
  shortlist: IssueGroup[]
  groups: IssueGroup[]
  staleGroups: IssueGroup[]
  resolvedGroups: SweepSnapshot['resolvedGroups']
  notComparable: PairCoverage[]
}

const SCAN_LIMIT = 10

const EMPTY_PAYLOAD_ARRAYS = {
  shortlist: [] as IssueGroup[],
  groups: [] as IssueGroup[],
  staleGroups: [] as IssueGroup[],
  resolvedGroups: [] as SweepSnapshot['resolvedGroups'],
  notComparable: [] as PairCoverage[],
}

export async function loadIssuesPayload(): Promise<IssuesPayload> {
  const rows = await prisma.weeklySweep.findMany({
    orderBy: { scheduledFor: 'desc' },
    take: SCAN_LIMIT,
    select: { scheduledFor: true, startedAt: true, snapshotJson: true },
  })

  let inProgress = false
  let served: { scheduledFor: Date; startedAt: Date | null } | null = null
  let snapshot: SweepSnapshot | null = null

  for (const row of rows) {
    if (row.snapshotJson === null) {
      // No snapshot yet; every row scanned before we find a valid one is, by
      // construction of the desc scan, strictly newer than whatever gets served.
      inProgress = true
      continue
    }
    const parsed = parseSnapshot(row.snapshotJson)
    if (parsed) {
      served = { scheduledFor: row.scheduledFor, startedAt: row.startedAt }
      snapshot = parsed
      break
    }
    // Corrupt (non-null, unparseable) — skip; not a progress signal, not servable.
  }

  if (!served || !snapshot) {
    return { sweep: null, inProgress, ...EMPTY_PAYLOAD_ARRAYS }
  }

  return {
    sweep: {
      scheduledFor: served.scheduledFor.toISOString(),
      startedAt: served.startedAt ? served.startedAt.toISOString() : null,
      snapshotAt: snapshot.snapshotAt,
      totals: snapshot.totals,
    },
    inProgress,
    shortlist: snapshot.shortlist,
    groups: snapshot.groups,
    staleGroups: snapshot.staleGroups,
    resolvedGroups: snapshot.resolvedGroups,
    notComparable: snapshot.coverage.filter((c) => c.state === 'failed' || c.state === 'partial'),
  }
}
