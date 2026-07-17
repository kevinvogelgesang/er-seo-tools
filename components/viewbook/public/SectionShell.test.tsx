// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SectionShell } from './SectionShell'
import type { PublicSection } from '@/lib/viewbook/public-types'

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
    // Toggle button wired to the region.
    const toggle = container.querySelector('button[aria-expanded]')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-controls')).toBe(region?.getAttribute('id'))
  })

  it('renders a done section as a collapsed reveal region with the completion date, body retained', () => {
    const { container } = render(
      <SectionShell
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
        stage="building"
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('data-vb-expanded')).toBe('false')
    expect(screen.getByText(/Completed/)).toBeDefined()
    // Body always retained in the DOM (collapsed, not removed).
    expect(screen.getByText('Body')).toBeDefined()
  })

  it('collapses an acknowledged post-contract section (state active, no doneAt) like a done section — PR5 Task 7', () => {
    const { container } = render(
      <SectionShell
        section={section({ acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        title="Set Up Your Viewbook"
        heroUrl={null}
        stage="post-contract"
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('data-vb-expanded')).toBe('false')
    expect(screen.getByText('Body')).toBeDefined()
    // No doneAt on this section — the "Completed" date line must not appear.
    expect(screen.queryByText(/Completed/)).toBeNull()
  })

  it('always-open (pc-intro) renders expanded with no toggle', () => {
    const { container } = render(
      <SectionShell
        section={section({ sectionKey: 'pc-intro' })}
        title="Welcome"
        heroUrl={null}
        stage="post-contract"
      >
        <p>Body</p>
      </SectionShell>,
    )
    const region = container.querySelector('[role="region"]')
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(container.querySelector('button[aria-expanded]')).toBeNull()
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
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(container.innerHTML).toContain('linear-gradient(to top, var(--vb-primary)')
    // scroll-mt-24 was replaced by an inline measured scroll offset.
    expect(container.innerHTML).toMatch(/scroll-margin-top:\s*calc\(var\(--vb-sticky-offset, 0px\) \+ 12px\)/)
  })
})
