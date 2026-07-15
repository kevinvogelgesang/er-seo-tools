# Audit Runner Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the per-page audit error rate from 24% to under 2% by changing the runner's navigation strategy from a hard `networkidle2` gate to a `domcontentloaded` + bounded-settle approach, adding a scanner-noise request blocklist, hardening the per-page cache state, and converting two soft error classes (PDF oversize, redirect with no body) into actionable surfaces.

**Architecture:** All changes are inside `lib/ada-audit/` — no schema upheaval except a single new column for `pdfsSkipped`. The dominant fix lives in `runner.ts:138-150` (the navigation block). A new pure module `scanner-noise.ts` holds the blocklist and a hostname matcher; the runner's existing request-interception handler consults it. `browser-pool.ts` gains a small hardening block on page acquisition. Each phase ships as a separate PR + deploy so we can measure impact against fresh queue-wide audit runs.

**Tech Stack:** Next.js 15 App Router · TypeScript · Puppeteer-core · Prisma + SQLite · vitest

**Companion spec:** `docs/superpowers/specs/2026-05-22-audit-runner-robustness-design.md`

**Source data:** The 2026-05-21 queue-wide audit produced 1138 page errors across 31 sites. 99.1% were `Navigation timeout` errors concentrated in `soma.edu` (833) and `prismcareerinstitute.edu` (294). Full breakdown is in the spec.

**Pre-flight:** None — works against `main` as it is. Each phase ends with a deploy (`ssh $PROD_SSH "~/deploy.sh"`) and a brief manual verification.

---

## File Structure

| File                                              | Phase   | Status | Responsibility                                                                       |
|---------------------------------------------------|---------|--------|--------------------------------------------------------------------------------------|
| `lib/ada-audit/runner.ts`                         | 1, 2, 3, 5 | Modify | Replace nav block; integrate noise filter; transient-error retry; 3xx diagnostics    |
| `lib/ada-audit/page-load.ts`                      | 1       | Modify | Keep `gotoWithRetryOn5xx` as-is; add `postLoadSettle(page, opts)` helper             |
| `lib/ada-audit/scanner-noise.ts`                  | 2       | Create | Blocklist + `isNoiseRequest(url, resourceType): boolean`                             |
| `lib/ada-audit/scanner-noise.test.ts`             | 2       | Create | Unit tests for hostname matcher + resource-type rules                                |
| `lib/ada-audit/browser-pool.ts`                   | 2, 4    | Modify | Cache + SW + header hardening on `acquirePage()`                                     |
| `lib/ada-audit/page-load.test.ts`                 | 1       | Create | Unit tests for `postLoadSettle`                                                      |
| `lib/ada-audit/runner-retry.ts`                   | 3       | Create | `isTransientRunnerError(err): boolean` — pure predicate                              |
| `lib/ada-audit/runner-retry.test.ts`              | 3       | Create | Unit tests for the predicate                                                         |
| `lib/ada-audit/pdf-runner.ts`                     | 6       | Modify | Surface `skipped` status with `reason: 'oversize'` instead of `error`                |
| `prisma/schema.prisma`                            | 6       | Modify | Add `pdfsSkipped Int @default(0)` to SiteAudit; add `skipReason String?` to PdfAudit |
| `lib/ada-audit/types.ts`                          | 6       | Modify | Add `'skipped'` to PdfAudit status type union; document `skipReason`                 |
| `lib/ada-audit/site-audit-helpers.ts`             | 6       | Modify | Include `pdfsSkipped` in `buildSiteAuditSummary`                                     |
| `components/ada-audit/PdfList.tsx`                | 6       | Modify | Render `skipped` pill (neutral) with reason                                          |
| `CLAUDE.md`                                       | 1       | Modify | Update the navigation-strategy bullet under "ADA Audit specifics"                    |
| `lib/ada-audit/sitemap-crawler.ts`                | 4       | Modify | Add Puppeteer fallback path triggered when all `safeFetch` candidates fail           |
| `lib/ada-audit/sitemap-crawler-browser-fetch.ts`  | 4       | Create | Pure helper: `fetchSitemapViaBrowser(url): Promise<string \| null>`                  |
| `lib/ada-audit/sitemap-crawler.test.ts`           | 4       | Modify/Create | Cover both the existing safeFetch happy path AND the browser fallback path  |

---

## Phase 1 — Navigation strategy change

Single highest-impact fix. Replaces `waitUntil: 'networkidle2'` with `domcontentloaded` + a 5 s bounded `waitForNetworkIdle` settle. Expected to prevent 900–1100 of the 1128 nav-timeout errors.

### Task 1.1: Add `postLoadSettle` helper to `page-load.ts`

**Files:**
- Modify: `lib/ada-audit/page-load.ts`
- Test: `lib/ada-audit/page-load.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/ada-audit/page-load.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { TimeoutError } from 'puppeteer-core'
import { postLoadSettle } from './page-load'

describe('postLoadSettle', () => {
  it('resolves normally when waitForNetworkIdle resolves', async () => {
    const fakePage = { waitForNetworkIdle: vi.fn().mockResolvedValue(undefined) }
    await expect(postLoadSettle(fakePage as never)).resolves.toBeUndefined()
    expect(fakePage.waitForNetworkIdle).toHaveBeenCalledWith({ idleTime: 500, timeout: 5_000 })
  })

  it('swallows ONLY the TimeoutError from waitForNetworkIdle', async () => {
    const fakePage = { waitForNetworkIdle: vi.fn().mockRejectedValue(new TimeoutError('timed out')) }
    await expect(postLoadSettle(fakePage as never)).resolves.toBeUndefined()
  })

  it('rethrows non-timeout failures (e.g. frame detach during settle)', async () => {
    const fakePage = { waitForNetworkIdle: vi.fn().mockRejectedValue(new Error('Navigating frame was detached')) }
    await expect(postLoadSettle(fakePage as never)).rejects.toThrow('Navigating frame was detached')
  })

  it('rethrows unknown errors so the transient-retry layer can see them', async () => {
    class WeirdError extends Error {}
    const fakePage = { waitForNetworkIdle: vi.fn().mockRejectedValue(new WeirdError('boom')) }
    await expect(postLoadSettle(fakePage as never)).rejects.toThrow('boom')
  })

  it('honors a caller-supplied timeout', async () => {
    const fakePage = { waitForNetworkIdle: vi.fn().mockResolvedValue(undefined) }
    await postLoadSettle(fakePage as never, { timeout: 2_000 })
    expect(fakePage.waitForNetworkIdle).toHaveBeenCalledWith({ idleTime: 500, timeout: 2_000 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/page-load.test.ts`
Expected: FAIL — `postLoadSettle` not exported.

- [ ] **Step 3: Implement `postLoadSettle`**

Append to `lib/ada-audit/page-load.ts`:

