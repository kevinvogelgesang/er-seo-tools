// @vitest-environment jsdom
// components/site-audit/ContentSignalsSection.test.tsx
// NOTE: this repo has NO jest-dom matchers — assert on .toBeTruthy(), not toBeInTheDocument.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ContentSignalsSection } from './ContentSignalsSection'

afterEach(cleanup)

const withSignals = (o: object) => ({ contentSignalsJson: JSON.stringify({
  v: 1, observedPages: 3, truncatedPages: 0,
  staleDates: { pagesWithHits: 0, pages: [] },
  readability: { scoredPages: 3, medianFleschReadingEase: 55.2, medianGradeLevel: 9.1, pages: [] },
  ...o,
}) })

describe('ContentSignalsSection', () => {
  it('renders the not-analyzed state for a null column', () => {
    render(<ContentSignalsSection run={{ contentSignalsJson: null }} />)
    expect(screen.getByText(/were not analyzed/i)).toBeTruthy()
  })

  it('renders the not-analyzed state when the column fails to parse', () => {
    render(<ContentSignalsSection run={{ contentSignalsJson: '{not json' }} />)
    expect(screen.getByText(/were not analyzed/i)).toBeTruthy()
  })

  it('renders the clean state', () => {
    render(<ContentSignalsSection run={withSignals({})} />)
    expect(screen.getByText(/No stale date references detected/i)).toBeTruthy()
  })

  it('renders a stale-date hit', () => {
    render(<ContentSignalsSection run={withSignals({ staleDates: { pagesWithHits: 1, pages: [
      { url: 'https://x.edu/a', hits: [{ kind: 'copyright', year: 2021, excerpt: '© 2021 Example' }] } ] } })} />)
    expect(screen.getByText(/x\.edu\/a/)).toBeTruthy()
    expect(screen.getByText(/2021/)).toBeTruthy()
  })

  it('notes truncation on a clean-but-truncated result', () => {
    render(<ContentSignalsSection run={withSignals({ truncatedPages: 2 })} />)
    expect(screen.getByText(/truncated at 30k/i)).toBeTruthy()
  })

  it('shows a "showing top N of M" note when the stale-date list is capped', () => {
    render(<ContentSignalsSection run={withSignals({ staleDates: { pagesWithHits: 5, pages: [
      { url: 'https://x.edu/a', hits: [{ kind: 'copyright', year: 2021, excerpt: '© 2021 Example' }] } ] } })} />)
    expect(screen.getByText(/showing top 1 of 5/i)).toBeTruthy()
  })

  it('shows a "showing top N of M" note when the readability list is capped', () => {
    render(<ContentSignalsSection run={withSignals({ readability: { scoredPages: 4, medianFleschReadingEase: 40, medianGradeLevel: 11, pages: [
      { url: 'https://x.edu/hard', fleschReadingEase: 22.5, gradeLevel: 14.1 } ] } })} />)
    expect(screen.getByText(/showing top 1 of 4/i)).toBeTruthy()
  })

  it('always labels the readability block English-calibrated (Flesch)', () => {
    render(<ContentSignalsSection run={withSignals({})} />)
    expect(screen.getByText(/English-calibrated \(Flesch\)/i)).toBeTruthy()
  })
})
