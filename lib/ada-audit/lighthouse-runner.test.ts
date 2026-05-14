import { describe, it, expect } from 'vitest'
import { extractSummary } from './lighthouse-runner'

const FAKE_LHR = {
  categories: {
    performance: {
      score: 0.42,
      auditRefs: [{ id: 'lcp-audit' }, { id: 'render-blocking' }],
    },
    accessibility: {
      score: 0.81,
      auditRefs: [
        { id: 'aria-valid-attr-value', group: 'a11y-aria' },
        { id: 'button-name',           group: 'a11y-aria' },
        { id: 'frame-title',           group: 'a11y-names-labels' },
        { id: 'tabindex',              group: 'a11y-navigation' },
        { id: 'heading-order',         group: 'a11y-navigation' },
        { id: 'landmark-one-main',     group: 'a11y-best-practices' },
        { id: 'image-alt',             group: 'a11y-names-labels' },   // passes — must be excluded
        { id: 'video-caption',         group: 'a11y-names-labels' },   // N/A — must be excluded
        { id: 'logical-tab-order',     group: 'a11y-navigation' },     // manual — must be excluded
      ],
    },
    'best-practices': {
      score: 0.83,
      auditRefs: [{ id: 'console-errors' }, { id: 'no-vulnerable-libraries' }],
    },
  },
  categoryGroups: {
    'a11y-aria': {
      title: 'ARIA',
      description: 'These are opportunities to improve the usage of ARIA in your application.',
    },
    'a11y-names-labels': {
      title: 'Names and Labels',
      description: 'These are opportunities to improve the semantics of the controls in your application.',
    },
    'a11y-navigation': {
      title: 'Navigation',
      description: 'These are opportunities to improve keyboard navigation in your application.',
    },
    'a11y-best-practices': {
      title: 'Best Practices',
      description: 'These items highlight common accessibility best practices.',
    },
  },
  audits: {
    // Core Web Vitals + perf failures
    'largest-contentful-paint': { numericValue: 3200, score: 0.5 },
    'cumulative-layout-shift':  { numericValue: 0.05, score: 0.95 },
    'total-blocking-time':      { numericValue: 220, score: 0.7 },
    'lcp-audit':       { id: 'lcp-audit',       title: 'Largest Contentful Paint', score: 0.5, displayValue: '3.2 s' },
    'render-blocking': { id: 'render-blocking', title: 'Render blocking',          score: 0.1, displayValue: '900 ms' },

    // Best-practices: 1 failing, 1 passing
    'console-errors':           { id: 'console-errors',           title: 'No console errors',         score: 0.5, displayValue: '2 errors' },
    'no-vulnerable-libraries':  { id: 'no-vulnerable-libraries',  title: 'No vulnerable libraries',   score: 1,   displayValue: '' },

    // Accessibility — failing (score: 0)
    'aria-valid-attr-value': {
      id: 'aria-valid-attr-value',
      title: '[role] values are not valid',
      description: 'ARIA roles must have valid values…',
      score: 0,
      scoreDisplayMode: 'binary',
      details: {
        items: [
          { node: { snippet: '<div role="codeblock-dropdown" class="sn-token-provider"></div>', selector: 'div.sn-token-provider' } },
        ],
      },
    },
    'button-name': {
      id: 'button-name',
      title: 'button, link, and menuitem elements do not have accessible names.',
      description: 'When a button is missing an accessible name…',
      score: 0,
      scoreDisplayMode: 'binary',
      details: { items: [
        { node: { snippet: '<button class="icon"></button>', selector: 'button.icon' } },
        { node: { snippet: '<a href="#"><svg></svg></a>',     selector: 'a' } },
      ]},
    },
    'frame-title': {
      id: 'frame-title',
      title: '<frame> or <iframe> elements do not have a title',
      description: 'Screen reader users rely on iframe titles…',
      score: 0,
      scoreDisplayMode: 'binary',
      details: { items: [{ node: { snippet: '<iframe src="//ads.example.com"></iframe>' } }] },
    },
    'tabindex': {
      id: 'tabindex',
      title: 'Some elements have a [tabindex] value greater than 0',
      description: 'A value greater than 0 implies an explicit navigation ordering…',
      score: 0,
      scoreDisplayMode: 'binary',
      details: { items: [{ node: { snippet: '<a href="#" tabindex="3">Link</a>' } }] },
    },
    'heading-order': {
      id: 'heading-order',
      title: 'Heading elements are not in a sequentially-descending order',
      description: 'Properly ordered headings…',
      score: 0,
      scoreDisplayMode: 'binary',
      details: { items: [{ node: { snippet: '<h4>Subsection</h4>' } }] },
    },
    'landmark-one-main': {
      id: 'landmark-one-main',
      title: 'Document does not have a main landmark.',
      description: 'One main landmark helps screen reader users navigate a web page.',
      score: 0,
      scoreDisplayMode: 'binary',
      // No details.items — audits sometimes omit this; section should still render
    },

    // Accessibility — passing (score: 1) — must NOT appear
    'image-alt':     { id: 'image-alt',     title: 'Image elements have [alt] attributes', score: 1, scoreDisplayMode: 'binary' },
    // Accessibility — not applicable (score: null, notApplicable mode) — must NOT appear
    'video-caption': { id: 'video-caption', title: 'Video elements contain a <track> element with [kind="captions"]', score: null, scoreDisplayMode: 'notApplicable' },
    // Accessibility — manual (score: null, manual mode) — must NOT appear
    'logical-tab-order': { id: 'logical-tab-order', title: 'The page has a logical tab order', score: null, scoreDisplayMode: 'manual' },
  },
}