```ts
import type { Page } from 'puppeteer-core'
import { TimeoutError } from 'puppeteer-core'

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ada-audit/page-load.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/page-load.ts lib/ada-audit/page-load.test.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): add postLoadSettle helper for bounded best-effort settle

Pure helper that wraps page.waitForNetworkIdle in a swallowed-rejection
shape so callers can use it as a "best-effort" step rather than a
pass/fail navigation gate. The runner switch to domcontentloaded + this
helper lands in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Swap the runner's navigation block

**Files:**
- Modify: `lib/ada-audit/runner.ts:138-150`

- [ ] **Step 1: Replace the navigation block**

In `lib/ada-audit/runner.ts`, update the import block to include `postLoadSettle`:

```ts
import { gotoWithRetryOn5xx, postLoadSettle } from './page-load'
```

Then replace lines 138-150 (the `try { response = await gotoWithRetryOn5xx(...)` block) with:

```ts
      let response
      try {
        response = await gotoWithRetryOn5xx(
          page,
          parsed.toString(),
          { waitUntil: 'domcontentloaded', timeout: 30_000 },
          async () => {
            await progress(22, 'Retrying (upstream 5xx)…')
          },
        )
        // Settle stays INSIDE the same try so that any non-timeout rejection
        // during settle (frame detach, navigation reset) surfaces here and
        // the Phase 2 transient-retry layer sees it. The helper only swallows
        // waitForNetworkIdle's own timeout. See spec §"Decision 1".
        await postLoadSettle(page)
      } catch (err) {
        if (blockedNavigationError) throw blockedNavigationError
        throw err
      }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the runner-adjacent unit tests**

Run: `npx vitest run lib/ada-audit/page-load.test.ts lib/ada-audit/scoring.test.ts lib/ada-audit/common-issues.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): switch nav to domcontentloaded + bounded settle

The previous waitUntil 'networkidle2' gate (≤2 in-flight requests for
≥500ms within a 30s budget) never settled on sites with poll-style
analytics or chat widgets. soma.edu and prismcareerinstitute.edu alone
produced 1127 nav-timeout errors on a single queue-wide run — 99% of
all page errors — because GTM/Hotjar/Intercom beacons kept the network
"busy" past 30s even though the DOM was usable for axe in ~3s.

The new shape uses domcontentloaded as the hard gate (still 30s budget)
and then calls postLoadSettle for a 5s best-effort grace window before
running axe. Healthy pages get there faster than they used to (DCL fires
before networkidle2 on the same load); bad pages waste 5s of settle
instead of 30s of timeout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.3: Update CLAUDE.md to reflect the new strategy

**Files:**
- Modify: `CLAUDE.md` — the bullet under "ADA Audit specifics" that mentions `waitUntil: 'networkidle2'`

- [ ] **Step 1: Update the bullet**

Find the line in `CLAUDE.md`:

```
- axe-core runs inside headless Chrome (puppeteer-core) with `waitUntil: 'networkidle2'` so CSS and fonts load — color-contrast checks work
```

Replace with:

```
- axe-core runs inside headless Chrome (puppeteer-core). Navigation uses `waitUntil: 'domcontentloaded'` (30 s budget) followed by a best-effort `waitForNetworkIdle({ idleTime: 500, timeout: 5_000 })` settle via `postLoadSettle` in `lib/ada-audit/page-load.ts`. The settle is non-fatal — analytics/chat poll traffic on real client sites would otherwise prevent network-idle from ever firing. CSS and fonts that block first-paint are already in the DOM at DCL; color-contrast checks still work.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md to reflect new navigation strategy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.4: Build, push, deploy, manually verify

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: build completes; type errors = 0.

- [ ] **Step 2: Push**

Run: `git push`

- [ ] **Step 3: Deploy**

Run: `ssh $PROD_SSH "~/deploy.sh"`
Expected: PM2 restart succeeds; `seo-tools` returns to `online`.

- [ ] **Step 4: Manual verification on the known-problem URLs**

Open `https://er-seo-tools.example.com/ada-audit` (or the deployed URL) and run single-page audits on each of these URLs in turn:

1. `https://www.soma.edu/about-soma/`
2. `https://nuvani.edu/blog/self-employment-vs-salon-work-pros-and-cons-for-future-nail-technicians/`
3. `https://www.prismcareerinstitute.edu/blog/`
4. `https://discoverycommunitycollege.com/programs/business/business-administration/`

Acceptance criterion: each one returns a score (any score) in under 45 s wall-clock, not an error. URL #4 (a 304 case) is expected to still error after Phase 1 — fix lands in Phase 2.

If a URL still errors with `Navigation timeout`, stop and investigate before proceeding to Phase 2. The most likely cause is a request inside Puppeteer that blocks DCL itself (e.g., a synchronous third-party script). Phase 2's noise blocklist may resolve it, but a Phase-1-alone failure should be understood first.

- [ ] **Step 5: Re-run a small queue-wide audit (5-10 sites including soma.edu and prismcareerinstitute.edu)**

Acceptance criterion: the page-error rate on the same site set drops from 24% to under 5%. Capture the new aggregated error class table for the Phase 2 brief.

---

## Phase 2 — Scanner-noise blocklist + cache hardening + transient retry

Belt-and-braces for the residual after Phase 1: a curated noise-host blocklist that prevents poll traffic from running at all, a single-shot retry for genuinely transient errors, and per-page cache hardening that closes the 304-from-Chrome gap.

### Task 2.1: Create `scanner-noise.ts` with hostname matcher

**Files:**
- Create: `lib/ada-audit/scanner-noise.ts`
- Test: `lib/ada-audit/scanner-noise.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/ada-audit/scanner-noise.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isNoiseRequest, NOISE_HOSTS } from './scanner-noise'

describe('isNoiseRequest — hostname matcher', () => {
  it('matches exact hostname', () => {
    expect(isNoiseRequest('https://www.google-analytics.com/g/collect?v=2', 'xhr')).toBe(true)
  })

  it('matches subdomain via suffix rule', () => {
    expect(isNoiseRequest('https://sub.googletagmanager.com/gtm.js', 'script')).toBe(true)
  })

  it('does not match a non-noise first-party host', () => {
    expect(isNoiseRequest('https://www.soma.edu/about/', 'document')).toBe(false)
  })

  it('does not match a host that happens to contain a noise name as a substring', () => {
    expect(isNoiseRequest('https://googletagmanager.com.evil.example/', 'script')).toBe(false)
  })

  it('blocks "media" resource type regardless of host', () => {
    expect(isNoiseRequest('https://www.soma.edu/video.mp4', 'media')).toBe(true)
  })

  it('does not block image/font/css/script even on noise-looking hosts (only by exact list)', () => {
    expect(isNoiseRequest('https://example.com/image.png', 'image')).toBe(false)
    expect(isNoiseRequest('https://example.com/font.woff2', 'font')).toBe(false)
    expect(isNoiseRequest('https://example.com/style.css', 'stylesheet')).toBe(false)
  })

  it('rejects malformed URLs silently (returns false)', () => {
    expect(isNoiseRequest('not-a-url', 'xhr')).toBe(false)
    expect(isNoiseRequest('', 'xhr')).toBe(false)
  })

  it('uses lower-cased host comparison', () => {
    expect(isNoiseRequest('https://WWW.GOOGLE-ANALYTICS.com/g/collect', 'xhr')).toBe(true)
  })

  it('the exported NOISE_HOSTS list is non-empty and contains documented entries', () => {
    expect(NOISE_HOSTS.length).toBeGreaterThan(20)
    expect(NOISE_HOSTS).toContain('googletagmanager.com')
    expect(NOISE_HOSTS).toContain('static.hotjar.com')
  })

  it('explicitly does NOT block FB SDK or Intercom (accessibility-relevant widgets)', () => {
    expect(NOISE_HOSTS).not.toContain('connect.facebook.net')
    expect(NOISE_HOSTS).not.toContain('widget.intercom.io')
    expect(NOISE_HOSTS).not.toContain('js.intercom.io')
    expect(isNoiseRequest('https://connect.facebook.net/en_US/sdk.js', 'script')).toBe(false)
    expect(isNoiseRequest('https://widget.intercom.io/widget/abc123', 'script')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ada-audit/scanner-noise.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `scanner-noise.ts`**

```ts
// Curated blocklist of third-party hosts whose only role on a public web page
// is to send beacons / poll for events / inject session-replay or chat
// widgets. Blocking them at request-interception time stops them from holding
// the page network "busy" past first paint, which was the dominant cause of
// the 1128 nav-timeout errors observed on the 2026-05-21 queue-wide run
// (99.1% of all page errors that day).
//
// Matching is exact-hostname-suffix only: a request host matches an entry E
// when `host === E` or `host.endsWith('.' + E)`. No substring matching, no
// regex — both produce false positives that are hard to debug.
//
// We do NOT block: first-party requests, fonts, images, CSS, scripts on
// non-listed hosts, or HTML documents.
//
// Risk accepted: a small number of cookie-banners / GDPR widgets / chat
// bubbles that ONLY load via GTM will be absent from the scanned DOM.
// Documented in the spec.

export const NOISE_HOSTS: readonly string[] = [
  // Tag management + analytics
  'googletagmanager.com',
  'www.google-analytics.com',
  'analytics.google.com',
  'region1.google-analytics.com',
  'region1.analytics.google.com',
  'stats.g.doubleclick.net',
  'www.googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',

  // Ad pixels + retargeting
  // EXPLICITLY NOT BLOCKED: connect.facebook.net (FB SDK can be used for
  // accessibility-relevant login widgets / share buttons; post-DCL settle
  // already prevents throughput cost). www.facebook.com is left allowed for
  // the same reason — its /tr beacon is short-lived and won't stall DCL.
  'bat.bing.com',
  'analytics.tiktok.com',
  'analytics.pinterest.com',
  'ct.pinterest.com',
  'px.ads.linkedin.com',
  'snap.licdn.com',

  // Session-replay + heatmaps
  'static.hotjar.com',
  'script.hotjar.com',
  'vc.hotjar.io',
  'cdn.mouseflow.com',
  'rs.fullstory.com',
  'edge.fullstory.com',
  'app.clarity.ms',
  'www.clarity.ms',
  'script.crazyegg.com',

  // Chat / support widgets (Intercom intentionally excluded — it's often
  // the only "Contact us" affordance on a page, so blocking it risks hiding
  // an accessibility-relevant CTA. The post-DCL settle already neutralises
  // any throughput cost of letting Intercom load.)
  'js.driftt.com',
  'js.usemessagely.com',
  'embed.tawk.to',
  'cdn.livechatinc.com',
  'static.olark.com',

  // WordPress.com telemetry (on Jetpack-enabled sites)
  'stats.wp.com',
  'pixel.wp.com',

  // New Relic browser agent
  'bam.nr-data.net',
  'js-agent.newrelic.com',
]

/**
 * Returns true when a request should be aborted as scanner-noise.
 * The function never throws — malformed URLs return false.
 */
export function isNoiseRequest(url: string, resourceType: string): boolean {
  // Block all media (video/audio) regardless of host — irrelevant to axe and
  // a known throughput sink.
  if (resourceType === 'media') return true

  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!host) return false

  for (const entry of NOISE_HOSTS) {
    if (host === entry) return true
    if (host.endsWith('.' + entry)) return true
  }
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ada-audit/scanner-noise.test.ts`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/scanner-noise.ts lib/ada-audit/scanner-noise.test.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): add scanner-noise blocklist + matcher

Curated list of third-party hosts (GTM, GA, Hotjar, Intercom, ad pixels,
session-replay vendors, chat widgets, WP.com telemetry) plus a strict
hostname-suffix matcher. Pure module — no runner wiring yet.

Designed to be consulted from the existing request-interception handler
in runner.ts. Block-by-exact-suffix only (no regex, no substring) to
avoid the false-positive class where a benign host happens to contain
a noise name in its path or as a label.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.2: Wire the noise filter into the runner

**Files:**
- Modify: `lib/ada-audit/runner.ts`

- [ ] **Step 1: Add the import**

Near the top of `runner.ts`, alongside the existing `./page-load` import, add:

```ts
import { isNoiseRequest } from './scanner-noise'
```

- [ ] **Step 2: Extend the existing `handleRequest`**

In `lib/ada-audit/runner.ts`, find `handleRequest` (currently at line 97-111):

```ts
const handleRequest = async (request: HTTPRequest) => {
  try {
    await validateBrowserRequest(request.url())
    if (!request.isInterceptResolutionHandled()) {
      await request.continue()
    }
  } catch (err) {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      blockedNavigationError = err instanceof Error ? err : new Error('Unsafe navigation request blocked')
    }
    if (!request.isInterceptResolutionHandled()) {
      await request.abort('blockedbyclient').catch(() => {})
    }
  }
}
```

Replace the body so the noise check runs *before* the SSRF validator (cheap, deterministic, never produces a navigation block):

```ts
const handleRequest = async (request: HTTPRequest) => {
  // Cheap noise-filter first. Never blocks the main frame — only sub-resources.
  if (
    !request.isNavigationRequest() &&
    isNoiseRequest(request.url(), request.resourceType())
  ) {
    if (!request.isInterceptResolutionHandled()) {
      await request.abort('blockedbyclient').catch(() => {})
    }
    return
  }

  try {
    await validateBrowserRequest(request.url())
    if (!request.isInterceptResolutionHandled()) {
      await request.continue()
    }
  } catch (err) {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      blockedNavigationError = err instanceof Error ? err : new Error('Unsafe navigation request blocked')
    }
    if (!request.isInterceptResolutionHandled()) {
      await request.abort('blockedbyclient').catch(() => {})
    }
  }
}
```

The `!request.isNavigationRequest()` guard prevents the noise filter from ever cancelling the main-document load — only sub-resources can be filtered.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): wire scanner-noise blocklist into request interception

The existing handler in runner.ts already runs setRequestInterception
for SSRF safety. We add a non-blocking noise filter that runs before
the SSRF check and aborts any sub-resource matching the curated list
in scanner-noise.ts. Main-frame navigation requests are never filtered
to avoid accidentally aborting the page itself.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: Harden per-page cache state in `browser-pool.ts`

**Files:**
- Modify: `lib/ada-audit/browser-pool.ts:63-73`

- [ ] **Step 1: Update `acquirePage`**

Replace the body of `acquirePage` (currently ends with `return page`):

```ts
export async function acquirePage(): Promise<Page> {
  if (slots > 0) {
    slots--
  } else {
    await new Promise<void>((resolve) => waitQueue.push(resolve))
  }
  const b = await getBrowser()
  const page = await b.newPage()
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/browser-pool.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): per-page cache + service-worker hardening

