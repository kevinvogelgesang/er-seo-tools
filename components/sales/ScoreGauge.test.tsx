// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ScoreGauge } from './ScoreGauge'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function stubMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as never
}

describe('ScoreGauge', () => {
  it('reduced motion: renders the final value immediately, no rAF loop', () => {
    stubMatchMedia(true)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    render(<ScoreGauge score={72} />)
    expect(screen.getByText('72')).toBeTruthy()
    expect(raf).not.toHaveBeenCalled()
  })

  it('clamps out-of-range and non-finite scores', () => {
    stubMatchMedia(true)
    render(<ScoreGauge score={187} />)
    expect(screen.getByText('100')).toBeTruthy()
    cleanup()
    render(<ScoreGauge score={-5} />)
    expect(screen.getByText('0')).toBeTruthy()
    cleanup()
    render(<ScoreGauge score={Number.NaN} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('null score renders the em-dash state with no animation', () => {
    stubMatchMedia(false)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    render(<ScoreGauge score={null} />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(raf).not.toHaveBeenCalled()
  })

  it('cancels the rAF loop on unmount', () => {
    stubMatchMedia(false)
    let scheduled = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => { scheduled += 1; return scheduled })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { unmount } = render(<ScoreGauge score={50} />)
    expect(scheduled).toBeGreaterThan(0) // motion path scheduled a frame
    unmount()
    expect(cancel).toHaveBeenCalled()
  })
})
