# C7 Part 3 — Streaming Parse (Design)

**Status:** Draft (Codex review pending) · **Date:** 2026-07-03 · **Author:** C7 pt3
**Roadmap item:** C7 (parser consolidation + streaming + per-file failure isolation),
decomposed into 3 PRs (isolation → consolidation → streaming). Parts 1 & 2 shipped;
this is **part 3, the memory/OOM piece**.
**Roadmap source:** `docs/superpowers/nyi/improvement-roadmaps/01-seo-parser.md` §Phase 3
("stream rows (Papa step callback) instead of whole-file loads — removes the memory
cliff on big crawls"; "Don't parallelize parsing before streaming it").

## 1. Problem

The SEO-parser upload flow parses uploaded Screaming Frog CSVs in two stages:

1. **Upload** (`POST /api/upload`) writes each CSV to disk under the session's upload dir.
2. **Parse** (`POST /api/parse/[sessionId]`) reads each file and runs its parser.

The parse route (`parseOne`) currently, for **every** CSV in the manifest:

- `fs.readFile(filePath, 'utf-8')` → the **entire file** as one JS string, then
- `findParserForFile(filename, rawContent)` to pick a parser, then
- `new ParserClass(rawContent)` → `BaseParser.parseCSV` runs `Papa.parse(content, {header, skipEmptyLines, dynamicTyping})` which materializes **all rows** into `this.data`, then
- `parser.parse()` iterates `this.data` (mask/loop helpers) to produce the structured `ParsedData`.

Peak memory per file ≈ **raw string + full row-object array held simultaneously**
(~3–5× the file size, since row objects carry per-field key overhead). The parse
loop is already **sequential** (one file at a time), so the peak is per-file, not
cumulative — but a single large export can still spike memory.

### 1.1 Empirical measurement (real Manhattan crawl, 2026-07-03)

Ran the real `findParserForFile` matcher over
`/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25` (49 CSVs):

| File | Size | Matched parser | Row basis |
|------|------|----------------|-----------|
| `all_outlinks.csv` | **10.2 MB** | `externallinks` (ExternalLinksParser) | one row per outbound link |
| `all_inlinks.csv` | **7.3 MB** | **UNMATCHED** | one row per inbound link |
| `all_anchor_text.csv` | **3.6 MB** | `anchortext` (AnchorTextParser) | one row per anchor |
| `internal_all.csv` | 328 KB | `internal` (InternalParser) | one row per URL |
| `external_all.csv` | 198 KB | **UNMATCHED** | one row per external URL |
| everything else | < 100 KB | various | small config/overview exports |

Two findings drive the scope:

- **The memory cliff is the one-row-per-*link* exports** (`all_outlinks`,
  `all_anchor_text`), whose row count grows super-linearly with crawl size. On a
  large crawl (50k+ pages) these reach hundreds of MB → the OOM-adjacent case
  against the 2400M PM2 ceiling. `internal_all` is one-row-per-**URL** (328 KB even
  here) and scales modestly.
- **Unmatched files are read fully then discarded.** `all_inlinks` (7.3 MB here,
  potentially the single largest file on a big crawl — one row per inbound link) and
  `external_all` are `fs.readFile`'d into a string, handed to `findParserForFile`,
  which returns `null`, and the string is thrown away. Pure waste.

### 1.2 Status: latent, not active

The improvement tracker records this as **"no active OOM, latent risk only."** This
is preventive hardening. That framing bounds the acceptable risk: the fix must not
endanger the byte-identical parse output that pt2 proved (real-crawl parity), and
must not touch surfaces beyond the parsers/route it changes.

## 2. Goals / Non-goals

### Goals
- G1. Bound peak memory for the big-file parsers to **O(accumulators)** — never hold
  the full raw string and the full row array simultaneously.
- G2. Never read an **unmatched** file fully into memory (header-peek detection).
- G3. **Byte-identical** parse output for the converted parsers (proven, not asserted).
- G4. No change to the upload UX (parse stays synchronous, request/response).

### Non-goals (locked with Kevin, 2026-07-03)
- N1. **No concurrency.** The sequential parse loop stays. (Roadmap: don't parallelize
  before streaming — and per the decision, concurrency is a *separate* future item.)
- N2. **No job-queue move.** Parsing stays in the request handler. Streaming a Node
  `ReadStream` yields the event loop between chunks, which relieves the event-loop
  pressure the synchronous whole-file `Papa.parse` creates — sufficient without the
  polling-UX cost of a durable job.
- N3. **InternalParser is NOT converted.** Small file (one row per URL), 704 lines,
  inherently O(URLs) state (word-count medians, duplicate-title Maps, GSC/GA4 sorts) —
  high conversion cost and parity risk for little memory payoff.
- N4. **No output-shape change** anywhere downstream: aggregator, findings dual-write,
  scoring, report/export builders, and `metadata.file_reports` are untouched.
- N5. The ~26 whole-file parsers are untouched.

## 3. Scope: which parsers stream

Convert **4** parsers (all keep O(1) or O(distinct-keys) state, so true row-streaming
carries no algorithm-change parity risk):

| Parser | Reads | State it keeps | Why safe to stream |
|--------|-------|----------------|--------------------|
| `ExternalLinksParser` | `all_outlinks` (biggest) | broken count + broken-dest URL list | pure per-row fold |
| `AnchorTextParser` | `all_anchor_text` | anchor-count Map, destination→anchor-Set Map, position Map, capped URL lists, counters — all O(distinct anchors/destinations), **not** O(rows) | pure per-row fold; post-loop sort/slice unchanged |
| `ImagesParser` | `images_all` | counts + capped URL lists (caps 20–30) | pure per-row fold |
| `LinksIssuesParser` | `links_*` | maxDepth + (currently unbounded) URL list | pure per-row fold; output contract unchanged |

> Note on `LinksIssuesParser`: its output pushes **every** URL into the issue
> (`urls` is unbounded by the current contract). Streaming the **input** still removes
> the raw-string + full-array double-copy; the output array is preserved verbatim
> (no contract change). `links_*` exports are small/rare (absent from Manhattan), but
> the parser is in the same family and is converted for consistency and to avoid a
> lone whole-file straggler among the link parsers.

## 4. Architecture

### 4.1 `StreamingParser` base (new) — `lib/parsers/streaming-parser.base.ts`

A **sibling** to `BaseParser` (not a subclass, not a modification of it), so the
~26 whole-file parsers inherit an unchanged contract.

```ts
export abstract class StreamingParser {
  static filenamePattern: string | string[] = '';
  static parserKey = '';                 // explicit literal per subclass (minification)
  static streaming = true;               // capability flag the route checks

  static matchesFile(filename: string): boolean { /* identical to BaseParser */ }
  static matchesContent(_headers: string[]): boolean { return false; }
  static matchesRawContent(_raw: string): boolean { return false; }

  protected headers: string[] = [];
  private headerMap = new Map<string, string>();
  private headersResolved = false;
  private domainCounts = new Map<string, number>();

  /** Called once per data row by the route's stream driver. */
  consume(row: CSVRow): void {
    if (!this.headersResolved) { /* build headerMap from Object.keys(row); resolve on first row */ }
    this.trackDomain(row);   // increment domainCounts for the Address/URL column
    this.consumeRow(row);
  }

  protected abstract consumeRow(row: CSVRow): void;   // subclass folds one row
  abstract finalize(): ParsedData;                    // subclass emits output

  getPrimaryDomain(): string | null { /* argmax over domainCounts */ }

  protected findColumn(names: string[]): string | null { /* shared impl */ }
}
```

Column resolution and primary-domain logic are **identical** to `BaseParser`'s. To
avoid two divergent copies, extract the shared pieces into a small pure util
`lib/parsers/header-map.ts`:

- `buildHeaderMap(headers: string[]): Map<string,string>`
- `findColumn(headerMap, names): string | null`
- `mostCommonHostname(counts: Map<string,number>): string | null`

`BaseParser` is refactored to call these (behavior-preserving; covered by existing
tests + the pt2 golden/parity net). `StreamingParser` calls the same functions.

**Header resolution timing.** With `header:true`, Papa emits each row as an object
keyed by the header names, and `results.meta.fields` is populated from the first
data row's `step` callback. `StreamingParser.consume` resolves `headers`/`headerMap`
lazily from the first row it sees (`Object.keys(row)` or the captured `meta.fields`).
Subclasses resolve their columns inside `finalize()` (or memoize on first `consumeRow`);
this mirrors the whole-file parsers, which resolve columns at the top of `parse()`.

### 4.2 The 4 parser conversions (mechanical, verbatim logic)

For each target parser the transformation is purely structural:

- The `for (…of this.data)` / `for (let i…)` loop body → `consumeRow(row)`.
- Loop-local accumulators (counts, Maps, Sets, capped arrays) → **instance fields**,
  initialized in a `reset`/constructor.
- The post-loop tail (sorts, slices, issue construction, return object) → `finalize()`.
- Column lookups move to `finalize()` (or memoized), using `this.findColumn`.
- `this.length` (row count) → an instance counter incremented in `consumeRow`.
- `this.isEmpty` → `rowCount === 0`, checked in `finalize()`.

Because the accumulation logic is **copied unchanged** and rows arrive in the same
file order, byte-identical output follows — including sort-tie resolution, which
depends only on first-seen insertion order (preserved).

### 4.2a Registry & type integration (load-bearing)

`StreamingParser` is a **sibling** of `BaseParser`, not a subclass — so it is **not**
assignable to `typeof BaseParser`. But `PARSERS` (`Array<typeof BaseParser>`),
`PARSER_MAP` (`Record<string, typeof BaseParser>`), and `findParserForFile`'s return
type are all typed on `typeof BaseParser`, and the streaming subclasses **must stay
registered and keyed** (parity: `findParserForFile`/`PARSER_MAP` behavior is
unchanged). Resolve the typing cleanly:

- Define a shared **static class type** in `lib/parsers/types` (or `header-map.ts`):
  ```ts
  export type ParserClass = {
    filenamePattern: string | string[];
    parserKey: string;
    streaming?: boolean;                 // absent/false → whole-file
    matchesFile(filename: string): boolean;
    matchesContent(headers: string[]): boolean;
    matchesRawContent(raw: string): boolean;
  };
  ```
  Both `typeof BaseParser` and `typeof StreamingParser` structurally satisfy it.
- Widen `PARSERS: ParserClass[]`, `PARSER_MAP: Record<string, ParserClass>`, and
  `findParserForFile(...): ParserClass | null`. The registry only ever touches the
  **static** surface (matchers + `parserKey` + `streaming`), never instantiates or
  calls instance methods, so this is sound.
- The route branches on `ParserClass.streaming` and casts to the correct constructor
  shape (`new () => StreamingParser` vs `new (content: string) => BaseParser`), the
  same pattern the route already uses (`as unknown as new (content: string) => …`).
- **Shared static `matchesFile`.** `BaseParser.matchesFile` reads `this.filenamePattern`.
  Extract the pure logic into `filenameMatches(pattern, filename)` in `header-map.ts`;
  both classes' static `matchesFile` delegate to it (no duplicated substring logic).

This keeps `findParserForFile`'s detection order and results **byte-identical** to
today (verified by the existing routing tests + `index.routing.test.ts`).

### 4.3 Route: `parseOne` becomes two-path — `app/api/parse/[sessionId]/route.ts`

```
parseOne(filename):
  if ext != .csv        → { status: 'skipped' }         # unchanged
  if !exists            → failed('File not found')       # unchanged

  # (1) bounded header-peek for detection — NEVER read the full file yet
  headerChunk = readHeaderChunk(filePath)                # see 4.4
  ParserClass = findParserForFile(filename, headerChunk)
  if !ParserClass       → { status: 'unmatched' }        # big win: no full read

  # (2) streaming path
  if ParserClass.streaming:
    parser = new ParserClass()
    await streamCsv(filePath, row => parser.consume(row))  # createReadStream → Papa NODE_STREAM_INPUT
    result = parser.finalize()
    domain = parser.getPrimaryDomain()

  # (3) whole-file path (unchanged)
  else:
    rawContent = await fs.readFile(filePath, 'utf-8')
    parser = new ParserClass(rawContent)
    result = parser.parse()
    domain = parser.getPrimaryDomain()

  return parsed(parserKey, result, filename, domain)
```

`file_reports` bookkeeping, `severity`/`isCoreExport`, the `successes[]` array, the
aggregator wiring, domain/client matching, the transaction, and the findings
dual-write are all **unchanged**.

Papa streaming config **must exactly match** the whole-file config for parity:
`{ header: true, skipEmptyLines: true, dynamicTyping: true }`.

### 4.4 Header-peek — `readHeaderChunk(filePath)`

Read a bounded prefix sufficient for `findParserForFile`:

- `findParserForFile` uses (in order) `matchesFile(filename)` (no content),
  `matchesRawContent(raw)` (SEMRush metadata preamble — always at the top of the
  file), and `matchesContent(headers)` (first line only). A bounded top-of-file
  chunk covers all three.
- Read via a `ReadStream` in chunks, accumulating until the **first newline** is
  seen (guarantees the complete header line) **and** at least a base size is read
  (default 64 KB, enough for any SEMRush metadata preamble); hard cap 1 MB to bound
  pathological input. Return the accumulated prefix as a UTF-8 string.
- All 4 streaming targets match by **filename** (step 1), so they don't even need
  the content — but the peek is applied uniformly so *every* file (including the
  whole-file parsers and unmatched files) benefits from not being fully read for
  detection.

**Detection-equivalence invariant:** `findParserForFile(name, peek)` must return the
same parser as `findParserForFile(name, fullContent)` for all real SF/SEMRush
exports. This holds because (a) filename matches ignore content, (b) SEMRush
metadata/headers live at the very top, well within 64 KB, (c) `matchesContent` reads
only the first line. Verified by a route test that peeks vs full-reads each Manhattan
fixture and asserts identical detection.

## 5. Parity & correctness strategy (non-negotiable)

Mirrors pt2, which shipped byte-identical:

1. **Golden characterization tests written FIRST**, before any refactor, full
   `toEqual` on real-crawl-derived fixtures, for all 4 parsers. They stay green
   through the conversion.
   - `externallinks.golden.test.ts` — from `all_outlinks.csv`
   - `anchortext.golden.test.ts` — from `all_anchor_text.csv` (**no test exists today** — this closes a real gap)
   - `images.golden.test.ts` — from `images_all.csv` / `images_missing_alt_text.csv`
   - `linksissues.golden.test.ts` — synthetic `links_*` fixture (none in the crawl)
2. **Real-crawl byte-identical parity harness** (`npx tsx`): pipe the Manhattan crawl
   through pre-refactor vs post-refactor `parse()`/`finalize()` and `diff` the
   serialized output — the same technique that proved pt2 byte-identical.
3. **BOM / chunk-boundary fixture.** Whole-file `Papa.parse(string)` and streaming
   `Papa.parse(NODE_STREAM_INPUT)` must tokenize identically across (a) a leading
   UTF-8 BOM and (b) a quoted field spanning a chunk boundary. Add an explicit
   fixture exercising both and assert whole-file output === streaming output.

## 6. Memory verification (evidence the fix works)

A `npx tsx` harness (`scripts/streaming-memory-check.ts`, dev-only, not shipped in the
app path):

- Generates a large synthetic `all_outlinks.csv` by replicating Manhattan's
  `all_outlinks` rows to ~500 MB (temp file in the scratchpad, deleted after).
- Runs `ExternalLinksParser` under a constrained `--max-old-space-size` in two modes:
  - **whole-file** (`fs.readFile` + `new ExternalLinksParser(content)` equivalent) —
    expected to **OOM / RangeError** at the constrained heap.
  - **streaming** (`createReadStream` → `consume` → `finalize`) — expected to
    **complete** with bounded `process.memoryUsage().rss`.
- Prints peak RSS for both. The demonstrable gap (OOM vs completes) is the evidence
  recorded in the tracker/handoff.

## 7. Testing

- **Unit (golden):** the 4 golden suites above (§5.1), full `toEqual`.
- **Unit (streaming base):** `StreamingParser` — header resolution on first row,
  `findColumn`, incremental `getPrimaryDomain`, empty-input (`finalize()` on zero rows
  returns the same `{}`/empty shape as the whole-file `isEmpty` guard).
- **Unit (header util):** `header-map.ts` pure functions.
- **Route:** two-path `parseOne` — a streaming parser routes through the stream driver;
  a whole-file parser is unchanged; an **unmatched** file returns `unmatched` and is
  **not** fully read (assert via a spied/limited read); detection-equivalence
  (peek vs full) over the Manhattan fixtures.
- **Parity:** BOM + chunk-boundary fixture (§5.3).
- **Deferred pt2 Minors (fold in):** two golden cases in the consolidated bases —
  the `getSeoRelevantMask` mask-fallback branch, and a nonzero `excluded_urls` case —
  that pt2 left unpinned.
- **Gates:** `npm run lint` + `npm test` + `npm run build` all green.

## 8. Rollout & verification

- Code-only change (no migration, no env, no middleware, no new route) → deploy via
  plain `~/deploy.sh`.
- **Post-deploy prod verification:**
  1. App health (online, restart count, RSS under the 2400M ceiling).
  2. **Minification survival** — the deployed `.next/server` bundle preserves the 4
     converted `parserKey` literals (`externallinks`/`anchortext`/`images`/`linksissues`)
     and `constructor.name` never appears in the parser path (pt2 landmine protocol).
  3. **Functional** — parse a real multi-file upload (Manhattan crawl) through the app
     and confirm the report renders with the expected link/anchor/image sections
     (this also discharges pt1's still-pending functional panel-render check).

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Streaming vs whole-file tokenization differs (BOM, chunk boundaries, `dynamicTyping`) | Identical Papa config; §5.3 explicit BOM/chunk fixture; §5.2 real-crawl `diff` |
| Header line > 64 KB peek | Peek loop extends to first newline, hard cap 1 MB |
| Detection differs on a peek vs full read | Detection-equivalence route test over all Manhattan fixtures (§4.4) |
| Class-name minification breaks aggregator lookups | Explicit `parserKey` literals retained; post-deploy bundle check (§8) |
| `StreamingParser`/`BaseParser` `findColumn` drift | Single shared `header-map.ts` util used by both |
| A converted parser subtly changes tie-ordering | Logic copied verbatim; first-seen order preserved; golden `toEqual` catches any drift |

## 10. Files touched

**New:**
- `lib/parsers/streaming-parser.base.ts` — `StreamingParser`
- `lib/parsers/header-map.ts` — shared `buildHeaderMap`/`findColumn`/`mostCommonHostname`
- `lib/parsers/resources/externallinks.golden.test.ts`
- `lib/parsers/resources/anchortext.golden.test.ts`
- `lib/parsers/resources/images.golden.test.ts` (or extend existing `images.parser.test.ts`)
- `lib/parsers/resources/linksissues.golden.test.ts`
- `lib/parsers/streaming-parser.base.test.ts`
- `lib/parsers/header-map.test.ts`
- `scripts/streaming-memory-check.ts` (dev harness)
- a BOM/chunk-boundary parity test

**Modified:**
- `lib/parsers/base.parser.ts` — delegate `findColumn`/header-map/domain to `header-map.ts` (behavior-preserving)
- `lib/parsers/resources/links.parser.ts` — `ExternalLinksParser` + `LinksIssuesParser` → `StreamingParser`
- `lib/parsers/resources/anchorText.parser.ts` — → `StreamingParser`
- `lib/parsers/resources/images.parser.ts` — → `StreamingParser`
- `app/api/parse/[sessionId]/route.ts` — two-path `parseOne` + `readHeaderChunk` + `streamCsv`
- `lib/parsers/index.ts` — widen `PARSERS`/`PARSER_MAP`/`findParserForFile` to the
  shared `ParserClass` type (registry **contents** and detection order unchanged; §4.2a)
- consolidated-base golden tests (2 deferred Minor cases)

**Untouched (explicitly):** the ~26 whole-file parsers, `InternalParser`, the
aggregator, findings layer, scoring, report/export builders. The `PARSER_MAP`/`PARSERS`
registry **contents** are unchanged (the streaming subclasses stay registered and
keyed exactly as now); only their static type is widened (§4.2a).
```
