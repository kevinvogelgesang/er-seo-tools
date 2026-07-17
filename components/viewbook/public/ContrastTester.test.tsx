// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ContrastTester } from './ContrastTester'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'

afterEach(cleanup)

describe('ContrastTester', () => {
  it('renders a ratio for each theme pairing (7 rows)', () => {
    render(<ContrastTester theme={DEFAULT_THEME} />)
    // every row shows an "N.N:1" ratio; there are 7 fixed rows
    const ratios = screen.getAllByTestId('contrast-ratio')
    expect(ratios).toHaveLength(7)
  })
  it('shows a passing AA-normal chip for dark body text on the light page', () => {
    render(<ContrastTester theme={DEFAULT_THEME} />)
    const bodyRow = screen.getByTestId('contrast-row-body')
    // #1a1a1a on #fafafa is ~16:1 → AA normal passes. NOTE: this repo has NO
    // jest-dom (setupFiles is only ./test/setup-worker.ts) — use DOM-native
    // assertions (textContent / querySelector / toBeTruthy), never
    // toBeInTheDocument / toHaveTextContent (Codex fix).
    expect(bodyRow.textContent).toMatch(/AA/i)
    expect(bodyRow.querySelector('[data-band="aaNormal"][data-pass="true"]')).not.toBeNull()
  })
  it('flags a light brand color used as page text as failing AA-normal', () => {
    // a pale primary as accent text on #fafafa fails 4.5:1
    render(<ContrastTester theme={{ ...DEFAULT_THEME, primary: '#cfe8e8' }} />)
    const brandRow = screen.getByTestId('contrast-row-primary-on-page')
    expect(brandRow.querySelector('[data-band="aaNormal"][data-pass="false"]')).not.toBeNull()
  })
  it('pair-picker recomputes the ratio when a color input changes', () => {
    render(<ContrastTester theme={DEFAULT_THEME} />)
    const fg = screen.getByTestId('pairpicker-fg') as HTMLInputElement
    const before = screen.getByTestId('pairpicker-ratio').textContent
    fireEvent.change(fg, { target: { value: '#ffffff' } })
    const after = screen.getByTestId('pairpicker-ratio').textContent
    expect(after).not.toEqual(before)
  })
})
