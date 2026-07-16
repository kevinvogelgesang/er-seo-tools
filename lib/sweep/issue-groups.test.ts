import { describe, it, expect } from 'vitest'
import { buildIssueGroups } from './issue-groups'
import type { RawGroup } from './issue-groups'
import type { SemanticKey, IssueGroup, PairCoverage, SweepTool, IssueUnit } from './types'

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

const AT = '2026-07-15T00:00:00.000Z'
const PRIOR_AT = '2026-07-08T00:00:00.000Z'

function raw(over: Partial<RawGroup> = {}): RawGroup {
  return {
    clientId: 1,
    clientName: 'Acme',
    domain: 'acme.com',
    tool: 'ada-audit',
    type: 'color-contrast',
    title: 'Color contrast',
    severity: 'critical',
    affectedCount: 5,
    unit: 'pages',
    approximate: false,
    siteAuditId: 'sa-1',
    liveScanRunId: null,
    ...over,
  }
}

function key(over: Partial<SemanticKey> = {}): SemanticKey {
  return {
    clientId: 1,
    domain: 'acme.com',
    tool: 'ada-audit',
    type: 'color-contrast',
    severity: 'critical',
    unit: 'pages',
    affectedCount: 5,
    approximate: false,
    streak: 1,
    ...over,
  }
}

function group(over: Partial<IssueGroup> = {}): IssueGroup {
  return {
    clientId: 1,
    clientName: 'Acme',
    domain: 'acme.com',
    tool: 'ada-audit',
    type: 'color-contrast',
    title: 'Color contrast',
    severity: 'critical',
    unit: 'pages',
    affectedCount: 5,
    approximate: false,
    changeState: 'detected',
    delta: 0,
    streak: 3,
    severityChanged: null,
    coverageState: 'comparable',
    lastObservedAt: PRIOR_AT,
    siteAuditId: 'sa-prev',
    liveScanRunId: null,
    ...over,
  }
}

