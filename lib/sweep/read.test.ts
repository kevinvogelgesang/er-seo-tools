// lib/sweep/read.test.ts
//
// Task 12 (D8 weekly client sweep): the /issues read path. DB-backed over the
// shared worker DB (see test/setup-worker.ts) — every row is seeded at a
// far-future slot strictly newer than any other sweep test file's anchor
// (retention.test.ts uses +60y, sweep-digest/client-sweep use +10y) so this
// suite's `findMany(orderBy scheduledFor desc, take 10)` window is NEVER
// polluted by another file's leftover rows, regardless of run order or
// worker assignment. The "no valid snapshot anywhere" case seeds exactly 10
// (== SCAN_LIMIT) consecutive-day rows so they alone fill the scan window.

import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import type { IssueGroup, PairCoverage, ResolvedIssueGroup, SweepSnapshot } from './types'
import { loadIssuesPayload } from './read'

const DAY_MS = 24 * 60 * 60 * 1000
const allSlots: Date[] = []
let dayCounter = 0

function nextSlot(): Date {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 70) // strictly ahead of every other sweep test anchor
  d.setHours(4, 0, 0, 0)
  d.setDate(d.getDate() + dayCounter++)
  allSlots.push(d)
  return d
}

function mkGroup(overrides: Partial<IssueGroup> = {}): IssueGroup {
  return {
    clientId: 1,
    domain: 'read-test.example',
    tool: 'seo-parser',
    type: 'missing_title',
    severity: 'critical',
    unit: 'pages',
    affectedCount: 3,
    approximate: false,
    clientName: 'Read Test Client',
    title: 'Missing title tag',
    changeState: 'new',
    delta: 3,
    streak: 1,
    severityChanged: null,
    coverageState: 'comparable',
    lastObservedAt: new Date().toISOString(),
    siteAuditId: 'audit_1',
    liveScanRunId: 'run_1',
    ...overrides,
  }
}

function mkResolved(overrides: Partial<ResolvedIssueGroup> = {}): ResolvedIssueGroup {
  return {
    clientId: 1,
    clientName: 'Read Test Client',
    domain: 'read-test.example',
    tool: 'seo-parser',
    type: 'thin_content',
    title: 'Thin content',
    severity: 'warning',
    priorCount: 2,
    unit: 'pages',
    siteAuditId: 'audit_1',
    liveScanRunId: 'run_1',
    ...overrides,
  }
}

function mkCoverage(overrides: Partial<PairCoverage> = {}): PairCoverage {
  return {
    clientId: 1,
    domain: 'read-test.example',
    tool: 'seo-parser',
    state: 'comparable',
    reason: null,
    baselineAvailable: true,
    siteAuditId: 'audit_1',
    runId: 'run_1',
    ...overrides,
  }
}

function mkSnapshot(overrides: Partial<SweepSnapshot> = {}): SweepSnapshot {
  return {
    v: 1,
    snapshotAt: new Date().toISOString(),
    totals: {
      actionable: 1,
      delta: 1,
      comparablePairs: 1,
      newCount: 1,
      worsenedCount: 0,
      resolvedCount: 0,
      scanned: 1,
      expected: 1,
      comparableDomains: 1,
      partialDomains: 0,
      failedDomains: 0,
    },
    coverage: [mkCoverage()],
    groups: [mkGroup()],
    staleGroups: [],
    resolvedGroups: [],
    shortlist: [mkGroup()],
    semanticKeys: [],
    ...overrides,
  }
}

async function seed(
  slot: Date,
  opts: { snapshotJson?: string | null; startedAt?: Date | null; origin?: 'scheduled' | 'manual' } = {},
): Promise<void> {
  await prisma.weeklySweep.create({
    data: {
      scheduledFor: slot,
      origin: opts.origin ?? 'scheduled',
      startedAt: opts.startedAt ?? null,
      snapshotJson: opts.snapshotJson ?? null,
      snapshotAt: opts.snapshotJson ? slot : null,
    },
  })
}

afterAll(async () => {
  await prisma.weeklySweep.deleteMany({ where: { scheduledFor: { in: allSlots } } })
})

