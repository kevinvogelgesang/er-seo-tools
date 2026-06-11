// lib/quarter-grid/grid-ops.test.ts
import { describe, it, expect } from 'vitest'
import {
  removeFromSchedule, dropChipOnSlot, frontierWeek, placeInWeek,
  nextPoolChipId, sortPool, autoDistributeSchedule, applyCsvRows, getWeekRange,
  type GridClient,
} from './grid-ops'

const client = (id: number, name: string, priority = 3): GridClient =>
  ({ id, name, priority, status: 'not_started', note: '' })

describe('removeFromSchedule', () => {
  it('strips the id from every week without mutating input', () => {
    const input = { 1: [10, 20], 2: [10, 30] }
    const out = removeFromSchedule(input, 10)
    expect(out).toEqual({ 1: [20], 2: [30] })
    expect(input).toEqual({ 1: [10, 20], 2: [10, 30] })
  })
})

describe('dropChipOnSlot', () => {
  it('drops into an empty slot of an empty week', () => {
    expect(dropChipOnSlot({}, { id: 5, fromWeek: null }, 3, 0)).toEqual({ 3: [5] })
  })

  it('moves between weeks: removes from source week (emptied key survives as [])', () => {
    const out = dropChipOnSlot({ 1: [5], 2: [9] }, { id: 5, fromWeek: 1 }, 2, 1)
    expect(out).toEqual({ 1: [], 2: [9, 5] })
  })

  it('swap: dropping onto an occupied slot returns the displaced chip to the source week', () => {
    const out = dropChipOnSlot({ 1: [5], 2: [9] }, { id: 5, fromWeek: 1 }, 2, 0)
    expect(out[2]).toEqual([5])
    expect(out[1]).toEqual([9])
  })

  it('pool-sourced drop onto an occupied slot silently returns the displaced chip to the pool', () => {
    // fromWeek=null → the displaced chip is NOT re-placed anywhere (it falls
    // back to the pool because it no longer appears in any week). Verbatim
    // current behavior.
    const out = dropChipOnSlot({ 2: [9] }, { id: 5, fromWeek: null }, 2, 0)
    expect(out).toEqual({ 2: [5] })
  })

  it('drop beyond current row length appends (padding zeros are filtered)', () => {
    const out = dropChipOnSlot({ 2: [9] }, { id: 5, fromWeek: null }, 2, 2)
    expect(out[2]).toEqual([9, 5])
  })

  it('dropping a chip onto itself is a no-op placement', () => {
    const out = dropChipOnSlot({ 2: [5] }, { id: 5, fromWeek: 2 }, 2, 0)
    expect(out[2]).toEqual([5])
  })
})

describe('frontierWeek / placeInWeek', () => {
  it('empty schedule → week 1', () => {
    expect(frontierWeek({}, 2)).toBe(1)
  })
  it('last populated week has an open slot → that week', () => {
    expect(frontierWeek({ 1: [1, 2], 3: [4] }, 2)).toBe(3)
  })
  it('last populated week is full → next week', () => {
    expect(frontierWeek({ 3: [4, 5] }, 2)).toBe(4)
  })
  it('caps at week 13', () => {
    expect(frontierWeek({ 13: [1, 2] }, 2)).toBe(13)
  })
  it('placeInWeek removes prior placement and appends', () => {
    expect(placeInWeek({ 1: [7], 2: [8] }, 7, 2)).toEqual({ 1: [], 2: [8, 7] })
  })
})

describe('nextPoolChipId / sortPool', () => {
  const clients = [client(1, 'zeta', 1), client(2, 'alpha', 1), client(3, 'mid', 5)]
  it('sorts pool by priority then name', () => {
    expect(sortPool(clients, new Set()).map(c => c.id)).toEqual([2, 1, 3])
  })
  it('next chip excludes assigned ids and the just-assigned id', () => {
    expect(nextPoolChipId(clients, { 1: [2] }, 1)).toBe(3)
  })
  it('returns null when the pool empties', () => {
    expect(nextPoolChipId(clients, { 1: [2, 3] }, 1)).toBeNull()
  })
})

describe('autoDistributeSchedule', () => {
  it('3/wk fills weeks in chunks of 3 in priority-then-name order', () => {
    const cs = [client(1, 'b', 2), client(2, 'a', 2), client(3, 'c', 1), client(4, 'd', 3)]
    const out = autoDistributeSchedule(cs, 3)
    expect(out[1]).toEqual([3, 2, 1])
    expect(out[2]).toEqual([4])
  })
  it('2/wk gives heavy weeks (1,4,7,11) capacity 3, others 2', () => {
    const cs = Array.from({ length: 10 }, (_, i) => client(i + 1, `c${String(i + 1).padStart(2, '0')}`, 3))
    const out = autoDistributeSchedule(cs, 2)
    expect(out[1]).toHaveLength(3) // heavy
    expect(out[2]).toHaveLength(2)
    expect(out[3]).toHaveLength(2)
    expect(out[4]).toHaveLength(3) // heavy
    expect(out[5]).toBeUndefined() // 10 clients exhausted: 3+2+2+3
  })
})

describe('applyCsvRows', () => {
  const clients = [client(1, 'Acme College', 3), client(2, 'Beta School', 3)]
  it('matches names case-insensitively, assigns weeks, updates priority/status', () => {
    const rows = [
      { client_name: 'acme college', week: '2', priority: '1', status: 'In Progress' },
      { client: 'Beta School', week_assigned: '99' }, // week clamps to 13
    ]
    const out = applyCsvRows(rows, clients, {})
    expect(out.schedule[2]).toEqual([1])
    expect(out.schedule[13]).toEqual([2])
    expect(out.assignCount).toBe(2)
    expect(out.clientUpdates.get(1)).toEqual({ priority: 1, status: 'in_progress' })
    expect(out.clientUpdates.has(2)).toBe(false)
  })
  it('reassignment removes the prior week placement', () => {
    const out = applyCsvRows([{ client_name: 'Acme College', week: '5' }], clients, { 1: [1, 2] })
    expect(out.schedule[1]).toEqual([2])
    expect(out.schedule[5]).toEqual([1])
  })
  it('collects unrecognized names once each; blank names skipped', () => {
    const rows = [
      { client_name: 'Nope U' }, { client_name: 'Nope U' }, { client_name: '' },
    ]
    const out = applyCsvRows(rows, clients, {})
    expect(out.unrecognized).toEqual(['Nope U'])
    expect(out.assignCount).toBe(0)
  })
  it('invalid priority/status are ignored, row still assigns', () => {
    const out = applyCsvRows([{ client_name: 'Acme College', week: '1', priority: 'x', status: 'bogus' }], clients, {})
    expect(out.clientUpdates.size).toBe(0)
    expect(out.schedule[1]).toEqual([1])
  })
})

describe('getWeekRange', () => {
  it('formats Mon–Fri of the requested week', () => {
    expect(getWeekRange('2026-01-05', 1)).toBe('1/5–1/9')   // Mon Jan 5 2026
    expect(getWeekRange('2026-01-05', 2)).toBe('1/12–1/16')
  })
  it('crosses month boundaries', () => {
    expect(getWeekRange('2026-01-26', 1)).toBe('1/26–1/30')
    expect(getWeekRange('2026-01-26', 2)).toBe('2/2–2/6')
  })
  it('returns null for empty or garbage startDate', () => {
    expect(getWeekRange('', 1)).toBeNull()
    expect(getWeekRange('not-a-date', 1)).toBeNull()
  })
})
