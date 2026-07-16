// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicMilestone, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { MilestonesSection } from './MilestonesSection'
import { DataSourceSection } from './DataSourceSection'

afterEach(cleanup)

const sec = (sectionKey: PublicSection['sectionKey']): PublicSection => ({
  sectionKey, state: 'active', doneAt: null, introNote: null, narrative: null,
})

const base = (over: Partial<ViewbookPublicData> = {}): ViewbookPublicData => ({
  clientName: 'Acme', kind: 'upgrade', welcomeNote: null, dataLockedAt: null,
  theme: DEFAULT_THEME, sections: [], fieldCategories: [], milestones: [],
  materials: [], global: { team: null, blocks: {} }, overrides: {}, ...over,
})

const milestone = (over: Partial<PublicMilestone> = {}): PublicMilestone => ({
  id: 1, title: 'Design', blurb: 'Designs take shape.', status: 'upcoming',
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
    render(<MilestonesSection section={sec('milestones')} data={data} token="tok" />)
    expect(screen.getByText('Current stage')).toBeDefined()
    const a = screen.getByRole('link', { name: /homepage mockup/i })
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByText(/reviews will appear here/i)).toBeNull() // links exist → no empty state
  })

  it('renders the empty state when NO milestone has review links (separate fixture — Codex plan-fix 8)', () => {
    const data = base({
      milestones: [milestone({ id: 1, title: 'Kickoff', status: 'current' })],
    })
    render(<MilestonesSection section={sec('milestones')} data={data} token="tok" />)
    expect(screen.getByText(/reviews will appear here/i)).toBeDefined()
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
    render(<DataSourceSection section={sec('data-source')} data={data} token="tok" />)
    expect(screen.getByText('Your school')).toBeDefined()
    expect(screen.getByText('Pro Way')).toBeDefined()
    expect(screen.getByText(/updated by you/i)).toBeDefined()
    expect(screen.getByText('SEO')).toBeDefined() // list value parsed to items
    expect(screen.getByText('ADA')).toBeDefined()
    expect(screen.getByText(/locked/i)).toBeDefined()
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
    render(<DataSourceSection section={sec('data-source')} data={data} token="tok" />)
    expect(screen.getByText('not-json[')).toBeDefined()
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
    const { container } = render(<DataSourceSection section={sec('data-source')} data={data} token="tok" />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
    expect(screen.getByText(/<script>/)).toBeDefined() // visible as literal text
  })
})
