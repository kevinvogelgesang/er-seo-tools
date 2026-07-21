// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { BrandSection } from './BrandSection'
const meta = (over = {}) => ({ heroSize: 'chapter', chapterNumber: 1, status: 'current', isLead: false, ...over })

afterEach(cleanup)

const section: PublicSection = {
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

const data: ViewbookPublicData = {
  clientName: 'Acme',
  displayName: 'Acme',
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  stage: 'website-specifics',
  stageLabel: 'Website Specifics', viewerMode: 'continuous',
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
} as unknown as ViewbookPublicData

describe('BrandSection', () => {
  it('mounts the Task-3 contrast tester alongside the palette + typography specimens', () => {
    render(<BrandSection meta={meta()} section={section} data={data} token="tok" />)
    expect(screen.getAllByTestId('contrast-ratio').length).toBeGreaterThan(0)
    expect(screen.getByText('Palette')).toBeDefined()
    expect(screen.getByText('Typography')).toBeDefined()
    expect(screen.getByText(/Contrast checker/i)).toBeDefined()
  })

  it('passes the public viewbook id to the live contrast store subscriber', () => {
    render(<BrandSection meta={meta()} section={section} data={{ ...data, viewbookId: 42 }} token="tok" />)
    expect(screen.getByTestId('contrast-tester').getAttribute('data-viewbook-id')).toBe('42')
  })

  it('shows server-resolved catalog family names', () => {
    render(
      <BrandSection meta={meta()}
        section={section}
        data={{ ...data, theme: { ...DEFAULT_THEME, headingFont: 'abril-fatface' } }}
        token="tok"
        resolvedFonts={{
          href: 'https://fonts.googleapis.com/css2?family=Abril+Fatface:wght@400&display=swap',
          heading: { key: 'abril-fatface', family: 'Abril Fatface', gfQuery: 'family=Abril+Fatface:wght@400' },
          body: { key: 'inter', family: 'Inter', gfQuery: 'family=Inter:wght@400;600;700;800' },
        }}
      />,
    )
    expect(screen.getByText('Headings — Abril Fatface')).toBeTruthy()
  })
})
