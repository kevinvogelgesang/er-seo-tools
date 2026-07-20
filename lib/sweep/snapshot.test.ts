// lib/sweep/snapshot.test.ts
//
// Task 8: snapshot loader/compute/publish. The pure change-state/totals/shortlist
// paths run through computeSweepSnapshot with an INJECTED loadAudit (fast, exact
// control). The loader-specific paths (ADA distinct-pages + Violation.help title,
// SEO run-scope authoritative aggregates + affectedComplete attribution, deleted /
// late-completing audits, shared-audit single-load), publishSweepSnapshot's race,
// and loadPreviousSnapshot are genuinely DB-backed over the shared dev DB with
// owned-prefix cleanup (children deleted before parents).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as log from '@/lib/log'
import { prisma } from '@/lib/db'
import type { WeeklySweep } from '@prisma/client'
import {
  computeSweepSnapshot,
  publishSweepSnapshot,
  loadPreviousSnapshot,
  loadAuditForSnapshot,
  type SnapshotDeps,
  type AuditLoad,
  type ToolLoad,
  type LoadedGroup,
} from './snapshot'
import type { SweepMember, SweepMembership, SweepSnapshot, IssueGroup, SemanticKey, PairCoverage, SweepTool } from './types'

type Sev = 'critical' | 'warning' | 'notice'

// ---------------------------------------------------------------------------
// Membership / sweep helpers
// ---------------------------------------------------------------------------

function membership(members: SweepMember[], expectedCount = members.length): SweepMembership {
  return { v: 1, expectedCount, members }
}

function member(clientId: number, domain: string, siteAuditId: string | null, name = `c${clientId}`): SweepMember {
  return { clientId, clientName: name, domain, siteAuditId, outcome: siteAuditId ? 'enqueued' : 'skipped-archived' }
}

function sweepOf(m: SweepMembership): WeeklySweep {
  return { membershipJson: JSON.stringify(m) } as WeeklySweep
}

const NOW = new Date('2026-07-13T01:00:00.000Z')

// ---------------------------------------------------------------------------
// Injected AuditLoad builders (pure-logic tests)
// ---------------------------------------------------------------------------

function grp(g: Partial<LoadedGroup> & { tool: SweepTool; type: string; severity: Sev; affectedCount: number }): LoadedGroup {
  return {
    title: g.title ?? g.type,
    unit: g.unit ?? (g.tool === 'ada-audit' ? 'pages' : 'groups'),
    approximate: g.approximate ?? false,
    liveScanRunId: g.liveScanRunId ?? (g.tool === 'seo-parser' ? 'live-run' : null),
    ...g,
  }
}

function tool(partial: Partial<ToolLoad> = {}): ToolLoad {
  return { runPresent: true, runId: 'run-x', runStatus: 'complete', attributionComplete: true, groups: [], ...partial }
}

function auditLoad(partial: Partial<AuditLoad> = {}): AuditLoad {
  return { discoveryCapped: false, pagesError: 0, ada: tool(), seo: tool(), ...partial }
}

function depsFrom(map: Record<string, AuditLoad>): SnapshotDeps {
  return {
    loadAudit: async (id: string) => map[id] ?? auditLoad({ ada: tool({ runPresent: false, runId: null, runStatus: null }), seo: tool({ runPresent: false, runId: null, runStatus: null }) }),
  }
}

// ---------------------------------------------------------------------------
// Previous-snapshot builder
// ---------------------------------------------------------------------------

interface PrevSpec {
  clientId: number
  domain: string
  tool: SweepTool
  type: string
  severity: Sev
  affectedCount: number
  unit?: 'pages' | 'targets' | 'groups'
  streak?: number
  coverageFailed?: boolean // emit the pair's coverage as 'failed' (no baseline)
}

function baseSnapshot(over: Partial<SweepSnapshot>): SweepSnapshot {
  return {
    v: 1,
    snapshotAt: '2026-07-06T01:00:00.000Z',
    totals: {
      actionable: 0, delta: null, comparablePairs: 0, newCount: 0, worsenedCount: 0,
      resolvedCount: 0, scanned: 0, expected: 0, comparableDomains: 0, partialDomains: 0, failedDomains: 0,
    },
    coverage: [], groups: [], staleGroups: [], resolvedGroups: [], shortlist: [], semanticKeys: [],
    ...over,
  }
}

