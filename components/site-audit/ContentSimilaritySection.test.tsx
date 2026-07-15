// @vitest-environment jsdom
import '../../test/setup-jsdom-observers'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContentSimilaritySection } from './ContentSimilaritySection'

afterEach(cleanup)
const sim = (o: object) => ({ contentSimilarityJson: JSON.stringify({ v: 1, ...o }) })

describe('ContentSimilaritySection', () => {
  it('renders nothing when run is null', () => {
    expect(render(<ContentSimilaritySection run={null} />).container.innerHTML).toBe('')
  })
  it('renders nothing when contentSimilarityJson is null', () => {
    expect(render(<ContentSimilaritySection run={{ contentSimilarityJson: null }} />).container.innerHTML).toBe('')
  })
  it('shows a clean state when there are no duplicate groups', () => {
    const { container } = render(<ContentSimilaritySection run={sim({ pagesEligible: 40, exactDuplicateGroups: [], nearDuplicateGroups: [] })} />)
    expect(container.textContent).toMatch(/no duplicate/i)
  })
  it('lists exact and near duplicate groups', () => {
    const { container } = render(<ContentSimilaritySection run={sim({
      pagesEligible: 40, boilerplateShinglesDropped: 12,
      exactDuplicateGroups: [{ urls: ['/a', '/b'], count: 2 }],
      nearDuplicateGroups: [{ urls: ['/c', '/d'], similarity: 0.93 }],
    })} />)
    expect(container.textContent).toContain('/a')
    expect(container.textContent).toMatch(/93%/)
    expect(screen.getByText(/exact duplicates/i)).toBeTruthy()
  })
  it('renders methodology behind a hover-card Explainer', async () => {
    const user = userEvent.setup()
    render(<ContentSimilaritySection run={sim({ pagesEligible: 40, exactDuplicateGroups: [], nearDuplicateGroups: [] })} />)
    const trigger = screen.getByRole('button', { name: 'How is content similarity measured?' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText(/five-word phrases/i)).toBeTruthy()
  })
})
