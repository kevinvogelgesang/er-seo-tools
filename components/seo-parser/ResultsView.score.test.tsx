// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ResultsView } from './ResultsView'
import type { AggregatedResult } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({
  default: () => function DynamicStub() { return <div data-testid="chart" /> },
}))

const baseResult: AggregatedResult = {
  crawl_summary: { total_urls: 5, indexable_urls: 4, non_indexable_urls: 1 },
  issues: {
    critical: [{ type: 'missing_title', severity: 'critical', count: 1, description: 'Missing titles', urls: ['https://x.test/a'] }],
    warnings: [],
    notices: [],
  },
  site_structure: { crawl_depth_distribution: { 1: 5 } },
  resources: {},
  technical_seo: {},
  performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0, site_name: 'x.test' },
}

// ScoreExplanation ONLY parses JSON (components/scoring/ScoreExplanation.tsx:9); a
// plain string renders "unavailable". Use a real PersistedBreakdown JSON string.
const BREAKDOWN = JSON.stringify({
  version: 1,
  scorer: 'health',
  score: 87,
  factors: [{ key: 'indexability', label: 'Indexability', weight: 20, earned: 20, possible: 20 }],
})

const SID = '00000000-0000-4000-8000-000000000000'
afterEach(cleanup)

describe('ResultsView health-score card', () => {
  it('renders a ScoreRing with the value and keeps the score explanation when healthScore is set', async () => {
    const user = userEvent.setup()
    render(
      <ResultsView
        result={baseResult}
        sessionId={SID}
        healthScore={87}
        scoreBreakdown={BREAKDOWN}
      />
    )
    // ScoreRing renders role="img" with aria-label "score 87"
    expect(screen.getByRole('img', { name: /score 87/i })).toBeTruthy()
    expect(screen.getByText(/SEO health score/i)).toBeTruthy()
    // The explanation is behind the ⓘ hover-card trigger; open it to see the factors.
    const trigger = screen.getByRole('button', { name: /How this score is calculated/i })
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText('Indexability')).toBeTruthy()
  })

  it('renders no ScoreRing and no health-score card when healthScore is null/omitted', () => {
    render(<ResultsView result={baseResult} sessionId={SID} />)
    expect(screen.queryByRole('img', { name: /score/i })).toBeNull()
    expect(screen.queryByText(/SEO health score/i)).toBeNull()
  })
})