function prevFrom(specs: PrevSpec[], extraCoverage: PairCoverage[] = []): SweepSnapshot {
  const pairSet = new Map<string, PairCoverage>()
  for (const s of specs) {
    const k = `${s.clientId}\x00${s.domain}\x00${s.tool}`
    if (!pairSet.has(k)) {
      pairSet.set(k, {
        clientId: s.clientId, domain: s.domain, tool: s.tool,
        state: s.coverageFailed ? 'failed' : 'comparable',
        reason: s.coverageFailed ? 'run-missing' : null,
        baselineAvailable: true, siteAuditId: 'prev-audit', runId: 'prev-run',
      })
    }
  }
  const semanticKeys: SemanticKey[] = specs.filter((s) => !s.coverageFailed).map((s) => ({
    clientId: s.clientId, domain: s.domain, tool: s.tool, type: s.type, severity: s.severity,
    unit: s.unit ?? (s.tool === 'ada-audit' ? 'pages' : 'groups'), affectedCount: s.affectedCount, approximate: false, streak: s.streak ?? 1,
  }))
  const groups: IssueGroup[] = specs.filter((s) => !s.coverageFailed).map((s) => ({
    clientId: s.clientId, clientName: `c${s.clientId}`, domain: s.domain, tool: s.tool, type: s.type,
    title: s.type, severity: s.severity, unit: s.unit ?? (s.tool === 'ada-audit' ? 'pages' : 'groups'),
    affectedCount: s.affectedCount, approximate: false, changeState: 'detected', delta: 0, streak: s.streak ?? 1,
    severityChanged: null, coverageState: 'comparable', lastObservedAt: '2026-07-06T01:00:00.000Z',
    siteAuditId: 'prev-audit', liveScanRunId: s.tool === 'seo-parser' ? 'prev-live' : null,
  }))
  return baseSnapshot({ coverage: [...pairSet.values(), ...extraCoverage], semanticKeys, groups })
}

function findGroup(snap: SweepSnapshot, clientId: number, tool: SweepTool, type: string): IssueGroup | undefined {
  return snap.groups.find((g) => g.clientId === clientId && g.tool === tool && g.type === type)
}

// ===========================================================================
// Pure-logic tests (injected loadAudit)
// ===========================================================================

