// @vitest-environment jsdom
// components/quarter-grid/usePoolKeyboard.test.tsx
import { renderHook, cleanup } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { usePoolKeyboard } from './usePoolKeyboard'

afterEach(cleanup)

const opts = (hoveredPoolChipId: number | null) => ({
  hoveredPoolChipId,
  setHoveredPoolChipId: vi.fn(),
  setPriority: vi.fn(),
  assignHoveredToFrontier: vi.fn(() => 42),
  onToast: vi.fn(),
})

describe('usePoolKeyboard', () => {
  it('1–5 sets priority on the hovered chip and toasts', () => {
    const o = opts(7)
    renderHook(() => usePoolKeyboard(o))
    fireEvent.keyDown(window, { key: '3' })
    expect(o.setPriority).toHaveBeenCalledWith(7, 3)
    expect(o.onToast).toHaveBeenCalledWith('P3')
  })

  it('Space assigns to frontier and hands the next id to setHoveredPoolChipId', () => {
    const o = opts(7)
    renderHook(() => usePoolKeyboard(o))
    fireEvent.keyDown(window, { key: ' ' })
    expect(o.assignHoveredToFrontier).toHaveBeenCalledWith(7)
    expect(o.setHoveredPoolChipId).toHaveBeenCalledWith(42)
  })

  it('does nothing when no chip is hovered or focus is in a form field', () => {
    const o = opts(null)
    renderHook(() => usePoolKeyboard(o))
    fireEvent.keyDown(window, { key: '3' })
    expect(o.setPriority).not.toHaveBeenCalled()

    const o2 = opts(7)
    renderHook(() => usePoolKeyboard(o2))
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: '3' })
    expect(o2.setPriority).not.toHaveBeenCalled()
    input.remove()
  })
})
