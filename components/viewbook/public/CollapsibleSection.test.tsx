// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CollapsibleSection } from './CollapsibleSection'
import { collapseKey } from './useCollapseState'

let stored = new Map<string, string>()

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  })
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness(props: Partial<Parameters<typeof CollapsibleSection>[0]> = {}) {
  return (
    <CollapsibleSection
      viewbookId={1}
      sectionKey="brand"
      title="Brand & Identity"
      heroExpanded={<div data-testid="hero-expanded">Hero expanded</div>}
      heroCollapsed={<div data-testid="hero-collapsed">Hero collapsed</div>}
      body={<div data-testid="body">Body content</div>}
      regionId="vb-region-brand"
      {...props}
    />
  )
}

describe('CollapsibleSection', () => {
  it('defaults to collapsed on a fresh machine: shows heroCollapsed, region hidden+inert', () => {
    render(<Harness />)
    expect(screen.getByTestId('hero-collapsed')).toBeDefined()
    expect(screen.queryByTestId('hero-expanded')).toBeNull()

    const region = document.getElementById('vb-region-brand')
    expect(region).not.toBeNull()
    expect(region?.hasAttribute('hidden')).toBe(true)
    expect(region?.getAttribute('aria-hidden')).toBe('true')

    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    expect(btn.getAttribute('aria-controls')).toBe('vb-region-brand')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('APG Accordion structure: the <button> does NOT contain a heading, and the section heading (same accessible name) WRAPS the button', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    // A <button> may not validly contain a block <h2> — assert none is nested.
    expect(btn.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull()

    const heading = screen.getByRole('heading', { name: 'Brand & Identity' })
    expect(heading.tagName).toBe('H2')
    // The heading WRAPS the button (not the reverse).
    expect(heading.contains(btn)).toBe(true)
    expect(heading.querySelector('button')).toBe(btn)
  })

  it('a stored "expanded" value starts expanded', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    render(<Harness />)
    expect(screen.getByTestId('hero-expanded')).toBeDefined()
    expect(screen.queryByTestId('hero-collapsed')).toBeNull()
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(screen.getByRole('button', { name: 'Brand & Identity' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('clicking the collapsed row expands it and persists "expanded" to localStorage', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    fireEvent.click(btn)

    expect(screen.getByTestId('hero-expanded')).toBeDefined()
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(false)
    expect(region?.getAttribute('aria-hidden')).toBeNull()
    expect(stored.get(collapseKey(1, 'brand'))).toBe('expanded')
  })

  it('clicking the expanded hero collapses it and persists "collapsed"', () => {
    stored.set(collapseKey(1, 'brand'), 'expanded')
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    fireEvent.click(btn)

    expect(screen.getByTestId('hero-collapsed')).toBeDefined()
    const region = document.getElementById('vb-region-brand')
    expect(region?.hasAttribute('hidden')).toBe(true)
    expect(stored.get(collapseKey(1, 'brand'))).toBe('collapsed')
  })

  it('the body is never a collapse target — it is not wrapped by the toggle button', () => {
    render(<Harness />)
    const body = screen.getByTestId('body')
    expect(body.closest('button')).toBeNull()
  })

  it('the whole-hero control is keyboard-activable (native button — Enter/Space handled by the browser) and toggles on click', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Brand & Identity' })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: 'Brand & Identity' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('hero-expanded')).toBeDefined()
  })

  it('vb:navigate with a matching sectionKey force-expands WITHOUT writing localStorage', async () => {
    render(<Harness />)
    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(true)

    await act(async () => {
      window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'brand' } }))
    })

    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(false)
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false)
  })

  it('vb:navigate for a DIFFERENT sectionKey is a no-op', async () => {
    render(<Harness />)
    await act(async () => {
      window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'assessment' } }))
    })
    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(true)
  })

  it('an initial #hash matching the section force-expands on mount', () => {
    window.location.hash = '#brand'
    render(<Harness />)
    expect(document.getElementById('vb-region-brand')?.hasAttribute('hidden')).toBe(false)
    expect(stored.has(collapseKey(1, 'brand'))).toBe(false)
  })

  it('previewMode: clicking toggles visuals but NEVER writes localStorage', () => {
    render(<Harness previewMode />)
    // previewMode starts expanded (ThemePreview always shows the open hero).
    expect(screen.getByTestId('hero-expanded')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(screen.getByTestId('hero-collapsed')).toBeDefined()
    expect(stored.size).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Brand & Identity' }))
    expect(screen.getByTestId('hero-expanded')).toBeDefined()
    expect(stored.size).toBe(0)
  })
})
