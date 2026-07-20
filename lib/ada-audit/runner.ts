import path from 'path'
import type { HTTPRequest, HTTPResponse, Page } from 'puppeteer-core'
import { acquirePage, releasePage } from './browser-pool'
import { captureViolationScreenshots, SCREENSHOTS_DIR } from './screenshot-helpers'
import { assertSafeHttpUrl } from '../security/safe-url'
import { runLighthouse, resetCdpAfterLighthouse } from './lighthouse-runner'
import { getLighthouseProvider } from './lighthouse-provider'
import { harvestPdfLinks } from './pdf-discovery'
import { harvestLinks, type HarvestedTarget } from './link-harvest'
import type { RawPageSeo } from './seo/parse-seo-dom'
import { gotoWithRetryOn5xx, postLoadSettle } from './page-load'
import { isNoiseRequest } from './scanner-noise'
import { isTransientRunnerError } from './runner-retry'
import { classifyRunnerError } from './runner-errors'
import { detectRedirect, normalizeForRedirect } from './redirect-detect'
import { trimAxeResultsForStorage } from './axe-trim'
import type { StoredAxeResults } from './types'
import type { LighthouseSummary } from './lighthouse-types'
import { capViolationNodesForStorage, STORED_NODE_LIMIT } from './node-cap'
import { isRootUrl } from '@/lib/sales/root-url'

const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js')

// C14 hero: desktop capture viewport (2× for a crisp, full-bleed hero image)
// and the fixed grace period after the scroll-nudge + network settle, so
// fade-in / deferred-render hero content has finished painting before the
// screenshot. Restored to the puppeteer default (800×600, 1×) afterward so
// downstream axe analysis is unaffected. Env-overridable for tuning.
const HERO_VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 }
const DEFAULT_VIEWPORT = { width: 800, height: 600, deviceScaleFactor: 1 }
const HERO_CAPTURE_SETTLE_MS = parsePositiveIntEnv(process.env.HERO_CAPTURE_SETTLE_MS, 2500)
// Bound on the pre-capture scroll nudge (≈10 viewport heights, ~1s at 100ms
// each) so the loop can never approach the site-audit-page job timeout.
const HERO_SCROLL_MAX_STEPS = 10

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ─── SSRF protection ──────────────────────────────────────────────────────────
// SSRF is delegated to assertSafeHttpUrl, which handles IPv4-mapped IPv6,
// reserved ranges, blocked host suffixes (.localhost, .local, .internal, …),
// embedded credentials, and validates all resolved addresses.

