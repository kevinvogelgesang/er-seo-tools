import type { Page } from 'puppeteer-core'
import { acquirePage, releasePage } from './browser-pool'
import { assertSafeHttpUrl } from '../security/safe-url'
import { installBrowserRequestGuard } from './browser-request-guard'

const FETCH_TIMEOUT = 20_000
const MAX_XML_BYTES = 5_000_000

const SITEMAP_ROOT_RE = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)?<(urlset|sitemapindex)\b/i

/**
 * Browser-based fallback for fetching a sitemap when Node's fetch is being
 * 403'd by a CDN/WAF. Owns its own request-interception layer for SSRF
 * defense — the runner's interception is per-runAxeAudit() and not inherited.
 * Returns null on any failure; caller surfaces.
 */
export async function fetchSitemapViaBrowser(url: string, deadlineMs?: number): Promise<string | null> {
  try {
    await assertSafeHttpUrl(url)
  } catch {
    return null
  }

  // Codex fix 1: when a discovery deadline is supplied, the browser sitemap
  // fallback can neither wait for a pool slot nor navigate/read past it.
  const now = () => Date.now()
  if (deadlineMs !== undefined && now() >= deadlineMs) return null

  const controller = new AbortController()
  const timer = deadlineMs !== undefined ? setTimeout(() => controller.abort(), Math.max(0, deadlineMs - now())) : null
  ;(timer as unknown as { unref?: () => void } | null)?.unref?.()

  let page: Page | undefined
  try {
    page = await acquirePage(deadlineMs !== undefined ? { signal: controller.signal } : undefined)
  } catch {
    if (timer) clearTimeout(timer)
    return null // AcquireAbortedError (deadline) or launch failure — no slot leaked
  }
  try {
    // Codex F2: recompute the nav budget AFTER acquire — the pool wait may have
    // consumed most of the deadline, so a pre-acquire timeout would be stale.
    const navTimeout = deadlineMs !== undefined ? Math.min(FETCH_TIMEOUT, Math.max(0, deadlineMs - now())) : FETCH_TIMEOUT
    if (navTimeout <= 0) return null
    page.setDefaultNavigationTimeout(navTimeout)

    await installBrowserRequestGuard(page) // no opts ⇒ SSRF-only, byte-identical to the old inline guard

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout })
    if (!response || !response.ok()) return null

    // Codex F4: bound the body read too — response.text() can buffer past the
    // deadline while holding the acquired page. Race it; on timeout finally
    // closes the page.
    const bodyPromise = response.text().catch(() => null)
    let text: string | null
    if (deadlineMs !== undefined) {
      const remaining = Math.max(0, deadlineMs - now())
      if (remaining <= 0) return null
      const TIMED_OUT = Symbol('body-timeout')
      let bt: ReturnType<typeof setTimeout> | undefined
      const timed = new Promise<typeof TIMED_OUT>((resolve) => { bt = setTimeout(() => resolve(TIMED_OUT), remaining) })
      ;(bt as unknown as { unref?: () => void } | undefined)?.unref?.()
      let raced: string | null | typeof TIMED_OUT
      try {
        raced = await Promise.race([bodyPromise, timed])
      } finally {
        clearTimeout(bt)
      }
      if (raced === TIMED_OUT) return null
      text = raced
    } else {
      text = await bodyPromise
    }
    if (!text) return null
    if (text.length > MAX_XML_BYTES) return null
    if (!SITEMAP_ROOT_RE.test(text)) return null
    return text
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
    if (page) await releasePage(page).catch(() => {})
  }
}
