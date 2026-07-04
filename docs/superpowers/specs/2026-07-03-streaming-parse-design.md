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

Convert **4** parsers. Streaming removes the raw string + full row array (the
`O(rows + raw string)` double-copy); it does **not** make every parser `O(1)` — each
retains its existing output/accumulator footprint, which the conversion preserves
verbatim (Codex Low 9). None does an algorithm change, so there is no parity risk
from restructuring:

| Parser | Reads | State it keeps | Footprint after streaming |
|--------|-------|----------------|---------------------------|
| `ExternalLinksParser` | `all_outlinks` (biggest) | broken count + broken-dest URL list | O(broken external links) — unbounded output list, but ≪ full file |
| `AnchorTextParser` | `all_anchor_text` | anchor-count `Record`, destination→anchor-Set `Record`, position `Record`, capped URL lists (cap 50), counters | O(distinct anchors + distinct destinations) — **not** O(rows) |
| `ImagesParser` | `images_all` | counts + capped URL lists (caps 20–30) | O(1) (fixed caps) |
| `LinksIssuesParser` | `links_*` | maxDepth + (unbounded) URL list | O(rows) output list, but no raw string / row array |

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

  static matchesFile(filename: string): boolean { /* delegates to filenameMatches() */ }
  static matchesContent(_headers: string[]): boolean { return false; }
  static matchesRawContent(_raw: string): boolean { return false; }

  protected headers: string[] = [];
  private headerMap = new Map<string, string>();
  private headersResolved = false;
  private rowCount = 0;
  private domainCounts = new Map<string, number>();

  /** Called once per data row by the route's stream driver. */
  consume(row: CSVRow): void {
    if (!this.headersResolved) {
      // Codex-fixed (High 2): resolve headers + let the subclass cache its
      // columns BEFORE any row is folded — several parsers need a column
      // (e.g. AnchorText needs `Type`) to even decide whether to count a row.
      this.headers = Object.keys(row);
      this.headerMap = buildHeaderMap(this.headers);
      this.onHeaders();          // subclass resolves + stores its column names
      this.headersResolved = true;
    }
    this.rowCount++;
    this.trackDomain(row);       // increment domainCounts for the Address/URL column
    this.consumeRow(row);
  }

  /** Resolve column names into fields (once, before the first consumeRow). */
  protected onHeaders(): void {}
  protected abstract consumeRow(row: CSVRow): void;   // subclass folds one row
  abstract finalize(): ParsedData;                    // subclass emits output (no folding)

  protected get length(): number { return this.rowCount; }
  protected get isEmpty(): boolean { return this.rowCount === 0; }
  getPrimaryDomain(): string | null { /* mostCommonHostname(domainCounts) */ }
  protected findColumn(names: string[]): string | null { /* findColumn(headerMap, names) */ }
}
```

**Lifecycle (Codex High 2):** `consume(row)` → on the *first* row: build the header
map, call `onHeaders()` (subclass resolves + stores its column names as fields),
then fold that same row. Subsequent rows fold directly. `finalize()` **emits only**
— it does the post-loop sorts/slices/issue-construction, never row folding and never
column resolution. This matches how the whole-file parsers resolve columns once at
the top of `parse()`, before their loop. An empty file (zero rows) never resolves
headers; `finalize()` sees `isEmpty === true` and returns the same `{}`/empty shape
the whole-file `if (this.isEmpty) return {}` guard produces.

**Shared header/domain util (Codex Medium 7).** To avoid two divergent copies,
extract the shared pieces into a small pure util `lib/parsers/header-map.ts`:

- `buildHeaderMap(headers: string[]): Map<string,string>` — **must preserve
  `BaseParser` semantics exactly**: set both the original-case key and the
  lowercased key for each header, in header order, so a later duplicate/case-fold
  overwrites an earlier one (identical to the current `for (const h of headers)`
  loop). `this.headers` stays the raw `meta.fields`/`Object.keys` array (some
  parsers read it directly) — the util never mutates or re-orders it.
- `findColumn(headerMap, names): string | null` — same first-match, case-insensitive
  lookup as `BaseParser.findColumn`.
- `mostCommonHostname(counts: Map<string,number>): string | null` — argmax, same
  tie-break as `getPrimaryDomain`.
- `filenameMatches(pattern: string | string[], filename: string): boolean` — the
  pure substring/array logic behind both classes' static `matchesFile`.

`BaseParser` is refactored to call these (behavior-preserving; covered by existing
tests + the pt2 golden/parity net + new mixed-case duplicate-header tests).
`StreamingParser` calls the same functions. Neither class changes `this.headers`.

### 4.2 The 4 parser conversions (mechanical, verbatim logic)

For each target parser the transformation is purely structural:

- Column lookups (`findColumn(...)`) move into `onHeaders()`, stored as instance
  fields — resolved once before the first row folds (Codex High 2).
- The `for (…of this.data)` / `for (let i…)` loop body → `consumeRow(row)`.
- Loop-local accumulators → **instance fields**, initialized in the constructor.
- The post-loop tail (sorts, slices, issue construction, return object) → `finalize()`.
- `this.length` (row count) → the base's `rowCount` counter (`this.length` getter).
- `this.isEmpty` → the base's getter, checked at the top of `finalize()`.

**Preserve the exact data structures — do NOT "upgrade" Records to Maps (Codex High 1).**
The real parsers use plain objects: `AnchorTextParser`'s `anchorCounts`,
`destinationAnchors` (`Record<string, Set<string>>`), and `positionCounts` are
`Record`s; `Object.entries` enumeration order (integer-like keys first, ascending,
then insertion order) differs from `Map` insertion order. `top_anchors` is
`Object.entries(anchorCounts).sort((a,b)=>b[1]-a[1])` — a **stable** sort, so tie
order = enumeration order. A numeric-looking anchor such as `"123"` would sort
differently under a `Map`. The conversion keeps every accumulator's type verbatim;
only its scope changes (local → field).

**Preserve the capped-count quirk (Codex High 1).** `AnchorTextParser`'s
`empty_anchor_text` / `non_descriptive_anchor_text` issue `count` is the length of
the **capped** array (`emptyAnchorUrls`/`nonDescriptiveUrls`, cap 50), not the true
occurrence total; `urls` is then `slice(0,30)`. Copy this verbatim — the golden
fixture (below) must include >50 empty and >50 non-descriptive anchors to pin it.

Because the accumulation logic is **copied unchanged** (same types, same caps, same
order) and rows arrive in file order, byte-identical output follows — including
sort-tie resolution, which depends only on enumeration/first-seen order (preserved).

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
    name: string;                        // Codex Medium 8: the route falls back to
                                         // `ParserClass.name` when parserKey is '' —
                                         // keep it in the type or that read won't compile
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

  # (1) detection — filename FIRST (Codex Medium 5), peek only if that misses
  ParserClass = findParserForFile(filename)              # no content: filename match only
  if !ParserClass:
    headerChunk = await readHeaderChunk(filePath)         # bounded read; see 4.4
    ParserClass = findParserForFile(filename, headerChunk)
  if !ParserClass       → { status: 'unmatched' }        # unmatched file is NEVER fully read

  try:
    # (2) streaming path
    if ParserClass.streaming:
      parser = new ParserClass()
      await streamCsv(filePath, row => parser.consume(row))  # see stream contract below
      result = parser.finalize()
      domain = parser.getPrimaryDomain()
    # (3) whole-file path (unchanged)
    else:
      rawContent = await fs.readFile(filePath, 'utf-8')
      parser = new ParserClass(rawContent)
      result = parser.parse()
      domain = parser.getPrimaryDomain()
  catch err:
    return failed(filename, err.message)                 # streaming errors join pt1's failed bucket

  return parsed(parserKey, result, filename, domain)
```

