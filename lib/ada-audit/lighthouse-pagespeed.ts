// lib/ada-audit/lighthouse-pagespeed.ts
//
// Google PageSpeed Insights API v5 client. Returns a RunLighthouseResult
// shaped identically to the local-LH runner so the caller doesn't care
// which provider produced it.
//
// PSI's `response.lighthouseResult` is structurally identical to a
// locally-generated LHR, so we pass it through `extractSummary()` unchanged.

import type { RunLighthouseResult } from './lighthouse-types'
import { extractSummary } from './lighthouse-summary'

const PSI_ENDPOINT = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed'

function buildPsiUrl(targetUrl: string): string {
  const params = new URLSearchParams()
  params.set('url', targetUrl)
  params.set('strategy', 'DESKTOP')
  // category is repeated, not comma-separated, per the v5 spec
  params.append('category', 'PERFORMANCE')
  params.append('category', 'ACCESSIBILITY')
  params.append('category', 'BEST_PRACTICES')
  const key = process.env.PAGESPEED_API_KEY
  if (key) params.set('key', key)
  return `${PSI_ENDPOINT}?${params.toString()}`
}

function mapHttpError(status: number): string {
  if (status === 429) return `PSI rate limit exceeded (HTTP 429). Slow down or add an API key.`
  if (status === 400) return `PSI could not fetch the URL (HTTP 400). The page may be private or blocked.`
  if (status === 401) return `PSI request unauthorized (HTTP 401). Check that PAGESPEED_API_KEY is valid.`
  if (status === 403) return `PSI request forbidden (HTTP 403). The API key may be restricted or the referrer blocked.`
  if (status >= 500) return `PSI server error (HTTP ${status}).`
  return `PSI request failed (HTTP ${status}).`
}

async function fetchPsiWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Statuses worth retrying with backoff:
//   429 — rate limit (transient, MUST wait before retry)
//   5xx — Google-side flake or per-origin soft-throttle (bjb.dev observed 500
//         storms during sustained same-origin pressure)
// 4xx other than 429 is deterministic — don't retry. AbortError (timeout)
// caught below is also non-retried (consistently slow page; double-cost not
// worth the rare recovery).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3 // initial + up to 2 retries

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Jittered exponential backoff between PSI retries. Goal isn't perfect
// recovery — it's to avoid converting a temporary Google throttle wave
// into dozens of permanent lighthouseError rows by retrying instantly.
//
// retryIndex=0 (first retry), retryIndex=1 (second retry).
// With default base = 10000ms:
//   retryIndex=0 → 5000–15000 ms
//   retryIndex=1 → 15000–45000 ms
// Tests override PSI_BACKOFF_BASE_MS to a small value for fast test runs.
function jitteredBackoffMs(retryIndex: number): number {
  const base = parsePositiveInt(process.env.PSI_BACKOFF_BASE_MS, 10_000)
  const multiplier = Math.pow(3, retryIndex)
  const jitter = 0.5 + Math.random() // 0.5 .. 1.5
  return Math.floor(base * multiplier * jitter)
}

export async function runPageSpeedInsights(targetUrl: string): Promise<RunLighthouseResult> {
  const timeoutMs = parsePositiveInt(process.env.PAGESPEED_TIMEOUT_MS, 90_000)
  const psiUrl = buildPsiUrl(targetUrl)
  let lastStatus: number | null = null
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(jitteredBackoffMs(attempt - 1))
      }
      const response = await fetchPsiWithTimeout(psiUrl, timeoutMs)
      if (response.ok) {
        let json: unknown
        try {
          json = await response.json()
        } catch {
          return { summary: null, error: 'PSI returned malformed response.' }
        }
        const lhr = (json as { lighthouseResult?: unknown }).lighthouseResult
        if (!lhr) {
          return { summary: null, error: 'PSI returned no lighthouseResult.' }
        }
        // extractSummary already handles its own type-permissive parsing.
        return { summary: extractSummary(lhr) }
      }

      lastStatus = response.status
      // Deterministic 4xx (non-429) — fail immediately.
      if (!RETRYABLE_STATUS.has(response.status)) {
        return { summary: null, error: mapHttpError(response.status) }
      }
      // Retryable: loop continues if attempts remain.
    }

    // All MAX_ATTEMPTS exhausted on retryable statuses.
    return { summary: null, error: mapHttpError(lastStatus ?? 500) }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { summary: null, error: `PSI timed out after ${timeoutMs}ms.` }
    }
    return { summary: null, error: err instanceof Error ? err.message : String(err) }
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
