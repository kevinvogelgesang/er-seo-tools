# External-link verification — design (C6 broken-link Phase 1 completion)

**Date:** 2026-07-04
**Status:** spec (pre-Codex)
**Roadmap ref:** C6 broken-link verifier Phase 1 (SF-retirement campaign §5). Externals
are harvested but **not checked** in v1; this closes that gap.
**Change class:** feature (rides the existing live-scan builder). No schema migration, no
new route/middleware, no injected-into-page code.

---

## 1. Goal

The ADA site-audit page job harvests every `<a href>` and `<img src>` on each rendered page
and records them in the transient `HarvestedLink` table with a `kind` of `internal-link`,
`image`, or `external-link`. The post-terminal `broken-link-verify` job (the single live-scan
run builder) verifies only `internal-link` + `image` targets — it drops `external-link` rows
with a single `where` filter. This feature makes the builder **also verify external targets**
and emit a `broken_external_links` finding, surfaced in the results-page `BrokenLinksSection`.

This is a Screaming-Frog parity item: SF reports broken outbound links; the live scan does not
yet. It is additive and localized — internal-link/image verification behavior is **unchanged**.

## 2. Current behavior (code-grounded, verified 2026-07-04)

- **Harvest:** `lib/ada-audit/link-harvest.ts` — `classifyTargets` marks cross-domain links
  *and cross-domain images* as `kind:'external-link'` (L61-63); same-domain rule is exact-host,
  www-insensitive (`sameDomain`, L16-17); per-page cap `HARVEST_CAP=300`. External rows are
  written to `HarvestedLink` by `persistHarvest` in `site-audit-page.ts` (fenced to a successful
  settle) — **externals are already in the DB**, only unread.
- **The exclusion filter:** `lib/jobs/handlers/broken-link-verify.ts:107` —
  `where: { siteAuditId, kind: { in: ['internal-link', 'image'] } }`. This is the sole place
  externals are dropped.
- **Resolution:** the builder dedupes to unique `(kind,targetUrl)`, caps at
  `BROKEN_LINK_MAX_CHECKS` (default 2000), resolves each ONCE through a bounded worker pool
  (`BROKEN_LINK_CONCURRENCY`, default 4) sharing one `HostThrottle` (`BROKEN_LINK_HOST_DELAY_MS`,
  default 250) into a `cache: Map<normUrl, ResolveResult>`, then derives broken/unconfirmed
  counts. Canonical/hreflang validation targets (same-domain only) share the same cap/pool.
- **`resolveUrl`** (`lib/ada-audit/url-resolver.ts`): HEAD first; `<400` → `ok`; `>=400` → GET
  confirm; GET `>=400` → `broken` (carries `status`); `SafeUrlError` → `unconfirmed` (no GET);
  network/timeout → `unconfirmed`. `ResolveResult` already carries `status`, `finalUrl`, `chain`.
  Uses SSRF-guarded `safeFetch` on every hop (DNS-pinned, private-IP rejection, max 5 redirects).
- **Findings:** `lib/findings/broken-link-mapper.ts` — `TYPE_OF` maps `internal-link` →
  `broken_internal_links`, `image` → `broken_images`, **`external-link` → `null` (skipped, L33/47)**.
  Emits one run-scope finding per type (`severity:'critical'`, `count = distinct broken targets`,
  detail = `{description, ...confidence}`) + page-scope findings keyed by SOURCE page
  (`pageFindingKey(type, sourcePageUrl)` — avoids `@@unique([runId,dedupKey])` collision).
  `affectedSource:'live-scan-verify'`.
- **UI:** `components/site-audit/BrokenLinksSection.tsx` — `BROKEN_TYPES = {broken_internal_links,
  broken_images}` (L22); states not-verified / verified-clean / findings; confidence line reads
  `checked`/`unconfirmed` from detail + `partial` from `run.status`.
- **`broken_external_links` already exists in the SF-parser world** (not wired to live-scan):
  priority weight 35 (`priority.service.ts:64`), a recommendation string
  (`issue-recommendations.ts:35`), `'external'` membership (`issue-membership.ts:10`), emitted by
  `ExternalLinksParser`. This feature **reuses that type string** so scoring/priority/membership
  and the SF world stay consistent.