describe('computeSweepSnapshot — change states', () => {
  it('first-baseline (no previous) → every group new, delta null, first-baseline coverage', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ groups: [grp({ tool: 'ada-audit', type: 'image-alt', severity: 'critical', affectedCount: 3 })] }),
        seo: tool({ groups: [grp({ tool: 'seo-parser', type: 'broken_internal_links', severity: 'critical', affectedCount: 5, unit: 'targets' })] }),
      }),
    })
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW, deps)
    expect(snap.groups).toHaveLength(2)
    for (const g of snap.groups) {
      expect(g.changeState).toBe('new')
      expect(g.delta).toBeNull()
      expect(g.coverageState).toBe('first-baseline')
      expect(g.streak).toBe(1)
    }
    expect(snap.totals.delta).toBeNull()
    expect(snap.totals.actionable).toBe(2)
    expect(snap.snapshotAt).toBe(NOW.toISOString())
  })

  it('comparable: worsened(+n), fewer(-n), detected(streak+1) by count', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ groups: [
          grp({ tool: 'ada-audit', type: 'up', severity: 'critical', affectedCount: 5 }),
          grp({ tool: 'ada-audit', type: 'down', severity: 'warning', affectedCount: 2 }),
          grp({ tool: 'ada-audit', type: 'same', severity: 'warning', affectedCount: 4 }),
        ] }),
        seo: tool({ groups: [] }),
      }),
    })
    const prev = prevFrom([
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'up', severity: 'critical', affectedCount: 3 },
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'down', severity: 'warning', affectedCount: 6 },
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'same', severity: 'warning', affectedCount: 4, streak: 2 },
      // a resolved prior group (no raw this week)
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'gone', severity: 'critical', affectedCount: 9 },
    ])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    expect(findGroup(snap, 1, 'ada-audit', 'up')).toMatchObject({ changeState: 'worsened', delta: 2, streak: 1, coverageState: 'comparable' })
    expect(findGroup(snap, 1, 'ada-audit', 'down')).toMatchObject({ changeState: 'fewer', delta: -4, streak: 1 })
    expect(findGroup(snap, 1, 'ada-audit', 'same')).toMatchObject({ changeState: 'detected', delta: 0, streak: 3 })
    expect(snap.resolvedGroups.map((r) => r.type)).toContain('gone')
    // delta = new(0) - resolved(1) over comparable pairs
    expect(snap.totals.delta).toBe(-1)
    expect(snap.totals.resolvedCount).toBe(1)
    // only the ADA pair has a prior baseline; the SEO pair is first-baseline
    expect(snap.totals.comparablePairs).toBe(1)
  })

  it('same aggregate count with changed page URLs → detected (never "unchanged")', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ groups: [grp({ tool: 'ada-audit', type: 'image-alt', severity: 'critical', affectedCount: 4 })] }),
        seo: tool({ groups: [] }),
      }),
    })
    const prev = prevFrom([{ clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'image-alt', severity: 'critical', affectedCount: 4, streak: 1 }])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    expect(findGroup(snap, 1, 'ada-audit', 'image-alt')?.changeState).toBe('detected')
    expect(JSON.stringify(snap)).not.toContain('unchanged')
  })

  it('severity transitions on comparable: escalated→worsened, downgraded→count-derived', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ groups: [
          grp({ tool: 'ada-audit', type: 'esc', severity: 'critical', affectedCount: 2 }), // count equal, sev up
          grp({ tool: 'ada-audit', type: 'dng', severity: 'warning', affectedCount: 2 }),   // count equal, sev down
        ] }),
        seo: tool({ groups: [] }),
      }),
    })
    const prev = prevFrom([
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'esc', severity: 'warning', affectedCount: 2, streak: 3 },
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'dng', severity: 'critical', affectedCount: 2, streak: 3 },
    ])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    expect(findGroup(snap, 1, 'ada-audit', 'esc')).toMatchObject({ severityChanged: 'escalated', changeState: 'worsened', streak: 1 })
    expect(findGroup(snap, 1, 'ada-audit', 'dng')).toMatchObject({ severityChanged: 'downgraded', changeState: 'detected', streak: 4 })
  })

  it('partial pair WITH baseline: count-up → worsened, equal/down → detected (never fewer)', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        discoveryCapped: true, // forces partial
        ada: tool({ runStatus: 'complete', groups: [
          grp({ tool: 'ada-audit', type: 'up', severity: 'critical', affectedCount: 5 }),
          grp({ tool: 'ada-audit', type: 'dn', severity: 'warning', affectedCount: 1 }),
        ] }),
        seo: tool({ runPresent: false, runId: null, runStatus: null }),
      }),
    })
    const prev = prevFrom([
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'up', severity: 'critical', affectedCount: 3 },
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'dn', severity: 'warning', affectedCount: 8, streak: 2 },
    ])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    expect(findGroup(snap, 1, 'ada-audit', 'up')).toMatchObject({ changeState: 'worsened', delta: 2, coverageState: 'partial' })
    expect(findGroup(snap, 1, 'ada-audit', 'dn')).toMatchObject({ changeState: 'detected', delta: null, streak: 3 })
    // no 'fewer' anywhere under partial
    expect(snap.groups.every((g) => g.changeState !== 'fewer')).toBe(true)
  })

  it('partial pair WITHOUT baseline: every group new, no numeric claim', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        discoveryCapped: true,
        ada: tool({ groups: [grp({ tool: 'ada-audit', type: 'x', severity: 'critical', affectedCount: 5 })] }),
        seo: tool({ runPresent: false, runId: null, runStatus: null }),
      }),
    })
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW, deps)
    expect(findGroup(snap, 1, 'ada-audit', 'x')).toMatchObject({ changeState: 'new', delta: null, coverageState: 'partial' })
  })

  it('failed pair → prior groups become stale (prior lastObservedAt verbatim), not resolved', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ runPresent: false, runId: null, runStatus: null }), // failed
        seo: tool({ groups: [] }),
      }),
    })
    const prev = prevFrom([{ clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'image-alt', severity: 'critical', affectedCount: 4 }])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    const stale = snap.staleGroups.find((g) => g.tool === 'ada-audit' && g.type === 'image-alt')
    expect(stale).toBeTruthy()
    expect(stale?.changeState).toBe('stale')
    expect(stale?.lastObservedAt).toBe('2026-07-06T01:00:00.000Z') // prior verbatim
    expect(snap.resolvedGroups).toHaveLength(0)
    const adaCov = snap.coverage.find((c) => c.tool === 'ada-audit')
    expect(adaCov?.state).toBe('failed')
  })

  it('null-audit cohort member (skipped-conflict) → both tools failed: prior issues stale, pair in failedDomains + notComparable', async () => {
    const m = membership([
      { clientId: 1, clientName: 'c1', domain: 'a.edu', siteAuditId: null, outcome: 'skipped-conflict', reason: 'seo-only-in-flight' },
    ])
    const deps = depsFrom({}) // loadAudit is never called — member has no audit
    const prev = prevFrom([{ clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'image-alt', severity: 'critical', affectedCount: 4 }])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    // both tools emit a failed coverage row (in cohort, but produced no scan)
    expect(snap.coverage).toHaveLength(2)
    expect(snap.coverage.every((c) => c.state === 'failed')).toBe(true)
    expect(snap.coverage.find((c) => c.tool === 'ada-audit')?.reason).toBe('scan-conflict')
    // prior ada group goes stale; no live groups
    const stale = snap.staleGroups.find((g) => g.tool === 'ada-audit' && g.type === 'image-alt')
    expect(stale?.changeState).toBe('stale')
    expect(snap.groups).toHaveLength(0)
    // the pair counts in failedDomains and appears in notComparable (read.ts filter)
    expect(snap.totals.failedDomains).toBe(1)
    const notComparable = snap.coverage.filter((c) => c.state === 'failed' || c.state === 'partial')
    expect(notComparable).toHaveLength(2)
  })

  it('skipped-archived / skipped-delisted members stay OUT of cohort → no coverage rows', async () => {
    const m = membership([
      { clientId: 1, clientName: 'c1', domain: 'gone.edu', siteAuditId: null, outcome: 'skipped-archived' },
      { clientId: 2, clientName: 'c2', domain: 'delisted.edu', siteAuditId: null, outcome: 'skipped-delisted' },
    ])
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW, depsFrom({}))
    expect(snap.coverage).toHaveLength(0)
    expect(snap.groups).toHaveLength(0)
  })

  it('delta counts actionable-severity identities over comparable pairs (captures notice→warning transitions)', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ groups: [grp({ tool: 'ada-audit', type: 'x', severity: 'warning', affectedCount: 3 })] }),
        seo: tool({ runPresent: false, runId: null, runStatus: null }),
      }),
    })
    // 'x' was NOTICE last week (not actionable), WARNING now (actionable) over a comparable pair.
    const prev = prevFrom([{ clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'x', severity: 'notice', affectedCount: 3 }])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    // current actionable over comparable = 1; prior actionable over the same pair = 0 → delta +1
    expect(snap.totals.delta).toBe(1)
  })

  it('removed/renamed domain (prior pair not in cohort) → neither stale nor resolved', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({ ada: tool({ groups: [] }), seo: tool({ groups: [] }) }),
    })
    // prior has a group on a DIFFERENT domain that is no longer in the cohort
    const prev = prevFrom([{ clientId: 2, domain: 'gone.edu', tool: 'ada-audit', type: 'image-alt', severity: 'critical', affectedCount: 4 }])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    expect(snap.staleGroups).toHaveLength(0)
    expect(snap.resolvedGroups).toHaveLength(0)
  })

  it('failed predecessor coverage (no keys) → this week first-baseline, not comparable', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ groups: [grp({ tool: 'ada-audit', type: 'x', severity: 'critical', affectedCount: 2 })] }),
        seo: tool({ runPresent: false, runId: null, runStatus: null }),
      }),
    })
    const prev = prevFrom([{ clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'x', severity: 'critical', affectedCount: 2, coverageFailed: true }])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    expect(findGroup(snap, 1, 'ada-audit', 'x')).toMatchObject({ coverageState: 'first-baseline', changeState: 'new' })
  })

  it('notices are carried in groups but excluded from actionable and shortlist', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ groups: [
          grp({ tool: 'ada-audit', type: 'crit', severity: 'critical', affectedCount: 3 }),
          grp({ tool: 'ada-audit', type: 'note', severity: 'notice', affectedCount: 9 }),
        ] }),
        seo: tool({ groups: [] }),
      }),
    })
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW, deps)
    expect(snap.groups.map((g) => g.type).sort()).toEqual(['crit', 'note'])
    expect(snap.totals.actionable).toBe(1)
    expect(snap.shortlist.map((s) => s.type)).toEqual(['crit'])
  })
})