export async function assertNotPrivate(hostname: string) {
  await assertSafeHttpUrl(`https://${hostname}`)
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export type ProgressCallback = (progress: number, message: string) => Promise<void>

export interface RunAxeOptions {
  captureScreenshots?: boolean
  screenshotDir?: string
  // Required — forwarded to the PDF orchestrator's adaAuditId attribution
  // and used as the screenshot directory name.
  auditId: string
  // When true, the pagespeed branch skips its inline PSI fetch. The caller
  // (lib/jobs/handlers/site-audit-page.ts) enqueues a PSI job separately via
  // lighthouse-queue. The local-LH branch is unaffected — local LH genuinely
  // needs the page slot and is not used in production.
  siteAudit?: boolean
  // C11: render-only SEO scan — keep navigation/settle/redirect-detect/harvest
  // but skip axe + screenshots + BOTH Lighthouse paths. Returns kind:'rendered'.
  renderOnly?: boolean
  // C14 hero: capture a viewport PNG of the loaded page (prospect root page
  // only — the caller decides). Bytes are RETURNED on the result — 'audited'
  // always; 'redirected' when the final URL is a RENDERED same-domain root
  // variant (root→www is the common prospect case, plan Codex fix 1). The
  // runner never writes the final file (publication is fenced to the
  // winning settle in site-audit-page.ts). Capture failure logs + never
  // fails the page.
  captureHeroScreenshot?: boolean
}

export type RunAxeResult =
  | {
      kind: 'audited'
      axe: StoredAxeResults
      lighthouseSummary: LighthouseSummary | null
      lighthouseError: string | null
      // Normalized + same-domain PDFs harvested from the loaded DOM. The caller
      // dispatches these through pdf-orchestrator.
      harvestedPdfUrls: string[]
      // C6: link/image targets harvested from the loaded DOM for the broken-link
      // verifier. Same-domain links/images + cross-domain external links.
      harvestedLinks: HarvestedTarget[]
      harvestedLinksTruncated: boolean
      // C6 Phase 2: on-page SEO captured in the same harvest evaluate (null if
      // the in-page extraction threw — non-fatal).
      harvestedPageSeo: RawPageSeo | null
      // C14 hero: viewport PNG bytes when captureHeroScreenshot was set and the
      // capture succeeded; null otherwise.
      heroScreenshotPng: Uint8Array | null
    }
  | {
      kind: 'redirected'
      finalUrl: string
      // C14 hero (plan Codex fix 1): redirect-detect deliberately classifies
      // root→www changes as redirects, so most prospect roots land here. When
      // the redirect was auto-followed (page RENDERED at finalUrl) and finalUrl
      // is still a same-domain root variant, the capture bytes ride along.
      heroScreenshotPng: Uint8Array | null
    }
  | {
      // C11: render-only result — no axe, no Lighthouse. Same harvest payload
      // as the audited variant so the live-scan builder is source-agnostic.
      kind: 'rendered'
      finalUrl?: string
      redirected?: boolean
      harvestedLinks: HarvestedTarget[]
      harvestedLinksTruncated: boolean
      harvestedPageSeo: RawPageSeo | null
    }

// Bucket 3: one fixed-delay retry when the pool/Chrome refuses a page
// (Target.createTarget / Target closed under load). INFRASTRUCTURE ONLY — every
// other acquire failure propagates unchanged. Covers BOTH the initial acquire
// and the in-nav re-acquire. `delayMs` is injectable so tests don't wait.
export async function acquirePageWithRetry(delayMs = 750): Promise<Page> {
  try {
    return await acquirePage()
  } catch (err) {
    if (classifyRunnerError(err).kind !== 'infrastructure') throw err
    await new Promise((r) => setTimeout(r, delayMs))
    return await acquirePage() // second failure propagates
  }
}

export async function runAxeAudit(
  targetUrl: string,
  wcagLevel: string = 'wcag21aa',
  onProgress?: ProgressCallback,
  options?: RunAxeOptions,
): Promise<RunAxeResult> {
  const progress = onProgress ?? (async () => {})
  if (!options?.auditId) {
    throw new Error('runAxeAudit: options.auditId is required')
  }

  await progress(5, 'Verifying URL…')
  const parsed = await assertSafeHttpUrl(targetUrl)

  await progress(10, 'Launching browser…')
  let page = await acquirePageWithRetry()
  // Ownership guard for the `finally` release. When the in-nav retry releases
  // the failing page and then re-acquires, a throw from the re-acquire would
  // otherwise leave `page` pointing at the already-released page and the finally
  // would release it a SECOND time (corrupting a pool slot). We flip this false
  // across the release→re-acquire window so the finally never double-releases.
  let pageOwned = true

  let lighthouseSummary: LighthouseSummary | null = null
  let lighthouseError: string | null = null
  let harvestedPdfUrls: string[] = []

  try {
    // Request-interception SSRF guard. Every Chrome request is validated
    // through assertSafeHttpUrl. This still fires while Lighthouse owns the
    // navigation — LH uses the same CDP session, so its requests run through
    // this same handler.
    const requestValidationCache = new Map<string, Promise<URL>>()
    let blockedNavigationError: Error | null = null

    const validateBrowserRequest = (requestUrl: string): Promise<URL> => {
      const parsedRequestUrl = new URL(requestUrl)
      if (['data:', 'blob:', 'about:'].includes(parsedRequestUrl.protocol)) {
        return Promise.resolve(parsedRequestUrl)
      }
      if (parsedRequestUrl.protocol !== 'http:' && parsedRequestUrl.protocol !== 'https:') {
        return Promise.reject(new Error(`Blocked unsupported browser request protocol: ${parsedRequestUrl.protocol}`))
      }

      const cacheKey = parsedRequestUrl.origin
      const cached = requestValidationCache.get(cacheKey)
      if (cached) return cached

      const validation = assertSafeHttpUrl(parsedRequestUrl)
      requestValidationCache.set(cacheKey, validation)
      return validation
    }

    const handleRequest = async (request: HTTPRequest) => {
      // Cheap noise-filter first. Never blocks the main frame — only sub-resources.
      if (
        !request.isNavigationRequest() &&
        isNoiseRequest(request.url(), request.resourceType())
      ) {
        if (!request.isInterceptResolutionHandled()) {
          await request.abort('blockedbyclient').catch(() => {})
        }
        return
      }

      try {
        await validateBrowserRequest(request.url())
        if (!request.isInterceptResolutionHandled()) {
          await request.continue()
        }
      } catch (err) {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          blockedNavigationError = err instanceof Error ? err : new Error('Unsafe navigation request blocked')
        }
        if (!request.isInterceptResolutionHandled()) {
          await request.abort('blockedbyclient').catch(() => {})
        }
      }
    }

    await page.setRequestInterception(true)
    page.on('request', (request) => {
      void handleRequest(request)
    })

    // C14 hero: shared capture helper. Never fails the page job. Widens the
    // viewport to desktop, nudges the page through a full scroll to trigger
    // lazy-loaded / scroll-reveal content, settles the network, then waits a
    // fixed grace period so fade-in hero text has painted before the shot.
    // Some marketing homepages (e.g. fei.edu) reveal hero copy on an animation
    // that fires after network-idle — a bare screenshot caught an empty hero.
    const captureHeroIfRequested = async (): Promise<Uint8Array | null> => {
      if (!options?.captureHeroScreenshot || options?.renderOnly) return null
      try {
        await page.setViewport(HERO_VIEWPORT)
        // Nudge the page in viewport-height steps to trigger IntersectionObserver
        // / lazy loaders, then return to the top so the capture frames the hero.
        // Hard-bounded (steps AND per-step delay) so an unusually tall or
        // adversarial homepage can't run the loop past the job timeout while
        // holding a pooled page — a handful of steps covers all above/near-fold
        // content, which is all a viewport (fullPage:false) capture needs.
        await page.evaluate(async (maxSteps: number) => {
          const step = Math.max(window.innerHeight, 1)
          const max = Math.max(document.body?.scrollHeight ?? 0, step)
          for (let i = 0, y = 0; i < maxSteps && y < max; i++, y += step) {
            window.scrollTo(0, y)
            await new Promise((r) => setTimeout(r, 100))
          }
          window.scrollTo(0, 0)
        }, HERO_SCROLL_MAX_STEPS)
        // Let images kicked off by the scroll finish, then hold for animations.
        await postLoadSettle(page, { idleTime: 500, timeout: 4_000 })
        await sleep(HERO_CAPTURE_SETTLE_MS)
        return await page.screenshot({ type: 'png', fullPage: false })
      } catch (err) {
        console.warn('[c14/hero] homepage screenshot capture failed:', (err as Error).message)
        return null
      } finally {
        // Restore the default viewport so axe runs at the same dimensions as
        // every other audited page (no change to accessibility results).
        await page.setViewport(DEFAULT_VIEWPORT).catch(() => {})
      }
    }

    // ── Phase 1: navigation owned by either Lighthouse or us ─────────────
    const provider = getLighthouseProvider()

    if (provider === 'local' && !options?.renderOnly) {
      // Existing single-navigation optimization: LH owns page.goto
      await progress(20, 'Running Lighthouse…')
      try {
        const lh = await runLighthouse(parsed.toString(), page)
        lighthouseSummary = lh.summary
        lighthouseError = lh.error ?? null
      } catch (err) {
        lighthouseError = err instanceof Error ? err.message : String(err)
      }
      // Reset CDP unconditionally — Lighthouse mutates network/CPU throttling
      // and cache state even if it errors mid-run.
      await resetCdpAfterLighthouse(page).catch(() => {})
    } else {
      // 'pagespeed' or 'off' (or any provider under renderOnly): we own navigation
      await progress(20, 'Loading page…')

      let response: HTTPResponse | null = null
      // Typed as a mutable holder so TS doesn't narrow it to `null` based on
      // initialization — the mutation happens inside attemptNavigation, which
      // is a closure that TS' control-flow analysis can't see through.
      // `rendered`: true when puppeteer auto-followed and the final page is
      // actually loaded in the tab (detectRedirect path); false on the
      // 3xx-with-Location no-autofollow path, where the target never rendered
      // and a screenshot would capture nothing meaningful.
      const redirectedHolder: { value: { finalUrl: string; rendered: boolean } | null } = { value: null }

      const attemptNavigation = async (currentPage: Page): Promise<void> => {
        try {
          response = await gotoWithRetryOn5xx(
            currentPage,
            parsed.toString(),
            { waitUntil: 'domcontentloaded', timeout: 30_000 },
            async () => { await progress(22, 'Retrying (upstream 5xx)…') },
          )
          // Settle stays INSIDE the same try so that any non-timeout rejection
          // during settle (frame detach, navigation reset) surfaces here and
          // the Phase 2 transient-retry layer sees it. The helper only swallows
          // waitForNetworkIdle's own timeout. See spec §"Decision 1".
          await postLoadSettle(currentPage)
        } catch (err) {
          if (blockedNavigationError) throw blockedNavigationError
          throw err
        }

        if (!response) throw new Error('No response received from page')
        const status = response.status()

        if (status === 304) {
          // Cache hardening on the page (browser-pool.ts) should have prevented this,
          // but if Chrome still served a validator-only response, retry once with a
          // cache-busting query param and explicit no-store headers. Failure surfaces
          // the original 304 message so the operator can re-run manually.
          await currentPage.setExtraHTTPHeaders({
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache',
          }).catch(() => {})
          const bustUrl = new URL(parsed.toString())
          bustUrl.searchParams.set('_cb', String(Date.now()))
          response = await currentPage.goto(bustUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await postLoadSettle(currentPage)
          if (!response) throw new Error('HTTP 304 Not Modified — retry also returned no response; re-run to get a fresh scan')
          if (response.status() === 304) {
            throw new Error('HTTP 304 Not Modified — cached response received twice; re-run to get a fresh scan')
          }
        }
        if (!response.ok()) {
          if (status === 403) throw new Error(`HTTP 403 — This site is blocking automated scanners. Try adding your server IP to the site's allowlist, or contact the site owner.`)
          if (status === 401) throw new Error(`HTTP 401 — This page requires authentication. The scanner cannot access password-protected pages.`)
          if (status >= 300 && status < 400) {
            // Bucket 4: ANY Location-bearing 3xx is a redirect, regardless of
            // whether puppeteer already followed part of the chain. The old
            // `chain.length === 0` gate wrongly threw "did not auto-follow" for
            // non-empty chains (e.g. a mid-chain http→https flip). Record the
            // target; the child settles `redirected`, `pagesRedirected++`.
            const finalUrl = response.url()
            const location = response.headers()['location'] ?? null
            if (location) {
              try {
                // Resolve against the FINAL response URL (handles mid-chain
                // http/https flips), not only the originally-requested URL.
                const resolved = new URL(location, finalUrl).toString()
                // No-progress loop guard: a redirect pointing at its own final
                // URL is a genuine broken redirect. Use normalizeForRedirect
                // (shared: default-port/host-case/trailing-slash/fragment
                // insensitive) — NOT an inline regex that would miss those.
                if (normalizeForRedirect(resolved) !== normalizeForRedirect(finalUrl)) {
                  redirectedHolder.value = { finalUrl: resolved, rendered: false }
                  return // exit attemptNavigation — outer code checks redirectedHolder
                }
              } catch {
                /* malformed Location — fall through to error path */
              }
            }
            const detail = location
              ? `Redirected to ${location} (final URL was ${finalUrl}); no forward progress`
              : `Server returned ${status} with no Location header (final URL: ${finalUrl})`
            throw new Error(`HTTP ${status} — ${detail}`)
          }
          throw new Error(`HTTP ${status} — ${response.statusText()}`)
        }

        // Server-side redirect detection. Use puppeteer's chain data —
        // page.url() after settle can change due to meta refresh / JS
        // navigation, which we do NOT want to flag as redirects.
        // IMPORTANT: this runs BEFORE the content-type check so a redirect
        // whose final destination isn't HTML (e.g. PDF) reports as redirected
        // rather than as "Response is not HTML".
        const chain = response!.request().redirectChain()
        const detected = detectRedirect(parsed.toString(), chain, response!.url())
        if (detected.kind === 'redirected') {
          redirectedHolder.value = { finalUrl: detected.finalUrl, rendered: true }
          return  // exit attemptNavigation — outer code will check redirectedHolder
        }

        const contentType = response.headers()['content-type'] ?? ''
        if (!contentType.includes('html')) throw new Error(`Response is not HTML (Content-Type: ${contentType})`)
      }

      try {
        await attemptNavigation(page)
        if (redirectedHolder.value) {
          const { finalUrl, rendered } = redirectedHolder.value
          // C14 hero (plan Codex fix 1): a root→www (or scheme) redirect is still
          // the prospect's homepage — capture the RENDERED final page when its URL
          // is a same-domain root variant of the originally requested host.
          // Off-domain or cross-path redirects capture nothing. parsed.hostname is
          // the original target's host; isRootUrl is www/scheme-insensitive.
          const heroScreenshotPng =
            rendered && isRootUrl(finalUrl, parsed.hostname) ? await captureHeroIfRequested() : null
          return { kind: 'redirected', finalUrl, heroScreenshotPng }
        }
      } catch (err) {
        if (!isTransientRunnerError(err)) throw err

        await progress(23, 'Transient error — retrying with fresh page…')

        // Release the failing page and acquire a fresh one. `about:blank` is
        // insufficient for `Navigating frame was detached` because Puppeteer's
        // frame tree may be in an unrecoverable state. A fresh page also clears
        // any half-applied request-interception state.
        // Transfer ownership OUT before re-acquiring (Bucket 3): flip the guard
        // false so that if `acquirePageWithRetry` below throws, the finally does
        // not release this already-released page a second time.
        pageOwned = false
        await releasePage(page).catch(() => {})
        page = await acquirePageWithRetry()
        pageOwned = true

        // Re-apply hardening from browser-pool (idempotent) and re-register the
        // request handler on the new page.
        await page.setRequestInterception(true)
        page.on('request', (request) => { void handleRequest(request) })
        // Note: `validateBrowserRequest` and `blockedNavigationError` close over
        // the outer scope and continue to work without re-binding.

        blockedNavigationError = null
        await attemptNavigation(page)
        if (redirectedHolder.value) {
          const { finalUrl, rendered } = redirectedHolder.value
          // C14 hero (plan Codex fix 1): a root→www (or scheme) redirect is still
          // the prospect's homepage — capture the RENDERED final page when its URL
          // is a same-domain root variant of the originally requested host.
          // Off-domain or cross-path redirects capture nothing. parsed.hostname is
          // the original target's host; isRootUrl is www/scheme-insensitive.
          const heroScreenshotPng =
            rendered && isRootUrl(finalUrl, parsed.hostname) ? await captureHeroIfRequested() : null
          return { kind: 'redirected', finalUrl, heroScreenshotPng }
        }
      }

      if (provider === 'pagespeed' && !options?.renderOnly) {
        if (options?.siteAudit) {
          // Site audit: PSI is queued separately via lighthouse-queue and
          // does not hold the puppeteer page slot. lighthouseSummary stays
          // null; the PSI worker fills it in later.
          await progress(22, 'Queueing Lighthouse…')
        } else {
          // Standalone single-page audit: keep PSI inline. The user is
          // already awaiting this single request — no throughput problem
          // to solve, and the single-page UI flow expects LH data in the
          // returned result.
          await progress(22, 'Fetching Lighthouse from PageSpeed Insights…')
          try {
            const lh = await runLighthouse(parsed.toString(), page)
            lighthouseSummary = lh.summary
            lighthouseError = lh.error ?? null
          } catch (err) {
            lighthouseError = err instanceof Error ? err.message : String(err)
          }
        }
      }
      // provider === 'off' just skips Lighthouse and proceeds to axe (Phase 2 below)
    }

    // ── C14 hero capture (non-redirect path) ─────────────────────────────
    // Viewport PNG of the loaded page, after Phase-1 navigation + settle and
    // BEFORE axe mutates focus/scroll state. Site audits skip inline PSI
    // (options.siteAudit), so for the prospect path this runs directly after
    // postLoadSettle. The redirect paths above capture separately (rendered
    // same-domain root variants only).
    const heroScreenshotPng: Uint8Array | null = await captureHeroIfRequested()

    // ── Phase 2: axe on the already-loaded page ──────────────────────────
    // Skipped entirely under renderOnly (SEO scan) — no axe, no screenshots,
    // no PDF harvest. The `axe` binding stays undefined and is never read on
    // the render-only path (it returns early before the audited return below).
    let axe: StoredAxeResults | undefined
    if (!options?.renderOnly) {
      await progress(75, 'Analyzing page…')
      const domElementCount = await page.evaluate(() => document.querySelectorAll('*').length)

      await progress(82, 'Running accessibility checks…')
      await page.addScriptTag({ path: AXE_PATH })

      // WCAG 2.1 AA = all 2.0 A/AA rules + new 2.1 rules.
      // WCAG 2.2 AA adds 2.2 AA on top. Passing only 'wcag21aa' misses inherited 2.0 rules.
      // "best practices" mode adds best-practice rules + WCAG 2.2 AA on top of 2.1 AA.
      const wcagTags = wcagLevel === 'wcag22aa'
        ? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
        : ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

      // C13: reporter 'v2', NOT 'no-passes' — axe's no-passes reporter silently
      // forces resultTypes to ['violations'], stripping incomplete too (which
      // zeroed every pass/needs-review count and killed the v2 incomplete
      // penalty fleet-wide). 'v2' honors resultTypes: violations + incomplete
      // come back with full nodes; passes/inapplicable truncated to one node
      // each. trimAxeResultsForStorage runs IN-PAGE (string-injected, see its
      // header) so the discarded arrays never cross the CDP wire.
      const axeOpts = {
        runOnly: { type: 'tag', values: wcagTags },
        resultTypes: ['violations', 'incomplete'],
        reporter: 'v2',
        iframes: false,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawResults: any = await page.evaluate(`(async () => {
        const results = await window.axe.run(document, ${JSON.stringify(axeOpts)});
        return (${trimAxeResultsForStorage.toString()})(results);
      })()`)

      await progress(90, 'Processing results…')
      rawResults.violations = capViolationNodesForStorage(rawResults.violations)
      if (Array.isArray(rawResults.incomplete)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawResults.incomplete = rawResults.incomplete.map((v: any) => ({
          ...v,
          nodes: v.nodes.slice(0, STORED_NODE_LIMIT),
        }))
      }

      axe = rawResults as StoredAxeResults
      axe.domElementCount = domElementCount

      const shouldCapture = options?.captureScreenshots !== false  // default ON
      if (shouldCapture && options?.auditId) {
        const screenshotDir = options.screenshotDir ?? path.join(SCREENSHOTS_DIR, options.auditId)
        await progress(93, 'Capturing element screenshots…')
        try {
          await captureViolationScreenshots(page, axe.violations, screenshotDir)
        } catch (err) {
          console.warn('[ada-audit/screenshots] capture phase failed, continuing:', err)
        }
        // Capture was attempted; record that, independent of whether any
        // violations existed (a clean page legitimately yields zero shots).
        axe.captureScreenshots = true
      }

      // ── Phase 3: PDF harvest from same DOM ───────────────────────────────
      // Harvest failure must not fail the audit — log + return empty list.
      await progress(95, 'Harvesting linked PDFs…')
      try {
        harvestedPdfUrls = await harvestPdfLinks(page, parsed.hostname.toLowerCase())
      } catch (e) {
        console.warn('[ada-audit] PDF harvest failed:', (e as Error).message)
        harvestedPdfUrls = []
      }
    }

    // C6: harvest <a href> + <img src> targets + on-page SEO for the live-scan
    // builder. Non-fatal (best-effort), same contract as the PDF harvest above.
    // Runs for BOTH the audited and render-only paths — the harvest is what the
    // SEO live-scan builder consumes.
    let harvestedLinks: HarvestedTarget[] = []
    let harvestedLinksTruncated = false
    let harvestedPageSeo: RawPageSeo | null = null
    try {
      const h = await harvestLinks(page, parsed.hostname.toLowerCase())
      harvestedLinks = h.targets
      harvestedLinksTruncated = h.truncated
      harvestedPageSeo = h.pageSeo
    } catch (e) {
      console.warn('[ada-audit] link/seo harvest failed:', (e as Error).message)
    }

    if (options?.renderOnly) {
      return { kind: 'rendered', harvestedLinks, harvestedLinksTruncated, harvestedPageSeo }
    }

    return { kind: 'audited', axe: axe as StoredAxeResults, lighthouseSummary, lighthouseError, harvestedPdfUrls, harvestedLinks, harvestedLinksTruncated, harvestedPageSeo, heroScreenshotPng }
  } finally {
    if (pageOwned) await releasePage(page)
  }
}
