import { describe, it, expect } from 'vitest'
import { computeSectionStatuses, carriedStatus } from './section-status'

const sec = (sectionKey: string, state: 'active'|'done'|'collapsed', acknowledgedAt: string | null = null) =>
  ({ sectionKey, state, acknowledgedAt }) as any

describe('computeSectionStatuses', () => {
  it('done → complete; first active informational → current; later active → upcoming', () => {
    const order = ['welcome', 'milestones', 'strategy'] as any
    const secs = [sec('welcome', 'done'), sec('milestones', 'active'), sec('strategy', 'active')]
    const r = computeSectionStatuses(order, secs, { pcCompletedAt: null })
    expect(r.welcome).toBe('complete')
    expect(r.milestones).toBe('current')
    expect(r.strategy).toBe('upcoming')
  })
  it('active input-expecting → needs-input; acknowledged input → complete', () => {
    const order = ['pc-setup', 'data-source'] as any
    const secs = [sec('pc-setup', 'active'), sec('data-source', 'active', '2026-07-01T00:00:00Z')]
    const r = computeSectionStatuses(order, secs, { pcCompletedAt: null })
    expect(r['pc-setup']).toBe('needs-input')
    expect(r['data-source']).toBe('complete')
  })
  it('pc-intro is complete once pcCompletedAt is set, else current', () => {
    const order = ['pc-intro', 'pc-setup'] as any
    const active = computeSectionStatuses(order, [sec('pc-intro', 'active'), sec('pc-setup', 'active')], { pcCompletedAt: null })
    expect(active['pc-intro']).toBe('current')
    const done = computeSectionStatuses(order, [sec('pc-intro', 'active'), sec('pc-setup', 'done')], { pcCompletedAt: '2026-07-01T00:00:00Z' })
    expect(done['pc-intro']).toBe('complete')
  })
  it('all-complete lineup fabricates no current', () => {
    const order = ['welcome', 'milestones'] as any
    const r = computeSectionStatuses(order, [sec('welcome', 'done'), sec('milestones', 'done')], { pcCompletedAt: null })
    expect(Object.values(r)).toEqual(['complete', 'complete'])
  })
  it('assigns exactly one current even with a collapsed informational section (Codex fix #8)', () => {
    const order = ['welcome', 'milestones', 'strategy'] as any
    const secs = [sec('welcome', 'collapsed'), sec('milestones', 'active'), sec('strategy', 'active')]
    const r = computeSectionStatuses(order, secs, { pcCompletedAt: null })
    expect(Object.values(r).filter((v) => v === 'current')).toHaveLength(1)
    expect(r.welcome).toBe('current')       // first non-terminal → current
    expect(r.milestones).toBe('upcoming')   // later non-terminal → upcoming
  })
  it('pc-intro as lead consumes the single current slot; a later informational is upcoming', () => {
    const order = ['pc-intro', 'strategy'] as any
    const r = computeSectionStatuses(order, [sec('pc-intro', 'active'), sec('strategy', 'active')], { pcCompletedAt: null })
    expect(r['pc-intro']).toBe('current')
    expect(r['strategy']).toBe('upcoming')
  })
  it('returns a partial map — missing keys are absent, not defaulted', () => {
    const r = computeSectionStatuses(['welcome'] as any, [sec('welcome', 'active')], { pcCompletedAt: null })
    expect('milestones' in r).toBe(false)
  })
})

describe('carriedStatus', () => {
  it('done → complete, else current', () => {
    expect(carriedStatus({ state: 'done' } as any)).toBe('complete')
    expect(carriedStatus({ state: 'active' } as any)).toBe('current')
    expect(carriedStatus({ state: 'collapsed' } as any)).toBe('current')
  })
})
