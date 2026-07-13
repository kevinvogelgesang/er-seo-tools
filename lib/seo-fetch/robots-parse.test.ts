import { describe, it, expect } from 'vitest'
import {
  parseRobotsTxt,
  testUrlAgainstRobots,
  KNOWN_AI_BOTS,
  extractSitemapUrls,
} from './robots-parse'

// ---------------------------------------------------------------------------
// parseRobotsTxt
// ---------------------------------------------------------------------------

describe('parseRobotsTxt', () => {
  // ── Happy-path basic directives ─────────────────────────────────────────

  it('parses a minimal valid robots.txt with no issues', () => {
    const content = `User-agent: *\nDisallow: /private/`
    const result = parseRobotsTxt(content)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].userAgent).toBe('*')
    expect(result.groups[0].disallows).toContain('/private/')
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('parses Allow directives', () => {
    const content = `User-agent: *\nDisallow: /\nAllow: /public/`
    const result = parseRobotsTxt(content)
    expect(result.groups[0].allows).toContain('/public/')
    expect(result.groups[0].disallows).toContain('/')
  })

  it('parses Sitemap directives and returns them in sitemapUrls', () => {
    const content = [
      'User-agent: *',
      'Disallow:',
      'Sitemap: https://example.com/sitemap.xml',
      'Sitemap: https://example.com/sitemap-news.xml',
    ].join('\n')
    const result = parseRobotsTxt(content)
    expect(result.sitemapUrls).toHaveLength(2)
    expect(result.sitemapUrls[0]).toBe('https://example.com/sitemap.xml')
    expect(result.sitemapUrls[1]).toBe('https://example.com/sitemap-news.xml')
  })

  it('returns no error issues for a well-formed file', () => {
    const content = [
      'User-agent: Googlebot',
      'Disallow: /staging/',
      '',
      'User-agent: *',
      'Disallow: /admin/',
      'Allow: /public/',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n')
    const result = parseRobotsTxt(content)
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  // ── Empty content ────────────────────────────────────────────────────────

  it('treats completely empty content as invalid (no User-agent directives)', () => {
    const result = parseRobotsTxt('')
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toMatch(/No User-agent/)
  })

  it('treats content with only comments/blank lines as invalid', () => {
    const result = parseRobotsTxt('# just a comment\n\n# another comment')
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors.length).toBeGreaterThan(0)
  })

  // ── Disallow: / (block all) ──────────────────────────────────────────────

  it('issues a warning for Disallow: / with no Allow exceptions', () => {
    const content = `User-agent: *\nDisallow: /`
    const result = parseRobotsTxt(content)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('Disallow: /'))).toBe(true)
  })

  it('does NOT warn for Disallow: / when a matching Allow override exists', () => {
    const content = `User-agent: *\nDisallow: /\nAllow: /`
    const result = parseRobotsTxt(content)
    const blockAllWarnings = result.issues.filter(
      i => i.severity === 'warning' && i.message.includes('blocks all crawling')
    )
    expect(blockAllWarnings).toHaveLength(0)
  })

  // ── Missing User-agent before directive ──────────────────────────────────

  it('issues a warning for Disallow without a preceding User-agent', () => {
    const content = `Disallow: /private/`
    const result = parseRobotsTxt(content)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('without a preceding User-agent'))).toBe(true)
  })

  it('issues a warning for Allow without a preceding User-agent', () => {
    const content = `Allow: /public/`
    const result = parseRobotsTxt(content)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('without a preceding User-agent'))).toBe(true)
  })

  // ── Unknown directive ────────────────────────────────────────────────────

  it('issues an info notice for an unknown directive', () => {
    const content = `User-agent: *\nDisallow:\nNoIndex: /`
    const result = parseRobotsTxt(content)
    const infos = result.issues.filter(i => i.severity === 'info')
    expect(infos.some(i => i.message.includes('NoIndex') || i.message.includes('noindex'))).toBe(true)
  })

  it('issues a warning for a line with no colon', () => {
    const content = `User-agent: *\nDisallow /bad-line`
    const result = parseRobotsTxt(content)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('no colon'))).toBe(true)
  })

  // ── Crawl-delay ──────────────────────────────────────────────────────────

  it('parses a valid Crawl-delay', () => {
    const content = `User-agent: *\nDisallow:\nCrawl-delay: 5`
    const result = parseRobotsTxt(content)
    expect(result.crawlDelay).toBe(5)
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('issues a warning for a very high Crawl-delay', () => {
    const content = `User-agent: *\nDisallow:\nCrawl-delay: 60`
    const result = parseRobotsTxt(content)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('very high'))).toBe(true)
  })

  it('issues a warning for a very low Crawl-delay', () => {
    const content = `User-agent: *\nDisallow:\nCrawl-delay: 0.1`
    const result = parseRobotsTxt(content)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(w => w.message.includes('very low'))).toBe(true)
  })

  it('issues an error for an invalid Crawl-delay value', () => {
    const content = `User-agent: *\nDisallow:\nCrawl-delay: fast`
    const result = parseRobotsTxt(content)
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors.some(e => e.message.includes('Invalid Crawl-delay'))).toBe(true)
  })

  // ── Multiple User-agent blocks ────────────────────────────────────────────

  it('handles multiple user-agent blocks independently', () => {
    const content = [
      'User-agent: Googlebot',
      'Disallow: /google-blocked/',
      '',
      'User-agent: Bingbot',
      'Disallow: /bing-blocked/',
      '',
      'User-agent: *',
      'Disallow: /all-blocked/',
    ].join('\n')
    const result = parseRobotsTxt(content)
    expect(result.groups).toHaveLength(3)
    const googleGroup = result.groups.find(g => g.userAgent === 'Googlebot')
    const bingGroup = result.groups.find(g => g.userAgent === 'Bingbot')
    const wildcardGroup = result.groups.find(g => g.userAgent === '*')
    expect(googleGroup?.disallows).toContain('/google-blocked/')
    expect(bingGroup?.disallows).toContain('/bing-blocked/')
    expect(wildcardGroup?.disallows).toContain('/all-blocked/')
  })

  it('handles multiple User-agent lines sharing one rule block', () => {
    const content = [
      'User-agent: Googlebot',
      'User-agent: Bingbot',
      'Disallow: /shared-block/',
    ].join('\n')
    const result = parseRobotsTxt(content)
    const google = result.groups.find(g => g.userAgent === 'Googlebot')
    const bing = result.groups.find(g => g.userAgent === 'Bingbot')
    expect(google?.disallows).toContain('/shared-block/')
    expect(bing?.disallows).toContain('/shared-block/')
  })

  // ── No-op group (no directives) ──────────────────────────────────────────

  it('issues an info notice for a group with no directives', () => {
    const content = `User-agent: Googlebot`
    const result = parseRobotsTxt(content)
    const infos = result.issues.filter(i => i.severity === 'info')
    expect(infos.some(i => i.message.includes('no-op group'))).toBe(true)
  })

  // ── Disallow without trailing slash (info) ───────────────────────────────

  it('issues an info for Disallow path without trailing slash on directory-like value', () => {
    const content = `User-agent: *\nDisallow: /private`
    const result = parseRobotsTxt(content)
    const infos = result.issues.filter(i => i.severity === 'info')
    expect(infos.some(i => i.message.includes('no trailing slash'))).toBe(true)
  })

  // ── Windows line endings ─────────────────────────────────────────────────

  it('handles CRLF line endings correctly', () => {
    const content = 'User-agent: *\r\nDisallow: /private/\r\n'
    const result = parseRobotsTxt(content)
    expect(result.groups[0].disallows).toContain('/private/')
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  // ── AI bot tracking ──────────────────────────────────────────────────────

  it('marks AI bots as blocked when wildcard Disallow: / is set', () => {
    const content = `User-agent: *\nDisallow: /`
    const result = parseRobotsTxt(content)
    expect(result.blockedBots.length).toBeGreaterThan(0)
    expect(result.allowedBots.length).toBe(0)
  })

  it('marks AI bots as allowed when there is no blocking rule', () => {
    const content = `User-agent: *\nDisallow:`
    const result = parseRobotsTxt(content)
    expect(result.allowedBots.length).toBe(KNOWN_AI_BOTS.length)
    expect(result.blockedBots).toHaveLength(0)
  })

  it('marks a specific bot blocked while wildcard is open', () => {
    const content = [
      'User-agent: GPTBot',
      'Disallow: /',
      '',
      'User-agent: *',
      'Disallow:',
    ].join('\n')
    const result = parseRobotsTxt(content)
    expect(result.blockedBots).toContain('GPTBot')
    // ClaudeBot should be allowed via wildcard
    expect(result.allowedBots).toContain('ClaudeBot')
  })

  // ── Comments stripped ─────────────────────────────────────────────────────

  it('strips inline comments before processing', () => {
    const content = `User-agent: * # allow everything\nDisallow: /secret/ # block secret`
    const result = parseRobotsTxt(content)
    expect(result.groups[0].disallows).toContain('/secret/')
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// testUrlAgainstRobots
// ---------------------------------------------------------------------------

describe('testUrlAgainstRobots', () => {
  it('allows URL when no matching rule exists', () => {
    const result = parseRobotsTxt(`User-agent: *\nDisallow: /private/`)
    const test = testUrlAgainstRobots(result, '/public/page')
    expect(test.allowed).toBe(true)
  })

  it('disallows URL matching a Disallow rule', () => {
    const result = parseRobotsTxt(`User-agent: *\nDisallow: /private/`)
    const test = testUrlAgainstRobots(result, '/private/secret')
    expect(test.allowed).toBe(false)
    expect(test.matchedRule).toContain('Disallow')
  })

  it('allows URL when Allow is longer/more specific than Disallow', () => {
    const content = `User-agent: *\nDisallow: /private/\nAllow: /private/public/`
    const result = parseRobotsTxt(content)
    const test = testUrlAgainstRobots(result, '/private/public/index')
    expect(test.allowed).toBe(true)
  })

  it('uses wildcard group when specific UA group not found', () => {
    const content = `User-agent: *\nDisallow: /blocked/`
    const result = parseRobotsTxt(content)
    const test = testUrlAgainstRobots(result, '/blocked/page', 'Googlebot')
    expect(test.allowed).toBe(false)
    expect(test.matchedAgent).toBe('*')
  })

  it('uses specific UA group when available', () => {
    const content = [
      'User-agent: Googlebot',
      'Disallow: /google-only/',
      '',
      'User-agent: *',
      'Disallow: /all-blocked/',
    ].join('\n')
    const result = parseRobotsTxt(content)
    // Googlebot-specific path — should be blocked for Googlebot
    const t1 = testUrlAgainstRobots(result, '/google-only/page', 'Googlebot')
    expect(t1.allowed).toBe(false)
    // Wildcard path — NOT blocked for Googlebot (it has its own explicit group)
    const t2 = testUrlAgainstRobots(result, '/all-blocked/page', 'Googlebot')
    expect(t2.allowed).toBe(true)
  })

  it('allows everything when no groups exist for the UA', () => {
    // Parse something that creates no groups (e.g. only directives without UA)
    // We'll manually produce a no-groups result
    const result = parseRobotsTxt(`User-agent: Googlebot\nDisallow: /secret/`)
    const test = testUrlAgainstRobots(result, '/anything', 'Bingbot')
    // Falls back to no matching group → allowed
    expect(test.allowed).toBe(true)
    expect(test.matchedRule).toBe('(no matching rule)')
  })

  it('handles wildcard * in Disallow pattern', () => {
    const content = `User-agent: *\nDisallow: /search?*`
    const result = parseRobotsTxt(content)
    const test = testUrlAgainstRobots(result, '/search?q=hello')
    expect(test.allowed).toBe(false)
  })

  it('prepends slash when URL does not start with one', () => {
    const content = `User-agent: *\nDisallow: /blocked/`
    const result = parseRobotsTxt(content)
    const test = testUrlAgainstRobots(result, 'blocked/page')
    expect(test.allowed).toBe(false)
  })

  it('Disallow: / blocks everything', () => {
    const content = `User-agent: *\nDisallow: /`
    const result = parseRobotsTxt(content)
    const test = testUrlAgainstRobots(result, '/any/path/at/all')
    expect(test.allowed).toBe(false)
  })

  it('empty Disallow allows all', () => {
    const content = `User-agent: *\nDisallow:`
    const result = parseRobotsTxt(content)
    const test = testUrlAgainstRobots(result, '/any/path')
    expect(test.allowed).toBe(true)
  })
})

describe('extractSitemapUrls', () => {
  it('extracts a plain Sitemap directive', () => {
    expect(extractSitemapUrls('Sitemap: https://x.com/sitemap.xml')).toEqual([
      'https://x.com/sitemap.xml',
    ])
  })

  it('is case-insensitive and tolerates leading whitespace', () => {
    expect(extractSitemapUrls('  sitemap: https://x.com/s.xml')).toEqual(['https://x.com/s.xml'])
  })

  it('D6: strips a trailing space-separated comment', () => {
    expect(extractSitemapUrls('Sitemap: https://x.com/sitemap.xml # primary')).toEqual([
      'https://x.com/sitemap.xml',
    ])
  })

  it('D6: strips an adjacent # with no space', () => {
    expect(extractSitemapUrls('Sitemap: https://x.com/sitemap.xml#note')).toEqual([
      'https://x.com/sitemap.xml',
    ])
  })

  it('D6: handles CRLF line endings', () => {
    expect(
      extractSitemapUrls('User-agent: *\r\nSitemap: https://x.com/a.xml\r\nSitemap: https://x.com/b.xml\r\n')
    ).toEqual(['https://x.com/a.xml', 'https://x.com/b.xml'])
  })

  it('D6: keeps duplicate directives (dedup is the caller concern)', () => {
    expect(
      extractSitemapUrls('Sitemap: https://x.com/s.xml\nSitemap: https://x.com/s.xml')
    ).toEqual(['https://x.com/s.xml', 'https://x.com/s.xml'])
  })

  it('D6: percent-encoded %23 survives (only literal # is a comment)', () => {
    expect(extractSitemapUrls('Sitemap: https://x.com/s%23a.xml')).toEqual([
      'https://x.com/s%23a.xml',
    ])
  })

  it('ignores full-line comments and non-sitemap fields', () => {
    expect(
      extractSitemapUrls('# Sitemap: https://x.com/no.xml\nUser-agent: *\nDisallow: /')
    ).toEqual([])
  })

  it('ignores a Sitemap directive with an empty value', () => {
    expect(extractSitemapUrls('Sitemap:')).toEqual([])
    expect(extractSitemapUrls('Sitemap:   # only comment')).toEqual([])
  })

  it('agrees with parseRobotsTxt().sitemapUrls on a mixed file', () => {
    const txt = [
      'User-agent: *',
      'Disallow: /admin',
      'Sitemap: https://x.com/a.xml # main',
      'sitemap: https://x.com/b.xml',
      '# Sitemap: https://x.com/commented.xml',
      'Sitemap: https://x.com/c%23d.xml',
    ].join('\r\n')
    expect(extractSitemapUrls(txt)).toEqual(parseRobotsTxt(txt).sitemapUrls)
  })
})
