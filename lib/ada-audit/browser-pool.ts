import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'

const CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE ?? '/usr/bin/google-chrome'
const POOL_SIZE = parseInt(process.env.BROWSER_POOL_SIZE ?? '2', 10)

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
  '--js-flags=--max-old-space-size=256',
  '--disable-http-cache',
]

// ─── Singleton browser ────────────────────────────────────────────────────────

let browser: Browser | null = null
let launching: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser

  if (!launching) {
    launching = puppeteer.launch({
      executablePath: CHROME_EXECUTABLE,
      headless: true,
      args: LAUNCH_ARGS,
      timeout: 30_000,
    }).then((b) => {
      browser = b
      launching = null
      b.on('disconnected', () => { browser = null })
      return b
    })
  }

  return launching
}

// ─── Concurrency semaphore ────────────────────────────────────────────────────
// Limits the number of active pages to POOL_SIZE.
// Callers that exceed the limit wait in a queue.

let slots = POOL_SIZE
const waitQueue: Array<() => void> = []

export async function acquirePage(): Promise<Page> {
  if (slots > 0) {
    slots--
  } else {
    await new Promise<void>((resolve) => waitQueue.push(resolve))
  }
  const b = await getBrowser()
  const page = await b.newPage()
  page.setDefaultTimeout(60_000)
  return page
}

export async function releasePage(page: Page): Promise<void> {
  await page.close().catch(() => {})
  const next = waitQueue.shift()
  if (next) {
    next() // pass slot directly to next waiter
  } else {
    slots++
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
}
