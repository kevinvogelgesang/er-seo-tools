// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SectionReveal } from './SectionReveal'

// Sticky-header rewrite (blink-bug fix): body visibility is STATE-ONLY. No
// IntersectionObserver, no scroll listener. The spy below is the regression
// guard — if any observer is ever re-introduced, these tests fail.
let ioSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  cleanup()
  ioSpy = vi.fn()
  ;(globalThis as any).IntersectionObserver = class {
    constructor() {
      ioSpy()
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })
  window.location.hash = ''
})

describe('SectionReveal (state-only)', () => {
  it('never constructs an IntersectionObserver', () => {
    render(
      <SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(ioSpy).not.toHaveBeenCalled()
  })

  it('collapsed section: toggle button reflects state and controls the region', async () => {
    const user = userEvent.setup()
    const { getByRole, getByTestId } = render(
      <SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    const btn = getByRole('button')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-controls')).toBe('r')
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('false')
    // Collapsed region is inert + aria-hidden.
    expect(getByTestId('vb-region').hasAttribute('inert')).toBe(true)
    expect(getByTestId('vb-region').getAttribute('aria-hidden')).toBe('true')

    await user.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
    // Expanded region is neither inert nor aria-hidden.
    expect(getByTestId('vb-region').hasAttribute('inert')).toBe(false)
    expect(getByTestId('vb-region').hasAttribute('aria-hidden')).toBe(false)

    await user.click(btn)
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('false')
  })

  it('initiallyOpen seeds the expanded state at mount', () => {
    const { getByRole, getByTestId } = render(
      <SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen>
        body
      </SectionReveal>,
    )
    expect(getByRole('button').getAttribute('aria-expanded')).toBe('true')
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('always-open: no toggle button, region always expanded', () => {
    const { queryByRole, getByTestId } = render(
      <SectionReveal regionId="r2" title="Intro" alwaysOpen initiallyOpen>
        body
      </SectionReveal>,
    )
    expect(queryByRole('button')).toBeNull()
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('vb:navigate with a matching sectionKey force-opens a collapsed section', () => {
    const { getByTestId } = render(
      <SectionReveal regionId="r" sectionKey="pc-setup" title="Setup" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('false')
    act(() => window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'pc-setup', anchor: '#pc-setup' } })))
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('vb:navigate for a different section does not open this one', () => {
    const { getByTestId } = render(
      <SectionReveal regionId="r" sectionKey="pc-setup" title="Setup" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    act(() => window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'brand', anchor: '#brand' } })))
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('false')
  })

  it('initial-load hash force-opens the owning section', () => {
    window.location.hash = '#pc-setup'
    const { getByTestId } = render(
      <SectionReveal regionId="r" sectionKey="pc-setup" title="Setup" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
  })

  it('renders the compact title in the sticky header', () => {
    const { getByText } = render(
      <SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen={false}>
        body
      </SectionReveal>,
    )
    expect(getByText('Data Source')).toBeDefined()
  })
})
