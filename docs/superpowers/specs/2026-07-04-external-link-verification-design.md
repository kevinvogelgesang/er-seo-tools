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
`externalCapped` flag. `harvestTruncated` from external rows folds into the existing
`harvestTruncated` OR (a truncated harvest already implies `partial`).

### 4.2 External resolution pass (bounded by cap AND a soft time budget)

A second worker pool, run **after** the existing internal/validation resolution completes,
resolving external targets into a **separate** `externalCache: Map<normUrl, ResolveResult>`:

- Reuses the **same `HostThrottle` instance** (per-host delay still applies; cheap since externals
  are mostly distinct hosts).
- Uses `BROKEN_LINK_CONCURRENCY` workers (same knob).
- Each check uses a **shorter external request timeout** `BROKEN_LINK_EXTERNAL_TIMEOUT_MS`
  (default **8000**), passed through `deps.resolve(url, timeoutMs?)` → `resolveUrl(url, deps,
  timeoutMs)` (both already accept a `timeoutMs` param; `VerifyDeps.resolve` gains an optional
  second arg — injectable, backward-compatible in tests).
- **Soft wall-clock deadline** `BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS` (default **300000** = 5 min):
  before pulling the next target, a worker checks `deps.now() - externalStartedAt >= budget`; once
  exceeded, workers stop launching new checks. Any external not resolved when the budget trips is
  **not counted as broken** and sets `externalCapped` (→ run `status:'partial'`). This bounds the
  NEW work at ~budget + one in-flight round regardless of how many external hosts are dead/slow.

### 4.3 Kind-aware external broken derivation

Iterate the capped external targets, reading `externalCache`:

```
for (const t of externalToCheck) {
  const r = externalCache.get(normalizeFindingUrl(t.targetUrl))
  if (!r) continue                         // never launched (budget tripped) → uncounted
  externalChecked++
  if (r.result === 'broken') {
    if (r.status != null && ANTI_BOT_STATUSES.has(r.status)) externalUnconfirmed++   // 401/403/405/429
    else broken.push({ targetUrl: t.targetUrl, kind: 'external-link', sourcePageUrls: [...t.sources] })
  } else if (r.result === 'unconfirmed') externalUnconfirmed++
}
```

`ANTI_BOT_STATUSES = new Set([401, 403, 405, 429])`. `BrokenTarget.kind` already admits
`'external-link'`; push external broken targets onto the same `broken[]` array the internal
derivation fills.

### 4.4 Emit `broken_external_links` (`broken-link-mapper.ts`)

- `TYPE_OF['external-link'] = 'broken_external_links'` (was `null`).
- Add its `DESC` entry.
- **Severity is now type-dependent:** `broken_external_links` → `'warning'`; the two internal
  types stay `'critical'`. (Today severity is a hardcoded `'critical'` at L56/L72 — replace with a
  per-type lookup.)
- **Per-pass confidence:** the run-scope finding's `detail` must report the counts of *its own*
  pass. The mapper is given external-scoped confidence (`checked/unconfirmed/capped` = the external
  pass numbers) for `broken_external_links`, and internal-scoped confidence for the internal types.
  Mechanism (plan/Codex to finalize): either pass a `confidenceByType` map, or call the mapper's
  emit twice (internal set, external set) — the run/page keying already namespaces by `type`, so
  splitting the call cannot collide. Page-scope keying is unchanged (`pageFindingKey(type, src)`).

### 4.5 UI (`BrokenLinksSection.tsx`)

- Add `broken_external_links` to `BROKEN_TYPES` and a `TYPE_LABEL` entry ("Broken external links").
- Render externals as a **warning tier**, visually distinct and ordered below the critical internal
  findings. Dark-mode variants on every new element (per change-control UI rule).
- The confidence line for the external block reads `checked`/`unconfirmed`/`capped` from the
  external finding's own detail (so "checked N externals, M unconfirmed" is accurate to the external
  pass). Verified-clean state extends to "no broken external links" when the external finding is
  absent/zero.

