# PR-C Passoff: retry-once on `page.goto` HTTP 5xx

**One-line:** Same shape as PR #17 (PSI retry), applied to the per-page navigation in `lib/ada-audit/runner.ts`. Recovers transient upstream 5xx without masking deterministic site bugs.

## Evidence justifying this PR

sdgku.edu audit `cmpcusklt0061qfq9qyat3h7o` (2026-05-19): 45/117 pages errored at `page.goto`. Split:
- **38× HTTP 500** on `/staff/<slug>/` — deterministic site bug; still 500 on live re-probe. Not addressable by retry.
- **7× HTTP 503** on misc pages — all live (HTTP 200) on re-probe minutes later. **Would be recovered by retry-once.**

So: retry-once would have moved this audit from 72/117 → 79/117 complete with zero false-pass risk (5xx-then-200 means the page actually loaded the second time).

## The change

In `lib/ada-audit/runner.ts` around line 128–150, the `else` branch does:

```ts
response = await page.goto(parsed.toString(), { waitUntil: 'networkidle2', timeout: 30_000 })
// …
if (!response.ok()) {
  // throws HTTP 4xx / 5xx / etc.
}
```

After: if `response.status() >= 500`, retry the `page.goto` once before throwing. Mirror the PSI semantics:

- Retry **only** on 5xx. Never on 4xx (deterministic), 304, or thrown nav errors (e.g. timeout, DNS, cert).
- One retry, no backoff. Same justification as PR #17: global outage → fast retry no worse; transient flake → fast retry resolves.
- Each attempt gets its own 30s nav timeout. Total worst-case wall-clock per failing page: 60s.

## Constraints / gotchas

- **Don't retry on thrown errors from `page.goto`.** The existing catch at line 132 handles SSRF/blocked-navigation; preserve that. The retry must sit between the successful `page.goto` and the `!response.ok()` throw — only retries when we got a 5xx response, not when navigation threw.
- **Browser pool slot is already acquired.** Retry runs on the same `page` instance — no `acquirePage()` round-trip. Just call `page.goto` again.
- **Progress reporting:** the first goto reports `progress(20, 'Loading page…')`. The retry can stay silent or bump to e.g. `'Retrying (upstream 5xx)…'` for visibility in the live progress UI. Light preference for the latter — operators wondering why a page took 30+s deserve to know.
- **Lighthouse path (the `if` branch above the `else`):** PSI does its own fetch and already has retry-once after PR #17. The runner's `page.goto` only fires when LH is `local` or `off`. Production today is `pagespeed` (per `ecosystem.config.js`), so this PR helps `local`-mode audits and any future fallback path. Still worth doing — production *can* flip to local via env, and the LH-disabled path is the common one for the per-page axe step inside Lighthouse-on path too. Verify the call site before assuming reach.

## Tests to add

In `lib/ada-audit/runner.test.ts` (or equivalent — check what exists; runner is harder to unit-test because of puppeteer-core, but there's existing test scaffolding):

1. `page.goto` returns 503 then 200 → retried, axe runs, audit succeeds.
2. `page.goto` returns 503 then 503 → retried, surfaces `HTTP 503 — …`. Assert exactly 2 goto calls.
3. `page.goto` returns 400 → not retried, surfaces error. Assert exactly 1 goto call.
4. `page.goto` throws (e.g. timeout) → not retried. Assert exactly 1 goto call.

The runner is integration-heavy; if a unit harness doesn't exist, scope this PR to add a small puppeteer mock or extract a thin testable helper around the retry decision.

## Out of scope

- The 38× sdgku.edu `/staff/<slug>/` 500s — that's an upstream client-site bug. Surface to client; not a code change.
- Retry on AbortError / timeout / DNS — same reasoning as PR #17: doubles wall-clock cost on consistently slow pages with no upside.
- Multi-retry or exponential backoff — premature; PR #17 evidence shows single immediate retry catches the bulk of transient 5xx.

## Suggested branch / PR

- Branch: `fix/page-load-retry-on-5xx`
- Title: `fix(ada-audit): retry-once on page-load HTTP 5xx (analog of PR #17)`
- Estimated diff: ~20 lines of code + ~60 lines of tests.
- Base: current `main` (post PR #17 merge, commit `24fc924`).

## Deploy

Code-only; no env var changes. Normal `ssh seo@144.126.213.242 "~/deploy.sh"`.
