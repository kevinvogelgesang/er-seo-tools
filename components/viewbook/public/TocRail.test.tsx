// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TocRail } from './TocRail'
import type { SearchEntry, TocEntry } from '@/lib/viewbook/toc-index'

// Two primary entries: welcome (done, not acked) + data-source (not done,
// acked) with a single building-stage category child.
const toc: TocEntry[] = [
  { sectionKey: 'welcome', label: 'Welcome & Team', anchor: '#welcome', done: true, acked: false },
  {
    sectionKey: 'data-source',
    label: 'Data Source',
    anchor: '#data-source',
    done: false,
    acked: true,
    children: [{ label: 'Programs', anchor: '#vb-cat-programs' }],
  },
]
const searchIndex: SearchEntry[] = [
  { id: 'doc:a', kind: 'doc', label: 'Playbook', sectionKey: 'strategy', anchor: '#vb-doc-a.webp', haystack: 'playbook' },
]

// Default desktop: matchMedia returns matches:false for every query (the
// mobile branch is only entered when the < 768px query matches).
function mockMatchMedia(matches: boolean) {
  ;(window as any).matchMedia = (q: string) => ({
    matches,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
}

beforeEach(() => {
  cleanup()
  mockMatchMedia(false)
})
afterEach(cleanup)

function entries(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('[data-vb-toc-entry]')) as HTMLElement[]
}

describe('TocRail', () => {
  it('renders one entry per TOC row carrying done/acked glyph state', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const rows = entries(container).filter((e) => e.getAttribute('data-anchor')?.startsWith('#welcome') || e.getAttribute('data-anchor') === '#data-source')
    // welcome + data-source top-level entries present
    const welcome = container.querySelector('[data-anchor="#welcome"]') as HTMLElement
    const dataSource = container.querySelector('[data-anchor="#data-source"]') as HTMLElement
    expect(welcome).not.toBeNull()
    expect(dataSource).not.toBeNull()
    expect(welcome.getAttribute('data-vb-done')).toBe('true')
    expect(welcome.getAttribute('data-vb-acked')).toBe('false')
    expect(dataSource.getAttribute('data-vb-done')).toBe('false')
    expect(dataSource.getAttribute('data-vb-acked')).toBe('true')
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })

  it('activating an entry dispatches vb:navigate with its {sectionKey, anchor}', () => {
    const details: any[] = []
    const handler = (e: Event) => details.push((e as CustomEvent).detail)
    window.addEventListener('vb:navigate', handler)
    try {
      const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
      const welcome = container.querySelector('[data-anchor="#welcome"]') as HTMLElement
      act(() => {
        fireEvent.click(welcome)
      })
      expect(details).toContainEqual({ sectionKey: 'welcome', anchor: '#welcome' })
    } finally {
      window.removeEventListener('vb:navigate', handler)
    }
  })

  it('verbose shows the category sub-entry and a search box that filters to a hit and navigates', () => {
    const details: any[] = []
    const handler = (e: Event) => details.push((e as CustomEvent).detail)
    window.addEventListener('vb:navigate', handler)
    try {
      const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose />)
      // sub-entry present
      const child = container.querySelector('[data-anchor="#vb-cat-programs"]') as HTMLElement
      expect(child).not.toBeNull()
      expect(child.textContent).toContain('Programs')

      // search box present and filtering
      const search = container.querySelector('input[type="search"]') as HTMLInputElement
      expect(search).not.toBeNull()
      act(() => {
        fireEvent.change(search, { target: { value: 'play' } })
      })
      const hit = container.querySelector('[data-vb-search-hit]') as HTMLElement
      expect(hit).not.toBeNull()
      expect(hit.textContent).toContain('Playbook')

      act(() => {
        fireEvent.click(hit)
      })
      expect(details).toContainEqual({ sectionKey: 'strategy', anchor: '#vb-doc-a.webp' })
    } finally {
      window.removeEventListener('vb:navigate', handler)
    }
  })

  it('ArrowDown moves roving focus to the next entry', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const list = container.querySelector('[data-vb-toc-list]') as HTMLElement
    const rows = entries(container)
    act(() => {
      rows[0].focus()
    })
    act(() => {
      fireEvent.keyDown(list, { key: 'ArrowDown' })
    })
    expect(document.activeElement).toBe(rows[1])
  })

  it('Escape does NOT collapse the desktop rail — it is permanently expanded', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const nav = container.querySelector('[data-vb-toc-nav]') as HTMLElement
    const rows = entries(container)
    act(() => {
      rows[0].focus()
    })
    expect(nav.getAttribute('data-vb-open')).toBe('true')
    act(() => {
      fireEvent.keyDown(nav, { key: 'Escape' })
    })
    expect(nav.getAttribute('data-vb-open')).toBe('true')
  })

  // Codex-review fix P2-3 (hamburger-persistent rail): the rail's open state
  // is now owned SOLELY by the hamburger trigger (+ Escape) — mouse
  // enter/leave and blur no longer touch it at all. These two cases replace
  // the old hover-driven "collapses on mouse-leave once focus is outside"
  // assertion, which encoded exactly the behavior Kevin asked to remove.
  it('mouse-leave does NOT collapse the rail, even when focus is outside it', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const nav = container.querySelector('[data-vb-toc-nav]') as HTMLElement
    expect(nav.getAttribute('data-vb-open')).toBe('true') // default-open

    // Focus outside the rail (the old code's onBlur collapse trigger), then
    // mouse-leave the rail (the old code's onMouseLeave collapse trigger).
    // Neither may change `open` now — only the hamburger/Escape may.
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => {
      outside.focus()
    })
    act(() => {
      fireEvent.mouseLeave(nav)
    })
    expect(nav.getAttribute('data-vb-open')).toBe('true')
    outside.remove()
  })

  it('mouse-leave does NOT collapse the rail — the desktop rail is permanently expanded (no hamburger to collapse it)', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const nav = container.querySelector('[data-vb-toc-nav]') as HTMLElement
    // No hamburger trigger exists on the permanently-expanded desktop rail.
    expect(container.querySelector('[data-vb-toc-trigger]')).toBeNull()
    expect(nav.getAttribute('data-vb-open')).toBe('true')

    // mouse enter/leave must be fully inert — no collapse, no change at all.
    act(() => {
      fireEvent.mouseEnter(nav)
    })
    expect(nav.getAttribute('data-vb-open')).toBe('true')
    act(() => {
      fireEvent.mouseLeave(nav)
    })
    expect(nav.getAttribute('data-vb-open')).toBe('true')
  })

  it('mobile (< 768px) renders a FAB button', () => {
    mockMatchMedia(true)
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    // the matchMedia effect runs post-mount; force a re-render tick
    const fab = container.querySelector('[data-vb-toc-fab]')
    expect(fab).not.toBeNull()
  })

  it('SSR render (no effects) does not throw', () => {
    expect(() =>
      renderToStaticMarkup(<TocRail toc={toc} searchIndex={searchIndex} verbose />),
    ).not.toThrow()
  })

  // Task 7: default-expanded, left-anchored, hamburger toggle.

  it('desktop rail defaults to expanded (open) without any interaction', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const nav = container.querySelector('[data-vb-toc-nav]') as HTMLElement
    expect(nav.getAttribute('data-vb-open')).toBe('true')
    // Permanently expanded — no hamburger trigger to rely on for this assertion.
    expect(container.querySelector('[data-vb-toc-trigger]')).toBeNull()
    // The inner card renders at its full (expanded) width.
    const card = container.querySelector('[data-vb-toc-list]')?.parentElement as HTMLElement
    expect(card.style.width).toBe('240px')
  })

  it('desktop rail is left-anchored, not right-anchored', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const nav = container.querySelector('[data-vb-toc-nav]') as HTMLElement
    expect(nav.className).toContain('left-3')
    expect(nav.className).not.toContain('right-3')
  })

  it('desktop rail is permanently expanded — no hamburger trigger is rendered', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const nav = container.querySelector('[data-vb-toc-nav]') as HTMLElement
    // DESKTOP_RAIL_COLLAPSIBLE = false ⇒ the hamburger toggle is gone entirely
    // on desktop; the rail just stays open.
    expect(container.querySelector('[data-vb-toc-trigger]')).toBeNull()
    expect(nav.getAttribute('data-vb-open')).toBe('true')
  })

  it('a done entry renders the filled glyph and an acked-not-done entry renders the hollow glyph', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const welcome = container.querySelector('[data-anchor="#welcome"]') as HTMLElement
    const dataSource = container.querySelector('[data-anchor="#data-source"]') as HTMLElement
    expect(welcome.querySelector('[data-vb-glyph="done"]')).not.toBeNull()
    expect(dataSource.querySelector('[data-vb-glyph="acked"]')).not.toBeNull()
  })

  it('activating a TOC item does not collapse the desktop rail', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const nav = container.querySelector('[data-vb-toc-nav]') as HTMLElement
    const welcome = container.querySelector('[data-anchor="#welcome"]') as HTMLElement
    expect(nav.getAttribute('data-vb-open')).toBe('true')
    act(() => {
      fireEvent.click(welcome)
    })
    expect(nav.getAttribute('data-vb-open')).toBe('true')
  })
})
