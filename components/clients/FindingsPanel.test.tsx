// @vitest-environment jsdom
// components/clients/FindingsPanel.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { FindingsPanel, type FindingRowProp, type SourceMetaProp } from './FindingsPanel'

// globals:false → testing-library auto-cleanup is off; clean explicitly.
afterEach(cleanup)

const meta = (over: Partial<SourceMetaProp> = {}): SourceMetaProp => ({
  runAt: '2026-06-10T00:00:00.000Z', href: '/seo-parser/results/s1', domain: 'acme.example',
  hasPrevious: true, newTypeCount: 0, resolvedTypeCount: 0,
  newInstanceCount: null, resolvedInstanceCount: null, ...over,
})

const row = (over: Partial<FindingRowProp> = {}): FindingRowProp => ({
  tool: 'seo', type: 'broken_pages', severity: 'critical', count: 4,
  countDelta: null, isNew: false, description: 'Broken pages found', helpUrl: null,
  urls: ['https://acme.example/a', 'https://acme.example/b'], totalUrls: 2,
  isSample: false, href: '/seo-parser/results/s1', ...over,
})

describe('FindingsPanel', () => {
  it('renders humanized type, severity, count, and tool badge', () => {
    render(<FindingsPanel rows={[row()]} seo={meta()} ada={null} />)
    expect(screen.getByText('Broken pages')).toBeTruthy()
    expect(screen.getByText('critical')).toBeTruthy()
    // "SEO" appears twice by design: the source-meta line and the row's tool badge.
    expect(screen.getAllByText('SEO').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/4 URLs?/)).toBeTruthy()
  })

  it('shows NEW badge and worse-is-red delta', () => {
    render(
      <FindingsPanel
        rows={[
          row({ type: 'a_new', isNew: true }),
          row({ type: 'b_up', countDelta: 3 }),
          row({ type: 'c_down', countDelta: -2 }),
        ]}
        seo={meta({ newTypeCount: 1 })}
        ada={null}
      />,
    )
    expect(screen.getByText('NEW')).toBeTruthy()
    expect(screen.getByText('▲ +3')).toBeTruthy()
    expect(screen.getByText('▼ −2')).toBeTruthy()
  })

  it('expands affected URLs on click; sample annotation when isSample', () => {
    render(<FindingsPanel rows={[row({ isSample: true })]} seo={meta()} ada={null} />)
    expect(screen.queryByText('https://acme.example/a')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Broken pages/ }))
    expect(screen.getByText('https://acme.example/a')).toBeTruthy()
    expect(screen.getAllByText(/sample/i).length).toBeGreaterThanOrEqual(1)
  })

  it('sampled row with ZERO urls still shows the sample badge (Codex plan-fix #2)', () => {
    render(<FindingsPanel rows={[row({ isSample: true, urls: [], totalUrls: 0 })]} seo={meta()} ada={null} />)
    expect(screen.getByText('sample')).toBeTruthy()
  })

  it('shows capped-list footer link when totalUrls exceeds shown urls', () => {
    render(
      <FindingsPanel
        rows={[row({ urls: ['https://acme.example/a'], totalUrls: 40 })]}
        seo={meta()}
        ada={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Broken pages/ }))
    expect(screen.getByText(/Showing 1 of 40/)).toBeTruthy()
  })

  it('renders both empty states', () => {
    const { rerender } = render(<FindingsPanel rows={[]} seo={null} ada={null} />)
    expect(screen.getByText(/No findings data yet/)).toBeTruthy()
    rerender(<FindingsPanel rows={[]} seo={meta()} ada={null} />)
    expect(screen.getByText(/No open findings/)).toBeTruthy()
  })

  it('header shows source meta with new/resolved counts', () => {
    render(<FindingsPanel rows={[row()]} seo={meta({ newTypeCount: 2, resolvedTypeCount: 1 })} ada={null} />)
    expect(screen.getByText(/\+2 new/)).toBeTruthy()
    expect(screen.getByText(/1 resolved/)).toBeTruthy()
  })

  it('renders the instance violations clause when both counts are non-null', () => {
    render(
      <FindingsPanel
        rows={[]}
        seo={null}
        ada={meta({ sourceClass: 'site', newInstanceCount: 3, resolvedInstanceCount: 2 })}
      />,
    )
    expect(screen.getByText(/violations/)).toBeTruthy()
    expect(screen.getByText('+3')).toBeTruthy()
    expect(screen.getByText('−2')).toBeTruthy()
  })

  it('omits the violations clause when either instance count is null', () => {
    const { rerender } = render(
      <FindingsPanel rows={[]} seo={null} ada={meta({ sourceClass: 'site' })} />,
    )
    expect(screen.queryByText(/violations/)).toBeNull()
    rerender(
      <FindingsPanel rows={[]} seo={null} ada={meta({ sourceClass: 'site', newInstanceCount: 3 })} />,
    )
    expect(screen.queryByText(/violations/)).toBeNull()
  })
})
