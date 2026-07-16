// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { WelcomeSection } from './WelcomeSection'
import { BrandSection } from './BrandSection'
import { StrategySection } from './StrategySection'
import { MaterialsSection } from './MaterialsSection'

afterEach(cleanup)

const sec = (sectionKey: PublicSection['sectionKey'], over: Partial<PublicSection> = {}): PublicSection => ({
  sectionKey,
  state: 'active',
  doneAt: null,
  introNote: null,
  narrative: null,
  ...over,
})

const base = (over: Partial<ViewbookPublicData> = {}): ViewbookPublicData => ({
  clientName: 'Acme College',
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  sections: [],
  fieldCategories: [],
  milestones: [],
  materials: [],
  global: { team: null, blocks: {} },
  overrides: {},
  ...over,
})

describe('WelcomeSection', () => {
  it('renders welcome note, team roster, and degrades to a placeholder without global content', () => {
    const data = base({
      welcomeNote: 'Hi Acme!',
      global: {
        team: [{ name: 'Kev', role: 'SEO Lead', photo: null, blurb: 'Does SEO' }],
        blocks: { why: { blocks: [{ heading: 'Why', body: 'Because.' }] } },
      },
    })
    render(<WelcomeSection section={sec('welcome')} data={data} token="tok" />)
    expect(screen.getByText('Hi Acme!')).toBeDefined()
    expect(screen.getByText('Kev')).toBeDefined()
    expect(screen.getByText('Because.')).toBeDefined()

    cleanup()
    render(<WelcomeSection section={sec('welcome')} data={base()} token="tok" />)
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThan(0)
  })
})

describe('BrandSection', () => {
  it('renders the three swatches with hex labels and the narrative prose', () => {
    render(
      <BrandSection section={sec('brand', { narrative: 'Bold and warm.' })} data={base()} token="tok" />,
    )
    expect(screen.getByText('#122033')).toBeDefined()
    expect(screen.getByText('Bold and warm.')).toBeDefined()
  })
})

describe('StrategySection', () => {
  it('renders base blocks and visually-distinct override blocks', () => {
    const data = base({
      global: {
        team: null,
        blocks: { 'seo-base': { blocks: [{ heading: 'Playbook', body: 'Do SEO well.' }] } },
      },
      overrides: { 'seo-base': 'Your custom plan.' },
    })
    render(<StrategySection section={sec('strategy')} data={data} token="tok" />)
    expect(screen.getByText('Do SEO well.')).toBeDefined()
    expect(screen.getByText('Your custom plan.')).toBeDefined()
    expect(screen.getByText(/your plan/i)).toBeDefined()
  })
})

describe('MaterialsSection', () => {
  it('renders provided links with noopener and requested placeholders without an anchor', () => {
    const data = base({
      materials: [
        { id: 1, label: 'Brand book', status: 'provided', url: 'https://x.com/b', addedBy: 'client', providedAt: '2026-07-01T00:00:00.000Z' },
        { id: 2, label: 'Logo files', status: 'requested', url: null, addedBy: 'kevin@er.com', providedAt: null },
      ],
    })
    render(<MaterialsSection section={sec('materials')} data={data} token="tok" />)
    const a = screen.getByRole('link', { name: /brand book/i })
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('Logo files')).toBeDefined()
    expect(screen.queryByRole('link', { name: /logo files/i })).toBeNull()
  })
})
