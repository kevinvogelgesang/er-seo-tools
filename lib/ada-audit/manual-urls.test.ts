import { describe, it, expect } from 'vitest'
import { parseManualUrls } from './manual-urls'

describe('parseManualUrls', () => {
  it('extracts URLs from a plain list (one per line)', () => {
    expect(parseManualUrls('https://example.com/a\nhttps://example.com/b\n')).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })

  it('drops empty lines and #-prefixed comments', () => {
    expect(parseManualUrls('\n# header\n\nhttps://example.com/a\n\n')).toEqual([
      'https://example.com/a',
    ])
  })

  it('skips a header row that contains no URL (e.g. Screaming Frog "URL Images Last Mod.")', () => {
    const input = [
      'URL    Images    Last Mod.',
      'https://beal.edu/blog/    0    2026-05-08 00:07 +00:00',
      'https://beal.edu/post/    1    2019-02-11 21:41 +00:00',
    ].join('\n')
    expect(parseManualUrls(input)).toEqual([
      'https://beal.edu/blog/',
      'https://beal.edu/post/',
    ])
  })

  it('extracts the FIRST URL token from a tab-separated row with trailing columns', () => {
    expect(parseManualUrls('https://beal.edu/x/\t0\t2026-05-08')).toEqual([
      'https://beal.edu/x/',
    ])
  })

  it('handles a quoted-CSV row with the URL in the first column', () => {
    expect(parseManualUrls('"https://example.com/x","other","col"')).toEqual([
      'https://example.com/x',
    ])
  })

  it('extracts a URL embedded in a JSON-ish line', () => {
    expect(parseManualUrls('{ "url": "https://example.com/foo", "size": 100 }')).toEqual([
      'https://example.com/foo',
    ])
  })

  it('extracts a URL from a Markdown bullet', () => {
    expect(parseManualUrls('- https://example.com/about')).toEqual(['https://example.com/about'])
  })

  it('returns [] for input with no URLs', () => {
    expect(parseManualUrls('not a url\nstill not a url')).toEqual([])
  })

  it('does NOT extract non-http schemes', () => {
    expect(parseManualUrls('ftp://example.com/x\nfile:///etc/passwd')).toEqual([])
  })

  it('extracts both http and https', () => {
    expect(parseManualUrls('http://insecure.example/\nhttps://secure.example/')).toEqual([
      'http://insecure.example/',
      'https://secure.example/',
    ])
  })

  it('does NOT dedupe — caller (backend) is responsible', () => {
    expect(parseManualUrls('https://a.com/\nhttps://a.com/\n')).toEqual([
      'https://a.com/',
      'https://a.com/',
    ])
  })

  it('preserves trailing slashes and query strings', () => {
    expect(parseManualUrls('https://example.com/page/?ref=x')).toEqual([
      'https://example.com/page/?ref=x',
    ])
  })

  it('handles Windows CRLF line endings', () => {
    expect(parseManualUrls('https://a.com/\r\nhttps://b.com/\r\n')).toEqual([
      'https://a.com/',
      'https://b.com/',
    ])
  })
})
