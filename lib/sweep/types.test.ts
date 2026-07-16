import { describe, it, expect } from 'vitest'
import {
  CLIENT_SWEEP_JOB_TYPE,
  SWEEP_DIGEST_JOB_TYPE,
  SWEEP_SCAN_PROFILE,
  parseMembership,
  parseSnapshot,
  type SweepMembership,
  type SweepSnapshot,
} from './types'

const VALID_MEMBERSHIP: SweepMembership = {
  v: 1,
  expectedCount: 2,
  members: [
    {
      clientId: 1,
      clientName: 'Acme University',
      domain: 'acme.edu',
      siteAuditId: 'sa_1',
      outcome: 'enqueued',
    },
    {
      clientId: 2,
      clientName: 'Beta Institute',
      domain: 'beta.edu',
      siteAuditId: null,
      outcome: 'skipped-archived',
      reason: 'client archived before scan could be enqueued',
    },
  ],
}

const VALID_SNAPSHOT: SweepSnapshot = {
  v: 1,
  snapshotAt: '2026-07-15T09:00:00.000Z',
  totals: {
    actionable: 3,
    delta: 1,
    comparablePairs: 4,
    newCount: 1,
    worsenedCount: 1,
    resolvedCount: 1,
    scanned: 5,
    expected: 5,
    comparableDomains: 4,
    partialDomains: 1,
    failedDomains: 0,
  },
  coverage: [
    {
      clientId: 1,
      domain: 'acme.edu',
      tool: 'ada-audit',
      state: 'comparable',
      reason: null,
      baselineAvailable: true,
      siteAuditId: 'sa_1',
      runId: 'run_1',
    },
    {
      clientId: 2,
      domain: 'beta.edu',
      tool: 'seo-parser',
      state: 'failed',
      reason: 'scan-failed',
      baselineAvailable: false,
      siteAuditId: null,
      runId: null,
    },
  ],
  groups: [
    {
      clientId: 1,
      clientName: 'Acme University',
      domain: 'acme.edu',
      tool: 'ada-audit',
      type: 'color-contrast',
      title: 'Color contrast failures',
      severity: 'critical',
      unit: 'pages',
      affectedCount: 4,
      approximate: false,
      changeState: 'worsened',
      delta: 2,
      severityChanged: 'escalated',
      coverageState: 'comparable',
      lastObservedAt: '2026-07-15T09:00:00.000Z',
      streak: 3,
      siteAuditId: 'sa_1',
      liveScanRunId: null,
    },
  ],
  staleGroups: [],
  resolvedGroups: [
    {
      clientId: 3,
      clientName: 'Gamma College',
      domain: 'gamma.edu',
      tool: 'seo-parser',
      type: 'missing_title',
      title: 'Missing page titles',
      severity: 'warning',
      priorCount: 2,
      unit: 'pages',
      siteAuditId: 'sa_3',
      liveScanRunId: 'run_3',
    },
  ],
  shortlist: [],
  semanticKeys: [
    {
      clientId: 1,
      domain: 'acme.edu',
      tool: 'ada-audit',
      type: 'color-contrast',
      severity: 'critical',
      unit: 'pages',
      affectedCount: 4,
      approximate: false,
      streak: 2,
    },
  ],
}
VALID_SNAPSHOT.shortlist = VALID_SNAPSHOT.groups

describe('sweep constants', () => {
  it('exports the job-type identifiers and the fixed scan profile', () => {
    expect(CLIENT_SWEEP_JOB_TYPE).toBe('client-sweep')
    expect(SWEEP_DIGEST_JOB_TYPE).toBe('sweep-digest')
    expect(SWEEP_SCAN_PROFILE).toEqual({ wcagLevel: 'wcag21aa', seoIntent: true, seoOnly: false })
  })
})

describe('parseMembership', () => {
  it('round-trips a valid doc, including the optional reason field', () => {
    const raw = JSON.stringify(VALID_MEMBERSHIP)
    expect(parseMembership(raw)).toEqual(VALID_MEMBERSHIP)
  })

  it('round-trips a valid doc when reason is absent', () => {
    const noReason: SweepMembership = {
      v: 1,
      expectedCount: 1,
      members: [
        { clientId: 1, clientName: 'Acme', domain: 'acme.edu', siteAuditId: null, outcome: 'pending' },
      ],
    }
    expect(parseMembership(JSON.stringify(noReason))).toEqual(noReason)
  })

  it('returns null for null input', () => {
    expect(parseMembership(null)).toBeNull()
  })

  it('returns null for unparseable JSON', () => {
    expect(parseMembership('{not json')).toBeNull()
  })

  it('returns null when v is not 1', () => {
    const bad = { ...VALID_MEMBERSHIP, v: 2 }
    expect(parseMembership(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when a member is missing outcome', () => {
    const bad = {
      v: 1,
      expectedCount: 1,
      members: [{ clientId: 1, clientName: 'Acme', domain: 'acme.edu', siteAuditId: null }],
    }
    expect(parseMembership(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when a member has an unknown outcome value', () => {
    const bad = {
      v: 1,
      expectedCount: 1,
      members: [{ clientId: 1, clientName: 'Acme', domain: 'acme.edu', siteAuditId: null, outcome: 'bogus-outcome' }],
    }
    expect(parseMembership(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when members is not an array', () => {
    const bad = { v: 1, expectedCount: 1, members: {} }
    expect(parseMembership(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when a required field has the wrong type', () => {
    const bad = {
      v: 1,
      expectedCount: 1,
      members: [{ clientId: '1', clientName: 'Acme', domain: 'acme.edu', siteAuditId: null, outcome: 'pending' }],
    }
    expect(parseMembership(JSON.stringify(bad))).toBeNull()
  })
})

describe('parseSnapshot', () => {
  it('round-trips a valid doc, including every optional/nullable field', () => {
    const raw = JSON.stringify(VALID_SNAPSHOT)
    expect(parseSnapshot(raw)).toEqual(VALID_SNAPSHOT)
  })

  it('returns null for null input', () => {
    expect(parseSnapshot(null)).toBeNull()
  })

  it('returns null for unparseable JSON', () => {
    expect(parseSnapshot('{not json')).toBeNull()
  })

  it('returns null when v is not 1', () => {
    const bad = { ...VALID_SNAPSHOT, v: 2 }
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when totals is missing', () => {
    const bad: Record<string, unknown> = { ...VALID_SNAPSHOT }
    delete bad.totals
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when groups is not an array', () => {
    const bad = { ...VALID_SNAPSHOT, groups: {} }
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when a coverage entry has an unknown state value', () => {
    const bad = {
      ...VALID_SNAPSHOT,
      coverage: [{ ...VALID_SNAPSHOT.coverage[0], state: 'bogus-state' }],
    }
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when a semanticKey has a non-finite affectedCount', () => {
    const bad = {
      ...VALID_SNAPSHOT,
      semanticKeys: [{ ...VALID_SNAPSHOT.semanticKeys[0], affectedCount: Number.NaN }],
    }
    // NaN serializes to null in JSON.stringify, which is also invalid (not a finite number)
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull()
  })
})