Browser launch already sets --disable-http-cache, but the 2026-05-21
queue-wide run surfaced 2 pages with HTTP 304 Not Modified responses.
The remaining vectors are conditional validators in memory cache and
service-worker caches. We close both with setCacheEnabled(false),
setBypassServiceWorker(true), and per-request Cache-Control: no-cache
headers on every newly acquired page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.4: 304 fresh-retry inside the runner

**Files:**
- Modify: `lib/ada-audit/runner.ts` — the `if (status === 304)` branch

- [ ] **Step 1: Replace the 304 branch**

Find the line `if (status === 304)` (around runner.ts:154) and replace its body. Before:

```ts
if (status === 304) {
  throw new Error('HTTP 304 Not Modified — cached response received; re-run to get a fresh scan')
}
```

After:

```ts
if (status === 304) {
  // Cache hardening on the page (browser-pool.ts) should have prevented this,
  // but if Chrome still served a validator-only response, retry once with a
  // cache-busting query param and explicit no-store headers. Failure surfaces
  // the original 304 message so the operator can re-run manually.
  await page.setExtraHTTPHeaders({
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
  }).catch(() => {})
  const bustUrl = new URL(parsed.toString())
  bustUrl.searchParams.set('_cb', String(Date.now()))
  response = await page.goto(bustUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await postLoadSettle(page)
  if (!response) throw new Error('HTTP 304 Not Modified — retry also returned no response; re-run to get a fresh scan')
  if (response.status() === 304) {
    throw new Error('HTTP 304 Not Modified — cached response received twice; re-run to get a fresh scan')
  }
}
```

Note: the cache-busting query param can theoretically change page behavior on sites that route by exact URL. In practice the affected URLs were content pages where an extra `_cb` param is ignored. The trade-off is documented.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): one-shot fresh-retry on HTTP 304

