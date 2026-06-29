import { describe, it, expect } from 'vitest'
import {
  normalizeClientDomain,
  normalizeClientDomains,
  InvalidDomainError,
} from './domain-validation'

describe('normalizeClientDomain', () => {
  describe('accepts and normalizes valid hostnames', () => {
    it('lowercases', () => {
      expect(normalizeClientDomain('Example.COM')).toBe('example.com')
    })
    it('trims surrounding whitespace', () => {
      expect(normalizeClientDomain('  example.com  ')).toBe('example.com')
    })
    it('accepts subdomains', () => {
      expect(normalizeClientDomain('www.example.edu')).toBe('www.example.edu')
      expect(normalizeClientDomain('sub.domain.co.uk')).toBe('sub.domain.co.uk')
    })
    it('accepts hyphens and digits in labels', () => {
      expect(normalizeClientDomain('my-school123.edu')).toBe('my-school123.edu')
    })
    it('accepts punycode (IDN) labels', () => {
      expect(normalizeClientDomain('xn--80ak6aa92e.com')).toBe('xn--80ak6aa92e.com')
    })
    it('strips a single trailing FQDN dot', () => {
      expect(normalizeClientDomain('example.com.')).toBe('example.com')
    })
  })

  describe('rejects malformed values (pentest reject list)', () => {
    const rejects = [
      'javascript:alert(1)',
      '../../etc/passwd',
      'https://example.com/path',
      'http://example.com',
      'localhost',
      'localhost.local',
      '127.0.0.1',
      '169.254.169.254',
      'example.com:443',
      '',
      '   ',
    ]
    for (const value of rejects) {
      it(`rejects ${JSON.stringify(value)}`, () => {
        expect(() => normalizeClientDomain(value)).toThrow(InvalidDomainError)
      })
    }
  })

  describe('rejects other structural/internal cases', () => {
    const rejects = [
      'example.com/path',
      'user:pass@example.com',
      'example.com?q=1',
      'example.com#frag',
      'exa mple.com',
      'example..com',
      '.example.com',
      'example.com-',
      '-example.com',
      'example', // no dot / no TLD
      'example.c', // TLD too short
      'example.123', // numeric TLD
      'foo.internal',
      'foo.lan',
      'host.localhost',
      '::1',
      '10.0.0.1',
      '192.168.1.1',
    ]
    for (const value of rejects) {
      it(`rejects ${JSON.stringify(value)}`, () => {
        expect(() => normalizeClientDomain(value)).toThrow(InvalidDomainError)
      })
    }
    it('rejects non-strings', () => {
      expect(() => normalizeClientDomain(null)).toThrow(InvalidDomainError)
      expect(() => normalizeClientDomain(42)).toThrow(InvalidDomainError)
      expect(() => normalizeClientDomain(undefined)).toThrow(InvalidDomainError)
    })
    it('rejects an over-long domain (>253 chars)', () => {
      // four 63-char labels + ".com" = 259 chars (each label within the 63 cap)
      const long = `${[0, 1, 2, 3].map(() => 'a'.repeat(63)).join('.')}.com`
      expect(long.length).toBeGreaterThan(253)
      expect(() => normalizeClientDomain(long)).toThrow(InvalidDomainError)
    })
    it('rejects an over-long label (>63 chars)', () => {
      expect(() => normalizeClientDomain(`${'a'.repeat(64)}.com`)).toThrow(InvalidDomainError)
    })
  })
})

describe('normalizeClientDomains', () => {
  it('validates, lowercases, and dedupes', () => {
    expect(normalizeClientDomains(['Example.com', 'example.com', 'www.example.com'])).toEqual([
      'example.com',
      'www.example.com',
    ])
  })
  it('accepts an empty array', () => {
    expect(normalizeClientDomains([])).toEqual([])
  })
  it('throws on the first invalid entry', () => {
    expect(() => normalizeClientDomains(['example.com', 'javascript:alert(1)'])).toThrow(
      InvalidDomainError,
    )
  })
  it('rejects a non-array', () => {
    expect(() => normalizeClientDomains('example.com')).toThrow(InvalidDomainError)
  })
})
