// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { defaultMeta } from './section-test-meta'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicMilestone, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { MilestonesSection } from './MilestonesSection'
import { DataSourceSection } from './DataSourceSection'

afterEach(cleanup)

const sec = (sectionKey: PublicSection['sectionKey']): PublicSection => ({
  sectionKey, state: 'active', doneAt: null, acknowledgedAt: null, introNote: null, narrative: null,
})

const base = (over: Partial<ViewbookPublicData> = {}): ViewbookPublicData => ({
  clientName: 'Acme', displayName: 'Acme', kind: 'upgrade', welcomeNote: null, dataLockedAt: null,
  theme: DEFAULT_THEME, stage: 'building', stageLabel: 'Now Building',
  pcCompletedAt: null, clientNotifyJson: [], teamMembers: [],
  primarySections: [], carriedSections: [], fieldCategories: [], milestones: [],
  materials: [], global: { team: null, pcIntro: null, blocks: {} }, overrides: {}, ...over,
} as unknown as ViewbookPublicData)

const milestone = (over: Partial<PublicMilestone> = {}): PublicMilestone => ({
  id: 1, title: 'Design', blurb: 'Designs take shape.', description: null, status: 'upcoming',
  targetDate: null, doneAt: null, reviewLinks: [], ...over,
})

