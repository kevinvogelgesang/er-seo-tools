// lib/services/scorecard-shared.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildSeries, buildSeoSeries, buildAdaSeries, computeAlerts, latestRunStatus, maxIso,
  EMPTY_SERIES, SPARKLINE_POINTS, SCORE_DROP_THRESHOLD, STALE_DAYS,
  type ScorePoint,
} from './scorecard-shared'

const D = (s: string) => new Date(s)
const NOW = D('2026-06-11T12:00:00.000Z')

describe('buildSeries', () => {
  it('returns EMPTY_SERIES for no points', () => {
    expect(buildSeries([])).toEqual(EMPTY_SERIES)
  })
  it('sorts ascending, computes latest/previous/delta/latestAt', () => {
    const s = buildSeries([
      { date: '2026-06-10T00:00:00.000Z', score: 90 },
      { date: '2026-06-01T00:00:00.000Z', score: 80 },
    ])
    expect(s.latest).toBe(90)
    expect(s.previous).toBe(80)
    expect(s.delta).toBe(10)
    expect(s.latestAt).toBe('2026-06-10T00:00:00.000Z')
    expect(s.points.map((p) => p.score)).toEqual([80, 90])
  })
  it('delta is null with a single point', () => {
    const s = buildSeries([{ date: '2026-06-10T00:00:00.000Z', score: 90 }])
    expect(s.latest).toBe(90)
    expect(s.delta).toBeNull()
    expect(s.previous).toBeNull()
  })
  it(`caps points at ${SPARKLINE_POINTS}, keeping the most recent`, () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, score: i,
    }))
    const s = buildSeries(pts)
    expect(s.points).toHaveLength(SPARKLINE_POINTS)
    expect(s.points[0].score).toBe(20 - SPARKLINE_POINTS)
    expect(s.points[s.points.length - 1].score).toBe(19)
  })
})

describe('buildSeries version awareness', () => {
  it('computes a numeric delta within one version', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 1 },
      { date: '2026-07-01T00:00:00Z', score: 80, scoreVersion: 1 },
    ])
    expect(s.delta).toBe(10)
    expect(s.formulaChanged).toBe(false)
  })
  it('suppresses the delta across a v1→v2 boundary', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 1 },
      { date: '2026-07-01T00:00:00Z', score: 90, scoreVersion: 2 },
    ])
    expect(s.delta).toBeNull()
    expect(s.formulaChanged).toBe(true)
  })
  it('treats an absent version as 1', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70 },
      { date: '2026-07-01T00:00:00Z', score: 80 },
    ])
    expect(s.delta).toBe(10)
    expect(s.formulaChanged).toBe(false)
  })
})

