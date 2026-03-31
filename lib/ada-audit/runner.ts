import { JSDOM } from 'jsdom'
import { readFileSync } from 'fs'
import { promises as dns } from 'dns'
import path from 'path'
import type { StoredAxeResults } from './types'

// Read axe-core's browser IIFE bundle once at module load time.
// We use readFileSync (not import) because axe.js is a browser IIFE that
// accesses `document` on evaluation — importing it would crash Node at startup.
const axeSource = readFileSync(
  path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'),
  'utf-8'
)

// ─── SSRF protection ──────────────────────────────────────────────────────────
// Reject requests that would hit private/loopback addresses to prevent SSRF.

const PRIVATE_RANGES = [
  /^127\./,                           // 127.0.0.0/8 — loopback
  /^10\./,                            // 10.0.0.0/8 — private
  /^172\.(1[6-9]|2\d|3[01])\./,      // 172.16.0.0/12 — private
  /^192\.168\./,                      // 192.168.0.0/16 — private
  /^169\.254\./,                      // 169.254.0.0/16 — link-local
  /^::1$/,                            // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,                // IPv6 ULA fc00::/7
  /^fd[0-9a-f]{2}:/i,                // IPv6 ULA fd00::/7
  /^fe80:/i,                          // IPv6 link-local
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

// ─── Concurrency guard ────────────────────────────────────────────────────────

const MAX_CONCURRENT = 3
let activeAudits = 0

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runAxeAudit(targetUrl: string, wcagLevel: string = 'wcag21aa'): Promise<StoredAxeResults> {
  if (activeAudits >= MAX_CONCURRENT) {
    throw new Error(`Too many audits running (max ${MAX_CONCURRENT}). Try again shortly.`)
  }

  // SSRF check before any network request
  const parsed = new URL(targetUrl)
  await assertNotPrivate(parsed.hostname)

  activeAudits++
  try {
    return await _runAudit(targetUrl, wcagLevel)
  } finally {
    activeAudits--
  }
}

async function _runAudit(targetUrl: string, wcagLevel: string): Promise<StoredAxeResults> {
  // Fetch the page HTML with a 15-second timeout
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'ER-SEO-Tools/1.0 ada-audit',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  // Reject non-HTML content types (PDFs, images, JSON APIs, etc.)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('html')) {
    throw new Error(`Response is not HTML (Content-Type: ${contentType})`)
  }

  // Guard against very large pages — 5MB limit
  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > 5_000_000) {
    throw new Error('Page is too large to audit (>5MB)')
  }
  const html = await response.text()
  if (html.length > 5_000_000) {
    throw new Error('Page is too large to audit (>5MB)')
  }

  // Build JSDOM with runScripts: 'outside-only' so the *page's* scripts don't
  // execute in our Node process, but axe-core (which we inject via eval from
  // outside the document) can still run. This is meaningfully safer than
  // runScripts: 'dangerously' for untrusted third-party HTML.
  //
  // Known limitations:
  //   • External stylesheets are not loaded → color-contrast checks rely on
  //     inline styles and browser defaults only. Results may not reflect
  //     the page's real contrast ratios.
  //   • Client-rendered content (React/Angular SPAs), lazy-loaded sections,
  //     and content behind tabs/modals won't appear in the static HTML snapshot.
  const dom = new JSDOM(html, {
    url: targetUrl,           // axe reads window.location
    runScripts: 'outside-only',
    pretendToBeVisual: true,  // enables getComputedStyle for contrast rules
    resources: 'usable',      // allow loading of subresources the DOM requests
  })

  // Count DOM elements before running axe — low counts indicate a JS-rendered SPA
  const domElementCount = dom.window.document.querySelectorAll('*').length

  // Inject axe-core via eval (executes as "outside" code, not page script)
  dom.window.eval(axeSource)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // WCAG 2.1 AA requires 2.0 A + 2.0 AA + 2.1 A + 2.1 AA rules.
  // WCAG 2.2 AA adds 2.2 AA on top. Passing only 'wcag21aa' misses all inherited 2.0 rules.
  const wcagTags = wcagLevel === 'wcag22aa'
    ? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
    : ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

  const rawResults = await (dom.window as any).axe.run(
    dom.window.document,
    {
      runOnly: { type: 'tag', values: wcagTags },
      resultTypes: ['violations', 'incomplete'],
      reporter: 'no-passes',
      iframes: false,
    }
  )

  // Truncate nodes to 20 per violation/incomplete item to keep the DB blob manageable.
  // Storing the full node list for complex pages can produce multi-MB JSON.
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

  dom.window.close() // free JSDOM memory

  const result = rawResults as StoredAxeResults
  result.domElementCount = domElementCount
  return result
}
