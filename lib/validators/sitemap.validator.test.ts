import { describe, it, expect } from 'vitest'
import { parseSitemapXml } from './sitemap.validator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUrlset(urls: string[], extras = ''): string {
  const locs = urls
    .map(u => `  <url><loc>${u}</loc>${extras}</url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs}\n</urlset>`
}

function makeSitemapIndex(childUrls: string[]): string {
  const entries = childUrls
    .map(u => `  <sitemap><loc>${u}</loc></sitemap>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`
}

// ---------------------------------------------------------------------------
// parseSitemapXml
// ---------------------------------------------------------------------------

describe('parseSitemapXml', () => {
  // ── Valid urlset ─────────────────────────────────────────────────────────

  it('parses a minimal valid urlset sitemap', () => {
    const xml = makeUrlset([
      'https://example.com/',
      'https://example.com/about',
    ])
    const result = parseSitemapXml(xml)
    expect(result.valid).toBe(true)
    expect(result.isSitemapIndex).toBe(false)
    expect(result.urlCount).toBe(2)
    expect(result.sampleUrls).toEqual([
      'https://example.com/',
      'https://example.com/about',
    ])
  })

  it('reports no errors for a well-formed sitemap', () => {
    const xml = makeUrlset(['https://example.com/', 'https://example.com/page'])
    const result = parseSitemapXml(xml)
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  // ── Metadata detection ───────────────────────────────────────────────────

  it('detects lastmod elements', () => {
    const xml = makeUrlset(
      ['https://example.com/'],
      '<lastmod>2024-01-01</lastmod>'
    )
    const result = parseSitemapXml(xml)
    expect(result.hasLastmod).toBe(true)
  })

  it('detects changefreq elements', () => {
    const xml = makeUrlset(
      ['https://example.com/'],
      '<changefreq>weekly</changefreq>'
    )
    const result = parseSitemapXml(xml)
    expect(result.hasChangefreq).toBe(true)
  })

  it('detects priority elements', () => {
    const xml = makeUrlset(
      ['https://example.com/'],
      '<priority>0.8</priority>'
    )
    const result = parseSitemapXml(xml)
    expect(result.hasPriority).toBe(true)
  })

  it('reports missing lastmod as an info issue for urlset', () => {
    const xml = makeUrlset(['https://example.com/'])
    const result = parseSitemapXml(xml)
    const infos = result.issues.filter(i => i.severity === 'info')
    expect(infos.some(i => i.message.includes('lastmod'))).toBe(true)
  })

  it('does NOT report missing lastmod for a sitemap index', () => {
    const xml = makeSitemapIndex(['https://example.com/sitemap1.xml'])
    const result = parseSitemapXml(xml)
    const lastmodInfos = result.issues.filter(
      i => i.severity === 'info' && i.message.includes('lastmod')
    )
    expect(lastmodInfos).toHaveLength(0)
  })

  // ── Sitemap index ────────────────────────────────────────────────────────

  it('identifies a sitemap index', () => {
    const xml = makeSitemapIndex([
      'https://example.com/sitemap1.xml',
      'https://example.com/sitemap2.xml',
    ])
    const result = parseSitemapXml(xml)
    expect(result.isSitemapIndex).toBe(true)
    expect(result.urlCount).toBe(2)
    expect(result.valid).toBe(true)
  })

  it('emits an info notice for sitemap index with child count', () => {
    const xml = makeSitemapIndex([
      'https://example.com/sitemap1.xml',
      'https://example.com/sitemap2.xml',
    ])
    const result = parseSitemapXml(xml)
    const infos = result.issues.filter(i => i.severity === 'info')
    expect(infos.some(i => i.message.includes('sitemap index') && i.message.includes('2'))).toBe(true)
  })

  // ── Empty sitemap ────────────────────────────────────────────────────────

  it('handles an empty urlset gracefully (no error, but warning for 0 URLs)', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`
    const result = parseSitemapXml(xml)
    expect(result.valid).toBe(true)  // no error-level issues from the empty warning
    expect(result.urlCount).toBe(0)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('empty'))).toBe(true)
  })

  // ── Malformed / missing root ─────────────────────────────────────────────

  it('returns invalid with an error for non-sitemap XML', () => {
    const xml = `<?xml version="1.0"?><feed><entry>foo</entry></feed>`
    const result = parseSitemapXml(xml)
    expect(result.valid).toBe(false)
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors.some(e => e.message.includes('urlset') || e.message.includes('sitemapindex'))).toBe(true)
  })

  it('returns invalid for completely empty string', () => {
    const result = parseSitemapXml('')
    expect(result.valid).toBe(false)
    expect(result.urlCount).toBe(0)
  })

  it('returns invalid for plain text (not XML)', () => {
    const result = parseSitemapXml('This is not XML at all.')
    expect(result.valid).toBe(false)
  })

  // ── Duplicate URLs ───────────────────────────────────────────────────────

  it('warns about duplicate <loc> values', () => {
    const xml = makeUrlset([
      'https://example.com/page',
      'https://example.com/page',
      'https://example.com/other',
    ])
    const result = parseSitemapXml(xml)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('duplicate'))).toBe(true)
  })

  it('does not warn about duplicates when all URLs are unique', () => {
    const xml = makeUrlset([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ])
    const result = parseSitemapXml(xml)
    const dupWarnings = result.issues.filter(
      i => i.severity === 'warning' && i.message.includes('duplicate')
    )
    expect(dupWarnings).toHaveLength(0)
  })

  // ── HTTP URLs (non-HTTPS) ─────────────────────────────────────────────────

  it('warns about HTTP URLs', () => {
    const xml = makeUrlset([
      'http://example.com/',
      'http://example.com/page',
    ])
    const result = parseSitemapXml(xml)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('HTTP'))).toBe(true)
  })

  it('does not warn about HTTPS-only URLs', () => {
    const xml = makeUrlset([
      'https://example.com/',
      'https://example.com/page',
    ])
    const result = parseSitemapXml(xml)
    const httpWarnings = result.issues.filter(
      i => i.severity === 'warning' && i.message.includes('HTTP')
    )
    expect(httpWarnings).toHaveLength(0)
  })

  // ── URLs with spaces ──────────────────────────────────────────────────────

  it('warns about URLs containing spaces', () => {
    const xml = makeUrlset(['https://example.com/my page'])
    const result = parseSitemapXml(xml)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('spaces'))).toBe(true)
  })

  // ── URL count limits ─────────────────────────────────────────────────────

  it('errors when URL count exceeds 50,000', () => {
    // Build a minimal but over-limit XML by injecting raw <url>/<loc> pairs
    // We use a fake count approach: since extractTagValues counts <loc> tags,
    // we build a string with 50001 minimal <url><loc>…</loc></url> entries.
    // That would be very slow — instead we just assert the branch logic by
    // constructing exactly 50001 entries. We'll use a compact single-line format.
    const entries = Array.from({ length: 50001 }, (_, i) => `<url><loc>https://e.com/${i}</loc></url>`).join('')
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`
    const result = parseSitemapXml(xml)
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors.some(e => e.message.includes('50,000'))).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('warns when URL count approaches 50,000 (45,001–50,000)', () => {
    const entries = Array.from({ length: 45001 }, (_, i) => `<url><loc>https://e.com/${i}</loc></url>`).join('')
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`
    const result = parseSitemapXml(xml)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('approaching'))).toBe(true)
  })

  // ── Mismatched <url> tags ────────────────────────────────────────────────

  it('errors on mismatched <url> / </url> tags', () => {
    const xml = [
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '<url><loc>https://example.com/</loc>',  // missing </url>
      '</urlset>',
    ].join('\n')
    const result = parseSitemapXml(xml)
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors.some(e => e.message.includes('Mismatched'))).toBe(true)
    expect(result.valid).toBe(false)
  })

  // ── Sample URLs capped at 10 ──────────────────────────────────────────────

  it('returns at most 10 sample URLs', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`)
    const xml = makeUrlset(urls)
    const result = parseSitemapXml(xml)
    expect(result.sampleUrls).toHaveLength(10)
    expect(result.urlCount).toBe(20)
  })
})
