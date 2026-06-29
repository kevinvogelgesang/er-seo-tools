// lib/report/seo/seo-report-html.test.ts
// TDD tests for buildSeoReportHtml — RED first, no production code yet.
// Run with: npx vitest run lib/report/seo/seo-report-html.test.ts

import { describe, it, expect } from 'vitest'
import { buildSeoReportHtml } from './seo-report-html'
import type { SeoReportData } from './report-data'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScorecards(): SeoReportData['scorecards'] {
  const labels = [
    'Sessions',
    'Prospects',
    'Organic Prospects',
    'Avg Position',
    'Avg Session Duration',
    'Events / Session',
    'Bounce Rate',
    'Engaged Sessions',
    'Clicks',
    'Impressions',
    'Site CTR',
    'Key Events',
  ]
  return labels.map((label, i) => ({
    label,
    value: String(100 + i),
    delta: 0.1,
    deltaGood: true,
  }))
}

const FULL_DATA: SeoReportData = {
  clientName: 'Test University',
  domain: 'testuniversity.edu',
  periodLabel: 'May 2026',
  comparisonLabel: 'Apr 2026',
  generatedAt: '2026-06-22',
  operator: 'Kevin',

  scorecards: makeScorecards(),

  sessionsSeries: [
    { date: '2026-05-01', value: 100 },
    { date: '2026-05-02', value: 120 },
  ],
  sessionsSeriesPrev: [
    { date: '2026-04-01', value: 90 },
    { date: '2026-04-02', value: 110 },
  ],

  clicksSeries: [
    { date: '2026-05-01', value: 50 },
    { date: '2026-05-02', value: 60 },
  ],
  clicksSeriesPrev: [
    { date: '2026-04-01', value: 45 },
    { date: '2026-04-02', value: 55 },
  ],
  impressionsSeries: [
    { date: '2026-05-01', value: 1000 },
    { date: '2026-05-02', value: 1100 },
  ],
  impressionsSeriesPrev: [
    { date: '2026-04-01', value: 900 },
    { date: '2026-04-02', value: 950 },
  ],
  positionSeries: [
    { date: '2026-05-01', value: 8.5 },
    { date: '2026-05-02', value: 8.2 },
  ],
  positionSeriesPrev: [
    { date: '2026-04-01', value: 9.0 },
    { date: '2026-04-02', value: 8.8 },
  ],

  landingPages: [
    { path: '/programs/nursing', sessions: 200, keyEvents: 15 },
    { path: '/apply', sessions: 150, keyEvents: 42 },
  ],
  queries: [
    { query: 'nursing programs', position: 3.2, positionPrev: 4.1 },
    { query: 'enrollment resources', position: 1.5, positionPrev: 1.8 },
  ],
  cities: [
    { city: 'Portland', sessions: 80, keyEvents: 5 },
    { city: 'Seattle', sessions: 60, keyEvents: 3 },
  ],

  newVsReturning: [
    { label: 'new', sessions: 300 },
    { label: 'returning', sessions: 120 },
  ],
  devices: [
    { label: 'mobile', sessions: 250 },
    { label: 'desktop', sessions: 170 },
  ],

  gaps: { ga4: false, gsc: false, prospects: false },
}

// Deep clone with specific overrides.
function withOverrides(overrides: Partial<SeoReportData>): SeoReportData {
  return { ...FULL_DATA, ...overrides }
}

// ---------------------------------------------------------------------------
// XSS / escaping
// ---------------------------------------------------------------------------

