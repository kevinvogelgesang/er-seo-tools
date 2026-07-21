// @vitest-environment jsdom
// The kickoff "Next Steps" reader view must not read as an empty chapter: it
// renders a code-owned action summary + one prominent CTA (the ChapterCtaButton
// island, wired to navigateToAnchor). DOM-native assertions only (no jest-dom).
import { render, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'

const navigateSpy = vi.fn()
vi.mock('./viewbook-navigate', () => ({
  navigateToAnchor: (...args: unknown[]) => navigateSpy(...args),
}))

import { KickoffNextSection } from './KickoffNextSection'
const meta = (over = {}) => ({ heroSize: 'chapter', chapterNumber: 1, status: 'current', isLead: false, ...over })

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

const data = {
  clientName: 'Acme',
  displayName: 'Acme',
  theme: DEFAULT_THEME,
  stage: 'kickoff',
  viewerMode: 'continuous',
  pcCompletedAt: null,
  viewbookId: 7,
  csmName: 'Dana',
  collapseAffordance: 'chevron',
  heroOverlayStrength: 55,
  global: { team: null, pcIntro: null, blocks: {} },
} as unknown as ViewbookPublicData

describe('KickoffNextSection reader action summary', () => {
  it('renders an action summary (not an empty chapter)', () => {
    const { container } = render(
      <KickoffNextSection meta={meta()} isOperator={false} section={section} data={data} token="tok" />,
    )
    const text = container.textContent ?? ''
    expect(text.toLowerCase()).toContain('what happens next')
    expect((text.match(/\S/g) ?? []).length).toBeGreaterThan(40)
  })

  it('renders one prominent CTA wired to navigateToAnchor', () => {
    const { container } = render(
      <KickoffNextSection meta={meta()} isOperator={false} section={section} data={data} token="tok" />,
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
      <KickoffNextSection meta={meta()} isOperator={false} section={section} data={{ ...data, stage: 'building' }} token="tok" />,
    )
    expect(container.textContent).toBe('')
  })
})
