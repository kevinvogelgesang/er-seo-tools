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

describe('useCollapseState', () => {
  it('effective = collapsedShared when no override', () => {
    const { result } = renderHook(() =>
      useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: true }),
    )
    expect(result.current.collapsed).toBe(true)
  })

  it('personal expanded override wins over shared collapse', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    const { result } = renderHook(() =>
      useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: true }),
    )
    expect(result.current.collapsed).toBe(false)
  })

  it('clearPersonalOverride removes the key AND returns the prior value', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    const { result } = renderHook(() =>
      useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: true }),
    )
    let prior: 'expanded' | null = null
    act(() => {
      prior = result.current.clearPersonalOverride()
    })
    expect(prior).toBe('expanded')
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false)
  })

  it('restorePersonalOverride re-persists the prior value', () => {
    const { result } = renderHook(() =>
      useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: false }),
    )
    act(() => {
      result.current.restorePersonalOverride('expanded')
    })
    expect(stored.get(collapseKey(1, 'brand'))).toBe('expanded')

    act(() => {
      result.current.restorePersonalOverride(null)
    })
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false)
  })

  it('a changed collapsedShared prop flips an override-less viewer', () => {
    const { result, rerender } = renderHook(
      (props: { collapsedShared: boolean }) =>
        useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: props.collapsedShared }),
      { initialProps: { collapsedShared: false } },
    )
    expect(result.current.collapsed).toBe(false)
    rerender({ collapsedShared: true })
    expect(result.current.collapsed).toBe(true)
  })

  it('a changed collapsedShared prop does NOT flip an override-holder', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    const { result, rerender } = renderHook(
      (props: { collapsedShared: boolean }) =>
        useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: props.collapsedShared }),
      { initialProps: { collapsedShared: true } },
    )
    expect(result.current.collapsed).toBe(false) // override wins over the initial shared:true
    rerender({ collapsedShared: false })
    // Still expanded — the override still wins even though shared flipped.
    expect(result.current.collapsed).toBe(false)
  })

  it('prop change while pending is deferred, then APPLIED on endPending (not dropped)', () => {
    const { result, rerender } = renderHook(
      (props: { collapsedShared: boolean }) =>
        useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: props.collapsedShared }),
      { initialProps: { collapsedShared: false } },
    )
    expect(result.current.collapsed).toBe(false)

    act(() => {
      expect(result.current.beginPending()).toBe(true)
    })
    expect(result.current.pending).toBe(true)

    // The shared prop changes mid-flight — must NOT flip the view yet.
    rerender({ collapsedShared: true })
    expect(result.current.collapsed).toBe(false)

    act(() => {
      result.current.endPending()
    })
    // Now that pending cleared, the latest prop applies.
    expect(result.current.pending).toBe(false)
    expect(result.current.collapsed).toBe(true)
  })

  it('forceExpandedLocal expands without writing localStorage (survives rerender, not reload)', () => {
    const { result, rerender } = renderHook(
      (props: { collapsedShared: boolean }) =>
        useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: props.collapsedShared }),
      { initialProps: { collapsedShared: true } },
    )
    expect(result.current.collapsed).toBe(true)

    act(() => {
      result.current.forceExpandedLocal()
    })
    expect(result.current.collapsed).toBe(false)
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false) // never persisted

    // Survives a rerender with the same shared prop (in-memory override held).
    rerender({ collapsedShared: true })
    expect(result.current.collapsed).toBe(false)
  })

  it('beginPending returns false if already pending', () => {
    const { result } = renderHook(() =>
      useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: false }),
    )
    act(() => {
      expect(result.current.beginPending()).toBe(true)
    })
    act(() => {
      expect(result.current.beginPending()).toBe(false)
    })
  })

  // FIX-9: markAwaitingShared latches a successful shared write so the
  // reconcile effect holds it instead of reverting to the still-stale
  // collapsedShared prop the instant endPending() reruns the effect.

  it('client collapse: markAwaitingShared(true) holds collapsed after endPending even though the prop is still stale', () => {
    const { result, rerender } = renderHook(
      (props: { collapsedShared: boolean }) =>
        useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: props.collapsedShared }),
      { initialProps: { collapsedShared: false } },
    )
    expect(result.current.collapsed).toBe(false)

    act(() => {
      expect(result.current.beginPending()).toBe(true)
    })
    act(() => {
      result.current.setCollapsedOptimistic(true)
      result.current.clearPersonalOverride()
      result.current.markAwaitingShared(true) // the write succeeded
    })
    act(() => {
      result.current.endPending() // reruns the reconcile effect — prop is STILL false
    })

    // This is the regression: pre-fix, this asserted false (reverted).
    expect(result.current.collapsed).toBe(true)

    // Re-rendering with the SAME stale prop must not revert it either.
    rerender({ collapsedShared: false })
    expect(result.current.collapsed).toBe(true)
  })

  it('operator expand: markAwaitingShared(false) holds expanded after endPending even though the prop is still stale', () => {
    const { result, rerender } = renderHook(
      (props: { collapsedShared: boolean }) =>
        useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: props.collapsedShared }),
      { initialProps: { collapsedShared: true } },
    )
    expect(result.current.collapsed).toBe(true)

    act(() => {
      expect(result.current.beginPending()).toBe(true)
    })
    act(() => {
      result.current.setCollapsedOptimistic(false)
      result.current.markAwaitingShared(false) // the write succeeded
    })
    act(() => {
      result.current.endPending() // reruns the reconcile effect — prop is STILL true
    })

    // This is the regression: pre-fix, this asserted true (reverted).
    expect(result.current.collapsed).toBe(false)

    rerender({ collapsedShared: true })
    expect(result.current.collapsed).toBe(false)
  })

  it('latch clears once collapsedShared catches up to the awaited value, then normal reconciliation resumes', () => {
    const { result, rerender } = renderHook(
      (props: { collapsedShared: boolean }) =>
        useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: props.collapsedShared }),
      { initialProps: { collapsedShared: false } },
    )

    act(() => {
      expect(result.current.beginPending()).toBe(true)
    })
    act(() => {
      result.current.setCollapsedOptimistic(true)
      result.current.clearPersonalOverride()
      result.current.markAwaitingShared(true)
    })
    act(() => {
      result.current.endPending()
    })
    expect(result.current.collapsed).toBe(true)

    // The poll catches up: prop now matches the written value.
    rerender({ collapsedShared: true })
    expect(result.current.collapsed).toBe(true)

    // A genuinely NEW shared change (someone else re-expanded it) now
    // applies normally — the latch is clear, this is not a revert.
    rerender({ collapsedShared: false })
    expect(result.current.collapsed).toBe(false)
  })

  it('a personal expanded override always wins and clears the latch outright', () => {
    const { result, rerender } = renderHook(
      (props: { collapsedShared: boolean }) =>
        useCollapseState({ viewbookId: 1, sectionKey: 'brand', collapsedShared: props.collapsedShared }),
      { initialProps: { collapsedShared: false } },
    )

    act(() => {
      expect(result.current.beginPending()).toBe(true)
    })
    act(() => {
      result.current.setCollapsedOptimistic(true)
      result.current.clearPersonalOverride()
      result.current.markAwaitingShared(true)
    })
    // A personal expand lands (e.g. vb:navigate) before endPending.
    act(() => {
      result.current.forceExpandedLocal()
    })
    act(() => {
      result.current.endPending()
    })
    expect(result.current.collapsed).toBe(false) // override wins over the latch

    rerender({ collapsedShared: false })
    expect(result.current.collapsed).toBe(false)
  })
})
