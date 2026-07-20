// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { SectionShell } from './SectionShell'
import { collapseKey } from './useCollapseState'
import type { PublicSection } from '@/lib/viewbook/public-types'

// 2026-07-19 collapse local-only revision (docs/superpowers/specs/2026-07-19-
// viewbook-collapse-local-revision.md): collapse is now purely local
// (localStorage), default COLLAPSED. The retired `collapsedShared` DB field
// no longer even rides on `PublicSection` (Fix 4, post-review) — tests that
// need the section rendered EXPANDED seed localStorage directly via
// `collapseKey`, mirroring how a real client's stored preference would look.

let stored = new Map<string, string>()

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const section = (over: Partial<PublicSection> = {}): PublicSection => ({
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
  ...over,
})

const baseProps = {
  affordance: 'chevron' as const,
  overlayStrength: 55,
  isOperator: false, // vestigial prop, kept for caller compatibility — see SectionShell.tsx
  viewbookId: 1,
  token: 'tok', // vestigial prop, kept for caller compatibility — see SectionShell.tsx
}

function expandSection(sectionKey = 'brand', viewbookId = baseProps.viewbookId) {
  stored.set(collapseKey(viewbookId, sectionKey), 'expanded')
}

// Body visibility is now STATE-ONLY (sticky-header model, no observer). Initial
// open/closed comes from the pure `sectionInitiallyOpen(section, stage)` policy;
// these assert that seeded state. A normal `brand` section is open in `kickoff`
// (in `building` only milestones+materials open — see the sections-read tests).
// This is SectionReveal's OWN internal region (`vb-region-<key>-detail`) — a
// SEPARATE, always-true-while-SECTION_TOGGLE_ENABLED=false toggle, independent
// of CollapsibleSection's OUTER collapse-to-hero region asserted separately below.

