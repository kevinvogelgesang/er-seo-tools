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
  displayName: 'Acme College',
  csmName: null,
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  stage: 'building',
  stageLabel: 'Now Building',
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

  it('features the assigned flagged CSM, links their mailbox, and filters them out of the ordinary grid', () => {
    const data = base({
      // kickoff (not building) so this normal section is expanded — in the
      // sticky-header model `building` opens only milestones+materials, and a
      // collapsed region is aria-hidden/inert (invisible to getByRole).
      stage: 'kickoff',
      csmName: 'Casey CSM',
      global: {
        team: [
          { name: 'Casey CSM', role: 'Client Success Manager', photo: 'casey.png', blurb: 'Your guide.', isCsm: true, email: 'casey@example.com' },
          { name: 'Dana Designer', role: 'Designer', photo: null, blurb: 'Designs.' },
        ],
        blocks: {},
      },
    })
    const { container } = render(<WelcomeSection section={sec('welcome')} data={data} token="tok" />)
    expect(screen.getByText('Your ER contact')).toBeDefined()
    expect(screen.getAllByText('Casey CSM')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'casey@example.com' }).getAttribute('href')).toBe('mailto:casey@example.com')
    expect(screen.getByAltText('Casey CSM').getAttribute('src')).toBe('/api/viewbook/tok/assets/casey.png')
    expect(screen.getByText('Dana Designer')).toBeDefined()
    const headings = [...container.querySelectorAll('h3')].map((node) => node.textContent)
    expect(headings.indexOf('Your ER contact')).toBeLessThan(headings.indexOf('Your team'))
  })

  it('hides a dangling CSM card while keeping the ordinary team grid', () => {
    render(<WelcomeSection section={sec('welcome')} data={base({
      csmName: 'Former CSM',
      global: { team: [{ name: 'Dana Designer', role: 'Designer', photo: null, blurb: '' }], blocks: {} },
    })} token="tok" />)
    expect(screen.queryByText('Your ER contact')).toBeNull()
    expect(screen.getByText('Dana Designer')).toBeDefined()
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
      // kickoff so this normal section is expanded (see note above): a
      // collapsed region's links are aria-hidden and excluded from getByRole.
      stage: 'kickoff',
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
    const kickoff = base({ stage: 'kickoff', csmName: 'Kevin' })
    const building = base({ stage: 'building', csmName: 'Kevin' })
    const { rerender } = render(
      <KickoffNextSection isOperator section={sec('kickoff-next')} data={kickoff} token="tok" />,
    )
    expect(screen.getByText('Ready for the next step?')).toBeDefined()
    // v2 SectionShell adds a summary-row toggle button; target the CTA by name.
    expect(screen.getByRole('button', { name: 'Move to Website Specifics' })).toBeDefined()
    rerender(<KickoffNextSection isOperator section={sec('kickoff-next')} data={building} token="tok" />)
    expect(screen.queryByText('Ready for the next step?')).toBeNull()
  })

  it('renders named and neutral client contact copy', () => {
    const named = base({ stage: 'kickoff', csmName: 'Kevin' })
    const neutral = base({ stage: 'kickoff', csmName: null })
    const { rerender } = render(
      <KickoffNextSection isOperator={false} section={sec('kickoff-next')} data={named} token="tok" />,
    )
    expect(screen.getByText(/Reach out to Kevin/)).toBeDefined()
    rerender(<KickoffNextSection isOperator={false} section={sec('kickoff-next')} data={neutral} token="tok" />)
    expect(screen.getByText(/Reach out to your Enrollment Resources contact/)).toBeDefined()
  })

  it('honors the shared SectionShell contract: anchor id, done-state stays expanded (toggle disabled), and introNote', () => {
    const data = base({ stage: 'kickoff', csmName: 'Kevin' })

    // Anchor id present for ProgressNav's #kickoff-next scroll target.
    const { container, rerender } = render(
      <KickoffNextSection isOperator section={sec('kickoff-next')} data={data} token="tok" />,
    )
    expect(container.querySelector('#kickoff-next')).not.toBeNull()

    // introNote renders when set.
    rerender(
      <KickoffNextSection
        isOperator
        section={sec('kickoff-next', { introNote: 'One more thing before we move on.' })}
        data={data}
        token="tok"
      />,
    )
    expect(screen.getByText('One more thing before we move on.')).toBeDefined()

    // done-state mounts as the v2 reveal region, but with the per-section
    // toggle disabled (SECTION_TOGGLE_ENABLED = false) it renders EXPANDED
    // like every other section — there is no control left to reopen a
    // collapsed one, so nothing may start collapsed. Body retained in the
    // DOM, title (header band) still visible.
    cleanup()
    const { container: doneContainer } = render(
      <KickoffNextSection
        isOperator
        section={sec('kickoff-next', { state: 'done', doneAt: '2026-07-16T00:00:00.000Z' })}
        data={data}
        token="tok"
      />,
    )
    const region = doneContainer.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('data-vb-expanded')).toBe('true')
    expect(screen.getByText(/Completed/)).toBeDefined()
    // Title now appears twice — header band + the generic summary face's
    // eyebrow (PR7 Task 6) — so this is no longer a single-match assertion.
    expect(screen.getAllByText('Next Steps').length).toBeGreaterThan(0)
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
