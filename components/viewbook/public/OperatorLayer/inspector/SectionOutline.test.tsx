// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { OperatorSectionData, OperatorViewbookData } from '@/lib/viewbook/operator-data'
import { DEFAULT_THEME, type SectionKey } from '@/lib/viewbook/theme'
import { navigateToAnchor } from '@/components/viewbook/public/viewbook-navigate'
import * as selectionContext from './SelectionContext'
import { SectionOutline, buildOutlineRows } from './SectionOutline'

vi.mock('@/components/viewbook/public/viewbook-navigate', () => ({ navigateToAnchor: vi.fn() }))

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

function section(
  sectionKey: SectionKey,
  state: OperatorSectionData['state'] = 'active',
  acknowledgedAt: string | null = null,
): OperatorSectionData {
  return { sectionKey, state, doneAt: null, acknowledgedAt, introNote: null, narrative: null }
}

function operatorData(sections: OperatorSectionData[]): OperatorViewbookData {
  return {
    theme: DEFAULT_THEME,
    sections,
    fields: [],
    milestones: [],
    docs: { global: [], own: [] },
    welcomeNote: null,
    dataLockedAt: null,
    dataLockedBy: null,
    pcCompletedAt: null,
    clientNotifyEmails: [],
    teamMembers: [],
  }
}

const ALL_SECTIONS: OperatorSectionData[] = [
  section('welcome'),
  section('milestones'),
  section('data-source'),
  section('brand'),
  section('assessment'),
  section('strategy'),
  section('materials'),
  section('pc-intro'),
  section('pc-setup'),
  section('pc-invite'),
  section('pc-thanks'),
  section('kickoff-next'),
  section('ws-intro'),
]

describe('buildOutlineRows', () => {
  it('keeps building primary and carried order, reinserting hidden rows in place', () => {
    const data = operatorData(ALL_SECTIONS.map((row) =>
      row.sectionKey === 'data-source' ? { ...row, state: 'hidden' } : row,
    ))

    const rows = buildOutlineRows(data, 'building', '2026-07-18T00:00:00.000Z')

    expect(rows.map(({ sectionKey, group }) => [sectionKey, group])).toEqual([
      ['welcome', 'primary'],
      ['milestones', 'primary'],
      ['data-source', 'primary'],
      ['brand', 'primary'],
      ['assessment', 'primary'],
      ['strategy', 'primary'],
      ['materials', 'primary'],
      ['pc-setup', 'carried'],
      ['pc-invite', 'carried'],
    ])
    expect(rows.find((row) => row.sectionKey === 'data-source')?.state).toBe('hidden')
    expect(rows.some((row) => row.group === 'future')).toBe(false)
  })

  it('gates pc-thanks and emits later-stage keys once at their earliest occurrence', () => {
    const data = operatorData(ALL_SECTIONS)

    const beforeCompletion = buildOutlineRows(data, 'post-contract', null)
    const afterCompletion = buildOutlineRows(data, 'post-contract', '2026-07-18T00:00:00.000Z')

    expect(beforeCompletion.some((row) => row.sectionKey === 'pc-thanks')).toBe(false)
    expect(afterCompletion.find((row) => row.sectionKey === 'pc-thanks')?.group).toBe('primary')
    expect(beforeCompletion.filter((row) => row.group === 'future').map((row) => row.sectionKey)).toEqual([
      'welcome',
      'milestones',
      'strategy',
      'kickoff-next',
      'ws-intro',
      'brand',
      'assessment',
      'materials',
    ])
  })

  it('does not repeat a current kickoff key when it is carried in a later stage', () => {
    const rows = buildOutlineRows(operatorData(ALL_SECTIONS), 'kickoff', null)

    expect(rows.filter((row) => row.sectionKey === 'welcome')).toHaveLength(1)
    expect(rows.find((row) => row.sectionKey === 'welcome')?.group).toBe('primary')
    expect(rows.filter((row) => row.group === 'future').map((row) => row.sectionKey)).toEqual([
      'ws-intro',
      'brand',
      'assessment',
      'materials',
    ])
  })

  it('omits a DB key absent from the current and all later lineups', () => {
    const rows = buildOutlineRows(operatorData([section('pc-intro')]), 'building', null)

    expect(rows).toEqual([])
  })

  it('maps state, acknowledgement, and title from the frozen sources', () => {
    const rows = buildOutlineRows(
      operatorData([section('welcome', 'done', '2026-07-18T00:00:00.000Z')]),
      'building',
      null,
    )

    expect(rows).toEqual([{
      sectionKey: 'welcome',
      title: 'Welcome & Team',
      state: 'done',
      acknowledged: true,
      group: 'primary',
    }])
  })
})

