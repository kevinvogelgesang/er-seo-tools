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

export async function runPageSpeedInsights(targetUrl: string): Promise<RunLighthouseResult> {
  const timeoutMs = parsePositiveInt(process.env.PAGESPEED_TIMEOUT_MS, 90_000)
  const psiUrl = buildPsiUrl(targetUrl)
  try {
    let response = await fetchPsiWithTimeout(psiUrl, timeoutMs)
    if (!response.ok && response.status >= 500) {
      // Retry once on PSI 5xx — Google-side flake typically resolves on a fresh
      // backend. No backoff; if the issue is global, retrying fast is no worse
      // than retrying slow. We do NOT retry on 4xx (deterministic) or AbortError
      // (don't want to double the wall-clock cost on consistently slow pages).
      response = await fetchPsiWithTimeout(psiUrl, timeoutMs)
    }
    if (!response.ok) {
      return { summary: null, error: mapHttpError(response.status) }
    }
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
