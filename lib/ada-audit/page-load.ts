import type { GoToOptions, HTTPResponse, Page } from 'puppeteer-core'
import { TimeoutError } from 'puppeteer-core'

/**
 * page.goto wrapper that retries once on an HTTP 5xx response.
 *
 * Mirrors the PSI retry semantics (PR #17): retries only on 5xx — never on 4xx
 * (deterministic), never on a thrown error (timeout, DNS, SSRF block, cert).
 * One retry, no backoff. Each attempt gets its own goto timeout.
 *
 * Justification: per-page evidence shows transient 5xx (often 503) recovers on
 * an immediate re-probe with zero false-pass risk — a 5xx-then-200 means the
 * page actually loaded the second time. Deterministic 5xx still surface after
 * the retry as the same HTTP error.
 */
export async function gotoWithRetryOn5xx(
  page: Pick<Page, 'goto'>,
  url: string,
  options: GoToOptions,
  onRetry?: () => Promise<void> | void,
): Promise<HTTPResponse | null> {
  const first = await page.goto(url, options)
  if (first && first.status() >= 500) {
    if (onRetry) await onRetry()
    return page.goto(url, options)
  }
  return first
}

/**
 * Best-effort post-navigation settle. After `domcontentloaded` fires, give the
 * page a short grace period to finish XHR/fetch work — but only the
 * `waitForNetworkIdle` TimeoutError is swallowed. Other failures (frame
 * detach, navigation, target closed) propagate so the runner's transient-
 * retry layer can see and act on them. This is the contract the spec calls
 * out: settle's failure is benign only when it's the configured timeout.
 */
export async function postLoadSettle(
  page: Pick<Page, 'waitForNetworkIdle'>,
  opts: { idleTime?: number; timeout?: number } = {},
): Promise<void> {
  const { idleTime = 500, timeout = 5_000 } = opts
  try {
    await page.waitForNetworkIdle({ idleTime, timeout })
  } catch (err) {
    if (err instanceof TimeoutError) return
    throw err
  }
}
