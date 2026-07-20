# Hybrid-discovery L2 — rendered-DOM adaptive discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rendered-DOM (headless-Chrome) adaptive discovery pass to `discoverPages` so JS-rendered-navigation clients (cambria/glow/nuvani/brownson/federico), whose raw-HTTP crawl sees 0 same-host links, reach discovery `residualMissRate ≤ 5%` — without raising `BROWSER_POOL_SIZE` and without regressing the memory/time envelope.

**Architecture:** The existing raw-HTTP hybrid crawl runs unchanged and first (cheap; catches raw-HTML sites). Its normalized-URL output becomes `knownUrls`. A bounded, novelty-based **probe** renders the homepage + 1–2 shallow known hubs via `acquirePage()`; if the count of *admissible rendered URLs novel vs `knownUrls`* ≥ a threshold, a bounded rendered BFS (`hybridCrawl` with a browser fetcher) expands from those seeds — `knownUrls` deduped-not-fetched, rendered candidates through the normal same-domain/robots/trap filters. Raw + rendered results merge by coverage-normalized key with fixed source precedence. ONE absolute discovery deadline covers every phase; a cancellable `acquirePage()` guarantees no waiter leaks a pool slot past it.

**Tech Stack:** TypeScript, puppeteer-core (existing browser pool), Vitest. No schema change (coverage is JSON on `CrawlRun`; discovery provenance columns already exist).

## Global Constraints

- **`BROWSER_POOL_SIZE` stays ≤ 4 — never raised.** Each Chrome page is ~150–200 MB resident; the VPS has two memory-incident scars (build-OOM 2026-06-22, verifier crash-loop 2026-07-16).
- **Never weaken `safeFetch` / the SSRF guard; `lib/seo-fetch` is FROZEN.** All external fetches go through `assertSafeHttpUrl` / `safeFetch`.
- **Discovery runs BEFORE this audit's page jobs fan out** (already true — `site-audit-discover` job runs before fan-out), so the pool is free of THIS audit. Worst case = render-discovery (2) + a concurrent standalone ADA audit (2) = the full 4-slot pool, never exceeding it.
- **Rendered-pass concurrency default `HYBRID_RENDER_CONCURRENCY = 2`** (≤ pool size 4).
- **array-form `$transaction([...])` only** (this plan touches `updateMany`, not transactions — no exception needed).
- **No AI/LLM API.** (Not touched here.)
- **Injected in-page code:** the rendered fetcher's `page.evaluate` uses a plain **string literal** (not a `.toString()`-transpiled module fn), so the SWC-helper/`typeof` contract does not apply — but keep the string a simple arrow with no `typeof`.
- **Gates (the ONLY type-check gate):** `npm run lint` (tsc `--noEmit`), `DATABASE_URL="file:./local-dev.db" npm test` (vitest), `npm run build` (heap-capped — never bare `next build`). All three green before PR.
- **Out of scope for this plan:** L3 (raw-crawl bound raises) is a **separate plan/PR after L2 prod-verify**. The `fallback: 'sf-required'` labeling is a **ledger/parity-log** concern recorded during prod verification, not app code.

---

## File Structure

**New files:**
- `lib/ada-audit/browser-request-guard.ts` — the ONE shared browser request-interception layer: pure `classifyBrowserRequest` (unit-tested) + `installBrowserRequestGuard(page, opts)`. SSRF-checks every request; optionally blocks image/media/font/stylesheet subresources and aborts an off-domain main-frame redirect *before* render.
- `lib/ada-audit/browser-request-guard.test.ts`
- `lib/ada-audit/seo/rendered-crawl.ts` — `fetchPageLinksViaBrowser(url, auditedHost, deadlineMs, deps?)` (renders via cancellable `acquirePage`, deadline-clamped nav/settle, anchor cap) + `buildProbeTargets(host, knownUrls, maxHubs)`.
- `lib/ada-audit/seo/rendered-crawl.test.ts`

**Modified files:**
- `lib/ada-audit/browser-pool.ts` — `acquirePage(opts?: { signal?: AbortSignal })` cancellable acquire + `AcquireAbortedError`; a waiter aborted while parked never leaks a slot.
- `lib/ada-audit/browser-pool.test.ts` — cancellable-acquire cases.
- `lib/ada-audit/sitemap-crawler-browser-fetch.ts` — use `installBrowserRequestGuard(page)` (no opts → byte-identical SSRF-only behavior).
- `lib/ada-audit/sitemap-crawler-browser-fetch.test.ts` — fake `request` objects gain `resourceType()` / `isNavigationRequest()`.
- `lib/ada-audit/seo/hybrid-crawl.ts` — extend `CrawlSource`/`CrawlSeed.source` with `'rendered'`/`'rendered-linked'`; `PRECEDENCE`; extract `admissibleLink`; `hybridCrawl` optional `opts` (`knownKeys`, `linkedSource`, `prioritizeShallowFrontier`); `mergeCrawlResults`.
- `lib/ada-audit/seo/hybrid-crawl.test.ts` — new cases.
- `lib/ada-audit/sitemap-crawler.ts` — rendered-pass wiring in `discoverPagesWithDeps`; new env tunables; `discoverPages` passes the real browser fetcher; single absolute deadline.
- `lib/ada-audit/sitemap-crawler.test.ts` — wire-level rendered-pass cases via injected deps.
- `lib/jobs/handlers/site-audit-discover.ts` — persist `discoverySourcesJson` as `{v:2,...}` when rendered provenance is present (both persist branches).
- `lib/jobs/handlers/site-audit-discover.*.test.ts` (existing discovery-mode test file) — v2-tolerance / rendered-provenance case.
- `docs/` config reference — new `HYBRID_RENDER_*` env vars.

---

## Interfaces (cross-task contract)

Copy these signatures verbatim; later tasks depend on them.

```ts
// browser-request-guard.ts
export type BrowserRequestVerdict = 'block-subresource' | 'block-off-domain-nav' | 'check-ssrf'
export interface BrowserRequestGuardOpts { auditedHost?: string; blockSubresources?: boolean }
export function classifyBrowserRequest(
  req: { url: string; resourceType: string; isNavigationRequest: boolean; isMainFrame: boolean },
  opts: BrowserRequestGuardOpts,
): BrowserRequestVerdict
export function installBrowserRequestGuard(page: Page, opts?: BrowserRequestGuardOpts): Promise<void>

// browser-pool.ts
export class AcquireAbortedError extends Error {}
export function acquirePage(opts?: { signal?: AbortSignal }): Promise<Page>

// seo/rendered-crawl.ts
export interface RenderedFetchDeps {
  acquirePage: (opts?: { signal?: AbortSignal }) => Promise<Page>
  releasePage: (page: Page) => Promise<void>
  now: () => number
}
export function fetchPageLinksViaBrowser(
  url: string, auditedHost: string, deadlineMs: number, deps?: RenderedFetchDeps,
): Promise<FetchedPage | null>
export function buildProbeTargets(host: string, knownUrls: string[], maxHubs: number): string[]

// seo/hybrid-crawl.ts
export type CrawlSource = 'sitemap' | 'seed' | 'shallow' | 'linked' | 'rendered' | 'rendered-linked'
export interface HybridCrawlOpts {
  knownKeys?: Set<string>            // coverage-normalized keys already known (raw pass) — dedup only, never fetched
  linkedSource?: CrawlSource         // source label for BFS-discovered links (default 'linked')
  prioritizeShallowFrontier?: boolean// order each depth's frontier by ascending path-segment count (novel-hub priority)
}
export function admissibleLink(resolved: string, host: string, robots: RobotsRules, maxPathSegments: number): boolean
export function hybridCrawl(
  seeds: CrawlSeed[], auditedHost: string, bounds: CrawlBounds, deps: CrawlDeps, robots: RobotsRules, opts?: HybridCrawlOpts,
): Promise<CrawlResult>
export function mergeCrawlResults(
  raw: CrawlResult, rendered: CrawlResult, hardCap: number,
): { urls: string[]; sources: Record<string, CrawlSource> }

// sitemap-crawler.ts — DiscoverResult.coverage gains:
//   renderProbe: 'skipped' | 'no-delta' | 'triggered' | 'failed'
//   renderedFetches: number
//   renderedAdded: number
//   renderStoppedBy?: string
// DiscoverDeps gains:
//   fetchPageLinksRendered?: (url: string, deadlineMs: number) => Promise<FetchedPage | null>
// DiscoverDeps.resolveSeeds signature widens (Codex fix 1 — one global deadline
// covers seed resolution too, incl. the browser sitemap fallback's pool wait):
//   resolveSeeds: (domain: string, deadlineMs: number) => Promise<{ urls; mode; capped }>
```

---

## Task 1: Shared browser request guard

**Files:**
- Create: `lib/ada-audit/browser-request-guard.ts`
- Create: `lib/ada-audit/browser-request-guard.test.ts`
- Modify: `lib/ada-audit/sitemap-crawler-browser-fetch.ts`
- Modify: `lib/ada-audit/sitemap-crawler-browser-fetch.test.ts`

**Interfaces:**
- Produces: `classifyBrowserRequest`, `installBrowserRequestGuard`, `BrowserRequestGuardOpts`, `BrowserRequestVerdict` (see contract above).
- Consumes: `assertSafeHttpUrl` (`../security/safe-url`), `sameDomain` (`./link-harvest`).

- [ ] **Step 1: Write the failing test for the pure classifier**