Filename-first detection (Codex Medium 5) is behavior-equivalent to today —
`findParserForFile` already tries `matchesFile` before any content step — and skips
even the peek for the 4 streaming targets (all filename-matched) and every other
filename-matched SF export. The peek runs only for content-detected files (SEMRush)
and genuinely unmatched files.

**Stream driver contract — `streamCsv(filePath, onRow)` (Codex High 3).** Returns a
`Promise<void>` that:

- opens `fs.createReadStream(filePath, { encoding: 'utf8' })` and pipes it into
  `Papa.parse(Papa.NODE_STREAM_INPUT, { header: true, skipEmptyLines: true,
  dynamicTyping: true })` — config **exactly matching** the whole-file
  `BaseParser.parseCSV` for parity;
- calls `onRow(row.data)` for each `data` event;
- **rejects** on either the file `ReadStream`'s `error` OR the Papa stream's `error`,
  and destroys both streams on error (no hang, no leaked fd);
- **resolves only after** the Papa stream's completion event fires (all rows
  delivered) — so `finalize()` never runs on a partial stream.

Because `parseOne` wraps the whole parse in `try/catch`, a stream/read error yields
the same `failed` `FileReport` (with `severity` from `isCoreExport`) that the
whole-file path already produces on a thrown parser — pt1's failure-isolation
contract is preserved for streaming files too.

