// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SectionShell } from './SectionShell'
import { defaultMeta } from './section-test-meta'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { SectionKey } from '@/lib/viewbook/theme'

afterEach(cleanup)

const section = (over: Partial<PublicSection> = {}): PublicSection => ({
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
  ...over,
})

// A plain active section under a given key (Task 7 DOM-contract cases).
const activeSection = (sectionKey: SectionKey): PublicSection => section({ sectionKey })

// Body visibility is now STATE-ONLY (sticky-header model, no observer). Initial
// open/closed comes from the pure `sectionInitiallyOpen(section, stage)` policy;
// these assert that seeded state. A normal `brand` section is open in `kickoff`
// (in `building` only milestones+materials open — see the sections-read tests).

describe('SectionShell', () => {
  it('renders a normal section initially-open with its anchor id, intro note, summary face, and body', () => {
    const { container } = render(
      <SectionShell
        section={section({ introNote: 'A note' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="kickoff"
        meta={defaultMeta()}
        summary={<span>3 colors locked in</span>}
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(document.getElementById('brand')).not.toBeNull()
    expect(screen.getByText('A note')).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
    expect(screen.getByText('3 colors locked in')).toBeDefined()
    // Normal mode = SSR-expanded region.
    const region = container.querySelector('[role="region"]')
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(region?.getAttribute('aria-label')).toBe('Brand Guidelines')
    // The per-section toggle is disabled (SECTION_TOGGLE_ENABLED = false) — no
    // button rendered for any section, always-open or not.
    expect(container.querySelector('button[aria-expanded]')).toBeNull()
  })

  it('renders a done section as an expanded reveal region (toggle disabled) with the completion date, body retained', () => {
    const { container } = render(
      <SectionShell
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
        meta={defaultMeta({ status: 'complete' })}
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    // SECTION_TOGGLE_ENABLED = false ⇒ every section renders expanded, even a
    // "done" one that would otherwise start collapsed.
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(screen.getByText(/Completed/)).toBeDefined()
    // Body always retained in the DOM.
    expect(screen.getByText('Body')).toBeDefined()
  })

  it('renders an acknowledged post-contract section (state active, no doneAt) expanded, like every other section — PR5 Task 7', () => {
    const { container } = render(
      <SectionShell
        section={section({ acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        title="Set Up Your Viewbook"
        heroUrl={null}
        stage="post-contract"
        meta={defaultMeta({ status: 'complete' })}
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(screen.getByText('Body')).toBeDefined()
    // No doneAt on this section — the "Completed" date line must not appear.
    expect(screen.queryByText(/Completed/)).toBeNull()
  })

  it('renders a collapsed section as hero-only — title shows, body (intro + children) suppressed', () => {
    const { container } = render(
      <SectionShell
        section={section({ state: 'collapsed', introNote: 'A note' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
        meta={defaultMeta()}
        summary={<span>3 colors locked in</span>}
      >
        <p>Body</p>
      </SectionShell>,
    )
    // The hero band + title still render (the section anchor is preserved).
    expect(document.getElementById('brand')).not.toBeNull()
    expect(screen.getByText('Brand Guidelines')).toBeDefined()
    // The entire detail body is gone: no reveal region, no intro note, no
    // children, no summary face.
    expect(container.querySelector('[role="region"]')).toBeNull()
    expect(screen.queryByText('A note')).toBeNull()
    expect(screen.queryByText('Body')).toBeNull()
    expect(screen.queryByText('3 colors locked in')).toBeNull()
  })

  it('always-open (pc-intro) renders expanded with no toggle', () => {
    const { container } = render(
      <SectionShell
        section={section({ sectionKey: 'pc-intro' })}
        title="Welcome"
        heroUrl={null}
        stage="post-contract"
        meta={defaultMeta({ heroSize: 'full', isLead: true, chapterNumber: 1 })}
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = container.querySelector('[role="region"]')
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(container.querySelector('button[aria-expanded]')).toBeNull()
  })
})

describe('SectionShell DOM contract (Task 7)', () => {
  it('emits the DOM contract attributes and a hero sentinel for chapter heroes', () => {
    const { container } = render(
      <SectionShell
        section={activeSection('brand')}
        stage="website-specifics"
        title="Brand"
        heroUrl={null}
        meta={defaultMeta({ heroSize: 'chapter', chapterNumber: 2, status: 'current' })}
      >
        body
      </SectionShell>,
    )
    const el = container.querySelector('section')!
    expect(el.getAttribute('data-vb-section')).toBe('brand')
    expect(el.getAttribute('data-vb-status')).toBe('current')
    expect(el.getAttribute('data-vb-hero-visible')).toBe('true')
    expect(container.querySelector('[data-vb-hero]')).toBeTruthy()
  })

  it('no-hero sections seed hero-visible false and emit no hero sentinel', () => {
    const { container } = render(
      <SectionShell
        section={activeSection('brand')}
        stage="website-specifics"
        title="Brand"
        heroUrl={null}
        meta={defaultMeta({ heroSize: 'none' })}
      >
        body
      </SectionShell>,
    )
    expect(container.querySelector('section')!.getAttribute('data-vb-hero-visible')).toBe('false')
    expect(container.querySelector('[data-vb-hero]')).toBeNull()
  })
})

describe('SectionShell PR5 polish', () => {
  it('animates the done badge with a reduced-motion override', () => {
    const { container } = render(
      <SectionShell
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
        meta={defaultMeta({ status: 'complete' })}
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
        section={section()}
        title="Brand Guidelines"
        heroUrl="/api/viewbook/tok/assets/hero.png"
        stage="building"
        meta={defaultMeta()}
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(container.innerHTML).toContain('linear-gradient(to top, var(--vb-primary)')
    // scroll-mt-24 was replaced by an inline measured scroll offset.
    expect(container.innerHTML).toMatch(/scroll-margin-top:\s*calc\(var\(--vb-sticky-offset, 0px\) \+ 12px\)/)
  })
})
