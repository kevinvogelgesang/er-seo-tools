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

  // Feature B (hamburger full-hide) retired the `data-vb-open`-attribute
  // permanently-expanded model these three cases encoded (Escape-is-inert,
  // mouse-leave-is-inert while "no hamburger exists"). There now IS a
  // hamburger and hide/show fully mounts/unmounts the nav — see the
  // 'TocRail desktop hide toggle' describe block below for the current
  // contract. Mouse hover/leave were never wired to any handler before or
  // after this change, so there's nothing load-bearing left to assert here.

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

  // Task 7 (default-expanded, left-anchored) + Feature B (hamburger toggle).

  it('desktop rail defaults to expanded (nav mounted) without any interaction', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const nav = container.querySelector('[data-vb-toc-nav]') as HTMLElement
    expect(nav).not.toBeNull()
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

  it('a done entry renders the filled glyph and an acked-not-done entry renders the hollow glyph', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const welcome = container.querySelector('[data-anchor="#welcome"]') as HTMLElement
    const dataSource = container.querySelector('[data-anchor="#data-source"]') as HTMLElement
    expect(welcome.querySelector('[data-vb-glyph="done"]')).not.toBeNull()
    expect(dataSource.querySelector('[data-vb-glyph="acked"]')).not.toBeNull()
  })

  it('activating a TOC item does not hide the desktop rail', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const welcome = container.querySelector('[data-anchor="#welcome"]') as HTMLElement
    expect(container.querySelector('[data-vb-toc-nav]')).not.toBeNull()
    act(() => {
      fireEvent.click(welcome)
    })
    expect(container.querySelector('[data-vb-toc-nav]')).not.toBeNull()
  })
})

describe('TocRail — active-marker hook (continuous viewer)', () => {
  it('top-level entries carry data-vb-toc-section; child sub-entries do not', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose />)
    expect(container.querySelector('[data-vb-toc-section="welcome"]')).not.toBeNull()
    expect(container.querySelector('[data-vb-toc-section="data-source"]')).not.toBeNull()
    // The 'Programs' child sub-entry must NOT carry the section hook.
    const child = Array.from(container.querySelectorAll('[data-vb-toc-entry]')).find(
      (b) => b.textContent?.includes('Programs'),
    )
    expect(child).toBeTruthy()
    expect((child as HTMLElement).getAttribute('data-vb-toc-section')).toBeNull()
  })
})

describe('TocRail desktop hide toggle', () => {
  it('renders the rail nav expanded by default with an always-present hamburger', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    expect(container.querySelector('[data-vb-toc-hamburger]')).not.toBeNull()
    const nav = container.querySelector('[data-vb-toc-nav]')
    expect(nav).not.toBeNull()
    // hamburger reflects expanded state + controls the mounted nav
    const btn = container.querySelector('[data-vb-toc-hamburger]')!
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe(nav!.getAttribute('id'))
  })

  it('hiding removes the rail nav from the DOM; hamburger stays and drops aria-controls', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const btn = container.querySelector('[data-vb-toc-hamburger]')!
    fireEvent.click(btn)
    expect(container.querySelector('[data-vb-toc-nav]')).toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-controls')).toBeNull()
  })

  it('re-showing restores the rail nav', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={searchIndex} verbose={false} />)
    const btn = container.querySelector('[data-vb-toc-hamburger]')!
    fireEvent.click(btn) // hide
    fireEvent.click(btn) // show
    expect(container.querySelector('[data-vb-toc-nav]')).not.toBeNull()
  })
})
