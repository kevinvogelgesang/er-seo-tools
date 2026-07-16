// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { WelcomeSection } from './WelcomeSection'
import { BrandSection } from './BrandSection'
import { StrategySection } from './StrategySection'
import { MaterialsSection } from './MaterialsSection'
import { MilestonesSection } from './MilestonesSection'
import { KickoffNextSection } from './KickoffNextSection'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

afterEach(cleanup)

const sec = (sectionKey: PublicSection['sectionKey'], over: Partial<PublicSection> = {}): PublicSection => ({
  sectionKey,
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
  ...over,
})

const base = (over: Partial<ViewbookPublicData> = {}): ViewbookPublicData => ({
  viewbookId: 42,
  clientName: 'Acme College',
  csmName: null,
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  stage: 'building',
  stageLabel: 'Now Building',
  primarySections: [],
  carriedSections: [],
  fieldCategories: [],
  milestones: [],
  materials: [],
  docs: { global: [], own: [] },
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

  it('renders global then own doc cards with safe links/text before one collapsed full playbook', () => {
    const hostile = '<img src=x>'
    const data = base({
      docs: {
        global: [
          { id: 1, title: 'Global guide', blurb: 'First', filename: 'global.pdf', sortOrder: 1 },
          { id: 2, title: hostile, blurb: null, filename: 'hostile.pdf', sortOrder: 2 },
        ],
        own: [{ id: 3, title: 'Acme extra', blurb: 'Custom', filename: 'own.pdf', sortOrder: 1 }],
      },
      global: { team: null, blocks: { 'seo-base': { blocks: [{ heading: 'Full', body: 'Long copy' }] } } },
    })
    const { container } = render(<StrategySection section={sec('strategy')} data={data} token="tok" />)
    const links = screen.getAllByRole('link', { name: 'Open PDF' })
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/api/viewbook/tok/assets/global.pdf',
      '/api/viewbook/tok/assets/hostile.pdf',
      '/api/viewbook/tok/assets/own.pdf',
    ])
    expect(links.every((link) => link.getAttribute('target') === '_blank')).toBe(true)
    expect(links.every((link) => link.getAttribute('rel') === 'noopener noreferrer')).toBe(true)
    expect(screen.getByText(hostile)).toBeDefined()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Read the full playbook').closest('details')?.hasAttribute('open')).toBe(false)
  })
})

describe('KickoffNextSection', () => {
  it('renders the operator CTA only during kickoff', () => {
    const { rerender } = render(
      <KickoffNextSection isOperator stage="kickoff" csmName="Kevin" viewbookId={42} />,
    )
    expect(screen.getByText('Ready for the next step?')).toBeDefined()
    expect(screen.getByRole('button')).toBeDefined()
    rerender(<KickoffNextSection isOperator stage="building" csmName="Kevin" viewbookId={42} />)
    expect(screen.queryByText('Ready for the next step?')).toBeNull()
  })

  it('renders named and neutral client contact copy', () => {
    const { rerender } = render(
      <KickoffNextSection isOperator={false} stage="kickoff" csmName="Kevin" viewbookId={42} />,
    )
    expect(screen.getByText(/Reach out to Kevin/)).toBeDefined()
    rerender(<KickoffNextSection isOperator={false} stage="kickoff" csmName={null} viewbookId={42} />)
    expect(screen.getByText(/Reach out to your Enrollment Resources contact/)).toBeDefined()
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
    expect(screen.getByRole('button', { name: 'Add link' })).toBeDefined()
  })

  it('renders a non-https material URL as plain text, never an anchor (security-review)', () => {
    const data = base({
      materials: [
        { id: 1, label: 'Sneaky', status: 'provided', url: 'javascript:alert(1)', addedBy: 'client', providedAt: null },
      ],
    })
    render(<MaterialsSection section={sec('materials')} data={data} token="tok" />)
    expect(screen.queryByRole('link', { name: /sneaky/i })).toBeNull()
    expect(screen.getByText('Sneaky')).toBeDefined()
  })
})

describe('MilestonesSection', () => {
  it('renders one feedback form per review link and seeds each thread', () => {
    const data = base({
      milestones: [{
        id: 1,
        title: 'Design',
        blurb: null,
        status: 'current',
        targetDate: null,
        doneAt: null,
        reviewLinks: [
          {
            id: 10,
            label: 'Homepage mockup',
            url: 'https://example.com/home',
            kind: 'mockup',
            feedback: [{
              id: 100,
              body: 'Make the headline warmer.',
              authorName: 'Alex',
              authorKind: 'client',
              resolvedAt: null,
              createdAt: '2026-07-15T00:00:00.000Z',
            }],
          },
          {
            id: 11,
            label: 'Programs mockup',
            url: 'https://example.com/programs',
            kind: 'mockup',
            feedback: [],
          },
        ],
      }],
    })

    render(<MilestonesSection section={sec('milestones')} data={data} token="tok" />)

    expect(screen.getAllByRole('button', { name: 'Send feedback' })).toHaveLength(2)
    expect(screen.getByText('Make the headline warmer.')).toBeDefined()
  })
})
