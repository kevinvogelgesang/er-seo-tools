// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { defaultMeta } from './section-test-meta'
import { WelcomeSection } from './WelcomeSection'

afterEach(cleanup)

const section: PublicSection = {
  sectionKey: 'welcome',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

function data(overrides: Partial<ViewbookPublicData> = {}): ViewbookPublicData {
  return {
    viewbookId: 42,
    clientName: 'Acme College',
    displayName: 'Acme College',
    csmName: null,
    kind: 'upgrade',
    welcomeNote: 'Welcome, Acme.',
    dataLockedAt: null,
    theme: DEFAULT_THEME,
    stage: 'kickoff',
    stageLabel: 'Kickoff',
    syncVersion: 1,
    pcCompletedAt: null,
    clientNotifyJson: [],
    teamMembers: [],
    primarySections: [],
    carriedSections: [],
    fieldCategories: [],
    milestones: [],
    materials: [],
    docs: { global: [], own: [] },
    global: { team: null, pcIntro: null, blocks: {} },
    overrides: {},
    ...overrides,
  }
}

describe('WelcomeSection editorial cards', () => {
  it('renders Philosophy, Credentials, Contact, Team, and Process in order from their owned sources', () => {
    const fixture = data({
      csmName: 'Casey CSM',
      global: {
        pcIntro: null,
        team: [
          {
            name: 'Casey CSM',
            role: 'Client Success Manager',
            photo: null,
            blurb: 'Your guide.',
            isCsm: true,
            email: 'casey@example.com',
          },
          { name: 'Dana Designer', role: 'Designer', photo: null, blurb: 'Builds thoughtful sites.' },
        ],
        blocks: {
          why: { blocks: [{ heading: 'Why ER', body: 'Enrollment should feel human.' }] },
          process: { blocks: [{ heading: 'How we work', body: 'We learn, build, and improve together.' }] },
        },
      },
    })

    const { container } = render(
      <WelcomeSection meta={defaultMeta()} section={section} data={fixture} token="tok" />,
    )
    const cards = [...container.querySelectorAll('[data-vb-welcome-card]')]

    expect(cards.map((card) => card.getAttribute('data-vb-welcome-card'))).toEqual([
      'philosophy',
      'credentials',
      'contact',
      'team',
      'process',
    ])
    expect(cards[0].textContent).toContain('Philosophy')
    expect(cards[0].textContent).toContain('Enrollment should feel human.')
    expect(cards[1].textContent).toContain('Credentials')
    expect(cards[1].textContent).toContain('Enrollment Resources')
    expect(cards[2].textContent).toContain('Contact')
    expect(cards[2].textContent).toContain('Casey CSM')
    expect(cards[3].textContent).toContain('Team')
    expect(cards[3].textContent).toContain('Dana Designer')
    expect(cards[4].textContent).toContain('Process')
    expect(cards[4].textContent).toContain('We learn, build, and improve together.')
  })

  it('keeps all five labeled cards and friendly placeholders when optional content is absent', () => {
    const { container } = render(
      <WelcomeSection meta={defaultMeta()} section={section} data={data()} token="tok" />,
    )
    const cards = [...container.querySelectorAll<HTMLElement>('[data-vb-welcome-card]')]

    expect(cards).toHaveLength(5)
    expect(cards.find((card) => card.dataset.vbWelcomeCard === 'philosophy')?.textContent).toContain('coming soon')
    expect(cards.find((card) => card.dataset.vbWelcomeCard === 'contact')?.textContent).toContain('coming soon')
    expect(cards.find((card) => card.dataset.vbWelcomeCard === 'team')?.textContent).toContain('coming soon')
    expect(cards.find((card) => card.dataset.vbWelcomeCard === 'process')?.textContent).toContain('coming soon')
  })
})
