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
    expect(r.hreflang).toContainEqual({ lang: 'en', href: 'https://example.com/en' })
    expect(r.wordCount).toBeGreaterThanOrEqual(3)
  })
  it('harvests hreflang as {lang, href} pairs, dedupes by lang keep-first, keeps raw href', () => {
    const r = dom(`<html><head>
      <link rel="alternate" hreflang="en" href="https://x.com/en">
      <link rel="alternate" hreflang="fr" href="/fr">
      <link rel="alternate" hreflang="en" href="https://x.com/en-dup">
      <link rel="alternate" hreflang="x-default" href="https://x.com/">
      <link rel="alternate" hreflang="" href="https://x.com/empty">
      </head><body></body></html>`)
    expect(r.hreflang).toEqual([
      { lang: 'en', href: 'https://x.com/en' },     // keep-first (dup 'en' dropped)
      { lang: 'fr', href: '/fr' },                  // raw relative href preserved
      { lang: 'x-default', href: 'https://x.com/' },
    ]) // empty-lang entry dropped
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

describe('contentText capture (C6 Phase 5)', () => {
  it('excludes nav/header/footer/aside from contentText but not from wordCount', () => {
    const r = dom(`<html><body>
      <header>Site Menu Home About Contact</header>
      <nav>Programs Admissions Tuition</nav>
      <main><p>Our nursing program prepares students for licensure in twelve months.</p></main>
      <footer>Copyright 2026 All Rights Reserved Privacy Policy</footer></body></html>`)
    expect(r.contentText).toContain('nursing program prepares students')
    expect(r.contentText).not.toContain('Site Menu')
    expect(r.contentText).not.toContain('Copyright')
    expect(r.contentText).not.toContain('Programs Admissions')
    expect(r.wordCount).toBeGreaterThan(15) // wordCount still counts ALL visible text
  })

  it('sets contentTruncated when content exceeds the 30k cap and still counts all words', () => {
    const long = 'lorem ipsum dolor '.repeat(3000) // ~54k chars
    const r = dom(`<html><body><main><p>${long}</p></main></body></html>`)
    expect(r.contentTruncated).toBe(true)
    expect((r.contentText ?? '').length).toBeLessThanOrEqual(30_000)
    expect(r.wordCount).toBeGreaterThan(5000) // walk completed, count reflects full page
  })

  it('leaves contentText undefined when there is no main content', () => {
    const r = dom(`<html><body><nav>Home About</nav><footer>Copyright</footer></body></html>`)
    expect(r.contentText).toBeUndefined()
    expect(r.contentTruncated).toBe(false)
  })

  it('injected source stays SWC-helper-free (no escaping _type_of/module refs)', () => {
    const src = parseSeoFromDocument.toString()
    expect(src).not.toMatch(/_type_of|_instanceof|_class_call_check|require\(/)
    expect(src).not.toMatch(/\btypeof\b/) // typeof compiles to a module-scope helper at es2017
  })
})

describe('programNames extraction (KS-3)', () => {
  it('extracts Course and EducationalOccupationalProgram names, incl. @graph nesting and array @type', () => {
    const seo = dom(`
      <script type="application/ld+json">{"@type":"Course","name":"Dental Assisting"}</script>
      <script type="application/ld+json">{"@graph":[{"@type":["EducationalOccupationalProgram","Thing"],"name":"HVAC Technician"}]}</script>
    `)
    expect(seo.programNames).toEqual(['Dental Assisting', 'HVAC Technician'])
  })
  it('ignores non-program types, missing names, and non-string names (object/array/number)', () => {
    const seo = dom(`
      <script type="application/ld+json">{"@type":"Article","name":"Not a program"}</script>
      <script type="application/ld+json">{"@type":"Course"}</script>
      <script type="application/ld+json">{"@type":"Course","name":{"@value":"Localized"}}</script>
      <script type="application/ld+json">{"@type":"Course","name":["A","B"]}</script>
      <script type="application/ld+json">{"@type":"Course","name":42}</script>
    `)
    expect(seo.programNames).toEqual([])
  })
  it('tolerates malformed JSON-LD, dedupes, caps names at 120 chars and 20 per page', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      `<script type="application/ld+json">{"@type":"Course","name":"P${i} ${'x'.repeat(150)}"}</script>`,
    ).join('')
    const seo = dom(`
      <script type="application/ld+json">{broken</script>
      <script type="application/ld+json">{"@type":"Course","name":"Dup"}</script>
      <script type="application/ld+json">{"@type":"Course","name":"Dup"}</script>
      ${many}
    `)
    expect(seo.programNames.filter((n) => n === 'Dup')).toHaveLength(1)
    expect(seo.programNames.length).toBeLessThanOrEqual(20)
    expect(Math.max(...seo.programNames.map((n) => n.length))).toBeLessThanOrEqual(120)
  })
  it('duplicates never crowd out later unique names — the cap counts UNIQUE values (plan-Codex #1)', () => {
    const dups = Array.from({ length: 20 }, () =>
      '<script type="application/ld+json">{"@type":"Course","name":"Same"}</script>',
    ).join('')
    const seo = dom(`${dups}<script type="application/ld+json">{"@type":"Course","name":"Unique Late Program"}</script>`)
    expect(seo.programNames).toEqual(['Same', 'Unique Late Program'])
  })
})

describe('faqSignals extraction (KS-4)', () => {
  it('fires heading on a main-content FAQ heading, and counts question headings', () => {
    const r = dom(`
      <main>
        <h2>Frequently Asked Questions</h2>
        <h3>How long is the program?</h3>
        <h3>What does tuition cost?</h3>
      </main>`)
    expect(r.faqSignals.heading).toBe(true)
    expect(r.faqSignals.questionHeadings).toBe(2)
  })

  it('does NOT fire heading for a footer FAQs nav heading (boilerplate guard)', () => {
    const r = dom(`<main><h2>Programs</h2></main><footer><h3>FAQs</h3></footer>`)
    expect(r.faqSignals.heading).toBe(false)
  })

  it('does NOT fire heading inside a hidden block', () => {
    const r = dom(`<main><div style="display:none"><h2>FAQ</h2></div></main>`)
    expect(r.faqSignals.heading).toBe(false)
  })

  it('fires container for a faq-classed section containing a heading', () => {
    const r = dom(`<main><section class="faq-block"><h3>Questions</h3><p>…</p></section></main>`)
    expect(r.faqSignals.container).toBe(true)
  })

  it('fires container when the faq element IS a <details> (self-match, Codex #3)', () => {
    const r = dom(`<main><details class="faq"><summary>How do I apply?</summary><p>…</p></details></main>`)
    expect(r.faqSignals.container).toBe(true)
  })

  it('does NOT fire container for a bare nav faq link', () => {
    const r = dom(`<nav><a class="faq-link" href="/faq">FAQ</a></nav><main><p>Hello</p></main>`)
    expect(r.faqSignals.container).toBe(false)
  })

  it('does NOT fire container for a faq-classed div with no heading or details', () => {
    const r = dom(`<main><div class="faq-teaser"><a href="/faq">See our FAQ</a></div></main>`)
    expect(r.faqSignals.container).toBe(false)
  })

  it('respects the eligible/raw heading caps: a heading-stuffed nav cannot starve content headings', () => {
    const navHeadings = Array.from({ length: 400 }, (_, i) => `<h3>Nav ${i}</h3>`).join('')
    const r = dom(`<nav>${navHeadings}</nav><main><h2>Frequently Asked Questions</h2></main>`)
    expect(r.faqSignals.heading).toBe(true) // nav headings are raw-walked but not eligible
  })

  it('stops at the raw cap of 600 headings', () => {
    // 600 hidden headings exhaust the raw budget before the visible FAQ heading
    const hidden = Array.from({ length: 600 }, (_, i) => `<h3 style="display:none">H ${i}</h3>`).join('')
    const r = dom(`<main>${hidden}<h2>Frequently Asked Questions</h2></main>`)
    expect(r.faqSignals.heading).toBe(false)
  })
})