```ts
// lib/ada-audit/browser-request-guard.test.ts
import { describe, it, expect } from 'vitest'
import { classifyBrowserRequest } from './browser-request-guard'

const nav = (url: string) => ({ url, resourceType: 'document', isNavigationRequest: true, isMainFrame: true })
const sub = (url: string, resourceType: string) => ({ url, resourceType, isNavigationRequest: false, isMainFrame: false })

describe('classifyBrowserRequest', () => {
  it('SSRF-only when no opts (sitemap fetch behavior)', () => {
    expect(classifyBrowserRequest(sub('https://x.com/a.png', 'image'), {})).toBe('check-ssrf')
    expect(classifyBrowserRequest(nav('https://other.com/'), {})).toBe('check-ssrf')
  })
  it('blocks subresource types only when blockSubresources is set', () => {
    for (const t of ['image', 'media', 'font', 'stylesheet']) {
      expect(classifyBrowserRequest(sub('https://x.com/a', t), { blockSubresources: true })).toBe('block-subresource')
    }
    expect(classifyBrowserRequest(sub('https://x.com/x.js', 'script'), { blockSubresources: true })).toBe('check-ssrf')
    // a main-frame navigation is never a "subresource" even with the flag
    expect(classifyBrowserRequest(nav('https://x.com/'), { blockSubresources: true, auditedHost: 'x.com' })).toBe('check-ssrf')
  })
  it('aborts an off-domain main-frame navigation when auditedHost is set', () => {
    expect(classifyBrowserRequest(nav('https://evil.com/'), { auditedHost: 'x.com' })).toBe('block-off-domain-nav')
    expect(classifyBrowserRequest(nav('https://www.x.com/'), { auditedHost: 'x.com' })).toBe('check-ssrf') // www-insensitive
    expect(classifyBrowserRequest(nav('not a url'), { auditedHost: 'x.com' })).toBe('block-off-domain-nav')
  })
  it('does NOT host-pin a sub-frame or subresource request', () => {
    expect(classifyBrowserRequest(sub('https://evil.com/a.js', 'script'), { auditedHost: 'x.com' })).toBe('check-ssrf')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/browser-request-guard.test.ts`
Expected: FAIL — module not found / `classifyBrowserRequest` is not a function.

- [ ] **Step 3: Implement the guard**

```ts
// lib/ada-audit/browser-request-guard.ts
//
// The ONE browser request-interception layer (Codex F2). Both the sitemap
// browser-fetch and the rendered link crawl install it — the SSRF + subresource
// + off-domain-redirect policy lives here, never re-copied.
import type { HTTPRequest, Page } from 'puppeteer-core'
import { assertSafeHttpUrl } from '../security/safe-url'
import { sameDomain } from './link-harvest'

// Subresources a <a href> harvest / sitemap XML fetch never needs — blocking
// them caps per-render memory + time.
const BLOCKED_SUBRESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet'])

export interface BrowserRequestGuardOpts {
  // When set, an off-domain MAIN-FRAME navigation (redirect) is aborted BEFORE
  // the page renders — rejecting the final URL afterward would already have
  // scanned a third-party page (owner rule). Undefined ⇒ no host pinning.
  auditedHost?: string
  // When true, image/media/font/stylesheet subresource loads are aborted.
  blockSubresources?: boolean
}

export type BrowserRequestVerdict = 'block-subresource' | 'block-off-domain-nav' | 'check-ssrf'

/** Pure fate of a request BEFORE the async SSRF check (unit-tested). */
export function classifyBrowserRequest(
  req: { url: string; resourceType: string; isNavigationRequest: boolean; isMainFrame: boolean },
  opts: BrowserRequestGuardOpts,
): BrowserRequestVerdict {
  if (opts.blockSubresources && !req.isNavigationRequest && BLOCKED_SUBRESOURCE_TYPES.has(req.resourceType)) {
    return 'block-subresource'
  }
  if (opts.auditedHost !== undefined && req.isNavigationRequest && req.isMainFrame) {
    let host: string
    try { host = new URL(req.url).hostname.toLowerCase() } catch { return 'block-off-domain-nav' }
    if (!sameDomain(host, opts.auditedHost.toLowerCase())) return 'block-off-domain-nav'
  }
  return 'check-ssrf'
}

/** Install the guard on a page. No opts ⇒ SSRF-only (sitemap-fetch behavior). */
export async function installBrowserRequestGuard(page: Page, opts: BrowserRequestGuardOpts = {}): Promise<void> {
  await page.setRequestInterception(true)
  page.on('request', (request: HTTPRequest) => {
    void (async () => {
      // Only read frame() when host-pinning is active — the sitemap-fetch
      // caller (no auditedHost) must not depend on frame() being present.
      const isMainFrame = opts.auditedHost !== undefined ? request.frame() === page.mainFrame() : false
      const verdict = classifyBrowserRequest(
        { url: request.url(), resourceType: request.resourceType(), isNavigationRequest: request.isNavigationRequest(), isMainFrame },
        opts,
      )
      if (verdict !== 'check-ssrf') {
        if (!request.isInterceptResolutionHandled()) await request.abort('blockedbyclient').catch(() => {})
        return
      }
      try {
        await assertSafeHttpUrl(request.url())
        if (!request.isInterceptResolutionHandled()) await request.continue()
      } catch {
        if (!request.isInterceptResolutionHandled()) await request.abort('blockedbyclient').catch(() => {})
      }
    })()
  })
}
```

- [ ] **Step 4: Run the classifier test — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/browser-request-guard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor `fetchSitemapViaBrowser` to use the shared installer**

In `lib/ada-audit/sitemap-crawler-browser-fetch.ts`, remove the inline `setRequestInterception` + `page.on('request', …)` block (lines ~28–42) and the now-unused `HTTPRequest` import, and replace with a single call after `setDefaultNavigationTimeout`:

```ts
import { installBrowserRequestGuard } from './browser-request-guard'
// ...
    page.setDefaultNavigationTimeout(FETCH_TIMEOUT)
    await installBrowserRequestGuard(page) // no opts ⇒ SSRF-only, byte-identical to the old inline guard
```

Keep the top-level `await assertSafeHttpUrl(url)` pre-acquire check unchanged.

- [ ] **Step 6: Update the sitemap-fetch test fakes for the new method reads**

The installer reads `request.resourceType()` and `request.isNavigationRequest()`. In `lib/ada-audit/sitemap-crawler-browser-fetch.test.ts`, every fake request object emitted via `_emitRequest` must provide them. Add to each fake request:

```ts
resourceType: () => 'document',
isNavigationRequest: () => true,
```

(These make each fake request classify as `'check-ssrf'` — identical to the old SSRF-only path.)

- [ ] **Step 7: Run the sitemap-fetch test — expect PASS (behavior preserved)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/sitemap-crawler-browser-fetch.test.ts`
Expected: PASS (unchanged assertions — the refactor preserves behavior).

- [ ] **Step 8: Commit**

```bash
git add lib/ada-audit/browser-request-guard.ts lib/ada-audit/browser-request-guard.test.ts \
  lib/ada-audit/sitemap-crawler-browser-fetch.ts lib/ada-audit/sitemap-crawler-browser-fetch.test.ts
