// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DiscoveryCoverageSection } from './DiscoveryCoverageSection'

afterEach(cleanup)

const cov = (o: object) => ({ discoveryCoverageJson: JSON.stringify(o) })

describe('DiscoveryCoverageSection', () => {
  it('renders nothing when run is null or column is absent', () => {
    const { container } = render(<DiscoveryCoverageSection run={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the off-sitemap count + rate for an applicable measurement', () => {
    const { container } = render(
      <DiscoveryCoverageSection
        run={cov({ applicable: true, mode: 'sitemap', capped: false, discoveredCount: 10, offBaselineCount: 3, missRate: 0.23, sample: [] })}
      />,
    )
    expect(screen.getByText(/3 additional same-domain URLs/i)).toBeTruthy()
    expect(container.textContent).toMatch(/23%/)
  })

  it('shows "not applicable" for shallow-crawl / capped', () => {
    render(<DiscoveryCoverageSection run={cov({ applicable: false, mode: 'shallow-crawl', capped: false, offBaselineCount: 5, missRate: null, sample: [] })} />)
    expect(screen.getByText(/not measured/i)).toBeTruthy()
  })

  it('shows a clean state when nothing is off-sitemap', () => {
    render(<DiscoveryCoverageSection run={cov({ applicable: true, mode: 'sitemap', capped: false, discoveredCount: 8, offBaselineCount: 0, missRate: 0, sample: [] })} />)
    expect(screen.getByText(/every internally-linked URL was in the sitemap/i)).toBeTruthy()
  })
})
