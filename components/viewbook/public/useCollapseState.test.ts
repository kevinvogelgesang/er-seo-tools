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
