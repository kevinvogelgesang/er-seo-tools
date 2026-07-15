import { describe, expect, it } from 'vitest'
import { canonicalRootUrl, injectProspectRoot, isRootUrl } from './root-url'

describe('isRootUrl', () => {
  it('matches scheme/www/trailing-slash variants of the domain root', () => {
    expect(isRootUrl('https://acme.test/', 'acme.test')).toBe(true)
    expect(isRootUrl('http://acme.test/', 'acme.test')).toBe(true)
    expect(isRootUrl('https://www.acme.test/', 'acme.test')).toBe(true)
    expect(isRootUrl('https://acme.test', 'acme.test')).toBe(true) // empty path serializes to '/'
    expect(isRootUrl('https://acme.test/', 'www.acme.test')).toBe(true) // www-insensitive both ways
  })
  it('rejects non-root paths, queries, other hosts, and junk', () => {
    expect(isRootUrl('https://acme.test/about', 'acme.test')).toBe(false)
    expect(isRootUrl('https://acme.test/?utm=1', 'acme.test')).toBe(false)
    expect(isRootUrl('https://blog.acme.test/', 'acme.test')).toBe(false)
    expect(isRootUrl('https://other.test/', 'acme.test')).toBe(false)
    expect(isRootUrl('not a url', 'acme.test')).toBe(false)
    expect(isRootUrl('ftp://acme.test/', 'acme.test')).toBe(false)
  })
})

describe('injectProspectRoot', () => {
  it('no-ops when a root variant is already present', () => {
    const urls = ['https://www.acme.test/', 'https://acme.test/a']
    const out = injectProspectRoot(urls, 'acme.test', 1000)
    expect(out.urls).toBe(urls) // same reference — untouched
    expect(out.displaced).toBe(false)
  })
  it('prepends the canonical root when absent (no displacement below cap)', () => {
    const out = injectProspectRoot(['https://acme.test/a'], 'acme.test', 1000)
    expect(out.urls).toEqual(['https://acme.test/', 'https://acme.test/a'])
    expect(out.displaced).toBe(false)
  })
  it('displaces the last URL when at cap and reports displaced: true', () => {
    const urls = Array.from({ length: 1000 }, (_, i) => `https://acme.test/p${i}`)
    const out = injectProspectRoot(urls, 'acme.test', 1000)
    expect(out.urls).toHaveLength(1000)
    expect(out.urls[0]).toBe(canonicalRootUrl('acme.test'))
    expect(out.urls).not.toContain('https://acme.test/p999')
    expect(out.urls).toContain('https://acme.test/p998')
    expect(out.displaced).toBe(true)
  })
})
