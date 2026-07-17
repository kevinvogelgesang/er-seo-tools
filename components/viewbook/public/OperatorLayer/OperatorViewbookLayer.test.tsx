// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { OperatorViewbookLayer } from './OperatorViewbookLayer'

const visible: PublicSection = {
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
  sections: [
    { ...visible, state: 'active' },
    {
      sectionKey: 'strategy', state: 'hidden', doneAt: null, acknowledgedAt: null,
      introNote: null, narrative: null,
    },
  ],
  fields: [],
  milestones: [],
  docs: { global: [], own: [] },
  pcCompletedAt: null,
  clientNotifyEmails: [],
  teamMembers: [],
}

let stored: string | null

beforeEach(() => {
  stored = null
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderLayer() {
  return render(
    <OperatorViewbookLayer
      viewbookId={22}
      operatorEmail="operator@example.com"
      stage="kickoff"
      pcCompletedAt={null}
      operatorData={operatorData}
      renderSection={(section) => <div>Public {section.sectionKey}</div>}
      renderViewbook={(renderSection) => <main>{renderSection(visible)}</main>}
    />,
  )
}

describe('OperatorViewbookLayer', () => {
  it('integrates the bar, wrapped section controls, and hidden-section restore list', async () => {
    const { container } = renderLayer()
    expect(await screen.findByText('ER editing')).toBeTruthy()
    expect(screen.getByText('Public welcome')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy()
    expect(screen.getByText('Hidden sections')).toBeTruthy()
    expect(screen.getByText('strategy')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy()
    expect(container.innerHTML.includes('dark' + ':')).toBe(false)
  })

  it('renders public content but no operator layer when persisted presentation mode is ON', async () => {
    stored = 'true'
    const { container } = renderLayer()
    expect(await screen.findByRole('button', { name: 'Show editing controls' })).toBeTruthy()
    expect(screen.getByText('Public welcome')).toBeTruthy()
    expect(container.querySelector('[data-operator-bar]')).toBeNull()
    expect(container.querySelector('[data-operator-section-wrapper]')).toBeNull()
    expect(screen.queryByText('Hidden sections')).toBeNull()
  })
})
