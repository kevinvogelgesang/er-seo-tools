# Verifier memory/loop fix — design

**Date:** 2026-07-16 · **Status:** Codex-reviewed (accept with named fixes; all
7 applied in place — marked "Codex #N" below)
**Blocks:** C21 weekly-sweep deploy (the sweep queues ~20-30 full audits every
Monday night; each fires a verifier — the exact load shape that took prod down).

## 1. Problem

The 2026-07-16 prod incident: on large audits (~500+ pages; 54k-78k
`HarvestedLink` rows) `runBrokenLinkVerify` pushes the Node process past PM2's
`max_memory_restart` (2400M) in two independent stages:

- **(a) link stage** — the unbounded `harvestedLink.findMany` retains the full
  row array for the whole function, plus three derived full copies
  (`internalLinks` for the validation mapper, the `rows.map` fed to
  `computeLinkGraph`, the `rows.filter().map` fed to
  `computeDiscoveryCoverage`), on top of the graph's own adjacency maps.
- **(b) content stage** — kills continued with `HarvestedLink` = 0 rows
  (post-C12-D1, `HarvestedPageSeo` survives a successful build), so the content
  passes balloon independently. Prime suspect by code reading:
  `computeContentSimilarity` retains a token array (~5k small strings/page) and
  a joined `norm` string per eligible page for its entire run, plus a
  document-frequency `Map` keyed by up to (pages × ~5k) distinct shingle
  hashes. Secondary: `topic-overlap`'s `withText` retains a full-text `.trim()`
  copy per page before slicing to 2000 chars; ONNX embed (external/wasm memory
  counts in RSS). The verifier also runs while `site-audit-page` jobs
  (concurrency 2) hold their own working sets, so its budget is the *marginal*
  headroom, not the whole heap.

PM2 kills the process mid-attempt → the claim's attempt counter exhausts
`maxAttempts` (2) → job flips `error` → **`recoverBrokenLinkVerifies()`
re-enqueues a FRESH job** (predicate: complete audit + transient rows [or
seoOnly-complete] + no `seo-parser` run + no *active* verify job — an errored
job is not active) → the fresh job dies the same way. Self-sustaining
kill-loop; 180 restarts; prod down for hours. **The loop, not the memory, is
the outage-class defect.** Both must be fixed; the loop fix must hold even if
the memory bounds are wrong.

## 2. Goals / non-goals

Goals:
1. A repeatedly-dying verifier becomes **terminal** after exhaustion — recovery
   can never re-enqueue it, and every read surface stays honest about the
   missing SEO data.
2. The builder's peak *retained* memory is bounded and roughly independent of
   harvested-row count; optional analytics degrade to null under pressure
   instead of killing the process.
3. Measured evidence (local profiling) of which sub-stage balloons and that the
   fix bounds it — not just plausible reasoning.

Non-goals: changing verification semantics (caps, ordering, findings output on
the happy path must stay byte-identical — characterization-tested); changing
the recovery architecture; new schema/migrations; touching the frozen
`lib/seo-fetch` layer.

## 3. Fix 1 — terminal exhaustion via a minimal placeholder run

### 3.1 Mechanism

