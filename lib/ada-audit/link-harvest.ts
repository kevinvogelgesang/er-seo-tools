// lib/ada-audit/link-harvest.ts
//
// Pure rendered-DOM link/image harvest (C6 Phase 1). Mirrors pdf-discovery.ts:
// one page.evaluate reads every <a href> + <img src>, then classifyTargets
// (pure, unit-testable) resolves/normalizes/classifies them. Same-domain is
// exact-host + www-insensitive in v1 (subdomains are external — documented).
import type { Page } from 'puppeteer-core'

export type HarvestedTargetKind = 'internal-link' | 'image' | 'external-link'
export interface HarvestedTarget {
  targetUrl: string
  kind: HarvestedTargetKind
}

const stripWww = (host: string) => host.replace(/^www\./, '')
const sameDomain = (host: string, audited: string) => stripWww(host) === stripWww(audited)

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
  return u.toString()
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
): { targets: HarvestedTarget[]; truncated: boolean } {
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
    all.push({ targetUrl: url, kind })
  }
  for (const h of linkHrefs) consider(h, 'internal-link')
  for (const s of imageSrcs) consider(s, 'image')
  const truncated = all.length > cap
  return { targets: truncated ? all.slice(0, cap) : all, truncated }
}

const HARVEST_CAP = 300

/** Read every <a href> and <img src> from the loaded page, then classify. */
export async function harvestLinks(
  page: Page,
  auditedHost: string,
): Promise<{ targets: HarvestedTarget[]; truncated: boolean }> {
  const { links, images } = await page.evaluate(() => ({
    links: Array.from(document.querySelectorAll('a[href]')).map(
      (a) => (a as HTMLAnchorElement).getAttribute('href') || '',
    ),
    images: Array.from(document.querySelectorAll('img[src]')).map(
      (i) => (i as HTMLImageElement).getAttribute('src') || '',
    ),
  }))
  return classifyTargets(links, images, auditedHost, page.url(), HARVEST_CAP)
}
