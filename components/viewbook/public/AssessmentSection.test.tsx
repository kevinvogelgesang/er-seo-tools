// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import { SECTION_COPY_FIXTURE } from './test-support/section-copy-fixture'
import type { PublicSection, ViewbookPublicData, PublicAssessmentNotes } from '@/lib/viewbook/public-types'
import type { AssessmentData, AssessmentLoad } from '@/lib/viewbook/assessment'

// vi.mock factories are HOISTED — a plain `const` here is a temporal-dead-zone
// ReferenceError. vi.hoisted lifts the mock fn definition alongside the factory.
const { loadAssessmentData, getOperatorEmailForPublicPage } = vi.hoisted(() => ({
  loadAssessmentData: vi.fn<(token: string) => Promise<AssessmentLoad | null>>(),
  getOperatorEmailForPublicPage: vi.fn<() => Promise<string | null>>(),
}))
vi.mock('@/lib/viewbook/assessment', () => ({ loadAssessmentData }))
vi.mock('@/lib/viewbook/public-session', () => ({ getOperatorEmailForPublicPage }))
// Stub the client editor leaf — its hook wiring is covered by its own suite;
// here we only assert the operator branch mounts it.
vi.mock('./AssessmentNotesEditors', () => ({
  AssessmentNotesEditors: (props: { viewbookId: number }) => (
    <div data-testid="notes-editors">editors:{props.viewbookId}</div>
  ),
}))

import { AssessmentSection } from './AssessmentSection'
const meta = (over = {}) => ({ heroSize: 'chapter', chapterNumber: 1, status: 'current', isLead: false, ...over })

beforeEach(() => {
  getOperatorEmailForPublicPage.mockResolvedValue(null) // public viewer by default
})

afterEach(() => {
  cleanup()
  loadAssessmentData.mockReset()
  getOperatorEmailForPublicPage.mockReset()
})

const section: PublicSection = {
  sectionKey: 'assessment',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: 'It needs work.',
}
const data = {
  clientName: 'Acme',
  displayName: 'Acme',
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  stage: 'building',
  stageLabel: 'Now Building', viewerMode: 'continuous',
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
  sectionCopy: SECTION_COPY_FIXTURE,
} as unknown as ViewbookPublicData

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

const EMPTY_NOTES: PublicAssessmentNotes = {
  generalNotesHtml: null,
  userBehaviourHtml: null,
  userBehaviourImages: [],
}

function load(over: Partial<AssessmentLoad> = {}): AssessmentLoad {
  return { viewbookId: 1, assessment: full, notes: null, ...over }
}

// Async server component: call it as a function, render the resolved JSX.
async function renderSection() {
  render(await AssessmentSection({ section, data, token: 'tok', meta: meta() }))
}

