import { describe, it, expect } from 'vitest'
import { sectionDisplayMode, sectionStartsCollapsed, sectionLocksAutoReveal } from './section-display'
import type { PublicSection } from './public-types'
const S = (o: Partial<PublicSection>): PublicSection => ({ sectionKey: 'data-source', state: 'active', doneAt: null, acknowledgedAt: null, introNote: null, narrative: null, ...o })

describe('sectionDisplayMode', () => {
  it('pc-intro is always-open in every stage', () => {
    for (const st of ['post-contract','kickoff','website-specifics','building'] as const)
      expect(sectionDisplayMode(S({ sectionKey: 'pc-intro' }), st)).toBe('always-open')
  })
  it('done collapses in every stage', () => {
    for (const st of ['post-contract','kickoff','website-specifics','building'] as const)
      expect(sectionDisplayMode(S({ state: 'done' }), st)).toBe('done')
  })
  it('ack collapses ONLY in post-contract', () => {
    const acked = S({ acknowledgedAt: 'x' })
    expect(sectionDisplayMode(acked, 'post-contract')).toBe('ack-collapsed')
    expect(sectionDisplayMode({ ...acked, sectionKey: 'data-source' }, 'building')).toBe('normal')
    expect(sectionDisplayMode({ ...acked, sectionKey: 'pc-setup' }, 'kickoff')).toBe('normal')
  })
  it('done wins over ack in post-contract; pc-intro wins over all', () => {
    expect(sectionDisplayMode(S({ state: 'done', acknowledgedAt: 'x' }), 'post-contract')).toBe('done')
    expect(sectionDisplayMode(S({ sectionKey: 'pc-intro', state: 'done' }), 'post-contract')).toBe('always-open')
  })
  it('normal otherwise; collapse/lock predicates', () => {
    expect(sectionDisplayMode(S({}), 'building')).toBe('normal')
    expect(sectionStartsCollapsed('done')).toBe(true); expect(sectionStartsCollapsed('ack-collapsed')).toBe(true)
    expect(sectionStartsCollapsed('always-open')).toBe(false); expect(sectionStartsCollapsed('normal')).toBe(false)
    expect(sectionLocksAutoReveal('always-open')).toBe(true); expect(sectionLocksAutoReveal('normal')).toBe(false)
  })
})
