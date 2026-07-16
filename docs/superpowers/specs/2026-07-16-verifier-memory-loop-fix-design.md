# Verifier memory/loop fix — design

**Date:** 2026-07-16 · **Status:** draft (pre-Codex)
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

`onBrokenLinkVerifyExhausted` (in addition to its existing notify behavior)
writes a **minimal placeholder live-scan CrawlRun** directly with
`prisma.crawlRun.create` — deliberately NOT `writeFindingsRun`, whose
delete-and-recreate would clobber a real run if one raced in:

```
{ id: randomUUID(), tool: 'seo-parser', source: 'live-scan',
  siteAuditId, domain (from the SiteAudit row), clientId,
  status: 'partial', score: null, scoreBreakdown: null,
  pagesTotal: 0, seoIntent: false,
  startedAt: now, completedAt: now,
  ...all analytics JSON columns null }
```

- `@@unique([siteAuditId, tool])` makes this race-safe: if a real run exists
  (or lands first), the create P2002s → catch → no-op. If a placeholder lands
  first and a later recovered/manual build succeeds, `writeFindingsRun`'s
  delete-and-recreate **replaces** the placeholder with the real run
  (self-heal upgrade).
- Wrapped so it never throws from `onExhausted` (worker contract). A failed
  placeholder write is retried at the next exhaustion cycle — the loop
  degrades to "slow retry" rather than crash-loop only in the doubly-unlucky
  case (memory fix failed AND placeholder write failed), and each cycle is
  bounded by 2 × 15-min attempts, not a tight restart loop.
- Transient rows are left for the existing sweeps (`pruneHarvestedLinks` /
  `pruneHarvestedPageSeo` 7-d backstops). No `contentAuditRetainUntil` stamp
  exists on this path, so `sweepExpiredContentAudit` is not in play.

### 3.2 Why this breaks the loop

`recoverBrokenLinkVerifies` skips any audit with a `seo-parser` run — both at
the DB-level `crawlRuns: { none: { tool: 'seo-parser' } }` bound and the
per-id `if (liveRun) continue` guard. The placeholder satisfies both. It also
closes the acknowledged unbounded re-enqueue for seoOnly-complete audits
(the "Codex note (re-enqueue bound)" in `broken-link-recovery.ts`).

### 3.3 Honesty audit of the placeholder (each verified in code)

| Surface | Behavior with placeholder | Verdict |
|---|---|---|
| Canonical selection (`pickCanonicalSeo`) | Candidates require `source==='live-scan' && seoIntent===true`; placeholder writes `seoIntent: false` **regardless of the audit's flag** → never canonical-eligible, can never displace an SF or real live run | safe |
| C21 sweep (`classify.ts`) | `runStatus === 'partial'` → `partial` coverage: may prove NEW (there are zero findings, so none), **never** fewer/resolved. No false downward claims in the digest | safe |
| Results page `OnPageSeoSection` | `analyzed` probe = run has a CrawlPage with `statusCode != null`; placeholder has zero pages → "not yet analyzed" state | safe (wording says "runs shortly after the audit completes" — acceptable; a copy tweak is optional, not required) |
| `BrokenLinksSection` | zero `broken_*` findings + run present → renders its not-verified/clean state per its own probes; no fabricated "clean" claim beyond what an empty-findings run already means. Verify in tests which state renders and assert it is NOT the affirmative verified-clean one if that state keys on run presence alone | verify in build |
| seoOnly routing (`seo-only-view.ts`) | run exists → redirect to run results page (honest empty sections) instead of an infinite `SeoPhaseBanner` | improvement |
| Prospect sales report | latest-REPORTABLE = complete + ¬seoOnly + has seo-parser run → a failed-verifier prospect audit becomes reportable with empty SEO section (overallScore already excludes null headline values). Alternative is "being prepared" forever — worse | accept + document |
| `sweepExpiredContentAudit` EXISTS-guard | guard requires a seo-parser run before sweeping retained `HarvestedPageSeo`; placeholder satisfies it, but no `retainUntil` stamp exists on the exhaustion path → rows wait for the 7-d prune, unchanged | safe |

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
are finalized, and re-runs after the fix to prove the bound. Acceptance
target: post-fix builder marginal peak (rss delta over baseline) **< 500MB**
on the synthetic worst case.

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
   `(sourcePageUrl, targetUrl)` pairs with URL strings interned via a
   `Map<string, string>` canonical-instance table. This single array is then
   fed to all three current consumers — `mapValidationFindings`,
   `computeLinkGraph` (its edge input; it dedupes internally anyway so
   deduped input is semantics-preserving), and `computeDiscoveryCoverage` —
   replacing three independent full copies. Pair-level dedup is
   semantics-preserving for all three (graph dedupes edges; coverage reads
   distinct targets; validation aggregates per (page,type) so identical pairs
   collapse to identical hits — characterization-tested).
3. Incremental `harvestTruncated` OR-flag; unique-target running count for the
   `capped` flag.

The full Prisma row array is never retained; peak = chunk size + compact
structures.

### 4.2 Stage B — content passes

1. **`computeContentSimilarity` internal refactor (output-identical):** in the
   eligibility loop, compute the sha256 of `norm` and the shingle-hash array
   per page immediately and **discard `tokens`/`norm`** — nothing downstream
   uses them (exact-dup groups need only the hash; refinement needs only
   shingle arrays). Kills the dominant retention. The DF map stays (needed for
   the boilerplate filter) but is bounded by distinct shingles of the pages
   actually retained. Pinned fixtures must pass unchanged — this is the proof
   the refactor is pure.
2. **Total-text budget:** the builder loads `contentText` under a byte budget
   (`CONTENT_TEXT_TOTAL_BYTE_BUDGET`, default calibrated by the profiling
   task, ~24MB) in deterministic url order; pages past the budget get
   `contentText: null` (they read as `noText`-skipped in each pass's existing
   accounting) and a builder log line records the truncation. `contentText`
   is selected in a separate chunked query, not in the main scalar query.
3. **Topic-overlap prefix fix:** slice to `TOPIC_OVERLAP_BODY_CHARS` BEFORE
   the retained copy (compute `bodyPrefixTruncated` from the original
   length), eliminating the per-page full-text `.trim()` copy.
4. **RSS guard (systemic backstop):** each optional-analytics gate (content
   signals, topic overlap, similarity; the graph's existing try/catch gets
   one too) additionally checks `process.memoryUsage().rss` against
   `VERIFIER_RSS_GUARD_MB` (default 1600). Over the guard → skip that pass
   fail-to-null with a `[live-seo]` log line. This is what makes "unknown
   balloon" a degraded run instead of a dead process. Injectable via
   `VerifyDeps` for tests.

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
- Unit: placeholder-run write (P2002 no-op path, never-throws, seoIntent
  false, notify still enqueued); recovery no-re-enqueue with placeholder
  present (extends `broken-link-recovery` tests); RSS-guard skip paths via
  injected deps; similarity fixtures unchanged; topic-overlap truncation flag
  parity.
- The profiling script's before/after table is PR evidence, not a CI gate.
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
