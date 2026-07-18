// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import { HiddenSectionsList } from './HiddenSectionsList'

afterEach(cleanup)

const operatorData: OperatorViewbookData = {
  welcomeNote: null,
  dataLockedAt: null,
  dataLockedBy: null,
  theme: DEFAULT_THEME,
  sections: [
    { sectionKey: 'welcome', state: 'active', doneAt: null, acknowledgedAt: null, introNote: null, narrative: null },
    { sectionKey: 'strategy', state: 'hidden', doneAt: null, acknowledgedAt: null, introNote: null, narrative: null },
    { sectionKey: 'pc-thanks', state: 'hidden', doneAt: null, acknowledgedAt: null, introNote: null, narrative: null },
  ],
  fields: [],
  milestones: [],
  docs: { global: [], own: [] },
  pcCompletedAt: null,
  clientNotifyEmails: [],
  teamMembers: [],
}

describe('HiddenSectionsList', () => {
  it('renders a visible dark-aware recovery card with readable embedded rows', () => {
    const { container } = render(
      <HiddenSectionsList viewbookId={12} operatorData={operatorData} pcCompletedAt={null} />,
    )
    const aside = container.querySelector('[data-operator-hidden-sections]')
    expect(screen.getByText('Hidden sections')).toBeTruthy()
    expect(screen.getByText('Hidden from the client view.')).toBeTruthy()
    expect(screen.getByText('SEO, GEO & E-E-A-T Strategy')).toBeTruthy()
    expect(screen.queryByText('strategy')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy()
    expect(container.querySelector('[data-operator-section-controls-variant="embedded"]')).toBeTruthy()
    expect(aside?.getAttribute('class')).toContain('bg-amber-50')
    expect(aside?.getAttribute('class')).toContain('dark:bg-amber-500/10')
  })

  it('renders nothing when no restorable section is hidden', () => {
    const { container } = render(
      <HiddenSectionsList
        viewbookId={12}
        operatorData={{ ...operatorData, sections: operatorData.sections.slice(0, 1) }}
        pcCompletedAt={null}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