When per-page cache hardening cannot prevent Chrome from emitting a
conditional-validator response, retry once with a cache-busting query
param and no-store headers before surfacing the 304 as an error.

Closes the 2 × 304 cases from the 2026-05-21 run (discoverycommunitycollege.com,
suttercountyctc.edu).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.5: Transient-error retry predicate (pure)

**Files:**
- Create: `lib/ada-audit/runner-retry.ts`
- Test: `lib/ada-audit/runner-retry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/ada-audit/runner-retry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isTransientRunnerError } from './runner-retry'

describe('isTransientRunnerError', () => {
  it('matches Puppeteer navigation timeout', () => {
    expect(isTransientRunnerError(new Error('Navigation timeout of 30000 ms exceeded'))).toBe(true)
  })

  it('matches Puppeteer frame-detached error', () => {
    expect(isTransientRunnerError(new Error('Navigating frame was detached'))).toBe(true)
  })

  it('matches Chrome cert verifier transient', () => {
    expect(isTransientRunnerError(new Error('net::ERR_CERT_VERIFIER_CHANGED at https://x.example/'))).toBe(true)
  })

  it('does NOT match HTTP status errors', () => {
    expect(isTransientRunnerError(new Error('HTTP 403 — This site is blocking automated scanners'))).toBe(false)
    expect(isTransientRunnerError(new Error('HTTP 404 — Not Found'))).toBe(false)
    expect(isTransientRunnerError(new Error('HTTP 500 — Internal Server Error'))).toBe(false)
    expect(isTransientRunnerError(new Error('HTTP 304 Not Modified — retry also returned no response'))).toBe(false)
  })

  it('does NOT match SSRF or content-type errors', () => {
    expect(isTransientRunnerError(new Error('Blocked unsafe navigation request to internal IP'))).toBe(false)
    expect(isTransientRunnerError(new Error('Response is not HTML (Content-Type: application/json)'))).toBe(false)
  })

  it('handles non-Error inputs', () => {
    expect(isTransientRunnerError('Navigation timeout of 30000 ms exceeded')).toBe(true)
    expect(isTransientRunnerError(null)).toBe(false)
    expect(isTransientRunnerError(undefined)).toBe(false)
    expect(isTransientRunnerError({ message: 'Navigation timeout of 30000 ms exceeded' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ada-audit/runner-retry.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the predicate**

Create `lib/ada-audit/runner-retry.ts`:

```ts
// Narrow predicate for runner errors that empirical evidence (the 2026-05-21
// queue-wide run + manual re-scan testing) suggests recover on a single
// fresh-page retry. We deliberately do NOT match HTTP status errors (4xx/5xx
// are deterministic at the source) or SSRF blocks (correct refusal).

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /Navigation timeout of \d+ ms exceeded/i,
  /Navigating frame was detached/i,
  /net::ERR_CERT_VERIFIER_CHANGED/i,
]

export function isTransientRunnerError(err: unknown): boolean {
  let msg: string
  if (err instanceof Error) msg = err.message
  else if (typeof err === 'string') msg = err
  else return false

  return TRANSIENT_PATTERNS.some((re) => re.test(msg))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ada-audit/runner-retry.test.ts`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/runner-retry.ts lib/ada-audit/runner-retry.test.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): transient-error predicate for one-shot retry

Narrow pattern set for the three error classes where empirical evidence
shows a single fresh-page retry recovers: nav-timeout, frame-detached,
and Chrome's net::ERR_CERT_VERIFIER_CHANGED. HTTP status errors and
SSRF blocks are deterministic and not retried.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.6: Wire the retry around the runner's nav block

**Files:**
- Modify: `lib/ada-audit/runner.ts` — wrap the navigation + post-load-settle in a single-shot retry on transient errors. Closure-extraction shape, fresh page on retry.

- [ ] **Step 1: Add the import**

At the top of `runner.ts`, alongside the existing `./page-load` / `./scanner-noise` imports:

```ts
import { isTransientRunnerError } from './runner-retry'
import { acquirePage, releasePage } from './browser-pool'  // if not already imported in scope
```

(Read the existing imports first — if `acquirePage`/`releasePage` are already in scope via the runner's outer caller, you don't need to re-import them inside the runner. Adjust accordingly.)

- [ ] **Step 2: Extract the entire `provider === 'pagespeed' | 'off'` block into `attemptNavigation`**

The closure encloses every effect of that block: the `let response`, the `gotoWithRetryOn5xx` call, `postLoadSettle`, the status-code checks (304 fresh-retry, 403/401/3xx/etc.), and the content-type check. It does NOT enclose the `setRequestInterception` setup or the `validateBrowserRequest` cache — those live above and persist across retries.

The closure shape (replaces the current inline block):

```ts
let response: HTTPResponse | null = null

const attemptNavigation = async (currentPage: Page): Promise<void> => {
  try {
    response = await gotoWithRetryOn5xx(
      currentPage,
      parsed.toString(),
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
      async () => { await progress(22, 'Retrying (upstream 5xx)…') },
    )
    await postLoadSettle(currentPage)
  } catch (err) {
    if (blockedNavigationError) throw blockedNavigationError
    throw err
  }

  if (!response) throw new Error('No response received from page')
  const status = response.status()

  // 304 cache-bust retry stays here (Task 2.4 shape)
  if (status === 304) {
    // ...the 304 branch from Task 2.4...
  }
  if (!response.ok()) {
    if (status === 403) throw new Error(`HTTP 403 — This site is blocking automated scanners. ...`)
    if (status === 401) throw new Error(`HTTP 401 — This page requires authentication. ...`)
    // Task 3.1's 3xx-aware branch lands here later in Phase 3.
    throw new Error(`HTTP ${status} — ${response.statusText()}`)
  }

  const contentType = response.headers()['content-type'] ?? ''
  if (!contentType.includes('html')) throw new Error(`Response is not HTML (Content-Type: ${contentType})`)
}
```

- [ ] **Step 3: Wrap the call site in a single-shot retry with a FRESH page**

Replace the existing inline navigation call with:

```ts
try {
  await attemptNavigation(page)
} catch (err) {
  if (!isTransientRunnerError(err)) throw err

  await progress(23, 'Transient error — retrying with fresh page…')

  // Release the failing page and acquire a fresh one. `about:blank` is
  // insufficient for `Navigating frame was detached` because Puppeteer's
  // frame tree may be in an unrecoverable state. A fresh page also clears
  // any half-applied request-interception state.
  await releasePage(page).catch(() => {})
  page = await acquirePage()

  // Re-apply hardening from browser-pool (idempotent) and re-register the
  // request handler on the new page.
  await page.setRequestInterception(true)
  page.on('request', (request) => { void handleRequest(request) })
  // Note: `validateBrowserRequest` and `blockedNavigationError` close over
  // the outer scope and continue to work without re-binding.

  await attemptNavigation(page)
}
```

⚠ **Two practical notes for the engineer:**

1. `page` was likely declared `const` in the original runner. To support reassignment, change it to `let page = await acquirePage()`.

2. `setRequestInterception` must be re-armed on the new page. If the runner has more setup state on the page (default timeout, viewport, etc.), re-apply those too. Read the runner's full page-setup block first and replicate any state the original page had before the retry runs.

- [ ] **Step 4: Reset `blockedNavigationError` before the retry**

`blockedNavigationError` is a `let` declared in the runner's outer scope and closed over by `handleRequest`. If the first attempt mutated it (e.g. an SSRF block fired on a redirect), the second attempt would see the stale value and throw immediately on the first request. Reset it explicitly before the retry:

```ts
blockedNavigationError = null
await attemptNavigation(page)
```

- [ ] **Step 5: Acceptance properties for the retry**

The retry behaviour must satisfy all of:
- Triggers only when `isTransientRunnerError(err)` returns true.
- Fires at most once per `runAudit` invocation (no second retry).
- HTTP status errors (404, 403, 401, 5xx after `gotoWithRetryOn5xx`, 304 after fresh-retry) do NOT trigger this layer — they propagate.
- Errors that are not transient and not status-related propagate normally.
- The original failing page is released back to the pool before the new one is acquired.
- `blockedNavigationError` is reset to null before the retry attempt.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): one-shot retry on transient navigation errors

Wraps the runner's navigation block in a single-shot retry that fires
only on three patterns: navigation timeout, "Navigating frame was
detached", and net::ERR_CERT_VERIFIER_CHANGED. All HTTP status errors,
SSRF blocks, and content-type rejections bypass the retry (deterministic
at the source).

The retry navigates to about:blank to clear page state before re-running
the same navigation block. Avoids the more invasive release/re-acquire
of a pool page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.7: Build, push, deploy, verify

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Push and deploy**

Run: `git push && ssh $PROD_SSH "~/deploy.sh"`

- [ ] **Step 3: Manual verification**

Re-run single-page audits on:
1. `https://www.soma.edu/about-soma/` — expect score, not error
2. `https://discoverycommunitycollege.com/programs/business/business-administration/` — expect score (was 304)
3. `https://nuvani.edu/blog/self-employment-vs-salon-work-pros-and-cons-for-future-nail-technicians/` — expect score (was frame-detached)

- [ ] **Step 4: Re-run a queue-wide audit of the original 31-site list**

Compare error counts:
- Baseline (pre-fix): 1138 page errors, 24% page-error rate
- Phase 1 target: <100 page errors
- Phase 1+2 target: <30 page errors

If Phase 1+2 hits <30, Phase 3 can ship without further measurement gating.

---

## Phase 3 — UX surfaces (3xx diagnostics + PDF oversize)

Smaller-scope UX improvements that don't change error counts but make operator-facing surfaces more actionable. Ship these together as a single PR.

### Task 3.1: Better 3xx error diagnostics

**Files:**
- Modify: `lib/ada-audit/runner.ts` — the `if (!response.ok())` branch's `throw new Error(\`HTTP ${status} — ${response.statusText()}\`)`

- [ ] **Step 1: Update the fallback throw**

Find the line (around runner.ts:164):

```ts
throw new Error(`HTTP ${status} — ${response.statusText()}`)
```

Replace with a 3xx-aware branch *before* the generic throw. Insert just before the existing line:

```ts
if (status >= 300 && status < 400) {
  const finalUrl = response.url()
  const location = response.headers()['location'] ?? null
  const detail = location
    ? `Redirected to ${location} (final URL was ${finalUrl}); puppeteer did not auto-follow`
    : `Server returned ${status} with no Location header (final URL: ${finalUrl})`
  throw new Error(`HTTP ${status} — ${detail}`)
}
```

This converts both 301-with-empty-statusText errors (bidwelltraining.edu, cw.edu) into actionable messages naming the redirect target and the final URL puppeteer landed on.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): include redirect Location + final URL in 3xx errors

