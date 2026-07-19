import { describe, it, expect } from 'vitest'
import { sectionDisplayMode, sectionInitiallyOpen } from './section-display'
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
  it('normal otherwise', () => {
    expect(sectionDisplayMode(S({}), 'building')).toBe('normal')
  })
  it('collapsed → hero-collapsed in every stage', () => {
    for (const st of ['post-contract','kickoff','website-specifics','building'] as const)
      expect(sectionDisplayMode(S({ sectionKey: 'strategy', state: 'collapsed' }), st)).toBe('hero-collapsed')
  })
  it('hero-collapsed wins over done, ack, and always-open', () => {
    // over done
    expect(sectionDisplayMode(S({ sectionKey: 'strategy', state: 'collapsed', doneAt: 'x' }), 'building')).toBe('hero-collapsed')
    // over ack (post-contract, where ack would otherwise collapse)
    expect(sectionDisplayMode(S({ sectionKey: 'strategy', state: 'collapsed', acknowledgedAt: 'x' }), 'post-contract')).toBe('hero-collapsed')
    // over always-open (pc-intro can't be collapsed in practice, but the state
    // check must still take precedence in the pure function)
    expect(sectionDisplayMode(S({ sectionKey: 'pc-intro', state: 'collapsed' }), 'kickoff')).toBe('hero-collapsed')
  })
})

describe('sectionInitiallyOpen', () => {
  it('always-open sections are initially open', () => {
    expect(sectionInitiallyOpen(S({ sectionKey: 'pc-intro' }), 'post-contract')).toBe(true)
  })
  it('done sections are collapsed', () => {
    expect(sectionInitiallyOpen(S({ state: 'done' }), 'building')).toBe(false)
  })
  it('ack-collapsed sections are collapsed', () => {
    expect(sectionInitiallyOpen(S({ sectionKey: 'data-source', acknowledgedAt: new Date() as any }), 'post-contract')).toBe(false)
  })
  it('Now Building: only milestones + materials open', () => {
    expect(sectionInitiallyOpen(S({ sectionKey: 'milestones' }), 'building')).toBe(true)
    expect(sectionInitiallyOpen(S({ sectionKey: 'materials' }), 'building')).toBe(true)
    expect(sectionInitiallyOpen(S({ sectionKey: 'welcome' }), 'building')).toBe(false)
    expect(sectionInitiallyOpen(S({ sectionKey: 'brand' }), 'building')).toBe(false)
  })
  it('other stages: non-collapsed sections are open', () => {
    expect(sectionInitiallyOpen(S({ sectionKey: 'welcome' }), 'kickoff')).toBe(true)
  })
})
