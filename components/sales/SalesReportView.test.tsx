// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SalesReportView } from './SalesReportView'
import type { SalesReportData } from '@/lib/sales/sales-report-data'

afterEach(cleanup)

const data: SalesReportData = {
  prospect: { id: 1, name: 'Acme College', domain: 'acme.test' },
  auditId: 'aud1', completedAt: '2026-07-09T00:00:00.000Z', pagesTotal: 5,
  preparedBy: 'Kevin', archived: false,
  headline: { accessibilityScore: 62, seoScore: 71, performanceScore: 40, schemaCoveragePct: 40 },
  accessibility: {
    score: 62,
    counts: { critical: 4, serious: 10, moderate: 2, minor: 1, total: 17 },
    patterns: [{
      ruleId: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast',
      description: 'd', affectedPagesCount: 3, totalPagesScanned: 5,
      examples: [{ html: '<a class="cta">Apply</a>', selector: 'a.cta', screenshotFile: 'color-contrast-0.png', adaAuditId: 'child1', pageUrl: 'https://acme.test/a' }],
    }],
  },
  seo: {
    score: 71,
    issueGroups: [{ type: 'broken_internal_links', label: 'Broken links on your site', count: 7, examplePages: ['https://acme.test/0'] }],
    duplicateContentGroups: 2, sitemapMissRatePct: 12,
  },
  performance: {
    measuredPages: 3, medianPerformance: 40, p75LcpMs: 4200, p75Cls: 0.3, p75TbtMs: 700,
    pctPassing: 0, scoreBuckets: { good: 0, fair: 1, poor: 2 },
    worstPages: [{ url: 'https://acme.test/slow', performance: 22 }],
  },
  geo: {
    coveragePct: 40, pagesWithSchema: 2, observedPages: 5,
    types: [{ type: 'Organization', pages: 2 }],
    missingHighValueTypes: ['Course', 'FAQPage'], hreflangIssueCount: 0,
  },
}

describe('SalesReportView', () => {
  it('renders hero, four sections, evidence, and CTA', () => {
    render(<SalesReportView data={data} token="tok1" contactEmail="kevin@enrollmentresources.com" />)
    expect(screen.getByText(/prepared for/i)).toBeTruthy()
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.getByText('Accessibility')).toBeTruthy()
    expect(screen.getByText('SEO')).toBeTruthy()
    expect(screen.getByText('Performance')).toBeTruthy()
    expect(screen.getAllByText(/structured data/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Broken links on your site')).toBeTruthy()
    expect(screen.getByText(/prepared by kevin/i)).toBeTruthy()
    // curated screenshot URL is token-scoped
    const img = screen.getByRole('img', { name: /color-contrast/i }) as HTMLImageElement
    expect(img.src).toContain('/api/sales/tok1/screenshot/child1/color-contrast-0.png')
    // honest labeling: no compliance/CWV-pass claims
    expect(screen.queryByText(/wcag compliant/i)).toBeNull()
    expect(screen.getAllByText(/lighthouse-measured/i).length).toBeGreaterThan(0)
  })

  it('renders performance absence gracefully', () => {
    render(<SalesReportView data={{ ...data, performance: null }} token="t" contactEmail="x@y.z" />)
    expect(screen.getByText(/not enough pages were measured/i)).toBeTruthy()
  })
})
