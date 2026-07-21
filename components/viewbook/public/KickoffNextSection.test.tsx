// @vitest-environment jsdom
// Lane E — KickoffNextSection: the "Next Steps" chapter must not read as an
// empty section. It renders a concise action summary + one prominent CTA
// (the shared ChapterCtaButton island, wired to navigateToAnchor). DOM-native
// assertions only (no jest-dom). navigateToAnchor is mocked to assert the CTA
// contract without real scroll plumbing.
import { render, cleanup, fireEvent } from '@testing-library/react'
import { defaultMeta } from './section-test-meta'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'

const navigateSpy = vi.fn()
vi.mock('./viewbook-navigate', () => ({
  navigateToAnchor: (...args: unknown[]) => navigateSpy(...args),
}))

import { KickoffNextSection } from './KickoffNextSection'

afterEach(() => {
  cleanup()
  navigateSpy.mockClear()
})

const section: PublicSection = {
  sectionKey: 'kickoff-next',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

const data: ViewbookPublicData = {
  clientName: 'Acme',
  displayName: 'Acme',
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  stage: 'kickoff',
  stageLabel: 'Kickoff',
  pcCompletedAt: null,
  clientNotifyJson: [],
  teamMembers: [],
  primarySections: [],
  carriedSections: [],
  fieldCategories: [],
  milestones: [],
  materials: [],
  viewbookId: 7,
  csmName: 'Dana',
  global: { team: null, pcIntro: null, blocks: {} },
  overrides: {},
} as unknown as ViewbookPublicData

describe('KickoffNextSection', () => {
  it('renders an action summary (not an empty chapter) for the reader', () => {
    const { container } = render(
      <KickoffNextSection isOperator={false} section={section} data={data} token="tok" meta={defaultMeta()} />,
    )
    const text = container.textContent ?? ''
    expect(text.toLowerCase()).toContain('what happens next')
    // at least one concrete next-action line of code-owned copy
    expect((text.match(/\S/g) ?? []).length).toBeGreaterThan(40)
  })

  it('renders one prominent CTA wired to navigateToAnchor', () => {
    const { container } = render(
      <KickoffNextSection isOperator={false} section={section} data={data} token="tok" meta={defaultMeta()} />,
    )
    const cta = container.querySelector('[data-vb-chapter-cta]')
    expect(cta).toBeTruthy()
    fireEvent.click(cta as Element)
    expect(navigateSpy).toHaveBeenCalledTimes(1)
    const [sectionKey, anchor] = navigateSpy.mock.calls[0]
    expect(anchor).toBe(`#${sectionKey}`)
  })

  it('renders nothing outside the kickoff stage', () => {
    const { container } = render(
      <KickoffNextSection
        isOperator={false}
        section={section}
        data={{ ...data, stage: 'building' }}
        token="tok"
        meta={defaultMeta()}
      />,
    )
    expect(container.textContent).toBe('')
  })
})
