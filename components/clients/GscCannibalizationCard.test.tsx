// @vitest-environment jsdom
// components/clients/GscCannibalizationCard.test.tsx
// NOTE: this repo has NO jest-dom matchers — assert on .toBeTruthy(), not toBeInTheDocument.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { GscCannibalizationCard } from './GscCannibalizationCard'

afterEach(cleanup)

const entry = {
  query: 'nursing program', queryImpressions: 500, observedPageImpressions: 480, observedPageCoverage: 0.96,
  pages: [
    { page: 'https://x.edu/a', impressions: 260, clicks: 12, share: 0.54 },
    { page: 'https://x.edu/b', impressions: 220, clicks: 9, share: 0.46 },
  ],
}

describe('GscCannibalizationCard', () => {
  it('shows the not-mapped state', () => {
    render(<GscCannibalizationCard clientId={1} initial={{ gscMapped: false, report: null }} />)
    expect(screen.getByText(/No GSC property is mapped/i)).toBeTruthy()
  })

  it('shows the clean state when the report has zero entries', () => {
    render(<GscCannibalizationCard clientId={1} initial={{ gscMapped: true, report: {
      fetchedAt: '2026-07-01T00:00:00Z', windowStart: '2026-04-01T00:00:00Z', windowEnd: '2026-06-28T00:00:00Z',
      queryAtLimit: false, queryPageAtLimit: false, thresholds: { minImpressions: 10, cannibalizationMinShare: 0.2, cannibalizationMinPageImpressions: 10 },
      totalCannibalizedQueries: 0, capped: false, entries: [],
    } }} />)
    expect(screen.getByText(/No cannibalized queries observed/i)).toBeTruthy()
  })

  it('renders a cannibalized query and its competing pages', () => {
    render(<GscCannibalizationCard clientId={1} initial={{ gscMapped: true, report: {
      fetchedAt: '2026-07-01T00:00:00Z', windowStart: '2026-04-01T00:00:00Z', windowEnd: '2026-06-28T00:00:00Z',
      queryAtLimit: false, queryPageAtLimit: false, thresholds: { minImpressions: 10, cannibalizationMinShare: 0.2, cannibalizationMinPageImpressions: 10 },
      totalCannibalizedQueries: 1, capped: false, entries: [entry],
    } }} />)
    expect(screen.getByText('nursing program')).toBeTruthy()
    expect(screen.getByText(/x\.edu\/a/)).toBeTruthy()
  })

  it('shows a truncation notice when capped', () => {
    render(<GscCannibalizationCard clientId={1} initial={{ gscMapped: true, report: {
      fetchedAt: '2026-07-01T00:00:00Z', windowStart: '2026-04-01T00:00:00Z', windowEnd: '2026-06-28T00:00:00Z',
      queryAtLimit: false, queryPageAtLimit: false, thresholds: { minImpressions: 10, cannibalizationMinShare: 0.2, cannibalizationMinPageImpressions: 10 },
      totalCannibalizedQueries: 250, capped: true, entries: [entry],
    } }} />)
    expect(screen.getByText(/may be truncated/i)).toBeTruthy()
  })
})