## 5. Timeout-safety analysis (the load-bearing risk)

The job timeout is **900_000 ms (15 min)**, `maxAttempts:2`. If the handler exceeds it, the queue
aborts it and **no CrawlRun is written** → recovery re-enqueues → risk of a retry loop. So the
external pass must be deterministically bounded.

**Worst case without a soft budget:** 300 externals, all dead, at concurrency 4. With the default
10 s request timeout, `resolveUrl` on a dead host times out on HEAD (~10 s) then GET (~10 s) = ~20 s
each → `300/4 × 20 s = 1500 s = 25 min` — alone exceeds the whole job budget. The 300 cap is **not
sufficient** on its own.

**Mitigations (all three, layered):**
1. **Soft time budget (primary):** the external pass stops launching after
   `BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS` (default 5 min). This caps the NEW work independent of
   dead-host fraction; unresolved externals just don't get counted (`partial`).
2. **Shorter external request timeout (8 s):** halves per-dead-host cost vs the 10 s default.
3. **Separate 300 cap (secondary):** bounds total external fetch volume and DB read.

The **internal + validation pass is unchanged** and historically completes with headroom inside 15
min on real client sites; the external pass adds at most ~5 min (soft budget) + one in-flight round.
Combined worst case stays under the 15-min timeout.

**Open question for Codex (§10):** should externals be **HEAD-only** (skip the GET confirm) to
halve worst-case per-host cost and reduce third-party load? Given we already treat 405 (a common
HEAD rejection) as `unconfirmed`, HEAD-only externals lose little precision (a host that 405s HEAD
is unconfirmed either way) while cutting the dead-host cost in half. Recommendation: adopt HEAD-only
for externals *if* Codex agrees the precision loss is acceptable; otherwise keep HEAD→GET behind the
soft budget. Either way the soft budget is the hard guarantee.

## 6. Config / env (all `parsePositiveInt`, default-only unless set)

| Var | Default | Purpose |
|---|---|---|
| `BROKEN_LINK_EXTERNAL_MAX_CHECKS` | 300 | Max distinct external targets verified per run |
| `BROKEN_LINK_EXTERNAL_TIMEOUT_MS` | 8000 | Per-request timeout for external checks (shorter than the 10 s internal default) |
| `BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS` | 300000 | Soft wall-clock cap on the external pass; overflow → `partial` |

Existing `BROKEN_LINK_CONCURRENCY` (4) and `BROKEN_LINK_HOST_DELAY_MS` (250) are reused. Document
all three new vars in the `er-seo-tools-config-and-flags` skill in the same PR.

## 7. Testing strategy

- **`resolveUrl`/derivation unit tests:** external target with status 404/410/500 → broken;
  401/403/405/429 → unconfirmed; timeout/network/SafeUrlError → unconfirmed. Internal target with
  403 still → broken (proves the internal path is untouched).
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
   classification, findings, severity (`critical`). Externals are a strictly additive second pass.
2. **Externals never consume the internal 2000 cap** — separate query, separate cap, separate cache.
3. **The external pass is deterministically time-bounded** — soft budget guarantees the 15-min job
   timeout is never exceeded by external work; overflow degrades to `partial`, never a job failure.
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

## 10. Open questions routed to Codex

1. **HEAD-only for externals?** (§5) — precision loss vs halved dead-host cost + reduced third-party
   load. Recommendation: yes, given 405→unconfirmed already.
2. **Per-pass confidence mechanism** (§4.4) — `confidenceByType` map vs split emit calls. Which is
   cleaner without duplicating the run/page keying logic?
3. **Soft-budget granularity** — absolute 5-min external budget vs a budget derived from remaining
   job time. Recommendation: absolute (simple, internal pass has headroom).
4. **Is the default external cap (300) + 8 s timeout + 5-min budget the right combination** for the
   15-min job timeout with real-site external-host distributions? Sanity-check the arithmetic.