`file_reports` bookkeeping, `severity`/`isCoreExport`, the `successes[]` array, the
aggregator wiring, domain/client matching, the transaction, and the findings
dual-write are all **unchanged**.

### 4.4 Header-peek — `readHeaderChunk(filePath)`

Only reached when filename detection misses (§4.3 step 1) — i.e. content-detected
SEMRush files and genuinely unmatched files. Reads a bounded prefix sufficient for
the content steps of `findParserForFile`:

- The remaining detection steps are `matchesRawContent(raw)` (SEMRush metadata
  preamble — always at the very top of the file) and `matchesContent(headers)`
  (first line only). A bounded top-of-file chunk covers both.
- Read via a `ReadStream` in chunks, accumulating until the **first newline** is seen
  (guarantees the complete header line) **and** at least a base size is read (default
  64 KB, enough for any SEMRush metadata preamble); hard cap 1 MB. Return the
  accumulated prefix as a UTF-8 string.
- **1 MB cap hit before a newline (Codex Medium 6):** a CSV whose first line exceeds
  1 MB is pathological (no real SF/SEMRush export does this). Behave deterministically:
  return the 1-MB prefix as-is and let `findParserForFile` decide on it (in practice
  → `unmatched`, since no content matcher will fire on a truncated giant line). This
  branch is unit-tested so the behavior is pinned, not incidental.

**Detection-equivalence invariant (Codex Medium 6):** `findParserForFile(name, peek)`
must return the same parser as `findParserForFile(name, fullContent)` for all real
SF/SEMRush exports. This holds because (a) filename matches never reach the peek,
(b) SEMRush metadata/headers live at the very top, well within 64 KB, (c)
`matchesContent` reads only the first line. **Proven, not assumed:**
- a route test peeks vs full-reads **each Manhattan fixture** and asserts identical
  detection;
- a **synthetic SEMRush Position Tracking fixture** (metadata preamble *before* the
  CSV header) asserts `matchesRawContent` fires from the peek and equals full-content
  detection;
