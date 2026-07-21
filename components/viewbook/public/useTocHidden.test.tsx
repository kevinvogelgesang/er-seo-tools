// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { renderHook, act, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { useTocHidden, TOC_HIDDEN_KEY } from './useTocHidden'

// This vitest jsdom setup exposes no working localStorage (window.localStorage
// is undefined) — provide an in-memory stand-in, re-stubbed per test because
// afterEach unstubs all globals.
const lsStore = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { lsStore.set(k, String(v)) },
  removeItem: (k: string) => { lsStore.delete(k) },
  clear: () => { lsStore.clear() },
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); lsStore.clear() })
beforeEach(() => { lsStore.clear(); vi.stubGlobal('localStorage', localStorageMock) })

describe('useTocHidden', () => {
  it('defaults to expanded (hidden=false) and becomes ready after mount', () => {
    const { result } = renderHook(() => useTocHidden())
    expect(result.current.hidden).toBe(false)
    expect(result.current.ready).toBe(true)
  })

  it('reconciles hidden=true from localStorage on mount', () => {
    localStorage.setItem(TOC_HIDDEN_KEY, 'true')
    const { result } = renderHook(() => useTocHidden())
    expect(result.current.hidden).toBe(true)
  })

  it('hide()/show()/toggle() persist to localStorage', () => {
    const { result } = renderHook(() => useTocHidden())
    act(() => result.current.hide())
    expect(result.current.hidden).toBe(true)
    expect(localStorage.getItem(TOC_HIDDEN_KEY)).toBe('true')
    act(() => result.current.show())
    expect(result.current.hidden).toBe(false)
    expect(localStorage.getItem(TOC_HIDDEN_KEY)).toBe('false')
    act(() => result.current.toggle())
    expect(result.current.hidden).toBe(true)
  })

  it('tolerates unavailable localStorage without throwing', () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    try {
      const { result } = renderHook(() => useTocHidden())
      act(() => result.current.hide())
      expect(result.current.hidden).toBe(true) // in-memory state still applies
    } finally {
      if (orig) Object.defineProperty(window, 'localStorage', orig)
    }
  })
})
