import { describe, it, expect } from 'vitest'
import { sectionDisplayMode, sectionInitiallyOpen } from './section-display'
import { sectionSupportsCollapse } from './theme'
import type { PublicSection } from './public-types'
const S = (o: Partial<PublicSection>): PublicSection => ({ sectionKey: 'data-source', state: 'active', doneAt: null, acknowledgedAt: null, introNote: null, narrative: null, ...o })

describe('sectionDisplayMode', () => {
  // 2026-07-19 welcome-auto-reveal: pc-intro is no longer always-open — it
  // follows the same normal/done/ack rules as every other section now that
  // it's collapse-eligible.
  it('pc-intro is normal (not always-open) in every stage', () => {
    for (const st of ['post-contract','kickoff','website-specifics','building'] as const)
      expect(sectionDisplayMode(S({ sectionKey: 'pc-intro' }), st)).toBe('normal')
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
  it('done wins over ack in post-contract; pc-intro follows the same rule (no longer wins over all)', () => {
    expect(sectionDisplayMode(S({ state: 'done', acknowledgedAt: 'x' }), 'post-contract')).toBe('done')
    expect(sectionDisplayMode(S({ sectionKey: 'pc-intro', state: 'done' }), 'post-contract')).toBe('done')
  })
  it('normal otherwise', () => {
    expect(sectionDisplayMode(S({}), 'building')).toBe('normal')
  })
  it('bookends are collapse-eligible like every other section (2026-07-19 welcome-auto-reveal)', () => {
    expect(sectionSupportsCollapse('pc-intro')).toBe(true)
    expect(sectionSupportsCollapse('pc-thanks')).toBe(true)
  })
  // 'collapsed' is retired from state (PR1). The dormant `collapsedShared` DB
  // column no longer even rides on PublicSection (Fix 4, post-review) — it
  // was already orthogonal to sectionDisplayMode before that removal.
})

describe('sectionInitiallyOpen', () => {
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
