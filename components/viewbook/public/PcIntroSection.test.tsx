// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { PcIntroSection } from './PcIntroSection'

afterEach(cleanup)

const baseSection: PublicSection = {
  sectionKey: 'pc-intro',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

function data(over: Partial<ViewbookPublicData> = {}): ViewbookPublicData {
  return {
    clientName: 'Acme',
    displayName: 'Acme',
    kind: 'upgrade',
    welcomeNote: null,
    dataLockedAt: null,
    theme: DEFAULT_THEME,
    stage: 'post-contract',
    stageLabel: 'Getting Started',
    pcCompletedAt: null,
    clientNotifyJson: [],
    teamMembers: [],
    primarySections: [],
    carriedSections: [],
    fieldCategories: [],
    milestones: [],
    materials: [],
    global: { team: null, pcIntro: null, blocks: {} },
    overrides: {},
    ...over,
  } as unknown as ViewbookPublicData
}

describe('PcIntroSection', () => {
  it('renders the pc-intro title in post-contract', () => {
    const { container } = render(<PcIntroSection section={{ ...baseSection }} data={data()} token="t" />)
    expect(container.textContent).toContain('Welcome')
  })

  it('renders the operator-editable global copy when set', () => {
    const withCopy = data({ global: { team: null, pcIntro: 'Custom welcome copy.', blocks: {} } })
    render(<PcIntroSection section={{ ...baseSection }} data={withCopy} token="t" />)
    expect(screen.getByText('Custom welcome copy.')).toBeDefined()
  })

  it('falls back to code-owned copy when pcIntro is unset', () => {
    render(<PcIntroSection section={{ ...baseSection }} data={data()} token="t" />)
    expect(screen.getByText(/get your viewbook set up/i)).toBeDefined()
  })

  it('returns null outside post-contract (defensive gate)', () => {
    const { container } = render(
      <PcIntroSection section={{ ...baseSection }} data={data({ stage: 'building' })} token="t" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders as a collapsible section (compact row + expand control), not a permanently-open hero (2026-07-19 welcome-auto-reveal)', () => {
    const { container } = render(<PcIntroSection section={{ ...baseSection }} data={data()} token="t" />)
    expect(container.querySelector('details')).toBeNull()
    // Default-collapsed on a fresh machine (no seeded localStorage) — same
    // compact-row + expand-control shape as every other section now that
    // pc-intro is no longer excluded from collapse.
    const btn = container.querySelector('button')
    expect(btn).not.toBeNull()
    expect(btn?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[role="region"]')).not.toBeNull()
  })
})
