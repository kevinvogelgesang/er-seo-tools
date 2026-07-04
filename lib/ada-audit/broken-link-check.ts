// lib/ada-audit/broken-link-check.ts
//
// Single-URL broken-link classification + a per-host throttle, for the C6
// out-of-band verifier. HEAD-first; ANY HEAD >= 400 (or HEAD throw) is
// confirmed with GET before declaring broken (servers mishandle HEAD —
// precision posture). SafeUrlError / network error / timeout -> 'unconfirmed'
// (excluded from broken counts; recall is a later concern). Transport is
// injectable for tests.
import { safeFetch } from '@/lib/security/safe-url'
import { resolveUrl, type ResolveDeps } from './url-resolver'

export type CheckResult = 'ok' | 'broken' | 'unconfirmed'

export interface CheckDeps {
  /** Returns the final HTTP status for the URL+method, or throws on network/SSRF error. */
  fetchStatus: (url: string, method: 'HEAD' | 'GET', timeoutMs: number) => Promise<number>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT = Number(process.env.BROKEN_LINK_REQUEST_TIMEOUT_MS) || 10_000

/** Production transport: safeFetch (SSRF-guarded), body drained to avoid socket leaks. */
export const realDeps: CheckDeps = {
  fetchStatus: async (url, method, timeoutMs) => {
    const { response } = await safeFetch(url, { method, signal: AbortSignal.timeout(timeoutMs) })
    try {
      await response.body?.cancel()
    } catch {
      /* ignore */
    }
    return response.status
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

export async function checkUrl(
  url: string,
  deps: CheckDeps = realDeps,
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<CheckResult> {
  const resolveDeps: ResolveDeps = {
    fetchResolved: async (u, method, t) => ({ status: await deps.fetchStatus(u, method, t), finalUrl: u, redirects: [] }),
    now: deps.now,
    sleep: deps.sleep,
  }
  return (await resolveUrl(url, resolveDeps, timeoutMs)).result
}

/** Per-host minimum spacing. Call wait(host) before each request to a host. */
export class HostThrottle {
  private last = new Map<string, number>()
  constructor(
    private delayMs: number,
    private deps: Pick<CheckDeps, 'now' | 'sleep'>,
  ) {}
  async wait(host: string): Promise<void> {
    // First request to a host never waits (fix #9 — don't sleep at t0).
    if (!this.last.has(host)) {
      this.last.set(host, this.deps.now())
      return
    }
    const waitMs = this.last.get(host)! + this.delayMs - this.deps.now()
    if (waitMs > 0) await this.deps.sleep(waitMs)
    this.last.set(host, this.deps.now())
  }
}
