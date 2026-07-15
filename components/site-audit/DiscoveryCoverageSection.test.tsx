// @vitest-environment jsdom
import '../../test/setup-jsdom-observers'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('shows dual miss-rate for a successful hybrid run, not the "not measured" text', () => {
    render(
      <DiscoveryCoverageSection
        run={cov({
          mode: 'hybrid',
          capped: false,
          applicable: false,
          discoveredCount: 10,
          offBaselineCount: 2,
          missRate: null,
          sample: [],
          sitemapMissRate: 0.4,
          sitemapApplicable: true,
          residualMissRate: 0.05,
          residualApplicable: true,
        })}
      />,
    )
    expect(screen.getByText(/40% of internally-reachable URLs/i)).toBeTruthy()
    expect(screen.getByText(/5% remained undiscovered/i)).toBeTruthy()
    expect(screen.queryByText(/not measured/i)).toBeNull()
  })

  it('renders methodology behind a hover-card Explainer', async () => {
    const user = userEvent.setup()
    render(<DiscoveryCoverageSection run={cov({ applicable: false, mode: 'shallow-crawl', capped: false, offBaselineCount: 5, missRate: null, sample: [] })} />)
    const trigger = screen.getByRole('button', { name: 'What is discovery coverage measuring?' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByText(/not measured/i)).toBeTruthy()
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText(/the sitemap advertised/i)).toBeTruthy()
  })
})