A new shared helper **`ensureExhaustedPlaceholder(siteAuditId)`** (Codex #1)
writes a **minimal placeholder live-scan CrawlRun** directly with
`prisma.crawlRun.create` — deliberately NOT `writeFindingsRun`, whose
delete-and-recreate would clobber a real run if one raced in:

```
{ id: randomUUID(), tool: 'seo-parser', source: 'live-scan-placeholder',
  siteAuditId, domain (from the SiteAudit row), clientId,
  status: 'partial', score: null, scoreBreakdown: null,
  pagesTotal: 0, seoIntent: false,
  startedAt: now, completedAt: now,
  ...all analytics JSON columns null }
```

The distinct **`source: 'live-scan-placeholder'`** (Codex #2) is the
discriminator read surfaces use to say "SEO analysis unavailable" instead of
inferring success from run existence. Recovery's predicates only require
`tool: 'seo-parser'`, so the loop still breaks; canonical selection only
accepts `source === 'live-scan'`, so the placeholder is doubly ineligible
(belt: `seoIntent: false`).

- `@@unique([siteAuditId, tool])` makes this race-safe: if a real run exists
  (or lands first), the create P2002s → catch → no-op. If a placeholder lands
  first and a later recovered/manual build succeeds, `writeFindingsRun`'s
  delete-and-recreate **replaces** the placeholder with the real run
  (self-heal upgrade).
- `onBrokenLinkVerifyExhausted` calls `ensureExhaustedPlaceholder` **before**
  its notify enqueue, each in its own catch (Codex, closing note): a notify
  failure can never prevent terminality, and vice versa. Never throws from
  `onExhausted` (worker contract).
- Transient rows are left for the existing sweeps (`pruneHarvestedLinks` /
  `pruneHarvestedPageSeo` 7-d backstops). No `contentAuditRetainUntil` stamp
  exists on this path, so `sweepExpiredContentAudit` is not in play.

### 3.2 Why this breaks the loop — and the self-repair fence (Codex #1)

`recoverBrokenLinkVerifies` skips any audit with a `seo-parser` run — both at
the DB-level `crawlRuns: { none: { tool: 'seo-parser' } }` bound and the
per-id `if (liveRun) continue` guard. The placeholder satisfies both. It also
closes the acknowledged unbounded re-enqueue for seoOnly-complete audits
(the "Codex note (re-enqueue bound)" in `broken-link-recovery.ts`).

**Hook-only terminality has a hole:** `runOnExhausted()` treats hooks as
best-effort and swallows failures (`lib/jobs/registry.ts`). If the
placeholder insert fails (transient SQLITE_BUSY at the worst moment), the
next recovery pass would see no run and enqueue a fresh verifier — the loop
survives. So recovery itself becomes the self-repair path: in the per-id
body, after the active-job check (active jobs still take precedence), if a
**terminal errored `broken-link-verify` job** exists for the audit's group,
recovery calls `ensureExhaustedPlaceholder` and **does not enqueue a fresh
verifier that pass**. The placeholder stays the durable source of truth;
a failed hook write is repaired by the next sweep without another OOM cycle.
(Job error rows are pruned at 30 d — long after the placeholder has landed;
the fence only needs to hold until one placeholder write succeeds.)

### 3.3 Read-surface contract for the placeholder (Codex #2)

Codex's review found the original "empty run renders honestly" claims wrong on
two surfaces; the `live-scan-placeholder` source discriminator exists so every
consumer can distinguish "verifier gave up" from "verified, nothing found".
The rule: **a placeholder run is treated as "SEO analysis unavailable" —
never as a clean/complete result — on every surface below.**

| Surface | Behavior + required change |
|---|---|
| Canonical selection (`pickCanonicalSeo`) | Candidates require `source==='live-scan' && seoIntent===true`; placeholder fails both (`live-scan-placeholder` + `seoIntent:false`) → never canonical-eligible. No code change | 
| C21 sweep (`classify.ts` / `snapshot.ts`) | Loads by `(siteAuditId, tool)`, `runStatus === 'partial'` → `partial` coverage: may prove NEW (zero findings → none), **never** fewer/resolved. No false downward claims in the digest. No code change; characterization test pins it |
| `BrokenLinksSection` | **Currently DISHONEST**: renders "Verified — no broken links" for any empty partial run (`BrokenLinksSection.tsx:138`). CHANGE: placeholder source → an explicit "SEO analysis unavailable — the post-scan verifier failed; re-run the audit" state |
| Results page `OnPageSeoSection` | `analyzed` probe (CrawlPage with `statusCode != null`) already lands in "not yet analyzed" for a zero-page run, but the copy promises it "runs shortly". CHANGE: placeholder source → same explicit unavailable state (not a forever-pending promise) |
| seoOnly routing (`seo-only-view.ts`) | Run exists → redirect to run results page instead of an infinite `SeoPhaseBanner` — an improvement — but the run page must show the unavailable state per the two rows above |
| Prospect sales report (`prospects.ts` reportable flag, `sales-report-data.ts` latest-REPORTABLE) | **Pinned behavior:** a prospect audit whose only seo-parser run is a placeholder IS reportable (never "being prepared" forever), rendering an **ADA-only report with an explicit "SEO analysis unavailable" note in the SEO section** — never a silently-empty SEO section, and the null SEO score already stays out of `overallScore`'s denominator |
| Content-audit mint (`POST …/content-audit/mint-token`) | Mint guard requires a live-scan run; CHANGE: placeholder source → refuse mint (409, same family as its existing guards) — there is no run data to audit |
| Completion email (`lib/notify/content.ts`) | Builder "tolerates a missing SEO run"; CHANGE: treat a placeholder exactly as a missing run (no fabricated zero-issue SEO block) |
| Share views (`SiteAuditResultsShell` shareMode) | Renders the same SEO-tab sections → inherits the fixed section states above. Covered by the section changes; test in shareMode |
| `sweepExpiredContentAudit` EXISTS-guard | Guard requires a seo-parser run before sweeping retained `HarvestedPageSeo`; placeholder satisfies it, but no `retainUntil` stamp exists on the exhaustion path → rows wait for the 7-d prune, unchanged |

Implementation note: consumers get ONE shared helper (e.g.
`isPlaceholderRun(run)` keyed on the source value) — never N inline string
comparisons.

### 3.4 Rejected alternatives

- **Recovery-side suppression** (skip audits with a recent errored verify
  job): time-window semantics, errored Job rows pruned at 30 d, leaves every
  read surface waiting forever, and adds a second source of truth for
  "verifier gave up". Weaker on all axes.
- **Schema column** (`SiteAudit.verifierExhaustedAt`): explicit but needs a
  migration, a predicate change, and its own read-surface handling — strictly
  more surface for the same effect the run row already provides.

## 4. Fix 2 — bounded memory

### 4.0 Measurement first (plan task 1)

A local profiling script (`scripts/profile-verifier-memory.ts`, dev-only,
never deployed) seeds a synthetic worst case into the local DB (1000 pages ×
300 links/page ≈ 300k HarvestedLink rows; 1000 HarvestedPageSeo rows × 30KB
contentText) and runs the builder stage-by-stage with
`process.memoryUsage()` (rss + heapUsed) logged at each stage boundary, using
injected no-network `VerifyDeps`. Output: a per-stage peak table recorded in
the PR. This validates the balloon hypotheses BEFORE the bounding constants
are finalized, and re-runs after the fix to prove the bound.

Codex #7 — memory is not the only axis: `HarvestedLink`'s indexes are
`(siteAuditId)` and `(siteAuditId, targetUrl)` only, which do NOT cover the
full keyset order, so the chunked scan could trade OOM for a 15-min-ceiling
timeout. The script therefore ALSO records per-stage wall-clock, chunk count,
and the `EXPLAIN QUERY PLAN` of the keyset query (via `$queryRawUnsafe`
locally). If the plan shows a full sort per chunk, the fallback is an
`(siteAuditId, targetUrl, kind, sourcePageUrl, id)`-compatible index or an
id-ordered scan with in-memory ordered merge — decided from the measurement,
in the plan.

Acceptance targets: post-fix builder marginal peak (rss delta over baseline)
**< 500MB** AND total builder wall-clock comfortably inside the 15-min job
ceiling on the synthetic worst case (network mocked to near-zero latency, so
the measured number isolates the scan/compute cost).

### 4.1 Stage A — stream + intern + share the link load

Replace the two unbounded `harvestedLink.findMany` calls (internal+image, and
external) with keyset-paginated streaming (chunks of ~5000; existing
deterministic `orderBy` + `id` tiebreaker cursor). One pass builds ONLY:

1. **`toCheck`** — the capped dedup list. Rows arrive ordered by
   `(targetUrl, kind, sourcePageUrl)`, so (kind,target) groups are contiguous;
   dedup is incremental; per-target source samples keep the
   `URLS_PER_FINDING` cap. First-seen order and cap subset must match the
   current implementation exactly (characterization test).
2. **`internalPairs`** — ONE deduped array of distinct internal-link
   `(sourcePageUrl, targetUrl, occurrences)` entries with URL strings interned
   via a `Map<string, string>` canonical-instance table, replacing three
   independent full copies fed to `mapValidationFindings`, `computeLinkGraph`,
   and `computeDiscoveryCoverage`. **Codex #3 — multiplicity is load-bearing:**
   `mapValidationFindings` pushes every matching link occurrence and counts
   `targets.length`, and `HarvestedLink` has no uniqueness constraint, so
   duplicate rows exist and naive dedup would change `redirect_chain` /
   `redirect_loop` counts. The compact entry therefore carries an
   `occurrences` count, and the validation-mapper adapter re-expands (or the
   mapper accepts weighted input) so counts and samples are byte-identical.
   Graph and coverage are genuinely multiplicity-insensitive (graph dedupes
   edges into sets; coverage reads distinct targets). A **duplicate-pair
   characterization fixture** proves all three.
3. Incremental `harvestTruncated` OR-flag; unique-target running count for the
   `capped` flag.
4. **Codex #5 — guard during growth, not only at pass entry:** the RSS check
   (§4.2.4) also runs between link chunks. On breach mid-stream, the builder
   stops retaining graph/coverage pair data (those outputs degrade to
   null/incomplete with honest flags) while PRESERVING the capped
   verification inputs — broken-link checking itself never degrades below
   its existing caps.

The full Prisma row array is never retained; peak = chunk size + compact
structures.

### 4.2 Stage B — content passes

1. **`computeContentSimilarity` internal refactor (output-identical):** in the
   eligibility loop, compute the sha256 of `norm` and the shingle-hash array
   per page immediately and **discard `tokens`/`norm`** — nothing downstream
   uses them (exact-dup groups need only the hash; refinement needs only
   shingle arrays). Kills the dominant retention. The DF map stays (needed for
   the boilerplate filter) but is bounded by distinct shingles of the pages
   actually retained. **Codex #6 — the exact contract:** the refactor must
   still scan EVERY sorted input for the `noText` / `thin` / `truncatedPages`
   counters, even past the first `maxPages` eligible pages; only
   tokenization/shingle RETENTION for out-of-cap pages may be skipped. Pinned
   fixtures must pass unchanged, AND a new fixture exceeding `maxPages` pins
   the over-cap counter behavior (existing small fixtures cannot).
2. **Total-text budget (Codex #4 — budget exclusions are NOT `noText`):** the
   builder loads `contentText` under a byte budget
   (`CONTENT_TEXT_TOTAL_BYTE_BUDGET`, default calibrated by the profiling
   task, ~24MB, measured with `Buffer.byteLength`, never `.length`) in
   deterministic url order; `contentText` is selected in a separate chunked
   query, not in the main scalar query. Pages past the budget get
   `contentText: null` — but the content modules interpret null as "content
   genuinely unavailable", so silently nulling would corrupt their coverage
   accounting. The builder therefore records the exclusion honestly: a
   `budgetSkippedPages` count + `inputCapped: true` stamped into the emitted
   `{v:1, ...}` wrappers for content-signals and similarity (additive
   optional fields), and OR'd into topic-overlap's existing `inputCapped`.
   The normalized findings/run stay complete — the byte budget alone does NOT
   flip the run to `partial` (findings never depended on contentText).
3. **Topic-overlap prefix fix:** slice to `TOPIC_OVERLAP_BODY_CHARS` BEFORE
   the retained copy (compute `bodyPrefixTruncated` from the original
   length), eliminating the per-page full-text `.trim()` copy.
4. **RSS guard (systemic backstop):** each optional-analytics gate (content
   signals, topic overlap, similarity; the graph's existing try/catch gets
   one too) additionally checks the process RSS against
   `VERIFIER_RSS_GUARD_MB` (default 1600). Over the guard → skip that pass
   fail-to-null with a `[live-seo]` log line. This is what makes "unknown
   balloon" a degraded run instead of a dead process. **Codex #5:** the seam
   is `rssBytes: () => number` on `VerifyDeps` (tests inject); the guard also
   runs between link chunks (§4.1.4) and inside `embedChunked`'s
   `shouldAbort` alongside the existing time check — an entry-only check
   cannot stop ONNX/native growth between chunks.

### 4.3 Rejected alternatives

- **Out-of-process analytics** (child process / worker_thread): worker_threads
  share the PM2-monitored RSS; a detached child escapes the memory ceiling
  by hiding from it — wrong direction. Both break the repo's single-process
  assumption.
- **Page-count feature gate** (skip all analytics above N pages): loses the
  analytics exactly on the large sites where they matter; the caps + RSS
  guard degrade only under actual pressure.

## 5. Testing

- **Characterization first:** fixture-driven test capturing the CURRENT
  builder output (findings, run JSONs, flags, cap subset) on a mid-size
  synthetic dataset; the streamed/interned rewrite must reproduce it exactly.
  Fixtures MUST include duplicate `HarvestedLink` pairs (Codex #3) and an
  over-`maxPages` similarity input (Codex #6).
- Unit: `ensureExhaustedPlaceholder` (P2002 no-op path, never-throws,
  `live-scan-placeholder` source, seoIntent false, placeholder-before-notify
  ordering with independent catches); recovery fence — placeholder present →
  no re-enqueue, AND errored-verifier-present + placeholder-write-previously-
  failed → recovery retries the placeholder and does NOT enqueue (Codex #1);
  read-surface states for placeholder runs (`BrokenLinksSection` /
  `OnPageSeoSection` unavailable states, prospect ADA-only note, mint
  refusal, email missing-run parity — Codex #2); RSS-guard skip paths via
  injected `rssBytes`; similarity fixtures unchanged; topic-overlap
  truncation flag parity; budget-exclusion accounting (`budgetSkippedPages`,
  no `noText` bleed — Codex #4).
- **Recovery drills (Codex verify list):** kill the process on the final
  verifier attempt and restart → exactly one placeholder, zero replacement
  jobs; inject a placeholder-create failure → recovery repairs without
  enqueueing.
- The profiling script's before/after table (rss + wall-clock + query plan)
  is PR evidence, not a CI gate; profile with a concurrent active audit where
  feasible to match the production overlap.
- Gates: `npm run lint` + `npm test` + `npm run build`. `npm run smoke` is
  required (ADA-pipeline-adjacent change).

## 6. Rollout

No migration. New env vars are optional-with-defaults (no
`instrumentation.ts` fail-fast additions — nothing for Kevin to pre-set).
Ships as one PR; deploys together with the already-merged C21. Post-deploy
verification: trigger one large-site audit (client site already in the
system), watch `pm2` memory through the verifier window, confirm the run
writes and RSS stays under guard; separately verify a placeholder-run path in
dev by forcing exhaustion.
