import path from 'path'
import type { HTTPRequest, HTTPResponse, Page } from 'puppeteer-core'
import { acquirePage, releasePage } from './browser-pool'
import { captureViolationScreenshots } from './screenshot-helpers'
import { assertSafeHttpUrl } from '../security/safe-url'
import { runLighthouse, resetCdpAfterLighthouse } from './lighthouse-runner'
import { getLighthouseProvider } from './lighthouse-provider'
import { harvestPdfLinks } from './pdf-discovery'
import { gotoWithRetryOn5xx, postLoadSettle } from './page-load'
import { isNoiseRequest } from './scanner-noise'
import { isTransientRunnerError } from './runner-retry'
import type { StoredAxeResults } from './types'
import type { LighthouseSummary } from './lighthouse-types'

const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js')

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
  // (queue-manager.ts:runAudit) enqueues a PSI job separately via
  // lighthouse-queue. The local-LH branch is unaffected — local LH genuinely
  // needs the page slot and is not used in production.
  siteAudit?: boolean
}

export interface RunAxeResult {
  axe: StoredAxeResults
  lighthouseSummary: LighthouseSummary | null
  lighthouseError: string | null
  // Normalized + same-domain PDFs harvested from the loaded DOM. The caller
  // dispatches these through pdf-orchestrator.
  harvestedPdfUrls: string[]
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
  let page = await acquirePage()

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

    // ── Phase 1: navigation owned by either Lighthouse or us ─────────────
    const provider = getLighthouseProvider()

    if (provider === 'local') {
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
      // 'pagespeed' or 'off': we own navigation
      await progress(20, 'Loading page…')

      let response: HTTPResponse | null = null

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
            const finalUrl = response.url()
            const location = response.headers()['location'] ?? null
            const detail = location
              ? `Redirected to ${location} (final URL was ${finalUrl}); puppeteer did not auto-follow`
              : `Server returned ${status} with no Location header (final URL: ${finalUrl})`
            throw new Error(`HTTP ${status} — ${detail}`)
          }
          throw new Error(`HTTP ${status} — ${response.statusText()}`)
        }

        const contentType = response.headers()['content-type'] ?? ''
        if (!contentType.includes('html')) throw new Error(`Response is not HTML (Content-Type: ${contentType})`)
      }

      try {
        await attemptNavigation(page)
      } catch (err) {
        if (!isTransientRunnerError(err)) throw err

        await progress(23, 'Transient error — retrying with fresh page…')

        // Release the failing page and acquire a fresh one. `about:blank` is
        // insufficient for `Navigating frame was detached` because Puppeteer's
        // frame tree may be in an unrecoverable state. A fresh page also clears
        // any half-applied request-interception state.
        await releasePage(page).catch(() => {})
        page = await acquirePage()

        // Re-apply hardening from browser-pool (idempotent) and re-register the
        // request handler on the new page.
        await page.setRequestInterception(true)
        page.on('request', (request) => { void handleRequest(request) })
        // Note: `validateBrowserRequest` and `blockedNavigationError` close over
        // the outer scope and continue to work without re-binding.

        blockedNavigationError = null
        await attemptNavigation(page)
      }

      if (provider === 'pagespeed') {
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

    // ── Phase 2: axe on the already-loaded page ──────────────────────────
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawResults = await page.evaluate(async (axeOpts: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).axe.run(document, axeOpts)
    }, {
      runOnly: { type: 'tag', values: wcagTags },
      resultTypes: ['violations', 'incomplete'],
      reporter: 'no-passes',
      iframes: false,
    })

    await progress(90, 'Processing results…')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawResults.violations = rawResults.violations.map((v: any) => ({
      ...v,
      nodes: v.nodes.slice(0, 20),
    }))
    if (Array.isArray(rawResults.incomplete)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawResults.incomplete = rawResults.incomplete.map((v: any) => ({
        ...v,
        nodes: v.nodes.slice(0, 20),
      }))
    }

    const axe = rawResults as StoredAxeResults
    axe.domElementCount = domElementCount

    if (options?.captureScreenshots && options.screenshotDir) {
      await progress(93, 'Capturing element screenshots…')
      await captureViolationScreenshots(page, axe.violations, options.screenshotDir)
      axe.captureScreenshots = axe.violations.some(v => v.screenshotPath != null)
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

    return { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls }
  } finally {
    await releasePage(page)
  }
}
