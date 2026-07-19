// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { OperatorViewbookLayer } from './OperatorViewbookLayer'
import { OperatorSectionWrapper } from './OperatorSectionWrapper'
import { useSelectionContext } from './inspector'

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

// P1 (Codex PR8 review): the layer's interface is now ALL-serializable — the
// section tree is composed SERVER-SIDE and handed in as `children` (a
// ReactNode), never as function props. This harness mirrors that composition:
// the per-section OperatorSectionWrapper islands live INSIDE `children`.
function renderLayer() {
  return render(
    <OperatorViewbookLayer
      viewbookId={22}
      operatorEmail="operator@example.com"
      stage="kickoff"
      pcCompletedAt={null}
      operatorData={operatorData}
    >
      <main>
        <OperatorSectionWrapper
          sectionKey="welcome"
          viewbookId={22}
          section={operatorData.sections[0]}
          operatorData={operatorData}
          pcCompletedAt={null}
        >
          <div>Public welcome</div>
        </OperatorSectionWrapper>
      </main>
    </OperatorViewbookLayer>,
  )
}

describe('OperatorViewbookLayer', () => {
  it('integrates the bar, wrapped section controls, and hidden-section restore list', async () => {
    const { container } = renderLayer()
    expect(await screen.findByText('ER editing')).toBeTruthy()
    expect(screen.getByText('Public welcome')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy()
    expect(screen.getByText('Hidden sections')).toBeTruthy()
    expect(screen.getByText('SEO, GEO & E-E-A-T Strategy')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy()
    expect(container.innerHTML.includes('dark' + ':')).toBe(true)
  })

  it('renders public content but no operator layer when persisted presentation mode is ON', async () => {
    stored = 'true'
    const { container } = renderLayer()
    expect(await screen.findByRole('button', { name: 'Return to editing' })).toBeTruthy()
    expect(screen.getByText('Public welcome')).toBeTruthy()
    expect(container.querySelector('[data-operator-bar]')).toBeNull()
    expect(container.querySelector('[data-operator-section-wrapper]')).toBeNull()
    expect(screen.queryByText('Hidden sections')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('renders the inspector rail in edit mode', async () => {
    const { container } = renderLayer()
    await screen.findByText('ER editing')
    expect(container.querySelector('[data-vb-inspector]')).toBeTruthy()
  })

  it('renders NO inspector while presenting, but the providers still wrap children', async () => {
    stored = 'true'
    const { container } = renderLayer()
    await screen.findByRole('button', { name: 'Return to editing' })
    expect(container.querySelector('[data-vb-inspector]')).toBeNull()
  })

  it('providers remain available to children while presenting', async () => {
    stored = 'true'
    function SelectionProbe() {
      const s = useSelectionContext()
      return (
        <button onClick={() => s.select('brand', 'manual-nav')} data-testid="probe">
          {s.selectedKey ?? 'none'}
        </button>
      )
    }
    render(
      <OperatorViewbookLayer
        viewbookId={22}
        operatorEmail="operator@example.com"
        stage="kickoff"
        pcCompletedAt={null}
        operatorData={operatorData}
      >
        <SelectionProbe />
      </OperatorViewbookLayer>,
    )
    const probe = await screen.findByTestId('probe')
    expect(probe.textContent).toBe('none')
    act(() => probe.click())
    expect(probe.textContent).toBe('brand') // real provider present despite presentation mode
  })
})
