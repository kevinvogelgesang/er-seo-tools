// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReachabilitySection } from './ReachabilitySection'

afterEach(cleanup)

const reach = (o: object) => ({ reachabilityJson: JSON.stringify(o) })
const measured = {
  v: 1, nodeCount: 100, indexableNodeCount: 88, edgeCount: 400, homepageResolved: true,
  orphanCount: 6, orphanSample: ['https://x.test/orphan'],
  unreachableCount: 4, unreachableSample: ['https://x.test/lost'],
  depthHistogram: { '0': 1, '1': 22, '2': 48, '3': 13, '4plus': 0, 'null': 4 },
  maxDepth: 3, deepSample: [],
}

describe('ReachabilitySection', () => {
  it('renders nothing when the column is null', () => {
    const { container } = render(<ReachabilitySection run={{ reachabilityJson: null }} />)
    expect(container.innerHTML).toBe('')
  })
  it('renders nothing when run is null', () => {
    const { container } = render(<ReachabilitySection run={null} />)
    expect(container.innerHTML).toBe('')
  })
  it('renders orphan + unreachable counts and the orphan sample in the measured state', () => {
    const { container } = render(<ReachabilitySection run={reach(measured)} />)
    expect(screen.getByText(/6/)).toBeTruthy()
    expect(container.textContent).toMatch(/orphan/i)
    expect(screen.getByText('https://x.test/orphan')).toBeTruthy()
  })
  it('shows the homepage-unresolved copy when homepageResolved is false', () => {
    render(<ReachabilitySection run={reach({ ...measured, homepageResolved: false })} />)
    expect(screen.getByText(/homepage not found/i)).toBeTruthy()
  })
})