function cov(over: Partial<PairCoverage> = {}): PairCoverage {
  return {
    clientId: 1,
    domain: 'acme.com',
    tool: 'ada-audit',
    state: 'comparable',
    reason: null,
    baselineAvailable: true,
    siteAuditId: 'sa-1',
    runId: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------

describe('buildIssueGroups', () => {
  describe('comparable pair — full vocabulary', () => {
    it('no prior key -> new (delta null, streak 1)', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 5 })],
        previous: { keys: [], groups: [] },
        coverage: [cov()],
        snapshotAt: AT,
      })
      expect(out.groups).toHaveLength(1)
      const g = out.groups[0]
      expect(g.changeState).toBe('new')
      expect(g.delta).toBeNull()
      expect(g.streak).toBe(1)
      expect(g.severityChanged).toBeNull()
      expect(g.coverageState).toBe('comparable')
      expect(g.lastObservedAt).toBe(AT)
      expect(out.resolvedGroups).toHaveLength(0)
    })

    it('count up -> worsened, delta +n, streak 1', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 8 })],
        previous: { keys: [key({ affectedCount: 5, streak: 4 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov()],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('worsened')
      expect(g.delta).toBe(3)
      expect(g.streak).toBe(1)
    })

    it('count down -> fewer, delta -n, streak 1', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 2 })],
        previous: { keys: [key({ affectedCount: 5, streak: 4 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov()],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('fewer')
      expect(g.delta).toBe(-3)
      expect(g.streak).toBe(1)
    })

    it('count equal -> detected, delta 0, streak = prev+1', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 5 })],
        previous: { keys: [key({ affectedCount: 5, streak: 3 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov()],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('detected')
      expect(g.delta).toBe(0)
      expect(g.streak).toBe(4)
    })

    it('prior key with no raw group -> resolved (title/severity/priorCount from prior group)', () => {
      const out = buildIssueGroups({
        raw: [],
        previous: {
          keys: [key({ affectedCount: 7, streak: 2 })],
          groups: [group({ affectedCount: 7, title: 'Prior title', severity: 'warning' })],
        },
        coverage: [cov()],
        snapshotAt: AT,
      })
      expect(out.groups).toHaveLength(0)
      expect(out.resolvedGroups).toHaveLength(1)
      const r = out.resolvedGroups[0]
      expect(r.title).toBe('Prior title')
      expect(r.severity).toBe('warning')
      expect(r.priorCount).toBe(7)
      expect(r.unit).toBe('pages')
      expect(out.semanticKeys).toHaveLength(0)
    })
  })

  describe('severity transitions (comparable)', () => {
    it('escalation same count -> worsened + escalated, streak resets to 1', () => {
      const out = buildIssueGroups({
        raw: [raw({ severity: 'critical', affectedCount: 5 })],
        previous: {
          keys: [key({ severity: 'warning', affectedCount: 5, streak: 6 })],
          groups: [group({ severity: 'warning', affectedCount: 5 })],
        },
        coverage: [cov()],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('worsened')
      expect(g.severityChanged).toBe('escalated')
      expect(g.streak).toBe(1)
      expect(g.delta).toBe(0)
    })

    it('escalation with count down -> forced worsened, escalated', () => {
      const out = buildIssueGroups({
        raw: [raw({ severity: 'critical', affectedCount: 2 })],
        previous: {
          keys: [key({ severity: 'notice', affectedCount: 5, streak: 2 })],
          groups: [group({ severity: 'notice', affectedCount: 5 })],
        },
        coverage: [cov()],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('worsened')
      expect(g.severityChanged).toBe('escalated')
      expect(g.streak).toBe(1)
    })

    it('downgrade -> downgraded, changeState from count (equal -> detected)', () => {
      const out = buildIssueGroups({
        raw: [raw({ severity: 'warning', affectedCount: 5 })],
        previous: {
          keys: [key({ severity: 'critical', affectedCount: 5, streak: 2 })],
          groups: [group({ severity: 'critical', affectedCount: 5 })],
        },
        coverage: [cov()],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.severityChanged).toBe('downgraded')
      expect(g.changeState).toBe('detected')
      expect(g.streak).toBe(3)
    })
  })

  describe('partial pair', () => {
    it('partial + baseline, count up -> worsened (delta +n)', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 9 })],
        previous: { keys: [key({ affectedCount: 5, streak: 3 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov({ state: 'partial', baselineAvailable: true })],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('worsened')
      expect(g.delta).toBe(4)
      expect(g.coverageState).toBe('partial')
    })

    it('partial + baseline, count equal -> detected (streak+1)', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 5 })],
        previous: { keys: [key({ affectedCount: 5, streak: 3 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov({ state: 'partial', baselineAvailable: true })],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('detected')
      expect(g.delta).toBeNull()
      expect(g.streak).toBe(4)
    })

    it('partial + baseline, count down -> detected NOT fewer (no downward claim, delta null)', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 1 })],
        previous: { keys: [key({ affectedCount: 5, streak: 3 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov({ state: 'partial', baselineAvailable: true })],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('detected')
      expect(g.delta).toBeNull()
    })

    it('partial + baseline suppresses resolved (prior key, no raw)', () => {
      const out = buildIssueGroups({
        raw: [],
        previous: { keys: [key({ affectedCount: 5 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov({ state: 'partial', baselineAvailable: true })],
        snapshotAt: AT,
      })
      expect(out.resolvedGroups).toHaveLength(0)
      expect(out.staleGroups).toHaveLength(0)
    })

    it('partial WITHOUT baseline -> new (delta null, streak 1), never claims new-vs-prior', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 5 })],
        previous: { keys: [key({ affectedCount: 5, streak: 4 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov({ state: 'partial', baselineAvailable: false })],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('new')
      expect(g.delta).toBeNull()
      expect(g.streak).toBe(1)
      expect(out.resolvedGroups).toHaveLength(0)
    })
  })

  describe('first-baseline pair', () => {
    it('groups new, streak 1, nothing resolved', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 5 })],
        previous: { keys: [], groups: [] },
        coverage: [cov({ state: 'first-baseline', baselineAvailable: false })],
        snapshotAt: AT,
      })
      const g = out.groups[0]
      expect(g.changeState).toBe('new')
      expect(g.delta).toBeNull()
      expect(g.streak).toBe(1)
      expect(g.coverageState).toBe('first-baseline')
      expect(out.resolvedGroups).toHaveLength(0)
    })
  })

  describe('failed pair', () => {
    it('previous GROUPS -> stale (full render fields, old lastObservedAt), never resolved, no semanticKeys', () => {
      const out = buildIssueGroups({
        raw: [],
        previous: {
          keys: [key({ affectedCount: 7, streak: 5 })],
          groups: [group({ affectedCount: 7, streak: 5, title: 'Kept', severity: 'warning', delta: 2, changeState: 'worsened', lastObservedAt: PRIOR_AT })],
        },
        coverage: [cov({ state: 'failed', reason: 'scan-failed', baselineAvailable: true })],
        snapshotAt: AT,
      })
      expect(out.groups).toHaveLength(0)
      expect(out.resolvedGroups).toHaveLength(0)
      expect(out.staleGroups).toHaveLength(1)
      const s = out.staleGroups[0]
      expect(s.changeState).toBe('stale')
      expect(s.title).toBe('Kept')
      expect(s.severity).toBe('warning')
      expect(s.affectedCount).toBe(7)
      expect(s.streak).toBe(5)
      expect(s.lastObservedAt).toBe(PRIOR_AT)
      expect(out.semanticKeys).toHaveLength(0)
    })
  })

  describe('out-of-cohort', () => {
    it('prior pair with no coverage entry -> neither stale nor resolved', () => {
      const out = buildIssueGroups({
        raw: [],
        previous: {
          keys: [key({ domain: 'gone.com' })],
          groups: [group({ domain: 'gone.com' })],
        },
        coverage: [], // gone.com not in cohort
        snapshotAt: AT,
      })
      expect(out.groups).toHaveLength(0)
      expect(out.staleGroups).toHaveLength(0)
      expect(out.resolvedGroups).toHaveLength(0)
      expect(out.semanticKeys).toHaveLength(0)
    })
  })

  describe('first sweep ever (previous null)', () => {
    it('all new, no resolved', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 5 }), raw({ type: 'link-name', affectedCount: 2 })],
        previous: null,
        coverage: [cov({ state: 'first-baseline', baselineAvailable: false })],
        snapshotAt: AT,
      })
      expect(out.groups).toHaveLength(2)
      expect(out.groups.every((g) => g.changeState === 'new')).toBe(true)
      expect(out.resolvedGroups).toHaveLength(0)
    })
  })

  describe('passthrough', () => {
    it('unit passthrough', () => {
      const out = buildIssueGroups({
        raw: [raw({ unit: 'targets' as IssueUnit, affectedCount: 3 })],
        previous: { keys: [], groups: [] },
        coverage: [cov()],
        snapshotAt: AT,
      })
      expect(out.groups[0].unit).toBe('targets')
      expect(out.semanticKeys[0].unit).toBe('targets')
    })

    it('approximate carried', () => {
      const out = buildIssueGroups({
        raw: [raw({ approximate: true })],
        previous: { keys: [], groups: [] },
        coverage: [cov()],
        snapshotAt: AT,
      })
      expect(out.groups[0].approximate).toBe(true)
      expect(out.semanticKeys[0].approximate).toBe(true)
    })
  })

  describe('streak does NOT survive a failed week', () => {
    it('detected(4) -> failed(stale, no key) -> recovered restarts at 1', () => {
      // week 1: detected, streak advances 3 -> 4
      const w1 = buildIssueGroups({
        raw: [raw({ affectedCount: 5 })],
        previous: { keys: [key({ affectedCount: 5, streak: 3 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov()],
        snapshotAt: PRIOR_AT,
      })
      expect(w1.groups[0].streak).toBe(4)
      const w1Group = w1.groups[0]

      // week 2: failed pair -> stale, semanticKeys empty (streak breaks)
      const w2 = buildIssueGroups({
        raw: [],
        previous: { keys: w1.semanticKeys, groups: [w1Group] },
        coverage: [cov({ state: 'failed', reason: 'scan-failed' })],
        snapshotAt: AT,
      })
      expect(w2.staleGroups).toHaveLength(1)
      expect(w2.semanticKeys).toHaveLength(0)

      // week 3: recovered -> no prior key -> new, streak 1
      const w3 = buildIssueGroups({
        raw: [raw({ affectedCount: 5 })],
        previous: { keys: w2.semanticKeys, groups: w2.groups },
        coverage: [cov()],
        snapshotAt: '2026-07-22T00:00:00.000Z',
      })
      expect(w3.groups[0].changeState).toBe('new')
      expect(w3.groups[0].streak).toBe(1)
    })
  })

  describe('semanticKeys', () => {
    it('emitted only for live groups, carry the group streak', () => {
      const out = buildIssueGroups({
        raw: [raw({ affectedCount: 5 })],
        previous: { keys: [key({ affectedCount: 5, streak: 2 })], groups: [group({ affectedCount: 5 })] },
        coverage: [cov()],
        snapshotAt: AT,
      })
      expect(out.semanticKeys).toHaveLength(1)
      expect(out.semanticKeys[0].streak).toBe(3) // detected -> prev+1
      expect(out.semanticKeys[0].type).toBe('color-contrast')
    })
  })

  describe('deterministic ordering', () => {
    it('sorts by (clientId, domain, tool, type)', () => {
      const out = buildIssueGroups({
        raw: [
          raw({ clientId: 2, domain: 'b.com', tool: 'seo-parser', type: 'z' }),
          raw({ clientId: 1, domain: 'a.com', tool: 'ada-audit', type: 'a' }),
          raw({ clientId: 1, domain: 'a.com', tool: 'ada-audit', type: 'b' }),
          raw({ clientId: 1, domain: 'a.com', tool: 'seo-parser', type: 'a' }),
        ],
        previous: { keys: [], groups: [] },
        coverage: [
          cov({ clientId: 1, domain: 'a.com', tool: 'ada-audit', state: 'first-baseline', baselineAvailable: false }),
          cov({ clientId: 1, domain: 'a.com', tool: 'seo-parser', state: 'first-baseline', baselineAvailable: false }),
          cov({ clientId: 2, domain: 'b.com', tool: 'seo-parser', state: 'first-baseline', baselineAvailable: false }),
        ],
        snapshotAt: AT,
      })
      expect(out.groups.map((g) => [g.clientId, g.domain, g.tool, g.type])).toEqual([
        [1, 'a.com', 'ada-audit', 'a'],
        [1, 'a.com', 'ada-audit', 'b'],
        [1, 'a.com', 'seo-parser', 'a'],
        [2, 'b.com', 'seo-parser', 'z'],
      ])
    })
  })
})
