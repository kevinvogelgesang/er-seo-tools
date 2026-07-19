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
})
