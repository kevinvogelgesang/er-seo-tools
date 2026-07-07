// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
})
