// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import type { AssessmentData } from '@/lib/viewbook/assessment'

// vi.mock factories are HOISTED — a plain `const` here is a temporal-dead-zone
// ReferenceError. vi.hoisted lifts the mock fn definition alongside the factory.
const { loadAssessmentData } = vi.hoisted(() => ({
  loadAssessmentData: vi.fn<(token: string) => Promise<AssessmentData | null>>(),
}))
vi.mock('@/lib/viewbook/assessment', () => ({ loadAssessmentData }))

import { AssessmentSection } from './AssessmentSection'

afterEach(() => {
  cleanup()
  loadAssessmentData.mockReset()
})

const section: PublicSection = {
  sectionKey: 'assessment',
  state: 'active',
  doneAt: null,
  introNote: null,
  narrative: 'It needs work.',
}
const data = {
  clientName: 'Acme',
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
} as ViewbookPublicData

const full: AssessmentData = {
  domain: 'acme.edu',
  completedAt: '2026-07-02T00:00:00.000Z',
  standardTested: 'WCAG 2.1 AA',
  pagesAudited: 12,
  adaScore: 82,
  seoScore: 74,
  seoUnavailable: false,
  adaPatterns: [{ help: 'Images missing alt text', impact: 'critical', affectedPagesCount: 8, totalPagesScanned: 12 }],
  seoIssues: [{ label: 'Broken internal links', count: 9, unit: 'targets' }],
  performance: null,
  homepage: null,
}

// Async server component: call it as a function, render the resolved JSX.
async function renderSection() {
  render(await AssessmentSection({ section, data, token: 'tok' }))
}

describe('AssessmentSection', () => {
  it('renders the coming-soon state when no assessment loads', async () => {
    loadAssessmentData.mockResolvedValue(null)
    await renderSection()
    expect(screen.getByText(/first site scan is coming soon/i)).toBeDefined()
  })

  it('renders scores, patterns, seo issues, and narrative', async () => {
    loadAssessmentData.mockResolvedValue(full)
    await renderSection()
    expect(screen.getAllByText(/82/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/74/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/WCAG 2\.1 AA/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Images missing alt text/)).toBeDefined()
    expect(screen.getByText(/8 of 12 pages/)).toBeDefined()
    expect(screen.getAllByText(/Broken internal links/).length).toBeGreaterThan(0)
    expect(screen.getByText('It needs work.')).toBeDefined()
    expect(screen.queryByText(/Lighthouse lab test/)).toBeNull() // no perf data → block omitted
  })

  it('never renders a literal 0 for an unavailable SEO score', async () => {
    loadAssessmentData.mockResolvedValue({ ...full, seoScore: null, seoUnavailable: true, seoIssues: [] })
    await renderSection()
    expect(screen.getByText(/SEO details unavailable/i)).toBeDefined()
  })

  it('handles a null ADA score without rendering null/100 or 0', async () => {
    loadAssessmentData.mockResolvedValue({ ...full, adaScore: null, adaPatterns: [] })
    await renderSection()
    expect(screen.getByText(/Accessibility details unavailable/i)).toBeDefined()
    expect(screen.queryByText(/null\s*\/\s*100/)).toBeNull()
  })

  it('renders the p75 lab rollup when performance data exists', async () => {
    loadAssessmentData.mockResolvedValue({
      ...full,
      performance: {
        measuredPages: 3,
        medianPerformance: 60,
        p75LcpMs: 2500,
        p75Cls: 0.05,
        p75TbtMs: 150,
        pctPassing: 100,
        scoreBuckets: { good: 1, fair: 1, poor: 1 },
        worstPages: [{ url: 'https://acme.edu/b', performance: 40 }],
      },
      homepage: {
        performance: 95,
        lcpMs: 1800,
        cls: 0.05,
        tbtMs: 150,
        lcpStatus: 'pass',
        clsStatus: 'pass',
        tbtStatus: 'pass',
      },
    })
    await renderSection()
    expect(screen.getByText(/Lighthouse lab test/i)).toBeDefined()
    expect(screen.getByText(/3 pages measured/i)).toBeDefined()
    expect(screen.getAllByText(/2\.5\s*s/).length).toBeGreaterThan(0) // p75 LCP as seconds
  })
})
