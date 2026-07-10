// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { AdaScoreExplanation } from './AdaScoreExplanation'

afterEach(cleanup)

const v4 = JSON.stringify({
  version: 4, scorer: 'ada-v4', score: 76, weightsHash: 'abc123def456', lowCoverage: false,
  deductions: [
    { category: 'critical', cap: 40, points: 12, contributions: [
      { ruleId: 'image-alt', impact: 'critical', prevalence: 0.3, pagesAffected: 61, advisory: false },
    ] },
    { category: 'serious', cap: 30, points: 9, contributions: [] },
    { category: 'moderate', cap: 15, points: 2.5, contributions: [] },
    { category: 'minor', cap: 5, points: 0, contributions: [] },
    { category: 'needsReview', cap: 10, points: 0, contributions: [] },
  ],
  inputsSummary: { pagesAudited: 204, pagesTotal: 204, meanIncomplete: 0.4 },
})

describe('AdaScoreExplanation', () => {
  it('renders the deduction invoice for a v4 breakdown', () => {
    render(<AdaScoreExplanation breakdown={v4} />)
    expect(screen.getByText(/How this score was calculated/i)).toBeTruthy()
    expect(screen.getByText(/−12/)).toBeTruthy()
    expect(screen.getByText(/image-alt/)).toBeTruthy()
    expect(screen.getByText(/61 of 204 pages/)).toBeTruthy()
  })
  it('zero-point lines are hidden by default; renders nothing for v1/v3/malformed', () => {
    const { container: c1 } = render(<AdaScoreExplanation breakdown={JSON.stringify({ version: 3, scorer: 'ada-v2', score: 25, factors: {} })} />)
    expect(c1.textContent).toBe('')
    const { container: c2 } = render(<AdaScoreExplanation breakdown={'{oops'} />)
    expect(c2.textContent).toBe('')
    const { container: c3 } = render(<AdaScoreExplanation breakdown={null} />)
    expect(c3.textContent).toBe('')
  })
  it('shows the partial-coverage qualifier when lowCoverage', () => {
    const low = JSON.parse(v4); low.lowCoverage = true; low.inputsSummary.pagesAudited = 80
    render(<AdaScoreExplanation breakdown={JSON.stringify(low)} />)
    expect(screen.getByText(/partial coverage — 80 of 204 pages scored/i)).toBeTruthy()
  })
  it('renders nothing (no throw) for a v4-tagged blob missing inputsSummary/contributions', () => {
    const malformed = JSON.stringify({
      version: 4, scorer: 'ada-v4',
      deductions: [{ category: 'critical' }],
    })
    expect(() => {
      const { container } = render(<AdaScoreExplanation breakdown={malformed} />)
      expect(container.textContent).toBe('')
    }).not.toThrow()
  })
})