describe('AssessmentSection', () => {
  it('renders the coming-soon state when no assessment loads', async () => {
    loadAssessmentData.mockResolvedValue(load({ assessment: null }))
    await renderSection()
    expect(screen.getByText(/first site scan is coming soon/i)).toBeDefined()
  })

  it('renders scores, patterns, seo issues, and narrative', async () => {
    loadAssessmentData.mockResolvedValue(load())
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
    loadAssessmentData.mockResolvedValue(load({ assessment: { ...full, seoScore: null, seoUnavailable: true, seoIssues: [] } }))
    await renderSection()
    expect(screen.getByText(/SEO details unavailable/i)).toBeDefined()
  })

  it('handles a null ADA score without rendering null/100 or 0', async () => {
    loadAssessmentData.mockResolvedValue(load({ assessment: { ...full, adaScore: null, adaPatterns: [] } }))
    await renderSection()
    expect(screen.getByText(/Accessibility details unavailable/i)).toBeDefined()
    expect(screen.queryByText(/null\s*\/\s*100/)).toBeNull()
  })

  it('renders the p75 lab rollup when performance data exists', async () => {
    loadAssessmentData.mockResolvedValue(load({
      assessment: {
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
      },
    }))
    await renderSection()
    expect(screen.getByText(/Lighthouse lab test/i)).toBeDefined()
    expect(screen.getByText(/3 pages measured/i)).toBeDefined()
    expect(screen.getAllByText(/2\.5\s*s/).length).toBeGreaterThan(0) // p75 LCP as seconds
  })

  it('renders CLS to exactly two decimals at both interpolation spots (D12)', async () => {
    loadAssessmentData.mockResolvedValue(load({
      assessment: {
        ...full,
        performance: {
          measuredPages: 3,
          medianPerformance: 60,
          p75LcpMs: 2500,
          p75Cls: 0.2, // must render as 0.20, not 0.2
          p75TbtMs: 150,
          pctPassing: 100,
          scoreBuckets: { good: 1, fair: 1, poor: 1 },
          worstPages: [],
        },
        homepage: {
          performance: 95,
          lcpMs: 1800,
          cls: 0.02, // must render as 0.02
          tbtMs: 150,
          lcpStatus: 'pass',
          clsStatus: 'pass',
          tbtStatus: 'pass',
        },
      },
    }))
    await renderSection()
    expect(screen.getByText(/Layout shift 0\.02\b/)).toBeDefined()
    expect(screen.getByText(/p75 layout shift 0\.20\b/)).toBeDefined()
  })

  it('renders sanitized note HTML + user-behaviour images for a public viewer', async () => {
    const notes: PublicAssessmentNotes = {
      generalNotesHtml: '<p>General guidance text.</p>',
      userBehaviourHtml: '<p>Visitors bounce fast.</p>',
      userBehaviourImages: [{ id: 5, filename: 'heat.png', sortOrder: 0 }],
    }
    loadAssessmentData.mockResolvedValue(load({ notes }))
    await renderSection()
    expect(screen.getByText('General notes')).toBeDefined()
    expect(screen.getByText(/General guidance text\./)).toBeDefined()
    expect(screen.getByText('User Behaviour')).toBeDefined()
    expect(screen.getByText(/Visitors bounce fast\./)).toBeDefined()
    const img = document.querySelector('img[src="/api/viewbook/tok/assets/heat.png"]')
    expect(img).not.toBeNull()
  })

  it('leaks no empty note headers to a public viewer with empty notes', async () => {
    loadAssessmentData.mockResolvedValue(load({ notes: EMPTY_NOTES }))
    await renderSection()
    expect(screen.queryByText('General notes')).toBeNull()
    expect(screen.queryByText('User Behaviour')).toBeNull()
    expect(screen.queryByTestId('notes-editors')).toBeNull()
  })

  // codex-review P2: a cleared contentEditable region sanitizes to
  // break-only markup (`<br />`, `<p><br /></p>`) rather than an empty
  // string. Legacy/already-stored rows may still carry that shape even
  // after setAssessmentNote started normalizing new writes — hasHtml must
  // treat it as empty too, not just a fresh `''`.
  it('leaks no empty note headers when stored notes are break-only markup, not a plain empty string', async () => {
    const notes: PublicAssessmentNotes = {
      generalNotesHtml: '<br />',
      userBehaviourHtml: '<p><br /></p>',
      userBehaviourImages: [],
    }
    loadAssessmentData.mockResolvedValue(load({ notes }))
    await renderSection()
    expect(screen.queryByText('General notes')).toBeNull()
    expect(screen.queryByText('User Behaviour')).toBeNull()
  })

  it('still renders the User Behaviour heading + gallery when only images exist (no text body)', async () => {
    const notes: PublicAssessmentNotes = {
      generalNotesHtml: null,
      userBehaviourHtml: '<p><br /></p>',
      userBehaviourImages: [{ id: 5, filename: 'heat.png', sortOrder: 0 }],
    }
    loadAssessmentData.mockResolvedValue(load({ notes }))
    await renderSection()
    expect(screen.queryByText('General notes')).toBeNull()
    expect(screen.getByText('User Behaviour')).toBeDefined()
    const img = document.querySelector('img[src="/api/viewbook/tok/assets/heat.png"]')
    expect(img).not.toBeNull()
  })

  it('mounts the operator editor leaf when an operator is signed in', async () => {
    getOperatorEmailForPublicPage.mockResolvedValue('op@er.com')
    loadAssessmentData.mockResolvedValue(load({ notes: EMPTY_NOTES }))
    await renderSection()
    expect(screen.getByTestId('notes-editors')).toBeDefined()
  })
})
