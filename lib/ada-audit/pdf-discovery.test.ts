import { describe, it, expect } from 'vitest'
import { normalizePdfUrl, dedupePdfUrls } from './pdf-discovery'

describe('normalizePdfUrl', () => {
  it('strips query string and fragment', () => {
    expect(normalizePdfUrl('https://Example.com/doc.pdf?utm=email#page=4'))
      .toBe('https://example.com/doc.pdf')
  })

  it('lowercases host but preserves path case', () => {
    expect(normalizePdfUrl('HTTPS://EXAMPLE.COM/Docs/Foo.pdf'))
      .toBe('https://example.com/Docs/Foo.pdf')
  })

  it('resolves relative URLs against a base', () => {
    expect(normalizePdfUrl('/files/x.pdf', 'https://example.com/about'))
      .toBe('https://example.com/files/x.pdf')
  })

  it('returns null for non-pdf URLs', () => {
    expect(normalizePdfUrl('https://example.com/index.html')).toBeNull()
  })

  it('returns null for invalid URLs', () => {
    expect(normalizePdfUrl('not a url')).toBeNull()
  })
})

describe('dedupePdfUrls', () => {
  it('removes duplicates and normalizes', () => {
    const out = dedupePdfUrls([
      'https://example.com/a.pdf?v=1',
      'https://example.com/a.pdf',
      'https://example.com/b.pdf',
      'https://EXAMPLE.com/A.pdf',  // path case preserved → /A.pdf is different
    ])
    expect(out.sort()).toEqual([
      'https://example.com/A.pdf',
      'https://example.com/a.pdf',
      'https://example.com/b.pdf',
    ])
  })
})
