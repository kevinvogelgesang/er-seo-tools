import { describe, it, expect } from 'vitest'
import { computeFleetKpi, rankNeedsAttention } from './fleet-aggregates'
import { EMPTY_SERIES, type ClientAlert, type ScoreSeries } from './scorecard-shared'
import type { FleetRow } from './client-fleet'

// Concise, type-safe FleetRow fixtures built off EMPTY_SERIES (plan Codex fix 5).
function series(partial: Partial<ScoreSeries>): ScoreSeries {
  return { ...EMPTY_SERIES, ...partial }
}
let nextId = 1
function fleetRow(p: Partial<FleetRow> = {}): FleetRow {
  return {
    id: p.id ?? nextId++,
    name: p.name ?? 'Client',
    firstDomain: p.firstDomain ?? 'example.com',
    seo: p.seo ?? EMPTY_SERIES,
    ada: p.ada ?? EMPTY_SERIES,
    adaSource: p.adaSource ?? null,
    pillarScore: p.pillarScore ?? null,
    pillarAt: p.pillarAt ?? null,
    lastActivityAt: p.lastActivityAt ?? null,
    alerts: p.alerts ?? [],
    openCritical: p.openCritical ?? null,
    openWarning: p.openWarning ?? null,
  }
}
const alert = (kind: ClientAlert['kind'], detail = kind): ClientAlert => ({ kind, detail })

describe('computeFleetKpi', () => {
  it('averages non-null latest scores, rounding to nearest int', () => {
    const fleet = [
      fleetRow({ ada: series({ latest: 80 }), seo: series({ latest: 91 }) }),
      fleetRow({ ada: series({ latest: 71 }), seo: series({ latest: 90 }) }),
      fleetRow({ ada: series({ latest: null }), seo: series({ latest: null }) }), // ignored
    ]
    const kpi = computeFleetKpi(fleet, { active: null, queued: [] })
    expect(kpi.avgAda).toBe(76) // (80+71)/2 = 75.5 → 76
    expect(kpi.avgSeo).toBe(91) // (91+90)/2 = 90.5 → 91
  })

  it('empty fleet → both averages null, openCriticals 0', () => {
    const kpi = computeFleetKpi([], { active: null, queued: [] })
    expect(kpi.avgAda).toBeNull()
    expect(kpi.avgSeo).toBeNull()
    expect(kpi.openCriticals).toBe(0)
  })

  it('sums openCritical, counting null rows as 0', () => {
    const fleet = [
      fleetRow({ openCritical: 3 }),
      fleetRow({ openCritical: null }),
      fleetRow({ openCritical: 2 }),
    ]
    expect(computeFleetKpi(fleet, null).openCriticals).toBe(5)
  })

  it('activeScans = (active?1:0) + queued.length; null when queue is null', () => {
    expect(computeFleetKpi([], { active: { id: 'x' }, queued: [{}, {}] }).activeScans).toBe(3)
    expect(computeFleetKpi([], { active: null, queued: [] }).activeScans).toBe(0)
    expect(computeFleetKpi([], null).activeScans).toBeNull() // queue sub-fetch failed
  })
})

describe('rankNeedsAttention', () => {
  it('excludes clean clients (no negative delta, no criticals, no alerts)', () => {
    const fleet = [fleetRow({ name: 'Clean', seo: series({ latest: 90, delta: 4 }) })]
    expect(rankNeedsAttention(fleet)).toEqual([])
  })

  it('ranks negative movers most-negative-first and picks the worse metric', () => {
    const fleet = [
      fleetRow({ id: 1, name: 'A', seo: series({ latest: 70, delta: -5 }) }),
      fleetRow({ id: 2, name: 'B', ada: series({ latest: 60, delta: -20 }) }),
      fleetRow({ id: 3, name: 'C', seo: series({ latest: 80, delta: -10 }), ada: series({ latest: 88, delta: -2 }) }),
    ]
    const out = rankNeedsAttention(fleet)
    expect(out.map((r) => r.name)).toEqual(['B', 'C', 'A']) // -20, -10, -5
    // C: worse metric is seo (-10 < -2)
    const c = out.find((r) => r.name === 'C')!
    expect(c.metric).toBe('seo')
    expect(c.score).toBe(80)
    expect(c.delta).toBe(-10)
  })

  it('SEO wins when seo.delta === ada.delta (Codex fix 3)', () => {
    const fleet = [fleetRow({ seo: series({ latest: 70, delta: -8 }), ada: series({ latest: 65, delta: -8 }) })]
    const r = rankNeedsAttention(fleet)[0]
    expect(r.metric).toBe('seo')
    expect(r.score).toBe(70)
    expect(r.delta).toBe(-8)
  })

  it('includes criticals-only rows with delta null, sorted after real droppers', () => {
    const fleet = [
      fleetRow({ id: 1, name: 'Dropper', seo: series({ latest: 70, delta: -5 }) }),
      fleetRow({ id: 2, name: 'Criticals', openCritical: 4 }),
    ]
    const out = rankNeedsAttention(fleet)
    expect(out.map((r) => r.name)).toEqual(['Dropper', 'Criticals'])
    const crit = out.find((r) => r.name === 'Criticals')!
    expect(crit.delta).toBeNull()
    expect(crit.openCritical).toBe(4)
  })

  it('criticals-only metric falls back to whichever latest is non-null', () => {
    const seoOnly = rankNeedsAttention([fleetRow({ openCritical: 1, seo: series({ latest: 55 }) })])[0]
    expect(seoOnly.metric).toBe('seo')
    expect(seoOnly.score).toBe(55)
    const adaOnly = rankNeedsAttention([fleetRow({ openCritical: 1, ada: series({ latest: 44 }) })])[0]
    expect(adaOnly.metric).toBe('ada')
    expect(adaOnly.score).toBe(44)
  })

  it('includes alert-only rows and exposes topAlert', () => {
    const fleet = [fleetRow({ name: 'Alerted', alerts: [alert('error', 'site audit: latest run failed')] })]
    const r = rankNeedsAttention(fleet)[0]
    expect(r.topAlert).toBe('site audit: latest run failed')
    expect(r.delta).toBeNull()
  })

  it('orders two alert-only rows by alert priority: error before stale (Codex fix 4)', () => {
    const fleet = [
      fleetRow({ id: 1, name: 'Zeta-stale', alerts: [alert('stale')] }),
      fleetRow({ id: 2, name: 'Alpha-error', alerts: [alert('error')] }),
    ]
    // Alpha-error sorts first despite Zeta's name being later — priority beats name.
    expect(rankNeedsAttention(fleet).map((r) => r.name)).toEqual(['Alpha-error', 'Zeta-stale'])
  })

  it('final clientId tie-break for identical-name rows (Codex fix 2)', () => {
    const fleet = [
      fleetRow({ id: 9, name: 'Dup', openCritical: 1 }),
      fleetRow({ id: 4, name: 'Dup', openCritical: 1 }),
    ]
    expect(rankNeedsAttention(fleet).map((r) => r.clientId)).toEqual([4, 9])
  })

  it('respects the limit argument', () => {
    const fleet = [
      fleetRow({ id: 1, seo: series({ latest: 70, delta: -30 }) }),
      fleetRow({ id: 2, seo: series({ latest: 70, delta: -20 }) }),
      fleetRow({ id: 3, seo: series({ latest: 70, delta: -10 }) }),
    ]
    expect(rankNeedsAttention(fleet, 2).map((r) => r.clientId)).toEqual([1, 2])
  })
})
