// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SectionShell } from './SectionShell'
import type { PublicSection } from '@/lib/viewbook/public-types'

afterEach(cleanup)

const section = (over: Partial<PublicSection> = {}): PublicSection => ({
  sectionKey: 'brand',
  state: 'active',
  collapsedShared: false,
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
  ...over,
})

const baseProps = {
  affordance: 'bar' as const,
  overlayStrength: 55,
  isOperator: false,
  viewbookId: 1,
  token: 'tok',
}

// Body visibility is now STATE-ONLY (sticky-header model, no observer). Initial
// open/closed comes from the pure `sectionInitiallyOpen(section, stage)` policy;
// these assert that seeded state. A normal `brand` section is open in `kickoff`
// (in `building` only milestones+materials open — see the sections-read tests).

describe('SectionShell', () => {
  it('renders a normal section initially-open with its anchor id, intro note, summary face, and body', () => {
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
    // Normal mode = SSR-expanded detail region (not collapsedShared).
    const region = document.getElementById('vb-region-brand-detail')
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(region?.getAttribute('aria-label')).toBe('Brand Guidelines')
    // The per-section "Show/Hide details" toggle is still hidden
    // (SECTION_TOGGLE_ENABLED = false) — but the NEW viewer collapse control
    // ("Collapse for everyone") IS present since this section is expanded.
    expect(screen.queryByText('Show details')).toBeNull()
    expect(screen.queryByText('Hide details')).toBeNull()
    expect(screen.getByRole('button', { name: 'Collapse for everyone' })).toBeDefined()
  })

  it('renders a done section with the hero done-check and expanded (toggle disabled) with the completion date, body retained', () => {
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
    // SECTION_TOGGLE_ENABLED = false ⇒ every section renders expanded, even a
    // "done" one that would otherwise start collapsed.
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(screen.getByText(/Completed/)).toBeDefined()
    // Body always retained in the DOM.
    expect(screen.getByText('Body')).toBeDefined()
  })

  it('renders an acknowledged post-contract section (state active, no doneAt) expanded, like every other section — PR5 Task 7', () => {
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

  it('collapsed: shows the shrunken hero + expand affordance, and the detail body is hidden (not absent)', () => {
    render(
      <SectionShell
        {...baseProps}
        section={section({ collapsedShared: true, introNote: 'A note' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
        summary={<span>3 colors locked in</span>}
      >
        <p>Body</p>
      </SectionShell>,
    )
    // The hero band + title still render (the section anchor is preserved).
    expect(document.getElementById('brand')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Brand Guidelines' })).toBeDefined()
    // The outer viewer-collapse region exists but is hidden — content is
    // still IN THE DOM (not suppressed server-side), just not visible.
    const outer = document.getElementById('vb-region-brand')
    expect(outer).not.toBeNull()
    expect(outer?.hasAttribute('hidden')).toBe(true)
    expect(outer?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('A note')).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
    // An expand affordance is present, targeting the outer region.
    const btn = screen.getByRole('button', { name: 'Expand (just for you)' })
    expect(btn.getAttribute('aria-controls')).toBe('vb-region-brand')
  })

  it('always-open (pc-intro) renders expanded with no toggle and NO collapse affordance/control', () => {
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
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(document.querySelector('button')).toBeNull()
  })
})

describe('SectionShell PR3 restructure', () => {
  it('renders the large done-check on the hero when state==="done" (collapsed AND expanded)', () => {
    const { container: expandedContainer, unmount } = render(
      <SectionShell
        {...baseProps}
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z', collapsedShared: false })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(expandedContainer.querySelectorAll('.vb-done-badge').length).toBeGreaterThanOrEqual(2) // hero + body-face
    expect(expandedContainer.innerHTML).toContain('h-11 w-11')
    unmount()

    const { container: collapsedContainer } = render(
      <SectionShell
        {...baseProps}
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z', collapsedShared: true })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(collapsedContainer.innerHTML).toContain('h-11 w-11')
    expect(collapsedContainer.querySelector('.vb-done-badge')).not.toBeNull()
  })

  it('retains the body "Completed {date}" badge when expanded and done', () => {
    render(
      <SectionShell
        {...baseProps}
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z', collapsedShared: false })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(screen.getByText(/Completed July 1, 2026/)).toBeDefined()
  })

  it('computes concrete gradient stops from heroOverlayStrength (0→15%/60%, 100→60%/85%) — no calc(var()*%)', () => {
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

  it('always renders the minimum scrim layer, even at heroOverlayStrength=0', () => {
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

  it('bookend sections (pc-intro/pc-thanks) render with NO collapse affordance/control', () => {
    for (const key of ['pc-intro', 'pc-thanks'] as const) {
      const { container, unmount } = render(
        <SectionShell
          {...baseProps}
          section={section({ sectionKey: key, collapsedShared: false })}
          title="Bookend"
          heroUrl={null}
          stage="post-contract"
        >
          <p>Body</p>
        </SectionShell>,
      )
      expect(container.querySelector('button')).toBeNull()
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

  it('renders the hero legibility gradient and scroll offset on active sections', () => {
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
    // scroll-mt-24 was replaced by an inline measured scroll offset.
    expect(container.innerHTML).toMatch(/scroll-margin-top:\s*calc\(var\(--vb-sticky-offset, 0px\) \+ 12px\)/)
  })
})
