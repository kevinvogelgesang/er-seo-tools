# ADA Audit — Runner Robustness — Design Spec

**Date:** 2026-05-22
**Status:** Approved for implementation planning
**Companion plan:** `docs/superpowers/plans/2026-05-22-audit-runner-robustness.md`

## Goal

Make the per-page audit runner survive the kinds of pages that exist in real client sites — analytics-heavy WordPress builds with chat widgets, ad pixels, cookie-banner replays, and conditional redirects — without producing thousands of per-page errors. Reduce the page-level error rate from the current 24% (1138 / 4737) to under 2% on the same site set.

## Why now

The 2026-05-21 queue-wide run produced 1138 page errors across 31 sites. 99.1% of those errors are a single class — puppeteer `Navigation timeout of 30000 ms exceeded` — and 99% of those (1127 of 1128) come from just two sites: `soma.edu` (833) and `prismcareerinstitute.edu` (294). The catastrophic-issue monitor fired zero times in 8h42m of runtime — no OOM, no Chrome crashes, no PM2 restarts — so the system is stable; this is a content-handling robustness problem, not an infra problem.

The dominant root cause: `lib/ada-audit/runner.ts:142` uses `waitUntil: 'networkidle2'` as a hard precondition for `page.goto()` success. `networkidle2` requires ≤2 in-flight network connections for ≥500ms. On sites with Google Tag Manager, Google Analytics, Hotjar, Intercom, chat widgets, ad pixels, etc., poll-style XHR and beacon traffic never quiets, so `networkidle2` never fires before the 30 s timeout — even though the DOM has been usable for axe-core since the first ~3 s.

The audit run also confirmed the system can produce ~16 successful page-scans per minute and stays stable for 8+ hours. So the goal is not throughput or scale — it is making the runner robust to pages that healthy production sites legitimately serve.

## Why this matters product-wise

