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
