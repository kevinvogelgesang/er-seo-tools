# Streaming Parse Concurrency (Design)

**Status:** Codex-reviewed (accept-with-fixes; all 8 folded in) · **Date:** 2026-07-04 · **Author:** streaming-concurrency session
**Roadmap item:** C7 Phase-3 payoff — parse the uploaded Screaming Frog CSVs
**concurrently** now that C7 pt3 (streaming parse, PR #95) made per-file memory bounded.
**Roadmap source:** `docs/superpowers/nyi/improvement-roadmaps/01-seo-parser.md` §Phase 3
("stream rows instead of whole-file loads"; **"Don't parallelize parsing before
streaming it"**). Streaming shipped 2026-07-03, so this future item is now unblocked.

## 1. Problem

The SEO-parser parse route parses uploaded CSVs **strictly one at a time**.
`app/api/parse/[sessionId]/route.ts:174–178`:

```ts
for (const filename of sessionFiles) {
  const outcome = await parseOne(filename);   // fully awaited before the next starts
  reports.push(outcome.report);
  if (outcome.success) successes.push(outcome.success);
}
```

A real crawl (e.g. Manhattan, 49 CSVs) has several multi-MB big-file exports
(`all_outlinks` 10 MB, `all_anchor_text` 3.6 MB, plus `images`/`links_issues`) that
each take real wall-clock to stream-parse. Parsing them sequentially serializes that
time. Since C7 pt3 converted the 4 big-file parsers to row-by-row streaming
(`StreamingParser` base + `streamCsv`, Papa `NODE_STREAM_INPUT`), each parse now has
**bounded** memory (~751 MB peak for a ~500 MB file in the C7 pt3 harness, vs a
whole-file OOM). Bounded per-file memory is exactly the precondition the roadmap
required before parallelizing — so we can now run parses concurrently under a small
fixed cap and cut wall-clock parse time on multi-big-file crawls.

### 1.1 Why this is safe (the key structural fact)

During the *parsing* phase, no parser touches shared mutable state:

- Each streaming parser folds rows into its **own** instance accumulators
  (`StreamingParser` subclass fields); each whole-file parser folds into its own
  `BaseParser.data`. Two parser instances never share memory.
- The shared `AggregatorService` (`lib/services/aggregator.service.ts`) is written
  **only after** parsing, in a **separate** loop (`route.ts:180–184`), via
  `addParserResult`. `aggregate()` reads only that already-populated map.

So parse *execution* has no cross-file data dependency and is safe to parallelize.
The one thing that is order-sensitive is aggregator *ingestion* — see §4.

## 2. Goals / Non-goals

### Goals
- G1. Parse multiple files concurrently under a **bounded** limit, reducing wall-clock
  parse time on multi-big-file crawls.
- G2. **Byte-identical aggregated output** vs the current sequential path (proven by
  the existing aggregator golden suites staying green — not merely asserted).
- G3. **Process-wide** memory bound: at most N concurrent parses across *all*
  simultaneous uploads, so two analysts uploading at once cannot stack 2N big-file
  streams against the 2400M PM2 ceiling (shared with the site-audit/Lighthouse
  workload).
- G4. Preserve per-file failure isolation (C7 pt1): one file's parse failure never
  aborts the batch; every file still produces a `FileReport`.
- G5. No change to the upload UX — parse stays synchronous (request/response),
  inline in the route handler.

### Non-goals (locked with Kevin, 2026-07-04)
- N1. **No two-tier pool.** We do NOT classify small vs big files into separate
  concurrency pools. A single flat limit governs all `parseOne` calls. (The cheap
  whole-file parsers finish fast and release their slot; a separate pool is
  complexity with little payoff — YAGNI.)
- N2. **No memory-aware / dynamic capping.** No `process.memoryUsage()` gating. A
  fixed env-tunable cap is deterministic and testable; dynamic capping is
  over-engineered here.
- N3. **No job-queue move.** Parsing stays in the request handler (the C7 pt3
  "keep-synchronous" decision holds). This feature parallelizes *within* the
  still-inline request; it does not move parsing to `lib/jobs/`.
- N4. **No parser, aggregator, schema, route-contract, or output-shape change.**
  `parseOne` itself is unchanged; only the loop that drives it changes. No migration.
- N5. **`InternalParser` is not touched** (still deferred per C7 pt3; small file).
- N6. **No new runtime dependency.** No `p-limit`/`p-map`. The repo hand-rolls
  bounded concurrency everywhere (`BROKEN_LINK_CONCURRENCY` workers, PSI, the queue
  manager); we follow that convention.

## 3. Scope: the single insertion point

The entire feature is: replace the sequential `for...of` loop
(`route.ts:174–178`) with a **bounded-concurrency map** over the *unchanged*
`parseOne` closure (`route.ts:125–170`), plus one small new concurrency helper.

`parseOne` is already `async`, fully self-contained, and swallows its own errors into
a `FileOutcome` (a `FileReport` + optional `ParseSuccess`) via the `failed(...)`
helper — it **never rejects**. So parallelizing it needs no change inside it.

## 4. The ordering invariant (correctness-critical)

Parse *execution* becomes concurrent, but aggregator *ingestion* MUST remain
deterministic in the original `sessionFiles` order. Reason: `mergeParserData`
(`aggregator.service.ts:77–112`) has order-sensitive branches when two files map to
the same `parserKey`:

- **latest-wins** on scalar values (`:106–108`),
- **latest-wins** on `per_url_index` keyed by URL (`:88–94`),
- **`total*` numeric summing** (`:104–105`, order-independent for sums but still fed
  from the collected array).

The domain tally (`route.ts:192–202`) and `parsers_used` (`:187`) also consume the
collected `successes` array and must see it in file order.

**Mechanism.** Run `parseOne` over `sessionFiles` under the semaphore, collecting each
outcome into a **position-indexed array** (`results[i] = await parseOne(files[i])`).
After all settle, walk the array in index (= file) order to build `reports` and
`successes`. The existing ingestion loop (`route.ts:180–184`), domain tally, and
`parsers_used` are then **byte-for-byte unchanged** and still ordered. → identical
aggregated output, only faster.

This is the same guarantee the current code already provides (ingestion is already a
separate ordered loop); we simply keep it while making execution concurrent.

## 5. Architecture — one small new unit

### 5.1 `lib/parsers/parse-limit.ts` (new)

A module-scoped bounded-concurrency runner built from a small, independently-testable
`Semaphore` primitive. Exports:

- `parseConcurrencyFromEnv(raw: string | undefined): number` — pure helper that coerces
  `process.env.PARSE_CONCURRENCY` to an integer and clamps to `>= 1`, falling back to
  the default **2** on undefined / zero / negative / `NaN` (a bad value must never
  deadlock). Exported so it can be unit-tested directly without mutating a frozen
  module constant.
- `PARSE_CONCURRENCY: number` — `parseConcurrencyFromEnv(process.env.PARSE_CONCURRENCY)`,
  read once at module load.
- `class Semaphore` — minimal FIFO permit primitive; `new Semaphore(size)`, `acquire():
  Promise<void>` (resolves when a permit is free), `release()` (hands the permit to the
  next FIFO waiter or increments the free count). No timers, no external deps.
  Constructor-injectable `size` makes the cap unit-testable at arbitrary N.
- `mapWithConcurrency<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]>`
  — the per-request driver; resolves to results in **input order** (result `[i]` ⟷
  `items[i]`, regardless of completion order). It takes no `limit` argument — the cap is
  owned by the module.

**Scheduling — a per-call worker pool, NOT enqueue-all (Codex #1).** A naive
`items.map(async item => { await sem.acquire(); … })` would enqueue *all* N tasks as FIFO
waiters up front, so a 49-file upload parks 49 waiters ahead of a second request's tasks —
the cap is preserved but the second upload is starved behind head-of-line blocking. Instead
`mapWithConcurrency` runs a **per-call pool of at most `PARSE_CONCURRENCY` local workers**;
each worker pulls the next unclaimed index, `await`s a permit from the shared semaphore
**just-in-time**, runs `fn`, releases in `finally`, and loops until the index cursor is
exhausted. This bounds the shared FIFO queue to ~`PARSE_CONCURRENCY` waiters per in-flight
call (≤ 4 total for two concurrent uploads), so concurrent uploads interleave fairly instead
of one draining fully first.

**Global scope (how the cap is enforced).** `parse-limit.ts` instantiates exactly **one**
`Semaphore(PARSE_CONCURRENCY)` at module load. Every worker — across every concurrent
`/api/parse` request — acquires a permit from that single instance. When a single upload
runs alone, its `PARSE_CONCURRENCY` workers each hold a permit → full utilization; when two
uploads overlap, their combined `2×PARSE_CONCURRENCY` workers contend for the same
`PARSE_CONCURRENCY` permits → total in-flight stays capped process-wide (G3). Permits always
release in `finally`, so a throwing task cannot leak a permit.

**Rejection contract (Codex #2).** `mapWithConcurrency` is a generic helper: if `fn`
rejects, the helper rejects — but only *after* every already-started worker settles, so no
background parse keeps running past the caller's `catch` (defense in depth). For THIS
feature the contract is moot in practice: `parseOne` try/catches every failure into a
`FileOutcome` and never rejects, so the batch always completes with one outcome per file.
The settle-before-reject behavior exists so the primitive stays correct if a future caller
passes a throwing `fn`.

### 5.2 The route change (`route.ts:172–184`)

Before:
```ts
const reports: FileReport[] = [];
const successes: ParseSuccess[] = [];
for (const filename of sessionFiles) {
  const outcome = await parseOne(filename);
  reports.push(outcome.report);
  if (outcome.success) successes.push(outcome.success);
}
```
After (shape):
```ts
const outcomes = await mapWithConcurrency(
  sessionFiles, (filename) => parseOne(filename),
);
const reports: FileReport[] = [];
const successes: ParseSuccess[] = [];
for (const outcome of outcomes) {          // outcomes are in sessionFiles order
  reports.push(outcome.report);
  if (outcome.success) successes.push(outcome.success);
}
```
Everything from `route.ts:180` onward (aggregator ingestion, `aggregate()`, domain
tally, `$transaction` write, findings dual-write, pillar fire) is **untouched**.

## 6. Data flow

```
sessionFiles ─► mapWithConcurrency(files, parseOne)   // ≤PARSE_CONCURRENCY workers/call
                   │  each worker: pull next index ─► acquire shared permit (JIT)
                   │               ─► parseOne ─► release (finally) ─► loop
                   ▼
              outcomes[] (input order)
                   │  (ordered walk)
                   ▼
        reports[]  +  successes[]   ── unchanged from here ──►
                   ▼
        aggregator.addParserResult (ordered)  ►  aggregate()  ►  $transaction write
```

## 7. Error handling / failure isolation

- `parseOne` try/catches every failure into `failed(filename, msg)` and returns a
  `FileOutcome`; it does not reject. So `mapWithConcurrency` sees only resolved
  promises and the batch always completes — per-file isolation (C7 pt1) is preserved
  for free.
- Each worker releases its permit in a `finally`, so even a hypothetical throw (future
  refactor of `parseOne`) cannot deadlock the pool. The helper's generic contract
  (§5.1, Codex #2): if `fn` ever rejects it rejects *after* started workers settle
  (no orphaned background parse), never dropping or reordering the outcomes that did
  resolve — each lands at its input index.
- No new user-facing error surface; `metadata.file_reports` is produced exactly as
  before.

## 8. Configuration

- **`PARSE_CONCURRENCY`** — new env var, default **2**. Documented in the config skill
  (`er-seo-tools-config-and-flags`) alongside `SITE_AUDIT_CONCURRENCY`, `PSI_CONCURRENCY`,
  `BROKEN_LINK_CONCURRENCY`. Not required in prod (has a safe default), so it does NOT
  add to `instrumentation.ts` fail-fast — no Kevin pre-deploy `.env` step needed.
- Sizing rationale (Codex #6 — stated honestly, not as a safety proof): cap 2 is a
  **conservative default grounded in the observed per-parser bound** (~751 MB peak for
  a ~500 MB stream in the C7 pt3 harness). It is NOT a hard headroom guarantee:
  `2 × 751 ≈ 1.5 GB` against the 2400M PM2 ceiling leaves ~900 MB for the Node
  baseline, aggregation, Prisma, and any co-scheduled site-audit/Lighthouse work — real
  crawls rarely hit the harness peak, but a pathological pair of huge uploads
  co-scheduled with a site audit could pressure the ceiling. The mitigation is the
  env knob: **drop `PARSE_CONCURRENCY` to 1** on a box under heavy co-scheduled load.
  Default 2 is the balance for the common case (few analysts, uploads rarely overlap
  site audits).

**Runtime assumption (Codex #7).** The process-wide cap holds because the app runs as a
**single long-lived Node process** (RunCloud + PM2 fork mode, per the frozen core stack) —
one module instance ⇒ one `Semaphore`. It is NOT valid under multi-process/cluster or
serverless (each worker would get its own semaphore). The parse route already requires the
Node runtime (`fs`, Prisma, `streamCsv`); this feature adds no new constraint, but the plan
notes the assumption so it isn't silently broken by a future runtime change.

## 9. Testing

### 9.1 New: `lib/parsers/parse-limit.test.ts`
- **`Semaphore` respects the cap:** driving a batch through `new Semaphore(N)` with a
  probe counter (increment on acquire, decrement on release) asserts max concurrent
  ≤ N, for N = 1, 2, 3.
- **`Semaphore` FIFO / no leak on throw:** a task that rejects still releases its
  permit (subsequent waiters proceed; no deadlock).
- **`mapWithConcurrency` preserves input order:** tasks that resolve out of order
  still produce results in input order (`results[i]` ⟷ `items[i]`).
- **`mapWithConcurrency` completes all tasks:** every item's result is present.
- **Process-wide cap:** two overlapping `mapWithConcurrency` invocations (simulating
  two simultaneous uploads) never exceed `PARSE_CONCURRENCY` total in flight —
  proving the single shared semaphore is module-scoped, not per-call.
- **Overlap fairness (Codex #8):** a second `mapWithConcurrency` call started while a
  large first call is mid-flight begins making progress *before* the first drains all
  its items — proving the per-call worker pool + JIT acquire avoids head-of-line
  starvation (would fail under the naive enqueue-all scheme).
- **`parseConcurrencyFromEnv` clamp:** `undefined`/`"0"`/`"-3"`/`"abc"` → default 2;
  `"3"` → 3. Tested against the pure helper, not by mutating the frozen constant.

### 9.2 Extend: `app/api/parse/[sessionId]/route.test.ts`
- **Ordered ingestion, observed at the aggregator (Codex #3):** `route.test.ts` mocks
  `AggregatorService`, so the golden aggregator suites do NOT prove the *route* fed
  `addParserResult` in file order. Extend the mock to **record every
  `addParserResult(parserName, data, filename)` call** and assert the call order equals
  `sessionFiles` order even when parses complete out of order. Also assert
  `reports` / `successes` / `parsers_used` land in file order.
- **Make out-of-order completion real (Codex #4):** a fake parser's `parse()` is
  synchronous, so "resolves out of order" must be induced at the I/O boundary — mock
  `fs.readFile` (whole-file path) and/or `streamCsv` (streaming path) with per-file
  delays (e.g. the file listed *first* resolves *last*), so the concurrency actually
  reorders completion and the ordering assertion is meaningful.
- **Domain-tie tie-break (Codex #5):** with two files of equal primary-domain count
  completing out of order, assert `metadata.site_name` resolves to the same domain as
  the sequential path (the sort is stable + fed from the file-ordered `successes`, so
  insertion order is the tie-break — pin it).
- **Concurrency bound:** assert at most `PARSE_CONCURRENCY` parses run concurrently for
  a multi-file session (a probe incremented on parse entry / decremented on exit,
  injected via the delayed I/O mock).

### 9.3 Guard suites (must stay green, unchanged)
- `lib/services/aggregator.service.test.ts` + `aggregator.keyword-gaps.test.ts` +
  `aggregator.structured-recs.test.ts` — the golden guard that final aggregated
  output is byte-identical to sequential.
- `lib/parsers/papa-parity.test.ts` — row-identity guard (unaffected, but part of the
  gate).

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Concurrency perturbs aggregated output | Ordering invariant §4 + aggregator golden suites stay green. |
| Two simultaneous uploads OOM | Module-scoped (process-wide) semaphore, §5.1 (G3). |
| Permit leak on error | `finally`-release + explicit throw test (§9.1). |
| Minification / prod-only divergence | No `.toString()`-injected code, no `Class.name` reliance, no new parser keys. No minification-survival concern. |
| Migration risk | None — no schema change. |

## 11. Out of scope (YAGNI, explicit)
- Two-tier small/big pools (N1); memory-aware dynamic cap (N2); durable-queue move
  (N3); `InternalParser` streaming (N5); new dependency (N6); any change to parser
  output, aggregator merge logic, or downstream surfaces (N4).
```
