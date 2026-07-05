// @vitest-environment jsdom
import { renderHook, act, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useTriageMode } from './useTriageMode'

function memStore(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    _map: m,
  }
}

describe('useTriageMode', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('reads seeded localStorage when id present and enabled', () => {
    vi.stubGlobal('localStorage', memStore({ 'er-triage-mode:a1': '1' }))
    const { result } = renderHook(() => useTriageMode('a1'))
    expect(result.current.triageMode).toBe(true)
  })

  it('does not read when enabled:false', () => {
    vi.stubGlobal('localStorage', memStore({ 'er-triage-mode:a1': '1' }))
    const { result } = renderHook(() => useTriageMode('a1', { enabled: false }))
    expect(result.current.triageMode).toBe(false)
  })

  it('toggle flips state and writes localStorage', () => {
    const store = memStore()
    vi.stubGlobal('localStorage', store)
    const { result } = renderHook(() => useTriageMode('a1'))
    act(() => result.current.toggleTriage())
    expect(result.current.triageMode).toBe(true)
    expect(store._map.get('er-triage-mode:a1')).toBe('1')
    act(() => result.current.toggleTriage())
    expect(result.current.triageMode).toBe(false)
    expect(store._map.get('er-triage-mode:a1')).toBe('0')
  })

  it('missing id: no write, no throw (state still toggles)', () => {
    const store = memStore()
    vi.stubGlobal('localStorage', store)
    const { result } = renderHook(() => useTriageMode(undefined))
    expect(result.current.triageMode).toBe(false)
    act(() => result.current.toggleTriage())
    expect(result.current.triageMode).toBe(true)
    expect(store._map.has('er-triage-mode:undefined')).toBe(false)
  })

  it('no localStorage global: does not throw', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => {
      const { result } = renderHook(() => useTriageMode('a1'))
      act(() => result.current.toggleTriage())
    }).not.toThrow()
  })
})