- synthetic header-only SEMRush fixtures (Organic Positions / Keyword Gap) assert
  `matchesContent` from the peek equals full detection.

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
3. **Tokenization parity fixtures (Codex High 4).** Whole-file `Papa.parse(string)`
   and streaming `Papa.parse(NODE_STREAM_INPUT)` must tokenize identically. A single
   BOM/chunk-boundary fixture is necessary but **not sufficient**. Add a parity table
   that feeds the *same* bytes through both paths and asserts `toEqual` on the row
   arrays, covering every case where Papa's string vs stream parsers can diverge:
   - leading UTF-8 BOM
   - quoted field spanning a chunk boundary
   - CRLF (`\r\n`) line endings
   - trailing blank line(s)
   - last row without a final newline
   - header-only CSV (zero data rows)
   - empty file (zero bytes)
   - a row with extra columns (Papa's `__parsed_extra`)
   - `dynamicTyping` values: integers, floats, booleans, empty strings, and
     quoted-numeric strings (`"123"` must stay a string)

   This is a **generic Papa-parity test** (not parser-specific): it locks the
   equivalence of the two Papa entry points that the whole design rests on.

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

- **Unit (golden):** the 4 golden suites above (§5.1), full `toEqual`. The
  `anchortext` fixture MUST include tied anchor counts, numeric-looking anchors
  (`"123"`), repeated destinations, empty anchors, and >50 empty / >50
  non-descriptive anchors — to pin the enumeration-order tie-break and the
  capped-count quirk (Codex High 1).
- **Unit (streaming base):** `StreamingParser` — first-row header resolution +
  `onHeaders()` called once **before** the first `consumeRow`; `findColumn`;
  incremental `getPrimaryDomain`; `length`/`isEmpty`; empty-input (`finalize()` on
  zero rows returns the same `{}`/empty shape as the whole-file `isEmpty` guard, and
  `onHeaders` never fires).
- **Unit (header util):** `header-map.ts` pure functions, incl. **mixed-case
  duplicate headers** (later overwrites earlier; both original-case and lowercase
  keys set) to prove `BaseParser` semantics are preserved (Codex Medium 7).
- **Unit (stream driver, Codex High 3):** `streamCsv` rejects on a file `ReadStream`
  error and on a Papa error, destroys both streams, and resolves only after
  completion; a stream error surfaces as a `failed` `FileReport` through `parseOne`.
- **Route:** two-path `parseOne` — a streaming parser routes through the stream
  driver; a whole-file parser is unchanged; an **unmatched** file returns `unmatched`
  and is **not** fully read (assert via a spied/limited read); filename-first
  detection skips the peek for filename-matched files; detection-equivalence
  (peek vs full) over the Manhattan fixtures **plus** synthetic SEMRush
  metadata/header fixtures (Codex Medium 6); the 1-MB-cap-before-newline branch
  returns the deterministic result.
- **Parity (generic Papa, Codex High 4):** the whole-file-vs-stream `toEqual` table
  (§5.3) — BOM, chunk boundary, CRLF, trailing blanks, no-final-newline, header-only,
  empty file, `__parsed_extra`, dynamicTyping variants.
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
| Streaming vs whole-file tokenization differs (BOM, CRLF, chunk boundaries, trailing/no newline, header-only, empty, `__parsed_extra`, `dynamicTyping`) | Identical Papa config; §5.3 full generic-parity `toEqual` table; §5.2 real-crawl `diff` |
| A `Record`→`Map` "upgrade" changes enumeration/tie order | Data structures copied verbatim (§4.2); golden fixture with tied + numeric-looking anchors (Codex High 1) |
| Columns needed during folding but resolved too late | `onHeaders()` resolves columns once before the first `consumeRow` (Codex High 2); base unit test asserts ordering |
| Stream/read error hangs or bypasses the `failed` bucket | `streamCsv` rejects on both error sources + destroys streams; `parseOne` `try/catch` → `failed` FileReport (Codex High 3) |
| Header line > 64 KB peek / > 1 MB | Peek extends to first newline; 1-MB cap → deterministic unmatched (unit-tested) |
| Detection differs on peek vs full read | Equivalence tests over Manhattan fixtures + synthetic SEMRush metadata/header fixtures (Codex Medium 6) |
| Class-name minification breaks aggregator lookups | Explicit `parserKey` literals retained; post-deploy bundle check (§8) |
| `StreamingParser`/`BaseParser` `findColumn` drift | Single shared `header-map.ts` util; mixed-case duplicate-header test (Codex Medium 7) |
| Memory guarantee overstated | Framed as O(accumulators/output contract), not O(1); Links/External keep their (bounded-in-practice) output URL lists (Codex Low 9) |

## 10. Files touched

**New:**
- `lib/parsers/streaming-parser.base.ts` — `StreamingParser`
- `lib/parsers/header-map.ts` — shared `buildHeaderMap`/`findColumn`/`mostCommonHostname`
- `lib/parsers/resources/externallinks.golden.test.ts`
- `lib/parsers/resources/anchortext.golden.test.ts`
- `lib/parsers/resources/images.golden.test.ts` (or extend existing `images.parser.test.ts`)
- `lib/parsers/resources/linksissues.golden.test.ts`
- `lib/parsers/streaming-parser.base.test.ts` (incl. `onHeaders`-before-fold, empty-input)
- `lib/parsers/header-map.test.ts` (incl. mixed-case duplicate headers)
- `lib/parsers/papa-parity.test.ts` — generic whole-file-vs-stream `toEqual` table (§5.3)
- `scripts/streaming-memory-check.ts` (dev harness)
- the `ParserClass` static type — in `lib/parsers/header-map.ts` (or a small `lib/parsers/parser-class.ts`); §4.2a
- SEMRush peek-equivalence fixtures/tests (position-tracking metadata + header-only) — in the route test

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
