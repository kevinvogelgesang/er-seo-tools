// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SalesReportView } from './SalesReportView'
import type { SalesReportData } from '@/lib/sales/sales-report-data'

afterEach(cleanup)
beforeEach(() => {
  // jsdom has no matchMedia; reduced-motion=true keeps gauge/bars static.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as never
})

const data: SalesReportData = {
  prospect: { id: 1, name: 'Acme College', domain: 'acme.test' },
  auditId: 'aud1', completedAt: '2026-07-14T00:00:00.000Z', pagesTotal: 10,
  preparedBy: 'Kevin', archived: false,
  overallScore: 53, heroScreenshot: true, standardTested: 'WCAG 2.1 AA',
  headline: { accessibilityScore: 62, seoScore: 71, performanceScore: 40, schemaCoveragePct: 40 },
  accessibility: {
    score: 62,
    counts: { critical: 4, serious: 10, moderate: 2, minor: 1, total: 17 },
    issueTypes: [
      { ruleId: 'image-alt', help: 'Images must have alternate text', impact: 'critical', affectedPages: 5 },
      { ruleId: 'color-contrast', help: 'Elements must have sufficient color contrast', impact: 'serious', affectedPages: 8 },
    ],
  },
  seo: {
    score: 71,
    issueGroups: [
      { type: 'broken_internal_links', label: 'Broken links on your site', count: 7, affectedPages: 4, affectedComplete: true, examplePages: ['https://acme.test/0'] },
      { type: 'thin_content', label: 'Thin-content pages', count: 9, affectedPages: 3, affectedComplete: false, examplePages: [] },
    ],
    duplicateContentGroups: 2, sitemapMissRatePct: 12,
  },
  performance: {
    rollup: {
      measuredPages: 3, medianPerformance: 40, p75LcpMs: 4200, p75Cls: 0.3, p75TbtMs: 700,
      pctPassing: 0, scoreBuckets: { good: 0, fair: 1, poor: 2 },
      worstPages: [{ url: 'https://acme.test/slow', performance: 22 }],
    },
    homepage: {
      performance: 55, lcpMs: 3100, cls: 0.12, tbtMs: 350,
      lcpStatus: 'needs-improvement', clsStatus: 'needs-improvement', tbtStatus: 'needs-improvement',
    },
  },
  geo: {
    coveragePct: 40, pagesWithSchema: 2, observedPages: 5,
    types: [{ type: 'Organization', pages: 2 }],
    missingHighValueTypes: ['Course', 'FAQPage', 'BreadcrumbList'], hreflangIssueCount: 0,
  },
}

describe('SalesReportView (C14 urgency redesign)', () => {
  it('renders header, hero row, tiles, four sections, and the inquiry form', () => {
    render(<SalesReportView data={data} token="tok1" contactEmail="kevin@enrollmentresources.com" />)
    expect(screen.getByText('Website Audit Report')).toBeTruthy()
    expect(screen.getByRole('button', { name: /book a review/i })).toBeTruthy()
    // hero: token-scoped screenshot URL + gauge value
    const hero = screen.getByRole('img', { name: /homepage of acme.test/i }) as HTMLImageElement
    expect(hero.src).toContain('/api/sales/tok1/hero/aud1')
    expect(screen.getByText('53')).toBeTruthy()
    // sections
    expect(screen.getByText('Accessibility')).toBeTruthy()
    expect(screen.getByText('SEO')).toBeTruthy()
    expect(screen.getByText('Performance')).toBeTruthy()
    expect(screen.getAllByText(/structured data/i).length).toBeGreaterThan(0)
    // inquiry form replaced the mailto footer
    expect(document.querySelector('#inquiry')).toBeTruthy()
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy()
  })

  it('accessibility shows generic issue TYPES (no element screenshots or site-specific instances)', () => {
    render(<SalesReportView data={data} token="tok1" contactEmail="x@y.z" />)
    expect(screen.getByText('4')).toBeTruthy() // critical tile
    expect(screen.getByText(/tested against wcag 2.1 aa/i)).toBeTruthy()
    // generic axe rule descriptions ARE shown now (Kevin pass 2)…
    expect(screen.getByText(/the kinds of barriers we found/i)).toBeTruthy()
    expect(screen.getByText(/sufficient color contrast/i)).toBeTruthy()
    expect(screen.getByText(/images must have alternate text/i)).toBeTruthy()
    expect(screen.getByText(/found on 8 pages/i)).toBeTruthy()
    // …but no per-element screenshots / site-specific instances
    expect(document.querySelector('img[src*="/screenshot/"]')).toBeNull()
    // sanctioned ER-product ADA claim present
    expect(screen.getByText(/enrollment resources builds is ada-compliant/i)).toBeTruthy()
  })

  it('SEO urgency rows: bar driven by affectedPages; "at least" phrasing on incomplete evidence', () => {
    render(<SalesReportView data={data} token="tok1" contactEmail="x@y.z" />)
    expect(screen.getByText('4 of 10 pages affected')).toBeTruthy()
    expect(screen.getByText('At least 3 of 10 pages affected')).toBeTruthy()
    // urgency bar widths come from affectedPages/pagesScanned (reduced motion = immediate)
    const bar = screen.getByRole('img', { name: /broken links on your site: 4 of 10 pages affected/i })
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('40%')
  })

  it('schema grid: ✓/✗ per high-value type with evidence-bounded absence copy', () => {
    render(<SalesReportView data={data} token="tok1" contactEmail="x@y.z" />)
    expect(screen.getAllByText(/not observed on the 5 pages we scanned/i).length).toBe(3)
    expect(screen.getAllByText(/coverage may be partial/i).length).toBeGreaterThan(0) // observedPages 5 < pagesTotal 10
  })

  it('homepage CWV card renders even when the rollup is null; hero slot hidden when absent', () => {
    render(
      <SalesReportView
        data={{ ...data, heroScreenshot: false, performance: { rollup: null, homepage: data.performance.homepage } }}
        token="t" contactEmail="x@y.z"
      />,
    )
    expect(screen.queryByRole('img', { name: /homepage of/i })).toBeNull()
    expect(screen.getByText('Your homepage')).toBeTruthy()
    expect(screen.getByText('3.1s')).toBeTruthy()
  })

  it('honest labeling: no prospect compliance claims; lab framing kept', () => {
    render(<SalesReportView data={data} token="tok1" contactEmail="x@y.z" />)
    expect(screen.queryByText(/wcag compliant/i)).toBeNull()
    expect(screen.getAllByText(/lighthouse-measured/i).length).toBeGreaterThan(0)
  })
})