describe('MilestonesSection', () => {
  it('spotlights the current stage and renders review links with noopener', () => {
    const data = base({
      milestones: [
        milestone({ id: 1, title: 'Kickoff', status: 'done', doneAt: '2026-06-01T00:00:00.000Z' }),
        milestone({
          id: 2, title: 'Design', status: 'current',
          reviewLinks: [{ id: 9, label: 'Homepage mockup', url: 'https://x.com/m', kind: 'mockup', feedback: [] }],
        }),
        milestone({ id: 3, title: 'Build', status: 'upcoming', targetDate: '2026-08-01T00:00:00.000Z' }),
      ],
    })
    render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
    expect(screen.getByText('Current stage')).toBeDefined()
    const a = screen.getByRole('link', { name: /homepage mockup/i })
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByText(/reviews will appear here/i)).toBeNull() // links exist → no empty state
    const reviewRegion = screen.getByRole('region', { name: 'Review & feedback' })
    expect(reviewRegion.className).toContain('border')
  })

  it('renders a non-https review-link URL as plain text, never an anchor (security-review)', () => {
    const data = base({
      milestones: [
        milestone({
          id: 2, title: 'Design', status: 'current',
          reviewLinks: [{ id: 9, label: 'Sneaky link', url: 'javascript:alert(1)', kind: 'mockup', feedback: [] }],
        }),
      ],
    })
    render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
    expect(screen.queryByRole('link', { name: /sneaky link/i })).toBeNull()
    expect(screen.getByText('Sneaky link')).toBeDefined()
  })

  it('renders the empty state when NO milestone has review links (separate fixture — Codex plan-fix 8)', () => {
    const data = base({
      milestones: [milestone({ id: 1, title: 'Kickoff', status: 'current' })],
    })
    render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
    expect(screen.getByText(/reviews will appear here/i)).toBeDefined()
  })

  it('keeps kickoff as a date overview and hides both review links and the no-links empty state', () => {
    const withReview = base({
      stage: 'kickoff',
      stageLabel: 'Kickoff',
      milestones: [milestone({
        id: 1,
        title: 'Kickoff',
        status: 'current',
        targetDate: '2026-08-01T00:00:00.000Z',
        reviewLinks: [{ id: 9, label: 'Homepage mockup', url: 'https://x.com/m', kind: 'mockup', feedback: [] }],
      })],
    })
    const { rerender } = render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={withReview} token="tok" />)
    expect(screen.getByText(/target: august 1, 2026/i)).toBeDefined()
    expect(screen.queryByRole('link', { name: /homepage mockup/i })).toBeNull()
    expect(screen.queryByText('Review & feedback')).toBeNull()

    rerender(
      <MilestonesSection meta={defaultMeta()}
        section={sec('milestones')}
        data={base({ stage: 'kickoff', stageLabel: 'Kickoff', milestones: [milestone({ status: 'current' })] })}
        token="tok"
      />,
    )
    expect(screen.queryByText(/reviews will appear here/i)).toBeNull()
  })

  it('renders a vertical list — no horizontal-scroll wrapper, no fixed-width cards', () => {
    const data = base({
      milestones: [
        milestone({ id: 1, title: 'Kickoff', status: 'done' }),
        milestone({ id: 2, title: 'Design', status: 'current' }),
      ],
    })
    const { container } = render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
    const cards = container.querySelectorAll('[id^="vb-milestone-"]')
    expect(cards.length).toBe(2)
    for (const card of cards) {
      expect(card.className).not.toContain('min-w-56')
      expect(card.className).not.toContain('overflow-x-auto')
      const wrapper = card.parentElement!
      expect(wrapper.className).not.toContain('overflow-x-auto')
    }
  })

  it('renders a milestone description under the blurb', () => {
    const data = base({
      milestones: [
        milestone({ id: 1, title: 'Design', status: 'current', description: 'Detailed design notes go here.' }),
      ],
    })
    render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
    expect(screen.getByText('Detailed design notes go here.')).toBeDefined()
  })

  it('omits the description paragraph when null', () => {
    const data = base({
      milestones: [milestone({ id: 1, title: 'Design', status: 'current', description: null })],
    })
    const { container } = render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
    expect(container.querySelector('[id="vb-milestone-1"] p.whitespace-pre-line')).toBeNull()
  })

  describe('process-milestones info block', () => {
    const oneMilestone = [milestone({ id: 1, title: 'Kickoff', status: 'current' })]

    it('renders the global default blocks when no override is set', () => {
      const data = base({
        milestones: oneMilestone,
        global: {
          team: null, pcIntro: null,
          blocks: { 'process-milestones': { blocks: [{ heading: 'How it works', body: 'Our standard process.' }] } },
        },
      })
      render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
      expect(screen.getByText('How it works')).toBeDefined()
      expect(screen.getByText('Our standard process.')).toBeDefined()
    })

    it('renders the override text when no global default is set', () => {
      const data = base({
        milestones: oneMilestone,
        overrides: { 'process-milestones': 'Your custom timeline plan.' },
      })
      render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
      expect(screen.getByText('Your custom timeline plan.')).toBeDefined()
    })

    it('renders both the default blocks AND the appended override when both are present', () => {
      const data = base({
        milestones: oneMilestone,
        global: {
          team: null, pcIntro: null,
          blocks: { 'process-milestones': { blocks: [{ heading: 'How it works', body: 'Our standard process.' }] } },
        },
        overrides: { 'process-milestones': 'Your custom timeline plan.' },
      })
      render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
      expect(screen.getByText('How it works')).toBeDefined()
      expect(screen.getByText('Our standard process.')).toBeDefined()
      expect(screen.getByText('Your custom timeline plan.')).toBeDefined()
    })

    it('renders no info-block heading when both blocks and override are empty', () => {
      const data = base({ milestones: oneMilestone })
      const { container } = render(<MilestonesSection meta={defaultMeta()} section={sec('milestones')} data={data} token="tok" />)
      expect(container.querySelector('#vb-process-milestones-info')).toBeNull()
    })
  })
})

