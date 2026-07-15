// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ONE stable searchParams instance + router (C17 gotcha): returning a fresh
// object each render would refire the shell's sync-effect and clobber clicks.
const h = vi.hoisted(() => ({ sp: new URLSearchParams(''), replace: (() => {}) as (...a: unknown[]) => void }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => h.sp,
  useRouter: () => ({ replace: h.replace }),
}))

import SiteAuditResultsShell from './SiteAuditResultsShell'

beforeEach(() => { h.sp = new URLSearchParams(''); h.replace = () => {} })
afterEach(cleanup)

const base = {
  domain: 'x.test',
  clientName: 'Acme',
  createdAt: '2026-07-08T00:00:00.000Z',
  pagesTotal: 10,
  pagesError: 0,
  adaScore: 82,
  seoScore: 91,
  accessibility: <div>ADA-PANEL</div>,
  seo: <div>SEO-PANEL</div>,
}

describe('SiteAuditResultsShell (C18)', () => {
  it('shows the Accessibility panel by default and switches to SEO on tab click', () => {
    render(<SiteAuditResultsShell {...base} exportBar={<div>EXPORT</div>} />)
    expect(screen.getByText('ADA-PANEL')).toBeTruthy()
    expect(screen.queryByText('SEO-PANEL')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /SEO/i }))
    expect(screen.getByText('SEO-PANEL')).toBeTruthy()
    expect(screen.queryByText('ADA-PANEL')).toBeNull()
  })

  it('seeds the active tab from ?resultTab=seo', () => {
    h.sp = new URLSearchParams('resultTab=seo')
    render(<SiteAuditResultsShell {...base} />)
    expect(screen.getByText('SEO-PANEL')).toBeTruthy()
    expect(screen.queryByText('ADA-PANEL')).toBeNull()
  })

  it('renders both score rings (ADA + SEO)', () => {
    render(<SiteAuditResultsShell {...base} />)
    // ScoreRing sets aria-label `score <n>`; disambiguates from the tab labels.
    expect(screen.getByLabelText('score 82')).toBeTruthy()
    expect(screen.getByLabelText('score 91')).toBeTruthy()
  })

  it('omits the export bar in shareMode', () => {
    render(<SiteAuditResultsShell {...base} adaScore={null} seoScore={null} exportBar={<div>EXPORT</div>} shareMode />)
    expect(screen.queryByText('EXPORT')).toBeNull()
  })

  // C19 PR1 Task 5: the explanation panel is internal-only — the share page
  // never passes adaScoreBreakdown, so it must render nothing there.
  it('renders the ADA score explanation invoice when adaScoreBreakdown is provided', async () => {
    const breakdown = JSON.stringify({
      version: 4, scorer: 'ada-v4', score: 76, weightsHash: 'abc123', lowCoverage: false,
      deductions: [
        { category: 'critical', cap: 40, points: 12, contributions: [
          { ruleId: 'image-alt', impact: 'critical', prevalence: 0.3, pagesAffected: 61, advisory: false },
        ] },
      ],
      inputsSummary: { pagesAudited: 204, pagesTotal: 204, meanIncomplete: 0.4 },
    })
    render(<SiteAuditResultsShell {...base} adaScoreBreakdown={breakdown} />)
    const trigger = screen.getByRole('button', { name: /How this score is calculated/i })
    // The invoice detail lives inside the ⓘ hover card; open it to assert.
    await userEvent.setup().click(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText(/image-alt/)).toBeTruthy()
  })

  it('omits the ADA score explanation when adaScoreBreakdown is not provided (share mode)', () => {
    render(<SiteAuditResultsShell {...base} />)
    expect(screen.queryByRole('button', { name: /How this score is calculated/i })).toBeNull()
  })

  it('omits the ADA score explanation in shareMode even if adaScoreBreakdown is (mis)provided', () => {
    const breakdown = JSON.stringify({
      version: 4, scorer: 'ada-v4', score: 76, weightsHash: 'abc123', lowCoverage: false,
      deductions: [
        { category: 'critical', cap: 40, points: 12, contributions: [
          { ruleId: 'image-alt', impact: 'critical', prevalence: 0.3, pagesAffected: 61, advisory: false },
        ] },
      ],
      inputsSummary: { pagesAudited: 204, pagesTotal: 204, meanIncomplete: 0.4 },
    })
    render(<SiteAuditResultsShell {...base} shareMode adaScoreBreakdown={breakdown} />)
    expect(screen.queryByRole('button', { name: /How this score is calculated/i })).toBeNull()
  })
})
