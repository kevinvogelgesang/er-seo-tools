// lib/ada-audit/link-harvest.ts
//
// Pure rendered-DOM link/image harvest (C6 Phase 1). Mirrors pdf-discovery.ts:
// one page.evaluate reads every <a href> + <img src>, then classifyTargets
// (pure, unit-testable) resolves/normalizes/classifies them. Same-domain is
// exact-host + www-insensitive in v1 (subdomains are external — documented).
import type { Page } from 'puppeteer-core'
import { isExcludedCrawlPath } from './crawl-exclude'
import { parseSeoFromDocument, type RawPageSeo } from './seo/parse-seo-dom'

export type HarvestedTargetKind = 'internal-link' | 'image' | 'external-link'
export interface HarvestedTarget {
  targetUrl: string
  kind: HarvestedTargetKind
  /** anchor-text: first-occurrence normalized anchor for internal-link rows only. */
  anchorText?: string
}

/** Self-contained: injected into the page via .toString(). Returns {href,text}
 *  per <a href>; text = trimmed textContent, else first descendant img alt,
 *  capped at 2048 (== ANCHOR_TEXT_MAX; the literal is inlined because injected
 *  code cannot import module constants). MUST NOT emit an SWC helper (no typeof). */
export function harvestAnchorsFromDocument(document: Document): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = []
  const anchors = document.querySelectorAll('a[href]')
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const href = a.getAttribute('href') || ''
    let text = (a.textContent || '').trim()
    if (!text) {
      const img = a.querySelector('img[alt]')
      if (img) text = (img.getAttribute('alt') || '').trim()
    }
    if (text.length > 2048) text = text.slice(0, 2048)
    out.push({ href: href, text: text })
  }
  return out
}

const stripWww = (host: string) => host.replace(/^www\./, '')
export const sameDomain = (host: string, audited: string) => stripWww(host) === stripWww(audited)

/** Resolve + normalize a raw href/src. Returns null for non-navigational refs. */
export function normalizeLinkTarget(raw: string, base: string): string | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t || t.startsWith('#')) return null
  if (/^(mailto:|javascript:|tel:|data:|blob:|about:)/i.test(t)) return null
  let u: URL
  try {
    u = new URL(t, base)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  const out = u.toString()
  if (isExcludedCrawlPath(out)) return null
  return out
}

/**
 * Classify raw link + image hrefs into deduped, capped HarvestedTargets.
 * Same-domain links/images keep their internal-link/image kind; cross-domain
 * (including subdomains in v1) become external-link (recorded, not verified).
 * Dedup by (kind, url).
 */
export function classifyTargets(
  linkHrefs: string[],
  imageSrcs: string[],
  auditedHost: string,
  base: string,
  cap: number,
  anchorPairs?: { href: string; text: string }[],
): { targets: HarvestedTarget[]; truncated: boolean } {
  // Map raw href -> first anchor text (first occurrence wins). Keys on the RAW
  // href (matching what `consider` receives) so resolution/dedup stay unchanged.
  const anchorByHref = new Map<string, string>()
  if (anchorPairs) for (const p of anchorPairs) if (!anchorByHref.has(p.href)) anchorByHref.set(p.href, p.text)

  const seen = new Set<string>()
  const all: HarvestedTarget[] = []
  const consider = (raw: string, internalKind: HarvestedTargetKind) => {
    const url = normalizeLinkTarget(raw, base)
    if (!url) return
    let host: string
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      return
    }
    const kind: HarvestedTargetKind = sameDomain(host, auditedHost.toLowerCase())
      ? internalKind
      : 'external-link'
    const key = `${kind} ${url}`
    if (seen.has(key)) return
    seen.add(key)
    const t: HarvestedTarget = { targetUrl: url, kind }
    if (kind === 'internal-link' && anchorByHref.has(raw)) t.anchorText = anchorByHref.get(raw)
    all.push(t)
  }
  for (const h of linkHrefs) consider(h, 'internal-link')
  for (const s of imageSrcs) consider(s, 'image')
  const truncated = all.length > cap
  return { targets: truncated ? all.slice(0, cap) : all, truncated }
}

const HARVEST_CAP = 300

/** Read every <a href> + <img src> AND on-page SEO from the loaded page in one
 *  evaluate, then classify links. pageSeo is null only if the in-page eval throws. */
export async function harvestLinks(
  page: Page,
  auditedHost: string,
): Promise<{ targets: HarvestedTarget[]; truncated: boolean; pageSeo: RawPageSeo | null }> {
  const { links, images, anchors, seo } = await page.evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '');
    const images = Array.from(document.querySelectorAll('img[src]')).map(i => i.getAttribute('src') || '');
    const anchors = (${harvestAnchorsFromDocument.toString()})(document);
    const seo = (${parseSeoFromDocument.toString()})(document, window);
    return { links, images, anchors, seo };
  })()`) as { links: string[]; images: string[]; anchors: { href: string; text: string }[]; seo: RawPageSeo }
  const { targets, truncated } = classifyTargets(links, images, auditedHost, page.url(), HARVEST_CAP, anchors)
  return { targets, truncated, pageSeo: seo ?? null }
}
