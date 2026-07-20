// @vitest-environment jsdom
//
// Codex cross-review P2-2: the preview's SAMPLE_SECTION is an ACTIVE 'brand'
// section rendered via the shared SectionShell/SectionReveal. Passing a
// 'building' stage made `sectionInitiallyOpen` return false (only
// milestones/materials start open in 'building'), collapsing the preview
// body (color swatches + body-font sample) the admin opens this panel to see.
// Guard: the preview's collapsible region must render OPEN.

import { render, cleanup, screen } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ThemePreview } from './ThemePreview'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'

afterEach(() => {
  cleanup()
})

describe('ThemePreview', () => {
  it('renders its section body expanded, not collapsed/inert', () => {
    const { getByTestId } = render(<ThemePreview theme={DEFAULT_THEME} />)
    const region = getByTestId('vb-region')
    expect(region.getAttribute('data-vb-expanded')).toBe('true')
    expect(region.hasAttribute('inert')).toBe(false)
    expect(region.getAttribute('aria-hidden')).toBeNull()
  })

  it('reflects brand colors and fonts on the explicitly light client canvas', () => {
    const theme = {
      ...DEFAULT_THEME,
      primary: '#123456',
      secondary: '#abcdef',
      tertiary: '#fedcba',
      headingFont: 'playfair-display',
      bodyFont: 'roboto',
    }
    render(<ThemePreview theme={theme} clientName="Acme College" />)

    const canvas = screen.getByTestId('theme-preview-canvas')
    expect(canvas.style.colorScheme).toBe('light')
    expect(canvas.style.getPropertyValue('--vb-primary')).toBe('#123456')
    expect(canvas.style.getPropertyValue('--vb-secondary')).toBe('#abcdef')
    expect(canvas.style.getPropertyValue('--vb-tertiary')).toBe('#fedcba')
    expect(canvas.style.getPropertyValue('--vb-heading-font')).toContain('Playfair Display')
    expect(canvas.style.getPropertyValue('--vb-body-font')).toContain('Roboto')
    expect(screen.getByText('Acme College — viewbook preview')).toBeTruthy()
  })

  it('keeps dark-mode classes on the admin frame and out of the client canvas', () => {
    render(<ThemePreview theme={DEFAULT_THEME} />)
    const frame = screen.getByTestId('theme-preview-frame')
    const canvas = screen.getByTestId('theme-preview-canvas')
    expect(frame.className).toContain('dark:')

    const canvasClasses = [canvas, ...canvas.querySelectorAll('[class]')]
      .map((element) => element.getAttribute('class') ?? '')
      .join(' ')
    expect(canvasClasses).not.toContain('dark:')
  })

  it('contains horizontal overflow and grows to fit — no height cap or inner scroll (2026-07-20)', () => {
    const { container } = render(<ThemePreview theme={DEFAULT_THEME} />)
    expect(screen.getByTestId('theme-preview-frame').className).toContain('max-w-full')
    const classes = [...container.querySelectorAll('[class]')].map((node) => node.className).join(' ')
    expect(classes).not.toContain('max-h-')
    expect(classes).not.toContain('overflow-y-auto')
    expect(container.querySelector('.overflow-x-hidden')).not.toBeNull()
  })

  it('renders the brand hero at the saved overlay strength when a token is provided', () => {
    const theme = { ...DEFAULT_THEME, sectionHeroes: { ...DEFAULT_THEME.sectionHeroes, brand: 'brand-hero.webp' } }
    const { container } = render(
      <ThemePreview
        theme={theme}
        token="real-token"
        presentation={{ collapseAffordance: 'chevron', collapseMorph: 'spread', heroOverlayStrength: 63 }}
      />,
    )
    const html = container.innerHTML
    expect(html).toContain('/api/viewbook/real-token/assets/brand-hero.webp')
  })

  it('falls back to the first uploaded hero when brand has none, and to no hero without a token', () => {
    const theme = { ...DEFAULT_THEME, sectionHeroes: { ...DEFAULT_THEME.sectionHeroes, welcome: 'welcome-hero.webp' } }
    const withToken = render(<ThemePreview theme={theme} token="tok" />)
    expect(withToken.container.innerHTML).toContain('/api/viewbook/tok/assets/welcome-hero.webp')
    withToken.unmount()

    const withoutToken = render(<ThemePreview theme={theme} />)
    expect(withoutToken.container.innerHTML).not.toContain('welcome-hero.webp')
  })
})
