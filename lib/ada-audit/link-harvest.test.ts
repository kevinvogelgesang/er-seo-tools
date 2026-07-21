import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { classifyTargets, normalizeLinkTarget, harvestLinks, harvestAnchorsFromDocument } from './link-harvest'

const base = 'https://www.example.com/dir/page'

describe('normalizeLinkTarget', () => {
  it('resolves relative, strips fragment, lowercases host, keeps query', () => {
    expect(normalizeLinkTarget('../a?id=7#x', base)).toBe('https://www.example.com/a?id=7')
  })
  it('returns null for non-navigational schemes and bare fragments', () => {
    for (const r of ['#top', 'mailto:a@b.com', 'javascript:void(0)', 'tel:+1', 'data:x'])
      expect(normalizeLinkTarget(r, base)).toBeNull()
  })
})

describe('classifyTargets', () => {
  it('classifies internal-link vs external-link vs image, www-insensitive, deduped, capped', () => {
    const links = ['/a', '/a', 'https://other.com/x', 'https://example.com/b']
    const images = ['/img/logo.png', 'https://cdn.other.com/p.jpg']
    const { targets, truncated } = classifyTargets(links, images, 'example.com', base, 300)
    expect(targets).toContainEqual({ targetUrl: 'https://www.example.com/a', kind: 'internal-link' })
    expect(targets).toContainEqual({ targetUrl: 'https://example.com/b', kind: 'internal-link' })
    expect(targets).toContainEqual({ targetUrl: 'https://other.com/x', kind: 'external-link' })
    expect(targets).toContainEqual({ targetUrl: 'https://www.example.com/img/logo.png', kind: 'image' })
    expect(targets).toContainEqual({ targetUrl: 'https://cdn.other.com/p.jpg', kind: 'external-link' })
    // '/a' appears twice -> deduped to one row
    expect(targets.filter((t) => t.targetUrl === 'https://www.example.com/a')).toHaveLength(1)
    expect(truncated).toBe(false)
  })
  it('treats a subdomain of the audited host as external in v1 (exact-host+www)', () => {
    const { targets } = classifyTargets(['https://cdn.example.com/a'], [], 'example.com', base, 300)
    expect(targets).toContainEqual({ targetUrl: 'https://cdn.example.com/a', kind: 'external-link' })
  })
  it('caps total targets and sets truncated', () => {
    const links = Array.from({ length: 400 }, (_, i) => `/p/${i}`)
    const { targets, truncated } = classifyTargets(links, [], 'example.com', base, 300)
    expect(targets).toHaveLength(300)
    expect(truncated).toBe(true)
  })
  it('drops cdn-cgi email-protection links', () => {
    const { targets } = classifyTargets(['/cdn-cgi/l/email-protection', '/about'], [], 'example.com', base, 300)
    expect(targets).not.toContainEqual({
      targetUrl: 'https://www.example.com/cdn-cgi/l/email-protection',
      kind: 'internal-link',
    })
    expect(targets).toContainEqual({ targetUrl: 'https://www.example.com/about', kind: 'internal-link' })
  })
})

it('harvestLinks returns targets + truncated + pageSeo from one evaluate', async () => {
  const seo = { title: 'T', h1Count: 1, h2Count: 0, wordCount: 500, schemaTypes: [], hreflang: [],
    imageCount: 0, imagesMissingAlt: 0, imagesMissingDimensions: 0, robotsNoindex: false, loginLike: false }
  const fakePage = {
    url: () => 'https://x.com/p',
    evaluate: async () => ({ links: ['/a', 'https://other.com/z'], images: ['/i.png'], seo }),
  } as unknown as import('puppeteer-core').Page
  const r = await harvestLinks(fakePage, 'x.com')
  expect(r.pageSeo).toEqual(seo)
  expect(r.targets.some((t) => t.kind === 'internal-link')).toBe(true)
  expect(r.targets.some((t) => t.kind === 'external-link')).toBe(true)
})

describe('harvestAnchorsFromDocument', () => {
  const doc = (html: string) => new JSDOM(html).window.document
  it('extracts trimmed textContent per <a href>', () => {
    const out = harvestAnchorsFromDocument(doc('<a href="/a">  Programs </a><a href="/b">Apply</a>'))
    expect(out).toEqual([{ href: '/a', text: 'Programs' }, { href: '/b', text: 'Apply' }])
  })
  it('falls back to descendant img alt when text is empty', () => {
    const out = harvestAnchorsFromDocument(doc('<a href="/logo"><img src="l.png" alt="Home"></a>'))
    expect(out[0]).toEqual({ href: '/logo', text: 'Home' })
  })
  it('empty when neither text nor img alt', () => {
    const out = harvestAnchorsFromDocument(doc('<a href="/x"><img src="l.png"></a>'))
    expect(out[0]).toEqual({ href: '/x', text: '' })
  })
  it('truncates at 2048 chars', () => {
    const out = harvestAnchorsFromDocument(doc(`<a href="/x">${'z'.repeat(3000)}</a>`))
    expect(out[0].text.length).toBe(2048)
  })
  it('injected source is SWC-helper-free (no typeof / escaping helpers)', () => {
    const src = harvestAnchorsFromDocument.toString()
    expect(src).not.toMatch(/_type_of|_object_spread|_define_property|_instanceof|require\(/)
    expect(src).not.toMatch(/\btypeof\b/)
  })
})

describe('classifyTargets anchor capture', () => {
  it('attaches first-occurrence anchorText to internal links, dedup unchanged', () => {
    const { targets } = classifyTargets(
      ['/a', '/a'], [], 'ex.com', 'https://ex.com/', 300,
      [{ href: '/a', text: 'First' }, { href: '/a', text: 'Second' }],
    )
    const internal = targets.filter((t) => t.kind === 'internal-link')
    expect(internal).toHaveLength(1) // (kind,url) dedup unchanged
    expect(internal[0].anchorText).toBe('First') // first occurrence wins
  })
})
