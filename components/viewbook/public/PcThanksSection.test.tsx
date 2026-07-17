// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { PcThanksSection } from './PcThanksSection'

afterEach(cleanup)

const section: PublicSection = {
  sectionKey: 'pc-thanks',
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

describe('PcThanksSection', () => {
  it('returns null when pcCompletedAt is null', () => {
    const { container } = render(<PcThanksSection section={section} data={data()} token="t" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the fixed thank-you copy when pcCompletedAt is set', () => {
    render(
      <PcThanksSection section={section} data={data({ pcCompletedAt: '2026-07-16T00:00:00.000Z' })} token="t" />,
    )
    expect(screen.getByText(/we've received your information/i)).toBeDefined()
    // Title now appears twice — once in the header band, once as the
    // generic summary face's eyebrow (PR7 Task 6) — so this is no longer a
    // single-match assertion.
    expect(screen.getAllByText('Thank You').length).toBeGreaterThan(0)
  })
})