- **SSRF posture is unchanged by verifying externals** — `safeFetch` already guards arbitrary
  public hosts on every internal check; internals resolve to arbitrary public IPs too. The only
  new dimension is fan-out to many distinct third-party hosts (see §5).

## 3. Decisions (locked with Kevin, 2026-07-04 — do not relitigate)

1. **Separate external budget** — new `BROKEN_LINK_EXTERNAL_MAX_CHECKS` (default **300**,
   env-tunable, clamped ≥0 via `parsePositiveInt`). Internals + validation consume their existing
   2000 cap first (unchanged); externals get an independent bounded pass. Externals can never
   starve internal checks.
2. **Warning severity** — external findings use `severity:'warning'` (matches the SF-parser
   treatment of `broken_external_links`); internal broken links/images stay `critical`.
3. **Anti-bot-tolerant broken classification (externals only)** — an external target whose
   resolved result is `broken` with HTTP status ∈ **{401, 403, 405, 429}** is reclassified to
   **`unconfirmed`** (excluded from broken counts, like a timeout). Genuine external broken =
   **404 / 410 / 5xx** (and, per §5, no confirmable-live signal). **Internal-link/image
   classification is UNCHANGED** — any 4xx/5xx after GET stays `broken`. Rationale: 401/403/405/429
   from third-party hosts are overwhelmingly WAF/anti-bot blocks, not dead links; false positives
   erode the analyst trust the retirement gate depends on.

Excluded (YAGNI / out of scope): widening same-domain to subdomains (fenced by the campaign);
external image-vs-link finding split (both stay `broken_external_links`); recall/retry of
`unconfirmed` externals; per-client external toggle; changing internal-link behavior in any way.

## 4. Design

All changes are localized to the live-scan builder + mapper + one UI section. The **internal +
validation resolution pass is byte-unchanged**; externals are a **separate second pass** so they
cannot perturb internal timing, ordering, or classification.

### 4.1 Read externals (`broken-link-verify.ts`)

Read external rows in a **separate query** (not by widening the existing `kind` filter — keeping
them separate preserves the existing internal dedup/cap code verbatim):

```
const externalRows = await prisma.harvestedLink.findMany({
  where: { siteAuditId, kind: 'external-link' },
  orderBy: [{ targetUrl: 'asc' }, { sourcePageUrl: 'asc' }],   // deterministic → stable cap subset
  select: { targetUrl: true, sourcePageUrl: true, harvestTruncated: true },
})
```

Dedupe to unique `targetUrl` collecting ≤`URLS_PER_FINDING` (25) source pages each, exactly
mirroring the internal dedup. Cap at `BROKEN_LINK_EXTERNAL_MAX_CHECKS`; overflow sets an
`externalCapped` flag.

