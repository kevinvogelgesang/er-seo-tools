import { describe, it, expect } from 'vitest'
import {
  parseStoredQuarterState,
  buildPlanPayload,
  applyPlanResponse,
  sortAssignments,
  sanitizeSnapshotForApply,
  sanitizePlanPayload,
  NUM_WEEKS,
  NOTE_MAX,
  LAYOUTS_MAX_BYTES,
  type AssignmentPayload,
  type QuarterPlanGetResponse,
} from './state'

const currentFormat = JSON.stringify({
  clientState: {
    1: { priority: 1, status: 'in_progress', note: 'hello' },
    2: { priority: 5, status: 'complete', note: '' },
  },
  schedule: { 1: [1], 3: [2] },
  completed: [2],
  slotsPerWeek: 3,
  layouts: { snap: { schedule: { 1: [1] }, completed: [], clients: [{ id: 1, name: 'A', priority: 1, status: 'not_started', note: '' }] } },
  startDate: '2026-07-06',
})

const legacyFormat = JSON.stringify({
  clients: [
    { id: 1, name: 'A', priority: 2, status: 'on_hold', note: 'legacy' },
    { id: 2, name: 'B' }, // missing fields → defaults
  ],
  schedule: { 2: [1] },
  completed: [1],
  snapshots: { old: { schedule: {}, completed: [], clients: [] } },
})

describe('parseStoredQuarterState', () => {
  it('parses the current clientState format', () => {
    const s = parseStoredQuarterState(currentFormat)!
    expect(s.clientState[1]).toEqual({ priority: 1, status: 'in_progress', note: 'hello' })
    expect(s.schedule).toEqual({ 1: [1], 3: [2] })
    expect(s.completed).toEqual([2])
    expect(s.slotsPerWeek).toBe(3)
    expect(Object.keys(s.layouts)).toEqual(['snap'])
    expect(s.startDate).toBe('2026-07-06')
  })

  it('migrates the legacy clients[]/snapshots format', () => {
    const s = parseStoredQuarterState(legacyFormat)!
    expect(s.clientState[1]).toEqual({ priority: 2, status: 'on_hold', note: 'legacy' })
    expect(s.clientState[2]).toEqual({ priority: 3, status: 'not_started', note: '' })
    expect(Object.keys(s.layouts)).toEqual(['old'])
    expect(s.slotsPerWeek).toBe(2)
    expect(s.startDate).toBe('')
  })

  it('returns null for null/corrupt/empty input', () => {
    expect(parseStoredQuarterState(null)).toBeNull()
    expect(parseStoredQuarterState('not json {')).toBeNull()
    expect(parseStoredQuarterState('"a string"')).toBeNull()
    expect(parseStoredQuarterState(JSON.stringify({}))).toBeNull()
    expect(parseStoredQuarterState(JSON.stringify({ clientState: {}, schedule: {}, completed: [] }))).toBeNull()
  })

  it('drops invalid weeks and non-numeric ids', () => {
    const s = parseStoredQuarterState(JSON.stringify({
      clientState: { 1: { priority: 3, status: 'not_started', note: '' } },
      schedule: { 0: [1], 14: [1], 5: [1, 'x', null] },
      completed: [1, 'y'],
    }))!
    expect(s.schedule).toEqual({ 5: [1] })
    expect(s.completed).toEqual([1])
  })
})

describe('buildPlanPayload', () => {
  const input = {
    clientState: {
      1: { priority: 1, status: 'in_progress' as const, note: 'n1' },
      2: { priority: 2, status: 'not_started' as const, note: '' },
      99: { priority: 4, status: 'blocked' as const, note: 'deleted client' },
    },
    schedule: { 2: [2, 99], 1: [1] },
    completed: [2, 99],
    slotsPerWeek: 3,
    layouts: {},
    startDate: '2026-07-06',
  }

  it('flattens schedule into week/position, drops unknown ids, includes pool clients', () => {
    const p = buildPlanPayload(input, [1, 2, 3])
    const byId = new Map(p.assignments.map(a => [a.clientId, a]))
    expect(byId.get(1)).toMatchObject({ week: 1, position: 0, priority: 1, status: 'in_progress', note: 'n1', completed: false })
    expect(byId.get(2)).toMatchObject({ week: 2, position: 0, completed: true }) // 99 dropped → position re-derived from filtered array
    expect(byId.get(3)).toMatchObject({ week: null, position: null, priority: 3, status: 'not_started', note: '', completed: false }) // pool, defaults
    expect(byId.has(99)).toBe(false)
    expect(p.slotsPerWeek).toBe(3)
    expect(p.startDate).toBe('2026-07-06')
  })

  it('keeps first placement when a client appears in two weeks', () => {
    const p = buildPlanPayload({ ...input, schedule: { 1: [1], 2: [1] } }, [1])
    expect(p.assignments.find(a => a.clientId === 1)).toMatchObject({ week: 1, position: 0 })
  })

  it('normalizes bad startDate to null', () => {
    expect(buildPlanPayload({ ...input, startDate: '' }, [1]).startDate).toBeNull()
    expect(buildPlanPayload({ ...input, startDate: 'July 6' }, [1]).startDate).toBeNull()
  })
})

