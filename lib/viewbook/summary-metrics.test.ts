// Pure metrics feeding the public viewbook's summary faces (PR7 Task 6). Each
// function reads ONLY the shape it needs (not the full ViewbookPublicData) so
// it stays trivially unit-testable and reusable outside the section it backs.
import { describe, expect, it } from 'vitest'
import { milestoneProgress, answeredProgress, inviteProgress, docCount } from './summary-metrics'

describe('milestoneProgress', () => {
  it('counts done milestones against the total', () => {
    expect(
      milestoneProgress([{ status: 'done' } as any, { status: 'current' } as any]),
    ).toEqual({ done: 1, total: 2 })
  })

  it('returns {done:0,total:0} for an empty list', () => {
    expect(milestoneProgress([])).toEqual({ done: 0, total: 0 })
  })
})

describe('answeredProgress', () => {
  it('ignores empty/whitespace values, counts non-blank ones as answered', () => {
    expect(
      answeredProgress([
        { category: 's', fields: [{ value: 'x' } as any, { value: ' ' } as any, { value: null } as any] },
      ] as any),
    ).toEqual({ answered: 1, total: 3 })
  })

  it('sums across multiple categories', () => {
    expect(
      answeredProgress([
        { category: 'a', fields: [{ value: 'x' } as any, { value: 'y' } as any] },
        { category: 'b', fields: [{ value: null } as any] },
      ] as any),
    ).toEqual({ answered: 2, total: 3 })
  })

  it('returns {answered:0,total:0} when there are no categories', () => {
    expect(answeredProgress([])).toEqual({ answered: 0, total: 0 })
  })
})

describe('inviteProgress', () => {
  it('counts invited members against the total roster', () => {
    expect(
      inviteProgress([{ invited: true } as any, { invited: false } as any]),
    ).toEqual({ invited: 1, total: 2 })
  })

  it('returns {invited:0,total:0} for an empty roster', () => {
    expect(inviteProgress([])).toEqual({ invited: 0, total: 0 })
  })
})

describe('docCount', () => {
  it('sums global and own doc rows', () => {
    expect(docCount({ global: [{}, {}] as any, own: [{}] as any })).toBe(3)
  })

  it('returns 0 when both lists are empty', () => {
    expect(docCount({ global: [], own: [] })).toBe(0)
  })
})
