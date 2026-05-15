# Lighthouse PageSpeed-Insights Provider — Design

**Date:** 2026-05-15
**Status:** Approved for implementation planning

## Goal

Replace local-in-Node Lighthouse execution with Google's PageSpeed Insights API as the default Lighthouse provider in production. Keep local execution as a fallback so the abstraction is reversible. The experiment isolates whether the V8-heap OOM observed on `fei.edu` (page 29/34, 2026-05-15) is caused by local Lighthouse trace processing — and if it is, fixes it by getting Lighthouse out of our Node process entirely.

## Why now

The audit-stability PR (#15) raised PM2's `max_memory_restart` from 1200M to 2400M and `NODE_OPTIONS --max-old-space-size` from 1536 to 2048. The 2026-05-15 fei.edu retry got 21 more pages of runway (page 8 → page 29) before crashing — but it still crashed. The crash signature was different from yesterday's: a V8 `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`, not a PM2 SIGKILL on RSS. Mark-Compact recovered only 6 MB from a 2039 MB heap — an unrecoverable heap, the classic leak signature.

The senior-dev assessment is that local Lighthouse's trace processing + report-tree generation is the dominant retainer, and that moving Lighthouse out-of-process is the cheapest experiment to validate that hypothesis. If fei.edu finishes under PSI, we know the leak. If it OOMs again, the leak is elsewhere in the Node-side audit loop (axe results, screenshot buffers, PDF orchestrator) and heap snapshots are the next move.

## Non-goals (out of scope)

- **Removing local Lighthouse entirely.** Keep `local` as a fallback provider for environments where PSI isn't reachable (no outbound internet, dev box) or where we want apples-to-apples comparison with historical numbers.
- **Fall-back-to-local on PSI failure.** When PSI fails for a page, surface the error and continue with axe-only for that page. Falling back to local would silently reintroduce the leak we're trying to escape.
- **Per-audit / per-page choice of provider.** Provider is process-wide via env var. No per-row override.
- **Caching PSI results.** PSI's own infrastructure caches; we don't need a second layer.
- **PSI mobile strategy.** Stay on `strategy=DESKTOP` to match current local-LH configuration. Mobile is a separate question.
- **Score reconciliation with historical local-LH scores.** Numbers will shift; document but don't try to back-compute.

## Provider abstraction

Three providers, selected by env var:

| `LIGHTHOUSE_PROVIDER` | Behavior |
|---|---|
| `pagespeed` (new prod default) | Call PSI v5 over HTTPS; map `response.lighthouseResult` through the existing `extractSummary()` |
| `local` (former prod default; fallback) | Existing puppeteer-core + `lighthouse` package execution |
| `off` | Skip Lighthouse entirely, return `{ summary: null }`. Already supported today via `LIGHTHOUSE_ENABLED=false`; we preserve that exact behavior under `provider=off`. |

Master toggle `LIGHTHOUSE_ENABLED` still works — if false, no provider runs and the result is `{ summary: null }` regardless of `LIGHTHOUSE_PROVIDER`.

### Selector

`lib/ada-audit/lighthouse-provider.ts` (new file):

```typescript
export type LighthouseProvider = 'pagespeed' | 'local' | 'off'

export function getLighthouseProvider(): LighthouseProvider {
  if ((process.env.LIGHTHOUSE_ENABLED ?? 'true') === 'false') return 'off'
  const raw = (process.env.LIGHTHOUSE_PROVIDER ?? 'local').toLowerCase()
  if (raw === 'pagespeed' || raw === 'local' || raw === 'off') return raw
  return 'local'  // unknown values fall back to local rather than off — safer default
}

/** True if the chosen provider takes responsibility for the puppeteer page.goto call. */
export function lighthouseOwnsNavigation(): boolean {
  return getLighthouseProvider() === 'local'
}
```

## PSI request shape

```
GET https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed
  ?url=<target>
  &strategy=DESKTOP
  &category=PERFORMANCE
  &category=ACCESSIBILITY
  &category=BEST_PRACTICES
  &key=<PAGESPEED_API_KEY>      ← omitted when env unset (keyless mode, lower rate limit)
```

Timeout: `PAGESPEED_TIMEOUT_MS` (default 90 s). PSI typically responds in 15–30 s; 90 s leaves margin for slow pages.

`category` repeated per category — the v5 spec uses repeated query params, not comma-separated values. Verify this in the request builder.

## Response mapping

`response.lighthouseResult` is shape-compatible with what local Lighthouse produces:

```typescript
const json = await fetchPSI(url)
if (!json.lighthouseResult) {
  return { summary: null, error: 'PSI returned no lighthouseResult' }
}
const summary = extractSummary(json.lighthouseResult)   // existing function, no changes
return { summary }
```

`extractSummary()` already handles `categories`, `audits`, `categoryGroups`, the accessibility extractor, and topFailures filtering. It works against PSI's payload without modification.

## Failure handling — surface and continue

When PSI fails for a page (timeout / 4xx / 5xx / network error / quota exhausted / malformed body), `runLighthouse()` returns `{ summary: null, error: '<reason>' }`. The caller in `runner.ts` continues with axe and PDF harvest. The audit detail page renders "Lighthouse failed: <reason>" alongside the axe results — same path that already exists today for local LH failures.

Error messages should be specific enough to act on:

| Condition | Error string |
|---|---|
| HTTP 429 quota | `PSI rate limit exceeded (HTTP 429). Slow down or add an API key.` |
| HTTP 400 unfetchable URL | `PSI could not fetch the URL (HTTP 400). The page may be private or blocked.` |
| HTTP 5xx | `PSI server error (HTTP <code>).` |
| Network timeout | `PSI timed out after <ms>ms.` |
| Malformed JSON | `PSI returned malformed response.` |
| Empty `lighthouseResult` | `PSI returned no lighthouseResult.` |

## Flow change in `runner.ts`

Current single-navigation optimization: when Lighthouse is local, it owns `page.goto`. The non-LH branch does `page.goto` itself. With three providers, the branching becomes:

```typescript
if (isLighthouseEnabled() && lighthouseOwnsNavigation()) {
  // Local provider: LH owns navigation
  try {
    const lh = await runLighthouse(parsed.toString(), page)
    lighthouseSummary = lh.summary
    lighthouseError = lh.error ?? null
  } catch (err) {
    lighthouseError = err instanceof Error ? err.message : String(err)
  }
  await resetCdpAfterLighthouse(page).catch(() => {})
} else {
  // PSI, off, or LH-disabled: we own navigation
  await progress(20, 'Loading page…')
  let response
  try {
    response = await page.goto(parsed.toString(), { waitUntil: 'networkidle2', timeout: 30_000 })
  } catch (err) {
    if (blockedNavigationError) throw blockedNavigationError
    throw err
  }
  // …existing response-validation logic for 304 / 403 / 401 / non-OK…

  if (isLighthouseEnabled()) {
    // PSI provider
    try {
      const lh = await runLighthouse(parsed.toString(), page)
      lighthouseSummary = lh.summary
      lighthouseError = lh.error ?? null
    } catch (err) {
      lighthouseError = err instanceof Error ? err.message : String(err)
    }
  }
}
```

The SSRF / request-interception machinery is set up before this branch and is identical for both paths.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `LIGHTHOUSE_PROVIDER` | `local` (dev) / `pagespeed` (prod via ecosystem.config.js) | Provider selection |
| `LIGHTHOUSE_ENABLED` | `true` | Master kill-switch; existing |
| `PAGESPEED_API_KEY` | unset | Lifts PSI rate limits from keyless to 25k/day. Optional. Put in `.env`, never in `ecosystem.config.js` (secret). |
| `PAGESPEED_TIMEOUT_MS` | `90000` | PSI per-page timeout in ms |
| `LIGHTHOUSE_TIMEOUT_MS` | `60000` | Local-LH timeout; existing |

## File structure

| File | Status | Responsibility |
|---|---|---|
| `lib/ada-audit/lighthouse-provider.ts` | Create | `getLighthouseProvider()`, `lighthouseOwnsNavigation()`, `LighthouseProvider` type |
| `lib/ada-audit/lighthouse-pagespeed.ts` | Create | `runPageSpeedInsights(url): Promise<RunLighthouseResult>` — PSI HTTP client + response → summary mapping |
| `lib/ada-audit/lighthouse-pagespeed.test.ts` | Create | Mocked-fetch tests: success path, 429, 400, 5xx, timeout, malformed body, empty result |
| `lib/ada-audit/lighthouse-runner.ts` | Modify | `runLighthouse()` becomes a facade that dispatches to local or PSI based on `getLighthouseProvider()` |
| `lib/ada-audit/lighthouse-runner.test.ts` | Modify (optional) | One smoke test that `runLighthouse` dispatches based on env. The existing `extractSummary` tests are unchanged. |
| `lib/ada-audit/runner.ts` | Modify | Branch on `lighthouseOwnsNavigation()` — local owns nav, PSI / off do not. |
| `ecosystem.config.js` | Modify | Set `LIGHTHOUSE_PROVIDER=pagespeed` and `PAGESPEED_TIMEOUT_MS=90000` |
| `.env.example` | Modify | Document `LIGHTHOUSE_PROVIDER` and `PAGESPEED_API_KEY` |
| `CLAUDE.md` | Modify | Brief note about provider in the ADA audit section |
| `docs/SERVER_SETUP.md` | Modify | Env var table entries + a deploy step to set `PAGESPEED_API_KEY` in `.env` before first deploy |

## Tests

PSI client unit tests use `vi.stubGlobal('fetch', …)` to mock HTTP:

| Test | Outcome |
|---|---|
| Success with full lighthouseResult | summary populated, error null |
| HTTP 429 | summary null, error matches /rate limit/i |
| HTTP 400 | summary null, error matches /unfetchable|private|blocked/i |
| HTTP 500 | summary null, error matches /server error/i |
| AbortSignal timeout | summary null, error matches /timed out/i |
| Malformed JSON body | summary null, error matches /malformed/i |
| Missing `lighthouseResult` in body | summary null, error matches /no lighthouseResult/i |
| Request URL includes all three categories | the mocked fetch sees a URL with `category=PERFORMANCE`, `category=ACCESSIBILITY`, `category=BEST_PRACTICES` |
| API key included when env set | fetch URL has `key=…` |
| API key omitted when env unset | fetch URL has no `key=` param |

Provider-selector unit tests:

| Test | Outcome |
|---|---|
| `LIGHTHOUSE_ENABLED=false` returns `'off'` regardless of provider | |
| `LIGHTHOUSE_PROVIDER=pagespeed` returns `'pagespeed'` | |
| `LIGHTHOUSE_PROVIDER=PAGESPEED` (caps) returns `'pagespeed'` | |
| `LIGHTHOUSE_PROVIDER=garbage` falls back to `'local'` (safe default) | |
| `lighthouseOwnsNavigation()` true only when provider is `'local'` | |

No new tests for `extractSummary` — it operates on whatever shape `lighthouseResult` is, and PSI's shape is the same as local's. The existing 10-test suite stands.

`runner.ts` integration testing is implicit through the existing audit flow; we'll validate manually on the live fei.edu retry rather than mock the whole puppeteer + PSI flow.

## Deploy mechanics

The `PAGESPEED_API_KEY` is a secret. Add to `/home/seo/webapps/seo-tools/.env` on the VPS **before** the deploy pulls the new code. Procedure:

```bash
ssh seo@144.126.213.242 'echo "PAGESPEED_API_KEY=<provided-key>" >> /home/seo/webapps/seo-tools/.env'
```

Then run the standard deploy. The new `ecosystem.config.js` sets `LIGHTHOUSE_PROVIDER=pagespeed`; PM2 `delete + start` picks it up. PSI traffic from the VPS goes egress to `pagespeedonline.googleapis.com` — verify that's not blocked by firewall or egress proxy rules.

If anything goes wrong post-deploy, the rollback is a one-line env flip:

```bash
ssh seo@144.126.213.242 'cd /home/seo/webapps/seo-tools && sed -i "s/LIGHTHOUSE_PROVIDER: .pagespeed./LIGHTHOUSE_PROVIDER: 'local'/" ecosystem.config.js && pm2 delete seo-tools && pm2 start ecosystem.config.js'
```

(Or just revert the PR.)

## Open behavioural questions resolved

- **PSI runs in Google infrastructure; scores will shift from local-LH baselines.** Document in the PR body. Operators reading "this site dropped from 71 to 62" should be informed it may be a measurement change, not a real regression. The `LighthouseSummary` already carries no `provider` tag; this PR keeps that — we accept the score-environment shift as part of the experiment.
- **Concurrency under PSI.** Our `SITE_AUDIT_CONCURRENCY=1` means PSI calls are serialized. At ~20 s/page, the PSI quota (400 QPM keyless / unlimited keyed) is in no danger. If a future PR raises concurrency, we'll add request batching + backoff there, not here.
- **PSI failure under quota.** First failure mode we should monitor is HTTP 429. If we ever see it, the error string makes the next action obvious (add key, slow down, or accept partial coverage).
