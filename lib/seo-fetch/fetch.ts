import 'server-only'
import {
  SafeUrlError,
  readResponseBytesWithLimit,
  readResponseTextWithLimit,
  safeFetch,
} from '@/lib/security/safe-url'
import { extractChildSitemapLocs, extractPageLocs, isSitemapIndex } from './sitemap-parse'

// Browser-shaped UA. CDN/WAF heuristics frequently 403 transparently bot
// user-agents like "ER-SEO-Tools/1.0", which causes silent sitemap discovery
// failures. Pretending to be Chrome matches what a manual fetch of the same
// URL looks like to those filters. (Moved from lib/ada-audit/sitemap-crawler.ts.)
export const SEO_FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const MAX_ROBOTS_BYTES = 500_000
export const MAX_SITEMAP_XML_BYTES = 5_000_000
const FETCH_TIMEOUT_MS = 15_000

export type SeoFetchFailure =
  | 'http-error'        // response arrived, response.ok false
  | 'not-xml'           // sitemap fetch got HTML content-type (login redirect / soft 404)
  | 'too-large'         // byte cap exceeded (truncated body is never returned)
  | 'unsafe-url'        // SafeUrlError reason 'policy' — SSRF guard rejected
  | 'dns'               // SafeUrlError reason 'dns' — hostname did not resolve
  | 'redirect'          // SafeUrlError reason 'redirect'
  | 'invalid-response'  // bad response shape (or corrupt gzip body)
  | 'timeout'           // AbortSignal.timeout fired
  | 'network'           // anything else thrown (TCP reset, TLS, ...)

// Discriminated union — impossible states are unrepresentable.
export type SeoFetchResult =
  | { ok: true; status: number; text: string; finalUrl: string; failure: null; truncated: false }
  | { ok: false; status: number | null; text: null; finalUrl: string | null; failure: SeoFetchFailure; truncated: boolean }