describe('computeSweepSnapshot — coverage reasons (pagesError label fix)', () => {
  it('pagesError>0 on an otherwise-complete audit → both tools partial, reason "pages-errored"', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        pagesError: 3,
        ada: tool({ runStatus: 'complete', groups: [] }),
        seo: tool({ runStatus: 'complete', groups: [] }),
      }),
    })
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW, deps)
    for (const tool of ['ada-audit', 'seo-parser'] as const) {
      const cov = snap.coverage.find((c) => c.tool === tool)
      expect(cov?.state).toBe('partial')
      expect(cov?.reason).toBe('pages-errored')
    }
  })

  it('runStatus "partial" with pagesError 0 → reason "coverage-capped" (not the retired "timed-out")', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        pagesError: 0,
        ada: tool({ runStatus: 'complete', groups: [] }),
        seo: tool({ runStatus: 'partial', groups: [] }),
      }),
    })
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW, deps)
    const seoCov = snap.coverage.find((c) => c.tool === 'seo-parser')
    expect(seoCov?.state).toBe('partial')
    expect(seoCov?.reason).toBe('coverage-capped')
    // No coverage row anywhere still reads the retired label.
    expect(snap.coverage.every((c) => c.reason !== 'timed-out')).toBe(true)
  })

  it('discoveryCapped wins over pagesError → reason "crawl-capped"', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        discoveryCapped: true,
        pagesError: 5,
        ada: tool({ runStatus: 'complete', groups: [] }),
        seo: tool({ runStatus: 'complete', groups: [] }),
      }),
    })
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW, deps)
    expect(snap.coverage.find((c) => c.tool === 'ada-audit')?.reason).toBe('crawl-capped')
  })
})