Today, when a client site produces 80+ "Navigation timeout" errors, the operator sees a Pages-with-Issues table dominated by error rows that hide the actual accessibility violations on the (many) pages that did scan successfully. The recommendation card we just shipped (PR #24) is also less useful because the "common-issue" detector excludes errored pages from its denominator — fewer scanned pages means fewer template-wide signals surfaced. Fixing the runner unlocks both the per-page results and the cross-page synthesis.

## Non-goals

- Not changing axe-core, the score formula, the queue manager, the browser pool size, or the Lighthouse pipeline.
- Not adding a UI affordance for operators to tune per-audit timeouts — the right default solves >99% of cases.
- Not building a "manual seed URLs" path for sites where sitemap discovery fails (deferred — only 2 sites affected, design recorded under Deferred).
- Not introducing a request-cache layer or persistent service-worker state — we explicitly want each page-load to be cache-cold (see Phase 3).
- Not retrying every error class — retry is reserved for the two transient classes (`Navigation timeout`, `Navigating frame was detached`) where evidence suggests one retry recovers.

## Problem inventory

Full classification of the 1138 page errors plus 3 PDF errors plus 2 site-level errors from the run window (`2026-05-21T15:57:06Z` → `2026-05-22T00:38:44Z`):

| Class                                  | Count | Concentration                                                          | Cause                                                                                          |
|----------------------------------------|------:|------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| Navigation timeout 30000 ms            |  1128 | soma.edu 833 · prismcareerinstitute.edu 294 · nuvani.edu 1             | `networkidle2` never settles because of 3rd-party poll traffic                                 |
| HTTP 403 — site blocking scanners      |     2 | brockwaycatart.org 2                                                   | External — site has bot-block / firewall rule; tool cannot fix                                 |
| HTTP 304 Not Modified                  |     2 | discoverycommunitycollege.com 1 · suttercountyctc.edu 1                | Chrome served a conditional-validator response; runner errors instead of refetching            |
| HTTP 301 — empty statusText            |     2 | bidwelltraining.edu 1 · cw.edu 1                                       | Final main-resource response was a 301 (puppeteer follows other 3xx but stopped on this one)   |
| HTTP 404                               |     1 | penrose.edu                                                            | External — page genuinely missing                                                              |
| HTTP 500                               |     1 | cw.edu                                                                 | External — page genuinely 5xx (already retried once via `gotoWithRetryOn5xx`)                  |
| Navigating frame was detached          |     1 | nuvani.edu (manual re-scan reproduced this on another nuvani.edu page) | Page does `location.replace` or top-frame replacement mid-load                                 |
| net::ERR_CERT_VERIFIER_CHANGED         |     1 | soma.edu                                                               | Chrome internal cert verifier state change; transient, recovers on retry                       |
| PDF exceeds 26214400-byte cap (×2)     |     2 | cambriacollege.ca 1 · federico.edu 1                                   | PDF >25 MiB hits hard size cap                                                                 |
| PDF HTTP 404                           |     1 | innovatesalonacademy.com                                               | External — PDF link is dead                                                                    |
| Site: discovery blocked by WAF (403)   |     1 | beal.edu                                                               | CDN/WAF returns 403 to safeFetch (Node fetch) on both `/` and `/sitemap_index.xml`. Sitemap loads fine in a real browser. Same root cause as the per-page 403s, just at the discovery stage. |
| Site: domain offline                   |     1 | wellspring.edu                                                         | Site offline / decommissioned — Kevin to remove from clients out-of-band                       |

**Implication of concentration:** the top class (nav-timeout) is 99.1% of all page errors. The next 7 classes combined are 10 errors. Even a partial fix on the timeout class moves the needle far more than perfect fixes on every other class.

## Design decisions

### Decision 1 — Replace `networkidle2` as a hard gate with `domcontentloaded` + bounded best-effort settle

Source: Codex pushed back on the obvious "retry with looser wait condition on timeout" approach because that strategy spends the full 30 s on every bad page first, before retrying. With 1128 affected pages that is ~9.4 hours of wasted audit time per queue-wide run. The right fix is to make `networkidle2` non-fatal in the first place.

The new navigation shape in `runner.ts` (and `page-load.ts`):

```ts
// runner.ts — new navigation block (replaces line 138-150)
let response: HTTPResponse | null
try {
  response = await gotoWithRetryOn5xx(
    page,
    parsed.toString(),
    { waitUntil: 'domcontentloaded', timeout: 30_000 },
    async () => { await progress(22, 'Retrying (upstream 5xx)…') },
  )
  // Settle stays *inside* the try so that frame-detached or other failures
  // during the settle surface as the navigation error (which is then visible
  // to the Phase 2 transient-retry layer). The postLoadSettle helper itself
  // only swallows the `waitForNetworkIdle` timeout, not other rejections.
  await postLoadSettle(page)
} catch (err) {
  if (blockedNavigationError) throw blockedNavigationError
  throw err
}
```

**Worst case waste per "bad" page drops from 30 s to ~3–8 s** (DCL fires within ~3 s on healthy pages; the 5 s settle is the upper bound on the grace period). Healthy pages (the 3599 we already scan successfully) are not slowed down — DCL fires earlier than `networkidle2` did, and the post-DCL settle terminates as soon as the network actually quiets.

**Trade-off:** `waitForNetworkIdle` failure no longer surfaces an error. If a page is genuinely server-broken in a way that prevents DCL itself, the 30 s DCL timeout still fires and is still a real error. Pages that DCL fine but never network-idle (the entire problem class today) become scanable.

### Decision 2 — Conservative scanner-noise request blocking

`page.setRequestInterception(true)` is already on in `runner.ts:113`. The existing handler only enforces SSRF safety (`assertSafeHttpUrl`). We extend it with a narrow allow-by-default / block-known-noise filter for third-party hosts whose only job is to send beacons.

The blocklist lives in a new file `lib/ada-audit/scanner-noise.ts` and is **explicit and documented**, not a regex. We block:

- Tag management & analytics: `googletagmanager.com`, `www.google-analytics.com`, `analytics.google.com`, `region1.google-analytics.com`, `region1.analytics.google.com`, `stats.g.doubleclick.net`, `www.googleadservices.com`, `googlesyndication.com`, `doubleclick.net`
- Ad pixels & retargeting: `bat.bing.com`, `analytics.tiktok.com`, `analytics.pinterest.com`, `ct.pinterest.com`, `px.ads.linkedin.com`, `snap.licdn.com`
- **Explicitly NOT blocked:** `connect.facebook.net` (FB SDK can power accessibility-relevant login widgets) and Intercom (chat may be the only "Contact us" affordance on a page). The post-DCL settle plus the 5 s timeout already make these non-fatal — there's no throughput need to block them.
- Session-replay / heatmaps: `static.hotjar.com`, `script.hotjar.com`, `vc.hotjar.io`, `cdn.mouseflow.com`, `rs.fullstory.com`, `edge.fullstory.com`, `app.clarity.ms`, `www.clarity.ms`, `script.crazyegg.com`
- Chat / support widgets (non-Intercom): `js.driftt.com`, `js.usemessagely.com`, `embed.tawk.to`, `cdn.livechatinc.com`, `static.olark.com`
- WordPress.com telemetry: `stats.wp.com`, `pixel.wp.com`
- Error/perf telemetry that scanners often hit: `bam.nr-data.net`, `js-agent.newrelic.com` (debatable but most client sites use the legit SaaS, not these direct hosts)

We do **not** block first-party requests, fonts, images, CSS, or main HTML. We do **not** match by URL substring (too broad); we match by exact hostname-suffix using a `URL` parse — `host === entry || host.endsWith('.' + entry)`. The full hostname (including subdomain) is matched against the suffix list.

We also block `media` resource type (videos, audio) unconditionally — irrelevant to axe and a known throughput sink. This is a Puppeteer `resourceType()` check, not hostname-based.

**Risk accepted:** a small number of accessibility-relevant DOM nodes injected by a blocked analytics script (e.g. a cookie banner that only renders after GTM fires) will be missing from the scan. Codex flagged this; we judge the trade-off correct because the alternative is ~25% page-error rate. We document the blocklist's behavior in the runner's results UI so operators can interpret unexpected results.

### Decision 3 — Single-shot transient-error retry inside the runner

For the two error classes that empirical evidence suggests are recoverable on a fresh page:

- `Navigation timeout` on the new DCL gate (rare after Decision 1 + 2, but not zero)
- `Navigating frame was detached`
- `net::ERR_CERT_VERIFIER_CHANGED`

The runner retries once with a fresh page from the pool. This is **not** a generic retry layer — it is narrow to error patterns where evidence shows one retry usually succeeds. Implementation: catch in the runner's outer try, release the failing page back to the pool, acquire a new one, retry the navigation block once. Status code errors (`HTTP 4xx`, `HTTP 5xx`, `HTTP 304`) do NOT retry (already deterministic) except 5xx via existing `gotoWithRetryOn5xx`.

### Decision 4 — Cache + service-worker hardening + 304 fresh retry

Even though `--disable-http-cache` is set at browser launch (`browser-pool.ts:25`), 304 responses still surfaced (2 cases). Hardening the page itself closes the remaining vectors:

```ts
// On every page acquisition (in browser-pool.ts):
await page.setCacheEnabled(false)
await page.setBypassServiceWorker(true)  // not currently called anywhere
await page.setExtraHTTPHeaders({
  'Cache-Control': 'no-store, no-cache, max-age=0',
  'Pragma': 'no-cache',
})
```

Note on `Cache-Control` choice: `no-cache` alone still permits revalidation responses (i.e., 304s), which is the failure mode we're closing. `no-store, no-cache, max-age=0` rejects both cached responses and validator-only responses, so the page is guaranteed to receive a 200 with a body (or an explicit error).

And in `runner.ts`, the 304 branch becomes a one-shot fresh retry instead of an immediate error: navigate again with `Cache-Control: no-store` headers and a cache-busting query parameter (`?_=Date.now()`). If the second attempt also returns 304, surface the error.

### Decision 5 — Better 3xx diagnostics + optional single manual follow

When `response.ok()` returns false on a 3xx status (currently produces `HTTP 301 — ` with empty `statusText`):

- Include `Location` header (if present) and `response.url()` (the final URL puppeteer landed on) in the error message.
- If `Location` is set and resolves to a safe HTTPS URL via the existing `assertSafeHttpUrl()` helper, attempt one manual follow and use that response. Surface the original 3xx in the error only if the follow also fails.

This converts both 301 errors (bidwelltraining.edu, cw.edu) into either a successful scan or an actionable error message naming the redirect target.

### Decision 7 — Browser-based sitemap-fetch fallback

When `safeFetch` (Node's fetch) returns 403 (or any non-2xx that isn't a 404) on every sitemap candidate AND the shallow crawl also fails, we suspect a WAF block on our server's IP/TLS fingerprint. Real Chrome with a normal navigator handshake bypasses most of these blocks (verified manually for beal.edu — homepage is 403 to curl but loads cleanly in a browser).

We add a final fallback before throwing the "no pages discovered" error: acquire a page from the existing `browser-pool`, navigate to each sitemap candidate URL in turn, and read `response.text()` via puppeteer. We do NOT execute JS on the sitemap response — we just want Chrome's TLS + handshake to clear the WAF, then read the XML body. If the body parses as a sitemap, we hand it back to the existing collection logic.

Why this is correct (not a defeat for `safeFetch`):
- `safeFetch` still runs first for the 95% case. Puppeteer is expensive (~1 s of warmup vs ~50 ms for fetch).
- We're not bypassing SSRF — the URL is validated through `assertSafeHttpUrl` BEFORE page acquisition, AND the browser-fetch helper **enables its own request interception** (not inherited from the runner — the runner's setup is per-runAudit() and is not in scope here). Every request, including redirects and subresources Chrome makes during the navigation, runs through `assertSafeHttpUrl` again inside the helper's `handleRequest`. Failure to do this would let an attacker craft a sitemap URL that redirects to internal IPs.
- The fallback only runs when both the safeFetch loop AND the shallow crawl returned nothing — it does not slow down healthy sites.
- A hard upper bound: at most `uniqueCandidates.length` browser fetches (typically ≤4), each capped at 20 s, with `page.setDefaultNavigationTimeout(20_000)`. Worst-case latency on a fully blocked site: ~80 s, then we throw with a clear message.
- Failure modes are explicit: if the browser fetch also returns non-XML, we surface the original `safeFetch` error with `(browser fallback also failed)` appended so the operator knows we tried both.