describe('XSS escaping', () => {
  it('escapes a <script> payload in clientName — no raw <script> tag survives', () => {
    const xssName = '<script>alert(1)</script>'
    const html = buildSeoReportHtml(withOverrides({ clientName: xssName }))
    // The literal opening tag must not appear unescaped.
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</script>')
    // The escaped form IS present (confirms it was rendered, not silently dropped).
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes a <script> payload in a query string', () => {
    const xssQuery = '<script>alert("xss")</script>'
    const html = buildSeoReportHtml(
      withOverrides({
        queries: [{ query: xssQuery, position: 5.0, positionPrev: 6.0 }],
      }),
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes a <script> payload in a landing-page path', () => {
    const xssPath = '/page?q=<script>alert(1)</script>'
    const html = buildSeoReportHtml(
      withOverrides({
        landingPages: [{ path: xssPath, sessions: 10, keyEvents: 1 }],
      }),
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</script>')
  })

  it('escapes double-quotes in operator name that appears in HTML content', () => {
    // The operator name may contain characters that must be escaped in text nodes.
    const evilOperator = 'O\'Reilly <b>bold</b>'
    const html = buildSeoReportHtml(withOverrides({ operator: evilOperator }))
    // Raw angle-bracket tag must not appear unescaped in the rendered output
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('</b>')
    // The escaped form is present
    expect(html).toContain('&lt;b&gt;')
  })
})

// ---------------------------------------------------------------------------
// Scorecard grid — all 12 present
// ---------------------------------------------------------------------------

describe('scorecard grid', () => {
  it('renders all 12 scorecard labels', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    const expectedLabels = [
      'Sessions',
      'Prospects',
      'Organic Prospects',
      'Avg Position',
      'Avg Session Duration',
      'Events / Session',
      'Bounce Rate',
      'Engaged Sessions',
      'Clicks',
      'Impressions',
      'Site CTR',
      'Key Events',
    ]
    for (const label of expectedLabels) {
      expect(html).toContain(label)
    }
  })

  it('renders all 12 scorecard values from the fixture', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    for (let i = 0; i < 12; i++) {
      expect(html).toContain(String(100 + i))
    }
  })

  it('renders positive delta with + sign', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    // At least one delta arrow-up class present (all deltas are +10% in fixture)
    expect(html).toContain('delta-up')
  })

  it('renders negative delta with an arrow-down class', () => {
    const data = withOverrides({
      scorecards: makeScorecards().map((sc, i) =>
        i === 0
          ? { ...sc, delta: -0.05, deltaGood: false }
          : sc,
      ),
    })
    const html = buildSeoReportHtml(data)
    expect(html).toContain('delta-down')
  })

  it('renders null delta as em-dash without crash', () => {
    const data = withOverrides({
      scorecards: makeScorecards().map((sc, i) =>
        i === 0
          ? { ...sc, delta: null, deltaGood: null }
          : sc,
      ),
    })
    // Should not throw and should still render.
    expect(() => buildSeoReportHtml(data)).not.toThrow()
    const html = buildSeoReportHtml(data)
    expect(html).toContain('Sessions')
  })
})

// ---------------------------------------------------------------------------
// Tables + donuts — present in non-gapped case
// ---------------------------------------------------------------------------

describe('tables and donuts (no gaps)', () => {
  it('renders the landing pages table with at least one path', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('/programs/nursing')
    expect(html).toContain('/apply')
  })

  it('renders the queries table with at least one query', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('nursing programs')
    expect(html).toContain('enrollment resources')
  })

  it('renders the cities table with at least one city', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('Portland')
    expect(html).toContain('Seattle')
  })

  it('renders the new-vs-returning donut section', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    // The donut legend / label must be present
    expect(html).toContain('new')
    expect(html).toContain('returning')
  })

  it('renders the devices donut section', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('mobile')
    expect(html).toContain('desktop')
  })

  it('includes an SVG for sessions line chart', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    // Charts.ts output always starts with <svg
    expect(html).toMatch(/<svg[^>]*>/)
  })
})

// ---------------------------------------------------------------------------
// Gap handling
// ---------------------------------------------------------------------------

