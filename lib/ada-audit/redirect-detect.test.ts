import { describe, expect, it } from 'vitest'
import { detectRedirect, normalizeForRedirect } from './redirect-detect'

describe('normalizeForRedirect', () => {
  it('lowercases host', () => {
    expect(normalizeForRedirect('https://EXAMPLE.com/foo')).toBe(normalizeForRedirect('https://example.com/foo'))
  })

  it('strips default ports', () => {
    expect(normalizeForRedirect('https://example.com:443/foo')).toBe(normalizeForRedirect('https://example.com/foo'))
    expect(normalizeForRedirect('http://example.com:80/foo')).toBe(normalizeForRedirect('http://example.com/foo'))
  })

  it('treats http and https as equivalent', () => {
    expect(normalizeForRedirect('http://example.com/foo')).toBe(normalizeForRedirect('https://example.com/foo'))
  })

  it('strips trailing slash', () => {
    expect(normalizeForRedirect('https://example.com/foo/')).toBe(normalizeForRedirect('https://example.com/foo'))
  })

  it('strips fragment', () => {
    expect(normalizeForRedirect('https://example.com/foo#bar')).toBe(normalizeForRedirect('https://example.com/foo'))
  })

  it('preserves query string', () => {
    expect(normalizeForRedirect('https://example.com/?a=1')).not.toBe(normalizeForRedirect('https://example.com/'))
  })

  it('does NOT strip www', () => {
    expect(normalizeForRedirect('https://www.example.com/')).not.toBe(normalizeForRedirect('https://example.com/'))
  })
})

describe('detectRedirect', () => {
  it('returns audited when no chain', () => {
    expect(detectRedirect('https://x.com/a', [], 'https://x.com/a')).toEqual({ kind: 'audited' })
  })

  it('returns audited for http→https-only with chain (treated as noise)', () => {
    const r = detectRedirect('http://x.com/a', [{} as any], 'https://x.com/a')
    expect(r).toEqual({ kind: 'audited' })
  })

  it('returns audited for trailing-slash-only with chain (treated as noise)', () => {
    const r = detectRedirect('https://x.com/a', [{} as any], 'https://x.com/a/')
    expect(r).toEqual({ kind: 'audited' })
  })

  it('returns redirected for cross-path redirect', () => {
    const r = detectRedirect('https://x.com/old', [{} as any], 'https://x.com/new')
    expect(r).toEqual({ kind: 'redirected', finalUrl: 'https://x.com/new' })
  })

  it('returns redirected for www → non-www', () => {
    const r = detectRedirect('https://www.x.com/', [{} as any], 'https://x.com/')
    expect(r).toEqual({ kind: 'redirected', finalUrl: 'https://x.com/' })
  })

  it('returns redirected for cross-origin redirect', () => {
    const r = detectRedirect('https://x.com/a', [{} as any], 'https://y.com/a')
    expect(r).toEqual({ kind: 'redirected', finalUrl: 'https://y.com/a' })
  })

  it('preserves the raw finalUrl (not normalized) in result', () => {
    const r = detectRedirect('https://x.com/a', [{} as any], 'https://X.COM/new/?q=1#frag')
    expect(r).toEqual({ kind: 'redirected', finalUrl: 'https://X.COM/new/?q=1#frag' })
  })
})