describe('computeSweepSnapshot — totals + shortlist rank', () => {
  it('domain rollup = worst tool state; scanned/expected honest', async () => {
    const m = membership([
      member(1, 'good.edu', 'aud-1'),   // both comparable
      member(2, 'capped.edu', 'aud-2'), // ada partial, seo comparable → partial domain
      member(3, 'dead.edu', 'aud-3'),   // both failed → failed domain
      member(4, 'skip.edu', null),      // no audit → not scanned
    ], 4)
    const deps = depsFrom({
      'aud-1': auditLoad({ ada: tool({ groups: [] }), seo: tool({ groups: [] }) }),
      'aud-2': auditLoad({ discoveryCapped: true, ada: tool({ groups: [] }), seo: tool({ groups: [] }) }),
      'aud-3': auditLoad({ ada: tool({ runPresent: false, runId: null, runStatus: null }), seo: tool({ runPresent: false, runId: null, runStatus: null }) }),
    })
    const prev = prevFrom([
      { clientId: 1, domain: 'good.edu', tool: 'ada-audit', type: 't', severity: 'critical', affectedCount: 1 },
      { clientId: 1, domain: 'good.edu', tool: 'seo-parser', type: 't', severity: 'critical', affectedCount: 1 },
      { clientId: 2, domain: 'capped.edu', tool: 'ada-audit', type: 't', severity: 'critical', affectedCount: 1 },
      { clientId: 2, domain: 'capped.edu', tool: 'seo-parser', type: 't', severity: 'critical', affectedCount: 1 },
    ])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    expect(snap.totals.expected).toBe(4)
    expect(snap.totals.scanned).toBe(3) // domains with a siteAuditId
    expect(snap.totals.comparableDomains).toBe(1)
    expect(snap.totals.partialDomains).toBe(1)
    expect(snap.totals.failedDomains).toBe(1)
  })

  it('shortlist tuple sort: new before worsened, critical before warning, reach desc, deterministic tie-break; top 3', async () => {
    const m = membership([member(1, 'a.edu', 'aud-1'), member(2, 'b.edu', 'aud-2')])
    const deps = depsFrom({
      'aud-1': auditLoad({
        ada: tool({ groups: [
          grp({ tool: 'ada-audit', type: 'new-warn', severity: 'warning', affectedCount: 100 }),
          grp({ tool: 'ada-audit', type: 'new-crit-lo', severity: 'critical', affectedCount: 2 }),
          grp({ tool: 'ada-audit', type: 'new-crit-hi', severity: 'critical', affectedCount: 50 }),
        ] }),
        seo: tool({ groups: [] }),
      }),
      'aud-2': auditLoad({
        ada: tool({ groups: [grp({ tool: 'ada-audit', type: 'wors-crit', severity: 'critical', affectedCount: 999 })] }),
        seo: tool({ groups: [] }),
      }),
    })
    const prev = prevFrom([
      { clientId: 2, domain: 'b.edu', tool: 'ada-audit', type: 'wors-crit', severity: 'critical', affectedCount: 1 },
      // give aud-1 a baseline so its groups are comparable 'new' (not first-baseline)
      { clientId: 1, domain: 'a.edu', tool: 'ada-audit', type: 'anchor', severity: 'notice', affectedCount: 1 },
    ])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW, deps)
    // new critical hi, new critical lo, new warning ... worsened critical LAST (new before worsened)
    expect(snap.shortlist.map((s) => s.type)).toEqual(['new-crit-hi', 'new-crit-lo', 'new-warn'])
    expect(snap.shortlist).toHaveLength(3)
  })
})

// ===========================================================================
// DB-backed tests: real loader, publish race, loadPreviousSnapshot
// ===========================================================================

const PREFIX = 'task8snap-'
const NS = `t8s-${Date.now()}`
const siteAuditIds: string[] = []
const crawlRunIds: string[] = []
const slots: Date[] = []
let slotCounter = 0
function nextSlot(): Date {
  const s = new Date(Date.now() - 7 * 24 * 3600_000 - 3600_000 + slotCounter++ * 60_000)
  slots.push(s)
  return s
}

async function seedSiteAudit(opts: { status?: string; discoveryCapped?: boolean; domain?: string } = {}): Promise<string> {
  const sa = await prisma.siteAudit.create({
    data: { domain: opts.domain ?? `${NS}.edu`, status: opts.status ?? 'complete', discoveryCapped: opts.discoveryCapped ?? false },
  })
  siteAuditIds.push(sa.id)
  return sa.id
}

async function seedAdaRun(siteAuditId: string, types: Array<{ id: string; severity: Sev; help: string | null; pages: number }>, status = 'complete') {
  const run = await prisma.crawlRun.create({ data: { tool: 'ada-audit', source: 'site-audit', status, siteAuditId } })
  crawlRunIds.push(run.id)
  for (const t of types) {
    for (let i = 0; i < t.pages; i++) {
      const url = `https://${NS}/${t.id}/${i}`
      const page = await prisma.crawlPage.create({ data: { runId: run.id, url } })
      const finding = await prisma.finding.create({
        data: { runId: run.id, pageId: page.id, scope: 'page', type: t.id, severity: t.severity, url, count: 1, dedupKey: `${t.id}:${url}` },
      })
      await prisma.violation.create({
        data: { findingId: finding.id, runId: run.id, pageId: page.id, ruleId: t.id, impact: 'serious', wcagTags: '[]', help: t.help },
      })
    }
  }
  return run.id
}

