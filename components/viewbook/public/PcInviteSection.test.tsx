// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, PublicTeamMember, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { PcInviteSection } from './PcInviteSection'

afterEach(cleanup)

const section: PublicSection = {
  sectionKey: 'pc-invite',
  state: 'active',
  collapsedShared: false,
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

const invitedMember: PublicTeamMember = { id: 1, memberKey: 'k1', name: 'Pat', email: 'pat@example.com', invited: true }
const uninvitedMember: PublicTeamMember = { id: 2, memberKey: 'k2', name: 'Sam', email: 'sam@example.com', invited: false }

describe('PcInviteSection', () => {
  it('renders the pc-invite title in post-contract', () => {
    const { container } = render(<PcInviteSection section={section} data={data()} token="t" />)
    expect(container.textContent).toContain('Invite Your Team')
  })

  it('renders the team list with "Invite requested" for invited members, NEVER "Sent" (Codex fix 7)', () => {
    render(<PcInviteSection section={section} data={data({ teamMembers: [invitedMember] })} token="t" />)
    expect(screen.getByText('Pat')).toBeDefined()
    expect(screen.getByText('pat@example.com')).toBeDefined()
    expect(screen.getByText('Invite requested')).toBeDefined()
    expect(screen.queryByText(/^Sent$/i)).toBeNull()
  })

  it('renders a distinct status for a not-yet-invited member', () => {
    render(<PcInviteSection section={section} data={data({ teamMembers: [uninvitedMember] })} token="t" />)
    expect(screen.queryByText('Invite requested')).toBeNull()
    expect(screen.getByText(/pending/i)).toBeDefined()
  })

  it('shows the ≤15 note and the empty state when no one is invited', () => {
    render(<PcInviteSection section={section} data={data()} token="t" />)
    expect(screen.getByText(/0 of 15 invited/)).toBeDefined()
    expect(screen.getByText(/no one has been invited yet/i)).toBeDefined()
  })

  it('shows the ack action only in post-contract', () => {
    const { rerender } = render(<PcInviteSection section={section} data={data()} token="t" />)
    expect(screen.getByRole('button', { name: /looks good/i })).toBeDefined()
    rerender(<PcInviteSection section={section} data={data({ stage: 'building' })} token="t" />)
    expect(screen.queryByRole('button', { name: /looks good/i })).toBeNull()
  })

  it('renders in a carried stage (building) without hard-gating to post-contract', () => {
    const { container } = render(
      <PcInviteSection section={section} data={data({ stage: 'building', teamMembers: [invitedMember] })} token="t" />,
    )
    expect(container.textContent).toContain('Invite Your Team')
    expect(screen.getByText('Pat')).toBeDefined()
  })
})
