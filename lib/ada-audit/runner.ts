import path from 'path'
import type { HTTPRequest } from 'puppeteer-core'
import { acquirePage, releasePage } from './browser-pool'
import { captureViolationScreenshots } from './screenshot-helpers'
import { assertSafeHttpUrl } from '../security/safe-url'
import type { StoredAxeResults } from './types'

const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js')

// ─── SSRF protection ──────────────────────────────────────────────────────────

export async function assertNotPrivate(hostname: string) {
  await assertSafeHttpUrl(`https://${hostname}`)
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export type ProgressCallback = (progress: number, message: string) => Promise<void>

export interface RunAxeOptions {
  captureScreenshots?: boolean
  screenshotDir?: string
}

export async function runAxeAudit(
  targetUrl: string,
  wcagLevel: string = 'wcag21aa',
  onProgress?: ProgressCallback,
  options?: RunAxeOptions,
): Promise<StoredAxeResults> {
  const progress = onProgress ?? (async () => {})

  // SSRF check
  await progress(5, 'Verifying URL…')
  const parsed = await assertSafeHttpUrl(targetUrl)

  // Acquire a browser page from the pool
  await progress(10, 'Launching browser…')
  const page = await acquirePage()

  try {
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

    // Navigate to the page — waitUntil: 'networkidle2' ensures stylesheets load
    await progress(20, 'Loading page…')
    let response
    try {
      response = await page.goto(parsed.toString(), {
        waitUntil: 'networkidle2',
        timeout: 30_000,
      })
    } catch (err) {
      if (blockedNavigationError) throw blockedNavigationError
      throw err
    }

    if (!response) throw new Error('No response received from page')
    const status = response.status()
    if (status === 304) {
      throw new Error('HTTP 304 Not Modified — cached response received; re-run to get a fresh scan')
    }
    if (!response.ok()) {
      if (status === 403) {
        throw new Error(`HTTP 403 — This site is blocking automated scanners. Try adding your server IP to the site's allowlist, or contact the site owner.`)
      }
      if (status === 401) {
        throw new Error(`HTTP 401 — This page requires authentication. The scanner cannot access password-protected pages.`)
      }
      throw new Error(`HTTP ${status} — ${response.statusText()}`)
    }

    const contentType = response.headers()['content-type'] ?? ''
    if (!contentType.includes('html')) {
      throw new Error(`Response is not HTML (Content-Type: ${contentType})`)
    }

    // Count DOM elements — low count signals a JS-rendered SPA
    await progress(75, 'Analyzing page…')
    const domElementCount = await page.evaluate(() => document.querySelectorAll('*').length)

    // Inject axe-core and run the audit
    await progress(82, 'Running accessibility checks…')
    await page.addScriptTag({ path: AXE_PATH })

    // WCAG 2.1 AA = all 2.0 A/AA rules + new 2.1 rules.
    // WCAG 2.2 AA adds 2.2 AA on top. Passing only 'wcag21aa' misses all inherited 2.0 rules.
    // "best practices" mode adds best-practice rules + WCAG 2.2 AA on top of 2.1 AA
    const wcagTags = wcagLevel === 'wcag22aa'
      ? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      : ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawResults = await page.evaluate(async (options: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).axe.run(document, options)
    }, {
      runOnly: { type: 'tag', values: wcagTags },
      resultTypes: ['violations', 'incomplete'],
      reporter: 'no-passes',
      iframes: false,
    })

    // Truncate nodes to 20 per violation/incomplete item to keep the DB blob manageable
    await progress(90, 'Processing results…')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawResults.violations = rawResults.violations.map((v: any) => ({
      ...v,
      nodes: v.nodes.slice(0, 20),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (Array.isArray(rawResults.incomplete)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawResults.incomplete = rawResults.incomplete.map((v: any) => ({
        ...v,
        nodes: v.nodes.slice(0, 20),
      }))
    }

    const result = rawResults as StoredAxeResults
    result.domElementCount = domElementCount

    if (options?.captureScreenshots && options.screenshotDir) {
      await progress(95, 'Capturing element screenshots…')
      await captureViolationScreenshots(page, result.violations, options.screenshotDir)
      result.captureScreenshots = result.violations.some(v => v.screenshotPath != null)
    }

    return result

  } finally {
    await releasePage(page)
  }
}