git commit -m "feat(discovery): extract shared browser request guard (SSRF + subresource + off-domain-redirect)"
```

---

## Task 2: Cancellable `acquirePage`

**Files:**
- Modify: `lib/ada-audit/browser-pool.ts`
- Modify: `lib/ada-audit/browser-pool.test.ts`

**Interfaces:**
- Produces: `AcquireAbortedError`, `acquirePage(opts?: { signal?: AbortSignal })`.
- Consumes: existing pool internals (`slots`, `waiters`, `notifyWaiters`, `getPoolState`).

- [ ] **Step 1: Write the failing tests**

Append to `lib/ada-audit/browser-pool.test.ts`:

```ts
describe('browser-pool cancellable acquire', () => {
  beforeEach(() => { launchCount = 0; launchMock.mockClear(); vi.useRealTimers() })

  it('an already-aborted signal rejects without taking a slot', async () => {
    const pool = await loadPool({ pool: '2' })
    const ac = new AbortController(); ac.abort()
    await expect(pool.acquirePage({ signal: ac.signal })).rejects.toBeInstanceOf(pool.AcquireAbortedError)
    expect(pool.getPoolState().free).toBe(2) // no slot consumed
  })

  it('aborting a parked waiter frees no slot and does not block later acquirers', async () => {
    const pool = await loadPool({ pool: '1', recycle: '999' })
    const p1 = await pool.acquirePage()               // pool now full (1 slot)
    const ac = new AbortController()
    const parked = pool.acquirePage({ signal: ac.signal })
    const rejected = expect(parked).rejects.toBeInstanceOf(pool.AcquireAbortedError)
    ac.abort()
    await rejected
    await pool.releasePage(p1)                          // frees the slot
    const p2 = await pool.acquirePage()                 // must proceed — no leak from the aborted waiter
    expect(p2).toBeTruthy()
    expect(pool.getPoolState().inUse).toBe(1)
  })

  it('a waiter woken by a release but aborted in the same tick does NOT get a slot (Codex fix 3)', async () => {
    const pool = await loadPool({ pool: '1', recycle: '999' })
    const p1 = await pool.acquirePage()                 // pool full
    const ac = new AbortController()
    const parked = pool.acquirePage({ signal: ac.signal })
    const rejected = expect(parked).rejects.toBeInstanceOf(pool.AcquireAbortedError)
    // Release (wakes the parked waiter) and abort in the same microtask turn.
    void pool.releasePage(p1)
    ac.abort()
    await rejected
    // The aborted waiter must NOT have consumed the freed slot.
    expect(pool.getPoolState().free).toBe(1)
    expect(pool.getPoolState().pagesServed).toBe(1) // only p1 ever served
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/browser-pool.test.ts -t "cancellable acquire"`
Expected: FAIL — `AcquireAbortedError` undefined / `acquirePage` ignores `signal`.

- [ ] **Step 3: Implement the cancellable acquire**

In `lib/ada-audit/browser-pool.ts`, add the error class near the top (after imports) and replace the `acquirePage` signature + park loop:

```ts
export class AcquireAbortedError extends Error {
  constructor() { super('acquirePage aborted before a slot was granted'); this.name = 'AcquireAbortedError' }
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
  // ... rest of the existing body UNCHANGED (recycle gate, getBrowser, newPage,
  // slot-restore-on-throw, cache hardening, return page) ...
}
```

Leave everything from `if (pagesServed >= recyclePagesThreshold()) { draining = true }` onward exactly as it is.

- [ ] **Step 4: Run the cancellable-acquire tests — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/browser-pool.test.ts`
Expected: PASS (existing recycle/idle tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/browser-pool.ts lib/ada-audit/browser-pool.test.ts
git commit -m "feat(discovery): cancellable acquirePage (abort-aware, no slot leak) for the discovery deadline"
```

---

## Task 3: `fetchPageLinksViaBrowser` + probe-target builder

**Files:**
- Create: `lib/ada-audit/seo/rendered-crawl.ts`
- Create: `lib/ada-audit/seo/rendered-crawl.test.ts`

**Interfaces:**
- Consumes: `acquirePage`/`releasePage` (`../browser-pool`), `installBrowserRequestGuard` (`../browser-request-guard`), `postLoadSettle` (`../page-load`), `sameDomain` (`../link-harvest`), `assertSafeHttpUrl` (`../../security/safe-url`), `normalizeCoverageUrl` (`./discovery-coverage`), `parsePositiveInt` (`@/lib/jobs/config`), `FetchedPage` (`./hybrid-crawl`).
- Produces: `fetchPageLinksViaBrowser`, `buildProbeTargets`, `RenderedFetchDeps`.

- [ ] **Step 1: Write the failing tests (fake page + injected pool deps)**

```ts
// lib/ada-audit/seo/rendered-crawl.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../security/safe-url', () => ({ assertSafeHttpUrl: vi.fn() }))
import { fetchPageLinksViaBrowser, buildProbeTargets, type RenderedFetchDeps } from './rendered-crawl'
import { assertSafeHttpUrl } from '../../security/safe-url'

function fakePage(finalUrl: string, hrefs: string[]) {
  return {
    setDefaultNavigationTimeout: vi.fn(),
    setRequestInterception: vi.fn(async () => undefined),
    on: vi.fn(),
    mainFrame: () => ({}),
    goto: vi.fn(async () => ({ ok: () => true })),
    url: () => finalUrl,
    waitForNetworkIdle: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => hrefs),
  }
}
const deps = (page: unknown, over: Partial<RenderedFetchDeps> = {}): RenderedFetchDeps => ({
  acquirePage: vi.fn(async () => page as never),
  releasePage: vi.fn(async () => undefined),
  now: () => 0,
  ...over,
})

describe('fetchPageLinksViaBrowser', () => {
  it('returns rendered links + finalUrl on the happy path', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const page = fakePage('https://x.com/', ['https://x.com/a', 'https://x.com/b'])
    const d = deps(page)
    const r = await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 60_000, d)
    expect(r).toEqual({ links: ['https://x.com/a', 'https://x.com/b'], finalUrl: 'https://x.com/' })
    expect(d.releasePage).toHaveBeenCalledTimes(1)
  })

  it('returns null and acquires no page when the SSRF check fails', async () => {
    vi.mocked(assertSafeHttpUrl).mockRejectedValue(new Error('blocked'))
    const d = deps(fakePage('https://x.com/', []))
    expect(await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 60_000, d)).toBeNull()
    expect(d.acquirePage).not.toHaveBeenCalled()
  })

  it('returns null when the final URL left the audited host (off-domain redirect)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const d = deps(fakePage('https://evil.com/', ['https://evil.com/a']))
    const r = await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 60_000, d)
    expect(r).toBeNull()
    expect(d.releasePage).toHaveBeenCalledTimes(1) // still released
  })

  it('returns null when the deadline already passed (acquires nothing)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    const d = deps(fakePage('https://x.com/', []), { now: () => 100 })
    expect(await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 100, d)).toBeNull()
    expect(d.acquirePage).not.toHaveBeenCalled()
  })

  it('caps returned anchors at HYBRID_RENDER_MAX_ANCHORS_PER_PAGE', async () => {
    process.env.HYBRID_RENDER_MAX_ANCHORS_PER_PAGE = '2'
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined as never)
    // the cap is applied in-page (slice before map); the fake evaluate must honor it
    const page = fakePage('https://x.com/', ['https://x.com/a', 'https://x.com/b'])
    page.evaluate = vi.fn(async (code: string) => {
      const m = /slice\(0, (\d+)\)/.exec(code); const cap = m ? Number(m[1]) : 9999
      return ['https://x.com/a', 'https://x.com/b', 'https://x.com/c'].slice(0, cap)
    }) as never
    const r = await fetchPageLinksViaBrowser('https://x.com/', 'x.com', 60_000, deps(page))
    expect(r?.links).toHaveLength(2)
    delete process.env.HYBRID_RENDER_MAX_ANCHORS_PER_PAGE
  })
})

