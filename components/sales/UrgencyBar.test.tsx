// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { UrgencyBar } from './UrgencyBar'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function stubMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as never
}

describe('UrgencyBar', () => {
  it('reduced motion: fill width set immediately to the clamped percentage', () => {
    stubMatchMedia(true)
    render(<UrgencyBar value={3} max={10} ariaLabel="3 of 10 pages" />)
    const bar = screen.getByRole('img', { name: '3 of 10 pages' })
    const fill = bar.firstElementChild as HTMLElement
    expect(fill.style.width).toBe('30%')
  })
  it('clamps: value > max renders 100%, max 0 renders 0%', () => {
    stubMatchMedia(true)
    render(<UrgencyBar value={15} max={10} ariaLabel="a" />)
    expect((screen.getByRole('img', { name: 'a' }).firstElementChild as HTMLElement).style.width).toBe('100%')
    render(<UrgencyBar value={5} max={0} ariaLabel="b" />)
    expect((screen.getByRole('img', { name: 'b' }).firstElementChild as HTMLElement).style.width).toBe('0%')
  })
  it('motion path: starts at 0 and schedules a frame to grow', () => {
    stubMatchMedia(false)
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    render(<UrgencyBar value={3} max={10} ariaLabel="c" />)
    expect((screen.getByRole('img', { name: 'c' }).firstElementChild as HTMLElement).style.width).toBe('0%')
    expect(raf).toHaveBeenCalled()
  })
})
