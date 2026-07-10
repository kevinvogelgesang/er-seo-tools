// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ScoringWeightsCard } from './ScoringWeightsCard'

// Mock fetch to avoid network requests
global.fetch = vi.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ weights: { indexability: 20, errorRate: 20, missingTitle: 10, missingMeta: 8, missingH1: 7, crawlDepth: 15, thinContent: 10, schema: 10, brokenLinks: 10 } }),
  })
) as any

describe('ScoringWeightsCard', () => {
  it('renders all persistable weight labels, including brokenLinks (C19 PR3 — real column)', async () => {
    render(<ScoringWeightsCard />)
    // Wait for fetch and component to render
    await new Promise(resolve => setTimeout(resolve, 50))

    // Should render all persistable weight labels
    expect(screen.queryByText('Indexability')).toBeTruthy()
    expect(screen.queryByText('Error rate')).toBeTruthy()
    expect(screen.queryByText('Missing title')).toBeTruthy()
    expect(screen.queryByText('Missing meta description')).toBeTruthy()
    expect(screen.queryByText('Missing H1')).toBeTruthy()
    expect(screen.queryByText('Crawl depth')).toBeTruthy()
    expect(screen.queryByText('Thin content')).toBeTruthy()
    expect(screen.queryByText('Schema coverage')).toBeTruthy()

    // brokenLinks is persistable now — the input renders alongside the others.
    expect(screen.queryByText('Broken links')).toBeTruthy()
  })
})