describe('extractSummary', () => {
  it('produces 0–100 scores from raw 0–1 category scores', () => {
    const s = extractSummary(FAKE_LHR)
    expect(s.scores.performance).toBe(42)
    expect(s.scores.accessibility).toBe(81)
    expect(s.scores.bestPractices).toBe(83)
  })

  it('extracts Core Web Vitals with pass/fail thresholds', () => {
    const s = extractSummary(FAKE_LHR)
    expect(s.cwv.lcp).toBe(3200)
    expect(s.cwv.lcpStatus).toBe('needs-improvement')
    expect(s.cwv.cls).toBe(0.05)
    expect(s.cwv.clsStatus).toBe('pass')
    expect(s.cwv.tbt).toBe(220)
    expect(s.cwv.tbtStatus).toBe('needs-improvement')
  })

  it('topFailures excludes accessibility entries (perf + best-practices only) and sorts by score ascending', () => {
    const s = extractSummary(FAKE_LHR)
    // Failing perf+bp: render-blocking (0.1), lcp-audit (0.5), console-errors (0.5)
    // a11y entries (aria-valid-attr-value, button-name, etc. all score 0) MUST be excluded
    expect(s.topFailures).toHaveLength(3)
    expect(s.topFailures.map((f) => f.id)).toEqual(['render-blocking', 'lcp-audit', 'console-errors'])
    expect(s.topFailures.every((f) => f.category !== 'accessibility')).toBe(true)
  })

  describe('accessibility section', () => {
    it('includes the accessibility score (0–100)', () => {
      const s = extractSummary(FAKE_LHR)
      expect(s.accessibility?.score).toBe(81)
    })

    it('groups failing a11y audits by categoryGroups', () => {
      const s = extractSummary(FAKE_LHR)
      const groupIds = s.accessibility?.groups.map((g) => g.id) ?? []
      // The 'a11y-best-practices' group has only landmark-one-main (failing) — included.
      // Groups with zero failing audits would not appear; in this fixture every group has at least one failure.
      expect(groupIds).toContain('a11y-aria')
      expect(groupIds).toContain('a11y-names-labels')
      expect(groupIds).toContain('a11y-navigation')
      expect(groupIds).toContain('a11y-best-practices')
    })

    it('attaches the human-readable title and description from categoryGroups', () => {
      const s = extractSummary(FAKE_LHR)
      const aria = s.accessibility?.groups.find((g) => g.id === 'a11y-aria')
      expect(aria?.title).toBe('ARIA')
      expect(aria?.description).toMatch(/improve the usage of ARIA/i)
    })

    it('excludes passing, not-applicable, and manual a11y audits', () => {
      const s = extractSummary(FAKE_LHR)
      const allAuditIds = s.accessibility?.groups.flatMap((g) => g.audits.map((a) => a.id)) ?? []
      expect(allAuditIds).not.toContain('image-alt')        // passing
      expect(allAuditIds).not.toContain('video-caption')    // notApplicable
      expect(allAuditIds).not.toContain('logical-tab-order') // manual
    })

    it('includes failing a11y audits with title, description, and failing-element snippets', () => {
      const s = extractSummary(FAKE_LHR)
      const aria = s.accessibility?.groups.find((g) => g.id === 'a11y-aria')
      const ariaAudit = aria?.audits.find((a) => a.id === 'aria-valid-attr-value')
      expect(ariaAudit?.title).toBe('[role] values are not valid')
      expect(ariaAudit?.description).toMatch(/ARIA roles must have valid values/i)
      expect(ariaAudit?.failingElements).toHaveLength(1)
      expect(ariaAudit?.failingElements[0].snippet).toContain('codeblock-dropdown')
      expect(ariaAudit?.failingElements[0].selector).toBe('div.sn-token-provider')
    })

    it('handles audits with multiple failing elements', () => {
      const s = extractSummary(FAKE_LHR)
      const aria = s.accessibility?.groups.find((g) => g.id === 'a11y-aria')
      const buttonName = aria?.audits.find((a) => a.id === 'button-name')
      expect(buttonName?.failingElements).toHaveLength(2)
    })

    it('handles audits with no details.items (empty failing-elements array)', () => {
      const s = extractSummary(FAKE_LHR)
      const bp = s.accessibility?.groups.find((g) => g.id === 'a11y-best-practices')
      const landmark = bp?.audits.find((a) => a.id === 'landmark-one-main')
      expect(landmark).toBeDefined()
      expect(landmark?.failingElements).toEqual([])
    })
  })
})
