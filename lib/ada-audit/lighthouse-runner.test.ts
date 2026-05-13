import { describe, it, expect } from 'vitest'
import { extractSummary } from './lighthouse-runner'

const FAKE_LHR = {
  categories: {
    performance:        { score: 0.42, auditRefs: [{ id: 'lcp-audit' }, { id: 'render-blocking' }] },
    accessibility:      { score: 0.91, auditRefs: [{ id: 'color-contrast' }] },
    'best-practices':   { score: 0.83, auditRefs: [{ id: 'console-errors' }] },
  },
  audits: {
    'largest-contentful-paint': { numericValue: 3200, score: 0.5 },
    'cumulative-layout-shift':  { numericValue: 0.05, score: 0.95 },
    'total-blocking-time':      { numericValue: 220, score: 0.7 },
    'lcp-audit':                { id: 'lcp-audit', title: 'Largest Contentful Paint',  score: 0.5,  displayValue: '3.2 s' },
    'render-blocking':          { id: 'render-blocking', title: 'Render blocking',     score: 0.1,  displayValue: '900 ms' },
    'color-contrast':           { id: 'color-contrast',  title: 'Color contrast',      score: 0.6,  displayValue: '3 issues' },
    'console-errors':           { id: 'console-errors',  title: 'No console errors',   score: 1,    displayValue: '' },
  },
}

describe('extractSummary', () => {
  it('produces 0–100 scores from raw 0–1 category scores', () => {
    const s = extractSummary(FAKE_LHR)
    expect(s.scores.performance).toBe(42)
    expect(s.scores.accessibility).toBe(91)
    expect(s.scores.bestPractices).toBe(83)
  })

  it('extracts Core Web Vitals with pass/fail thresholds', () => {
    const s = extractSummary(FAKE_LHR)
    expect(s.cwv.lcp).toBe(3200)
    expect(s.cwv.lcpStatus).toBe('needs-improvement') // 2500 < 3200 <= 4000
    expect(s.cwv.cls).toBe(0.05)
    expect(s.cwv.clsStatus).toBe('pass')              // <= 0.1
    expect(s.cwv.tbt).toBe(220)
    expect(s.cwv.tbtStatus).toBe('needs-improvement') // 200 < 220 <= 600
  })

  it('returns up to 5 failing audits across categories sorted by score ascending', () => {
    const s = extractSummary(FAKE_LHR)
    // Failing = score !== null && score < 0.9
    // From the fixture: render-blocking (0.1), color-contrast (0.6), lcp-audit (0.5)
    // = 3 failures; console-errors (1) is a pass and excluded
    expect(s.topFailures).toHaveLength(3)
    expect(s.topFailures[0].id).toBe('render-blocking')   // worst score first
    expect(s.topFailures[1].id).toBe('lcp-audit')
    expect(s.topFailures[2].id).toBe('color-contrast')
    expect(s.topFailures[0].category).toBe('performance')
  })
})
