// @vitest-environment jsdom
// Per-file directive: this is the first hook test in the project. Global
// vitest config stays on `node` so existing server-side tests are unaffected.

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  it('returns the latest value only after the delay', async () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    })
    expect(result.current).toBe('a')

    rerender({ v: 'ab' })
    rerender({ v: 'abc' })
    expect(result.current).toBe('a')          // not yet — debounced

    await act(async () => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')

    await act(async () => { vi.advanceTimersByTime(2) })
    expect(result.current).toBe('abc')

    vi.useRealTimers()
  })
})
