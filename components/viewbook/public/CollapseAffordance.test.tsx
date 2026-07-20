// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CollapseAffordance } from './CollapseAffordance'

afterEach(cleanup)

describe('CollapseAffordance', () => {
  it('chevron (default) renders a decorative SVG icon with no visible "Expand" label', () => {
    const { container } = render(<CollapseAffordance kind="chevron" />)
    expect(screen.queryByText('Expand')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('pill renders a visible "Expand" label + SVG chevron', () => {
    const { container } = render(<CollapseAffordance kind="pill" />)
    expect(screen.getByText('Expand')).toBeDefined()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('both variants are decorative (aria-hidden) — the enclosing button owns the accessible name/state', () => {
    const { container: chevronContainer } = render(<CollapseAffordance kind="chevron" />)
    expect(chevronContainer.firstElementChild?.getAttribute('aria-hidden')).toBe('true')

    const { container: pillContainer } = render(<CollapseAffordance kind="pill" />)
    expect(pillContainer.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders no button/link of its own (not a separate interactive element)', () => {
    const { container } = render(<CollapseAffordance kind="chevron" />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })
})