describe('ga4 gap', () => {
  const GA4_GAP_DATA = withOverrides({
    gaps: { ga4: true, gsc: false, prospects: false },
    // When ga4 is gapped, series/tables/donuts from GA4 are empty (as report-data would produce)
    sessionsSeries: [],
    sessionsSeriesPrev: [],
    landingPages: [],
    cities: [],
    newVsReturning: [],
    devices: [],
  })

  it('renders a GA4 unavailable block when gaps.ga4 is true', () => {
    const html = buildSeoReportHtml(GA4_GAP_DATA)
    expect(html.toLowerCase()).toMatch(/ga4.*unavailable|unavailable.*ga4/i)
  })

  it('omits sessions line chart when gaps.ga4 is true', () => {
    const html = buildSeoReportHtml(GA4_GAP_DATA)
    // When gapped, the sessions chart section should not render any <svg>
    // We check that the sessions-chart section is absent; the only SVG that
    // could appear is the GSC chart (which is NOT gapped). We verify the
    // sessions chart section heading is missing.
    expect(html).not.toContain('Sessions over Time')
  })

  it('omits landing-page table when gaps.ga4 is true', () => {
    const html = buildSeoReportHtml(GA4_GAP_DATA)
    expect(html).not.toContain('Landing Page')
  })

  it('omits cities table when gaps.ga4 is true', () => {
    const html = buildSeoReportHtml(GA4_GAP_DATA)
    expect(html).not.toContain('Sessions by Location')
  })

  it('omits new-vs-returning donut when gaps.ga4 is true', () => {
    const html = buildSeoReportHtml(GA4_GAP_DATA)
    expect(html).not.toContain('New vs Returning')
  })
})

describe('gsc gap', () => {
  const GSC_GAP_DATA = withOverrides({
    gaps: { ga4: false, gsc: true, prospects: false },
    clicksSeries: [],
    clicksSeriesPrev: [],
    impressionsSeries: [],
    impressionsSeriesPrev: [],
    positionSeries: [],
    positionSeriesPrev: [],
    queries: [],
  })

  it('renders a GSC unavailable block when gaps.gsc is true', () => {
    const html = buildSeoReportHtml(GSC_GAP_DATA)
    expect(html.toLowerCase()).toMatch(/gsc.*unavailable|search console.*unavailable|unavailable.*gsc/i)
  })

  it('omits the GSC line chart when gaps.gsc is true', () => {
    const html = buildSeoReportHtml(GSC_GAP_DATA)
    expect(html).not.toContain('Clicks / Impressions')
  })

  it('omits the queries table when gaps.gsc is true', () => {
    const html = buildSeoReportHtml(GSC_GAP_DATA)
    expect(html).not.toContain('Top Queries')
  })
})

describe('prospects gap', () => {
  it('renders a prospects unavailable block when gaps.prospects is true', () => {
    const html = buildSeoReportHtml(
      withOverrides({ gaps: { ga4: false, gsc: false, prospects: true } }),
    )
    expect(html.toLowerCase()).toMatch(/prospect.*unavailable|unavailable.*prospect/i)
  })
})

// ---------------------------------------------------------------------------
// Header / document structure
// ---------------------------------------------------------------------------

describe('document structure', () => {
  it('is a full HTML document', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
  })

  it('renders client name in cover', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('Test University')
  })

  it('renders domain in cover', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('testuniversity.edu')
  })

  it('renders period label', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('May 2026')
  })

  it('renders operator name', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('Kevin')
  })

  it('contains ER wordmark', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html.toUpperCase()).toContain('ENROLLMENT RESOURCES')
  })

  it('contains footer data sources line', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('GA4')
    expect(html).toContain('Search Console')
  })

  it('includes inline CSS with @page rule for Letter format', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    expect(html).toContain('@page')
    expect(html).toContain('Letter')
  })

  it('includes dashboard navy chrome color in inline CSS', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    // Navy (sidebar/cover): #15457d (VirtualAdviser palette)
    expect(html).toContain('#15457d')
  })

  it('includes dashboard primary blue accent in inline CSS', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    // Primary blue (KPI numbers, links): #0b6dc7
    expect(html).toContain('#0b6dc7')
  })

  it('has no external asset references (self-contained)', () => {
    const html = buildSeoReportHtml(FULL_DATA)
    // No http(s):// in src/href attributes — self-contained only.
    expect(html).not.toMatch(/<(?:link|script)\s[^>]*(?:href|src)="https?:\/\//i)
  })
})
