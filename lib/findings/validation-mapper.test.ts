// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mapValidationFindings, type ValidationSeoRow, type ValidationLink, type ResolveLookup } from './validation-mapper'
import type { ResolveResult } from '@/lib/ada-audit/url-resolver'
import type { CrawlPageInput } from './types'
import { normalizeFindingUrl } from './keys'
import { randomUUID } from 'crypto'

const ok = (finalUrl: string, hops = 0): ResolveResult => ({ result: 'ok', finalUrl, status: 200, hops, chain: hops ? [finalUrl] : [], tooManyRedirects: false })
const broken = (): ResolveResult => ({ result: 'broken', finalUrl: null, status: 404, hops: 0, chain: [], tooManyRedirects: false })
const loop = (): ResolveResult => ({ result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: true })

function lookup(map: Record<string, ResolveResult>): ResolveLookup {
  const m = new Map(Object.entries(map).map(([k, v]) => [normalizeFindingUrl(k), v]))
  return { get: (u) => m.get(u) }
}
function makeDeps() {
  const pages: CrawlPageInput[] = []
  const byUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string): CrawlPageInput => {
    const u = normalizeFindingUrl(url)
    let p = byUrl.get(u)
    if (!p) { p = { id: randomUUID(), runId: 'R', url: u, status: null, error: null, finalUrl: null, statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null, crawlDepth: null, indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }; pages.push(p); byUrl.set(u, p) }
    return p
  }
  return { runId: 'R', ensurePage, auditedHost: 'x.com', affectedComplete: true, pages }
}

describe('mapValidationFindings', () => {
  it('canonical_broken when same-domain canonical resolves broken', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: 'https://x.com/dead', hreflang: [] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/dead': broken() }), makeDeps())
    expect(f.find((x) => x.scope === 'run' && x.type === 'canonical_broken')?.count).toBe(1)
    expect(f.find((x) => x.scope === 'page' && x.type === 'canonical_broken')?.url).toBe(normalizeFindingUrl('https://x.com/a'))
  })

  it('canonical_redirect when same-domain canonical redirects (hops>=1)', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: 'https://x.com/c', hreflang: [] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/c': ok('https://x.com/final', 1) }), makeDeps())
    expect(f.some((x) => x.type === 'canonical_redirect' && x.scope === 'run')).toBe(true)
  })

  it('resolves a relative canonical against the declaring page URL', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/dir/a', canonicalUrl: '/dead', hreflang: [] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/dead': broken() }), makeDeps())
    expect(f.some((x) => x.type === 'canonical_broken')).toBe(true)
  })

  it('redirect_chain on an internal link that resolves ok with hops>=1 (keyed by source page)', () => {
    const links: ValidationLink[] = [{ sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/t' }]
    const f = mapValidationFindings([], links, lookup({ 'https://x.com/t': ok('https://x.com/final', 1) }), makeDeps())
    const run = f.find((x) => x.scope === 'run' && x.type === 'redirect_chain')
    expect(run?.count).toBe(1)
    expect(f.some((x) => x.scope === 'page' && x.type === 'redirect_chain' && x.url === normalizeFindingUrl('https://x.com/a'))).toBe(true)
  })

  it('does NOT emit redirect_chain when the link is broken (no double-count with broken_internal_links)', () => {
    const links: ValidationLink[] = [{ sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/t' }]
    const f = mapValidationFindings([], links, lookup({ 'https://x.com/t': broken() }), makeDeps())
    expect(f.some((x) => x.type === 'redirect_chain')).toBe(false)
  })

  it('redirect_loop on tooManyRedirects', () => {
    const links: ValidationLink[] = [{ sourcePageUrl: 'https://x.com/a', targetUrl: 'https://x.com/t' }]
    const f = mapValidationFindings([], links, lookup({ 'https://x.com/t': loop() }), makeDeps())
    expect(f.some((x) => x.type === 'redirect_loop')).toBe(true)
  })

  it('aggregates multiple hreflang_broken on one page into ONE page finding (count>1, no dup dedupKey)', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: null, hreflang: [
      { lang: 'en', href: 'https://x.com/en-dead' }, { lang: 'fr', href: 'https://x.com/fr-dead' },
    ] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/en-dead': broken(), 'https://x.com/fr-dead': broken() }), makeDeps())
    const pageFindings = f.filter((x) => x.scope === 'page' && x.type === 'hreflang_broken')
    expect(pageFindings).toHaveLength(1)
    expect(pageFindings[0].count).toBe(2)
    expect(new Set(f.map((x) => x.dedupKey)).size).toBe(f.length) // all dedupKeys distinct
  })

  it('hreflang_no_return only when both pages in-set and B does not link back', () => {
    const rows: ValidationSeoRow[] = [
      { url: 'https://x.com/a', canonicalUrl: null, hreflang: [{ lang: 'fr', href: 'https://x.com/b' }] },
      { url: 'https://x.com/b', canonicalUrl: null, hreflang: [] }, // no return to /a
    ]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/b': ok('https://x.com/b') }), makeDeps())
    expect(f.some((x) => x.type === 'hreflang_no_return' && x.url === normalizeFindingUrl('https://x.com/a'))).toBe(true)
  })

  it('no hreflang_no_return when B is not in the harvested set', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: null, hreflang: [{ lang: 'fr', href: 'https://x.com/notharvested' }] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/notharvested': ok('https://x.com/notharvested') }), makeDeps())
    expect(f.some((x) => x.type === 'hreflang_no_return')).toBe(false)
  })

  it('hreflang_missing_self + hreflang_missing_x_default for a cluster (>=2) lacking both', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: null, hreflang: [
      { lang: 'fr', href: 'https://x.com/b' }, { lang: 'de', href: 'https://x.com/c' },
    ] }]
    const f = mapValidationFindings(rows, [], lookup({ 'https://x.com/b': ok('https://x.com/b'), 'https://x.com/c': ok('https://x.com/c') }), makeDeps())
    expect(f.some((x) => x.type === 'hreflang_missing_self')).toBe(true)
    expect(f.some((x) => x.type === 'hreflang_missing_x_default')).toBe(true)
  })

  it('hreflang_invalid_code for a malformed lang', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: null, hreflang: [{ lang: 'not_a_lang!', href: 'https://x.com/a' }] }]
    const f = mapValidationFindings(rows, [], lookup({}), makeDeps())
    expect(f.some((x) => x.type === 'hreflang_invalid_code')).toBe(true)
  })

  it('cross-domain canonical/hreflang are recorded-unverified (run notices), never fetched', () => {
    const rows: ValidationSeoRow[] = [{ url: 'https://x.com/a', canonicalUrl: 'https://other.com/c', hreflang: [{ lang: 'fr', href: 'https://other.com/fr' }] }]
    // resolve lookup is EMPTY — cross-domain must not require a cache hit
    const f = mapValidationFindings(rows, [], lookup({}), makeDeps())
    expect(f.find((x) => x.type === 'canonical_external_unverified')?.count).toBe(1)
    expect(f.find((x) => x.type === 'hreflang_external_unverified')?.count).toBe(1)
    expect(f.some((x) => x.type === 'canonical_broken' || x.type === 'hreflang_broken')).toBe(false)
  })
})