describe('loadIssuesPayload', () => {
  it('serves the newest snapshot of ANY origin and reports its origin (manual after scheduled)', async () => {
    const sched = nextSlot()
    await seed(sched, { snapshotJson: JSON.stringify(mkSnapshot()), startedAt: sched, origin: 'scheduled' })
    const manual = nextSlot() // strictly newer
    await seed(manual, { snapshotJson: JSON.stringify(mkSnapshot()), startedAt: manual, origin: 'manual' })

    const payload = await loadIssuesPayload()
    expect(payload.sweep?.origin).toBe('manual')
    expect(payload.sweep?.scheduledFor).toBe(manual.toISOString())
    expect(payload.inProgress).toBe(false)
  })

  it('serves the newest VALID snapshot and reports inProgress when a strictly newer null-snapshot row exists', async () => {
    const served = nextSlot()
    const snapshot = mkSnapshot({
      coverage: [
        mkCoverage({ state: 'comparable' }),
        mkCoverage({ state: 'partial', domain: 'partial.example' }),
        mkCoverage({ state: 'failed', domain: 'failed.example' }),
      ],
      resolvedGroups: [mkResolved()],
      staleGroups: [mkGroup({ changeState: 'stale', domain: 'stale.example' })],
    })
    await seed(served, { snapshotJson: JSON.stringify(snapshot), startedAt: served })

    const newer = nextSlot() // strictly newer, no snapshot yet — sweep in progress
    await seed(newer, { snapshotJson: null, startedAt: newer })

    const payload = await loadIssuesPayload()

    expect(payload.inProgress).toBe(true)
    expect(payload.sweep).not.toBeNull()
    expect(payload.sweep?.scheduledFor).toBe(served.toISOString())
    expect(payload.sweep?.startedAt).toBe(served.toISOString())
    expect(payload.sweep?.snapshotAt).toBe(snapshot.snapshotAt)
    expect(payload.sweep?.totals).toEqual(snapshot.totals)
    expect(payload.groups).toEqual(snapshot.groups)
    expect(payload.shortlist).toEqual(snapshot.shortlist)
    expect(payload.staleGroups).toEqual(snapshot.staleGroups)
    expect(payload.resolvedGroups).toEqual(snapshot.resolvedGroups)
    // notComparable = coverage entries in 'failed' or 'partial' state only.
    expect(payload.notComparable).toHaveLength(2)
    expect(payload.notComparable.map((c) => c.state).sort()).toEqual(['failed', 'partial'])
  })

  it('falls back to an older valid snapshot when the newest row is corrupt (non-null, unparseable)', async () => {
    const older = nextSlot()
    const snapshot = mkSnapshot()
    await seed(older, { snapshotJson: JSON.stringify(snapshot) })

    const corruptNewest = nextSlot()
    await seed(corruptNewest, { snapshotJson: '{not valid json' })

    const payload = await loadIssuesPayload()

    expect(payload.sweep?.scheduledFor).toBe(older.toISOString())
    // The corrupt row is non-null, not a "sweep in progress" signal.
    expect(payload.inProgress).toBe(false)
  })

  it('falls back past a structurally-wrong (v mismatch) newest row to the older valid one', async () => {
    const older = nextSlot()
    const snapshot = mkSnapshot()
    await seed(older, { snapshotJson: JSON.stringify(snapshot) })

    const wrongShapeNewest = nextSlot()
    await seed(wrongShapeNewest, { snapshotJson: JSON.stringify({ v: 2, bogus: true }) })

    const payload = await loadIssuesPayload()

    expect(payload.sweep?.scheduledFor).toBe(older.toISOString())
    expect(payload.inProgress).toBe(false)
  })

  it('returns sweep:null with empty arrays when no valid snapshot exists in the scan window', async () => {
    // Exactly SCAN_LIMIT (10) consecutive-day rows, all corrupt (non-null) —
    // fills the whole scan window with rows this test controls, so no other
    // file's leftover rows are ever consulted.
    for (let i = 0; i < 10; i++) {
      const slot = nextSlot()
      await seed(slot, { snapshotJson: '{still not valid' })
    }

    const payload = await loadIssuesPayload()

    expect(payload.sweep).toBeNull()
    expect(payload.inProgress).toBe(false)
    expect(payload.shortlist).toEqual([])
    expect(payload.groups).toEqual([])
    expect(payload.staleGroups).toEqual([])
    expect(payload.resolvedGroups).toEqual([])
    expect(payload.notComparable).toEqual([])
  })

  it('sets inProgress true when no valid snapshot exists but a null-snapshot row is in the window', async () => {
    for (let i = 0; i < 9; i++) {
      const slot = nextSlot()
      await seed(slot, { snapshotJson: '{still not valid' })
    }
    const nullSlot = nextSlot() // newest of this batch of 10 — snapshotJson null
    await seed(nullSlot, { snapshotJson: null })

    const payload = await loadIssuesPayload()

    expect(payload.sweep).toBeNull()
    expect(payload.inProgress).toBe(true)
  })
})