describe('sortAssignments', () => {
  it('orders assigned by week/position, pool last, clientId tie-break', () => {
    const rows = [
      { clientId: 5, week: null, position: null },
      { clientId: 2, week: 1, position: 1 },
      { clientId: 9, week: 1, position: 0 },
      { clientId: 1, week: null, position: null },
      { clientId: 4, week: 2, position: 0 },
    ]
    expect(sortAssignments(rows).map(r => r.clientId)).toEqual([9, 2, 4, 1, 5])
  })
})

describe('applyPlanResponse', () => {
  const resp: QuarterPlanGetResponse = {
    plan: { name: 'P', startDate: '2026-07-06', slotsPerWeek: 2, layouts: {}, updatedAt: '2026-06-11T00:00:00.000Z' },
    assignments: [
      { clientId: 2, week: 1, position: 1, priority: 2, status: 'not_started', note: '', completed: true },
      { clientId: 1, week: 1, position: 0, priority: 1, status: 'in_progress', note: 'n', completed: false },
      { clientId: 3, week: null, position: null, priority: 4, status: 'on_hold', note: '', completed: false },
      { clientId: 99, week: 2, position: 0, priority: 3, status: 'not_started', note: '', completed: true },
    ],
  }

  it('rebuilds schedule in position order, prunes unknown ids', () => {
    const a = applyPlanResponse(resp, [1, 2, 3])!
    expect(a.schedule).toEqual({ 1: [1, 2] })
    expect(a.completed).toEqual([2])
    expect(a.clientState[3]).toEqual({ priority: 4, status: 'on_hold', note: '' })
    expect(a.clientState[99]).toBeUndefined()
    expect(a.startDate).toBe('2026-07-06')
  })

  it('returns null when plan is null', () => {
    expect(applyPlanResponse({ plan: null }, [1])).toBeNull()
  })
})

describe('sanitizeSnapshotForApply', () => {
  it('patches only current clients, never resurrects deleted ones', () => {
    const snap = {
      schedule: { 1: [1, 99] },
      completed: [99, 2],
      clients: [
        { id: 1, name: 'Stale Name', priority: 5, status: 'blocked' as const, note: 'x' },
        { id: 99, name: 'Deleted', priority: 1, status: 'complete' as const, note: '' },
      ],
    }
    const r = sanitizeSnapshotForApply(snap, [1, 2])
    expect(r.clientPatches.get(1)).toEqual({ priority: 5, status: 'blocked', note: 'x' })
    expect(r.clientPatches.has(99)).toBe(false)
    expect(r.schedule).toEqual({ 1: [1] })
    expect(r.completed).toEqual([2])
  })

  it('returns an empty result for malformed snapshots instead of crashing', () => {
    for (const bad of ['garbage', null, 42, [1, 2], { clients: 'nope', schedule: 7, completed: 'x' }]) {
      const r = sanitizeSnapshotForApply(bad, [1])
      expect(r.clientPatches.size).toBe(0)
      expect(r.schedule).toEqual({})
      expect(r.completed).toEqual([])
    }
  })
})

describe('sanitizePlanPayload', () => {
  const valid = {
    name: 'Q3', startDate: '2026-07-06', slotsPerWeek: 2, layouts: {},
    assignments: [{ clientId: 1, week: 1, position: 0, priority: 1, status: 'in_progress', note: 'ok', completed: false }],
  }

  it('accepts a valid payload', () => {
    const r = sanitizePlanPayload(valid)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.assignments).toHaveLength(1)
  })

  it('clamps and coerces row fields', () => {
    const r = sanitizePlanPayload({
      ...valid,
      slotsPerWeek: 7,
      startDate: 'bogus',
      assignments: [
        { clientId: 1, week: 99, position: 2, priority: 9, status: 'nope', note: 'z'.repeat(500), completed: 'yes' },
        { clientId: 1, week: 2, position: 0, priority: 1, status: 'complete', note: '', completed: true }, // dup → keep-first
        { clientId: -4, week: 1, position: 0, priority: 1, status: 'complete', note: '', completed: true }, // bad id → dropped
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.slotsPerWeek).toBe(2)
    expect(r.payload.startDate).toBeNull()
    expect(r.payload.assignments).toHaveLength(1)
    const a = r.payload.assignments[0] as AssignmentPayload
    expect(a).toMatchObject({ clientId: 1, week: null, position: null, priority: 5, status: 'not_started', completed: false })
    expect(a.note).toHaveLength(NOTE_MAX)
  })

  it('rejects non-object bodies and oversized layouts', () => {
    expect(sanitizePlanPayload(null).ok).toBe(false)
    expect(sanitizePlanPayload([1]).ok).toBe(false)
    const big = { ...valid, layouts: { huge: { schedule: {}, completed: [], clients: [], pad: 'x'.repeat(LAYOUTS_MAX_BYTES) } } }
    expect(sanitizePlanPayload(big).ok).toBe(false)
  })

  it('forces position null when week is null', () => {
    const r = sanitizePlanPayload({ ...valid, assignments: [{ clientId: 1, week: null, position: 3, priority: 3, status: 'not_started', note: '', completed: false }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.assignments[0]).toMatchObject({ week: null, position: null })
  })

  it('week bounds are 1..NUM_WEEKS', () => {
    const r = sanitizePlanPayload({ ...valid, assignments: [{ clientId: 1, week: NUM_WEEKS, position: 0, priority: 3, status: 'not_started', note: '', completed: false }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.assignments[0].week).toBe(NUM_WEEKS)
  })
})
