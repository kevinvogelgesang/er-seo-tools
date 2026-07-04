// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TechnicalSeoSection } from './TechnicalSeoSection'

afterEach(cleanup)

const run = (findings: any[]) => ({ status: 'complete', findings })

describe('TechnicalSeoSection', () => {
  it('not-analyzed state when run is null', () => {
    render(<TechnicalSeoSection run={null} analyzed={false} />)
    expect(screen.getByText(/not yet analyzed|runs shortly/i)).toBeTruthy()
  })
  it('clean state when analyzed with no validation findings', () => {
    render(<TechnicalSeoSection run={run([{ scope: 'run', type: 'broken_internal_links', count: 3, url: null, detail: null }])} analyzed={true} />)
    expect(screen.getByText(/No canonical, redirect, or hreflang issues/i)).toBeTruthy()
  })
  it('renders grouped validation findings', () => {
    render(<TechnicalSeoSection analyzed={true} run={run([
      { scope: 'run', type: 'canonical_broken', count: 2, url: null, detail: JSON.stringify({ description: 'x' }) },
      { scope: 'page', type: 'canonical_broken', count: 1, url: 'https://x.com/a', detail: null },
      { scope: 'run', type: 'redirect_chain', count: 1, url: null, detail: null },
    ])} />)
    expect(screen.getByText(/Canonical broken/i)).toBeTruthy()
    expect(screen.getByText('https://x.com/a')).toBeTruthy()
    expect(screen.getByText(/Redirect chain/i)).toBeTruthy()
  })
})
