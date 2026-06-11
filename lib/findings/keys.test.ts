// lib/findings/keys.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeFindingUrl, runFindingKey, pageFindingKey } from './keys'

describe('normalizeFindingUrl', () => {
  it('lowercases host, strips fragment, keeps path case and query', () => {
    expect(normalizeFindingUrl('https://Example.COM/Path?b=2#frag')).toBe('https://example.com/Path?b=2')
  })
  it('strips the trailing slash on a bare root path only', () => {
    expect(normalizeFindingUrl('https://example.com/')).toBe('https://example.com')
    expect(normalizeFindingUrl('https://example.com/dir/')).toBe('https://example.com/dir/')
  })
  it('returns non-URL input unchanged', () => {
    expect(normalizeFindingUrl('not a url')).toBe('not a url')
  })
})

describe('finding keys', () => {
  it('run key is stable and 64 hex chars', () => {
    const k = runFindingKey('missing_title')
    expect(k).toMatch(/^[0-9a-f]{64}$/)
    expect(runFindingKey('missing_title')).toBe(k)
  })
  it('page key normalizes the URL before hashing', () => {
    expect(pageFindingKey('missing_title', 'https://Example.com/a#x'))
      .toBe(pageFindingKey('missing_title', 'https://example.com/a'))
  })
  it('different types/urls produce different keys', () => {
    expect(runFindingKey('a')).not.toBe(runFindingKey('b'))
    expect(pageFindingKey('a', 'https://x.com/1')).not.toBe(pageFindingKey('a', 'https://x.com/2'))
    expect(runFindingKey('a')).not.toBe(pageFindingKey('a', 'https://x.com/1'))
  })
})
