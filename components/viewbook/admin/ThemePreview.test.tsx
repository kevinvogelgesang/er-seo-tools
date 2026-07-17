// @vitest-environment jsdom
//
// Codex cross-review P2-2: the preview's SAMPLE_SECTION is an ACTIVE 'brand'
// section rendered via the shared SectionShell/SectionReveal. Passing a
// 'building' stage made `sectionInitiallyOpen` return false (only
// milestones/materials start open in 'building'), collapsing the preview
// body (color swatches + body-font sample) the admin opens this panel to see.
// Guard: the preview's collapsible region must render OPEN.

import { render, cleanup } from '@testing-library/react'
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
})
