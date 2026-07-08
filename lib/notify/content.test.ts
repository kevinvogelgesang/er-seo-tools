import { describe, it, expect } from 'vitest'
import { buildCompleteEmail, buildFailedEmail } from './content'

describe('buildCompleteEmail', () => {
  it('renders subject with domain + scores and links to results', () => {
    const c = buildCompleteEmail({
      domain: 'example.edu', scanType: 'ADA + SEO', requestedBy: 'Kevin',
      adaScore: 88, seoScore: 72, durationMs: 90_000,
      resultsUrl: 'https://app.example/ada-audit/site/abc',
    })
    expect(c.subject).toContain('example.edu')
    expect(c.subject).toContain('88')
    expect(c.subject).toContain('72')
    expect(c.html).toContain('https://app.example/ada-audit/site/abc')
    expect(c.text).toContain('example.edu')
  })

  it('tolerates a missing SEO run (onExhausted path) without rendering a literal 0', () => {
    const c = buildCompleteEmail({
      domain: 'example.edu', scanType: 'ADA', requestedBy: null,
      adaScore: 88, seoScore: null, durationMs: null,
      resultsUrl: 'https://app.example/x', seoUnavailable: true,
    })
    expect(c.text).toContain('SEO analysis unavailable')
    expect(c.subject).not.toMatch(/SEO 0\b/)
  })

  it('escapes HTML-unsafe characters in dynamic strings', () => {
    const c = buildCompleteEmail({
      domain: 'x">&y.edu', scanType: 'SEO', requestedBy: '<b>me</b>',
      adaScore: null, seoScore: 50, durationMs: 1000, resultsUrl: 'https://app.example/x',
    })
    expect(c.html).not.toContain('<b>me</b>')
    expect(c.html).toContain('&lt;b&gt;me&lt;/b&gt;')
  })
})

describe('buildFailedEmail', () => {
  it('includes domain, requester, and the terminal error', () => {
    const c = buildFailedEmail({
      domain: 'example.edu', requestedBy: 'Kevin',
      error: 'Audit timed out', resultsUrl: 'https://app.example/ada-audit/site/abc',
    })
    expect(c.subject.toLowerCase()).toContain('failed')
    expect(c.subject).toContain('example.edu')
    expect(c.text).toContain('Audit timed out')
    expect(c.html).toContain('https://app.example/ada-audit/site/abc')
  })
})

describe('buildCompleteEmail enrichment', () => {
  const base = {
    domain: 'example.edu', scanType: 'ADA + SEO', requestedBy: 'Kevin',
    adaScore: 100, seoScore: 92, durationMs: 240_000,
    resultsUrl: 'https://app.example/ada-audit/site/abc',
  }

  it('renders X of Y pages, all count rows, and the change strip', () => {
    const c = buildCompleteEmail({
      ...base, pagesComplete: 47, pagesTotal: 50,
      counts: { brokenLinks: 2, onPageIssues: 8, adaViolations: 0 },
      partial: { seo: false, ada: false },
      change: { seoDelta: 4, adaDelta: -1, newIssues: 3, resolvedIssues: 5, previousDate: 'Jul 3' },
    })
    expect(c.html).toContain('47 of 50')
    expect(c.text).toContain('47 of 50')
    expect(c.html).toContain('Broken links &amp; images')
    expect(c.text).toMatch(/On-page issues\D+8/)
    expect(c.text).toContain('ADA violations')
    expect(c.html).toContain('#16a34a') // SEO 92 & ADA 100 green
    expect(c.text).toMatch(/new/)
    expect(c.text).toMatch(/resolved/)
    expect(c.text).toContain('Jul 3')
  })

  it('null count renders "—"/omitted, distinct from a rendered 0', () => {
    const unknown = buildCompleteEmail({ ...base, counts: { brokenLinks: null, onPageIssues: null, adaViolations: 0 } })
    expect(unknown.text).toMatch(/ADA violations\D+0/)         // present run → 0 shows
    expect(unknown.text).not.toMatch(/Broken links[^\n]*\b0\b/) // unknown → not a literal 0
  })

  it('omits the change strip when every change field is null', () => {
    const c = buildCompleteEmail({ ...base, change: { seoDelta: null, adaDelta: null, newIssues: null, resolvedIssues: null, previousDate: null } })
    expect(c.text).not.toMatch(/since last scan/i)
  })

  it('shows an incomplete-scan qualifier when partial', () => {
    const c = buildCompleteEmail({ ...base, counts: { brokenLinks: 1, onPageIssues: 2, adaViolations: 0 }, partial: { seo: true, ada: false } })
    expect(c.text.toLowerCase()).toContain('incomplete')
  })

  it('renders no enrichment sections when all optional fields absent (D7 back-compat)', () => {
    const c = buildCompleteEmail(base)
    expect(c.text).not.toMatch(/since last scan/i)
    expect(c.html).toContain('example.edu')
  })
})

describe('buildFailedEmail truncation', () => {
  it('truncates an over-long error', () => {
    const c = buildFailedEmail({ domain: 'x.edu', requestedBy: 'K', error: 'E'.repeat(2000), resultsUrl: 'https://app.example/x' })
    expect(c.html.length).toBeLessThan(3000)
    expect(c.text).toContain('EEE')
  })
})
