// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { ResultsView } from './ResultsView'
import type { AggregatedResult } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({
  default: () =>
    function DynamicStub() {
      return <div data-testid="chart" />
    },
}))

const liveResult: AggregatedResult = {
  crawl_summary: { total_urls: 2 },
  issues: { critical: [], warnings: [], notices: [] },
  site_structure: {}, resources: {}, technical_seo: {}, performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0, site_name: 'live.test' },
  archived: false,
} as unknown as AggregatedResult

const archivedResult: AggregatedResult = {
  crawl_summary: { total_urls: 5, indexable_urls: 4, non_indexable_urls: 1 },
  issues: {
    critical: [{ type: 'missing_title', severity: 'critical', count: 2, description: 'Missing titles', urls: ['https://x.test/a'] }],
    warnings: [],
    notices: [],
  },
  site_structure: { crawl_depth_distribution: { 1: 5 } },
  resources: {},
  technical_seo: {},
  performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0, site_name: 'x.test', health_score: 70 },
  archived: true,
}

afterEach(cleanup)

describe('ResultsView archived mode', () => {
  it('shows the archived banner and suppresses completeness + status-code card', () => {
    render(<ResultsView result={archivedResult} sessionId="00000000-0000-4000-8000-000000000000" />)
    expect(screen.getByText('Archived session')).toBeTruthy()
    // completeness recompute suppressed: no completeness banner copy
    expect(screen.queryByText(/internal crawl/i)).toBeNull()
    // status-code card hidden at container level (no status data)
    expect(screen.queryByText('Response Code Distribution')).toBeNull()
    // depth chart still renders (reconstructed distribution)
    expect(screen.getByText('Crawl Depth Distribution')).toBeTruthy()
  })

  it('keeps the status-code card for non-archived results with status data', () => {
    const fresh: AggregatedResult = {
      ...archivedResult,
      archived: undefined,
      crawl_summary: { ...archivedResult.crawl_summary, ok_responses: 5, redirects: 0, client_errors: 0, server_errors: 0 },
    }
    render(<ResultsView result={fresh} sessionId="00000000-0000-4000-8000-000000000000" />)
    expect(screen.getByText('Response Code Distribution')).toBeTruthy()
  })

  it('renders the file-processing panel (not the debug footer) for a fresh result with file_reports', () => {
    const fresh: AggregatedResult = {
      ...archivedResult,
      archived: false,
      metadata: {
        files_processed: ['internal_all.csv'], parsers_used: ['internal'], total_parsers_available: 40,
        site_name: 'x.test',
        file_reports: [
          { filename: 'internal_all.csv', status: 'failed', severity: 'core', error: 'boom' },
        ],
      },
    };
    render(<ResultsView result={fresh} sessionId="00000000-0000-4000-8000-000000000000" />);
    expect(screen.getByText(/File processing:/)).toBeTruthy();
    expect(screen.queryByText('Debug info')).toBeNull(); // footer removed
    expect(screen.getByText(/unreliable/i)).toBeTruthy(); // core-failure banner
  })
})

describe('ResultsView live-scan mode', () => {
  it('renders a live-scan run as first-class (no archived, no completeness banner)', () => {
    render(<ResultsView result={liveResult} runId="run_abc" />)
    expect(screen.queryByText(/Archived — rebuilt from findings/i)).toBeNull()
    expect(screen.getByText(/Live scan/i)).toBeTruthy() // SeoSourceBadge text
    // AuditCompletenessBanner would otherwise render "Incomplete audit — internal
    // crawl missing" for this fixture (no page_index, no internal_all file) —
    // confirmed by reading AuditCompletenessBanner.tsx. Its absence here proves
    // the live-scan branch actually suppresses the banner, not just coincidence.
    expect(screen.queryByText(/Incomplete audit/i)).toBeNull()
  })
})