describe('buildProbeTargets', () => {
  it('is homepage + up to maxHubs shallowest known hubs, deduped', () => {
    const known = ['https://x.com/', 'https://x.com/deep/a/b', 'https://x.com/hub', 'https://x.com/hub2']
    expect(buildProbeTargets('x.com', known, 2)).toEqual(['https://x.com/', 'https://x.com/hub', 'https://x.com/hub2'])
  })
  it('is just the homepage when no other known hubs exist', () => {
    expect(buildProbeTargets('x.com', ['https://x.com/'], 2)).toEqual(['https://x.com/'])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/rendered-crawl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `rendered-crawl.ts`**

```ts
// lib/ada-audit/seo/rendered-crawl.ts
//
// L2 rendered-DOM discovery: fetch a page's <a href> graph via headless Chrome
// so JS-rendered navigation (invisible to raw-HTTP) is followed. Same
// FetchedPage shape as the raw fetcher so it plugs into hybridCrawl. Memory:
// subresources blocked + anchors capped per render; deadline-clamped nav/settle;
// cancellable acquire so a waiter never leaks a pool slot past the deadline.
import type { Page } from 'puppeteer-core'
import { acquirePage as realAcquirePage, releasePage as realReleasePage } from '../browser-pool'
import { installBrowserRequestGuard } from '../browser-request-guard'
import { postLoadSettle } from '../page-load'
import { sameDomain } from '../link-harvest'
import { assertSafeHttpUrl } from '../../security/safe-url'
import { normalizeCoverageUrl } from './discovery-coverage'
import { parsePositiveInt } from '@/lib/jobs/config'
import type { FetchedPage } from './hybrid-crawl'

const NAV_TIMEOUT_MS = 20_000
const SETTLE_TIMEOUT_MS = 3_000
const RENDER_MAX_ANCHORS = () => parsePositiveInt(process.env.HYBRID_RENDER_MAX_ANCHORS_PER_PAGE, 1500)

export interface RenderedFetchDeps {
  acquirePage: (opts?: { signal?: AbortSignal }) => Promise<Page>
  releasePage: (page: Page) => Promise<void>
  now: () => number
}
const REAL_DEPS: RenderedFetchDeps = { acquirePage: realAcquirePage, releasePage: realReleasePage, now: () => Date.now() }

/** Render `url` and return its same-host <a href> graph + post-redirect final
 *  URL, or null on SSRF block / nav failure / off-host redirect / deadline. */
export async function fetchPageLinksViaBrowser(
  url: string, auditedHost: string, deadlineMs: number, deps: RenderedFetchDeps = REAL_DEPS,
): Promise<FetchedPage | null> {
  if (deps.now() >= deadlineMs) return null // Codex fix 2: bail before the SSRF precheck too
  try { await assertSafeHttpUrl(url) } catch { return null } // check-then-fetch, fast-fail pre-acquire
  if (deps.now() >= deadlineMs) return null

  // The abort timer bounds how long we WAIT for a page; the real nav budget is
  // recomputed AFTER acquire (Codex fix 2) — acquirePage can block arbitrarily
  // long behind other audits, so a pre-acquire navTimeout would be stale.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineMs - deps.now()))
  ;(timer as unknown as { unref?: () => void }).unref?.()

  let page: Page | undefined
  try {
    page = await deps.acquirePage({ signal: controller.signal })
  } catch {
    clearTimeout(timer)
    return null // AcquireAbortedError (deadline) or launch failure — no slot leaked
  }
  try {
    const navTimeout = Math.min(NAV_TIMEOUT_MS, Math.max(0, deadlineMs - deps.now()))
    if (navTimeout <= 0) return null // deadline passed while acquiring — don't start work
    page.setDefaultNavigationTimeout(navTimeout)
    await installBrowserRequestGuard(page, { auditedHost, blockSubresources: true })
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout })
    if (!response || !response.ok()) return null
    const finalUrl = page.url()
    let finalHost: string
    try { finalHost = new URL(finalUrl).hostname.toLowerCase() } catch { return null }
    if (!sameDomain(finalHost, auditedHost.toLowerCase())) return null
    const settleTimeout = Math.min(SETTLE_TIMEOUT_MS, Math.max(0, deadlineMs - deps.now()))
    if (settleTimeout > 0) await postLoadSettle(page, { timeout: settleTimeout })
    const cap = RENDER_MAX_ANCHORS()
    const hrefs = (await page.evaluate(
      `(() => Array.from(document.querySelectorAll('a[href]')).slice(0, ${cap}).map(a => a.href))()`,
    )) as unknown
    return { links: Array.isArray(hrefs) ? (hrefs as string[]) : [], finalUrl }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    if (page) await deps.releasePage(page).catch(() => {})
  }
}

function segCount(url: string): number {
  try { return new URL(url).pathname.split('/').filter(Boolean).length } catch { return Number.MAX_SAFE_INTEGER }
}

/** The bounded probe set: homepage + up to `maxHubs` shallowest known hubs
 *  (real, already-discovered URLs — no 404 guesses). Deduped by coverage key. */
export function buildProbeTargets(host: string, knownUrls: string[], maxHubs: number): string[] {
  const home = `https://${host}/`
  const seen = new Set<string>([normalizeCoverageUrl(home)])
  const targets = [home]
  const hubs = [...knownUrls].sort((a, b) => (segCount(a) - segCount(b)) || (a < b ? -1 : a > b ? 1 : 0))
  for (const h of hubs) {
    if (targets.length >= 1 + maxHubs) break
    const k = normalizeCoverageUrl(h)
    if (seen.has(k)) continue
    seen.add(k)
    targets.push(h)
  }
  return targets
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/rendered-crawl.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/rendered-crawl.ts lib/ada-audit/seo/rendered-crawl.test.ts
git commit -m "feat(discovery): fetchPageLinksViaBrowser + bounded probe-target builder"
```

---

## Task 4: `hybridCrawl` core changes — knownUrls, novel-hub priority, rendered sources, `admissibleLink`

**Files:**
- Modify: `lib/ada-audit/seo/hybrid-crawl.ts`
- Modify: `lib/ada-audit/seo/hybrid-crawl.test.ts`

**Interfaces:**
- Produces: extended `CrawlSource`/`CrawlSeed.source`, `HybridCrawlOpts`, `admissibleLink`, `hybridCrawl(..., opts?)`.
- Consumes: unchanged (`normalizeLinkTarget`, `sameDomain`, `normalizeCoverageUrl`, `NON_PAGE_EXT`, `isAllowed`).

- [ ] **Step 1: Write the failing tests**

Append to `lib/ada-audit/seo/hybrid-crawl.test.ts`:

```ts
import { hybridCrawl as hc2, admissibleLink } from './hybrid-crawl'

describe('hybridCrawl L2 opts', () => {
  const graph2 = (g: Record<string, string[]>) => {
    let clock = 0
    return { now: () => (clock += 10), async fetchPageLinks(u: string) { return u in g ? { links: g[u], finalUrl: u } : null } }
  }
  it('knownKeys are deduped-not-fetched: a discovered link already in knownKeys is not added', async () => {
    const deps = graph2({ 'https://x.com/': ['https://x.com/a', 'https://x.com/known'], 'https://x.com/a': [] })
    const known = new Set(['https://x.com/known'])
    const r = await hc2([{ url: 'https://x.com/', source: 'rendered' }], 'x.com', B(), deps, { disallow: [], allow: [] }, { knownKeys: known, linkedSource: 'rendered-linked' })
    expect(r.urls).toContain('https://x.com/a')
    expect(r.urls).not.toContain('https://x.com/known') // already known ⇒ skipped
    expect(r.sources['https://x.com/a']).toBe('rendered-linked')
  })
  it('a Disallow-ed rendered link is dropped (candidates go through robots)', async () => {
    const deps = graph2({ 'https://x.com/': ['https://x.com/ok', 'https://x.com/admin/x'], 'https://x.com/ok': [] })
    const r = await hc2([{ url: 'https://x.com/', source: 'rendered' }], 'x.com', B(), deps, { disallow: ['/admin/'], allow: [] }, { linkedSource: 'rendered-linked' })
    expect(r.urls).toContain('https://x.com/ok')
    expect(r.urls).not.toContain('https://x.com/admin/x')
  })
  it('prioritizeShallowFrontier fetches shallower novel hubs first under a fetch cap', async () => {
    // home links a deep page and a shallow hub; with maxFetches:2 (seed + 1),
    // the shallow hub must be the one fetched.
    const deps = graph2({
      'https://x.com/': ['https://x.com/deep/a/b', 'https://x.com/hub'],
      'https://x.com/hub': ['https://x.com/hubchild'], 'https://x.com/deep/a/b': ['https://x.com/deepchild'],
    })
    const r = await hc2([{ url: 'https://x.com/', source: 'rendered' }], 'x.com', B({ maxFetches: 2, concurrency: 1 }), deps, { disallow: [], allow: [] }, { linkedSource: 'rendered-linked', prioritizeShallowFrontier: true })
    expect(r.urls).toContain('https://x.com/hubchild')     // /hub was fetched (shallower)
    expect(r.urls).not.toContain('https://x.com/deepchild')// /deep/a/b was not
  })
})

describe('admissibleLink', () => {
  const robots = { disallow: ['/admin/'], allow: [] }
  it('accepts a same-host content page', () => {
    expect(admissibleLink('https://x.com/programs', 'x.com', robots, 12)).toBe(true)
  })
  it('rejects off-host, non-page, over-segment, and Disallow-ed', () => {
    expect(admissibleLink('https://evil.com/a', 'x.com', robots, 12)).toBe(false)
    expect(admissibleLink('https://x.com/a.pdf', 'x.com', robots, 12)).toBe(false)
    expect(admissibleLink('https://x.com/a/b/c/d', 'x.com', robots, 3)).toBe(false)
    expect(admissibleLink('https://x.com/admin/secret', 'x.com', robots, 12)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/hybrid-crawl.test.ts -t "L2 opts"`
Expected: FAIL — `admissibleLink` undefined / `hybridCrawl` rejects the extra opts arg / wrong source labels.

- [ ] **Step 3: Extend types + precedence + extract `admissibleLink`**

In `lib/ada-audit/seo/hybrid-crawl.ts`:

```ts
export type CrawlSource = 'sitemap' | 'seed' | 'shallow' | 'linked' | 'rendered' | 'rendered-linked'
// ...
export interface CrawlSeed { url: string; source: 'sitemap' | 'seed' | 'shallow' | 'rendered' }

const PRECEDENCE: Record<CrawlSource, number> = {
  sitemap: 5, seed: 4, shallow: 3, rendered: 2, linked: 1, 'rendered-linked': 0,
}

export interface HybridCrawlOpts {
  knownKeys?: Set<string>
  linkedSource?: CrawlSource
  prioritizeShallowFrontier?: boolean
}

/** The BFS link-admission filter, shared with the L2 probe so probe admission
 *  == crawl admission (Codex F3). `resolved` is the real (fetchable) URL. */
export function admissibleLink(resolved: string, host: string, robots: RobotsRules, maxPathSegments: number): boolean {
  const key = normalizeCoverageUrl(resolved)
  let h: string
  try { h = new URL(key).hostname.toLowerCase() } catch { return false }
  if (!sameDomain(h, host)) return false
  if (isNonPage(key)) return false
  if (segmentCount(key) > maxPathSegments) return false
  let pn: string
  try { pn = new URL(resolved).pathname } catch { return false } // robots matches the REAL path
  return isAllowed(pn, robots)
}
```

- [ ] **Step 4: Thread `opts` through `hybridCrawl`**

Change the signature and body. Add `opts: HybridCrawlOpts = {}` as the 6th param. Pre-normalize known keys; make `accept`'s "added" counter count the linked source too; sort the frontier when prioritizing; use `admissibleLink` + `knownKeys` in the link loop; use `opts.linkedSource` for discovered links.

```ts
export async function hybridCrawl(
  seeds: CrawlSeed[], auditedHost: string, bounds: CrawlBounds, deps: CrawlDeps, robots: RobotsRules,
  opts: HybridCrawlOpts = {},
): Promise<CrawlResult> {
  const linkedSource: CrawlSource = opts.linkedSource ?? 'linked'
  const known = opts.knownKeys
  // ... existing setup unchanged ...

  const accept = (key: string, fetchUrl: string, source: CrawlSource, depth: number): boolean => {
    const existing = sources[key]
    if (existing !== undefined) {
      if (PRECEDENCE[source] > PRECEDENCE[existing]) sources[key] = source
      return false
    }
    sources[key] = source
    order.push(key); fetchUrlOf.set(key, fetchUrl); depthOf.set(key, depth)
    if (source === 'linked' || source === 'rendered-linked') addedByCrawl++
    else sitemapCount++
    return true
  }

  // ... seed loop unchanged (seeds still bypass robots/traps) ...

  let depth = 0
  outer: while (depth < bounds.maxDepth) {
    let frontier = order.filter((u) => depthOf.get(u) === depth)
    if (frontier.length === 0) break
    if (opts.prioritizeShallowFrontier) {
      const idx = new Map(order.map((u, i) => [u, i] as const))
      frontier = [...frontier].sort((a, b) => (segmentCount(a) - segmentCount(b)) || (idx.get(a)! - idx.get(b)!))
    }
    for (let i = 0; i < frontier.length; i += bounds.concurrency) {
      // ... time/fetch caps + wave slice UNCHANGED ...
      for (const page of pages) {
        if (!page) continue
        // ... off-host finalUrl guard UNCHANGED ...
        for (const raw of page.links) {
          const resolved = normalizeLinkTarget(raw, page.finalUrl)
          if (!resolved) continue
          const key = normalizeCoverageUrl(resolved)
          if (known?.has(key)) continue                 // dedup-not-fetched (raw already has it)
          if (!admissibleLink(resolved, host, robots, bounds.maxPathSegments)) continue
          const pk = pathKey(key)
          const seenVariants = queryVariants.get(pk) ?? 0
          if (seenVariants >= bounds.maxQueryVariantsPerPath) continue
          if (sources[key] !== undefined) continue
          if (addedByCrawl >= bounds.maxAdded) { stoppedBy = 'maxAdded'; break outer }
          if (order.length >= bounds.hardCap) { stoppedBy = 'hardCap'; break outer }
          queryVariants.set(pk, seenVariants + 1)
          accept(key, resolved, linkedSource, depth + 1)
        }
      }
    }
    depth++
  }
  // ... depth-ceiling stoppedBy + urls slice + return UNCHANGED ...
}
```

Note: the inline `isNonPage`/`segmentCount`/`isAllowed` checks in the link loop are now consolidated into `admissibleLink` — delete the old inline duplicates so there is one filter home.

- [ ] **Step 5: Run all hybrid-crawl tests — expect PASS (old + new)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/hybrid-crawl.test.ts`
Expected: PASS — existing raw-pass tests unchanged (no opts ⇒ `linkedSource='linked'`, identical behavior) + new L2 cases.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/seo/hybrid-crawl.ts lib/ada-audit/seo/hybrid-crawl.test.ts
git commit -m "feat(discovery): hybridCrawl knownUrls dedup + novel-hub priority + rendered source labels + admissibleLink"
```

---

## Task 5: `mergeCrawlResults` pure function

**Files:**
- Modify: `lib/ada-audit/seo/hybrid-crawl.ts`
- Modify: `lib/ada-audit/seo/hybrid-crawl.test.ts`

**Interfaces:**
- Produces: `mergeCrawlResults(raw, rendered, hardCap)`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ada-audit/seo/hybrid-crawl.test.ts`:

```ts
import { mergeCrawlResults, type CrawlResult } from './hybrid-crawl'

const R = (urls: string[], sources: Record<string, string>): CrawlResult => ({
  urls, sources: sources as never, sitemapCount: 0, addedByCrawl: 0, fetches: 0, stoppedBy: 'exhausted',
})

describe('mergeCrawlResults', () => {
  it('unions novel rendered URLs after raw, preserving raw order', () => {
    const raw = R(['https://x.com/a'], { 'https://x.com/a': 'sitemap' })
    const rendered = R(['https://x.com/b'], { 'https://x.com/b': 'rendered-linked' })
    const m = mergeCrawlResults(raw, rendered, 1000)
    expect(m.urls).toEqual(['https://x.com/a', 'https://x.com/b'])
    expect(m.sources['https://x.com/b']).toBe('rendered-linked')
  })
  it('dedups by coverage key and keeps the raw fetch URL + higher-precedence label', () => {
    const raw = R(['https://x.com/a'], { 'https://x.com/a': 'linked' })
    const rendered = R(['https://x.com/a/'], { 'https://x.com/a': 'rendered' }) // same coverage key
    const m = mergeCrawlResults(raw, rendered, 1000)
    expect(m.urls).toEqual(['https://x.com/a'])       // raw fetch URL kept
    expect(m.sources['https://x.com/a']).toBe('rendered') // rendered(2) > linked(1) ⇒ upgraded label
  })
  it('slices the merged set to hardCap and prunes orphaned sources', () => {
    const raw = R(['https://x.com/a', 'https://x.com/b'], { 'https://x.com/a': 'sitemap', 'https://x.com/b': 'sitemap' })
    const rendered = R(['https://x.com/c'], { 'https://x.com/c': 'rendered-linked' })
    const m = mergeCrawlResults(raw, rendered, 2)
    expect(m.urls).toEqual(['https://x.com/a', 'https://x.com/b'])
    expect(m.sources['https://x.com/c']).toBeUndefined() // pruned — not in the sliced set
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/hybrid-crawl.test.ts -t "mergeCrawlResults"`
Expected: FAIL — `mergeCrawlResults` undefined.

- [ ] **Step 3: Implement `mergeCrawlResults`**

Add to `lib/ada-audit/seo/hybrid-crawl.ts`:

```ts
/** Union raw + rendered discovery by coverage-normalized key. Raw runs first and
 *  keeps its fetch URL on a key collision; the source LABEL upgrades to the
 *  higher-precedence value. Sliced to hardCap by the same normalized-key op used
 *  for discoveredUrls, so `sources` and `urls` stay 1:1 (Codex F2/F5). */
export function mergeCrawlResults(
  raw: CrawlResult, rendered: CrawlResult, hardCap: number,
): { urls: string[]; sources: Record<string, CrawlSource> } {
  const sources: Record<string, CrawlSource> = { ...raw.sources }
  const fetchUrlByKey = new Map<string, string>()
  const order: string[] = []
  for (const u of raw.urls) {
    const k = normalizeCoverageUrl(u)
    if (!fetchUrlByKey.has(k)) { fetchUrlByKey.set(k, u); order.push(k) }
  }
  for (const u of rendered.urls) {
    const key = normalizeCoverageUrl(u)
    const cand = rendered.sources[key] ?? 'rendered-linked'
    if (!fetchUrlByKey.has(key)) {
      sources[key] = cand; fetchUrlByKey.set(key, u); order.push(key)
    } else if (PRECEDENCE[cand] > PRECEDENCE[sources[key]]) {
      sources[key] = cand // upgrade label only; keep raw's fetch URL
    }
  }
  const slicedKeys = order.slice(0, hardCap)
  const keep = new Set(slicedKeys)
  for (const k of Object.keys(sources)) if (!keep.has(k)) delete sources[k]
  return { urls: slicedKeys.map((k) => fetchUrlByKey.get(k)!), sources }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/hybrid-crawl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/hybrid-crawl.ts lib/ada-audit/seo/hybrid-crawl.test.ts
git commit -m "feat(discovery): mergeCrawlResults — precedence union + hardCap slice for raw+rendered"
```

---

## Task 6: Wire the rendered pass into `discoverPagesWithDeps`

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts`
- Modify: `lib/ada-audit/sitemap-crawler.test.ts`

**Interfaces:**
- Consumes: `hybridCrawl`, `mergeCrawlResults`, `admissibleLink`, `CrawlResult`, `CrawlSource` (`./seo/hybrid-crawl`); `buildProbeTargets` (`./seo/rendered-crawl`); `normalizeCoverageUrl` + `normalizeLinkTarget`.
- Produces: extended `DiscoverDeps` (`fetchPageLinksRendered?`) + `DiscoverResult.coverage` (`renderProbe`, `renderedFetches`, `renderedAdded`, `renderStoppedBy`).

- [ ] **Step 1: Write the failing tests (wire-level, injected deps)**

Append to `lib/ada-audit/sitemap-crawler.test.ts`:

```ts
describe('discoverPages rendered pass (L2)', () => {
  // raw pass finds only the homepage (JS-blind: no raw links); the rendered
  // pass surfaces novel program pages.
  const rawGraph: Record<string, { links: string[]; finalUrl: string } | null> = {
    'https://x.com/': { links: [], finalUrl: 'https://x.com/' },
  }
  const renderedGraph: Record<string, { links: string[]; finalUrl: string }> = {
    'https://x.com/': { links: ['https://x.com/education', 'https://x.com/healthcare'], finalUrl: 'https://x.com/' },
    'https://x.com/education': { links: [], finalUrl: 'https://x.com/education' },
    'https://x.com/healthcare': { links: [], finalUrl: 'https://x.com/healthcare' },
  }

  it('triggers on ≥ N novel admissible rendered URLs and merges them in', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '2'
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      fetchPageLinksRendered: async (u) => renderedGraph[u] ?? null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('triggered')
    expect(r.urls).toEqual(expect.arrayContaining(['https://x.com/education', 'https://x.com/healthcare']))
    expect(r.coverage?.renderedAdded).toBeGreaterThanOrEqual(2)
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('records no-delta (and does not merge) when the probe finds too few novel URLs', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '5'
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      fetchPageLinksRendered: async (u) => renderedGraph[u] ?? null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('no-delta')
    expect(r.urls).not.toContain('https://x.com/education')
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('records probe failure distinctly from no-delta when every probe render fails', async () => {
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      fetchPageLinksRendered: async () => null, // WAF/consent block
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('failed')
  })

  it('drops a Disallow-ed rendered candidate (candidates go through robots)', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '1'
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      fetchPageLinksRendered: async (u) => (u === 'https://x.com/'
        ? { links: ['https://x.com/ok', 'https://x.com/admin/x'], finalUrl: 'https://x.com/' }
        : { links: [], finalUrl: u }),
      now: () => 0, robots: { disallow: ['/admin/'], allow: [] },
    })
    expect(r.urls).toContain('https://x.com/ok')
    expect(r.urls).not.toContain('https://x.com/admin/x')
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('skips the rendered pass and records hardCapPrefull when raw already fills HARD_CAP', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => `https://x.com/p${i}`)
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: full, mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => null,
      fetchPageLinksRendered: async () => { throw new Error('rendered pass must not run when hardCap-prefull') },
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderStoppedBy).toBe('hardCapPrefull')
  })

  it('rendered pass is inert when no renderer dep is provided (regression: existing raw-only hybrid)', async () => {
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => rawGraph[u] ?? null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('skipped')
  })

  it('triggers via a shallow-hub probe when the homepage is SSR-empty (SSR-home/CSR-deep, Codex fix 5)', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '2'
    const raw: Record<string, { links: string[]; finalUrl: string } | null> = {
      'https://x.com/': { links: [], finalUrl: 'https://x.com/' },
      'https://x.com/programs': { links: [], finalUrl: 'https://x.com/programs' },
    }
    const rendered: Record<string, { links: string[]; finalUrl: string }> = {
      'https://x.com/': { links: [], finalUrl: 'https://x.com/' }, // SSR home: no nav in the DOM
      'https://x.com/programs': { links: ['https://x.com/nursing', 'https://x.com/welding'], finalUrl: 'https://x.com/programs' },
      'https://x.com/nursing': { links: [], finalUrl: 'https://x.com/nursing' },
      'https://x.com/welding': { links: [], finalUrl: 'https://x.com/welding' },
    }
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/', 'https://x.com/programs'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async (u) => raw[u] ?? null,
      fetchPageLinksRendered: async (u) => rendered[u] ?? null,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('triggered')
    expect(r.urls).toEqual(expect.arrayContaining(['https://x.com/nursing', 'https://x.com/welding']))
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('never passes the full raw known set to the rendered fetcher — only home + ≤maxHubs (Codex fix 5 spy)', async () => {
    process.env.HYBRID_RENDER_PROBE_MAX_HUBS = '1'
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '99' // force no-delta so only probe renders happen
    const known = ['https://x.com/', ...Array.from({ length: 20 }, (_, i) => `https://x.com/p${i}`)]
    const rendered = vi.fn(async (u: string) => ({ links: [], finalUrl: u }))
    await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: known, mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => ({ links: [], finalUrl: 'https://x.com/' }),
      fetchPageLinksRendered: rendered,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(rendered.mock.calls.length).toBeLessThanOrEqual(2) // home + 1 hub — NEVER all 21 known URLs
    delete process.env.HYBRID_RENDER_PROBE_MAX_HUBS
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })

  it('does no probe/render work when the deadline is already spent at seed resolution (Codex fix 1)', async () => {
    const rendered = vi.fn(async () => null)
    await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 0 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => null,
      fetchPageLinksRendered: rendered,
      now: () => 1000, robots: { disallow: [], allow: [] }, // deadline = 1000 + 0; now() already == deadline
    })
    expect(rendered).not.toHaveBeenCalled() // RENDER_FLOOR_MS gate: no render past the deadline
  })

  it('renderedFetches counts ACTUAL renders — the probed homepage reused as a BFS seed is not double-counted (Codex fix 4)', async () => {
    process.env.HYBRID_RENDER_PROBE_MIN_NOVEL = '1'
    const rendered = vi.fn(async (u: string) => (u === 'https://x.com/'
      ? { links: ['https://x.com/a'], finalUrl: 'https://x.com/' }
      : { links: [], finalUrl: u }))
    const r = await discoverPagesWithDeps('x.com', { hybrid: true, timeBudgetMs: 60_000 }, {
      resolveSeeds: async () => ({ urls: ['https://x.com/'], mode: 'sitemap', capped: false }),
      fetchPageLinks: async () => ({ links: [], finalUrl: 'https://x.com/' }),
      fetchPageLinksRendered: rendered,
      now: () => 0, robots: { disallow: [], allow: [] },
    })
    expect(r.coverage?.renderProbe).toBe('triggered')
    // probe home (1) + BFS render of /a (1). Home is memoized, NOT re-rendered as a seed.
    expect(rendered.mock.calls.length).toBe(2)
    expect(r.coverage?.renderedFetches).toBe(2)
    delete process.env.HYBRID_RENDER_PROBE_MIN_NOVEL
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/sitemap-crawler.test.ts -t "rendered pass"`
Expected: FAIL — `coverage.renderProbe` undefined; no rendered merge.

- [ ] **Step 3: Add env tunables + the single absolute deadline + rendered-pass block**

In `lib/ada-audit/sitemap-crawler.ts`, add env readers near the other `HY_*`:

```ts
const RENDER_MAX_DEPTH = () => parsePositiveInt(process.env.HYBRID_RENDER_MAX_DEPTH, 2)
const RENDER_MAX_ADDED = () => parsePositiveInt(process.env.HYBRID_RENDER_MAX_ADDED, 300)
const RENDER_MAX_FETCHES = () => parsePositiveInt(process.env.HYBRID_RENDER_MAX_FETCHES, 40)
const RENDER_CONCURRENCY = () => parsePositiveInt(process.env.HYBRID_RENDER_CONCURRENCY, 2)
const RENDER_PROBE_MIN_NOVEL = () => parsePositiveInt(process.env.HYBRID_RENDER_PROBE_MIN_NOVEL, 5)
const RENDER_PROBE_MAX_HUBS = () => parsePositiveInt(process.env.HYBRID_RENDER_PROBE_MAX_HUBS, 2)
const RENDER_FLOOR_MS = 15_000 // below this remaining budget, skip the rendered pass
```

Add imports:

```ts
import { hybridCrawl, mergeCrawlResults, admissibleLink, type CrawlBounds, type CrawlResult, type CrawlSource, type CrawlSeed, type FetchedPage } from './seo/hybrid-crawl'
import { normalizeCoverageUrl } from './seo/discovery-coverage'
import { normalizeLinkTarget } from './link-harvest'
import { buildProbeTargets } from './seo/rendered-crawl'
```

Extend `DiscoverDeps` and the `DiscoverResult.coverage` type:

```ts
interface DiscoverDeps {
  resolveSeeds: (domain: string, deadlineMs: number) => Promise<{ urls: string[]; mode: 'sitemap' | 'shallow-crawl'; capped: boolean }>
  fetchPageLinks: (url: string) => Promise<FetchedPage | null>
  fetchPageLinksRendered?: (url: string, deadlineMs: number) => Promise<FetchedPage | null>
  now: () => number
  robots?: RobotsRules
}

export interface DiscoverResult {
  urls: string[]
  mode: 'sitemap' | 'shallow-crawl' | 'hybrid'
  capped: boolean
  coverage?: {
    sources: Record<string, CrawlSource>; sitemapCount: number; sitemapCapped: boolean; stoppedBy: string; fetches: number
    renderProbe: 'skipped' | 'no-delta' | 'triggered' | 'failed'
    renderedFetches: number; renderedAdded: number; renderStoppedBy?: string
  }
}
```

**Codex fix 1 — ONE global deadline computed BEFORE seed resolution.** Make the
FIRST statement of `discoverPagesWithDeps` (before the `if (opts.seeds) … else
{ resolveSeeds }` block) the deadline, use the job budget as the *overall*
deadline, and keep `HY_TIME_BUDGET()` as the raw-pass *sub-budget*. Thread the
deadline into `resolveSeeds` so its browser-sitemap fallback can't wait past it:

```ts
  // FIRST line of discoverPagesWithDeps — one deadline covers seed resolution +
  // raw crawl + probe + rendered crawl (Codex fix 1). Job budget = the overall
  // ceiling; HY_TIME_BUDGET is only the raw pass's own sub-budget.
  const deadlineMs = deps.now() + (opts.timeBudgetMs ?? HY_TIME_BUDGET())
  // ... the existing seed-resolution block, but the resolveSeeds call passes the deadline:
  //   const resolved = await deps.resolveSeeds(domain, deadlineMs)
```

Then the raw crawl uses the deadline-clamped sub-budget:

```ts
  const bounds: CrawlBounds = {
    maxDepth: HY_MAX_DEPTH(), maxAdded: HY_MAX_ADDED(), maxFetches: HY_MAX_FETCHES(),
    timeBudgetMs: Math.min(HY_TIME_BUDGET(), Math.max(0, deadlineMs - deps.now())), // raw sub-budget ≤ overall deadline
    hardCap: HARD_CAP, maxQueryVariantsPerPath: HY_QUERY_VARIANTS(), maxPathSegments: HY_PATH_SEGMENTS(), concurrency: HY_CONCURRENCY(),
  }
  const crawl = await hybridCrawl(
    seedUrls.map((u) => ({ url: u, source: seedSource })), host, bounds,
    { fetchPageLinks: deps.fetchPageLinks, now: deps.now }, robots,
  )
```

(The non-hybrid early-return still fires before any of this. When `opts.seeds`
is provided the deadline is still computed first — `resolveSeeds` is simply not
called on that branch.)

Then, after the raw crawl, add the rendered-pass block (before building the return object):

```ts
  let renderProbe: 'skipped' | 'no-delta' | 'triggered' | 'failed' = 'skipped'
  let renderedFetches = 0
  let renderedAdded = 0
  let renderStoppedBy: string | undefined
  let merged: { urls: string[]; sources: Record<string, CrawlSource> } = { urls: crawl.urls, sources: crawl.sources }

  if (deps.fetchPageLinksRendered) {
    const renderedDep = deps.fetchPageLinksRendered
    let renderCalls = 0 // Codex fix 4: count ACTUAL browser renders, not memo hits
    const doRender = async (u: string): Promise<FetchedPage | null> => { renderCalls++; return renderedDep(u, deadlineMs) }
    if (crawl.urls.length >= HARD_CAP) {
      renderStoppedBy = 'hardCapPrefull'
    } else if (deadlineMs - deps.now() < RENDER_FLOOR_MS) {
      renderStoppedBy = 'timeBudget'
    } else {
      const maxSegments = HY_PATH_SEGMENTS()
      const variantCap = HY_QUERY_VARIANTS()
      const knownKeys = new Set(crawl.urls.map(normalizeCoverageUrl))
      // Codex fix 5: home (index 0) is the unconditional publisher seed; every
      // extra hub must pass the same robots/trap/segment filter as a BFS link
      // before it becomes a trusted (robots-bypassing) rendered seed.
      const rawProbe = buildProbeTargets(host, crawl.urls, RENDER_PROBE_MAX_HUBS())
      const probeTargets = rawProbe.filter((u, i) => i === 0 || admissibleLink(u, host, robots, maxSegments))
      // Codex fix 4: memoize probe RESULTS incl. failures (null) so a failed
      // probe target is not re-rendered as a BFS seed — keyed by .has, not truthiness.
      const prefetch = new Map<string, FetchedPage | null>()
      let anyProbeOk = false
      const novel = new Set<string>()
      const probeVariants = new Map<string, number>() // mirror BFS maxQueryVariantsPerPath (Codex fix 4)
      for (const t of probeTargets) {
        if (deps.now() >= deadlineMs) break
        const page = await doRender(t)
        prefetch.set(t, page ?? null)
        if (!page) continue
        anyProbeOk = true
        for (const rawHref of page.links) {
          const resolved = normalizeLinkTarget(rawHref, page.finalUrl)
          if (!resolved) continue
          if (!admissibleLink(resolved, host, robots, maxSegments)) continue
          const key = normalizeCoverageUrl(resolved)
          if (knownKeys.has(key)) continue
          let pk: string
          try { pk = new URL(key).pathname } catch { pk = key }
          const seen = probeVariants.get(pk) ?? 0
          if (seen >= variantCap) continue // same per-path query-variant cap BFS enforces
          probeVariants.set(pk, seen + 1)
          novel.add(key)
        }
      }
      if (!anyProbeOk) {
        renderProbe = 'failed'
      } else if (novel.size < RENDER_PROBE_MIN_NOVEL()) {
        renderProbe = 'no-delta'
      } else {
        renderProbe = 'triggered'
        const memoFetch = async (u: string): Promise<FetchedPage | null> => {
          if (prefetch.has(u)) return prefetch.get(u) ?? null // reuse probe result (incl. memoized failure)
          const p = await doRender(u)
          prefetch.set(u, p ?? null)
          return p
        }
        const renderBounds: CrawlBounds = {
          maxDepth: RENDER_MAX_DEPTH(), maxAdded: RENDER_MAX_ADDED(), maxFetches: RENDER_MAX_FETCHES(),
          timeBudgetMs: Math.max(0, deadlineMs - deps.now()),
          hardCap: HARD_CAP, maxQueryVariantsPerPath: variantCap, maxPathSegments: maxSegments, concurrency: RENDER_CONCURRENCY(),
        }
        const seeds: CrawlSeed[] = probeTargets.map((u) => ({ url: u, source: 'rendered' }))
        const renderedCrawl = await hybridCrawl(
          seeds, host, renderBounds, { fetchPageLinks: memoFetch, now: deps.now }, robots,
          { knownKeys, linkedSource: 'rendered-linked', prioritizeShallowFrontier: true },
        )
        renderedAdded = renderedCrawl.addedByCrawl
        renderStoppedBy = renderedCrawl.stoppedBy
        merged = mergeCrawlResults(crawl, renderedCrawl, HARD_CAP)
      }
    }
    renderedFetches = renderCalls // actual browser renders (probes + BFS misses), not memo hits
  }

  const expanded = crawl.addedByCrawl > 0 || renderedAdded > 0
  const capped = seedCapped || crawl.stoppedBy === 'hardCap' || renderStoppedBy === 'hardCapPrefull'
  return {
    urls: merged.urls,
    mode: opts.seeds || expanded ? 'hybrid' : seedMode,
    capped,
    coverage: {
      sources: merged.sources,
      sitemapCount: crawl.sitemapCount,
      sitemapCapped: sitemapCappedBefore,
      stoppedBy: crawl.stoppedBy,
      fetches: crawl.fetches,
      renderProbe, renderedFetches, renderedAdded, renderStoppedBy,
    },
  }
```

Delete the old `const capped = ...` / `return { ... }` block that this replaces. Keep the `if (!opts.hybrid) { return { urls: seedUrls, mode: seedMode, capped: seedCapped } }` early-return exactly as-is (non-hybrid path unchanged, no coverage).

- [ ] **Step 4: Run the rendered-pass tests + the full sitemap-crawler suite — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/sitemap-crawler.test.ts`
Expected: PASS — new rendered-pass cases + all existing `discoverPages`/hybrid cases (existing hybrid tests pass no `fetchPageLinksRendered`, so `renderProbe='skipped'`, `coverage` gains the new fields but the assertions in those tests use `toMatchObject`/`toEqual` on `urls`/`mode` — if any existing test asserts the exact `coverage` object shape, extend its expectation to include the new fields).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/sitemap-crawler.ts lib/ada-audit/sitemap-crawler.test.ts
git commit -m "feat(discovery): wire rendered-DOM probe + adaptive BFS into discoverPagesWithDeps (single deadline)"
```

---

## Task 7: Real-deps wiring + v2 source-map persistence

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts` (`discoverPages` real deps)
- Modify: `lib/jobs/handlers/site-audit-discover.ts` (v2 persist)
- Modify: `lib/ada-audit/queue-request.discovery-mode.test.ts` (or the nearest discover-persist test) — v2 tolerance

**Interfaces:**
- Consumes: `fetchPageLinksViaBrowser` (`./seo/rendered-crawl`).

- [ ] **Step 1: Pass the real browser fetcher + thread the deadline through seed resolution**

In `lib/ada-audit/sitemap-crawler.ts`, add the import and thread both the rendered fetcher and the deadline (Codex fix 1) through:

```ts
import { fetchPageLinksViaBrowser } from './seo/rendered-crawl'
// ...
  return discoverPagesWithDeps(domain, opts, {
    resolveSeeds: (d, deadlineMs) => resolveSeedsReal(d, robotsText, deadlineMs),
    fetchPageLinks: (u) => fetchPageLinks(u, normDomain),
    fetchPageLinksRendered: (u, deadlineMs) => fetchPageLinksViaBrowser(u, normDomain, deadlineMs),
    now: () => Date.now(),
    robots: parseRobots(robotsText),
  })
```

Widen `resolveSeedsReal(domain, robotsText, deadlineMs)` to pass the deadline into its browser sitemap fallback, and make `fetchSitemapXml` deadline-aware:

```ts
async function resolveSeedsReal(domain: string, robotsText: string, deadlineMs: number): Promise<...> {
  // ...
  // where it calls the browser fallback (both the candidate loop and step 4):
  const xml = await fetchSitemapXml(sitemapUrl, deadlineMs)
  // ...
}

async function fetchSitemapXml(url: string, deadlineMs: number): Promise<string | null> {
  const direct = await fetchSitemapXmlDirect(url)
  if (direct.ok && direct.text.length > 0) return direct.text
  return await fetchSitemapViaBrowser(url, deadlineMs) // deadline-aware browser fallback
}
```

- [ ] **Step 1b: Make `fetchSitemapViaBrowser` deadline-aware (uses Task 2's cancellable acquire)**

In `lib/ada-audit/sitemap-crawler-browser-fetch.ts`, add an optional `deadlineMs` so the browser sitemap fallback can neither wait for a pool slot nor navigate past the one global discovery deadline (Codex fix 1):

```ts
export async function fetchSitemapViaBrowser(url: string, deadlineMs?: number): Promise<string | null> {
  try { await assertSafeHttpUrl(url) } catch { return null }
  const now = () => Date.now()
  if (deadlineMs !== undefined && now() >= deadlineMs) return null
  const navBudget = deadlineMs !== undefined ? Math.max(0, deadlineMs - now()) : FETCH_TIMEOUT
  const timeout = Math.min(FETCH_TIMEOUT, navBudget)
  if (timeout <= 0) return null

  // Cancel the pool wait at the deadline so a blocked acquire can't outlive it.
  const controller = new AbortController()
  const timer = deadlineMs !== undefined ? setTimeout(() => controller.abort(), Math.max(0, deadlineMs - now())) : null
  ;(timer as unknown as { unref?: () => void } | null)?.unref?.()

  let page: Page | undefined
  try {
    page = await acquirePage(deadlineMs !== undefined ? { signal: controller.signal } : undefined)
  } catch {
    if (timer) clearTimeout(timer)
    return null // AcquireAbortedError (deadline) or launch failure — no slot leaked
  }
  try {
    page.setDefaultNavigationTimeout(timeout)
    await installBrowserRequestGuard(page)
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
    if (!response || !response.ok()) return null
    const text = await response.text().catch(() => null)
    if (!text) return null
    if (text.length > MAX_XML_BYTES) return null
    if (!SITEMAP_ROOT_RE.test(text)) return null
    return text
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
    if (page) await releasePage(page).catch(() => {})
  }
}
```

(No `deadlineMs` argument ⇒ identical behavior to Task 1's refactor — the existing `sitemap-crawler-browser-fetch.test.ts` still passes because those tests call it with one argument. Update the sitemap-crawler test fakes that stub `fetchSitemapXml` to accept the new second arg — extra args are ignored by JS stubs, so no test change is needed unless a stub asserts arity.)

- [ ] **Step 2: Write the failing v2-persist test**

The persist branches version-stamp `discoverySourcesJson`. v2 iff a rendered provenance value appears. Add a pure helper + test. In `lib/jobs/handlers/site-audit-discover.ts`, export a tiny helper:

```ts
export function sourceMapVersion(sources: Record<string, string> | undefined): 1 | 2 {
  if (!sources) return 1
  for (const s of Object.values(sources)) if (s === 'rendered' || s === 'rendered-linked') return 2
  return 1
}
```

Add a unit test file `lib/jobs/handlers/site-audit-discover.source-version.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sourceMapVersion } from './site-audit-discover'
import { deriveSitemapBaseline } from './broken-link-verify'

describe('sourceMapVersion', () => {
  it('is 1 with no rendered provenance, 2 when a rendered value appears', () => {
    expect(sourceMapVersion({ 'https://x/a': 'sitemap', 'https://x/b': 'linked' })).toBe(1)
    expect(sourceMapVersion({ 'https://x/a': 'sitemap', 'https://x/b': 'rendered-linked' })).toBe(2)
    expect(sourceMapVersion(undefined)).toBe(1)
  })
})

describe('deriveSitemapBaseline tolerates a v2 source map', () => {
  it('reads sitemap-sourced URLs and ignores rendered provenance', () => {
    const v2 = JSON.stringify({ v: 2, sources: { 'https://x/a': 'sitemap', 'https://x/b': 'rendered-linked' }, sitemapCapped: false })
    const { baseline } = deriveSitemapBaseline(v2)
    expect(baseline).toEqual(['https://x/a']) // rendered-linked is NOT a sitemap baseline entry
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.source-version.test.ts`
Expected: FAIL — `sourceMapVersion` not exported.

- [ ] **Step 4: Implement — add the helper, use it in both persist branches, and complete the F5 guards**

Add `sourceMapVersion` (above) to `site-audit-discover.ts`. In BOTH persist `updateMany` calls, replace the version stamp AND add the spec-F5-required `status: 'running'` to each guard (Codex fix 6 — the current guards lack it):

Fresh-discovery branch:
```ts
    const persisted = await prisma.siteAudit.updateMany({
      where: { id: siteAuditId, discoveredUrls: null, status: 'running' }, // + status (Codex fix 6)
      data: {
        discoveredUrls: JSON.stringify(discovered),
        pagesTotal: discovered.length,
        discoveryMode: result.mode,
        discoveryCapped: result.capped,
        discoverySourcesJson: result.coverage
          ? JSON.stringify({ v: sourceMapVersion(result.coverage.sources), ...result.coverage }) : null,
      },
    })
```

Pre-discovered expansion branch:
```ts
      const persisted = await prisma.siteAudit.updateMany({
        where: { id: siteAuditId, discoverySourcesJson: null, status: 'running' }, // + status (Codex fix 6)
        data: {
          discoveredUrls: JSON.stringify(expanded),
          pagesTotal: expanded.length,
          discoveryMode: result.mode,
          discoveryCapped: result.capped,
          discoverySourcesJson: result.coverage
            ? JSON.stringify({ v: sourceMapVersion(result.coverage.sources), ...result.coverage }) : null,
        },
      })
```

Adding `status: 'running'` is consistent with the existing `ensured` `updateMany` (which already guards on `status: 'running'`) and with the spec: a persist must land only while the row is still the active running audit; a terminal row no-ops (count 0 → the existing re-read fallback path). Both `discoveredUrls: null` / `discoverySourcesJson: null` guards are otherwise preserved exactly.

- [ ] **Step 4b: Add the concurrent-attempt test (Codex fix 6 / spec F5)**

This needs a DB-backed test (two attempts racing the persist). Add to a DB test file (e.g. a new `lib/jobs/handlers/site-audit-discover.persist.db.test.ts`, mirroring the `.db.test.ts` convention). The pure core (`discoverPagesWithDeps`) is deterministic, so simulate the race at the persist layer:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'

describe('site-audit-discover persist race (spec F5)', () => {
  it('two attempts with different rendered results → exactly one coherent (discoveredUrls, sources) tuple wins', async () => {
    const audit = await prisma.siteAudit.create({
      data: { domain: 'race.example', wcagLevel: 'wcag21aa', status: 'running', seoIntent: true, discoveredUrls: null },
    })
    // Attempt A and B both target the fresh guard; simulate their guarded writes.
    const writeA = prisma.siteAudit.updateMany({
      where: { id: audit.id, discoveredUrls: null, status: 'running' },
      data: { discoveredUrls: JSON.stringify(['https://race.example/a']), pagesTotal: 1,
        discoverySourcesJson: JSON.stringify({ v: 2, sources: { 'https://race.example/a': 'rendered-linked' } }) },
    })
    const writeB = prisma.siteAudit.updateMany({
      where: { id: audit.id, discoveredUrls: null, status: 'running' },
      data: { discoveredUrls: JSON.stringify(['https://race.example/b']), pagesTotal: 1,
        discoverySourcesJson: JSON.stringify({ v: 2, sources: { 'https://race.example/b': 'rendered-linked' } }) },
    })
    const [rA, rB] = await Promise.all([writeA, writeB])
    expect(rA.count + rB.count).toBe(1) // exactly one write lands (first-writer-wins on discoveredUrls: null)
    const row = await prisma.siteAudit.findUnique({ where: { id: audit.id }, select: { discoveredUrls: true, discoverySourcesJson: true } })
    const urls = JSON.parse(row!.discoveredUrls!) as string[]
    const sources = (JSON.parse(row!.discoverySourcesJson!) as { sources: Record<string, string> }).sources
    // Coherent tuple: the surviving urls and sources describe the SAME winner.
    expect(Object.keys(sources).map((k) => k)).toEqual(urls) // 1:1
    await prisma.siteAudit.delete({ where: { id: audit.id } })
  })
})
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.persist.db.test.ts` → PASS.

- [ ] **Step 5: Run — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-discover.source-version.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/sitemap-crawler.ts lib/jobs/handlers/site-audit-discover.ts lib/jobs/handlers/site-audit-discover.source-version.test.ts
git commit -m "feat(discovery): pass real browser fetcher; stamp v2 source map on rendered provenance"
```

---

## Task 8: Env documentation + full-gate green

**Files:**
- Modify: a config reference doc (e.g. the `er-seo-tools-config-and-flags` skill's flag list, or `docs/` env reference if one exists — grep for where `HYBRID_CRAWL_MAX_FETCHES` is documented and add alongside).

**Interfaces:** none (docs + gates only).

- [ ] **Step 1: Document the new env vars**

Find where the existing `HYBRID_CRAWL_*` vars are documented:

```bash
grep -rn "HYBRID_CRAWL_MAX_FETCHES" .claude/skills docs 2>/dev/null
```

Add the L2 vars with defaults in the same place (one line each):
- `HYBRID_RENDER_MAX_DEPTH` (2) — rendered BFS depth ceiling.
- `HYBRID_RENDER_MAX_FETCHES` (40) — total rendered page fetches.
- `HYBRID_RENDER_MAX_ADDED` (300) — rendered URLs added cap.
- `HYBRID_RENDER_CONCURRENCY` (2) — concurrent renders (≤ pool size 4).
- `HYBRID_RENDER_PROBE_MIN_NOVEL` (5) — novel admissible URLs needed to trigger the rendered pass.
- `HYBRID_RENDER_PROBE_MAX_HUBS` (2) — probe = homepage + this many shallow hubs.
- `HYBRID_RENDER_MAX_ANCHORS_PER_PAGE` (1500) — per-render anchor cap.

- [ ] **Step 2: Run the FULL gate**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: tsc clean; all vitest green (incl. the frozen `broken-link-verify.characterization.test.ts` — this plan does not touch the builder); build completes.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(discovery): document HYBRID_RENDER_* env tunables (L2)"
```

---

## Self-Review

**Spec coverage (§L2):**
- New `rendered-crawl.ts` `fetchPageLinksViaBrowser` — Task 3. ✓
- Shared SSRF interceptor extracted (not re-copied), redirect-abort-before-render, subresource blocking — Task 1. ✓
- Anchor cap per render — Task 3 (`HYBRID_RENDER_MAX_ANCHORS_PER_PAGE`). ✓
- Absolute discovery deadline + cancellable `acquirePage` (no slot leak) — Tasks 2 + 3 + 6 (single `deadlineMs` in `discoverPagesWithDeps`). ✓
- Corrected seed model: `knownUrls` deduped-not-fetched, homepage/hubs as publisher seeds, rendered candidates through normal filters, novel-hub priority — Tasks 4 + 6. ✓
- Novelty-based probe (home + 1–2 shallow hubs), trigger on novel-admissible ≥ N, probe-failure distinct from no-delta — Task 6. ✓
- Merge by normalized key with precedence; HARD_CAP-prefull rule (skip + record) — Tasks 5 + 6. ✓
- Coverage stats `renderProbe`/`renderedFetches`/`renderedAdded`/`renderStoppedBy` — Task 6. ✓
- v2 source map on rendered provenance; readers (`deriveSitemapBaseline`) tolerate v2; exact persist guards preserved — Task 7. ✓
- Memory safety (pool ≤4, discovery before fan-out, subresource block, concurrency 2) — Global Constraints + Task 3. ✓
- `admissibleLink` shared so probe admission == crawl admission — Task 4. ✓

**Deferred (own plans/steps, not this plan):** L3 bound raises; `fallback: 'sf-required'` ledger labeling (recorded at prod-verify).

**Codex P0 review — verdict "accept with named fixes" (gpt-5.6-terra, high; 2026-07-20), all 6 applied in place:**
1. Global deadline computed BEFORE seed resolution (`start + (opts.timeBudgetMs ?? HY_TIME_BUDGET())`); `HY_TIME_BUDGET` becomes the raw-pass sub-budget; deadline threaded through `resolveSeeds` → `resolveSeedsReal` → `fetchSitemapViaBrowser` (Task 1b, 6, 7) + expiry test.
2. `navTimeout` recomputed AFTER `acquirePage` + deadline check before the SSRF precheck (Task 3).
3. Abort re-check immediately before `slots--` + wake-vs-abort interleaving test (Task 2).
4. Probe admission matches BFS incl. `maxQueryVariantsPerPath`; probe failures memoized as `null` (`.has`, not truthiness); `renderedFetches` counts actual renders, not memo hits (Task 6) + render-accounting test.
5. Publisher-seed exception tightened: home is the only unconditional seed; extra hubs pass `admissibleLink` (robots/trap/segment) before seeding; SSR-home/CSR-deep test + "never seed the full known set" spy (Task 6).
6. `status: 'running'` added to BOTH persist guards; concurrent-attempt DB test (Task 7).

**Placeholder scan:** none — every code step shows the code; every test step shows assertions.

**Type consistency:** `CrawlSource`/`CrawlSeed.source` extended once (Task 4) and used consistently (`'rendered'` seeds, `'rendered-linked'` discovered) in Tasks 5/6; `HybridCrawlOpts` fields (`knownKeys`, `linkedSource`, `prioritizeShallowFrontier`) match between Task 4 definition and Task 6 call; `DiscoverDeps.fetchPageLinksRendered(url, deadlineMs)` signature matches Task 3's `fetchPageLinksViaBrowser` (Task 7 binds `normDomain`); `deadlineMs` is epoch-ms everywhere.

---

## Prod verification (after merge + deploy)

Per spec §L2 "Prod verification (Codex F1 — strengthened)":
1. **Residual:** re-run the session ledger probe on cambria/glow/nuvani/brownson/federico → policy-filtered `residualMissRate` < 5% (record before/after per client in the parity log, alongside `renderProbe`/`renderedAdded`).
2. **Memory (worst case):** trigger a render-discovery seoIntent audit **while 2 standalone ADA audits run**; record **total process-tree RSS** (parent + all Chromium descendants — `ps`/`pstree` RSS sum, NOT `pm2 status` which omits descendants + short peaks), system headroom, and PM2 restart count. **Numeric pass threshold (Codex verify note):** peak total process-tree RSS **< 2200 MB**, **≥ 1400 MB free system memory** at peak (the box is 3.9 GB; app baseline ~570 MB + a full 4-page Chrome pool ~800 MB ≈ 1.4 GB expected peak), and **0 PM2 restarts** across the run. Fail → do not pass L2; lower `HYBRID_RENDER_CONCURRENCY` or investigate before retrying. (Sample the tree RSS on a ~2 s interval for the duration so a short peak isn't missed — the 2026-07-16 verifier incident peaked at 2409 MB from the ONNX pass, a different subsystem, but it is the reference scar for "sample the peak, not the average.")
3. **Fail-closed:** any client that still exceeds 5% because it is >1000 pages / router-only / isolated-cluster is labeled `fallback: 'sf-required'` + reason in the ledger — never a silent sub-5% pass; its N=8 clock does not start.
