// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BrokenLinksSection, type BrokenLinksRun } from './BrokenLinksSection'

afterEach(cleanup)

const runFinding = (type: string, count: number, detail: object = {}) =>
  ({ scope: 'run', type, count, url: null, detail: JSON.stringify(detail) })
const pageFinding = (type: string, url: string, targets: string[]) =>
  ({ scope: 'page', type, count: targets.length, url, detail: JSON.stringify({ brokenTargetUrls: targets }) })

describe('BrokenLinksSection — external links', () => {
  it('shows not-verified when run is null', () => {
    render(<BrokenLinksSection run={null} />)
    expect(screen.getByText(/not yet verified/i)).toBeTruthy()
  })

  it('shows plain verified-clean when everything clean and complete', () => {
    render(<BrokenLinksSection run={{ status: 'complete', findings: [] }} />)
    expect(screen.getByText(/no broken links or images found/i)).toBeTruthy()
    expect(screen.queryByText(/partial/i)).toBeNull()
  })

  it('appends a partial note to the clean state when run.status is partial', () => {
    render(<BrokenLinksSection run={{ status: 'partial', findings: [] }} />)
    expect(screen.getByText(/no broken links or images found/i)).toBeTruthy()
    expect(screen.getByText(/partial/i)).toBeTruthy()
  })

  it('renders the external warning block (amber) when external links are broken', () => {
    const run: BrokenLinksRun = {
      status: 'complete',
      findings: [
        runFinding('broken_external_links', 2, { checked: 5, unconfirmed: 1 }),
        pageFinding('broken_external_links', 'https://site.example/a', ['https://out.example/dead']),
      ],
    }
    render(<BrokenLinksSection run={run} />)
    const label = screen.getByText(/Broken external links/i)
    expect(label.className).toMatch(/amber/) // warning tier, not red
    expect(screen.getByText(/https:\/\/site\.example\/a/)).toBeTruthy()
  })

  it('renders both tiers when internal and external are both broken', () => {
    const run: BrokenLinksRun = {
      status: 'complete',
      findings: [
        runFinding('broken_internal_links', 1, { checked: 3 }),
        runFinding('broken_external_links', 1, { checked: 2 }),
      ],
    }
    render(<BrokenLinksSection run={run} />)
    expect(screen.getByText(/Broken internal links/i)).toBeTruthy()
    expect(screen.getByText(/Broken external links/i)).toBeTruthy()
  })

  it('renders only the internal tier when internal broken but external clean', () => {
    const run: BrokenLinksRun = {
      status: 'complete',
      findings: [runFinding('broken_internal_links', 1, { checked: 3 })],
    }
    render(<BrokenLinksSection run={run} />)
    expect(screen.getByText(/Broken internal links/i)).toBeTruthy()
    expect(screen.queryByText(/Broken external links/i)).toBeNull()
  })

  it('derives per-tier partial from the finding detail, not global run.status', () => {
    // External capped (its detail says so); internal complete. Only the external tier shows partial.
    const run: BrokenLinksRun = {
      status: 'partial',
      findings: [
        runFinding('broken_internal_links', 1, { checked: 3, capped: false, harvestTruncated: false }),
        runFinding('broken_external_links', 1, { checked: 2, capped: true, harvestTruncated: false }),
      ],
    }
    render(<BrokenLinksSection run={run} />)
    // Exactly one "partial" note (the external tier's), not one on the internal tier too.
    expect(screen.getAllByText(/partial/i)).toHaveLength(1)
  })
})
