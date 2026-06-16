import { describe, it, expect } from 'vitest'
import { classifyTargets, normalizeLinkTarget } from './link-harvest'

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
})
