import { describe, it, expect } from 'vitest'
import { buildLiveChildren, type LiveChildInputRow, LIVE_CHILDREN_LIMIT } from './live-children-helpers'

describe('buildLiveChildren', () => {
  it('returns an empty array for empty input', () => {
    expect(buildLiveChildren([])).toEqual([])
  })

  it('produces a scorecard only for complete children; null otherwise', () => {
    const rows: LiveChildInputRow[] = [
      {
        id: 'a',
        url: 'https://x/a',
        status: 'complete',
        result: JSON.stringify({ violations: [{ impact: 'critical' }], passes: [], incomplete: [] }),
        error: null,
      },
      { id: 'b', url: 'https://x/b', status: 'running', result: null, error: null },
      { id: 'c', url: 'https://x/c', status: 'pending', result: null, error: null },
      { id: 'd', url: 'https://x/d', status: 'error', result: null, error: 'HTTP 403 — Blocked' },
    ]
    const out = buildLiveChildren(rows)
    const byId = Object.fromEntries(out.map((r) => [r.adaAuditId, r]))
    expect(byId.a.status).toBe('complete')
    expect(byId.a.scorecard?.critical).toBe(1)
    expect(byId.b.status).toBe('running')
    expect(byId.b.scorecard).toBeNull()
    expect(byId.c.status).toBe('pending')
    expect(byId.c.scorecard).toBeNull()
    expect(byId.d.status).toBe('error')
    expect(byId.d.scorecard).toBeNull()
    expect(byId.d.error).toBe('HTTP 403 — Blocked')
  })

  it('falls back to "pending" for unknown status values', () => {
    const rows: LiveChildInputRow[] = [
      { id: 'a', url: 'https://x/a', status: 'some-future-status', result: null, error: null },
    ]
    expect(buildLiveChildren(rows)[0].status).toBe('pending')
  })

  it('preserves input order (caller is responsible for sort)', () => {
    const rows: LiveChildInputRow[] = [
      { id: 'a', url: 'https://x/a', status: 'complete', result: '{}', error: null },
      { id: 'b', url: 'https://x/b', status: 'complete', result: '{}', error: null },
      { id: 'c', url: 'https://x/c', status: 'complete', result: '{}', error: null },
    ]
    expect(buildLiveChildren(rows).map((r) => r.adaAuditId)).toEqual(['a', 'b', 'c'])
  })

  it('exposes LIVE_CHILDREN_LIMIT for the route to use as the `take`', () => {
    expect(LIVE_CHILDREN_LIMIT).toBe(100)
  })
})
