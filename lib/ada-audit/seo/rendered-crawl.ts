// lib/ada-audit/seo/rendered-crawl.ts
//
// L2 rendered-DOM discovery: fetch a page's <a href> graph via headless Chrome
// so JS-rendered navigation (invisible to raw-HTTP) is followed. Same
// FetchedPage shape as the raw fetcher so it plugs into hybridCrawl. Memory:
// subresources blocked + anchors capped per render; deadline-clamped nav/settle;
// cancellable acquire so a waiter never leaks a pool slot past the deadline.
import type { Page } from 'puppeteer-core'
import { acquirePage as realAcquirePage, releasePage as realReleasePage } from '../browser-pool'
import { installBrowserRequestGuard } from '../browser-request-guard'
import { postLoadSettle } from '../page-load'
import { sameDomain } from '../link-harvest'
import { assertSafeHttpUrl } from '../../security/safe-url'
import { normalizeCoverageUrl } from './discovery-coverage'
import { parsePositiveInt } from '@/lib/jobs/config'
import type { FetchedPage } from './hybrid-crawl'

const NAV_TIMEOUT_MS = 20_000
const SETTLE_TIMEOUT_MS = 3_000
const RENDER_MAX_ANCHORS = () => parsePositiveInt(process.env.HYBRID_RENDER_MAX_ANCHORS_PER_PAGE, 1500)

export interface RenderedFetchDeps {
  acquirePage: (opts?: { signal?: AbortSignal }) => Promise<Page>
  releasePage: (page: Page) => Promise<void>
  now: () => number
}
const REAL_DEPS: RenderedFetchDeps = { acquirePage: realAcquirePage, releasePage: realReleasePage, now: () => Date.now() }

/** Render `url` and return its same-host <a href> graph + post-redirect final
 *  URL, or null on SSRF block / nav failure / off-host redirect / deadline. */
export async function fetchPageLinksViaBrowser(
  url: string, auditedHost: string, deadlineMs: number, deps: RenderedFetchDeps = REAL_DEPS,
): Promise<FetchedPage | null> {
  if (deps.now() >= deadlineMs) return null // Codex fix 2: bail before the SSRF precheck too
  try { await assertSafeHttpUrl(url) } catch { return null } // check-then-fetch, fast-fail pre-acquire
  if (deps.now() >= deadlineMs) return null

  // The abort timer bounds how long we WAIT for a page; the real nav budget is
  // recomputed AFTER acquire (Codex fix 2) — acquirePage can block arbitrarily
  // long behind other audits, so a pre-acquire navTimeout would be stale.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineMs - deps.now()))
  ;(timer as unknown as { unref?: () => void }).unref?.()

  let page: Page | undefined
  try {
    page = await deps.acquirePage({ signal: controller.signal })
  } catch {
    clearTimeout(timer)
    return null // AcquireAbortedError (deadline) or launch failure — no slot leaked
  }
  try {
    const navTimeout = Math.min(NAV_TIMEOUT_MS, Math.max(0, deadlineMs - deps.now()))
    if (navTimeout <= 0) return null // deadline passed while acquiring — don't start work
    page.setDefaultNavigationTimeout(navTimeout)
    await installBrowserRequestGuard(page, { auditedHost, blockSubresources: true })
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout })
    if (!response || !response.ok()) return null
    const finalUrl = page.url()
    let finalHost: string
    try { finalHost = new URL(finalUrl).hostname.toLowerCase() } catch { return null }
    if (!sameDomain(finalHost, auditedHost.toLowerCase())) return null
    const settleTimeout = Math.min(SETTLE_TIMEOUT_MS, Math.max(0, deadlineMs - deps.now()))
    if (settleTimeout > 0) await postLoadSettle(page, { timeout: settleTimeout })
    const cap = RENDER_MAX_ANCHORS()
    const hrefs = (await page.evaluate(
      `(() => Array.from(document.querySelectorAll('a[href]')).slice(0, ${cap}).map(a => a.href))()`,
    )) as unknown
    return { links: Array.isArray(hrefs) ? (hrefs as string[]) : [], finalUrl }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    if (page) await deps.releasePage(page).catch(() => {})
  }
}

function segCount(url: string): number {
  try { return new URL(url).pathname.split('/').filter(Boolean).length } catch { return Number.MAX_SAFE_INTEGER }
}

/** The bounded probe set: homepage + up to `maxHubs` shallowest known hubs
 *  (real, already-discovered URLs — no 404 guesses). Deduped by coverage key. */
export function buildProbeTargets(host: string, knownUrls: string[], maxHubs: number): string[] {
  const home = `https://${host}/`
  const seen = new Set<string>([normalizeCoverageUrl(home)])
  const targets = [home]
  const hubs = [...knownUrls].sort((a, b) => (segCount(a) - segCount(b)) || (a < b ? -1 : a > b ? 1 : 0))
  for (const h of hubs) {
    if (targets.length >= 1 + maxHubs) break
    const k = normalizeCoverageUrl(h)
    if (seen.has(k)) continue
    seen.add(k)
    targets.push(h)
  }
  return targets
}