describe('buildSeries comparabilityBreak (weightsHash awareness)', () => {
  it('EMPTY_SERIES has comparabilityBreak: null', () => {
    expect(EMPTY_SERIES.comparabilityBreak).toBeNull()
  })
  it('two v1 points (no breakdown at all) produce a real delta and no break — regression guard', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70 },
      { date: '2026-07-01T00:00:00Z', score: 80 },
    ])
    expect(s.delta).toBe(10)
    expect(s.comparabilityBreak).toBeNull()
    expect(s.formulaChanged).toBe(false)
  })
  it('v1 -> v2 adjacent points break on version, delta null', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 1, weightsHash: null },
      { date: '2026-07-01T00:00:00Z', score: 90, scoreVersion: 2, weightsHash: 'hash-a' },
    ])
    expect(s.delta).toBeNull()
    expect(s.comparabilityBreak).toBe('version')
    expect(s.formulaChanged).toBe(true)
  })
  it('two v2 points with the same weightsHash produce a real delta, no break', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 2, weightsHash: 'hash-a' },
      { date: '2026-07-01T00:00:00Z', score: 90, scoreVersion: 2, weightsHash: 'hash-a' },
    ])
    expect(s.delta).toBe(20)
    expect(s.comparabilityBreak).toBeNull()
    expect(s.formulaChanged).toBe(false)
  })
  it('two v2 points with different weightsHash break on weights, delta null', () => {
    const s = buildSeries([
      { date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 2, weightsHash: 'hash-a' },
      { date: '2026-07-01T00:00:00Z', score: 90, scoreVersion: 2, weightsHash: 'hash-b' },
    ])
    expect(s.delta).toBeNull()
    expect(s.comparabilityBreak).toBe('weights')
    expect(s.formulaChanged).toBe(true)
  })
  it('formulaChanged === (comparabilityBreak !== null) invariant', () => {
    const cases: Array<[ScorePoint, ScorePoint]> = [
      [{ date: '2026-06-01T00:00:00Z', score: 70 }, { date: '2026-07-01T00:00:00Z', score: 80 }],
      [{ date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 1 }, { date: '2026-07-01T00:00:00Z', score: 90, scoreVersion: 2 }],
      [{ date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 2, weightsHash: 'h1' }, { date: '2026-07-01T00:00:00Z', score: 90, scoreVersion: 2, weightsHash: 'h1' }],
      [{ date: '2026-06-01T00:00:00Z', score: 70, scoreVersion: 2, weightsHash: 'h1' }, { date: '2026-07-01T00:00:00Z', score: 90, scoreVersion: 2, weightsHash: 'h2' }],
    ]
    for (const [a, b] of cases) {
      const s = buildSeries([a, b])
      expect(s.formulaChanged).toBe(s.comparabilityBreak !== null)
    }
  })
})

describe('buildSeoSeries', () => {
  it('uses completedAt ?? createdAt, skips null scores, builds latestHref from sessionId', () => {
    const { series, latestHref } = buildSeoSeries([
      { score: 80, completedAt: D('2026-06-01T00:00:00.000Z'), createdAt: D('2026-05-31T00:00:00.000Z'), sessionId: 'sess-a' },
      { score: null, completedAt: D('2026-06-05T00:00:00.000Z'), createdAt: D('2026-06-05T00:00:00.000Z'), sessionId: 'sess-skip' },
      { score: 90, completedAt: null, createdAt: D('2026-06-10T00:00:00.000Z'), sessionId: 'sess-b' },
    ])
    expect(series.latest).toBe(90)
    expect(series.delta).toBe(10)
    expect(latestHref).toBe('/seo-audits/results/sess-b')
  })
  it('latestHref is null when the latest run is an orphan (sessionId SetNull)', () => {
    const { latestHref } = buildSeoSeries([
      { score: 90, completedAt: D('2026-06-10T00:00:00.000Z'), createdAt: D('2026-06-10T00:00:00.000Z'), sessionId: null },
    ])
    expect(latestHref).toBeNull()
  })

  it('reads scoreVersion + weightsHash from scoreBreakdown (C19) and suppresses the delta on a weights change', () => {
    const { series } = buildSeoSeries([
      {
        score: 70, completedAt: D('2026-06-01T00:00:00.000Z'), createdAt: D('2026-06-01T00:00:00.000Z'),
        sessionId: 'sess-a', scoreBreakdown: JSON.stringify({ version: 2, weightsHash: 'hash-a' }),
      },
      {
        score: 90, completedAt: D('2026-06-10T00:00:00.000Z'), createdAt: D('2026-06-10T00:00:00.000Z'),
        sessionId: 'sess-b', scoreBreakdown: JSON.stringify({ version: 2, weightsHash: 'hash-b' }),
      },
    ])
    expect(series.points.map((p) => p.scoreVersion)).toEqual([2, 2])
    expect(series.delta).toBeNull()
    expect(series.comparabilityBreak).toBe('weights')
  })
})

