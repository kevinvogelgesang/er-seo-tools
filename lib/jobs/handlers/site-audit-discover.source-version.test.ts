// lib/jobs/handlers/site-audit-discover.source-version.test.ts
import { describe, it, expect } from 'vitest'
import { sourceMapVersion } from './site-audit-discover'
import { deriveSitemapBaseline } from './broken-link-verify'

describe('sourceMapVersion', () => {
  it('is 1 with no rendered provenance, 2 when a rendered value appears', () => {
    expect(sourceMapVersion({ 'https://x/a': 'sitemap', 'https://x/b': 'linked' })).toBe(1)
    expect(sourceMapVersion({ 'https://x/a': 'sitemap', 'https://x/b': 'rendered-linked' })).toBe(2)
    expect(sourceMapVersion({ 'https://x/a': 'rendered' })).toBe(2)
    expect(sourceMapVersion(undefined)).toBe(1)
  })
})

describe('deriveSitemapBaseline tolerates a v2 source map', () => {
  it('reads sitemap-sourced URLs and ignores rendered provenance', () => {
    const v2 = JSON.stringify({ v: 2, sources: { 'https://x/a': 'sitemap', 'https://x/b': 'rendered-linked' }, sitemapCapped: false })
    const { baseline } = deriveSitemapBaseline(v2)
    expect(baseline).toEqual(['https://x/a']) // rendered-linked is NOT a sitemap baseline entry
  })
})
