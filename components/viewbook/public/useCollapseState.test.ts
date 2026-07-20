// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { collapseKey, useCollapseState } from './useCollapseState'

let stored = new Map<string, string>()

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useCollapseState — local-only, default collapsed', () => {
  it('defaults to collapsed on a fresh machine (no stored value)', () => {
    const { result } = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    expect(result.current.collapsed).toBe(true)
  })

  it('a stored "expanded" value starts expanded', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    const { result } = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    expect(result.current.collapsed).toBe(false)
  })

  it('a stored "collapsed" value starts collapsed (explicit, same as absent)', () => {
    stored.set(collapseKey(1, 'brand'), 'collapsed')
    const { result } = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    expect(result.current.collapsed).toBe(true)
  })

  it('an unrecognized stored value is treated as absent (default collapsed)', () => {
    stored.set(collapseKey(1, 'brand'), 'garbage')
    const { result } = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    expect(result.current.collapsed).toBe(true)
  })

  it('expand() flips state and persists "expanded" to localStorage', () => {
    const { result } = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    expect(result.current.collapsed).toBe(true)
    act(() => result.current.expand())
    expect(result.current.collapsed).toBe(false)
    expect(stored.get(collapseKey(1, 'brand'))).toBe('expanded')
  })

  it('collapse() flips state and persists "collapsed" (overwriting a prior "expanded")', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    const { result } = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    expect(result.current.collapsed).toBe(false)
    act(() => result.current.collapse())
    expect(result.current.collapsed).toBe(true)
    expect(stored.get(collapseKey(1, 'brand'))).toBe('collapsed')
  })

  it('keys are scoped per (viewbookId, sectionKey) — toggling one section never touches another', () => {
    const brand = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    const assessment = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'assessment' }))
    act(() => brand.result.current.expand())
    expect(brand.result.current.collapsed).toBe(false)
    expect(assessment.result.current.collapsed).toBe(true)
    expect(stored.has(collapseKey(1, 'assessment'))).toBe(false)
  })

  it('previewMode: expand()/collapse() update in-memory state but NEVER write localStorage', () => {
    const { result } = renderHook(() =>
      useCollapseState({ viewbookId: 0, sectionKey: 'brand', previewMode: true }),
    )
    act(() => result.current.expand())
    expect(result.current.collapsed).toBe(false)
    act(() => result.current.collapse())
    expect(result.current.collapsed).toBe(true)
    expect(stored.size).toBe(0)
  })

  it('previewMode always starts expanded, ignoring any real stored value under that key', () => {
    stored.set(collapseKey(0, 'brand'), 'collapsed')
    const { result } = renderHook(() =>
      useCollapseState({ viewbookId: 0, sectionKey: 'brand', previewMode: true }),
    )
    expect(result.current.collapsed).toBe(false)
  })

  it('forceExpand() expands WITHOUT persisting (vb:navigate/#hash force-open)', () => {
    const { result } = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    expect(result.current.collapsed).toBe(true)
    act(() => result.current.forceExpand())
    expect(result.current.collapsed).toBe(false)
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false)
  })

  it('collapseKey builds the documented localStorage key shape', () => {
    expect(collapseKey(42, 'materials')).toBe('vb:collapse:42:materials')
  })
})

describe('useCollapseState — ready flag (Task 11, key-scoped)', () => {
  // Records every `ready` value the hook produces across renders, so we can
  // observe the pre-effect value (false) as well as the post-effect,
  // settled value (true) from a single renderHook call — `renderHook` flushes
  // effects (wrapped in act) before returning, so `result.current` alone only
  // ever shows the FINAL settled value.
  function recordReady(states: boolean[]) {
    return (props: { viewbookId: number; sectionKey: string; previewMode?: boolean }) => {
      const result = useCollapseState(props)
      states.push(result.ready)
      return result
    }
  }

  it('is false on first render, true after the mount effect reconciles', () => {
    const states: boolean[] = []
    const { result } = renderHook(recordReady(states), {
      initialProps: { viewbookId: 1, sectionKey: 'brand' },
    })
    expect(states[0]).toBe(false)
    expect(result.current.ready).toBe(true)
  })

  it('is false on first render, true after reconciling, in previewMode too', () => {
    const states: boolean[] = []
    const { result } = renderHook(recordReady(states), {
      initialProps: { viewbookId: 0, sectionKey: 'brand', previewMode: true },
    })
    expect(states[0]).toBe(false)
    expect(result.current.ready).toBe(true)
  })

  it('returns to false when the key (sectionKey) changes, until the effect re-reconciles for the new key', () => {
    const states: boolean[] = []
    const { result, rerender } = renderHook(recordReady(states), {
      initialProps: { viewbookId: 1, sectionKey: 'brand' },
    })
    expect(result.current.ready).toBe(true)

    states.length = 0
    rerender({ viewbookId: 1, sectionKey: 'materials' })
    // Immediately after the key changes, `ready` must reflect the NEW key —
    // the stale `reconciledKey` from 'brand' no longer matches, so a reused/
    // re-keyed component can never expose a stale ready=true for data that
    // belongs to the OLD key.
    expect(states[0]).toBe(false)
    expect(result.current.ready).toBe(true)
  })

  it('returns to false when the key (viewbookId) changes, until the effect re-reconciles for the new key', () => {
    const states: boolean[] = []
    const { result, rerender } = renderHook(recordReady(states), {
      initialProps: { viewbookId: 1, sectionKey: 'brand' },
    })
    expect(result.current.ready).toBe(true)

    states.length = 0
    rerender({ viewbookId: 2, sectionKey: 'brand' })
    expect(states[0]).toBe(false)
    expect(result.current.ready).toBe(true)
  })

  it('collapsed/expand/localStorage behavior is unaffected by the ready flag', () => {
    const { result } = renderHook(() => useCollapseState({ viewbookId: 1, sectionKey: 'brand' }))
    expect(result.current.collapsed).toBe(true)
    expect(result.current.ready).toBe(true)
    act(() => result.current.expand())
    expect(result.current.collapsed).toBe(false)
    expect(stored.get(collapseKey(1, 'brand'))).toBe('expanded')
  })
})
