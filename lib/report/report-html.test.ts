// lib/report/report-html.test.ts
import { describe, it, expect } from 'vitest'
import { buildSiteReportHtml, type SiteReportData, type ReportTopIssue } from './report-html'
import type { InstanceDiff } from '@/lib/services/findings-shared'
import type { ScorePoint } from '@/lib/services/scorecard-shared'

const AGGREGATE = { critical: 3, serious: 2, moderate: 1, minor: 0, total: 6, passed: 120, incomplete: 4 }

const XSS_NODE = '<img src=x onerror=alert(1)>'

function issue(overrides: Partial<ReportTopIssue> = {}): ReportTopIssue {
  return {
    ruleId: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.8/image-alt',
    pageCount: 7,
    sampleUrls: ['https://college.example.edu/a', 'https://college.example.edu/b'],
    nodeSamples: [XSS_NODE],
    screenshot: null,
    ...overrides,
  }
}

function fixture(overrides: Partial<SiteReportData> = {}): SiteReportData {
  return {
    siteAuditId: 'aud1',
    domain: 'college.example.edu',
    clientName: 'Example College',
    wcagLevel: 'wcag21aa',
    auditDate: '2026-06-10T12:00:00.000Z',
    generatedAt: '2026-06-12T08:00:00.000Z',
    requestedBy: 'Kevin',
    score: 87,
    compliant: false,
    archived: false,
    pagesTotal: 40,
    pagesError: 1,
    aggregate: AGGREGATE,
    archivedCounts: null,
    trend: [],
    diff: null,
    previousCompletedAt: null,
    topIssues: [issue(), issue({ ruleId: 'mystery-rule', impact: 'unknown', help: null })],
    worstPages: [
      { url: 'https://college.example.edu/a', critical: 2, serious: 1, moderate: 0, minor: 0, total: 3 },
    ],
    issuePagesTotal: 12,
    pdfsTotal: 3,
    pdfsWithIssues: 1,
    ...overrides,
  }
}

const trendPoints = (n: number): ScorePoint[] =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-0${(i % 9) + 1}-0${(i % 9) + 1}T00:00:00.000Z`,
    score: 50 + i,
  }))

const DIFF: InstanceDiff = {
  newCount: 5,
  regressedCount: 3,
  newPageCount: 2,
  resolvedCount: 4,
  notRescannedCount: 1,
  unchangedCount: 7,
  rules: [{
    type: 'image-alt', severity: 'critical',
    newUrls: ['https://college.example.edu/a'], newTotal: 3, regressedTotal: 3,
    resolvedUrls: [], resolvedTotal: 0, unchangedTotal: 1,
  }],
}

describe('buildSiteReportHtml', () => {
  it('renders the document shell: doctype, domain, score, brand', () => {
    const html = buildSiteReportHtml(fixture())
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('college.example.edu')
    expect(html).toContain('<div class="score-big">87</div>')
    expect(html).toContain('Enrollment Resources')
  })

  it('escapes node HTML samples — raw markup never reaches the document', () => {
    const html = buildSiteReportHtml(fixture())
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img src=x')
  })

  it("renders the 'unknown' impact verbatim with the neutral color", () => {
    const html = buildSiteReportHtml(fixture())
    expect(html).toContain('>unknown</span>')
    expect(html).toContain('background:#6b7280')
  })

  describe('score trend', () => {
    it('omits the section with 0 points', () => {
      const html = buildSiteReportHtml(fixture({ trend: [] }))
      expect(html).not.toContain('Score trend')
    })
    it('renders the section without a polyline for 1 point', () => {
      const html = buildSiteReportHtml(fixture({ trend: trendPoints(1) }))
      expect(html).toContain('Score trend')
      expect(html).not.toContain('<polyline')
    })
    it('renders a polyline for 12 points', () => {
      const html = buildSiteReportHtml(fixture({ trend: trendPoints(12) }))
      expect(html).toContain('<polyline')
    })
    it('marks a v1→v2 boundary with a dashed segment and an escaped annotation, not a plain solid line', () => {
      const html = buildSiteReportHtml(fixture({
        trend: [
          { date: '2026-05-01T00:00:00.000Z', score: 50, scoreVersion: 1 },
          { date: '2026-06-01T00:00:00.000Z', score: 70, scoreVersion: 2 },
        ],
      }))
      expect(html).toContain('stroke-dasharray')
      expect(html).toContain('formula changed')
    })
    it('draws a plain solid polyline within one version (no boundary marker)', () => {
      const html = buildSiteReportHtml(fixture({
        trend: [
          { date: '2026-05-01T00:00:00.000Z', score: 50, scoreVersion: 1 },
          { date: '2026-06-01T00:00:00.000Z', score: 70, scoreVersion: 1 },
        ],
      }))
      expect(html).not.toContain('stroke-dasharray')
      expect(html).not.toContain('formula changed')
    })
  })

  describe('changes since previous audit', () => {
    it('omits the section when diff is null', () => {
      const html = buildSiteReportHtml(fixture({ diff: null }))
      expect(html).not.toContain('Changes since previous audit')
    })
    it('renders headline counts when a diff is present', () => {
      const html = buildSiteReportHtml(fixture({
        diff: DIFF, previousCompletedAt: '2026-05-01T00:00:00.000Z',
      }))
      expect(html).toContain('Changes since previous audit')
      expect(html).toContain('New: <strong>5</strong>')
      expect(html).toContain('(3 regressed, 2 on new pages)')
      expect(html).toContain('Resolved: <strong>4</strong>')
      expect(html).toContain('Not rescanned: 1')
      expect(html).toContain('Unchanged: 7')
      expect(html).toContain('2026-05-01')
    })
  })

  describe('archived audits', () => {
    const archived = () => fixture({
      archived: true,
      archivedCounts: { passed: null, incomplete: null },
      // A screenshot value must be ignored when archived (contract: no screenshots).
      topIssues: [issue({ screenshot: 'data:image/png;base64,AAAA' })],
    })

    it('renders the archived note', () => {
      const html = buildSiteReportHtml(archived())
      expect(html).toContain('pruned after 90 days')
    })
    it('never renders screenshots', () => {
      const html = buildSiteReportHtml(archived())
      expect(html).not.toContain('class="shot"')
      expect(html).not.toContain('data:image/png')
    })
    it('renders "—" for null archivedCounts members, never a literal 0', () => {
      const html = buildSiteReportHtml(archived())
      expect(html).toContain('—')
      expect(html).not.toContain('<div class="tile-value">120</div>') // blob counts not used
    })
    it('uses archivedCounts values when present', () => {
      const html = buildSiteReportHtml(fixture({
        archived: true, archivedCounts: { passed: 88, incomplete: 2 }, topIssues: [issue()],
      }))
      expect(html).toContain('<div class="tile-value">88</div>')
    })
  })

  it('renders a screenshot img for fresh audits when present', () => {
    const html = buildSiteReportHtml(fixture({
      topIssues: [issue({ screenshot: 'data:image/png;base64,AAAA' })],
    }))
    expect(html).toContain('class="shot"')
    expect(html).toContain('data:image/png;base64,AAAA')
  })

  it('includes the footer disclaimer', () => {
    const html = buildSiteReportHtml(fixture())
    expect(html).toContain('not a legal conformance statement')
  })
})
