// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ScoreExplanation } from './ScoreExplanation'

afterEach(cleanup)

const bd = JSON.stringify({ version: 1, scorer: 'health', score: 72, factors: [{ key: 'indexability', label: 'Indexability', weight: 20, earned: 18, possible: 20 }] })
describe('ScoreExplanation', () => {
  it('renders factor rows from a breakdown', () => { render(<ScoreExplanation breakdown={bd} />); expect(screen.getByText('Indexability')).toBeTruthy() })
  it('renders unavailable for null', () => { render(<ScoreExplanation breakdown={null} />); expect(screen.getByText(/unavailable/i)).toBeTruthy() })
  it('renders unavailable on malformed JSON', () => { render(<ScoreExplanation breakdown={'{'} />); expect(screen.getByText(/unavailable/i)).toBeTruthy() })
  it('renders nothing when factors are empty (live null-score case)', () => {
    const { container } = render(<ScoreExplanation breakdown={JSON.stringify({ version: 1, scorer: 'live-seo', score: null, factors: [] })} />)
    expect(container.firstChild).toBeNull()
  })
})
