// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { OperatorSectionData, OperatorViewbookData } from '@/lib/viewbook/operator-data'
import { OperatorSectionWrapper } from './OperatorSectionWrapper'

afterEach(cleanup)

const section: OperatorSectionData = {
  sectionKey: 'welcome',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

const operatorData: OperatorViewbookData = {
  welcomeNote: 'Hello',
  dataLockedAt: null,
  dataLockedBy: null,
  theme: DEFAULT_THEME,
  sections: [section],
  fields: [],
  milestones: [],
  docs: { global: [], own: [] },
  pcCompletedAt: null,
  clientNotifyEmails: [],
  teamMembers: [],
}

describe('OperatorSectionWrapper', () => {
  it('renders the real section plus quick controls and inline editors for an operator', () => {
    const { container } = render(
      <OperatorSectionWrapper
        sectionKey="welcome"
        viewbookId={3}
        section={section}
        operatorData={operatorData}
        pcCompletedAt={null}
      >
        <div>Real public section</div>
      </OperatorSectionWrapper>,
    )
    expect(screen.getByText('Real public section')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy()
    expect(screen.getByText('Edit welcome note')).toBeTruthy()
    expect(container.innerHTML.includes('dark' + ':')).toBe(false)
  })

  it('renders children only when told the viewer is not an operator', () => {
    const { container } = render(
      <OperatorSectionWrapper
        sectionKey="welcome"
        viewbookId={3}
        section={section}
        operatorData={operatorData}
        pcCompletedAt={null}
        isOperator={false}
      >
        <div>Anonymous section</div>
      </OperatorSectionWrapper>,
    )
    expect(screen.getByText('Anonymous section')).toBeTruthy()
    expect(container.querySelector('[data-operator-section-wrapper]')).toBeNull()
    expect(container.querySelector('[data-operator-section-controls]')).toBeNull()
  })
})
