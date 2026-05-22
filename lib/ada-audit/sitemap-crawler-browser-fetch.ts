import type { HTTPRequest, Page } from 'puppeteer-core'
import { acquirePage, releasePage } from './browser-pool'
import { assertSafeHttpUrl } from '../security/safe-url'

const FETCH_TIMEOUT = 20_000
const MAX_XML_BYTES = 5_000_000

const SITEMAP_ROOT_RE = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)?<(urlset|sitemapindex)\b/i

/**
 * Browser-based fallback for fetching a sitemap when Node's fetch is being
 * 403'd by a CDN/WAF. Owns its own request-interception layer for SSRF
 * defense — the runner's interception is per-runAudit() and not inherited.
 * Returns null on any failure; caller surfaces.
 */
export async function fetchSitemapViaBrowser(url: string): Promise<string | null> {
  try {
    await assertSafeHttpUrl(url)
  } catch {
    return null
  }

  let page: Page | undefined
  try {
    page = await acquirePage()
    page.setDefaultNavigationTimeout(FETCH_TIMEOUT)

    await page.setRequestInterception(true)
    page.on('request', (request: HTTPRequest) => {
      void (async () => {
        try {
          await assertSafeHttpUrl(request.url())
          if (!request.isInterceptResolutionHandled()) {
            await request.continue()
          }
        } catch {
          if (!request.isInterceptResolutionHandled()) {
            await request.abort('blockedbyclient').catch(() => {})
          }
        }
      })()
    })

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT })
    if (!response || !response.ok()) return null

    const text = await response.text().catch(() => null)
    if (!text) return null
    if (text.length > MAX_XML_BYTES) return null
    if (!SITEMAP_ROOT_RE.test(text)) return null
    return text
  } catch {
    return null
  } finally {
    if (page) await releasePage(page).catch(() => {})
  }
}
