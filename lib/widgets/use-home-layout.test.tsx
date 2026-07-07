// lib/widgets/use-home-layout.test.tsx
// @vitest-environment jsdom
import { StrictMode } from 'react'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useHomeLayout } from './use-home-layout'
import { LAYOUT_STORAGE_KEY, LAYOUT_VERSION, normalizeLayout, serializeLayout } from './layout'
import { WIDGETS, DEFAULT_LAYOUT } from './registry'
import type { LayoutItem } from './types'

// This vitest jsdom setup exposes no working localStorage — provide an
// in-memory stand-in, re-stubbed per test because afterEach unstubs all
// globals. Pattern copied from components/shell/AppShell.test.tsx.
const lsStore = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { lsStore.set(k, String(v)) },
  removeItem: (k: string) => { lsStore.delete(k) },
  clear: () => { lsStore.clear() },
}

beforeEach(() => {
  lsStore.clear()
  vi.stubGlobal('localStorage', localStorageMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  lsStore.clear()
})

describe('useHomeLayout', () => {
  it('hydrates to normalized default layout when localStorage is empty', async () => {
    const { result } = renderHook(() => useHomeLayout())

    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.layout).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('hydrates to a pre-seeded valid stored layout (reordered/resized)', async () => {
    const custom: LayoutItem[] = [
      { id: 'quick-robots', size: 'sm' },
      { id: 'live-now', size: 'wide' },
      { id: 'quick-site-audit', size: 'wide' },
      { id: 'quick-parser', size: 'wide' },
      { id: 'quick-report', size: 'wide' },
      { id: 'quarter-week', size: 'wide' },
      { id: 'recent-parses', size: 'sm' },
    ]
    lsStore.set(LAYOUT_STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, items: custom }))

    const { result } = renderHook(() => useHomeLayout())

    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.layout).toEqual(normalizeLayout(custom, WIDGETS))
  })

  it('hydrates to default on malformed stored string without throwing', async () => {
    lsStore.set(LAYOUT_STORAGE_KEY, '{not valid json')

    const { result } = renderHook(() => useHomeLayout())

    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.layout).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('hydrates to default when getItem throws, without throwing', async () => {
    vi.stubGlobal('localStorage', {
      ...localStorageMock,
      getItem: () => { throw new Error('disabled') },
    })

    const { result } = renderHook(() => useHomeLayout())

    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.layout).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('persists a resize dispatch to localStorage after hydration', async () => {
    const { result } = renderHook(() => useHomeLayout())
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => {
      result.current.dispatch({ type: 'resize', id: 'live-now' })
    })

    await waitFor(() => {
      const stored = lsStore.get(LAYOUT_STORAGE_KEY)
      expect(stored).toBeTruthy()
      const parsed = JSON.parse(stored as string)
      expect(parsed.items).toEqual(result.current.layout)
    })
  })

  it('persists a move dispatch to localStorage after hydration', async () => {
    const { result } = renderHook(() => useHomeLayout())
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    // Move the 2nd default-layout widget up → it becomes first (order-agnostic).
    const secondId = DEFAULT_LAYOUT[1].id
    act(() => {
      result.current.dispatch({ type: 'move', id: secondId, dir: 'up' })
    })

    await waitFor(() => {
      const stored = lsStore.get(LAYOUT_STORAGE_KEY)
      const parsed = JSON.parse(stored as string)
      expect(parsed.items).toEqual(result.current.layout)
    })
    expect(result.current.layout[0].id).toBe(secondId)
  })

  it('persists a reorder dispatch to localStorage after hydration', async () => {
    const { result } = renderHook(() => useHomeLayout())
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => {
      result.current.dispatch({ type: 'reorder', draggedId: 'quick-robots', targetId: null })
    })

    await waitFor(() => {
      const stored = lsStore.get(LAYOUT_STORAGE_KEY)
      const parsed = JSON.parse(stored as string)
      expect(parsed.items).toEqual(result.current.layout)
    })
    expect(result.current.layout[result.current.layout.length - 1].id).toBe('quick-robots')
  })

  it('persists a reset dispatch to localStorage after hydration', async () => {
    const custom: LayoutItem[] = [
      { id: 'quick-robots', size: 'sm' },
      { id: 'live-now', size: 'wide' },
      { id: 'quick-site-audit', size: 'wide' },
      { id: 'quick-parser', size: 'wide' },
      { id: 'quick-report', size: 'wide' },
      { id: 'quarter-week', size: 'wide' },
      { id: 'recent-parses', size: 'sm' },
    ]
    lsStore.set(LAYOUT_STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, items: custom }))

    const { result } = renderHook(() => useHomeLayout())
    await waitFor(() => expect(result.current.hydrated).toBe(true))
    expect(result.current.layout).toEqual(normalizeLayout(custom, WIDGETS))

    act(() => {
      result.current.dispatch({ type: 'reset' })
    })

    await waitFor(() => {
      const stored = lsStore.get(LAYOUT_STORAGE_KEY)
      const parsed = JSON.parse(stored as string)
      expect(parsed.items).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
    })
    expect(result.current.layout).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('keeps in-memory layout updated even when setItem throws (quota)', async () => {
    vi.stubGlobal('localStorage', {
      ...localStorageMock,
      setItem: () => { throw new Error('quota exceeded') },
    })

    const { result } = renderHook(() => useHomeLayout())
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(() => {
      act(() => {
        result.current.dispatch({ type: 'resize', id: 'live-now' })
      })
    }).not.toThrow()

    await waitFor(() => {
      expect(result.current.layout.find((i) => i.id === 'live-now')?.size).not.toBe('lg')
    })
  })

  it('never overwrites a seeded stored layout with the default before/around hydration', async () => {
    const custom: LayoutItem[] = [
      { id: 'quick-robots', size: 'sm' },
      { id: 'live-now', size: 'wide' },
      { id: 'quick-site-audit', size: 'wide' },
      { id: 'quick-parser', size: 'wide' },
      { id: 'quick-report', size: 'wide' },
      { id: 'quarter-week', size: 'wide' },
      { id: 'recent-parses', size: 'sm' },
    ]
    const seeded = JSON.stringify({ version: LAYOUT_VERSION, items: custom })
    lsStore.set(LAYOUT_STORAGE_KEY, seeded)

    // Spy on setItem (still writing through to the in-memory store, so
    // hydration itself is unaffected) to capture the FULL call history.
    // A single final read (the old assertion) can't distinguish "never
    // wrote the default" from "wrote the default transiently, then a
    // microtask-deferred correction landed before we looked" — a real
    // pre-hydration-overwrite bug can slip a default write in between
    // Effect 1's setHydrated(true) and its dispatch landing, and that
    // transient write would still pass a final-state-only check.
    const setItemSpy = vi.spyOn(localStorageMock, 'setItem')

    const { result } = renderHook(() => useHomeLayout())

    await waitFor(() => expect(result.current.hydrated).toBe(true))

    const serializedDefault = serializeLayout(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
    const serializedCustom = serializeLayout(normalizeLayout(custom, WIDGETS))

    const writtenValues = setItemSpy.mock.calls
      .filter(([key]) => key === LAYOUT_STORAGE_KEY)
      .map(([, value]) => value)

    // The default's serialized form must NEVER appear in the write
    // history — not even transiently — while a seeded custom layout is
    // the intended state.
    expect(writtenValues).not.toContain(serializedDefault)
    // Every write that did happen must be the idempotent rewrite of the
    // seeded/current custom layout.
    for (const value of writtenValues) {
      expect(value).toBe(serializedCustom)
    }

    // Keep the final-state assertion too, for a direct end-state check.
    const storedAfter = lsStore.get(LAYOUT_STORAGE_KEY)
    expect(storedAfter).toBeTruthy()
    const parsedAfter = JSON.parse(storedAfter as string)
    expect(parsedAfter.items).toEqual(normalizeLayout(custom, WIDGETS))
    expect(parsedAfter.items).not.toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('hydrates to the seeded custom layout under React StrictMode (double-invoked effects)', async () => {
    const custom: LayoutItem[] = [
      { id: 'quick-robots', size: 'sm' },
      { id: 'live-now', size: 'wide' },
      { id: 'quick-site-audit', size: 'wide' },
      { id: 'quick-parser', size: 'wide' },
      { id: 'quick-report', size: 'wide' },
      { id: 'quarter-week', size: 'wide' },
      { id: 'recent-parses', size: 'sm' },
    ]
    lsStore.set(LAYOUT_STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, items: custom }))

    const { result } = renderHook(() => useHomeLayout(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    })

    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.layout).toEqual(normalizeLayout(custom, WIDGETS))

    const storedAfter = lsStore.get(LAYOUT_STORAGE_KEY)
    expect(storedAfter).toBeTruthy()
    const parsedAfter = JSON.parse(storedAfter as string)
    expect(parsedAfter.items).toEqual(normalizeLayout(custom, WIDGETS))
  })
})