describe('buildAdaSeries', () => {
  const siteRun = { source: 'site-audit', score: 88 as number | null, completedAt: D('2026-06-10T00:00:00.000Z'), createdAt: D('2026-06-10T00:00:00.000Z'), siteAuditId: 'sa-1', adaAuditId: null }
  const pageRun = { source: 'page-audit', score: 75 as number | null, completedAt: D('2026-06-09T00:00:00.000Z'), createdAt: D('2026-06-09T00:00:00.000Z'), siteAuditId: null, adaAuditId: 'ada-1' }
  const legacy = (id: string, score: number | null, date: string, status = 'complete') =>
    ({ id, status, score, completedAt: D(date), createdAt: D(date) })

  it('prefers site-audit runs when any scored site point exists (page runs ignored)', () => {
    const { series, source } = buildAdaSeries([siteRun, pageRun], [])
    expect(source).toBe('site')
    expect(series.latest).toBe(88)
    expect(series.points).toHaveLength(1)
  })
  it('falls back to page-audit runs merged with non-null legacy scores, deduped by origin id', () => {
    const { series, source, latestHref } = buildAdaSeries(
      [pageRun],
      [legacy('ada-1', 75, '2026-06-09T00:00:00.000Z'), legacy('ada-2', 60, '2026-06-01T00:00:00.000Z')],
    )
    expect(source).toBe('page')
    // ada-1 covered by the CrawlRun point; legacy ada-2 contributes the second point
    expect(series.points.map((p) => p.score)).toEqual([60, 75])
    expect(series.delta).toBe(15)
    expect(latestHref).toBe('/ada-audit/ada-1')
  })
  it('falls back to page audits when site-audit runs exist but none are scored', () => {
    const nullSiteRun = { ...siteRun, score: null }
    const { series, source } = buildAdaSeries([nullSiteRun, pageRun], [])
    expect(source).toBe('page')
    expect(series.latest).toBe(75)
  })
  it('ignores legacy rows with null score or non-complete status', () => {
    const { series, source } = buildAdaSeries([], [
      legacy('ada-3', null, '2026-06-01T00:00:00.000Z'),
      legacy('ada-4', 50, '2026-06-02T00:00:00.000Z', 'error'),
    ])
    expect(source).toBeNull()
    expect(series).toEqual(EMPTY_SERIES)
  })
  it('site latestHref points at the site audit', () => {
    const { latestHref } = buildAdaSeries([siteRun], [])
    expect(latestHref).toBe('/ada-audit/site/sa-1')
  })

  it('attaches scoreVersion from scoreBreakdown and suppresses the delta across a formula-version boundary (C9-A)', () => {
    const v1Run = { ...siteRun, score: 60, completedAt: D('2026-05-01T00:00:00.000Z'), createdAt: D('2026-05-01T00:00:00.000Z'), scoreBreakdown: null }
    const v2Run = { ...siteRun, score: 85, completedAt: D('2026-06-10T00:00:00.000Z'), createdAt: D('2026-06-10T00:00:00.000Z'), scoreBreakdown: JSON.stringify({ version: 2 }) }
    const { series } = buildAdaSeries([v1Run, v2Run], [])
    expect(series.points.map((p) => p.scoreVersion)).toEqual([1, 2])
    expect(series.delta).toBeNull()
    expect(series.formulaChanged).toBe(true)
  })

  it('ADA v4 pair with the same scoreVersion but differing weightsHash breaks on weights (C19)', () => {
    const a = { ...siteRun, score: 60, completedAt: D('2026-05-01T00:00:00.000Z'), createdAt: D('2026-05-01T00:00:00.000Z'), scoreBreakdown: JSON.stringify({ version: 4, weightsHash: 'hash-a' }) }
    const b = { ...siteRun, score: 85, completedAt: D('2026-06-10T00:00:00.000Z'), createdAt: D('2026-06-10T00:00:00.000Z'), scoreBreakdown: JSON.stringify({ version: 4, weightsHash: 'hash-b' }) }
    const { series } = buildAdaSeries([a, b], [])
    expect(series.points.map((p) => p.scoreVersion)).toEqual([4, 4])
    expect(series.delta).toBeNull()
    expect(series.comparabilityBreak).toBe('weights')
    expect(series.formulaChanged).toBe(true)
  })

  it('legacy AdaAudit rows always contribute a v1 point (predate score versioning)', () => {
    const { series } = buildAdaSeries(
      [{ ...pageRun, scoreBreakdown: JSON.stringify({ version: 2 }) }],
      [legacy('ada-2', 60, '2026-06-01T00:00:00.000Z')],
    )
    expect(series.points.map((p) => p.scoreVersion)).toEqual([1, 2])
    expect(series.formulaChanged).toBe(true)
  })
})

