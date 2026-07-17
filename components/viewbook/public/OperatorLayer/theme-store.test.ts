import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import {
  __resetThemeDraftStore,
  commitThemeDraft,
  getCommittedTheme,
  getThemeDraft,
  initializeThemeDraft,
  restoreCommittedTheme,
  setThemeDraft,
  subscribe,
} from './theme-store'

afterEach(__resetThemeDraftStore)

describe('viewbook-keyed theme draft store', () => {
  it('keeps drafts isolated by viewbook id and merges partial updates', () => {
    initializeThemeDraft(1, DEFAULT_THEME)
    initializeThemeDraft(2, { ...DEFAULT_THEME, primary: '#222222' })
    setThemeDraft(1, { primary: '#abcdef' })

    expect(getThemeDraft(1)?.primary).toBe('#abcdef')
    expect(getThemeDraft(2)?.primary).toBe('#222222')
  })

  it('commits the latest baseline and restores that commit after a preview', () => {
    initializeThemeDraft(1, DEFAULT_THEME)
    const committed = { ...DEFAULT_THEME, primary: '#135790' }
    commitThemeDraft(1, committed)
    setThemeDraft(1, { primary: '#ffffff' })
    restoreCommittedTheme(1)

    expect(getThemeDraft(1)).toEqual(committed)
    expect(getCommittedTheme(1)).toEqual(committed)
  })

  it('notifies only subscribers for the changed viewbook', () => {
    initializeThemeDraft(1, DEFAULT_THEME)
    initializeThemeDraft(2, DEFAULT_THEME)
    const one = vi.fn()
    const two = vi.fn()
    const unsubscribe = subscribe(1, one)
    subscribe(2, two)

    setThemeDraft(1, { secondary: '#abcdef' })
    expect(one).toHaveBeenCalledOnce()
    expect(two).not.toHaveBeenCalled()
    unsubscribe()
  })
})
