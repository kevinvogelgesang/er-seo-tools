import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { getBrowserEgressLaunchArgs, requireBrowserEgressGuardConfig } from './browser-egress'

/** Thrown by acquirePage when its abort signal fires before a slot is granted.
 *  Callers treat this as "the discovery deadline passed" — no slot is leaked. */
export class AcquireAbortedError extends Error {
  constructor() {
    super('acquirePage aborted before a slot was granted')
    this.name = 'AcquireAbortedError'
  }
}

const CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE ?? '/usr/bin/google-chrome'
const POOL_SIZE = parsePositiveInt(process.env.BROWSER_POOL_SIZE, 2)
const MAX_OLD_SPACE = parsePositiveInt(process.env.CHROME_MAX_OLD_SPACE, 512)

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-translate',
  '--disable-sync',
  `--js-flags=--max-old-space-size=${MAX_OLD_SPACE}`,
  '--disable-http-cache',
  ...getBrowserEgressLaunchArgs(),
]

// ─── Singleton browser ────────────────────────────────────────────────────────

let browser: Browser | null = null
let launching: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  requireBrowserEgressGuardConfig()

  if (browser?.connected) return browser

  if (!launching) {
    launching = puppeteer.launch({
      executablePath: CHROME_EXECUTABLE,
      headless: true,
      args: LAUNCH_ARGS,
      timeout: 30_000,
    }).then(
      (b) => {
        browser = b
        launching = null
        b.on('disconnected', () => { browser = null })
        return b
      },
      (err) => {
        // Clear the cached promise on failure — a poisoned `launching` would
        // make every future acquire reject with this same stale error.
        launching = null
        throw err
      },
    )
  }

  return launching
}

// ─── Concurrency semaphore + recycle gate ────────────────────────────────────
// Limits active pages to POOL_SIZE. Every SITE_AUDIT_BROWSER_RECYCLE_PAGES
// pages served, the pool drains (new acquirers wait), closes Chrome to
// reclaim leaked memory, and resumes on a fresh browser. Replaces the old
// loop-index recycle in the site-audit page loop — and unlike that one, it
// waits for ALL active pages (a concurrent standalone audit's page can no
// longer be killed mid-flight). When the pool goes fully idle, Chrome is
// closed after IDLE_CLOSE_MS (replaces the old between-site-audit
// closeBrowser()).
//
// Waiters use notify-all + re-check-loop semantics: every releasePage and
// closeBrowser notifies, and closeBrowser resets the gate, so no waiter can
// be parked forever behind a stale drain.

const IDLE_CLOSE_MS = 60_000

function recyclePagesThreshold(): number {
  return parsePositiveInt(process.env.SITE_AUDIT_BROWSER_RECYCLE_PAGES, 25)
}

let slots = POOL_SIZE
let pagesServed = 0
let draining = false
const waiters: Array<() => void> = []
let idleTimer: NodeJS.Timeout | null = null

function notifyWaiters(): void {
  const woken = waiters.splice(0)
  for (const w of woken) w()
}

function cancelIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function maybeArmIdleTimer(): void {
  if (slots === POOL_SIZE && waiters.length === 0 && browser) {
    cancelIdleTimer()
    idleTimer = setTimeout(() => {
      idleTimer = null
      void closeBrowser()
    }, IDLE_CLOSE_MS)
    idleTimer.unref?.()
  }
}

export async function acquirePage(opts?: { signal?: AbortSignal }): Promise<Page> {
  const signal = opts?.signal
  if (signal?.aborted) throw new AcquireAbortedError()
  cancelIdleTimer()
  while (draining || slots === 0) {
    let wake!: () => void
    const parked = new Promise<void>((resolve) => { wake = resolve; waiters.push(wake) })
    if (signal) {
      let onAbort!: () => void
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => {
          const i = waiters.indexOf(wake)
          if (i >= 0) waiters.splice(i, 1) // never took a slot — drop our own waiter
          reject(new AcquireAbortedError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        await Promise.race([parked, aborted])
      } catch (err) {
        // Aborted while parked. A concurrent notifyWaiters() may have already
        // resolved `parked` and spliced our waiter — re-notify so that wake
        // credit is not lost to a waiter that is now bailing out.
        notifyWaiters()
        throw err
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    } else {
      await parked
    }
  }
  // Codex fix 3: a waiter can be woken by notify-all AND aborted in the same
  // tick. Re-check the signal AFTER exiting the park loop so a raced abort can
  // never be granted a slot.
  if (signal?.aborted) throw new AcquireAbortedError()
  slots--
  pagesServed++
  // Gate at ACQUIRE time, not just release: if the threshold is reached
  // while slots remain free, a later caller must not slip in ahead of the
  // recycle. This acquirer (the one that hit the threshold) proceeds; the
  // gate holds everyone after it.
  if (pagesServed >= recyclePagesThreshold()) {
    draining = true
  }
  let page: Page
  try {
    const b = await getBrowser()
    page = await b.newPage()
  } catch (err) {
    // Restore the slot or it leaks forever (browser launch / newPage threw).
    slots++
    notifyWaiters()
    maybeArmIdleTimer()
    throw err
  }
  page.setDefaultTimeout(60_000)

  // Defense-in-depth cache hardening. Browser launch already sets
  // --disable-http-cache, but 304 responses still surfaced (2 pages on the
  // 2026-05-21 run). Per-page disabling closes the remaining vectors:
  // service workers, validator-only memory cache, and conditional headers.
  await page.setCacheEnabled(false).catch(() => {})
  await page.setBypassServiceWorker(true).catch(() => {})
  await page.setExtraHTTPHeaders({
    'Cache-Control': 'no-store, no-cache, max-age=0',
    'Pragma': 'no-cache',
  }).catch(() => {})

  return page
}

export async function releasePage(page: Page): Promise<void> {
  await page.close().catch(() => {})
  slots++
  if (pagesServed >= recyclePagesThreshold()) {
    draining = true
  }
  if (draining && slots === POOL_SIZE) {
    // Last active page gone — recycle now.
    await closeBrowser()
  }
  notifyWaiters()
  maybeArmIdleTimer()
}

// A4 observability: synchronous module-state snapshot for /admin/ops + /api/health.
// No await, no lock acquisition — cannot perturb the pool.
export function getPoolState(): {
  poolSize: number
  inUse: number
  free: number
  waiting: number
  draining: boolean
  browserAlive: boolean
  pagesServed: number
} {
  return {
    poolSize: POOL_SIZE,
    inUse: POOL_SIZE - slots,
    free: slots,
    waiting: waiters.length,
    draining,
    // `browser !== null` overstates health during a disconnect edge.
    browserAlive: browser?.connected === true,
    pagesServed,
  }
}

export async function closeBrowser(): Promise<void> {
  cancelIdleTimer()
  // Reset the recycle state on EVERY close (recycle, idle, shutdown, between
  // deploys) so no waiter can be left parked behind a stale drain gate.
  pagesServed = 0
  draining = false
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
  notifyWaiters()
}
