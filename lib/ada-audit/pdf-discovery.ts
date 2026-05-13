// lib/ada-audit/pdf-discovery.ts
import type { Page } from 'puppeteer-core'

/**
 * Normalize a PDF URL for dedup. Returns null if the URL doesn't point at a .pdf
 * or can't be parsed.
 *
 * - Resolves relative URLs against `base` if provided.
 * - Strips query string and fragment.
 * - Lowercases the host. Preserves path case (case-sensitive on most servers).
 */
export function normalizePdfUrl(raw: string, base?: string): string | null {
  let u: URL
  try {
    u = base ? new URL(raw, base) : new URL(raw)
  } catch {
    return null
  }
  if (!u.pathname.toLowerCase().endsWith('.pdf')) return null
  u.search = ''
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  u.protocol = u.protocol.toLowerCase()
  return u.toString()
}

/** Normalize + dedup a list of raw URLs. Order not preserved. */
export function dedupePdfUrls(raws: string[], base?: string): string[] {
  const set = new Set<string>()
  for (const r of raws) {
    const n = normalizePdfUrl(r, base)
    if (n) set.add(n)
  }
  return Array.from(set)
}

/**
 * Harvest all same-domain PDF links from the currently loaded page.
 * Uses page.evaluate to read every <a href> in the DOM, then filters server-side
 * to same-domain pdfs after normalization.
 */
export async function harvestPdfLinks(
  page: Page,
  audittedDomain: string,
): Promise<string[]> {
  const hrefs: string[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter(Boolean),
  )
  const base = page.url()
  const sameDomain = audittedDomain.toLowerCase()
  return dedupePdfUrls(hrefs, base).filter((u) => {
    try {
      return new URL(u).hostname.toLowerCase() === sameDomain
    } catch {
      return false
    }
  })
}