async function seedSeoRun(siteAuditId: string, findings: Array<{ type: string; severity: Sev; count: number; affectedComplete: boolean | null; description?: string }>, status = 'complete') {
  const run = await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status, siteAuditId } })
  crawlRunIds.push(run.id)
  for (const f of findings) {
    await prisma.finding.create({
      data: {
        runId: run.id, pageId: null, scope: 'run', type: f.type, severity: f.severity, count: f.count,
        affectedComplete: f.affectedComplete, detail: f.description ? JSON.stringify({ description: f.description }) : null,
        dedupKey: `run:${f.type}`,
      },
    })
  }
  return run.id
}

afterAll(async () => {
  if (crawlRunIds.length) {
    await prisma.violation.deleteMany({ where: { runId: { in: crawlRunIds } } })
    await prisma.finding.deleteMany({ where: { runId: { in: crawlRunIds } } })
    await prisma.crawlPage.deleteMany({ where: { runId: { in: crawlRunIds } } })
    await prisma.crawlRun.deleteMany({ where: { id: { in: crawlRunIds } } })
  }
  if (siteAuditIds.length) await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  if (slots.length) await prisma.weeklySweep.deleteMany({ where: { scheduledFor: { in: slots } } })
})

describe('loadAuditForSnapshot (real DB)', () => {
  it('ADA: distinct-page affectedCount, max severity, title from Violation.help', async () => {
    const said = await seedSiteAudit()
    await seedAdaRun(said, [
      { id: 'image-alt', severity: 'critical', help: 'Images must have alternate text', pages: 3 },
      { id: 'color-contrast', severity: 'warning', help: 'Elements must have sufficient contrast', pages: 2 },
    ])
    await seedSeoRun(said, [])
    const load = await loadAuditForSnapshot(said)
    expect(load.ada.runPresent).toBe(true)
    expect(load.ada.attributionComplete).toBe(true)
    const imageAlt = load.ada.groups.find((g) => g.type === 'image-alt')
    expect(imageAlt).toMatchObject({ affectedCount: 3, severity: 'critical', unit: 'pages', title: 'Images must have alternate text', liveScanRunId: null })
    const contrast = load.ada.groups.find((g) => g.type === 'color-contrast')
    expect(contrast).toMatchObject({ affectedCount: 2, severity: 'warning' })
  })

  it('SEO: run-scope authoritative aggregates; title from detail.description; unit map; attributionComplete only when every affectedComplete===true', async () => {
    const said = await seedSiteAudit()
    await seedAdaRun(said, [])
    const runId = await seedSeoRun(said, [
      { type: 'broken_internal_links', severity: 'critical', count: 5, affectedComplete: true, description: 'Broken internal links found' },
      { type: 'duplicate_title', severity: 'warning', count: 3, affectedComplete: null }, // legacy/sample = incomplete
    ])
    const load = await loadAuditForSnapshot(said)
    expect(load.seo.runPresent).toBe(true)
    expect(load.seo.attributionComplete).toBe(false) // one null → incomplete
    const broken = load.seo.groups.find((g) => g.type === 'broken_internal_links')
    expect(broken).toMatchObject({ affectedCount: 5, unit: 'targets', title: 'Broken internal links found', approximate: false, liveScanRunId: runId })
    const dup = load.seo.groups.find((g) => g.type === 'duplicate_title')
    expect(dup).toMatchObject({ affectedCount: 3, unit: 'groups', approximate: true })
  })

  it('SEO clean run (no run-scope findings) is attribution-complete and present', async () => {
    const said = await seedSiteAudit()
    await seedAdaRun(said, [])
    await seedSeoRun(said, [])
    const load = await loadAuditForSnapshot(said)
    expect(load.seo.runPresent).toBe(true)
    expect(load.seo.attributionComplete).toBe(true)
    expect(load.seo.groups).toHaveLength(0)
  })

  it('missing_title / thin_content map to pages; unknown type → groups', async () => {
    const said = await seedSiteAudit()
    await seedAdaRun(said, [])
    await seedSeoRun(said, [
      { type: 'missing_title', severity: 'warning', count: 2, affectedComplete: true },
      { type: 'thin_content', severity: 'notice', count: 1, affectedComplete: true },
      { type: 'some_future_type', severity: 'warning', count: 1, affectedComplete: true },
    ])
    const load = await loadAuditForSnapshot(said)
    expect(load.seo.groups.find((g) => g.type === 'missing_title')?.unit).toBe('pages')
    expect(load.seo.groups.find((g) => g.type === 'thin_content')?.unit).toBe('pages')
    expect(load.seo.groups.find((g) => g.type === 'some_future_type')?.unit).toBe('groups')
  })

  it('B5: validation + dead_page types map via findingUnit with NO sweep_unmapped_issue_unit logError', async () => {
    const spy = vi.spyOn(log, 'logError').mockImplementation(() => {})
    try {
      const said = await seedSiteAudit()
      await seedAdaRun(said, [])
      await seedSeoRun(said, [
        { type: 'redirect_chain', severity: 'warning', count: 4, affectedComplete: true },
        { type: 'canonical_external_unverified', severity: 'notice', count: 2, affectedComplete: true },
        { type: 'dead_page', severity: 'warning', count: 3, affectedComplete: true },
      ])
      const load = await loadAuditForSnapshot(said)
      expect(load.seo.groups.find((g) => g.type === 'redirect_chain')?.unit).toBe('pages')
      expect(load.seo.groups.find((g) => g.type === 'canonical_external_unverified')?.unit).toBe('targets')
      expect(load.seo.groups.find((g) => g.type === 'dead_page')?.unit).toBe('pages')
      const unmapped = spy.mock.calls.filter(
        (c) => (c[0] as { event?: string } | undefined)?.event === 'sweep_unmapped_issue_unit',
      )
      expect(unmapped).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it('late-completing audit: ADA run present, SEO run missing → seo failed, ada classified', async () => {
    const said = await seedSiteAudit()
    await seedAdaRun(said, [{ id: 'image-alt', severity: 'critical', help: 'x', pages: 1 }])
    // NO seo run yet (verifier still building)
    const m = membership([member(1, `${NS}-late.edu`, said)])
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW)
    const seoCov = snap.coverage.find((c) => c.tool === 'seo-parser')
    const adaCov = snap.coverage.find((c) => c.tool === 'ada-audit')
    expect(seoCov?.state).toBe('failed')
    expect(adaCov?.state).toBe('first-baseline')
    expect(snap.groups.some((g) => g.tool === 'ada-audit' && g.type === 'image-alt')).toBe(true)
  })

  it('deleted member audit → both pairs failed, no throw', async () => {
    const m = membership([member(1, `${NS}-dead.edu`, 'nonexistent-audit-id')])
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW)
    expect(snap.coverage).toHaveLength(2)
    expect(snap.coverage.every((c) => c.state === 'failed')).toBe(true)
    expect(snap.groups).toHaveLength(0)
  })

  it('shared-domain members: audit loaded ONCE, both client-attributed groups emitted', async () => {
    const said = await seedSiteAudit({ domain: `${NS}-shared.edu` })
    await seedAdaRun(said, [{ id: 'image-alt', severity: 'critical', help: 'x', pages: 2 }])
    await seedSeoRun(said, [])
    const m = membership([
      member(10, `${NS}-shared.edu`, said, 'ClientTen'),
      member(11, `${NS}-shared.edu`, said, 'ClientEleven'),
    ])
    let loadCount = 0
    const spyDeps: SnapshotDeps = {
      loadAudit: async (id) => { loadCount++; return loadAuditForSnapshot(id) },
    }
    const snap = await computeSweepSnapshot(sweepOf(m), null, NOW, spyDeps)
    expect(loadCount).toBe(1) // one audit id → one load despite two members
    const clientIds = snap.groups.filter((g) => g.type === 'image-alt').map((g) => g.clientId).sort()
    expect(clientIds).toEqual([10, 11])
  })
})

describe('computeSweepSnapshot — full pipeline (real loader + prior snapshot)', () => {
  it('two members, ada+seo runs, prior snapshot → totals/groups/shortlist pinned', async () => {
    const domA = `${NS}-fpa.edu`
    const domB = `${NS}-fpb.edu`
    const saA = await seedSiteAudit({ domain: domA })
    const saB = await seedSiteAudit({ domain: domB })
    // A: ada image-alt worsens 2→3 (critical); seo broken_internal_links steady 5 (critical)
    await seedAdaRun(saA, [{ id: 'image-alt', severity: 'critical', help: 'Images must have alt text', pages: 3 }])
    await seedSeoRun(saA, [{ type: 'broken_internal_links', severity: 'critical', count: 5, affectedComplete: true, description: 'Broken internal links' }])
    // B: ada clean (no findings); seo duplicate_title NEW
    await seedAdaRun(saB, [])
    await seedSeoRun(saB, [{ type: 'duplicate_title', severity: 'warning', count: 3, affectedComplete: true, description: 'Duplicate titles' }])

    const prev = prevFrom([
      { clientId: 1, domain: domA, tool: 'ada-audit', type: 'image-alt', severity: 'critical', affectedCount: 2, streak: 1 },
      { clientId: 1, domain: domA, tool: 'seo-parser', type: 'broken_internal_links', severity: 'critical', affectedCount: 5, unit: 'targets', streak: 2 },
      // B ada had a prior finding that is now resolved (clean this week)
      { clientId: 2, domain: domB, tool: 'ada-audit', type: 'label', severity: 'critical', affectedCount: 4 },
      // give B seo a baseline so duplicate_title reads comparable 'new'
      { clientId: 2, domain: domB, tool: 'seo-parser', type: 'thin_content', severity: 'notice', affectedCount: 1, unit: 'pages' },
    ])
    const m = membership([member(1, domA, saA), member(2, domB, saB)])
    const snap = await computeSweepSnapshot(sweepOf(m), prev, NOW)

    expect(findGroup(snap, 1, 'ada-audit', 'image-alt')).toMatchObject({ changeState: 'worsened', delta: 1, affectedCount: 3, coverageState: 'comparable' })
    expect(findGroup(snap, 1, 'seo-parser', 'broken_internal_links')).toMatchObject({ changeState: 'detected', delta: 0, unit: 'targets', streak: 3 })
    expect(findGroup(snap, 2, 'seo-parser', 'duplicate_title')).toMatchObject({ changeState: 'new', unit: 'groups', coverageState: 'comparable' })
    expect(snap.resolvedGroups.map((r) => `${r.clientId}:${r.type}`)).toContain('2:label')

    // totals: 3 actionable live groups (image-alt, broken_internal_links, duplicate_title)
    expect(snap.totals.actionable).toBe(3)
    expect(snap.totals.worsenedCount).toBe(1)
    expect(snap.totals.newCount).toBe(1)
    expect(snap.totals.resolvedCount).toBe(1)
    // 4 comparable pairs (both tools of A + both tools of B all have baselines)
    expect(snap.totals.comparablePairs).toBe(4)
    // delta = newInComparable(1: duplicate_title) − resolved(1: label) = 0
    expect(snap.totals.delta).toBe(0)
    expect(snap.totals.scanned).toBe(2)
    expect(snap.totals.comparableDomains).toBe(2)

    // shortlist: worsened critical (image-alt) before new warning (duplicate_title); new-crit none
    expect(snap.shortlist.map((s) => s.type)).toEqual(['duplicate_title', 'image-alt'])
  })
})

describe('publishSweepSnapshot (race-safe)', () => {
  it('first publish writes; second returns first payload byte-identical', async () => {
    const slot = nextSlot()
    const row = await prisma.weeklySweep.create({ data: { scheduledFor: slot } })
    const first = baseSnapshot({ snapshotAt: '2026-07-13T01:00:00.000Z', totals: { ...baseSnapshot({}).totals, actionable: 7 } })
    const second = baseSnapshot({ snapshotAt: '2099-01-01T00:00:00.000Z', totals: { ...baseSnapshot({}).totals, actionable: 999 } })
    const r1 = await publishSweepSnapshot(row.id, first)
    expect(r1.totals.actionable).toBe(7)
    const r2 = await publishSweepSnapshot(row.id, second)
    // second racer gets the WINNER (first) payload, not its own
    expect(r2.totals.actionable).toBe(7)
    const stored = await prisma.weeklySweep.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored.snapshotJson).toBe(JSON.stringify(first))
  })
})