describe('latestRunStatus', () => {
  it('returns the status of the most recent row by createdAt, null when empty', () => {
    expect(latestRunStatus([])).toBeNull()
    expect(latestRunStatus([
      { createdAt: D('2026-06-01T00:00:00.000Z'), status: 'error' },
      { createdAt: D('2026-06-10T00:00:00.000Z'), status: 'complete' },
    ])).toBe('complete')
  })
})

describe('maxIso', () => {
  it('returns the max ISO string, ignoring nulls; null when all null', () => {
    expect(maxIso([null, '2026-06-01T00:00:00.000Z', '2026-06-10T00:00:00.000Z'])).toBe('2026-06-10T00:00:00.000Z')
    expect(maxIso([null, null])).toBeNull()
    expect(maxIso([])).toBeNull()
  })
})

describe('computeAlerts', () => {
  const recent = '2026-06-10T00:00:00.000Z' // 1 day before NOW
  const base = { seo: EMPTY_SERIES, ada: EMPTY_SERIES, erroredTools: [], newCriticalTypes: [], lastActivityAt: recent, now: NOW }

  it('no alerts for a healthy recent client', () => {
    expect(computeAlerts(base)).toEqual([])
  })
  it(`score-drop fires at delta <= -${SCORE_DROP_THRESHOLD}, not above`, () => {
    const drop = { ...EMPTY_SERIES, latest: 70, previous: 80, delta: -SCORE_DROP_THRESHOLD }
    expect(computeAlerts({ ...base, seo: drop }).some((a) => a.kind === 'score-drop')).toBe(true)
    const small = { ...EMPTY_SERIES, latest: 71, previous: 80, delta: -(SCORE_DROP_THRESHOLD - 1) }
    expect(computeAlerts({ ...base, seo: small })).toEqual([])
    expect(computeAlerts({ ...base, ada: drop }).some((a) => a.kind === 'score-drop')).toBe(true)
  })
  it('error alert per errored tool', () => {
    const alerts = computeAlerts({ ...base, erroredTools: ['SEO parse', 'site audit'] })
    expect(alerts.filter((a) => a.kind === 'error')).toHaveLength(2)
  })
  it(`stale fires when no activity in ${STALE_DAYS} days or ever`, () => {
    const old = new Date(NOW.getTime() - (STALE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString()
    expect(computeAlerts({ ...base, lastActivityAt: old }).some((a) => a.kind === 'stale')).toBe(true)
    expect(computeAlerts({ ...base, lastActivityAt: null }).some((a) => a.kind === 'stale')).toBe(true)
    expect(computeAlerts({ ...base, lastActivityAt: recent })).toEqual([])
  })
  it('regression alert fires when newCriticalTypes is non-empty, with count grammar', () => {
    expect(computeAlerts({ ...base, newCriticalTypes: ['broken_pages', 'missing_title'] }))
      .toContainEqual({ kind: 'regression', detail: '2 new critical issue types' })
    expect(computeAlerts({ ...base, newCriticalTypes: ['x'] }))
      .toContainEqual({ kind: 'regression', detail: '1 new critical issue type' })
    expect(computeAlerts({ ...base, newCriticalTypes: [] }).some((a) => a.kind === 'regression')).toBe(false)
  })
})