describe('SectionOutline', () => {
  it('renders grouped rows with titles, state pills, acknowledgement, and current markers', () => {
    const data = operatorData([
      section('welcome'),
      section('pc-setup', 'hidden', '2026-07-18T00:00:00.000Z'),
      section('kickoff-next', 'done'),
      section('ws-intro'),
    ])

    const { container } = render(
      <SectionOutline operatorData={data} stage="kickoff" pcCompletedAt={null} viewbookId={17} />,
    )

    expect(screen.getByRole('navigation', { name: 'Section outline' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Welcome & Team' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set Up Your Onboarding Viewbook' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next Steps' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Website Specifics' })).toBeTruthy()
    expect(screen.getAllByText('Visible')).toHaveLength(2)
    expect(screen.getByText('Hidden')).toBeTruthy()
    expect(screen.getByText('Complete')).toBeTruthy()
    expect(screen.getByText('Acknowledged')).toBeTruthy()

    expect(container.querySelector('[data-outline-group="primary"]')).toBeTruthy()
    expect(container.querySelector('[data-outline-group="carried"]')).toBeTruthy()
    expect(container.querySelector('[data-outline-group="future"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-vb-current-stage="true"]')).toHaveLength(3)
    expect(container.querySelector('[data-section-key="ws-intro"]')?.getAttribute('data-vb-current-stage')).toBe('false')
  })

  it('filters by title case-insensitively, restores on clear, and shows a no-match state', () => {
    const data = operatorData([
      section('welcome'),
      section('brand'),
      section('materials'),
    ])
    render(<SectionOutline operatorData={data} stage="building" pcCompletedAt={null} viewbookId={17} />)
    const search = screen.getByRole('searchbox', { name: 'Search sections' })

    fireEvent.change(search, { target: { value: 'BRAND' } })
    expect(screen.getByRole('button', { name: 'Brand Guidelines' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Welcome & Team' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Materials & Links' })).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Welcome & Team' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Materials & Links' })).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not a real section' } })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('No sections match your search.')).toBeTruthy()
  })

  it('selects and navigates visible and hidden rows without owning visibility mutations', () => {
    const select = vi.fn(() => true)
    vi.spyOn(selectionContext, 'useSelectionContext').mockReturnValue({
      selectedKey: null,
      selectedGroup: null,
      select,
      observe: vi.fn(),
      release: vi.fn(),
      isPinned: false,
      pinnedKey: null,
      pinnedKind: null,
    })
    const data = operatorData([
      section('welcome'),
      section('data-source', 'hidden'),
    ])
    const { container } = render(
      <SectionOutline operatorData={data} stage="building" pcCompletedAt={null} viewbookId={17} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Welcome & Team' }))
    expect(select).toHaveBeenCalledWith('welcome', 'manual-nav')
    expect(navigateToAnchor).toHaveBeenCalledWith('welcome', '#welcome')

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'What we need from you' }))).not.toThrow()
    expect(select).toHaveBeenCalledWith('data-source', 'manual-nav', 'status')
    expect(navigateToAnchor).toHaveBeenCalledWith('data-source', '#data-source')
    expect(container.querySelector('[data-operator-section-controls]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
  })
})