describe('SectionShell', () => {
  it('renders a normal (locally-expanded) section with its anchor id, intro note, summary face, and body', () => {
    expandSection()
    render(
      <SectionShell
        {...baseProps}
        section={section({ introNote: 'A note' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="kickoff"
        summary={<span>3 colors locked in</span>}
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(document.getElementById('brand')).not.toBeNull()
    expect(screen.getByText('A note')).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
    expect(screen.getByText('3 colors locked in')).toBeDefined()
    // Normal mode = SSR-expanded detail region (not collapsed).
    const region = document.getElementById('vb-region-brand-detail')
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(region?.getAttribute('aria-label')).toBe('Brand Guidelines')
    // The per-section "Show/Hide details" toggle is still hidden
    // (SECTION_TOGGLE_ENABLED = false) — but the viewer collapse control
    // IS present since this section is (locally) expanded.
    expect(screen.queryByText('Show details')).toBeNull()
    expect(screen.queryByText('Hide details')).toBeNull()
    const btn = screen.getByRole('button', { name: 'Brand Guidelines' })
    expect(btn).toBeDefined()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    // APG Accordion: the button must never contain a heading — the heading
    // wraps the button instead (see the "defaults to COLLAPSED" test below
    // for the full ancestor assertion).
    expect(btn.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull()
    // Round-2 review fix: the EXPANDED hero's decorative layers are <span>s
    // too — a <button> permits only phrasing content, whether collapsed or
    // expanded.
    expect(btn.querySelectorAll('div').length).toBe(0)
  })

  it('renders a done section with the completion date, body retained (SectionReveal is independent of the outer collapse default)', () => {
    render(
      <SectionShell
        {...baseProps}
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = document.getElementById('vb-region-brand-detail')
    expect(region).not.toBeNull()
    // SECTION_TOGGLE_ENABLED = false ⇒ SectionReveal's own region always
    // reports expanded, independent of CollapsibleSection's outer default.
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(screen.getByText(/Completed/)).toBeDefined()
    // Body always retained in the DOM (mounted, only visually/a11y hidden by
    // the outer collapsed-by-default region — text queries ignore that).
    expect(screen.getByText('Body')).toBeDefined()
  })

  it('renders an acknowledged post-contract section (state active, no doneAt) with no "Completed" line', () => {
    render(
      <SectionShell
        {...baseProps}
        section={section({ acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        title="Set Up Your Viewbook"
        heroUrl={null}
        stage="post-contract"
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = document.getElementById('vb-region-brand-detail')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(screen.getByText('Body')).toBeDefined()
    // No doneAt on this section — the "Completed" date line must not appear.
    expect(screen.queryByText(/Completed/)).toBeNull()
  })

  it('defaults to COLLAPSED on a fresh machine: shows the compact row + expand affordance, detail body hidden (not absent)', () => {
    render(
      <SectionShell
        {...baseProps}
        section={section({ introNote: 'A note' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
        summary={<span>3 colors locked in</span>}
      >
        <p>Body</p>
      </SectionShell>,
    )
    // The compact row still renders the title as a heading — the section
    // anchor + heading structure is preserved whether collapsed or expanded.
    expect(document.getElementById('brand')).not.toBeNull()
    const heading = screen.getByRole('heading', { name: 'Brand Guidelines' })
    expect(heading.tagName).toBe('H2')
    // The outer viewer-collapse region exists but is hidden — content is
    // still IN THE DOM (not suppressed server-side), just not visible.
    const outer = document.getElementById('vb-region-brand')
    expect(outer).not.toBeNull()
    expect(outer?.hasAttribute('hidden')).toBe(true)
    expect(outer?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('A note')).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
    // The whole-row control targets the outer region.
    const btn = screen.getByRole('button', { name: 'Brand Guidelines' })
    expect(btn.getAttribute('aria-controls')).toBe('vb-region-brand')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    // APG Accordion pattern (post-review a11y fix): the heading WRAPS the
    // button — never the reverse. A <button> may not contain a block <h2>.
    expect(heading.contains(btn)).toBe(true)
    expect(btn.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull()
    // Round-2 review fix: a <button> may ALSO only contain phrasing content —
    // the decorative hero layers (image wash/accent/cluster) are <span>s,
    // never <div>s. Neither the button nor its wrapping heading carries an
    // explicit aria-label any more (name-from-content off the visible title).
    expect(btn.querySelectorAll('div').length).toBe(0)
    expect(btn.hasAttribute('aria-label')).toBe(false)
    expect(heading.hasAttribute('aria-label')).toBe(false)
    // The controlled region is a NAMED landmark (Fix 1, post-review).
    expect(outer?.getAttribute('aria-label')).toBe('Brand Guidelines')
    // The compact row's OWN outer wrapper carries the ~8px stacked-row gap
    // (Fix 5, post-review) — lives inside the button, not the region.
    expect(btn.innerHTML).toContain('py-1')
  })

  it('pc-intro (bookend) is collapsible like any other section — defaults to collapsed with a compact row + expand control (2026-07-19 welcome-auto-reveal)', () => {
    render(
      <SectionShell
        {...baseProps}
        section={section({ sectionKey: 'pc-intro' })}
        title="Welcome"
        heroUrl={null}
        stage="post-contract"
      >
        <p>Body</p>
      </SectionShell>,
    )
    // The outer viewer-collapse region is a real landmark, present but
    // hidden while collapsed (default on a fresh machine) — same shape as
    // every other collapsible section.
    const region = document.getElementById('vb-region-pc-intro')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('role')).toBe('region')
    expect(region?.hasAttribute('hidden')).toBe(true)
    const btn = screen.getByRole('button', { name: 'Welcome' })
    expect(btn.getAttribute('aria-controls')).toBe('vb-region-pc-intro')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('pc-intro (bookend) renders expanded with the region visible when locally expanded', () => {
    expandSection('pc-intro')
    render(
      <SectionShell
        {...baseProps}
        section={section({ sectionKey: 'pc-intro' })}
        title="Welcome"
        heroUrl={null}
        stage="post-contract"
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = document.getElementById('vb-region-pc-intro')
    expect(region?.hasAttribute('hidden')).toBe(false)
    const btn = screen.getByRole('button', { name: 'Welcome' })
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('SectionShell PR3 restructure', () => {
  it('renders the done-check on the hero in BOTH the default-collapsed compact row and the (locally-expanded) hero', () => {
    expandSection()
    const { container: expandedContainer, unmount } = render(
      <SectionShell
        {...baseProps}
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    // hero cluster badge + body summary-face badge, both `.vb-done-badge`.
    expect(expandedContainer.querySelectorAll('.vb-done-badge').length).toBeGreaterThanOrEqual(2)
    unmount()

    // Fresh section/viewbook pair — NOT seeded, so this render defaults collapsed.
    const { container: collapsedContainer } = render(
      <SectionShell
        {...baseProps}
        section={section({ sectionKey: 'assessment', state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Assessment"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    // The compact row's small done-check.
    expect(collapsedContainer.querySelector('.vb-done-badge')).not.toBeNull()
    expect(document.getElementById('vb-region-assessment')?.hasAttribute('hidden')).toBe(true)
  })

  it('retains the body "Completed {date}" badge when done, independent of the outer collapse default', () => {
    render(
      <SectionShell
        {...baseProps}
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(screen.getByText(/Completed July 1, 2026/)).toBeDefined()
  })

  it('computes concrete gradient stops from heroOverlayStrength on the EXPANDED hero (0→15%/60%, 100→60%/85%) — no calc(var()*%)', () => {
    expandSection()
    const { container: at0 } = render(
      <SectionShell
        {...baseProps}
        overlayStrength={0}
        section={section()}
        title="Brand Guidelines"
        heroUrl="/api/viewbook/tok/assets/hero.png"
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(at0.innerHTML).toContain('linear-gradient(to top, var(--vb-primary) 15%, transparent 60%)')
    expect(at0.innerHTML).not.toContain('calc(var(--vb-overlay')
    cleanup()

    expandSection()
    const { container: at100 } = render(
      <SectionShell
        {...baseProps}
        overlayStrength={100}
        section={section()}
        title="Brand Guidelines"
        heroUrl="/api/viewbook/tok/assets/hero.png"
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(at100.innerHTML).toContain('linear-gradient(to top, var(--vb-primary) 60%, transparent 85%)')
  })

  it('the compact collapsed row uses a HORIZONTAL brand wash driven by the same overlayStrength control', () => {
    const { container } = render(
      <SectionShell
        {...baseProps}
        overlayStrength={100}
        section={section()}
        title="Brand Guidelines"
        heroUrl="/api/viewbook/tok/assets/hero.png"
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    // Default-collapsed (not seeded) — the compact row's wash gradient.
    expect(container.innerHTML).toContain('linear-gradient(to right, var(--vb-primary) 8%,')
    expect(container.innerHTML).toContain('color-mix(in srgb, var(--vb-primary) 100%, transparent) 80%')
  })

  it('always renders the minimum scrim layer on the expanded hero, even at heroOverlayStrength=0', () => {
    expandSection()
    const { container } = render(
      <SectionShell
        {...baseProps}
        overlayStrength={0}
        section={section()}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(container.innerHTML).toContain('color-mix(in srgb, var(--vb-primary) 55%, transparent)')
  })

  it('does NOT emit its own data-operator-section (OperatorSectionWrapper owns it)', () => {
    const { container } = render(
      <SectionShell
        {...baseProps}
        section={section()}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(container.querySelector('[data-operator-section]')).toBeNull()
  })

  it('bookend sections (pc-intro/pc-thanks) render WITH a collapse affordance/control, like any other section (2026-07-19 welcome-auto-reveal)', () => {
    for (const key of ['pc-intro', 'pc-thanks'] as const) {
      const { container, unmount } = render(
        <SectionShell
          {...baseProps}
          section={section({ sectionKey: key })}
          title="Bookend"
          heroUrl={null}
          stage="post-contract"
        >
          <p>Body</p>
        </SectionShell>,
      )
      const btn = container.querySelector('button')
      expect(btn).not.toBeNull()
      expect(btn?.getAttribute('aria-expanded')).toBe('false')
      expect(container.querySelector('[role="region"]')).not.toBeNull()
      unmount()
    }
  })
})

describe('SectionShell PR5 polish', () => {
  it('animates the done badge with a reduced-motion override', () => {
    const { container } = render(
      <SectionShell
        {...baseProps}
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(container.innerHTML).toContain('vb-pop')
    expect(container.innerHTML).toContain('prefers-reduced-motion')
    expect(container.querySelector('.vb-done-badge')).not.toBeNull()
  })

  it('renders the hero legibility gradient and scroll offset on the (locally-expanded) active section', () => {
    expandSection()
    const { container } = render(
      <SectionShell
        {...baseProps}
        section={section()}
        title="Brand Guidelines"
        heroUrl="/api/viewbook/tok/assets/hero.png"
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(container.innerHTML).toContain('linear-gradient(to top, var(--vb-primary)')
    // scroll-mt-24 was replaced by an inline measured scroll offset — lives on
    // the outer <section>, present regardless of collapse state.
    expect(container.innerHTML).toMatch(/scroll-margin-top:\s*calc\(var\(--vb-sticky-offset, 0px\) \+ 12px\)/)
  })
})
