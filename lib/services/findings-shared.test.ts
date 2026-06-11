// lib/services/findings-shared.test.ts
import { describe, it, expect } from 'vitest'
import {
  selectRuns, aggregateSeoTypes, aggregateAdaTypes, collapseTypeGroups,
  diffTypes, newCriticalTypes, toSeverity, SEVERITY_RANK, URLS_PER_FINDING,
  type RunRef, type TypeAggregate,
} from './findings-shared'

const d = (iso: string) => new Date(iso)

function run(over: Partial<RunRef>): RunRef {
  return {
    id: 'r1', tool: 'seo-parser', source: 'sf-upload', domain: 'a.example',
    completedAt: d('2026-06-01T00:00:00Z'), createdAt: d('2026-06-01T00:00:00Z'),
    sessionId: 's1', siteAuditId: null, adaAuditId: null, ...over,
  }
}

describe('selectRuns', () => {
  it('picks latest SEO run and domain-matched previous', () => {
    const runs = [
      run({ id: 'old', completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'new', completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set())
    expect(sel.seo.current?.id).toBe('new')
    expect(sel.seo.previous?.id).toBe('old')
  })

  it('excludes keyword-research runs from SEO candidates', () => {
    const runs = [
      run({ id: 'tech', sessionId: 'tech-s', completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'kw', sessionId: 'kw-s', completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set(['kw-s']))
    expect(sel.seo.current?.id).toBe('tech')
    expect(sel.seo.previous).toBeNull()
  })

  it('previous must match current domain; cross-domain runs are skipped', () => {
    const runs = [
      run({ id: 'b-old', domain: 'b.example', completedAt: d('2026-04-01T00:00:00Z') }),
      run({ id: 'a-old', domain: 'a.example', completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'b-new', domain: 'b.example', completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set())
    expect(sel.seo.current?.id).toBe('b-new')
    expect(sel.seo.previous?.id).toBe('b-old') // a-old skipped (wrong domain)
  })

  it('null-domain current gets no previous', () => {
    const runs = [
      run({ id: 'old', domain: null, completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'new', domain: null, completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    expect(selectRuns(runs, new Set()).seo.previous).toBeNull()
  })

  it('breaks timestamp ties by id desc, deterministically', () => {
    const t = d('2026-06-01T00:00:00Z')
    const runs = [
      run({ id: 'aaa', completedAt: t }),
      run({ id: 'zzz', completedAt: t }),
    ]
    expect(selectRuns(runs, new Set()).seo.current?.id).toBe('zzz')
  })

  it('falls back to createdAt when completedAt is null', () => {
    const runs = [
      run({ id: 'done', completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'undated', completedAt: null, createdAt: d('2026-06-01T00:00:00Z') }),
    ]
    expect(selectRuns(runs, new Set()).seo.current?.id).toBe('undated')
  })

  it('ADA: any site-audit run forces site class; page runs ignored', () => {
    const runs = [
      run({ id: 'page', tool: 'ada-audit', source: 'page-audit', adaAuditId: 'a1', sessionId: null, completedAt: d('2026-06-05T00:00:00Z') }),
      run({ id: 'site', tool: 'ada-audit', source: 'site-audit', siteAuditId: 'sa1', sessionId: null, completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set())
    expect(sel.ada.sourceClass).toBe('site')
    expect(sel.ada.current?.id).toBe('site')
  })

  it('ADA page class never gets a previous (standalone audits not comparable)', () => {
    const runs = [
      run({ id: 'p1', tool: 'ada-audit', source: 'page-audit', adaAuditId: 'a1', sessionId: null, completedAt: d('2026-05-01T00:00:00Z') }),
      run({ id: 'p2', tool: 'ada-audit', source: 'page-audit', adaAuditId: 'a2', sessionId: null, completedAt: d('2026-06-01T00:00:00Z') }),
    ]
    const sel = selectRuns(runs, new Set())
    expect(sel.ada.sourceClass).toBe('page')
    expect(sel.ada.current?.id).toBe('p2')
    expect(sel.ada.previous).toBeNull()
  })

  it('no runs → all null', () => {
    const sel = selectRuns([], new Set())
    expect(sel.seo.current).toBeNull()
    expect(sel.ada.current).toBeNull()
    expect(sel.ada.sourceClass).toBeNull()
  })
})

describe('aggregation', () => {
  it('aggregateSeoTypes passes run-scope rows through with cast severity', () => {
    const out = aggregateSeoTypes([{ type: 'missing_title', severity: 'critical', count: 12 }])
    expect(out).toEqual([{ type: 'missing_title', severity: 'critical', count: 12 }])
  })

  it('unknown severities degrade to notice', () => {
    expect(toSeverity('bogus')).toBe('notice')
  })

  it('aggregateAdaTypes groups by type: count = rows, severity = max', () => {
    const out = aggregateAdaTypes([
      { type: 'color-contrast', severity: 'warning' },
      { type: 'color-contrast', severity: 'critical' },
      { type: 'image-alt', severity: 'critical' },
    ])
    const cc = out.find((a) => a.type === 'color-contrast')!
    expect(cc.count).toBe(2)
    expect(cc.severity).toBe('critical') // max across rows
  })

  it('collapseTypeGroups merges mixed-severity groups into one per type (Codex fix #3)', () => {
    const out = collapseTypeGroups([
      { type: 'color-contrast', severity: 'warning', count: 3 },
      { type: 'color-contrast', severity: 'critical', count: 2 },
    ])
    expect(out).toEqual([{ type: 'color-contrast', severity: 'critical', count: 5 }])
  })
})

describe('diffTypes', () => {
  const cur: TypeAggregate[] = [
    { type: 'a', severity: 'critical', count: 5 },
    { type: 'b', severity: 'warning', count: 2 },
  ]
  it('null previous → nothing new, nothing resolved, no deltas', () => {
    const diff = diffTypes(cur, null)
    expect(diff.newTypes.size).toBe(0)
    expect(diff.resolvedCount).toBe(0)
    expect(diff.countDelta.size).toBe(0)
  })
  it('computes new types, resolved count, and per-type deltas', () => {
    const diff = diffTypes(cur, [{ type: 'b', count: 5 }, { type: 'gone', count: 1 }])
    expect([...diff.newTypes]).toEqual(['a'])
    expect(diff.resolvedCount).toBe(1)
    expect(diff.countDelta.get('b')).toBe(-3)
    expect(diff.countDelta.has('a')).toBe(false) // new types have no delta
  })
})

describe('newCriticalTypes', () => {
  const cur: TypeAggregate[] = [
    { type: 'a', severity: 'critical', count: 5 },
    { type: 'b', severity: 'warning', count: 2 },
  ]
  it('null previous → empty (no baseline, no regression)', () => {
    expect(newCriticalTypes(cur, null)).toEqual([])
  })
  it('returns critical types absent from previous; warnings never alert', () => {
    expect(newCriticalTypes(cur, new Set())).toEqual(['a'])
    expect(newCriticalTypes(cur, new Set(['a']))).toEqual([])
  })
})

describe('constants', () => {
  it('exports rank and cap', () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.warning)
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.notice)
    expect(URLS_PER_FINDING).toBe(25)
  })
})
