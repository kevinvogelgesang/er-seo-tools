// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicField, PublicFieldCategory, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { PcSetupSection } from './PcSetupSection'

afterEach(cleanup)

const section: PublicSection = {
  sectionKey: 'pc-setup',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

function field(over: Partial<PublicField>): PublicField {
  return {
    id: 1,
    defKey: null,
    label: 'Field',
    fieldType: 'text',
    value: null,
    version: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    valueUpdatedBy: null,
    valueUpdatedAt: null,
    isCustom: false,
    amendments: [],
    ...over,
  }
}

const schoolCategory: PublicFieldCategory = {
  category: 'school',
  fields: [
    field({ id: 1, defKey: 'school-name', label: 'School name', value: 'Pro Way' }),
    field({ id: 2, defKey: 'school-contact-name', label: 'Primary contact name' }),
    field({ id: 3, defKey: 'school-contact-email', label: 'Primary contact email', value: 'contact@example.com' }),
    field({ id: 4, defKey: 'school-phone', label: 'Main phone number' }),
    field({ id: 5, defKey: 'school-website', label: 'Website URL' }),
    field({ id: 6, defKey: 'school-services', label: 'Services in your subscription', fieldType: 'list' }),
  ],
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
    fieldCategories: [schoolCategory],
    milestones: [],
    materials: [],
    global: { team: null, pcIntro: null, blocks: {} },
    overrides: {},
    ...over,
  } as unknown as ViewbookPublicData
}

describe('PcSetupSection', () => {
  it('renders the pc-setup title in post-contract', () => {
    const { container } = render(<PcSetupSection section={section} data={data()} token="t" />)
    expect(container.textContent).toContain('Set Up Your Viewbook')
  })

  it('surfaces the PC_SETUP_DEF_KEYS labels, in order, and excludes non-designated fields', () => {
    render(<PcSetupSection section={section} data={data()} token="t" />)
    expect(screen.getByText('School name')).toBeDefined()
    expect(screen.getByText('Primary contact name')).toBeDefined()
    expect(screen.getByText('Primary contact email')).toBeDefined()
    expect(screen.getByText('Main phone number')).toBeDefined()
    expect(screen.getByText('Website URL')).toBeDefined()
    expect(screen.queryByText('Services in your subscription')).toBeNull()
  })

  it('shows the ack action only in post-contract', () => {
    const { rerender } = render(<PcSetupSection section={section} data={data()} token="t" />)
    expect(screen.getByRole('button', { name: /looks good/i })).toBeDefined()
    rerender(<PcSetupSection section={section} data={data({ stage: 'kickoff' })} token="t" />)
    expect(screen.queryByRole('button', { name: /looks good/i })).toBeNull()
  })

  it('renders in a carried stage (kickoff) without hard-gating to post-contract', () => {
    const { container } = render(<PcSetupSection section={section} data={data({ stage: 'kickoff' })} token="t" />)
    expect(container.textContent).toContain('Set Up Your Viewbook')
    expect(screen.getByText('School name')).toBeDefined()
  })

  it('offers the primary-contact email as a notify candidate derived from the answer value', () => {
    render(<PcSetupSection section={section} data={data()} token="t" />)
    expect(screen.getByText('Primary contact (contact@example.com)')).toBeDefined()
  })
})
