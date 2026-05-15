// lib/ada-audit/lighthouse-runner.ts
import type { Page } from 'puppeteer-core'
import type { LighthouseSummary, RunLighthouseResult } from './lighthouse-types'
import { extractSummary } from './lighthouse-summary'

const LIGHTHOUSE_ENABLED = (process.env.LIGHTHOUSE_ENABLED ?? 'true') !== 'false'
const LIGHTHOUSE_TIMEOUT_MS = parseInt(process.env.LIGHTHOUSE_TIMEOUT_MS ?? '60000', 10)

export const isLighthouseEnabled = () => LIGHTHOUSE_ENABLED

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lhr = any

// Narrow boundary type for the Lighthouse function — LH 13's exported types
// fight with puppeteer-core's Page type, so we cast at the import boundary.
type LighthouseFn = (
  url: string,
  flags?: unknown,
  config?: unknown,
  page?: Page,
) => Promise<{ lhr: Lhr } | undefined>

/**
 * Run Lighthouse against an existing puppeteer Page. Lighthouse owns the navigation
 * (page.goto is NOT called by us beforehand). After this returns, the page is loaded
 * to `url` but its CDP state (network throttling, CPU throttling, cache) has been
 * mutated — callers must reset before running other tools.
 */
export async function runLighthouse(
  url: string,
  page: Page,
): Promise<RunLighthouseResult> {
  if (!LIGHTHOUSE_ENABLED) return { summary: null }

  let lighthouse: LighthouseFn
  try {
    lighthouse = (await import('lighthouse')).default as unknown as LighthouseFn
  } catch (e) {
    return { summary: null, error: `lighthouse import failed: ${(e as Error).message}` }
  }

  // puppeteer-core uses CDP; lighthouse v11+ accepts a puppeteer-core Page directly
  // via the `page` option in `lighthouse(url, flags, config, page)`. The 4-arg form
  // tells LH to attach to our existing browser instead of launching its own.
  try {
    const result = await Promise.race([
      lighthouse(url, {
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
        formFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: true,
        },
      }, undefined, page),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Lighthouse timed out after ${LIGHTHOUSE_TIMEOUT_MS}ms`)), LIGHTHOUSE_TIMEOUT_MS),
      ),
    ])

    if (!result || !result.lhr) {
      return { summary: null, error: 'Lighthouse returned no report' }
    }

    const summary: LighthouseSummary = extractSummary(result.lhr)
    return { summary }
  } catch (e) {
    return { summary: null, error: (e as Error).message }
  }
}

/**
 * Reset CDP state that Lighthouse mutates so subsequent tools (axe) run under
 * default conditions, not LH's emulated slow network + 4x CPU throttle.
 */
export async function resetCdpAfterLighthouse(page: Page): Promise<void> {
  const client = await page.target().createCDPSession()
  try {
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    })
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await client.send('Network.setCacheDisabled', { cacheDisabled: false })
  } finally {
    await client.detach().catch(() => {})
  }
}
