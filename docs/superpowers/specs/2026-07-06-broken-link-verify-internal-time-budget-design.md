# Design — Internal-link verification time budget (broken-link-verify)

**Date:** 2026-07-06 · **Status:** spec (Codex review pending) · **Class:** small bugfix (single-file, existing pattern) · **Author:** SF-retirement Phase 1 session

## Problem

`lib/jobs/handlers/broken-link-verify.ts` is the single live-scan-run builder. Its
flow is: load harvested rows → **internal-link verification** → **external-link
verification** → compute on-page findings / live score / discovery coverage →
`writeFindingsRun` → delete the transient `HarvestedLink`/`HarvestedPageSeo` rows.

The **internal verification pass** (`cacheWorker`, ~lines 229-243) resolves every
target (HEAD→GET, per-host 250 ms throttle, up to `BROKEN_LINK_MAX_CHECKS`=2000)
with **no time budget**. The **external pass** (`extWorker`, line 294) already
stops at a deadline. Each internal request can hang up to a 10 s timeout,
serialized by the host throttle, so on sites with many/slow internal links the
internal pass alone exceeds the **hardcoded 15-min `JOB_TIMEOUT_MS`**. The job is
then killed by the queue **before `writeFindingsRun` (line 433)** — a **total
loss**: no live-scan run, no score, no coverage/miss-rate, no on-page findings,
no broken-link findings. The job retries under the queue's attempt policy and
eventually exhausts (`onExhausted` is log-only), so the run is never built.

> Note (pre-existing, out of scope): the handler registers `maxAttempts: 2`
> (line 462) but `enqueueBrokenLinkVerify` passes none, so the `Job` rows carry
> the schema default `@default(3)` — prod rows observed at `att=2/3`. This
> registration-vs-row inconsistency is unrelated to this fix; logged as a
> follow-up, not addressed here.

### Evidence (prod, 2026-07-06)

Seven `seoIntent` audits were triggered for the SF-retirement parity/miss-rate
gate. The verify jobs for the five larger sites timed out at exactly
`900000ms` and burned attempts:

| Domain | audited pages | harvested links | verify outcome |
|---|---|---|---|
| brockwaycatart.org | 52 | small (cleaned) | ✅ built |
| bidwelltraining.edu | 51 | small (cleaned) | ✅ built |
| brownson.edu | 149 | 4,092 | ⏳ timing out (att 2/3) |
| manhattanschool.edu | 168 | 4,432 | ⏳ pending |
| cambriacollege.ca | 108 | 7,089 | ⏳ timing out (att 2/3) |
| bocabeautyacademy.edu | 319 | 18,692 | ⏳ pending |
| discoverycommunitycollege.com | 610 | 53,944 | ⏳ pending |

This is a material SF-retirement finding: the live scanner, as configured,
cannot complete on medium-to-large client sites — exactly the population the
campaign must serve.

## Goal

The builder must **always write the live-scan run**, degrading gracefully to
`status: 'partial'` when verification is truncated by time — never dying before
the write. The gate-critical outputs (live score, discovery-coverage miss-rate,
on-page findings) are computed *after* verification from the harvested rows and
**do not depend on verification results**, so a budgeted internal pass yields a
run with **complete** score/coverage/on-page data and honestly-labeled partial
broken-link data.

Non-goal: making verification *faster* (lower throttle, shorter request timeout,
higher concurrency). Those are separate, riskier knobs (they hit client sites
harder) and are unnecessary — the budget makes total loss impossible regardless
of site size. Non-goal: raising `JOB_TIMEOUT_MS`.

## Design

Give the internal pass the **same deadline treatment the external pass already
has**. `internalBudgetHit` becomes a **dynamic cap** — treated identically to the
existing `capped` flag everywhere it flows.

### 1. New env + budget constant (constants block, ~lines 83-91)

```ts
const INTERNAL_TIME_BUDGET = () => parsePositiveInt(process.env.BROKEN_LINK_INTERNAL_TIME_BUDGET_MS, 600_000)
```

Default 600 s (10 min). It is an **upper bound**; the effective deadline is
clamped (below) to always reserve room for the external pass + **all
post-verification work**.

