import { promises as dns } from 'dns'
import path from 'path'
import { acquirePage, releasePage } from './browser-pool'
import { captureViolationScreenshots } from './screenshot-helpers'
import type { StoredAxeResults } from './types'

const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js')

// ─── SSRF protection ──────────────────────────────────────────────────────────

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\.0\.0\.0$/,
]

export async function assertNotPrivate(hostname: string) {
  let address: string
  try {
    const result = await dns.lookup(hostname)
    address = result.address
  } catch {
    throw new Error(`Could not resolve hostname: ${hostname}`)
  }
  for (const range of PRIVATE_RANGES) {
    if (range.test(address)) {
      throw new Error(`Requests to private/internal addresses are not allowed`)
    }
  }
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

  // Validate URL scheme
  const parsed = new URL(targetUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed')
  }

  // SSRF check
  await progress(5, 'Verifying URL…')
  await assertNotPrivate(parsed.hostname)

  // Acquire a browser page from the pool
  await progress(10, 'Launching browser…')
  const page = await acquirePage()

  try {
    // Navigate to the page — waitUntil: 'networkidle2' ensures stylesheets load
    await progress(20, 'Loading page…')
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 30_000,
    })

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
