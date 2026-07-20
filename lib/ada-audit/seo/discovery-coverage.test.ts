// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { normalizeCoverageUrl, computeDiscoveryCoverage, contentNormalize, classifyExclusion } from './discovery-coverage'

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

describe('computeDiscoveryCoverage — hybrid dual rate', () => {
  it('reports sitemap vs residual rates from the sitemap baseline', () => {
    // sitemap baseline: /a. full hybrid baseline (discoveredUrls): /a,/b (crawler found /b).
    // harvested links: /a,/b,/c. sitemap misses {b,c}=2 of 3; residual misses {c}=1 of 3.
    const r = computeDiscoveryCoverage({
      discoveredUrls: ['https://x.com/a', 'https://x.com/b'],
      sitemapBaseline: ['https://x.com/a'],
      sitemapCapped: false,
      internalLinks: [
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/a' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/b' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/c' },
      ],
      discoveryMode: 'hybrid',
      discoveryCapped: false,
    })
    expect(r.sitemapMissRate).toBeCloseTo(2 / 3)
    expect(r.sitemapApplicable).toBe(true)
    expect(r.residualMissRate).toBeCloseTo(1 / 3)
    expect(r.residualApplicable).toBe(true)
  })

  it('sitemapApplicable is false when the sitemap portion was capped', () => {
    const r = computeDiscoveryCoverage({
      discoveredUrls: ['https://x.com/a'], sitemapBaseline: ['https://x.com/a'],
      sitemapCapped: true, internalLinks: [], discoveryMode: 'hybrid', discoveryCapped: false,
    })
    expect(r.sitemapApplicable).toBe(false)
    expect(r.sitemapMissRate).toBeNull()
  })

  it('back-compat: no sitemapBaseline behaves exactly as before', () => {
    const input = {
      discoveredUrls: ['https://x.com/a'],
      internalLinks: [{ sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/b' }],
      discoveryMode: 'sitemap' as const, discoveryCapped: false,
    }
    const r = computeDiscoveryCoverage(input)
    expect(r.missRate).toBeCloseTo(1 / 2)      // {b} off {a} baseline
    expect(r.sitemapMissRate).toBe(r.missRate)
    expect(r.residualMissRate).toBeNull()
    expect(r.applicable).toBe(true)
  })
})

describe('contentNormalize', () => {
  it('strips extra tracking params (lead_src/gclid/gad/fbclid) but keeps functional params', () => {
    expect(contentNormalize('https://x.com/apply?lead_src=w-menu')).toBe('https://x.com/apply')
    expect(contentNormalize('https://x.com/?gad=1&gclid=abc')).toBe('https://x.com')
    expect(contentNormalize('https://x.com/jobs?position=414')).toBe('https://x.com/jobs?position=414')
    expect(contentNormalize('https://x.com/blog?paged=2')).toBe('https://x.com/blog?paged=2')
  })
  it('trims trailing encoded/literal whitespace (%C2%A0, %20) off the pathname', () => {
    expect(contentNormalize('https://x.com/blog/a/%C2%A0')).toBe('https://x.com/blog/a')
    expect(contentNormalize('https://x.com/blog/b%20')).toBe('https://x.com/blog/b')
  })
  it('is idempotent and preserves existing normalize behavior for clean URLs', () => {
    expect(contentNormalize('https://www.x.com/foo/')).toBe('https://x.com/foo')
    expect(contentNormalize(contentNormalize('https://x.com/apply?lead_src=z'))).toBe('https://x.com/apply')
  })
  it('passes non-URLs through unchanged', () => {
    expect(contentNormalize('not a url')).toBe('not a url')
  })
})

describe('classifyExclusion', () => {
  it('flags WordPress pagination', () => {
    expect(classifyExclusion('https://x.com/blog/page/2')).toBe('pagination')
    expect(classifyExclusion('https://x.com/category/news/page/3')).toBe('pagination')
    expect(classifyExclusion('https://x.com/author/joe/page/2')).toBe('pagination')
  })
  it('flags WP taxonomy archives', () => {
    expect(classifyExclusion('https://x.com/category/blog')).toBe('taxonomy')
    expect(classifyExclusion('https://x.com/tag/beauty')).toBe('taxonomy')
    expect(classifyExclusion('https://x.com/author/dareen')).toBe('taxonomy')
  })
  it('flags thank-you confirmation pages (prefix and suffix forms)', () => {
    expect(classifyExclusion('https://x.com/thank-you')).toBe('thankyou')
    expect(classifyExclusion('https://x.com/thank-you-apply-online')).toBe('thankyou')
    expect(classifyExclusion('https://x.com/application-thank-you')).toBe('thankyou')
  })
  it('flags WooCommerce account pages', () => {
    expect(classifyExclusion('https://x.com/my-account/lost-password')).toBe('account')
  })
  it('does NOT false-positive on content slugs that merely contain the words (Codex F6)', () => {
    expect(classifyExclusion('https://x.com/category-of-programs')).toBeNull()
    expect(classifyExclusion('https://x.com/tagline')).toBeNull()
    expect(classifyExclusion('https://x.com/authoring')).toBeNull()
    expect(classifyExclusion('https://x.com/my-accounting')).toBeNull()
    expect(classifyExclusion('https://x.com/landing-page')).toBeNull()
    expect(classifyExclusion('https://x.com/programs/nursing')).toBeNull()
  })
  it('documents known false-negatives — outside the locked pattern set, return null (Codex F6)', () => {
    expect(classifyExclusion('https://x.com/blog/category/news')).toBeNull()
    expect(classifyExclusion('https://x.com/thankyou')).toBeNull()
    expect(classifyExclusion('https://x.com/thank-you/application')).toBeNull()
  })
})

describe('computeDiscoveryCoverage — L1 policy filter', () => {
  const base = { discoveryMode: 'hybrid' as const, discoveryCapped: false }

  it('excludes thank-you/pagination/taxonomy/account and attributes numerator + baseline', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/a', 'https://x.com/b'],
      sitemapBaseline: ['https://x.com/a', 'https://x.com/b'],
      internalLinks: [
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/thank-you' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/blog/page/2' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/category/news' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/my-account/orders' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/programs/nursing' },
      ],
    })
    expect(r.residualMissRate).toBeCloseTo(1 / 3)
    expect(r.residualMissRateRaw).toBeCloseTo(5 / 7)
    expect(r.excludedByReason.thankyou).toBe(1)
    expect(r.excludedByReason.pagination).toBe(1)
    expect(r.excludedByReason.taxonomy).toBe(1)
    expect(r.excludedByReason.account).toBe(1)
    expect(r.nonContentExcludedCount).toBe(4)
    expect(r.offBaselineCount).toBe(1)
    expect(r.discoveredCount).toBe(2)
  })

  it('duplicate tracking variant of one off-baseline miss is attributed, not double-counted (Codex F1a)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/home'],
      sitemapBaseline: ['https://x.com/home'],
      internalLinks: [
        { sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/apply' },
        { sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/apply?gclid=x' },
      ],
    })
    expect(r.offBaselineCount).toBe(1)
    expect(r.excludedByReason.param).toBe(1)
    expect(r.nonContentExcludedCount).toBe(1)
  })

  it('clean link covered by a tracking-variant baseline URL becomes covered (Codex F1b)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/apply?gclid=x'],
      sitemapBaseline: ['https://x.com/apply?gclid=x'],
      internalLinks: [{ sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/apply' }],
    })
    expect(r.residualMissRate).toBe(0)
    expect(r.excludedByReason.param).toBe(1)
    expect(r.residualMissRateRaw).toBeGreaterThan(0)
  })

  it('baseline-only policy exclusions raise the filtered rate and are counted (Codex F1c, F4 non-monotone)', () => {
    const discoveredUrls = [
      'https://x.com/home',
      ...Array.from({ length: 10 }, (_, i) => `https://x.com/category/c${i}`),
    ]
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls,
      sitemapBaseline: discoveredUrls,
      internalLinks: [{ sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/programs/x' }],
    })
    expect(r.residualMissRateRaw!).toBeLessThan(r.residualMissRate!)
    expect(r.residualMissRate).toBeCloseTo(0.5)
    expect(r.nonContentExcludedCount).toBe(0)
    expect(r.baselineExcludedCount).toBe(10)
    expect(r.baselineExcludedByReason.taxonomy).toBe(10)
  })

  it('collapses malformed (%C2%A0) dupes onto their real page (Codex F1)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/blog/a'],
      sitemapBaseline: ['https://x.com/blog/a'],
      internalLinks: [{ sourcePageUrl: 'https://x.com/home', targetUrl: 'https://x.com/blog/a/%C2%A0' }],
    })
    expect(r.residualMissRate).toBe(0)
    expect(r.excludedByReason.malformed).toBe(1)
    expect(r.nonContentExcludedCount).toBe(1)
  })

  it('sample is drawn from the FILTERED off-baseline set, sorted deterministically (Codex F2)', () => {
    const r = computeDiscoveryCoverage({
      ...base,
      discoveredUrls: ['https://x.com/a'],
      sitemapBaseline: ['https://x.com/a'],
      internalLinks: [
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/thank-you' },
        { sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/programs/nursing' },
      ],
    })
    const urls = r.sample.map((s) => s.targetUrl)
    expect(urls).toContain('https://x.com/programs/nursing')
    expect(urls).not.toContain('https://x.com/thank-you')
  })
})
