import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { parseSeoFromDocument } from './parse-seo-dom'

const dom = (html: string) => {
  const d = new JSDOM(html, { url: 'https://example.com/p' })
  return parseSeoFromDocument(d.window.document, d.window as unknown as Window)
}

describe('parseSeoFromDocument', () => {
  it('extracts title, meta, h1/h2 counts, canonical, robots noindex, schema, hreflang', () => {
    const r = dom(`<html><head><title> Hi </title>
      <meta name="description" content="desc">
      <meta name="robots" content="NOINDEX,follow">
      <link rel="canonical" href="https://example.com/p">
      <link rel="alternate" hreflang="en" href="https://example.com/en">
      <script type="application/ld+json">{"@type":"Organization"}</script></head>
      <body><h1>Head</h1><h2>a</h2><h2>b</h2><p>one two three</p></body></html>`)
    expect(r.title).toBe('Hi')
    expect(r.metaDescription).toBe('desc')
    expect(r.h1).toBe('Head')
    expect(r.h1Count).toBe(1)
    expect(r.h2Count).toBe(2)
    expect(r.canonicalUrl).toBe('https://example.com/p')
    expect(r.robotsNoindex).toBe(true)
    expect(r.schemaTypes).toContain('Organization')
    expect(r.hreflang).toContain('en')
    expect(r.wordCount).toBeGreaterThanOrEqual(3)
  })
  it('flags login-like via password input', () => {
    expect(dom(`<html><body><form><input type="password"></form></body></html>`).loginLike).toBe(true)
  })
  it('does NOT flag login-like on a body-text "password" mention on a long page', () => {
    const long = 'word '.repeat(200)
    expect(dom(`<html><head><title>Blog</title></head><body><p>reset your password here ${long}</p></body></html>`).loginLike).toBe(false)
  })
  it('excludes script/style/hidden text from the word count', () => {
    const r = dom(`<html><body><script>var x=1</script><div style="display:none">hidden words here</div><p>real words only</p></body></html>`)
    expect(r.wordCount).toBe(3)
  })
  it('counts images missing alt and dimensions', () => {
    const r = dom(`<html><body><img src="/a.png"><img src="/b.png" alt="x" width="1" height="1"></body></html>`)
    expect(r.imageCount).toBe(2)
    expect(r.imagesMissingAlt).toBe(1)
    expect(r.imagesMissingDimensions).toBe(1)
  })
  it('recurses @graph for schema types', () => {
    const r = dom(`<html><head><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Article","BlogPosting"]}]}</script></head><body></body></html>`)
    expect(r.schemaTypes).toEqual(expect.arrayContaining(['WebPage', 'Article', 'BlogPosting']))
  })
})