describe('DataSourceSection', () => {
  it('groups by category with display labels, renders values/stamps/amendments, and a locked banner', () => {
    const data = base({
      dataLockedAt: '2026-07-10T00:00:00.000Z',
      fieldCategories: [
        {
          category: 'school',
          fields: [
            {
              id: 1, label: 'School name', fieldType: 'text', value: 'Pro Way',
              version: 1, createdAt: '2026-06-01T00:00:00.000Z',
              valueUpdatedBy: 'client', valueUpdatedAt: '2026-07-01T00:00:00.000Z', isCustom: false,
              amendments: [{ id: 1, value: 'Pro Way Hair School', author: 'client', createdAt: '2026-07-11T00:00:00.000Z' }],
            },
            {
              id: 2, label: 'Services in your subscription', fieldType: 'list',
              value: '["SEO","ADA"]', version: 0, createdAt: '2026-06-01T00:00:00.000Z',
              valueUpdatedBy: null, valueUpdatedAt: null, isCustom: false, amendments: [],
            },
          ],
        },
      ],
    })
    render(<DataSourceSection meta={defaultMeta()} section={sec('data-source')} data={data} token="tok" />)
    expect(screen.getByText('Your school')).toBeDefined()
    expect(screen.getByText('Pro Way')).toBeDefined()
    expect(screen.getByText(/updated by you/i)).toBeDefined()
    expect(screen.getByText('SEO')).toBeDefined() // list value parsed to items
    expect(screen.getByText('ADA')).toBeDefined()
    expect(screen.getAllByText(/locked/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Pro Way Hair School')).toBeDefined()
    expect(screen.getByText(/changed on/i)).toBeDefined()
  })

  it('renders a malformed list value as plain text (never crashes)', () => {
    const data = base({
      fieldCategories: [{
        category: 'school',
        fields: [{
          id: 1, label: 'Services in your subscription', fieldType: 'list', value: 'not-json[',
          version: 0, createdAt: '2026-06-01T00:00:00.000Z',
          valueUpdatedBy: null, valueUpdatedAt: null, isCustom: false, amendments: [],
        }],
      }],
    })
    render(<DataSourceSection meta={defaultMeta()} section={sec('data-source')} data={data} token="tok" />)
    expect(screen.getByText('not-json[')).toBeDefined()
  })

  it('greys a locked baseline behind a collapsed proposal affordance while a post-lock custom field stays editable', () => {
    const data = base({
      dataLockedAt: '2026-07-10T00:00:00.000Z',
      fieldCategories: [{
        category: 'school',
        fields: [
          {
            id: 1, label: 'School name', fieldType: 'text', value: 'Pro Way',
            version: 1, createdAt: '2026-06-01T00:00:00.000Z',
            valueUpdatedBy: null, valueUpdatedAt: null, isCustom: false, amendments: [],
          },
          {
            id: 2, label: 'Post-lock custom', fieldType: 'text', value: 'Still editable',
            version: 1, createdAt: '2026-07-11T00:00:00.000Z',
            valueUpdatedBy: null, valueUpdatedAt: null, isCustom: true, amendments: [],
          },
        ],
      }],
    })

    const { container } = render(<DataSourceSection meta={defaultMeta()} section={sec('data-source')} data={data} token="tok" />)
    const lockedRow = container.querySelector('#vb-field-1')
    expect(lockedRow?.getAttribute('data-vb-locked')).toBe('true')
    expect(lockedRow?.className).toContain('bg-black')
    expect(lockedRow?.querySelector('[data-vb-locked-content]')?.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Locked baseline')).toBeDefined()
    expect(screen.queryByRole('textbox', { name: 'Answer for School name' })).toBeNull()

    const proposal = lockedRow?.querySelector('details') as HTMLDetailsElement | null
    expect(proposal).not.toBeNull()
    expect(proposal?.open).toBe(false)
    expect(proposal?.querySelector('summary')?.textContent).toContain('Propose a change')

    expect(container.querySelector('input[aria-label="Answer for Post-lock custom"]')).not.toBeNull()
    expect(screen.getByText(/added after lock-in · still editable/i)).toBeDefined()
  })

  it('renders a post-contract intro line and the ack action; both absent outside post-contract (PR5 Task 7)', () => {
    const postContract = base({ stage: 'post-contract' })
    const { rerender } = render(<DataSourceSection meta={defaultMeta()} section={sec('data-source')} data={postContract} token="tok" />)
    expect(screen.getByText(/before the kickoff call/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /looks good/i })).toBeDefined()

    rerender(<DataSourceSection meta={defaultMeta()} section={sec('data-source')} data={base({ stage: 'kickoff' })} token="tok" />)
    expect(screen.queryByText(/before the kickoff call/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /looks good/i })).toBeNull()
  })

  it('renders user-controlled markup as TEXT, never as elements (Codex plan-fix 8)', () => {
    const data = base({
      fieldCategories: [{
        category: 'school',
        fields: [{
          id: 1, label: 'School name', fieldType: 'text',
          value: '<script>window.__pwned = true</script><img src=x onerror=alert(1)>',
          version: 0, createdAt: '2026-06-01T00:00:00.000Z',
          valueUpdatedBy: null, valueUpdatedAt: null, isCustom: false, amendments: [],
        }],
      }],
    })
    const { container } = render(<DataSourceSection meta={defaultMeta()} section={sec('data-source')} data={data} token="tok" />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
    expect(screen.getByText(/<script>/)).toBeDefined() // visible as literal text
  })
})
