// lib/sweep/cohort.test.ts
//
// Pure tests — no DB. Mirrors the parse+normalize loop in
// lib/jobs/handlers/robots-monitor-sweep.ts (runRobotsMonitorSweep).
import { describe, expect, it } from 'vitest'
import { buildCohort, registeredDomains } from './cohort'

describe('registeredDomains', () => {
  it('parses, normalizes, and dedupes a valid domains array', () => {
    const out = registeredDomains(JSON.stringify(['Example.com', 'example.com', 'beta.org']))
    expect(out).toEqual(new Set(['example.com', 'beta.org']))
  })

  it('malformed JSON -> empty set (no throw)', () => {
    expect(registeredDomains('{not valid json')).toEqual(new Set())
  })

  it('non-array JSON -> empty set', () => {
    expect(registeredDomains(JSON.stringify({ foo: 'bar' }))).toEqual(new Set())
  })

  it('skips non-string entries', () => {
    const out = registeredDomains(JSON.stringify([123, null, 'gamma.net', {}]))
    expect(out).toEqual(new Set(['gamma.net']))
  })

  it('skips entries that fail domain validation (InvalidDomainError) without throwing', () => {
    const out = registeredDomains(JSON.stringify(['not a domain', 'http://scheme.com', 'ok.io']))
    expect(out).toEqual(new Set(['ok.io']))
  })

  it('does NOT strip a www label — normalizeClientDomain preserves it verbatim, so www vs bare are DISTINCT domains', () => {
    // Verified against lib/security/domain-validation.ts: normalizeClientDomain only
    // trims/lowercases/validates charset — it has no www-stripping logic. So
    // "www.example.com" and "example.com" normalize to two different strings.
    const out = registeredDomains(JSON.stringify(['www.example.com', 'example.com']))
    expect(out).toEqual(new Set(['www.example.com', 'example.com']))
  })
})

describe('buildCohort', () => {
  it('orders members deterministically: clientId asc, then domain asc', () => {
    const cohort = buildCohort([
      { id: 2, name: 'Beta School', domains: JSON.stringify(['beta.com']) },
      { id: 1, name: 'Alpha School', domains: JSON.stringify(['gamma.com', 'alpha.com']) },
    ])
    expect(cohort.members.map((m) => [m.clientId, m.domain])).toEqual([
      [1, 'alpha.com'],
      [1, 'gamma.com'],
      [2, 'beta.com'],
    ])
  })

  it('every member has siteAuditId null and outcome pending', () => {
    const cohort = buildCohort([{ id: 1, name: 'Alpha', domains: JSON.stringify(['alpha.com']) }])
    expect(cohort.members).toEqual([
      { clientId: 1, clientName: 'Alpha', domain: 'alpha.com', siteAuditId: null, outcome: 'pending' },
    ])
  })

  it('malformed domains JSON -> zero members for that client (other clients unaffected)', () => {
    const cohort = buildCohort([
      { id: 1, name: 'Broken', domains: '{not valid json' },
      { id: 2, name: 'Fine', domains: JSON.stringify(['fine.com']) },
    ])
    expect(cohort.members).toEqual([
      { clientId: 2, clientName: 'Fine', domain: 'fine.com', siteAuditId: null, outcome: 'pending' },
    ])
  })

  it('per-client dedupe: duplicate domain (case-insensitive) on one client collapses to one member', () => {
    const cohort = buildCohort([
      { id: 1, name: 'Alpha', domains: JSON.stringify(['Alpha.com', 'alpha.com']) },
    ])
    expect(cohort.members).toEqual([
      { clientId: 1, clientName: 'Alpha', domain: 'alpha.com', siteAuditId: null, outcome: 'pending' },
    ])
  })

  it('cross-client duplicate domain: BOTH clients get a member for the shared domain', () => {
    const cohort = buildCohort([
      { id: 1, name: 'Alpha', domains: JSON.stringify(['shared.com']) },
      { id: 2, name: 'Beta', domains: JSON.stringify(['shared.com']) },
    ])
    expect(cohort.members).toEqual([
      { clientId: 1, clientName: 'Alpha', domain: 'shared.com', siteAuditId: null, outcome: 'pending' },
      { clientId: 2, clientName: 'Beta', domain: 'shared.com', siteAuditId: null, outcome: 'pending' },
    ])
  })

  it('v is 1 and expectedCount === members.length', () => {
    const cohort = buildCohort([
      { id: 1, name: 'Alpha', domains: JSON.stringify(['alpha.com', 'gamma.com']) },
      { id: 2, name: 'Beta', domains: JSON.stringify(['beta.com']) },
    ])
    expect(cohort.v).toBe(1)
    expect(cohort.expectedCount).toBe(cohort.members.length)
    expect(cohort.expectedCount).toBe(3)
  })

  it('expectedCount is 0 for an empty client list', () => {
    const cohort = buildCohort([])
    expect(cohort).toEqual({ v: 1, expectedCount: 0, members: [] })
  })

  it('invalid domain entries are skipped, not thrown', () => {
    const cohort = buildCohort([
      { id: 1, name: 'Alpha', domains: JSON.stringify(['not a domain', 'ok.io']) },
    ])
    expect(cohort.members).toEqual([
      { clientId: 1, clientName: 'Alpha', domain: 'ok.io', siteAuditId: null, outcome: 'pending' },
    ])
  })
})
