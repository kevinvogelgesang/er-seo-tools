// lib/ada-audit/url-resolver.ts
//
// C6 Phase 4: shared URL resolver. Exposes the final URL + redirect chain +
// final status that safeFetch already computes (checkUrl discards them).
// Preserves checkUrl's EXACT precision posture: HEAD-first; HEAD>=400 or a
// non-SafeUrlError HEAD throw confirms with GET; a SafeUrlError on HEAD
// (SSRF/DNS/'Too many redirects') returns 'unconfirmed' immediately (no GET).
import { safeFetch, SafeUrlError } from '@/lib/security/safe-url'

export interface ResolveResult {
  result: 'ok' | 'broken' | 'unconfirmed'
  finalUrl: string | null
  status: number | null
  hops: number
  chain: string[]
  tooManyRedirects: boolean
}

export interface ResolveDeps {
  /** Final status + final url + redirect chain (safeFetch's redirects[], verbatim). */
  fetchResolved: (url: string, method: 'HEAD' | 'GET', timeoutMs: number) => Promise<{ status: number; finalUrl: string; redirects: string[] }>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT = Number(process.env.BROKEN_LINK_REQUEST_TIMEOUT_MS) || 10_000

export const realResolveDeps: ResolveDeps = {
  fetchResolved: async (url, method, timeoutMs) => {
    const { response, url: finalUrl, redirects } = await safeFetch(url, { method, signal: AbortSignal.timeout(timeoutMs) })
    try { await response.body?.cancel() } catch { /* ignore */ }
    return { status: response.status, finalUrl, redirects }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

const UNCONFIRMED: ResolveResult = { result: 'unconfirmed', finalUrl: null, status: null, hops: 0, chain: [], tooManyRedirects: false }

export async function resolveUrl(url: string, deps: ResolveDeps = realResolveDeps, timeoutMs: number = DEFAULT_TIMEOUT): Promise<ResolveResult> {
  try {
    const head = await deps.fetchResolved(url, 'HEAD', timeoutMs)
    if (head.status < 400) {
      return { result: 'ok', finalUrl: head.finalUrl, status: head.status, hops: head.redirects.length, chain: head.redirects, tooManyRedirects: false }
    }
    // HEAD >= 400: confirm with GET.
  } catch (err) {
    if (err instanceof SafeUrlError) {
      return { ...UNCONFIRMED, tooManyRedirects: err.message === 'Too many redirects' }
    }
    // network/timeout on HEAD: fall through to GET.
  }
  try {
    const get = await deps.fetchResolved(url, 'GET', timeoutMs)
    return {
      result: get.status >= 400 ? 'broken' : 'ok',
      finalUrl: get.finalUrl, status: get.status, hops: get.redirects.length, chain: get.redirects, tooManyRedirects: false,
    }
  } catch (err) {
    return { ...UNCONFIRMED, tooManyRedirects: err instanceof SafeUrlError && err.message === 'Too many redirects' }
  }
}

/** HEAD-only external-link check (C6 external verification). Never issues a GET.
 * broken = 404 | 410 | 5xx; ok = <400; everything else (401/403/405/429, other
 * 4xx, throws) = unconfirmed — the deliberate anti-bot-tolerant posture. */
export async function resolveExternalHead(
  url: string,
  deps: ResolveDeps = realResolveDeps,
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<ResolveResult> {
  try {
    const head = await deps.fetchResolved(url, 'HEAD', timeoutMs)
    const status = head.status
    const broken = status === 404 || status === 410 || (status >= 500 && status <= 599)
    const result: ResolveResult['result'] = status < 400 ? 'ok' : broken ? 'broken' : 'unconfirmed'
    return { result, finalUrl: head.finalUrl, status, hops: head.redirects.length, chain: head.redirects, tooManyRedirects: false }
  } catch (err) {
    return { ...UNCONFIRMED, tooManyRedirects: err instanceof SafeUrlError && err.message === 'Too many redirects' }
  }
}