XML sniff is anchored to the document root so we don't false-match WAF interstitial HTML that happens to contain `<urlset>` somewhere in the body:

```ts
/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)?<(urlset|sitemapindex)\b/i
```

Impact: unlocks beal.edu and any future CDN-blocked client without needing a manual-seed UI. The deferred manual-seed work stays deferred for the genuine "no sitemap exists" case (currently 0 known instances).

### Decision 6 — PDF oversize as skip, not error

The 25 MiB cap stays — loading larger PDFs into pdfjs on a 3.8 GiB VPS is a real risk. But the surfaced state changes from `error` to a new `skipped` status with reason `oversize`. The PDF section UI already groups by status; `skipped` rows render with a neutral pill instead of a red one. This affects 2 of 391 PDFs (0.5%) — purely a UX/trust improvement.

**Coupling that must be updated together** (otherwise finalization wedges in `pdfs-running`):

1. `prisma/schema.prisma` — add `pdfsSkipped Int @default(0)` to `SiteAudit`; add `skipReason String?` to `PdfAudit`.
2. `lib/ada-audit/types.ts` — extend `PdfAudit` status union and the `SiteAuditPdfAggregate` interface.
3. `lib/ada-audit/pdf-runner.ts` — the oversize branch persists `status: 'skipped', skipReason: 'oversize', scanError: null`.
4. `lib/ada-audit/pdf-orchestrator.ts` (or whichever module owns the orchestration loop — the engineer reads first) — must treat `skipped` as terminal alongside `complete` and `error` so `pdfsRunning` decrements correctly.
5. `lib/ada-audit/site-audit-finalizer.ts` — `pdfsDone` predicate must consider `complete + error + skipped` (otherwise a skipped PDF leaves the site stuck in `pdfs-running` forever).
6. `lib/ada-audit/site-audit-helpers.ts` — `buildSiteAuditSummary` writes the new `pdfsSkipped` counter; `pdfsAggregate` includes `skipped` field.
7. API selects in `app/api/site-audit/[id]/route.ts` and any related routes — include `pdfsSkipped` so the front-end can read it.
8. `components/ada-audit/SiteAuditPoller.tsx` (or whichever poller surfaces queue counts) — render skipped in the running counter so operators see "X of Y PDFs scanned (Z skipped)".
9. Tests: `lib/ada-audit/site-audit-finalizer.test.ts`, `lib/ada-audit/pdf-runner.test.ts`, `lib/ada-audit/site-audit-helpers.test.ts` — cover the skipped path in each.