describe('loadPreviousSnapshot', () => {
  it('exact scheduledFor − 7 days; missing → null', async () => {
    const cur = nextSlot()
    const prevSlot = new Date(cur.getTime() - 7 * 24 * 3600_000)
    const snap = baseSnapshot({ snapshotAt: 'X', totals: { ...baseSnapshot({}).totals, actionable: 42 } })
    slots.push(prevSlot)
    await prisma.weeklySweep.create({ data: { scheduledFor: prevSlot, snapshotJson: JSON.stringify(snap) } })
    const loaded = await loadPreviousSnapshot(cur)
    expect(loaded?.totals.actionable).toBe(42)
    // gap week: no row at −7d even though an OLDER (−14d) snapshot exists →
    // never bridge the evidence gap.
    const orphan = nextSlot()
    const olderSlot = new Date(orphan.getTime() - 14 * 24 * 3600_000)
    slots.push(olderSlot)
    await prisma.weeklySweep.create({ data: { scheduledFor: olderSlot, snapshotJson: JSON.stringify(snap) } })
    expect(await loadPreviousSnapshot(orphan)).toBeNull()
  })

  it('corrupt predecessor snapshotJson → null (everything first-baseline)', async () => {
    const cur = nextSlot()
    const prevSlot = new Date(cur.getTime() - 7 * 24 * 3600_000)
    slots.push(prevSlot)
    await prisma.weeklySweep.create({ data: { scheduledFor: prevSlot, snapshotJson: '{not valid json' } })
    expect(await loadPreviousSnapshot(cur)).toBeNull()
  })
})