**`SAFETY_RESERVE_MS` (60 s) is a post-*verification* reserve, not just a write
reserve** (Codex fix #4). After both verification passes, the job still runs
`computeLinkGraph` (BFS over every harvested edge — 53k on the largest site),
CrawlPage materialization, scoring, coverage, `writeFindingsRun` (chunked
`createMany`), and two `deleteMany`s. On the 53k-link case this must complete
inside 60 s for the "always writes" guarantee to hold — see Risks + the
prod-verify step. If it proves tight, raise `SAFETY_RESERVE_MS` (it is the same
constant the external clamp uses, so a bump widens both reserves safely).

### 2. Internal deadline, clamped to reserve external + write (before `cacheWorker`)

Mirror the external clamp at line 282-283. Computed once, before the internal
resolution loop starts. **Reserve external budget only when the external pass is
actually enabled** (Codex fix #2):

```ts
const externalReserveMs = EXTERNAL_MAX_CHECKS() > 0 ? EXTERNAL_TIME_BUDGET() : 0
const internalReserveMs = externalReserveMs + SAFETY_RESERVE_MS // reserve external pass (if any) + post-verify work
const internalDeadlineMs = Math.max(
  0,
  Math.min(INTERNAL_TIME_BUDGET(), JOB_TIMEOUT_MS - (deps.now() - jobStartedAt) - internalReserveMs),
)
```

With defaults at job start (`elapsed ≈ 0`, external enabled): `min(600_000,
900_000 − 300_000 − 60_000) = 540_000` (9 min) internal, leaving 5 min external
budget + 1 min for post-verification work. When external is disabled
(`BROKEN_LINK_EXTERNAL_MAX_CHECKS=0`), internal gets the full `min(600_000,
840_000) = 600_000` (10 min). The internal pass can never starve external or the
write. The existing external clamp (`remaining = JOB_TIMEOUT_MS − elapsed −
SAFETY_RESERVE`) is unchanged and still self-corrects to whatever internal
actually consumed.

**The budget is soft, not a hard stop** (Codex fix #3): workers check the
deadline *before* pulling the next target, so up to `CONCURRENCY` in-flight
`throttle.wait + resolve` rounds (one per worker) can overshoot the deadline
before returning. This is the same semantics the external pass already has; the
`SAFETY_RESERVE_MS` cushion absorbs it.

### 3. Deadline check in `cacheWorker` (exact mirror of `extWorker` line 294)

```ts
let internalBudgetHit = false
const internalStartedAt = deps.now()
const cacheWorker = async (): Promise<void> => {
  while (cursor2 < allToResolve.length) {
    if (deps.now() - internalStartedAt >= internalDeadlineMs) { internalBudgetHit = true; return }
    const url = allToResolve[cursor2++]
    let host = ''
    try { host = new URL(url).hostname } catch {
      cache.set(normalizeFindingUrl(url), unconfirmedResult()); continue
    }
    // Failure isolation (Codex fix #6, mirrors the external worker at line 303):
    // a throw in throttle.wait or deps.resolve degrades this ONE target to
    // unconfirmed instead of rejecting the whole pool and losing the run.
    try {
      await throttle.wait(host)
      cache.set(normalizeFindingUrl(url), await deps.resolve(url))
    } catch {
      cache.set(normalizeFindingUrl(url), unconfirmedResult())
    }
  }
}
```

This also adds **failure isolation** the internal worker currently lacks (the
external worker already has it, line 303) — consistent with the "never total
loss" goal. Reuse a shared `unconfirmedResult()` helper (the external pass
already defines one inline at line 291; hoist it or duplicate).

Targets never resolved (budget tripped before they were pulled) are simply absent
from `cache`; the broken-derivation loop (line 249-255) **already** skips them via
`if (!r) continue` — they are counted as neither `checked` nor `broken`. No change
needed there.

Edge case: if `internalDeadlineMs <= 0` (a retry starts with almost no time left
— unlikely since a fresh job's `jobStartedAt` is near-zero), the worker sets
`internalBudgetHit = true` and returns immediately on the first iteration; the run
is still written as `partial` with zero internal checks. This mirrors the
external `externalDeadlineMs <= 0` guard (line 284).

### 4. `internalBudgetHit` joins `capped` everywhere `capped` flows

- **Run status** (line 425): add `|| internalBudgetHit` to the `partial` trigger.
- **Broken-link findings completeness** (line 379): `affectedComplete: !capped &&
  !harvestTruncated && !internalBudgetHit`.
- **Broken-link confidence** (line 380): `capped: capped || internalBudgetHit`
  (treat a budget hit as a cap for confidence purposes — same downstream meaning:
  "we didn't check everything").
- **Validation findings completeness** (line 388): `affectedComplete: !capped &&
  !cappedValidation && !internalBudgetHit` (canonical/hreflang validation reads
  the same `cache`, so a truncated internal pass truncates it too).
- **Log line** (line 436): append the internal-budget-hit flag + how many of
  `allToResolve` were resolved, for prod observability.

External-pass code is unchanged. `computeDiscoveryCoverage`, `scoreLiveSeo`, and
`mapOnPageSeoFindings` are unchanged and remain complete (they read harvested
rows, not verification results).

## Testing

`runBrokenLinkVerify(payload, deps)` takes injectable `VerifyDeps` (`now`,
`resolve`, `resolveExternal`, `sleep`). Existing tests seed transient rows and a
mock DB. New test(s):

1. **Budget trips mid-internal → partial run still written.** Seed N internal
   harvested targets; inject a `now()` that advances past `internalDeadlineMs`
   after the first K resolves; assert: `writeFindingsRun` was called (run
   written), `run.status === 'partial'`, exactly K targets resolved, unresolved
   targets counted as neither `checked` nor `broken`, and the transient tables
   were deleted.
2. **No budget pressure → complete run unchanged.** Inject a `now()` that never
   advances past the deadline; assert the run is `complete` and every target
   resolved (regression guard: the happy path is untouched).
3. **`internalDeadlineMs <= 0` → zero internal checks, partial run written**
   (retry-with-no-time-left guard).

All three use the injected clock — no real network, no wall-clock dependence.

## Rollout

1. Ship the fix (gate-green → PR → merge → deploy).
2. The five stranded verify jobs' transient `HarvestedLink`/`HarvestedPageSeo`
   rows still exist (7-day retention has not run). `recoverBrokenLinkVerifies()`
   (boot + every 10 min via `stale-audit-reset`) re-enqueues a stranded verifier
   when the audit is complete, transient rows exist, and no live-scan run exists.
   After deploy, those jobs re-run under the new code and build `partial` runs
   automatically — no manual re-trigger needed.
3. Prod-verify: each of the five domains gets a fresh live-scan `seoIntent` run
   (`status` `complete` or `partial`) with non-null score + `discoveryCoverageJson`;
   then record parity + miss-rate per domain in the parity log.

## Risks

- **Post-verification work exceeds the 60 s reserve on huge sites.** The reserve
  covers graph compute + materialization + scoring + coverage + write + deletes,
  not just the write (Codex fix #4). If the 53k-link case overruns, the job could
  still time out *during* the write — but the transient rows would survive
  (delete happens after write) and recovery would re-enqueue, so it degrades to a
  retry, not a permanent loss. Prod-verify measures this; bump `SAFETY_RESERVE_MS`
  if needed.
- **Soft-budget overshoot.** Up to `CONCURRENCY` in-flight resolves can overshoot
  the internal deadline (Codex fix #3); the reserve absorbs it, same as external.
- **Partial is final** (Codex fix #7). Once a `partial` run is written the
  transient tables are deleted, so that audit can never be re-verified to
  completion — a fuller result requires a new audit. This matches the existing
  `capped`/`externalCapped` behavior and is acceptable: the gate-critical outputs
  (score, coverage, on-page) are already complete in a partial run.
- **Behavior change for currently-passing small sites.** None: sites that finish
  under budget never trip the deadline (test 2 is the regression guard).
- **Env var not set in prod.** Default 600 s applies; no new *required* env var,
  so no `instrumentation.ts` boot-guard change and no server `.env` edit needed.
```

