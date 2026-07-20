// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import { ThemeStyle, fontsHref, themeCssVars } from './ThemeStyle'

afterEach(cleanup)

describe('fontsHref', () => {
  it('builds the href from catalog values only and dedupes same heading/body font', () => {
    expect(fontsHref(DEFAULT_THEME)).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap',
    )
  })
  it('joins two distinct fonts', () => {
    const href = fontsHref({ ...DEFAULT_THEME, headingFont: 'oswald', bodyFont: 'lora' })
    expect(href).toContain('family=Oswald')
    expect(href).toContain('family=Lora')
  })
  it('uses only manifest metadata, including each family\'s supported weights', () => {
    const href = fontsHref({
      ...DEFAULT_THEME,
      headingFont: 'roboto',
      bodyFont: 'dm-serif-display',
    })
    expect(href).toContain('family=Roboto:wght@100;300;400;500;700;900')
    expect(href).toContain('family=DM+Serif+Display:wght@400')
    expect(href).not.toContain(encodeURIComponent('roboto'))
  })
  it('falls back to the default catalog entry for an unknown key (defensive)', () => {
    const href = fontsHref({ ...DEFAULT_THEME, headingFont: 'nope', bodyFont: 'nope' })
    expect(href).toContain('family=Inter')
  })
})

describe('themeCssVars', () => {
  it('derives readable on-primary text', () => {
    const dark = themeCssVars({ ...DEFAULT_THEME, primary: '#111111' }) as Record<string, string>
    expect(dark['--vb-on-primary']).toBe('#ffffff')
    const light = themeCssVars({ ...DEFAULT_THEME, primary: '#ffffff' }) as Record<string, string>
    expect(light['--vb-on-primary']).toBe('#111111')
  })
  it('derives on-tertiary independently (Codex plan-fix 4)', () => {
    const vars = themeCssVars({ ...DEFAULT_THEME, primary: '#111111', tertiary: '#ffffff' }) as Record<string, string>
    expect(vars['--vb-on-primary']).toBe('#ffffff')
    expect(vars['--vb-on-tertiary']).toBe('#111111')
  })
  it('uses server-resolved catalog metadata without importing the full catalog here', () => {
    const theme = { ...DEFAULT_THEME, headingFont: 'abril-fatface' }
    const resolved = {
      href: 'https://fonts.googleapis.com/css2?family=Abril+Fatface:wght@400&family=Inter:wght@400;600;700;800&display=swap',
      heading: { key: 'abril-fatface', family: 'Abril Fatface', gfQuery: 'family=Abril+Fatface:wght@400' },
      body: { key: 'inter', family: 'Inter', gfQuery: 'family=Inter:wght@400;600;700;800' },
    }
    const vars = themeCssVars(theme, resolved) as Record<string, string>
    expect(vars['--vb-heading-font']).toBe("'Abril Fatface', sans-serif")
    expect(fontsHref(theme, resolved)).toBe(resolved.href)
  })
})

describe('ThemeStyle', () => {
  it('renders exactly one marked stylesheet link for live replacement', () => {
    const { container } = render(<ThemeStyle theme={DEFAULT_THEME} />)
    expect(container.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1)
    expect(container.querySelector('link[data-vb-theme-font]')).not.toBeNull()
  })
})
