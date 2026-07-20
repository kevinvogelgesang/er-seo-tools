import { describe, it, expect } from 'vitest'
import { isExcludedCrawlPath } from './crawl-exclude'

describe('isExcludedCrawlPath', () => {
  it('excludes cdn-cgi paths (any position, case-insensitive)', () => {
    expect(isExcludedCrawlPath('https://x.edu/cdn-cgi/l/email-protection')).toBe(true)
    expect(isExcludedCrawlPath('https://x.edu/CDN-CGI/l/email-protection')).toBe(true)
    expect(isExcludedCrawlPath('https://x.edu/a/cdn-cgi/b')).toBe(true)
  })

  it('does NOT exclude look-alike real paths', () => {
    expect(isExcludedCrawlPath('https://x.edu/cdn-cginfo')).toBe(false)
    expect(isExcludedCrawlPath('https://x.edu/programs/cdn')).toBe(false)
    expect(isExcludedCrawlPath('https://x.edu/')).toBe(false)
  })

  it('is safe on unparseable input', () => {
    expect(isExcludedCrawlPath('not a url')).toBe(false)
  })
})