Historical rows: legacy oversize PDFs persisted with `status: 'error'` stay as-is. No retro-migration. Operators who want to reclassify an old result can re-run the audit.

### Deferred — Manual seed-URL UI for genuine "no sitemap" cases

The 2026-05-21 run produced 2 site-level discovery errors. On investigation, **neither is actually a "no sitemap" case**:

- **beal.edu** has a working Yoast `sitemap_index.xml` — discovery failed because the CDN/WAF 403s every request from our server's IP. Decision 7 (browser-fetch fallback) addresses this directly.
- **wellspring.edu** is offline / decommissioned — Kevin to remove from clients out-of-band.

We therefore have **zero genuine "no sitemap" cases** in the dataset. A manual seed-URL UI is logged as a follow-up but not built. We revisit if at least 5 cases accumulate of sites where: (a) the WAF block is not the cause, (b) the site has no machine-readable sitemap, and (c) the shallow crawl finds nothing.

## Test strategy

Most of `runner.ts` is hard to unit-test directly because it owns a live Puppeteer page. The plan covers:

1. **Pure-function unit tests** (vitest) for `lib/ada-audit/scanner-noise.ts` (hostname matcher) and the new redirect-follow helper.
2. **Integration tests on a small fixture set** running against `prisma/local-dev.db` — verify the runner accepts a `domcontentloaded` navigation and continues past a 5 s settle timeout. We use `data:` URLs with controlled HTML for these; not real network.
3. **Manual verification matrix** documented in the plan — operator runs single-page audits against the three known-problem URLs:
   - `https://www.soma.edu/about-soma/` (representative of the nav-timeout class)
   - `https://nuvani.edu/blog/self-employment-vs-salon-work-pros-and-cons-for-future-nail-technicians/` (frame-detached repro from Kevin's manual re-scan)
   - `https://discoverycommunitycollege.com/programs/business/business-administration/` (304 repro)
   The acceptance criterion is "audit completes with a score, not an error" on all three.
4. **Re-run the queue-wide audit** against the same site list after Phase 1 + 2 ship. Expected: page error count drops from 1138 to <90 (the non-timeout classes plus residual).

## Rollout plan

Ship in three phases on the `main` branch with deploys between each so we can isolate the impact of each phase against a fresh queue-wide run:

- **Phase 1 — Navigation strategy change (Decision 1).** Smallest possible diff that lets us measure how much of the 1128-error class disappears with the strategy change alone. Expected impact: 900–1100 errors prevented.
- **Phase 2 — Scanner-noise blocklist + transient retry + cache hardening (Decisions 2, 3, 4).** Belt-and-braces for residuals; cache hardening fixes the 2 × 304s; transient retry catches the rare `cert_verifier_changed` and `frame_detached`. Expected impact: another ~30–100 errors prevented + observability win.
- **Phase 3 — UX surfaces (Decisions 5, 6).** Lowest-impact but high operator-trust wins: redirect diagnostics and PDF-oversize-as-skip. Expected impact: 5 status messages improved, no count change.
- **Phase 4 — Browser-based sitemap fallback (Decision 7).** Independent of the per-page changes; can ship after Phase 3 or in parallel. Expected impact: 1 additional site enters scan coverage (beal.edu) plus future-proofing.

Between phases, Kevin re-runs the same queue-wide audit and measures error counts so the impact of each phase is empirically attributed.

## Risks and mitigations

| Risk                                                                                                | Mitigation                                                                                                                                  |
|-----------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| Blocking analytics removes a cookie-banner from the DOM, hiding a real axe violation                | Document the blocklist's behavior on the per-page results view ("Scan blocked N known-noise requests; cookie banners injected via GTM may be missing"). Operator can manually re-test those banners. |
| `domcontentloaded` fires before client-rendered content the user sees (e.g. React app hydration)    | The 5 s post-DCL settle catches XHR/fetch traffic. axe-core itself runs in `runner.ts` after the settle, so any synchronous JS work that creates DOM nodes during DCL+settle is included. SPAs that render mostly client-side were already underserved by `networkidle2` (the SPA was the timeout cause), so this is no worse. |
| Single-shot retry doubles the work on pathological pages that fail consistently                     | The retry triggers only on three named transient patterns. A timeout that recurs on retry is reported as a normal error — no infinite loops. |
| PDF "skipped" status confuses downstream summary counts (e.g. `pdfsError` includes oversize today)  | Plan includes schema migration: new column `pdfsSkipped Int`, updated finalizer math.                                                       |
| 3xx manual follow recurses on a redirect chain                                                      | Manual follow is one-shot — no recursion. If the followed URL is itself a 3xx, the second response surfaces with both Location values in the error. |
| Phase 4 browser fallback bypasses SSRF on redirects/subresources because the runner's request-interception is per-runAudit and not inherited | The browser-fetch helper enables its own `setRequestInterception(true)` and validates every request URL through `assertSafeHttpUrl`. Documented as a hard implementation requirement in Phase 4 Task 4.1. |
| Noise blocklist hides accessibility-relevant DOM (cookie banners, login widgets, chat affordances)  | Spec keeps `connect.facebook.net` and Intercom OFF the list precisely to preserve login/chat affordances. Cookie-banner risk accepted; documented in the per-page results footnote (separate small PR out of scope). |
| `postLoadSettle` swallows non-timeout failures (frame detach during settle) and hides them from the transient-retry layer | Helper only catches `waitForNetworkIdle`'s own timeout rejection; the call site keeps `postLoadSettle` *inside* the navigation try/catch so frame-detach during settle surfaces as a runner error and Phase 2's retry sees it. |
| Skipped-PDF counter drift wedges the finalizer in `pdfs-running` because `pdfsDone` was written assuming only complete + error are terminal | Decision 6 lists every coupling point (orchestrator + finalizer + helpers + API + poller + tests). Plan tasks must hit all of them in one PR. |
| Cache-busting query param (`?_cb=<ts>`) on the 304 retry alters routed content on sites that key by exact URL | Risk accepted because the affected URLs were content pages where an extra param is silently ignored. Sites where this matters surface as a follow-on 4xx and are recognizable in the error message. |
| Phase 4 browser fallback adds up to ~20s × N candidates of latency on permanently-blocked sites | Bound the helper's per-attempt timeout to 20 s and the candidate list to the existing `uniqueCandidates` (already deduped). Worst case ~80 s on a fully-blocked site, after which the operator gets a clear `(browser fallback also failed)` error. |

## Affected files

| File                                              | Phase | Change                                                                                       |
|---------------------------------------------------|-------|----------------------------------------------------------------------------------------------|
| `lib/ada-audit/runner.ts`                         | 1,2,3,5 | Replace nav block; integrate blocklist filter; add transient retry wrapper; 3xx diagnostics |
| `lib/ada-audit/page-load.ts`                      | 1     | Optional helper for the post-DCL settle if we extract it                                     |
| `lib/ada-audit/browser-pool.ts`                   | 2,4   | Per-page cache + SW + header hardening on acquisition                                        |
| `lib/ada-audit/scanner-noise.ts`                  | 2     | NEW — blocklist + `isNoiseHost(url): boolean`                                                |
| `lib/ada-audit/scanner-noise.test.ts`             | 2     | NEW — hostname matcher unit tests                                                            |
| `lib/ada-audit/pdf-runner.ts`                     | 6     | Surface `skipped` status with `reason: 'oversize'` instead of error                          |
| `prisma/schema.prisma`                            | 6     | Add `pdfsSkipped Int @default(0)` to SiteAudit; update finalizer                             |
| `lib/ada-audit/site-audit-helpers.ts`             | 6     | Include `pdfsSkipped` in `buildSiteAuditSummary`                                             |
| `lib/ada-audit/types.ts`                          | 6     | Add `'skipped'` to PdfAudit status type; add `skipReason` field                              |
| `components/ada-audit/PdfList.tsx` (or analogous) | 6     | Render `skipped` pill (neutral, not red) with reason                                         |
| `CLAUDE.md`                                       | 1     | Update the bullet on `waitUntil: 'networkidle2'` to reflect new strategy                     |
| `lib/ada-audit/sitemap-crawler.ts`                | 4     | Add browser-pool-based fallback fetch when all `safeFetch` candidates fail with non-2xx       |
| `lib/ada-audit/sitemap-crawler.test.ts`           | 4     | Tests for the fallback path (mock browser-pool) and the "both failed" surface                |