**Harvest-truncation is scoped per pass (Codex #6).** The existing `harvestTruncated =
rows.some(...)` is computed over internal+image rows ONLY and is left **byte-unchanged** — it
continues to flag internal findings. External rows compute their OWN `externalHarvestTruncated`
from the external row set. The run is `partial` if **either** is true, but the two flags never
cross: internal findings' confidence/`affectedComplete` must not shift because an external harvest
was truncated (that would violate invariant #1).

### 4.2 External resolution pass (HEAD-only, bounded by cap AND a remaining-time-aware budget)

A second worker pool, run **after** the existing internal/validation resolution completes,
resolving external targets into a **separate** `externalCache`:

- **HEAD-only (Codex #3).** Externals use a dedicated HEAD-only resolver — NOT `resolveUrl` (which
  does HEAD→GET). This halves the per-dead-host cost (one timeout, not two) and reduces third-party
  load. Implemented as a new `deps.resolveExternal(url)` (production = a HEAD-only path over
  `safeFetch` with the external timeout; injectable for tests). **Tests must prove GET is never
  issued for an external target.** *Precision tradeoff, stated plainly (Codex #4):* HEAD-only loses
  more than "405→unconfirmed" — some hosts mishandle HEAD and return 404/5xx when a GET would
  succeed. That is the accepted v1 tradeoff, justified by the locked anti-bot posture (we already
  suppress the ambiguous 4xx) and the timeout guarantee; externals are a warning-tier finding.
- Reuses the **same `HostThrottle` instance** (per-host delay still applies; safe across sequential
  passes — Codex #11; the only effect is a possible ≤`HOST_DELAY_MS` wait on a host also checked
  internally; harmless).
- Uses `BROKEN_LINK_CONCURRENCY` workers (same knob). Each check uses a shorter external request
  timeout `BROKEN_LINK_EXTERNAL_TIMEOUT_MS` (default **8000**).
- **Worker failure isolation (Codex #7):** the external worker wraps `deps.resolveExternal` in
  try/catch — an unexpected throw classifies that target as `unconfirmed`, never rejecting the pool.
  The external pass must always degrade to `partial`/`unconfirmed`, never job-fail into a retry
  loop. (The internal pass is left byte-unchanged; production `resolveUrl` already never throws.)
- **Remaining-time-aware soft budget (Codex #1, #8):** capture `jobStartedAt = deps.now()` at
  handler entry. Compute
  `externalDeadlineMs = Math.max(0, min(BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS, JOB_TIMEOUT_MS -
  (deps.now() - jobStartedAt) - SAFETY_RESERVE_MS))` where `JOB_TIMEOUT_MS = 900000` (single source,
  shared with job registration) and `SAFETY_RESERVE_MS` (default 60000) reserves time to write the
  run. If `externalDeadlineMs <= 0`, **skip the external pass entirely**, set `externalCapped`, mark
  the run `partial`, and still write it. Otherwise each worker, **immediately before claiming the
  next target**, checks `deps.now() - externalStartedAt >= externalDeadlineMs`; once exceeded it
  stops claiming. Workers already in flight finish (added latency ≤ one external request timeout).
  Any external **never launched** is uncounted and sets `externalCapped` exactly once.

### 4.3 HEAD-only external classification

Classify each external target from its HEAD result:

```
// HEAD status:
//   < 400            -> ok
//   404, 410, 5xx    -> broken
//   401,403,405,429  -> unconfirmed (anti-bot; locked decision)
//   any other status -> unconfirmed (can't confidently call broken)
// SafeUrlError / network / timeout / throw -> unconfirmed
```

`BROKEN_STATUS(status) = status === 404 || status === 410 || (status >= 500 && status <= 599)`.
Everything else that is not `<400` is `unconfirmed`. `BrokenTarget.kind` already admits
`'external-link'`; push external broken targets onto the same `broken[]` array the internal
derivation fills. Track `externalChecked` (targets with a cache entry) and `externalUnconfirmed`.

### 4.4 Emit `broken_external_links` (`broken-link-mapper.ts`)

- `TYPE_OF['external-link'] = 'broken_external_links'` (was `null`).
- Add its `DESC` entry.
- **Severity is now type-dependent:** `broken_external_links` → `'warning'`; the two internal
  types stay `'critical'`. (Today severity is a hardcoded `'critical'` at L56/L72 — replace with a
  per-type lookup.)
- **Split emission, per-pass confidence (Codex #5):** call `mapBrokenLinkFindings` **twice** — once
  for the internal/image `broken[]` subset with internal-scoped confidence, once for the external
  subset with external-scoped confidence + `severity:'warning'`. No `confidenceByType` API. No
  collision: `runFindingKey(type)` and `pageFindingKey(type, src)` both include `type`, so the two
  calls' outputs never share a `dedupKey`.
- **NO zero-count finding is written (plan-review correction).** The spec earlier considered emitting
  a zero-count external run finding for coverage transparency (spec Codex #10 offered this OR a
  `run.status`-based UI note). Plan review found a `count:0` `broken_external_links` finding is **not
  inert downstream** — `calculatePriorityScore` (`priority.service.ts`) scores by type weight × count
  scale, and its count-0 scale multiplier defaults to 1.0, so a zero-count finding would inflate
  priority/open-issue surfaces. Therefore the external mapper call is a **plain** call: it emits a
  run finding (+ page findings) **only when there are actually-broken external targets** (`count >
  0`), exactly like the internal call. When externals are clean, nothing is written.

### 4.5 UI (`BrokenLinksSection.tsx`)

- Add `broken_external_links` to a `TYPE_LABEL` entry ("Broken external links") and render it as a
  **warning tier** (amber), visually distinct and ordered below the critical internal findings.
  Dark-mode variants on every new element (per change-control UI rule).
- **External block renders only when a `broken_external_links` run finding exists with `count > 0`**
  (same shape as internal). Its confidence line reads `checked`/`unconfirmed` and a partial note from
  **that finding's own detail** (`capped`/`harvestTruncated`), NOT the global `run.status`
  (Codex plan-#6 — per-tier partial).
- **Coverage/partial transparency without a finding (spec Codex #10, run.status option):** the
  verified-clean state keeps its copy, but when `run.status === 'partial'` it appends a note ("Some
  links could not be fully checked — results are partial."). This is the only place the global
  `run.status` is the sole signal (no finding to read a detail from). The nicety of showing "checked
  N externals" when fully clean is dropped for v1 — coverage is measured from builder inputs/logs for
  the retirement gate, not this UI. If no `broken_external_links` finding exists and the run is
  `complete`, the section is unchanged from today.

## 5. Timeout-safety analysis (the load-bearing risk)

The job timeout is **900_000 ms (15 min)**, `maxAttempts:2`. If the handler exceeds it, the queue
aborts it and **no CrawlRun is written** → recovery re-enqueues → risk of a retry loop. So the
external pass must be deterministically bounded.

**Worst case per dead external host (HEAD-only, §4.2):** one HEAD timeout at the 8 s external
timeout = ~8 s (HEAD-only means no GET fallback — Codex #2/#3). At concurrency 4, 300 dead externals
= `300/4 × 8 s = 600 s = 10 min` if unbounded — still too long stacked after the internal pass, so
the time budget, not the cap, is the real guarantee.

**Mitigations (layered):**
1. **Remaining-time-aware soft budget (primary — Codex #1):**
   `externalDeadlineMs = max(0, min(BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS, JOB_TIMEOUT_MS − elapsed −
   SAFETY_RESERVE_MS))`, computed from `jobStartedAt` at handler entry. The external pass can never
   push total handler time past `JOB_TIMEOUT_MS − SAFETY_RESERVE_MS`, regardless of how long the
   internal pass took or how many external hosts are dead. If the internal pass already consumed the
   budget, externals are skipped and the run is written `partial`.
2. **HEAD-only + 8 s external timeout:** one timeout per dead host (not two), lower third-party load.
3. **Separate cap (default 300):** bounds total external fetch volume and the DB read.

Deterministic bound: `handler_time ≈ internal_pass_time + min(external work, externalDeadlineMs) +
one in-flight round (≤ 8 s) + run write`. Because `externalDeadlineMs` subtracts elapsed internal
time and a `SAFETY_RESERVE_MS` write reserve, the run is always written before the 15-min queue
kill — the failure mode is a `partial` run, never a timed-out job with no run (which would trigger a
recovery re-enqueue loop).

## 6. Config / env (default-only unless set)

| Var | Default | Parser | Purpose |
|---|---|---|---|
| `BROKEN_LINK_EXTERNAL_MAX_CHECKS` | 300 | `parseNonNegativeInt` | Max distinct external targets verified per run. **`0` disables external verification** entirely (skip the pass — a no-deploy kill switch). Codex #9. |
| `BROKEN_LINK_EXTERNAL_TIMEOUT_MS` | 8000 | `parsePositiveInt` | Per-request HEAD timeout for external checks (shorter than the 10 s internal default) |
| `BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS` | 300000 | `parsePositiveInt` | Soft wall-clock cap on the external pass (further clamped by remaining job time); overflow → `partial` |

Two internal constants (not env, single-sourced): `JOB_TIMEOUT_MS = 900000` (also used at job
registration) and `SAFETY_RESERVE_MS = 60000`.

**`parseNonNegativeInt` is a NEW helper** in `lib/jobs/config.ts` alongside `parsePositiveInt`:
returns the parsed integer when `>= 0` and finite, else the fallback. It exists specifically so
`BROKEN_LINK_EXTERNAL_MAX_CHECKS=0` disables the pass (`parsePositiveInt` would silently return the
300 fallback for `0`). All other new caps keep `parsePositiveInt`.

Existing `BROKEN_LINK_CONCURRENCY` (4) and `BROKEN_LINK_HOST_DELAY_MS` (250) are reused. Document
all three new vars + the kill-switch semantics in the `er-seo-tools-config-and-flags` skill in the
same PR.

## 7. Testing strategy

- **HEAD-only + derivation unit tests:** external target with HEAD status 404/410/500 → broken;
  401/403/405/429 → unconfirmed; other non-2xx → unconfirmed; timeout/network/SafeUrlError →
  unconfirmed. **Assert GET is never issued for an external target** (spy the injected transport —
  Codex #3). Internal target with 403 still → broken (proves the internal path is untouched).
- **Kill-switch test:** `BROKEN_LINK_EXTERNAL_MAX_CHECKS=0` → external pass skipped, no external
  finding emitted, internal findings unchanged (`parseNonNegativeInt` — Codex #9).
- **Remaining-time-budget test:** injected `now()` where the internal pass consumed the whole
  budget → external pass skipped, run written `partial` (not a job failure — Codex #1/#7).
- **Builder tests (`broken-link-verify.test.ts`):** injected `deps.resolve` returning scripted
  results per URL. Assert: externals read + verified; internal cap unaffected by externals;
  external cap independent; a `broken_external_links` run finding at `warning` with the right count;
  page-scope external findings keyed by source; `externalCapped`/`harvestTruncated` → `partial`.
- **Soft-budget test:** injected `now()` clock that jumps past the budget mid-pass → assert the pass
  stops launching, unresolved externals are uncounted, run is `partial`. (Deterministic fake clock,
  like the existing throttle tests.)
- **Mapper tests:** `external-link` → `broken_external_links` at `warning`; internal types stay
  `critical`; per-pass confidence lands on the right finding's detail.
- **UI test (`BrokenLinksSection.test.tsx`):** external findings render in the warning tier, light
  + dark; verified-clean copy when absent; confidence line reads external counts.
- **Gate:** `npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.

## 8. Invariants (must hold; verified in final review)

1. **Internal-link/image verification is byte-unchanged** — same query, dedup, cap, pool, timeout,
   classification, findings, severity (`critical`), and confidence. External harvest-truncation
   never shifts internal findings' `affectedComplete`/confidence (Codex #6). Externals are a
   strictly additive second pass.
2. **Externals never consume the internal 2000 cap** — separate query, separate cap, separate cache.
3. **The external pass is deterministically time-bounded** — the remaining-time-aware budget
   guarantees the handler writes its run before the 15-min queue kill; overflow degrades to
   `partial`, never a job failure/retry loop. An external `deps.resolveExternal` throw degrades one
   target to `unconfirmed` (Codex #7), never rejecting the pool.
4. **`broken_external_links` reuses the existing SF-world type** (priority 35, recommendation,
   `'external'` membership) — no new type string, no scoring surprise.
5. **No false positive on anti-bot blocks** — external 401/403/405/429 are `unconfirmed`.
6. **No schema migration, no new route/middleware, no `.toString()`-injected code** (no minification
   concern). No `Class.name`/function-name runtime lookups.
7. **Idempotency preserved** — the builder still delete-and-recreates one run on
   `{siteAuditId, tool}` and deletes transient rows only after the write; external reads join the
   same idempotent flow.

## 9. Non-goals

External broken-link *recall* (re-checking unconfirmed), redirect-chain reporting for externals,
subdomain reclassification, per-client toggles, and any change to internal-link behavior or the
canonical-run selection are explicitly out of scope.

## 10. Open questions — RESOLVED by Codex review (2026-07-04)

1. **HEAD-only for externals?** → **Yes** (Codex #3). Dedicated HEAD-only resolver
   (`deps.resolveExternal`), not `resolveUrl`; tests prove GET is never issued. Precision tradeoff
   stated plainly in §4.2 (Codex #4).
2. **Per-pass confidence mechanism** → **Split emit calls** (Codex #5), not a `confidenceByType`
   API. See §4.4.
3. **Soft-budget granularity** → **Remaining-time-aware, NOT absolute** (Codex #1). The internal
   pass runs first unbounded, so an absolute budget is not a 15-min guarantee. See §4.2/§5.
4. **Cap/timeout/budget combination** → Arithmetic corrected for HEAD-only (Codex #2): ~8 s per dead
   host, `600 s` unbounded at cap 300 → the remaining-time budget (not the cap) is the guarantee.
