// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { normalizeCoverageUrl, computeDiscoveryCoverage } from './discovery-coverage'

describe('normalizeCoverageUrl', () => {
  it('strips fragment, tracking params, and non-root trailing slash; lowercases host', () => {
    expect(normalizeCoverageUrl('https://Example.com/Foo/#x')).toBe('https://example.com/Foo')
    expect(normalizeCoverageUrl('https://example.com/foo/?utm_source=n&a=b')).toBe(
      'https://example.com/foo?a=b',
    )
    expect(normalizeCoverageUrl('https://example.com/')).toBe('https://example.com')
  })
  it('passes non-URLs through unchanged', () => {
    expect(normalizeCoverageUrl('not a url')).toBe('not a url')
  })
  it('collapses www prefix and http/https scheme to the same normalized URL', () => {
    const withWww = normalizeCoverageUrl('https://www.example.com/a')
    const bare = normalizeCoverageUrl('https://example.com/a')
    const http = normalizeCoverageUrl('http://example.com/a')
    expect(withWww).toBe(bare)
    expect(http).toBe(bare)
  })
  it('treats query-param order and index.html as intentionally DISTINCT (v1 accepted, Codex fix #5)', () => {
    // Documenting non-goals: we do not sort query params or collapse index.html.
    // Acceptable because both sides normalize identically; residual mismatches
    // only slightly inflate offBaselineCount and are rare in practice.
    expect(normalizeCoverageUrl('https://example.com/p?a=1&b=2')).not.toBe(
      normalizeCoverageUrl('https://example.com/p?b=2&a=1'),
    )
    expect(normalizeCoverageUrl('https://example.com/index.html')).not.toBe(
      normalizeCoverageUrl('https://example.com'),
    )
  })
})

describe('computeDiscoveryCoverage', () => {
  const base = {
    discoveryMode: 'sitemap' as const,
    discoveryCapped: false,
  }

  it('counts off-baseline internal links absent from the sitemap', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://example.com/a', 'https://example.com/b'],
      internalLinks: [
        { sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/b' }, // in baseline
        { sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/c' }, // OFF baseline
        { sourcePageUrl: 'https://example.com/b', targetUrl: 'https://example.com/c/' }, // same as /c after norm
      ],
    })
    expect(r.discoveredCount).toBe(2)
    expect(r.linkedInternalCount).toBe(2) // /b and /c (deduped after norm)
    expect(r.offBaselineCount).toBe(1) // only /c
    expect(r.missRate).toBeCloseTo(1 / 3) // 1 / (2 + 1)
    expect(r.applicable).toBe(true)
    expect(r.sample).toEqual([
      { targetUrl: 'https://example.com/c', sourcePageUrls: ['https://example.com/a', 'https://example.com/b'] },
    ])
  })

  it('normalization parity: UTM/slash variants do not masquerade as missed', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://example.com/p?utm_source=news'], // baseline has UTM
      internalLinks: [{ sourcePageUrl: 'https://example.com/x', targetUrl: 'https://example.com/p/' }], // clean + slash
    })
    expect(r.offBaselineCount).toBe(0)
    expect(r.missRate).toBe(0)
  })

  it('excludes images and non-page file extensions from L', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://example.com/a'],
      internalLinks: [
        { sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/doc.pdf' },
        { sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/style.css' },
      ],
    })
    expect(r.offBaselineCount).toBe(0)
    expect(r.linkedInternalCount).toBe(0)
  })

  it('is not applicable and yields null missRate for shallow-crawl mode', () => {
    const r = computeDiscoveryCoverage({
      discoveryMode: 'shallow-crawl',
      discoveryCapped: false,
      discoveredUrls: ['https://example.com/a'],
      internalLinks: [{ sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/z' }],
    })
    expect(r.applicable).toBe(false)
    expect(r.missRate).toBeNull()
    expect(r.offBaselineCount).toBe(1) // raw count still computed
  })

  it('is not applicable when the sitemap baseline was capped', () => {
    const r = computeDiscoveryCoverage({
      discoveryMode: 'sitemap',
      discoveryCapped: true,
      discoveredUrls: ['https://example.com/a'],
      internalLinks: [{ sourcePageUrl: 'https://example.com/a', targetUrl: 'https://example.com/z' }],
    })
    expect(r.applicable).toBe(false)
    expect(r.missRate).toBeNull()
  })

  it('caps the sample at 50 targets and 5 source pages per target, deterministically ordered', () => {
    const internalLinks = []
    for (let i = 0; i < 60; i++) {
      for (let s = 0; s < 8; s++) {
        internalLinks.push({
          sourcePageUrl: `https://example.com/src${String(s).padStart(2, '0')}`,
          targetUrl: `https://example.com/off${String(i).padStart(3, '0')}`,
        })
      }
    }
    const r = computeDiscoveryCoverage({ ...base, discoveredUrls: [], internalLinks })
    expect(r.offBaselineCount).toBe(60)
    expect(r.sample).toHaveLength(50)
    expect(r.sample[0].targetUrl).toBe('https://example.com/off000') // sorted
    expect(r.sample[0].sourcePageUrls).toHaveLength(5)
    expect(r.sample[0].sourcePageUrls[0]).toBe('https://example.com/src00') // sorted
  })

  it('treats www + scheme variants of a baseline URL as covered, not off-baseline', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://example.com/a'],
      internalLinks: [{ sourcePageUrl: 'https://example.com/x', targetUrl: 'https://www.example.com/a' }],
    })
    expect(r.offBaselineCount).toBe(0)
  })

  it('handles empty inputs without throwing', () => {
    const r = computeDiscoveryCoverage({ ...base, discoveredUrls: [], internalLinks: [] })
    expect(r).toMatchObject({ discoveredCount: 0, linkedInternalCount: 0, offBaselineCount: 0, missRate: 0 })
  })
})
