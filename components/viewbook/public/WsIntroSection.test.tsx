// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { WsIntroSection } from './WsIntroSection'

afterEach(cleanup)

const baseSection: PublicSection = {
  sectionKey: 'ws-intro',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

function data(stage: string): ViewbookPublicData {
  return {
    clientName: 'Acme',
    kind: 'upgrade',
    welcomeNote: null,
    dataLockedAt: null,
    theme: DEFAULT_THEME,
    stage,
    stageLabel: 'Website Specifics',
    primarySections: [],
    carriedSections: [],
    fieldCategories: [],
    milestones: [],
    materials: [],
    global: { team: null, blocks: {} },
    overrides: {},
  } as unknown as ViewbookPublicData
}

describe('WsIntroSection', () => {
  it('renders the website-specifics hero title in that stage', () => {
    const { container } = render(
      <WsIntroSection section={{ ...baseSection }} data={data('website-specifics')} token="t" />,
    )
    expect(container.textContent).toContain('Website Specifics')
  })

  it('renders the code-owned lead paragraph', () => {
    const { container } = render(
      <WsIntroSection section={{ ...baseSection }} data={data('website-specifics')} token="t" />,
    )
    expect(container.textContent).toMatch(/look and feel/i)
  })

  it('returns null outside website-specifics (defensive gate)', () => {
    const { container } = render(
      <WsIntroSection section={{ ...baseSection }} data={data('building')} token="t" />,
    )
    expect(container.firstChild).toBeNull()
  })
})