The previous error shape on a 3xx response with empty statusText surfaced
as "HTTP 301 — " (literal trailing space), which gave the operator nothing
to act on. The new shape includes the redirect Location header and the
final URL puppeteer landed on, converting two 2026-05-21-run errors into
diagnosable cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.2: Schema migration for `pdfsSkipped` + `skipReason`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Update the schema**

In `prisma/schema.prisma`, add `pdfsSkipped Int @default(0)` to the `SiteAudit` model alongside the existing `pdfsTotal` / `pdfsComplete` / `pdfsError`:

```prisma
model SiteAudit {
  // ...existing fields...
  pdfsTotal     Int        @default(0)
  pdfsComplete  Int        @default(0)
  pdfsError     Int        @default(0)
  pdfsSkipped   Int        @default(0)   // NEW — oversize, unsupported-format, etc.
  // ...
}
```

And add `skipReason String?` to the `PdfAudit` model:

```prisma
model PdfAudit {
  // ...existing fields...
  status       String     // pending | scanning | complete | error | skipped
  issues       String?
  scanError    String?
  skipReason   String?    // NEW — populated when status === 'skipped'
  // ...
}
```

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name pdf-skipped-status`
Expected: migration file created under `prisma/migrations/<ts>_pdf_skipped_status/`; Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(ada-audit): add pdfsSkipped + PdfAudit.skipReason to schema

Prepares for PDF oversize handling to surface as a neutral 'skipped'
status (with reason) rather than a red error. Production migration
runs via prisma migrate deploy in the deploy script.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.3: Type-system + persistence layer for the new `skipped` status

Before touching the runner, get the type-and-data layer right so the rest of the changes typecheck cleanly. This task must land in a single commit because the type union expansion will produce compile errors anywhere `PdfAuditStatus` is exhaustively switched on until every consumer is updated.

**Files:**
- Modify: `lib/ada-audit/types.ts`
- Modify: `lib/ada-audit/pdf-types.ts` (if it exists in your tree — `pdf-runner.ts` returns a `PdfScanResult` shape that the orchestrator persists; that shape must carry `skipReason` and signal terminal intent so the orchestrator can decrement counters correctly)
- Modify: `lib/ada-audit/pdf-runner.ts` — oversize branch

- [ ] **Step 0: Locate `PdfScanResult` and its consumers**

Run: `grep -rn "PdfScanResult\b" lib/ada-audit --include="*.ts"`

If the type lives in `lib/ada-audit/pdf-types.ts` (or any file other than `types.ts`), extend it there. The shape needs an optional `skipReason: PdfSkipReason` and the consumer (likely `pdf-orchestrator.ts` or whatever persists the result) needs to write `status: 'skipped'` + `skipReason` when the runner returns a skipped result. If `PdfScanResult` does not exist as a discrete type — i.e. `pdf-runner.ts` writes directly to Prisma — Step 2 covers that path and Step 0 is a no-op.

- [ ] **Step 1: Update `types.ts`**

Find the PdfAudit status union and extend it:

```ts
// Before:
export type PdfAuditStatus = 'pending' | 'scanning' | 'complete' | 'error'
// After:
export type PdfAuditStatus = 'pending' | 'scanning' | 'complete' | 'error' | 'skipped'
```

Update `SiteAuditPdfAggregate` (search for it; current shape is `{ total, complete, errored, withIssues }`):

```ts
export interface SiteAuditPdfAggregate {
  total: number
  complete: number
  errored: number
  skipped: number       // NEW
  withIssues: number
}
```

Document `skipReason` as a string slug (currently `'oversize'` is the only value, but plan a tiny union):

```ts
export type PdfSkipReason = 'oversize'
```

- [ ] **Step 2: Update `pdf-runner.ts` oversize branch**

Search `pdf-runner.ts` for the existing oversize cap check (string `26214400` or the cap constant). Where it currently sets `status: 'error', scanError: 'PDF exceeds ...'`, replace with:

```ts
status: 'skipped',
skipReason: 'oversize',
scanError: null,
```

- [ ] **Step 3: Typecheck (expect errors)**

Run: `npx tsc --noEmit`
Expected: errors in finalizer / orchestrator / API routes because consumers don't know about `'skipped'`. The next task fixes them.

- [ ] **Step 4: Do not commit yet** — the codebase compiles only after the next task.

### Task 3.4: Orchestrator + finalizer drain math

**Files:**
- Modify: `lib/ada-audit/pdf-orchestrator.ts` (read the file first to confirm name — it may be `pdf-queue.ts` or similar)
- Modify: `lib/ada-audit/site-audit-finalizer.ts`
- Modify: `lib/ada-audit/site-audit-helpers.ts`

The risk this task closes: a skipped PDF row leaves the finalizer's `pdfsDone` predicate false forever, wedging the site audit in `pdfs-running`.

- [ ] **Step 1: Find the `pdfsDone` predicate in `site-audit-finalizer.ts`**

Search for either a `pdfsDone` variable or a condition shaped like `pdfsComplete + pdfsError >= pdfsTotal`. There are likely two locations: the in-memory aggregate computation and a Prisma-counted variant. Update both:

```ts
// Before:
const pdfsDone = (pdfsComplete + pdfsError) >= pdfsTotal
// After:
const pdfsDone = (pdfsComplete + pdfsError + pdfsSkipped) >= pdfsTotal
```

- [ ] **Step 2: Update the orchestrator's "in-flight" counter**

In whichever file owns the PDF scan loop (search the project for `pdf-orchestrator`, `pdfQueue`, or `scanPdf` callers), `'skipped'` must be treated as terminal alongside `'complete'` and `'error'`. Find the spot that decrements an "in-flight" / "remaining" counter and add `'skipped'` to the same branch.

- [ ] **Step 3: Update `buildSiteAuditSummary` in `site-audit-helpers.ts`**

```ts
const pdfsAggregate = {
  total:      pdfs.length,
  complete:   pdfs.filter((p) => p.status === 'complete').length,
  errored:    pdfs.filter((p) => p.status === 'error').length,
  skipped:    pdfs.filter((p) => p.status === 'skipped').length,
  withIssues: pdfs.filter((p) => p.status === 'complete' && (p.issues?.length ?? 0) > 0).length,
}
```

And where the SiteAudit row's `pdfsError` is computed, also write `pdfsSkipped`:

```ts
data: {
  pdfsComplete: pdfsAggregate.complete,
  pdfsError:    pdfsAggregate.errored,
  pdfsSkipped:  pdfsAggregate.skipped,  // NEW
  // ...
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (or remaining errors are in API routes / poller — Task 3.5).

### Task 3.5: API routes + queue/poller surfaces

**Files:**
- Modify: `app/api/site-audit/[id]/route.ts`
- Modify: `app/api/site-audit/queue/route.ts` (and any other route that selects `pdfsError` from a SiteAudit row)
- Modify: `components/ada-audit/SiteAuditPoller.tsx` (and `SiteAuditForm.tsx` if it surfaces a queue banner with PDF counts)

- [ ] **Step 1: Find every API select that lists `pdfsTotal | pdfsComplete | pdfsError`**

Run: `grep -rn "pdfsError\b" app/api lib --include="*.ts"`

For each select, add `pdfsSkipped: true`. For each shape returned to the client (probably `SiteAuditDetail` or similar in `lib/ada-audit/types.ts`), add `pdfsSkipped: number`.

- [ ] **Step 2: Update the poller**

In `SiteAuditPoller.tsx`, find where "X of Y PDFs scanned" or equivalent is rendered. Surface skipped explicitly so the operator sees:

```tsx
{pdfsTotal > 0 && (
  <>
    {pdfsComplete + pdfsError} of {pdfsTotal} PDFs scanned
    {pdfsSkipped > 0 && <span className="text-navy/50 dark:text-white/50"> · {pdfsSkipped} skipped</span>}
  </>
)}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean across the whole project.

### Task 3.6: Tests for the skipped path

**Files:**
- Modify: `lib/ada-audit/pdf-runner.test.ts`
- Modify: `lib/ada-audit/site-audit-finalizer.test.ts`
- Modify: `lib/ada-audit/site-audit-helpers.test.ts`

- [ ] **Step 1: Add a `pdf-runner.test.ts` case for oversize**

```ts
it('writes status=skipped with skipReason=oversize when a PDF exceeds the cap', async () => {
  // Use the existing fixture pattern — stub the fetch so the size header
  // is 30 MiB. Assert: row updated, status === 'skipped', skipReason === 'oversize',
  // scanError === null.
})
```

(The exact shape depends on how `pdf-runner.test.ts` currently stubs the fetch. Read the file first.)

- [ ] **Step 2: Add a `site-audit-finalizer.test.ts` case**

```ts
it('treats skipped PDFs as terminal — site flips to complete when only skipped + complete remain', async () => {
  // Construct a fixture with: 2 complete PDFs, 1 skipped PDF, 0 error PDFs,
  // 0 pending PDFs. Assert: finalizeSiteAudit() flips the parent to complete,
  // not pdfs-running.
})

it('counts skipped separately from errored in the summary', async () => {
  // Assert summary.pdfsAggregate.skipped === 1 and pdfsAggregate.errored === 0
  // for the same fixture.
})
```

- [ ] **Step 3: Update any existing assertion**

If an existing test asserts `status === 'error'` on a 30+ MiB PDF fixture, change to `status === 'skipped'`. If a test counts `pdfsError` on a fixture that includes a skipped row, recheck the expected value.

- [ ] **Step 4: Run all updated tests**

Run: `npx vitest run lib/ada-audit/pdf-runner.test.ts lib/ada-audit/site-audit-finalizer.test.ts lib/ada-audit/site-audit-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the entire 3.3 → 3.6 chain in ONE commit**

Because Task 3.3 leaves the codebase un-compilable on its own, all of 3.3 + 3.4 + 3.5 + 3.6 land in a single commit.

```bash
git add lib/ada-audit/types.ts lib/ada-audit/pdf-runner.ts lib/ada-audit/pdf-orchestrator.ts \
        lib/ada-audit/site-audit-finalizer.ts lib/ada-audit/site-audit-helpers.ts \
        app/api/site-audit/ components/ada-audit/SiteAuditPoller.tsx \
        lib/ada-audit/pdf-runner.test.ts lib/ada-audit/site-audit-finalizer.test.ts \
        lib/ada-audit/site-audit-helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): surface oversize PDFs as skipped, not errored

Introduces a 'skipped' terminal status for PdfAudit with a typed
skipReason ('oversize' only for now). Hits every coupling point:

- type-union expansion (PdfAuditStatus, PdfSkipReason, SiteAuditPdfAggregate)
- pdf-runner.ts oversize branch persists skipped + reason instead of error
- pdf-orchestrator decrements in-flight on skipped (was wedging finalizer)
- site-audit-finalizer's pdfsDone predicate counts complete+error+skipped
- buildSiteAuditSummary aggregates and writes pdfsSkipped to SiteAudit
- API selects include pdfsSkipped; SiteAuditPoller renders "N skipped" footnote
- tests cover the skipped persistence, finalizer drain math, and aggregate

Historical 'error' rows for oversize PDFs are not retro-migrated — operators
re-run the audit if they want the new neutral pill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.7: Update PDF list UI to render skipped pill

**Files:**
- Modify: `components/ada-audit/PdfList.tsx` (or whichever component renders the per-PDF row)

- [ ] **Step 1: Locate the status pill**

Search the component for the existing status pill that renders `complete` / `error`. Add a new branch for `skipped`:

```tsx
{pdf.status === 'skipped' && (
  <span className="inline-flex items-center text-[11px] font-body px-2 py-0.5 rounded border bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-white/60 border-gray-200 dark:border-white/10">
    Skipped{pdf.skipReason ? ` — ${pdf.skipReason}` : ''}
  </span>
)}
```

The existing aggregate counter (e.g., "X of Y PDFs scanned") should also be updated to reflect skipped separately. Read the file first to find the exact spot.

- [ ] **Step 2: Verify in browser**

Run: `npm run dev` and open a site audit result that has an oversize PDF (or stub one locally by editing a row to `status: 'skipped'`, `skipReason: 'oversize'`). Confirm the pill renders gray, not red.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/PdfList.tsx
git commit -m "$(cat <<'EOF'
feat(ada-audit): render skipped PDF status as neutral pill

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.8: Build, push, deploy, verify

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Push and deploy**

Run: `git push && ssh $PROD_SSH "~/deploy.sh"`
Expected: migration runs (`pdf-skipped-status`); PM2 restart succeeds.

- [ ] **Step 3: Verify on prod**

Open an existing site-audit result that includes an oversize PDF (cambriacollege.ca or federico.edu from the 2026-05-21 run). After the migration the existing row still has `status: 'error'`. Either:
- Re-run the audit for that site (the new oversize check will write `status: 'skipped'`).
- Or accept that historical rows show the legacy state and only new audits surface the skipped pill.

---

---

## Phase 4 — Browser-based sitemap fetch fallback

When all `safeFetch` (Node fetch) candidates return non-2xx, the site may be behind a CDN/WAF that blocks our server's IP/TLS fingerprint while accepting real browser requests. Verified manually for beal.edu: curl returns 403 on both `/` and `/sitemap_index.xml`, but the same URLs load fine in a desktop browser. Falling back to Puppeteer for one final attempt unlocks these clients without requiring a manual-seed UI.

### Task 4.1: Create `sitemap-crawler-browser-fetch.ts` helper with own SSRF interception

**Files:**
- Create: `lib/ada-audit/sitemap-crawler-browser-fetch.ts`
- Test: `lib/ada-audit/sitemap-crawler-browser-fetch.test.ts`

The helper enables its own request-interception layer because **the runner's interception is per-runAudit() and not inherited**. Without this, an attacker could craft a sitemap URL that redirects to internal IPs (e.g., the EC2 metadata service or a private RDS instance) and the helper would happily fetch it.

- [ ] **Step 1: Write the failing tests first**

```ts
// lib/ada-audit/sitemap-crawler-browser-fetch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock browser-pool BEFORE importing the helper.
vi.mock('./browser-pool', () => ({
  acquirePage: vi.fn(),
  releasePage: vi.fn().mockResolvedValue(undefined),
}))

// Mock safe-url so we control which URLs the helper considers safe.
vi.mock('../security/safe-url', () => ({
  assertSafeHttpUrl: vi.fn(),
}))

import { fetchSitemapViaBrowser } from './sitemap-crawler-browser-fetch'
import { acquirePage, releasePage } from './browser-pool'
import { assertSafeHttpUrl } from '../security/safe-url'

function makeFakePage(overrides: Partial<{ status: number; body: string; headers: Record<string,string>; }> = {}) {
  const status = overrides.status ?? 200
  const body = overrides.body ?? '<?xml version="1.0"?><urlset><url><loc>https://x.example/</loc></url></urlset>'
  const headers = overrides.headers ?? { 'content-type': 'application/xml' }
  const requestHandlers: Array<(req: unknown) => void> = []
  return {
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    setDefaultNavigationTimeout: vi.fn(),
    on: vi.fn((event: string, fn: (req: unknown) => void) => {
      if (event === 'request') requestHandlers.push(fn)
    }),
    goto: vi.fn().mockResolvedValue({
      ok: () => status >= 200 && status < 300,
      status: () => status,
      headers: () => headers,
      text: vi.fn().mockResolvedValue(body),
    }),
    _emitRequest: (req: unknown) => requestHandlers.forEach((fn) => fn(req)),
  }
}

beforeEach(() => {
  vi.mocked(assertSafeHttpUrl).mockReset()
  vi.mocked(acquirePage).mockReset()
  vi.mocked(releasePage).mockReset().mockResolvedValue(undefined)
})

describe('fetchSitemapViaBrowser', () => {
  it('returns null when the URL fails the SSRF check (no page is acquired)', async () => {
    vi.mocked(assertSafeHttpUrl).mockRejectedValue(new Error('SSRF: private IP'))
    const result = await fetchSitemapViaBrowser('http://10.0.0.1/sitemap.xml')
    expect(result).toBeNull()
    expect(acquirePage).not.toHaveBeenCalled()
  })

  it('returns the XML body when the page returns a valid sitemap', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined)
    const page = makeFakePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://beal.edu/sitemap_index.xml')
    expect(result).toMatch(/^<\?xml/)
    expect(releasePage).toHaveBeenCalledWith(page)
  })

  it('enables request interception on the page (defense in depth)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined)
    const page = makeFakePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    await fetchSitemapViaBrowser('https://beal.edu/sitemap.xml')
    expect(page.setRequestInterception).toHaveBeenCalledWith(true)
    expect(page.on).toHaveBeenCalledWith('request', expect.any(Function))
  })

  it('rejects responses whose root is not a sitemap (anchored regex prevents WAF-interstitial false-match)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined)
    const page = makeFakePage({
      body: '<html><body>Access denied. Embedded <urlset> mention in error text.</body></html>',
      headers: { 'content-type': 'text/html' },
    })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://blocked.example/sitemap.xml')
    expect(result).toBeNull()
  })

  it('accepts XML declared as text/html when the body root matches', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined)
    const page = makeFakePage({
      body: '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://x.example/sm.xml</loc></sitemap></sitemapindex>',
      headers: { 'content-type': 'text/html; charset=utf-8' },  // misdeclared
    })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://misdeclare.example/sitemap.xml')
    expect(result).not.toBeNull()
    expect(result).toMatch(/<sitemapindex/)
  })

  it('returns null when the response is non-OK (e.g., 403 from the WAF on browser too)', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined)
    const page = makeFakePage({ status: 403 })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://still-blocked.example/sitemap.xml')
    expect(result).toBeNull()
  })

  it('rejects bodies larger than MAX_XML_BYTES', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined)
    const huge = '<?xml version="1.0"?><urlset>' + 'X'.repeat(6_000_000) + '</urlset>'
    const page = makeFakePage({ body: huge })
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://huge.example/sitemap.xml')
    expect(result).toBeNull()
  })

  it('releases the page even if goto throws', async () => {
    vi.mocked(assertSafeHttpUrl).mockResolvedValue(undefined)
    const page = makeFakePage()
    page.goto = vi.fn().mockRejectedValue(new Error('Navigation timeout'))
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    const result = await fetchSitemapViaBrowser('https://times-out.example/sitemap.xml')
    expect(result).toBeNull()
    expect(releasePage).toHaveBeenCalled()
  })

  it('aborts an intercepted redirect/subrequest that fails SSRF revalidation', async () => {
    // First call validates the top-level URL (safe). Subsequent calls
    // simulate intercepted redirect/subresource URLs failing the SSRF check
    // (e.g. a redirect to 169.254.169.254). The fake page captures the
    // handler and we drive a fake request through it.
    const safeUrl = 'https://beal.edu/sitemap_index.xml'
    const unsafeRedirect = 'http://169.254.169.254/latest/meta-data/'
    vi.mocked(assertSafeHttpUrl).mockImplementation(async (u) => {
      if (typeof u === 'string' && u.includes('169.254.169.254')) throw new Error('SSRF: private IP')
    })

    const page = makeFakePage()
    vi.mocked(acquirePage).mockResolvedValue(page as never)
    await fetchSitemapViaBrowser(safeUrl)

    // Drive a fake unsafe redirect through the captured handler:
    const fakeReq = {
      url: () => unsafeRedirect,
      isInterceptResolutionHandled: () => false,
      continue: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    }
    await page._emitRequest(fakeReq)
    // Allow the async handler to settle
    await new Promise((r) => setImmediate(r))

    expect(fakeReq.abort).toHaveBeenCalledWith('blockedbyclient')
    expect(fakeReq.continue).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ada-audit/sitemap-crawler-browser-fetch.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

```ts
// lib/ada-audit/sitemap-crawler-browser-fetch.ts
import type { HTTPRequest, Page } from 'puppeteer-core'
import { acquirePage, releasePage } from './browser-pool'
import { assertSafeHttpUrl } from '../security/safe-url'

const FETCH_TIMEOUT = 20_000
const MAX_XML_BYTES = 5_000_000

// Anchored at the document root so WAF interstitial HTML pages that happen
// to contain <urlset> somewhere in the body don't false-match.
const SITEMAP_ROOT_RE = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)?<(urlset|sitemapindex)\b/i

/**
 * Browser-based fallback for fetching a sitemap when Node's fetch is being
 * 403'd by a CDN/WAF. Owns its own request-interception layer for SSRF
 * defense — the runner's interception is per-runAudit() and not inherited.
 * Returns null on any failure; caller surfaces.
 */
export async function fetchSitemapViaBrowser(url: string): Promise<string | null> {
  try {
    await assertSafeHttpUrl(url)
  } catch {
    return null
  }

  let page: Page | undefined
  try {
    page = await acquirePage()
    page.setDefaultNavigationTimeout(FETCH_TIMEOUT)

    // Own SSRF interception. Every request the browser makes during this
    // navigation (including redirects and subresources) revalidates through
    // assertSafeHttpUrl, just like the runner does.
    await page.setRequestInterception(true)
    page.on('request', (request: HTTPRequest) => {
      void (async () => {
        try {
          await assertSafeHttpUrl(request.url())
          if (!request.isInterceptResolutionHandled()) {
            await request.continue()
          }
        } catch {
          if (!request.isInterceptResolutionHandled()) {
            await request.abort('blockedbyclient').catch(() => {})
          }
        }
      })()
    })

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT })
    if (!response || !response.ok()) return null

    const text = await response.text().catch(() => null)
    if (!text) return null
    if (text.length > MAX_XML_BYTES) return null
    if (!SITEMAP_ROOT_RE.test(text)) return null
    return text
  } catch {
    return null
  } finally {
    if (page) await releasePage(page).catch(() => {})
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ada-audit/sitemap-crawler-browser-fetch.test.ts`
Expected: PASS (9/9)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/sitemap-crawler-browser-fetch.ts lib/ada-audit/sitemap-crawler-browser-fetch.test.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): browser-based sitemap fetch helper with own SSRF guard

When Node's fetch is being 403'd by a CDN/WAF (verified on beal.edu),
fall back to a Puppeteer fetch that benefits from Chrome's TLS handshake
and a normal navigator profile. Critically, the helper enables its OWN
request-interception layer to revalidate every redirect/subresource
through assertSafeHttpUrl — the runner's interception is per-runAudit
and not inherited.

Sitemap-root regex is anchored so WAF interstitial HTML pages that
mention <urlset> in error text don't false-match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.2: Wire the fallback into `sitemap-crawler.ts`

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts`

- [ ] **Step 1: Add the import**

```ts
import { fetchSitemapViaBrowser } from './sitemap-crawler-browser-fetch'
```

- [ ] **Step 2: Insert the fallback after the existing safeFetch loop**

Currently the candidate loop (around `sitemap-crawler.ts:257-266`) breaks as soon as one candidate returns XML. The fallback runs **only** when the loop drained without yielding URLs AND the shallow crawl also returned nothing. Find the existing block:

```ts
// 4. If no sitemap yielded pages, fall back to shallow crawl
if (allPageUrls.length === 0) {
  const crawledPages = await shallowCrawl(base, normDomain)
  if (crawledPages.length === 0) {
    throw new Error(
      `No sitemap found and shallow crawl found 0 pages on ${normDomain}`
    )
  }
  return crawledPages
}
```

Replace with:

```ts
// 4. If no sitemap yielded pages, try shallow crawl
if (allPageUrls.length === 0) {
  const crawledPages = await shallowCrawl(base, normDomain)
  if (crawledPages.length > 0) return crawledPages

  // 4b. Browser fallback — safeFetch was 403'd by CDN/WAF; try via Puppeteer.
  // Reuses the candidate list from step 2 so we don't re-derive it.
  for (const sitemapUrl of uniqueCandidates) {
    const xml = await fetchSitemapViaBrowser(sitemapUrl)
    if (!xml) continue
    const urls = await collectFromSitemap(xml, normDomain)
    if (urls.length > 0) {
      allPageUrls = urls
      break
    }
  }

  if (allPageUrls.length === 0) {
    throw new Error(
      `No sitemap found on ${normDomain} (tried direct fetch and browser fallback) and shallow crawl found 0 pages`
    )
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run existing sitemap-crawler tests if any**

Run: `npx vitest run lib/ada-audit/sitemap`
Expected: all existing tests pass (the fallback only runs in the previously-throwing path).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/sitemap-crawler.ts
git commit -m "$(cat <<'EOF'
feat(ada-audit): browser-fetch fallback when sitemap candidates 403

When safeFetch returns null for every candidate AND the shallow crawl
also returns nothing, retry the same candidates via Puppeteer using
fetchSitemapViaBrowser. Unlocks sites where the CDN/WAF 403s direct
fetch but accepts real Chrome (beal.edu is the verified case).

The fallback runs only as a last resort — adds <2s to discovery on
sites that were already going to fail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.3: Build, push, deploy, verify

- [ ] **Step 1: Build + push + deploy**

```bash
npm run build && git push && ssh $PROD_SSH "~/deploy.sh"
```

- [ ] **Step 2: Verify on beal.edu**

Open the site audit form on prod and queue an audit for `beal.edu`. Acceptance criterion: discovery succeeds and the audit enters the `queued`/`running` phases. The follow-on page-level audits may still surface WAF-block errors on individual pages — that's a separate problem the per-page runner already handles gracefully.

If discovery still fails, capture the new error message and stop. Two likely failure modes:
1. The WAF blocks puppeteer too (would surface as `response.status() === 403`). Mitigation: would need a higher-fidelity browser fingerprint, or accept that this site is unreachable from this infra.
2. The XML body is served as text/html and our sniff rejects it. Mitigation: relax the content-type check or add a parser-tolerant fallback. Decide based on what the actual response looks like.

---

## Open follow-ups (out of scope)

| Item                                                      | Rationale for deferral                                                                                                                                          |
|-----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Manual seed-URL path for no-sitemap sites (beal.edu etc.) | 2 sites affected. Designing this without more sample data risks over-engineering. Revisit after at least 5 more no-sitemap cases accumulate.                    |
| Env-configurable PDF size cap                             | 2/391 PDFs hit cap. Raising the cap risks OOM on the 3.8 GiB VPS; lowering it provides no value. Make configurable only if a paying client request emerges.     |
| Per-domain audit-throttling for sites that produce many timeouts | Premature optimization. Phase 1 already removes the dominant cost. Revisit if a single bad site dominates queue time after Phase 1+2 ship.                    |
| Surfacing the noise-blocklist behavior in the per-page results UI | Worth doing for operator-trust reasons but cosmetic. Add a "Scan suppressed N known-noise requests" footnote on the per-page result view in a separate small PR.|

---

## Self-review against the spec

| Spec section            | Plan task(s)                                              |
|-------------------------|-----------------------------------------------------------|
| Decision 1 (DCL+settle) | Task 1.1 (helper) + 1.2 (wire) + 1.3 (CLAUDE.md)          |
| Decision 2 (blocklist)  | Task 2.1 (module) + 2.2 (wire)                            |
| Decision 3 (retry)      | Task 2.5 (predicate) + 2.6 (wire)                         |
| Decision 4 (cache)      | Task 2.3 (browser-pool) + 2.4 (304 retry)                 |
| Decision 5 (3xx)        | Task 3.1                                                  |
| Decision 6 (PDF skip)   | Task 3.2 (schema) + 3.3 (types/runner) + 3.4 (orchestrator/finalizer) + 3.5 (API/poller) + 3.6 (tests) + 3.7 (UI pill) + 3.8 (verify) |
| Decision 7 (browser fallback) | Task 4.1 (helper + own SSRF + tests) + 4.2 (wire) + 4.3 (verify on beal.edu) |
| Deferred items          | Listed under "Open follow-ups"                            |
