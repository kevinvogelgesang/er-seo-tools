// @vitest-environment jsdom
import '../../test/setup-jsdom-observers'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DeadPagesSection } from './DeadPagesSection'

afterEach(cleanup)

describe('DeadPagesSection', () => {
  it('renders each dead audited URL with its 404 or 410 status code', () => {
    render(
      <DeadPagesSection
        run={{
          status: 'complete',
          findings: [
            { scope: 'page', type: 'dead_page', count: 1, url: 'https://site.example/gone', detail: JSON.stringify({ statusCode: 404 }) },
            { scope: 'page', type: 'dead_page', count: 1, url: 'https://site.example/retired', detail: JSON.stringify({ statusCode: 410 }) },
          ],
        }}
      />,
    )

    expect(screen.getByText('https://site.example/gone')).toBeTruthy()
    expect(screen.getByText('https://site.example/retired')).toBeTruthy()
    expect(screen.getByText('404')).toBeTruthy()
    expect(screen.getByText('410')).toBeTruthy()
  })

  it('shows the clean state when the run contains no dead-page findings', () => {
    render(<DeadPagesSection run={{ status: 'complete', findings: [] }} />)

    expect(screen.getByText(/no dead pages found/i)).toBeTruthy()
  })

  it('shows not-scanned when there is no live scan run', () => {
    const { container } = render(<DeadPagesSection run={null} />)

    expect(screen.getByText(/not yet scanned/i)).toBeTruthy()
    expect(container.querySelector('section')?.className).toContain('dark:bg-navy-card')
  })
})
