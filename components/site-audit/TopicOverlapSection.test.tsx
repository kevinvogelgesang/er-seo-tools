// @vitest-environment jsdom
import '../../test/setup-jsdom-observers'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopicOverlapSection } from './TopicOverlapSection'

afterEach(cleanup)

describe('TopicOverlapSection', () => {
  it('renders the not-analyzed state when json is null', () => {
    render(<TopicOverlapSection run={{ topicOverlapJson: null }} />)
    expect(screen.getAllByText(/not analyzed/i).length).toBeGreaterThan(0)
  })

  it('renders the not-analyzed state on malformed json', () => {
    render(<TopicOverlapSection run={{ topicOverlapJson: '{bad' }} />)
    expect(screen.getAllByText(/not analyzed/i).length).toBeGreaterThan(0)
  })

  it('renders the clean state when there are no clusters', () => {
    const json = JSON.stringify({ v: 1, observedPages: 5, clusteredCandidates: 5, threshold: 0.78, weights: { sig: 0.6, body: 0.4 }, bodyPrefixTruncatedPages: 0, inputCapped: false, clustersCapped: false, clusters: [] })
    render(<TopicOverlapSection run={{ topicOverlapJson: json }} />)
    expect(screen.getAllByText(/no topic-overlap/i).length).toBeGreaterThan(0)
  })

  // Task 8 (memory fix stage B2): a budget-capped null persists as an
  // { unavailable: true } stub, not a bare null — must render distinctly from
  // both the not-analyzed and clean states.
  it('renders the capped state for an unavailable stub', () => {
    const json = JSON.stringify({ v: 1, unavailable: true, inputCapped: true, budgetSkippedPages: 7 })
    render(<TopicOverlapSection run={{ topicOverlapJson: json }} />)
    expect(screen.getAllByText(/content input was capped for this run/i).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/no topic-overlap/i).length).toBe(0)
    expect(screen.queryAllByText(/not analyzed/i).length).toBe(0)
  })

  it('lists networks with member urls as links (href set)', () => {
    const json = JSON.stringify({
      v: 1, observedPages: 60, clusteredCandidates: 42, threshold: 0.78, weights: { sig: 0.6, body: 0.4 },
      bodyPrefixTruncatedPages: 0, inputCapped: false, clustersCapped: false,
      clusters: [{ urls: ['https://x/nursing-diploma', 'https://x/rn-program'], size: 2, membersTruncated: false, minEdgeSimilarity: 0.81 }],
    })
    render(<TopicOverlapSection run={{ topicOverlapJson: json }} />)
    const link = screen.getByRole('link', { name: 'https://x/nursing-diploma' })
    expect(link.getAttribute('href')).toBe('https://x/nursing-diploma')
    expect(screen.getByRole('link', { name: 'https://x/rn-program' }).getAttribute('href')).toBe('https://x/rn-program')
  })

  it('shows both the member-truncation ("and N more") and clustersCapped notices when flagged', () => {
    const json = JSON.stringify({
      v: 1, observedPages: 200, clusteredCandidates: 150, threshold: 0.78, weights: { sig: 0.6, body: 0.4 },
      bodyPrefixTruncatedPages: 0, inputCapped: false, clustersCapped: true,
      clusters: [{ urls: ['https://x/a', 'https://x/b'], size: 5, membersTruncated: true, minEdgeSimilarity: 0.95 }],
    })
    render(<TopicOverlapSection run={{ topicOverlapJson: json }} />)
    expect(screen.getAllByText(/and 3 more/i).length).toBeGreaterThan(0)          // size 5 − 2 shown
    expect(screen.getAllByText(/showing the largest/i).length).toBeGreaterThan(0) // clustersCapped notice
  })

  it('renders methodology behind a hover-card Explainer', async () => {
    const user = userEvent.setup()
    render(<TopicOverlapSection run={{ topicOverlapJson: null }} />)
    const trigger = screen.getByRole('button', { name: 'How is topic overlap detected?' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getAllByText(/not analyzed/i).length).toBeGreaterThan(0)
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText(/embedded locally/i)).toBeTruthy()
  })
})
