import { describe, it, expect } from 'vitest'
import { computeSectionStatuses, carriedStatus } from './section-status'
import type { SectionKey } from './theme'

const sec = (sectionKey: string, state: 'active' | 'done', acknowledgedAt: string | null = null) =>
  ({ sectionKey, state, acknowledgedAt }) as unknown as Parameters<typeof computeSectionStatuses>[1][number]
const order = (...keys: string[]) => keys as unknown as SectionKey[]

describe('computeSectionStatuses', () => {
  it('done → complete; first active informational → current; later active → upcoming', () => {
    const r = computeSectionStatuses(
      order('welcome', 'milestones', 'strategy'),
      [sec('welcome', 'done'), sec('milestones', 'active'), sec('strategy', 'active')],
      { pcCompletedAt: null },
    )
    expect(r.welcome).toBe('complete')
    expect(r.milestones).toBe('current')
    expect(r.strategy).toBe('upcoming')
  })
  it('active input-expecting → needs-input; acknowledged input → complete', () => {
    const r = computeSectionStatuses(
      order('pc-setup', 'data-source'),
      [sec('pc-setup', 'active'), sec('data-source', 'active', '2026-07-01T00:00:00Z')],
      { pcCompletedAt: null },
    )
    expect(r['pc-setup']).toBe('needs-input')
    expect(r['data-source']).toBe('complete')
  })
  it('needs-input does NOT consume the single current slot', () => {
    const r = computeSectionStatuses(
      order('pc-setup', 'welcome'),
      [sec('pc-setup', 'active'), sec('welcome', 'active')],
      { pcCompletedAt: null },
    )
    expect(r['pc-setup']).toBe('needs-input')
    expect(r.welcome).toBe('current')
  })
  it('pc-intro: complete once pcCompletedAt set, else current', () => {
    const active = computeSectionStatuses(order('pc-intro', 'pc-setup'), [sec('pc-intro', 'active'), sec('pc-setup', 'active')], { pcCompletedAt: null })
    expect(active['pc-intro']).toBe('current')
    const done = computeSectionStatuses(order('pc-intro', 'pc-setup'), [sec('pc-intro', 'active'), sec('pc-setup', 'done')], { pcCompletedAt: '2026-07-01T00:00:00Z' })
    expect(done['pc-intro']).toBe('complete')
  })
  it('all-complete lineup fabricates no current', () => {
    const r = computeSectionStatuses(order('welcome', 'milestones'), [sec('welcome', 'done'), sec('milestones', 'done')], { pcCompletedAt: null })
    expect(Object.values(r)).toEqual(['complete', 'complete'])
  })
  it('returns a partial map — missing keys are absent', () => {
    const r = computeSectionStatuses(order('welcome'), [sec('welcome', 'active')], { pcCompletedAt: null })
    expect('milestones' in r).toBe(false)
  })
  it('exactly one current across a mixed lineup', () => {
    const r = computeSectionStatuses(
      order('welcome', 'milestones', 'strategy'),
      [sec('welcome', 'active'), sec('milestones', 'active'), sec('strategy', 'active')],
      { pcCompletedAt: null },
    )
    expect(Object.values(r).filter((v) => v === 'current')).toHaveLength(1)
    expect(r.welcome).toBe('current')
    expect(r.milestones).toBe('upcoming')
  })
  it('pc-thanks runs the progression (consumes current when first non-terminal)', () => {
    const r = computeSectionStatuses(
      order('pc-thanks', 'welcome'),
      [sec('pc-thanks', 'active'), sec('welcome', 'active')],
      { pcCompletedAt: '2026-07-01T00:00:00Z' },
    )
    expect(r['pc-thanks']).toBe('current')
    expect(r.welcome).toBe('upcoming')
  })
  it('an acknowledged NON-input active section reads complete', () => {
    const r = computeSectionStatuses(
      order('welcome'),
      [sec('welcome', 'active', '2026-07-01T00:00:00Z')],
      { pcCompletedAt: null },
    )
    expect(r.welcome).toBe('complete')
  })
})

describe('carriedStatus', () => {
  it('done → complete, else current', () => {
    expect(carriedStatus({ state: 'done' })).toBe('complete')
    expect(carriedStatus({ state: 'active' })).toBe('current')
  })
})
