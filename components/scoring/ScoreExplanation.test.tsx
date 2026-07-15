// @vitest-environment jsdom
import '../../test/setup-jsdom-observers'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScoreExplanation } from './ScoreExplanation'

afterEach(cleanup)

const bd = JSON.stringify({ version: 1, scorer: 'health', score: 72, factors: [{ key: 'indexability', label: 'Indexability', weight: 20, earned: 18, possible: 20 }] })
describe('ScoreExplanation', () => {
  it('opens the hover card and shows factor rows', async () => {
    const user = userEvent.setup()
    render(<ScoreExplanation breakdown={bd} />)
    const trigger = screen.getByRole('button', { name: 'How this score is calculated' })
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText('Indexability')).toBeTruthy()
    expect(screen.getByText(/Weights as scored/)).toBeTruthy()
  })
  it('renders unavailable for null (fallback stays OUTSIDE the card — no trigger)', () => {
    render(<ScoreExplanation breakdown={null} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('renders unavailable on malformed JSON', () => { render(<ScoreExplanation breakdown={'{'} />); expect(screen.getByText(/unavailable/i)).toBeTruthy() })
  it('renders nothing when factors are empty (live null-score case)', () => {
    const { container } = render(<ScoreExplanation breakdown={JSON.stringify({ version: 1, scorer: 'live-seo', score: null, factors: [] })} />)
    expect(container.firstChild).toBeNull()
  })
})