function classifyThrown(err: unknown): SeoFetchFailure {
  if (err instanceof SafeUrlError) {
    if (err.reason === 'dns') return 'dns'
    if (err.reason === 'redirect') return 'redirect'
    if (err.reason === 'invalid-response') return 'invalid-response'
    return 'unsafe-url'
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout'
  return 'network'
}

function thrownFailure(err: unknown): SeoFetchResult {
  return { ok: false, status: null, text: null, finalUrl: null, failure: classifyThrown(err), truncated: false }
}

async function cancelBody(response: Response): Promise<void> {
  try { await response.body?.cancel() } catch { /* already consumed/closed */ }
}

// Acquisition is split from body processing (Codex plan #2): a throw BEFORE a
// response exists yields null status/finalUrl; a throw while READING an
// acquired response retains the response's status + finalUrl.
async function acquire(
  url: string,
  accept?: string,
): Promise<{ response: Response; finalUrl: string } | SeoFetchResult> {
  try {
    const { response, url: finalUrl } = await safeFetch(url, {
      headers: accept
        ? { 'User-Agent': SEO_FETCH_USER_AGENT, Accept: accept }
        : { 'User-Agent': SEO_FETCH_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    return { response, finalUrl }
  } catch (err) {
    return thrownFailure(err)
  }
}

function isFailure(a: { response: Response; finalUrl: string } | SeoFetchResult): a is SeoFetchResult {
  return 'ok' in a
}

/**
 * GET robots.txt via safeFetch. Input contract: `new URL('/robots.txt', baseUrl)`
 * — accepts an origin with or without trailing slash; any path on baseUrl is
 * REPLACED, never appended. 15 s timeout, 500 KB cap.
 */
export async function fetchRobotsTxt(baseUrl: string): Promise<SeoFetchResult> {
  let target: string
  try {
    target = new URL('/robots.txt', baseUrl).toString()
  } catch {
    return { ok: false, status: null, text: null, finalUrl: null, failure: 'unsafe-url', truncated: false }
  }
  const acquired = await acquire(target)
  if (isFailure(acquired)) return acquired
  const { response, finalUrl } = acquired
  try {
    if (!response.ok) {
      await cancelBody(response)
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'http-error', truncated: false }
    }
    const { text, truncated } = await readResponseTextWithLimit(response, MAX_ROBOTS_BYTES)
    if (truncated) {
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'too-large', truncated: true }
    }
    return { ok: true, status: response.status, text, finalUrl, failure: null, truncated: false }
  } catch (err) {
    return { ok: false, status: response.status, text: null, finalUrl, failure: classifyThrown(err), truncated: false }
  }
}

/**
 * GET one sitemap document via safeFetch. Handles .gz (gunzip, capped),
 * rejects HTML content-types (login redirects, soft 404s), 5 MB cap.
 */
export async function fetchSitemapXml(url: string): Promise<SeoFetchResult> {
  const acquired = await acquire(url, 'text/xml,application/xml,*/*')
  if (isFailure(acquired)) return acquired
  const { response, finalUrl } = acquired
  try {
    if (!response.ok) {
      await cancelBody(response)
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'http-error', truncated: false }
    }
    const ct = response.headers.get('content-type') ?? ''
    // Reject HTML responses (login redirects, 404 pages served as 200, etc.).
    // NOTE application/xhtml+xml contains BOTH substrings and is accepted —
    // inherited crawler behavior, test-pinned (Codex plan #5).
    if (ct.includes('html') && !ct.includes('xml')) {
      await cancelBody(response)
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'not-xml', truncated: false }
    }

    // Handle gzip-compressed sitemaps
    if (finalUrl.endsWith('.gz') || ct.includes('gzip')) {
      const { bytes, truncated } = await readResponseBytesWithLimit(response, MAX_SITEMAP_XML_BYTES)
      if (truncated) {
        return { ok: false, status: response.status, text: null, finalUrl, failure: 'too-large', truncated: true }
      }
      let xml: string
      try {
        const { gunzipSync } = await import('node:zlib')
        xml = gunzipSync(Buffer.from(bytes), { maxOutputLength: MAX_SITEMAP_XML_BYTES }).toString('utf-8')
      } catch (err) {
        const tooLarge = (err as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE'
        return {
          ok: false, status: response.status, text: null, finalUrl,
          failure: tooLarge ? 'too-large' : 'invalid-response', truncated: tooLarge,
        }
      }
      if (xml.length > MAX_SITEMAP_XML_BYTES) {
        return { ok: false, status: response.status, text: null, finalUrl, failure: 'too-large', truncated: true }
      }
      return { ok: true, status: response.status, text: xml, finalUrl, failure: null, truncated: false }
    }

    const { text, truncated } = await readResponseTextWithLimit(response, MAX_SITEMAP_XML_BYTES)
    if (truncated) {
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'too-large', truncated: true }
    }
    return { ok: true, status: response.status, text, finalUrl, failure: null, truncated: false }
  } catch (err) {
    return { ok: false, status: response.status, text: null, finalUrl, failure: classifyThrown(err), truncated: false }
  }
}

export interface CollectSitemapResult {
  urls: string[]
  /** Same-domain children found in a sitemapindex (0 for a plain urlset). */
  childrenTotal: number
  /** Children whose fetch returned null. */
  childrenFailed: number
}

/**
 * Given fetched sitemap XML: plain urlset → its page locs; sitemapindex →
 * fetch same-domain children via the injected fetcher (batches of 5, polite)
 * and collect their page locs. ONE level of index expansion only — a child
 * that is itself an index contributes no pages (frozen current behavior;
 * do not introduce recursion). The injected fetcher is where the ADA crawler
 * plugs in its direct→browser-fallback fetch; D4/D5 pass a direct fetch.
 */
export async function collectSitemapPageUrls(
  xml: string,
  isSameDomain: (url: string) => boolean,
  fetchXml: (url: string) => Promise<string | null>,
): Promise<CollectSitemapResult> {
  if (!isSitemapIndex(xml)) {
    return { urls: extractPageLocs(xml), childrenTotal: 0, childrenFailed: 0 }
  }

  const childUrls = extractChildSitemapLocs(xml).filter((u) => isSameDomain(u))
  const urls: string[] = []
  let childrenFailed = 0

  const BATCH = 5
  for (let i = 0; i < childUrls.length; i += BATCH) {
    const batch = childUrls.slice(i, i + BATCH)
    const childXmls = await Promise.all(batch.map((u) => fetchXml(u)))
    for (const childXml of childXmls) {
      // Falsy check on purpose: an empty-string body counts as a failed child,
      // matching the crawler's historical `if (!childXml) continue` (Codex plan #3).
      if (!childXml) {
        childrenFailed++
        continue
      }
      urls.push(...extractPageLocs(childXml))
    }
  }

  return { urls, childrenTotal: childUrls.length, childrenFailed }
}
