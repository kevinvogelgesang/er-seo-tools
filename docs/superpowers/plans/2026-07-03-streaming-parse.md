# Streaming Parse (C7 pt3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream the 4 big-file SEO parsers (externallinks/anchortext/images/linksissues) row-by-row via Papa's Node stream, and detect parsers from a bounded header-peek so unmatched files are never fully read — bounding peak parse memory without changing any parse output.

**Architecture:** A new `StreamingParser` **sibling** base (not a subclass of `BaseParser`) exposes a `consume(row)` / `onHeaders()` / `finalize()` lifecycle. The parse route drives streaming parsers with `fs.createReadStream` piped into `Papa.parse(Papa.NODE_STREAM_INPUT, …)`; whole-file parsers are unchanged. Detection is filename-first, falling back to a bounded top-of-file peek. Byte-identical output is proven by golden characterization tests (written first, stay green) + a generic Papa whole-file-vs-stream parity table + a real-crawl diff.

**Tech Stack:** TypeScript, Next.js 15 App Router, papaparse 5.5.3 (`NODE_STREAM_INPUT`), Node 22 `fs`/`fs/promises`, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-streaming-parse-design.md` (Codex-reviewed, accept-with-fixes applied).

## Global Constraints

- **Byte-identical parse output** for all converted parsers — non-negotiable. Copy accumulation logic verbatim; never swap a `Record` for a `Map` (enumeration/tie order differs, esp. numeric-looking keys).
- **Explicit static `parserKey` literal** on every parser (prod SWC minifies class names — 2026-06-02 landmine). The two bases (`BaseParser`, `StreamingParser`) declare `parserKey = ''` and are NOT registered.
- **No output-shape change** downstream: aggregator, findings dual-write, scoring, report/export builders, `metadata.file_reports` untouched.
- **No** migration, env var, middleware, or new route. Code-only → plain `~/deploy.sh`.
- **Array-form `$transaction([...])` only** (never interactive) — not touched here, but the route's existing transaction stays as-is.
- Papa config is identical on both paths: `{ header: true, skipEmptyLines: true, dynamicTyping: true }`.
- Local dev: prefix Prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`. Parser/node tests use `// @vitest-environment node`; React tests use jsdom + `afterEach(cleanup)`. Quick smoke scripts run via `npx tsx <file>.ts` (NOT `.mts`).
- Reusable real crawl for fixtures/parity: `/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25`. Never scan non-client sites.
- **Branch first.** Before Task 1, create the feature branch: `git checkout -b feat/c7-streaming-parse` (main is the default; all commits below land on this branch). PR opens from it in Task 11.

---

## Task 1: Shared interface-agnostic test helper + golden characterization for the 4 target parsers (against CURRENT code)

Lock current behavior BEFORE any refactor. **Codex High 1 fix:** the goldens (and the existing `links`/`images` tests, migrated in Tasks 7/9) must call the parser through a helper that works for BOTH the whole-file (`new Parser(csv).parse()`) and post-conversion streaming (`consume`/`finalize`) interfaces — otherwise every golden breaks the moment its parser is converted. Introduce that helper first, then write all goldens against it.

**Files:**
- Create: `lib/parsers/test-parse-helper.ts`
- Create: `lib/parsers/resources/externallinks.golden.test.ts`
- Create: `lib/parsers/resources/anchortext.golden.test.ts`
- Create: `lib/parsers/resources/images.golden.test.ts`
- Create: `lib/parsers/resources/linksissues.golden.test.ts`

**Interfaces:**
- Consumes: current `ExternalLinksParser`, `LinksIssuesParser` (`lib/parsers/resources/links.parser.ts`), `AnchorTextParser` (`anchorText.parser.ts`), `ImagesParser` (`images.parser.ts`).
- Produces:
  - `parseString(ParserClass, csv: string): Record<string, unknown>` — branches on `ParserClass.streaming`; for streaming, parses the string via Papa (same `PAPA_CONFIG`) and feeds each row to `consume()` then returns `finalize()`; else `new ParserClass(csv).parse()`. (String-input tokenization parity vs the real file stream is proven separately by the Task 5 Papa-parity table, so the golden helper can parse the string synchronously.)
  - golden suites that later tasks (parser conversions) must keep green.

- [ ] **Step 1: Write `test-parse-helper.ts`**

```ts
import Papa from 'papaparse';
import type { CSVRow } from '../types';

const PAPA_CONFIG = { header: true, skipEmptyLines: true, dynamicTyping: true } as const;

type WholeFile = new (content: string) => { parse(): Record<string, unknown> };
type Streaming = new () => { consume(row: CSVRow): void; finalize(): Record<string, unknown> };

/** Parse a CSV string through whichever interface the parser exposes. */
export function parseString(
  ParserClass: (WholeFile | Streaming) & { streaming?: boolean },
  csv: string
): Record<string, unknown> {
  if (ParserClass.streaming) {
    const parser = new (ParserClass as Streaming)();
    const rows = Papa.parse<CSVRow>(csv, PAPA_CONFIG).data;
    for (const row of rows) parser.consume(row);
    return parser.finalize();
  }
  return new (ParserClass as WholeFile)(csv).parse();
}
```

- [ ] **Step 2: Write `externallinks.golden.test.ts`** (via `parseString`)

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ExternalLinksParser } from './links.parser';
import { parseString } from '../test-parse-helper';

const CSV = [
  'Destination,Status Code',
  'https://ok.com/a,200',
  'https://dead.com/x,404',
  'https://dead.com/y,500',
  'https://ok.com/b,301',
].join('\n');

describe('ExternalLinksParser golden', () => {
  it('broken (4xx/5xx) counted + collected in file order', () => {
    expect(parseString(ExternalLinksParser, CSV)).toEqual({
      total_external_links: 4,
      stats: { broken_external_links: 2 },
      issues: [
        {
          type: 'broken_external_links',
          severity: 'warning',
          count: 2,
          description: '2 broken external links',
          urls: ['https://dead.com/x', 'https://dead.com/y'],
        },
      ],
    });
  });

  it('empty input → {}', () => {
    expect(parseString(ExternalLinksParser, 'Destination,Status Code')).toEqual({});
  });
});
```

- [ ] **Step 3: Write `images.golden.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ImagesParser } from './images.parser';
import { parseString } from '../test-parse-helper';

const VERY_LARGE = 600 * 1024, LARGE = 200 * 1024, OK = 10 * 1024;
const CSV = [
  'Address,Alt Text,Size (Bytes),Status Code,Width,Height',
  `https://ex.com/a.png,Alt A,${OK},200,100,100`,       // clean
  `https://ex.com/b.png,,${LARGE},200,0,50`,            // missing alt, large, missing width
  `https://ex.com/c.png,Alt C,${VERY_LARGE},404,,`,     // very large, broken, missing dims
].join('\n');

describe('ImagesParser golden', () => {
  it('alt/size/status/dimension issues → exact output', () => {
    expect(parseString(ImagesParser, CSV)).toEqual({
      total_images: 3,
      stats: {
        missing_alt: 1,
        alt_coverage_percent: 66.7,
        images_with_alt: 2,
        large_images: 1,
        very_large_images: 1,
        broken_images: 1,
        missing_dimensions: 2,
      },
      issues: [
        { type: 'missing_alt_text', severity: 'warning', count: 1,
          description: '1 images missing alt text (66.7% coverage)', urls: ['https://ex.com/b.png'] },
        { type: 'very_large_images', severity: 'critical', count: 1,
          description: '1 very large images (> 500KB)', urls: ['https://ex.com/c.png'] },
        { type: 'large_images', severity: 'warning', count: 1,
          description: '1 large images (> 100KB)', urls: ['https://ex.com/b.png'] },
        { type: 'broken_images', severity: 'critical', count: 1,
          description: '1 broken images (4xx/5xx)', urls: ['https://ex.com/c.png'] },
        { type: 'images_missing_dimensions', severity: 'notice', count: 2,
          description: '2 images missing width/height attributes (layout shift risk)',
          urls: ['https://ex.com/b.png', 'https://ex.com/c.png'] },
      ],
    });
  });

  it('empty input → {}', () => {
    expect(parseString(ImagesParser, 'Address,Alt Text')).toEqual({});
  });
});
```

- [ ] **Step 4: Write `linksissues.golden.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LinksIssuesParser } from './links.parser';
import { parseString } from '../test-parse-helper';

const CSV = [
  'Address,Crawl Depth',
  'https://ex.com/a,1',
  'https://ex.com/b,3',
  'https://ex.com/c,2',
].join('\n');

describe('LinksIssuesParser golden', () => {
  it('collects all urls + max crawl depth', () => {
    expect(parseString(LinksIssuesParser, CSV)).toEqual({
      total_pages: 3,
      stats: { max_crawl_depth: 3 },
      issues: [
        {
          type: 'links_quality_issue',
          severity: 'warning',
          count: 3,
          description: '3 page(s) with link quality issues',
          urls: ['https://ex.com/a', 'https://ex.com/b', 'https://ex.com/c'],
        },
      ],
    });
  });

  it('empty input → {}', () => {
    expect(parseString(LinksIssuesParser, 'Address,Crawl Depth')).toEqual({});
  });
});
```

- [ ] **Step 5: Write `anchortext.golden.test.ts`** (the richest — pins tie-order, numeric-looking anchors, capped-count quirk)

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { AnchorTextParser } from './anchorText.parser';
import { parseString } from '../test-parse-helper';

// Rows: only 'hyperlink' Type counts. Includes a numeric-looking anchor "123",
// a tie between two anchors, an empty anchor, and a non-descriptive anchor.
const rows = [
  'Type,Source,Destination,Anchor,Status Code,Follow,Link Position',
  'hyperlink,https://s/1,https://d/x,About,200,true,Content',
  'hyperlink,https://s/2,https://d/x,Services,200,true,Content',   // d/x now 2 anchors
  'hyperlink,https://s/3,https://d/x,Contact,200,true,Navigation', // d/x now 3 anchors → varied
  'hyperlink,https://s/4,https://d/y,About,200,false,Content',     // "About" count → 2 (tie w/ others at 1? see below)
  'hyperlink,https://s/5,https://d/z,123,200,true,Footer',         // numeric-looking anchor
  'hyperlink,https://s/6,https://d/z,click here,200,true,Footer',  // non-descriptive
  'hyperlink,https://s/7,https://d/w,,200,true,Content',           // empty anchor
  'image,https://s/8,https://d/v,ignored,200,true,Content',        // NOT hyperlink → skipped
];

describe('AnchorTextParser golden', () => {
  it('exact output (tie order, numeric anchor, capped counts)', () => {
    const out = parseString(AnchorTextParser, rows.join('\n'));
    // Characterization: this object is captured from the CURRENT parser and pinned.
    // If the toEqual below is not yet filled, run the parser once and paste its
    // exact return value here, then commit. Do NOT hand-edit values afterward.
    expect(out).toMatchObject({
      total_hyperlinks: 7,
      followed_links: 6,
      nofollowed_links: 1,
    });
    // Full toEqual (fill from a one-time capture, then lock):
    expect(out).toEqual(CAPTURED_ANCHOR_OUTPUT);
  });

  it('empty input → {}', () => {
    expect(parseString(AnchorTextParser, 'Type,Source,Destination,Anchor')).toEqual({});
  });
});

// Paste the captured object here (from a single `npx tsx` run of the current
// parser on `rows`), then remove this comment. It must include: top_anchors
// (sorted desc by count, ties in first-seen order), link_positions, unique_anchors,
// pages_with_varied_anchors (d/x, 3), stats{...}, and issues[] for
// empty_anchor_text (count=1) + non_descriptive_anchor_text (count=1).
declare const CAPTURED_ANCHOR_OUTPUT: unknown;
```

- [ ] **Step 6: Capture the AnchorText golden** — run the current parser once and pin the output

Run:
```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
cat > _cap.ts <<'EOF'
import { AnchorTextParser } from '@/lib/parsers/resources/anchorText.parser';
const rows = ['Type,Source,Destination,Anchor,Status Code,Follow,Link Position',
 'hyperlink,https://s/1,https://d/x,About,200,true,Content',
 'hyperlink,https://s/2,https://d/x,Services,200,true,Content',
 'hyperlink,https://s/3,https://d/x,Contact,200,true,Navigation',
 'hyperlink,https://s/4,https://d/y,About,200,false,Content',
 'hyperlink,https://s/5,https://d/z,123,200,true,Footer',
 'hyperlink,https://s/6,https://d/z,click here,200,true,Footer',
 'hyperlink,https://s/7,https://d/w,,200,true,Content',
 'image,https://s/8,https://d/v,ignored,200,true,Content'];
console.log(JSON.stringify(new AnchorTextParser(rows.join('\n')).parse(), null, 2));
EOF
DATABASE_URL="file:./local-dev.db" npx tsx _cap.ts; rm -f _cap.ts
```
Replace the `CAPTURED_ANCHOR_OUTPUT` placeholder + `declare` line with a literal `const CAPTURED_ANCHOR_OUTPUT = { …captured… };` and drop the `toMatchObject` scaffold once the full `toEqual` is in place.

- [ ] **Step 7: Capture real-crawl baselines for the Task 10 auto-diff** (Codex Medium — parity must be self-checking, not manual)

Snapshot the CURRENT (whole-file) parser output over the real Manhattan exports into committed baseline JSON files. Task 10 diffs the streaming output against these automatically.

```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
mkdir -p test-fixtures/streaming-parity-baseline
cat > _baseline.ts <<'EOF'
import fs from 'fs'; import path from 'path';
import { findParserForFile } from '@/lib/parsers';
const dir = '/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25';
const outDir = 'test-fixtures/streaming-parity-baseline';
for (const f of ['all_outlinks.csv','all_anchor_text.csv','images_all.csv']) {
  const content = fs.readFileSync(path.join(dir, f), 'utf-8');
  const P = findParserForFile(f, content) as any;
  const out = new P(content).parse();
  fs.writeFileSync(path.join(outDir, `${P.parserKey}.json`), JSON.stringify(out, null, 2));
  console.log(f, '->', P.parserKey);
}
EOF
DATABASE_URL="file:./local-dev.db" npx tsx _baseline.ts; rm -f _baseline.ts
```

(These baselines are captured from the pre-refactor parsers and committed here — the streaming output must reproduce them exactly.)

- [ ] **Step 8: Run all 4 golden suites against current code — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/resources/externallinks.golden.test.ts lib/parsers/resources/images.golden.test.ts lib/parsers/resources/linksissues.golden.test.ts lib/parsers/resources/anchortext.golden.test.ts`
Expected: all PASS (they characterize existing behavior).

- [ ] **Step 9: Commit**

```bash
git add lib/parsers/test-parse-helper.ts lib/parsers/resources/*.golden.test.ts test-fixtures/streaming-parity-baseline/
git commit -m "test(c7): interface-agnostic parse helper + golden characterization + real-crawl parity baselines (pre-refactor)"
```

---

## Task 2: Close the 2 deferred pt2 golden-coverage Minors

Fold in the pt2-deferred cases on the consolidated `LengthValidatorParser`: the mask-fallback branch (`!hasIndexable` → `getSeoRelevantMask`) and a nonzero `excluded_urls` case.

**Files:**
- Modify: `lib/parsers/seoElements/pageTitles.golden.test.ts` (append cases)

**Interfaces:**
- Consumes: `PageTitlesParser` (`lib/parsers/seoElements`), base `length-validator.base.ts:33` (mask select) + `:148` (`excluded_urls: this.length - totalPages`).
- Produces: nothing downstream; closes coverage debt.

- [ ] **Step 1: Add the two cases (characterization — capture then pin)**

Append to `pageTitles.golden.test.ts`:

```ts
it('nonzero excluded_urls: non-indexable/non-HTML rows drop from the page set', () => {
  // With an Indexability column present, non-indexable rows are excluded →
  // excluded_urls = total rows - indexable-HTML rows.
  const csv = [
    'Address,Title 1,Indexability',
    'https://ex.com/a,Good Title Here,Indexable',
    'https://ex.com/b,Another Good Title,Non-Indexable',
  ].join('\n');
  const out = new PageTitlesParser(csv).parse() as { total_pages: number; excluded_urls: number };
  expect(out.total_pages).toBe(1);
  expect(out.excluded_urls).toBe(1);
});

it('mask-fallback branch: no Indexability column → getSeoRelevantMask path', () => {
  // No Indexability column → hasIndexable=false → base uses getSeoRelevantMask(addressCol).
  const csv = [
    'Address,Title 1',
    'https://ex.com/a,Good Title Here',
    'https://ex.com/b,Another Good Title',
  ].join('\n');
  const out = new PageTitlesParser(csv).parse() as { total_pages: number; excluded_urls: number };
  expect(out.total_pages).toBe(2);
  expect(out.excluded_urls).toBe(0);
});
```

- [ ] **Step 2: Run — expect PASS (or adjust the pinned numbers to the captured output)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/seoElements/pageTitles.golden.test.ts`
Expected: PASS. If either expectation mismatches, run the parser on the same input via `npx tsx`, then pin the exact `total_pages`/`excluded_urls` it returns (characterization — the goal is to LOCK current behavior, not assert a guess).

- [ ] **Step 3: Commit**

```bash
git add lib/parsers/seoElements/pageTitles.golden.test.ts
git commit -m "test(c7): close pt2 deferred golden Minors (mask-fallback + nonzero excluded_urls)"
```

---

## Task 3: Shared header-map util + `ParserClass` type; refactor `BaseParser` to use it

Extract the header/domain/filename primitives into one pure module used by both bases. Behavior-preserving for `BaseParser` (existing tests + Task 1/2 goldens stay green).

**Files:**
- Create: `lib/parsers/header-map.ts`
- Create: `lib/parsers/header-map.test.ts`
- Modify: `lib/parsers/base.parser.ts` (delegate to the util; keep `this.headers`)

**Interfaces:**
- Produces:
  - `buildHeaderMap(headers: string[]): Map<string, string>`
  - `findColumnInMap(map: Map<string,string>, names: string[]): string | null`
  - `mostCommonHostname(counts: Map<string, number>): string | null`
  - `filenameMatches(pattern: string | string[], filename: string): boolean`
  - `type ParserClass = { name: string; filenamePattern: string | string[]; parserKey: string; streaming?: boolean; matchesFile(f: string): boolean; matchesContent(h: string[]): boolean; matchesRawContent(r: string): boolean; }`

- [ ] **Step 1: Write `header-map.test.ts` (failing)**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildHeaderMap, findColumnInMap, mostCommonHostname, filenameMatches } from './header-map';

describe('header-map util', () => {
  it('buildHeaderMap sets original-case + lowercase keys; later duplicates overwrite', () => {
    const m = buildHeaderMap(['Address', 'ADDRESS']);
    expect(m.get('Address')).toBe('Address');
    // both 'address' (lowercased) entries collapse; last write wins
    expect(m.get('address')).toBe('ADDRESS');
    expect(m.get('ADDRESS')).toBe('ADDRESS');
  });

  it('findColumnInMap is case-insensitive, first-match wins', () => {
    const m = buildHeaderMap(['Status Code']);
    expect(findColumnInMap(m, ['Status Code', 'Status'])).toBe('Status Code');
    expect(findColumnInMap(m, ['status code'])).toBe('Status Code');
    expect(findColumnInMap(m, ['Nope'])).toBeNull();
  });

  it('mostCommonHostname returns the argmax host', () => {
    const c = new Map([['a.com', 1], ['b.com', 3]]);
    expect(mostCommonHostname(c)).toBe('b.com');
    expect(mostCommonHostname(new Map())).toBeNull();
  });

  it('filenameMatches: substring, array, case-insensitive, empty pattern false', () => {
    expect(filenameMatches('all_outlinks', 'all_outlinks.csv')).toBe(true);
    expect(filenameMatches(['images_all', 'images'], 'IMAGES.CSV')).toBe(true);
    expect(filenameMatches('', 'anything.csv')).toBe(false);
    expect(filenameMatches('links_', 'all_inlinks.csv')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './header-map'`)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/header-map.test.ts`

- [ ] **Step 3: Implement `header-map.ts`**

```ts
export type ParserClass = {
  name: string;
  filenamePattern: string | string[];
  parserKey: string;
  streaming?: boolean;
  matchesFile(filename: string): boolean;
  matchesContent(headers: string[]): boolean;
  matchesRawContent(rawContent: string): boolean;
};

/** Build the case-insensitive lookup map exactly as BaseParser did:
 *  original-case + lowercase key per header, in order (later duplicates overwrite). */
export function buildHeaderMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    map.set(h, h);
    map.set(h.toLowerCase(), h);
  }
  return map;
}

export function findColumnInMap(map: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const found = map.get(name) ?? map.get(name.toLowerCase());
    if (found !== undefined) return found;
  }
  return null;
}

export function mostCommonHostname(counts: Map<string, number>): string | null {
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function filenameMatches(pattern: string | string[], filename: string): boolean {
  if (!pattern) return false;
  const lower = filename.toLowerCase();
  if (Array.isArray(pattern)) {
    return pattern.some((p) => lower.includes(p.toLowerCase()));
  }
  return lower.includes(pattern.toLowerCase());
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/header-map.test.ts`

- [ ] **Step 5: Refactor `BaseParser` to delegate (behavior-preserving)**

In `lib/parsers/base.parser.ts`:
- Import: `import { buildHeaderMap, findColumnInMap, mostCommonHostname, filenameMatches } from './header-map';`
- Replace the header-map build loop in the constructor with `this.headerMap = buildHeaderMap(this.headers);` (keep `this.headers = result.meta.fields || []` in `parseCSV` unchanged).
- `matchesFile` body → `return filenameMatches(this.filenamePattern, filename);`
- `findColumn(possibleNames)` body → `return findColumnInMap(this.headerMap, possibleNames);`
- `getPrimaryDomain()` — keep the hostname counting loop; replace the final `return [...counts.entries()].sort(...)[0][0]` block with `return mostCommonHostname(counts);` (and drop the now-redundant `if (counts.size === 0) return null`).
- `headerMap` field type stays `Map<string, string>`.

- [ ] **Step 6: Run the full parser suite — expect PASS (nothing changed behaviorally)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers`
Expected: PASS, incl. Task 1/2 goldens.

- [ ] **Step 7: Commit**

```bash
git add lib/parsers/header-map.ts lib/parsers/header-map.test.ts lib/parsers/base.parser.ts
git commit -m "refactor(c7): extract shared header-map/domain/filename util + ParserClass type; BaseParser delegates"
```

---

## Task 4: `StreamingParser` base + unit tests

**Files:**
- Create: `lib/parsers/streaming-parser.base.ts`
- Create: `lib/parsers/streaming-parser.base.test.ts`

**Interfaces:**
- Consumes: `header-map.ts` util (Task 3); `CSVRow`, `ParsedData` from `lib/types`.
- Produces:
  - `abstract class StreamingParser` with: static `filenamePattern`/`parserKey=''`/`streaming=true`, static `matchesFile`/`matchesContent`/`matchesRawContent`; instance `consume(row: CSVRow): void`, protected `onHeaders(): void`, protected abstract `consumeRow(row: CSVRow): void`, abstract `finalize(): ParsedData`, `getPrimaryDomain(): string | null`, protected `findColumn(names: string[]): string | null`, protected getters `length`/`isEmpty`.

- [ ] **Step 1: Write `streaming-parser.base.test.ts` (failing)** — use a tiny concrete subclass

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { StreamingParser } from './streaming-parser.base';
import type { CSVRow } from '../types';
import type { ParsedData } from '../types';

class Probe extends StreamingParser {
  static parserKey = 'probe';
  static filenamePattern = 'probe_';
  onHeadersCalls = 0;
  headerSnapshot: string[] = [];
  rows: CSVRow[] = [];
  protected onHeaders(): void { this.onHeadersCalls++; this.headerSnapshot = [...this.headers]; }
  protected consumeRow(row: CSVRow): void { this.rows.push(row); }
  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const addr = this.findColumn(['Address', 'URL']);
    return { total: this.length, addrCol: addr } as unknown as ParsedData;
  }
}

describe('StreamingParser', () => {
  it('onHeaders fires exactly once, before the first consumeRow, with headers resolved', () => {
    const p = new Probe();
    p.consume({ Address: 'https://a.com/x', Title: 'T1' });
    p.consume({ Address: 'https://a.com/y', Title: 'T2' });
    expect(p.onHeadersCalls).toBe(1);
    expect(p.headerSnapshot).toEqual(['Address', 'Title']);
    expect(p.rows).toHaveLength(2);
  });

  it('finalize on zero rows returns {} and onHeaders never fires', () => {
    const p = new Probe();
    expect(p.finalize()).toEqual({});
    expect(p.onHeadersCalls).toBe(0);
  });

  it('findColumn is case-insensitive after headers resolve', () => {
    const p = new Probe();
    p.consume({ URL: 'https://a.com/x' });
    expect(p.finalize()).toEqual({ total: 1, addrCol: 'URL' });
  });

  it('getPrimaryDomain returns the most common host from the Address/URL column', () => {
    const p = new Probe();
    p.consume({ Address: 'https://a.com/1' });
    p.consume({ Address: 'https://b.com/1' });
    p.consume({ Address: 'https://a.com/2' });
    expect(p.getPrimaryDomain()).toBe('a.com');
  });

  it('static matchesFile uses filenameMatches', () => {
    expect(Probe.matchesFile('probe_all.csv')).toBe(true);
    expect(Probe.matchesFile('other.csv')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './streaming-parser.base'`)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/streaming-parser.base.test.ts`

- [ ] **Step 3: Implement `streaming-parser.base.ts`**

```ts
import { CSVRow, ParsedData } from '../types';
import { buildHeaderMap, findColumnInMap, mostCommonHostname, filenameMatches } from './header-map';

/**
 * Streaming sibling of BaseParser. Rows arrive one at a time via consume(); the
 * subclass folds each into instance accumulators (consumeRow) and emits output
 * once at the end (finalize). Never retains the full row array — bounds peak
 * memory for the big-file parsers. Column names are resolved once, before the
 * first row folds, in onHeaders() (several parsers need a column to decide
 * whether to count a row).
 *
 * parserKey MUST be an explicit literal on each subclass (prod minifies class
 * names). The base declares '' and is never registered.
 */
export abstract class StreamingParser {
  static filenamePattern: string | string[] = '';
  static parserKey = '';
  static streaming = true;

  static matchesFile(filename: string): boolean {
    return filenameMatches(this.filenamePattern, filename);
  }
  static matchesContent(_headers: string[]): boolean { return false; }
  static matchesRawContent(_rawContent: string): boolean { return false; }

  protected headers: string[] = [];
  private headerMap = new Map<string, string>();
  private headersResolved = false;
  private rowCount = 0;
  private domainCounts = new Map<string, number>();

  /** Route stream driver calls this once per data row. */
  consume(row: CSVRow): void {
    if (!this.headersResolved) {
      this.headers = Object.keys(row);
      this.headerMap = buildHeaderMap(this.headers);
      this.headersResolved = true;
      this.onHeaders();
    }
    this.rowCount++;
    this.trackDomain(row);
    this.consumeRow(row);
  }

  /** Resolve + cache column names into fields. Runs once, before any consumeRow. */
  protected onHeaders(): void {}

  protected abstract consumeRow(row: CSVRow): void;
  abstract finalize(): ParsedData;

  protected get length(): number { return this.rowCount; }
  protected get isEmpty(): boolean { return this.rowCount === 0; }

  protected findColumn(possibleNames: string[]): string | null {
    return findColumnInMap(this.headerMap, possibleNames);
  }

  getPrimaryDomain(): string | null {
    return mostCommonHostname(this.domainCounts);
  }

  private trackDomain(row: CSVRow): void {
    const addressCol = this.findColumn(['Address', 'URL']);
    if (!addressCol) return;
    const val = row[addressCol];
    if (typeof val === 'string' && val.startsWith('http')) {
      try {
        const { hostname } = new URL(val);
        if (hostname) this.domainCounts.set(hostname, (this.domainCounts.get(hostname) ?? 0) + 1);
      } catch { /* skip non-URL */ }
    }
  }
}
```

> Note: `getPrimaryDomain` here counts only the Address/URL column (same as `BaseParser.getPrimaryDomain`). `trackDomain` uses `typeof val === 'string'` (not `toString`) — no extra imports, no unused-import lint failure.

- [ ] **Step 4: Run — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/streaming-parser.base.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/streaming-parser.base.ts lib/parsers/streaming-parser.base.test.ts
git commit -m "feat(c7): add StreamingParser sibling base (consume/onHeaders/finalize lifecycle)"
```

---

## Task 5: `streamCsv` driver + generic Papa whole-file-vs-stream parity table

The route's stream driver, plus the proof that `Papa.parse(string)` and `Papa.parse(NODE_STREAM_INPUT)` tokenize identically.

**Files:**
- Create: `lib/parsers/stream-csv.ts`
- Create: `lib/parsers/papa-parity.test.ts`
- Create: `lib/parsers/stream-csv.test.ts`

**Interfaces:**
- Produces:
  - `streamCsv(filePath: string, onRow: (row: CSVRow) => void): Promise<void>` — resolves after the stream completes, rejects on file/Papa error (streams destroyed).
  - `PAPA_CONFIG` constant (shared config) — optional export for parity assertions.

- [ ] **Step 1: Write `papa-parity.test.ts` (failing)** — same bytes, both Papa entry points

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { Readable } from 'node:stream';

const CFG = { header: true, skipEmptyLines: true, dynamicTyping: true } as const;

function whole(csv: string): unknown[] {
  return Papa.parse(csv, CFG).data as unknown[];
}
function streamed(csv: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const rows: unknown[] = [];
    const stream = Papa.parse(Papa.NODE_STREAM_INPUT, CFG);
    stream.on('data', (r) => rows.push(r));
    stream.on('end', () => resolve(rows));
    stream.on('error', reject);
    Readable.from([csv]).pipe(stream);
  });
}

// Cases where the two RAW Papa entry points tokenize identically.
const CASES: Record<string, string> = {
  crlf: 'Address,Title\r\nhttps://a.com/x,Hi\r\nhttps://a.com/y,Yo',
  trailingBlank: 'Address,Title\nhttps://a.com/x,Hi\n\n',
  noFinalNewline: 'Address,Title\nhttps://a.com/x,Hi',
  headerOnly: 'Address,Title',
  empty: '',
  extraColumns: 'Address,Title\nhttps://a.com/x,Hi,EXTRA,MORE',
  quotedNewline: 'Address,Title\nhttps://a.com/x,"line1\nline2"',
  dynamicTypes: 'A,B,C,D,E\n1,1.5,true,,"123"',
};

describe('Papa whole-file vs stream parity', () => {
  for (const [name, csv] of Object.entries(CASES)) {
    it(`identical rows: ${name}`, async () => {
      expect(await streamed(csv)).toEqual(whole(csv));
    });
  }

  // KNOWN ASYMMETRY (papaparse 5.5.3): the string path runs stripBom, the
  // NODE_STREAM_INPUT path does NOT. This is exactly why streamCsv() strips the
  // BOM itself (see stream-csv.ts) — proven at the driver level in stream-csv.test.ts.
  it('documents the raw BOM asymmetry the driver compensates for', async () => {
    const bom = '﻿Address,Title\nhttps://a.com/x,Hello';
    const wholeKey = Object.keys(whole(bom)[0])[0];
    const streamKey = Object.keys((await streamed(bom))[0])[0];
    expect(wholeKey).toBe('Address');        // string path strips BOM
    expect(streamKey).toBe('﻿Address');  // raw stream path does not
  });
});
```

- [ ] **Step 2: Run — expect PASS** (pins the invariant the design rests on; no product code yet)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/papa-parity.test.ts`
Expected: PASS — the 8 raw cases match, and the BOM-asymmetry test documents the one divergence that `streamCsv` compensates for. If any of the 8 raw cases diverges, STOP — that is a parity blocker beyond BOM; capture it before proceeding.

- [ ] **Step 3: Write `stream-csv.test.ts` (failing)**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { streamCsv } from './stream-csv';
import type { CSVRow } from '../types';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function tmp(content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `stream-csv-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(p, content, 'utf-8');
  return p;
}

describe('streamCsv', () => {
  it('delivers each row then resolves', async () => {
    const p = await tmp('Address,Title\nhttps://a.com/x,Hi\nhttps://a.com/y,Yo');
    const rows: CSVRow[] = [];
    await streamCsv(p, (r) => rows.push(r));
    expect(rows).toEqual([
      { Address: 'https://a.com/x', Title: 'Hi' },
      { Address: 'https://a.com/y', Title: 'Yo' },
    ]);
    await fs.rm(p, { force: true });
  });

  it('rejects on a missing file', async () => {
    await expect(streamCsv('/no/such/file.csv', () => {})).rejects.toBeTruthy();
  });

  it('delivers ALL rows before resolving (no early finish, Codex High 2)', async () => {
    const N = 5000;
    const lines = ['Address,Title', ...Array.from({ length: N }, (_, i) => `https://a.com/${i},T${i}`)];
    const p = await tmp(lines.join('\n'));
    let count = 0;
    await streamCsv(p, () => { count++; });
    expect(count).toBe(N);
    await fs.rm(p, { force: true });
  });

  it('strips a leading BOM so the first header matches the whole-file path', async () => {
    // Every real SF export starts with a UTF-8 BOM. streamCsv must strip it so
    // findColumn(['Address','URL']) resolves — matching Papa.parse(string).
    const p = await tmp('﻿Address,Title\nhttps://a.com/x,Hi');
    const rows: CSVRow[] = [];
    await streamCsv(p, (r) => rows.push(r));
    expect(Object.keys(rows[0])[0]).toBe('Address');   // NOT '﻿Address'
    expect(rows).toEqual([{ Address: 'https://a.com/x', Title: 'Hi' }]);
    await fs.rm(p, { force: true });
  });
});
```

- [ ] **Step 4: Run — expect FAIL** (`Cannot find module './stream-csv'`)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/stream-csv.test.ts`

- [ ] **Step 5: Implement `stream-csv.ts`**

```ts
import fs from 'fs';
import { Transform } from 'stream';
import Papa from 'papaparse';
import { CSVRow } from '../types';

/** Papa config MUST match BaseParser.parseCSV exactly (parity). */
export const PAPA_CONFIG = { header: true, skipEmptyLines: true, dynamicTyping: true } as const;

/**
 * Strip a leading UTF-8 BOM from the first string chunk.
 *
 * BOM PARITY (verified, papaparse 5.5.3): `Papa.parse(string)` runs `stripBom`
 * on its input, so a leading BOM is removed; the `NODE_STREAM_INPUT` path does
 * NOT strip it. Every real Screaming Frog export begins with a UTF-8 BOM, which
 * would otherwise attach to the first header cell (`﻿Address`) and break
 * `findColumn(['Address','URL'])`. The current whole-file parsers rely on Papa's
 * string-path stripping; the streaming driver must reproduce it so its rows are
 * byte-identical to the whole-file path. `decodeStrings: false` keeps chunks as
 * the strings the utf8 file stream emits.
 */
function bomStripper(): Transform {
  let first = true;
  return new Transform({
    decodeStrings: false,
    transform(chunk: string, _enc, cb) {
      if (first) {
        first = false;
        cb(null, chunk.charCodeAt(0) === 0xfeff ? chunk.slice(1) : chunk);
      } else {
        cb(null, chunk);
      }
    },
  });
}

/**
 * Stream a CSV file row-by-row into `onRow`. Resolves after the Papa stream
 * finishes; rejects (and destroys all streams) on a file-read or Papa error.
 */
export function streamCsv(filePath: string, onRow: (row: CSVRow) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const stripper = bomStripper();
    const papaStream = Papa.parse(Papa.NODE_STREAM_INPUT, PAPA_CONFIG);

    const fail = (err: unknown) => {
      fileStream.destroy();
      stripper.destroy();
      papaStream.destroy?.();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    fileStream.on('error', fail);
    stripper.on('error', fail);
    papaStream.on('error', fail);
    papaStream.on('data', (row: CSVRow) => {
      try { onRow(row); } catch (err) { fail(err); }
    });
    // Resolve ONLY on the readable-side 'end' (all parsed rows delivered).
    // NOT 'finish' — that's the writable side finishing and can fire before the
    // last 'data' events are consumed (Codex High 2).
    papaStream.on('end', () => resolve());

    fileStream.pipe(stripper).pipe(papaStream);
  });
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/stream-csv.test.ts lib/parsers/papa-parity.test.ts`

- [ ] **Step 7: Commit**

```bash
git add lib/parsers/stream-csv.ts lib/parsers/stream-csv.test.ts lib/parsers/papa-parity.test.ts
git commit -m "feat(c7): streamCsv driver (Papa NODE_STREAM_INPUT) + generic whole-file-vs-stream parity table"
```

---

## Task 6: Route two-path `parseOne` + `readHeaderChunk` + registry type widening

Wire the streaming path into the parse route BEFORE converting real parsers, so each conversion lands on a route that already drives streaming parsers. Also widen the registry types so streaming subclasses will type-check.

**Files:**
- Create: `lib/parsers/read-header-chunk.ts`
- Create: `lib/parsers/read-header-chunk.test.ts`
- Modify: `lib/parsers/index.ts` (widen `PARSERS`/`PARSER_MAP`/`findParserForFile` to `ParserClass`; add optional no-arg overload of `findParserForFile`)
- Modify: `app/api/parse/[sessionId]/route.ts` (`parseOne` two-path)
- Modify: `lib/parsers/parser-key.test.ts` (cast update to `ParserClass`)
- Create: `lib/parsers/detection-equivalence.test.ts` (**real** `findParserForFile`, NOT the mocked route test — Codex High 3)

**Interfaces:**
- Consumes: `streamCsv` (Task 5), `StreamingParser` (Task 4), `ParserClass` (Task 3), `findParserForFile` (existing).
- Produces: `readHeaderChunk(filePath: string, opts?: { baseChars?: number; maxChars?: number }): Promise<string>`. (Named `*Chars` not `*Bytes` because the stream is decoded `utf8`, so the accumulator length is characters, not bytes — Codex Low. Immaterial for a 64 KB ASCII-ish detection peek.)

- [ ] **Step 1: Write `read-header-chunk.test.ts` (failing)**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readHeaderChunk } from './read-header-chunk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function tmp(content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `peek-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(p, content, 'utf-8');
  return p;
}

describe('readHeaderChunk', () => {
  it('returns the full content when smaller than the base size', async () => {
    const p = await tmp('Address,Title\nhttps://a.com/x,Hi');
    expect(await readHeaderChunk(p)).toBe('Address,Title\nhttps://a.com/x,Hi');
    await fs.rm(p, { force: true });
  });

  it('reads at least through the first newline', async () => {
    // base size tiny so we prove the newline-extension loop
    const p = await tmp('col1,col2,col3\nrow');
    const out = await readHeaderChunk(p, { baseChars: 4, maxChars: 1024 });
    expect(out.includes('\n')).toBe(true);
    expect(out.startsWith('col1,col2,col3')).toBe(true);
    await fs.rm(p, { force: true });
  });

  it('caps at maxChars when no newline appears', async () => {
    const p = await tmp('x'.repeat(5000)); // no newline
    const out = await readHeaderChunk(p, { baseChars: 64, maxChars: 1000 });
    expect(out.length).toBeLessThanOrEqual(1000);
    await fs.rm(p, { force: true });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/read-header-chunk.test.ts`

- [ ] **Step 3: Implement `read-header-chunk.ts`**

```ts
import fs from 'fs';

const DEFAULT_BASE_CHARS = 64 * 1024;
const DEFAULT_MAX_CHARS = 1024 * 1024;

/**
 * Read a bounded top-of-file prefix sufficient for content-based parser
 * detection: at least `baseChars`, extended until the first newline (so the
 * full header line is present), hard-capped at `maxChars`. Used only when
 * filename detection misses. Stream is decoded utf8, so the accumulator is
 * measured in characters, not bytes (immaterial for a detection peek).
 */
export function readHeaderChunk(
  filePath: string,
  opts: { baseChars?: number; maxChars?: number } = {}
): Promise<string> {
  const baseChars = opts.baseChars ?? DEFAULT_BASE_CHARS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  return new Promise<string>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    let buf = '';
    const done = () => { stream.destroy(); resolve(buf.slice(0, maxChars)); };
    stream.on('data', (chunk: string) => {
      buf += chunk;
      const hasNewline = buf.indexOf('\n') !== -1;
      if ((buf.length >= baseChars && hasNewline) || buf.length >= maxChars) done();
    });
    stream.on('end', () => resolve(buf.slice(0, maxChars)));
    stream.on('error', reject);
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/read-header-chunk.test.ts`

- [ ] **Step 5: Widen registry types in `lib/parsers/index.ts`**

- `import { BaseParser } from './base.parser';` stays; add `import type { ParserClass } from './header-map';`
- Change `export const PARSERS: Array<typeof BaseParser> = [ … ]` → `export const PARSERS: ParserClass[] = [ … ]`
- Change `export const PARSER_MAP: Record<string, typeof BaseParser> = { … }` → `Record<string, ParserClass>`
- Change `findParserForFile(...): typeof BaseParser | null` → `ParserClass | null`, and make `rawContent` optional (already is). Add filename-only fast return (unchanged logic; content steps guarded by `if (!rawContent) return null;` which already exists).
- The named re-export block (`index.ts:254-298`) exports concrete symbols, not `typeof BaseParser`, so it does NOT need changing (Codex confirmed).
- **Update `lib/parsers/parser-key.test.ts`** — it currently casts each parser to `typeof BaseParser`; change those casts to the new `ParserClass` type (import from `./header-map`) so the test reflects the widened registry contract. Behavior unchanged; it still asserts every parser declares its own literal `parserKey` (the minification guard — must keep covering the streaming subclasses).

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
Expected: PASS (BaseParser subclasses still satisfy `ParserClass`).

- [ ] **Step 6: Rewrite `parseOne` in `app/api/parse/[sessionId]/route.ts`**

Replace the body of `parseOne` (currently reads the whole file, then detects, then parses) with the two-path version:

```ts
import { readHeaderChunk } from '@/lib/parsers/read-header-chunk';
import { streamCsv } from '@/lib/parsers/stream-csv';
import type { CSVRow } from '@/lib/types';

// … inside POST, replacing the existing parseOne …
type AnyWholeFileParser = { parse(): Record<string, unknown>; getPrimaryDomain(): string | null };
type AnyStreamingParser = {
  consume(row: CSVRow): void; finalize(): Record<string, unknown>; getPrimaryDomain(): string | null;
};

const parseOne = async (filename: string): Promise<FileOutcome> => {
  const filePath = path.join(uploadDir, filename);

  if (path.extname(filename).toLowerCase() !== '.csv') {
    return { report: { filename, status: 'skipped', severity: 'info' } };
  }
  try { await fs.access(filePath); } catch { return failed(filename, 'File not found'); }

  // Detection: filename first; peek only if that misses.
  let ParserClass = findParserForFile(filename);
  if (!ParserClass) {
    let headerChunk: string;
    try { headerChunk = await readHeaderChunk(filePath); }
    catch (e) { return failed(filename, e instanceof Error ? e.message : 'Unknown error'); }
    ParserClass = findParserForFile(filename, headerChunk);
  }
  if (!ParserClass) return { report: { filename, status: 'unmatched', severity: 'info' } };

  const parserName = (ParserClass as unknown as { parserKey?: string }).parserKey
    || ParserClass.name.replace('Parser', '').toLowerCase();

  try {
    let result: Record<string, unknown>;
    let primaryDomain: string | null;
    if ((ParserClass as unknown as { streaming?: boolean }).streaming) {
      const Ctor = ParserClass as unknown as new () => AnyStreamingParser;
      const parser = new Ctor();
      await streamCsv(filePath, (row) => parser.consume(row));
      result = parser.finalize();
      primaryDomain = parser.getPrimaryDomain();
    } else {
      const rawContent = await fs.readFile(filePath, 'utf-8');
      const Ctor = ParserClass as unknown as new (content: string) => AnyWholeFileParser;
      const parser = new Ctor(rawContent);
      result = parser.parse();
      primaryDomain = parser.getPrimaryDomain();
    }
    return {
      report: { filename, status: 'parsed', parser: parserName, severity: 'info' },
      success: { parserName, result, filename, primaryDomain },
    };
  } catch (parseError) {
    return failed(filename, parseError instanceof Error ? parseError.message : 'Unknown error');
  }
};
```

(Delete the now-unused `AnyParser` type and the old whole-file-first read block. Keep `failed`, `FileOutcome`, `ParseSuccess`, the `reports`/`successes` loop, and everything after it unchanged.)

- [ ] **Step 7: Detection-equivalence tests in a NON-mocked file** (Codex High 3)

`app/api/parse/[sessionId]/route.test.ts` mocks `@/lib/parsers` (`vi.mock('@/lib/parsers', …)`), so any `findParserForFile` assertion placed there would exercise the MOCK, not the real registry. Put the real detection-equivalence tests in a fresh file with no route mock. First read `SemrushPositionTrackingParser.matchesRawContent`/`matchesContent` for the exact trigger strings (real matcher: trimmed content starts with `-----` and contains `Report type: position_tracking_pages`).

Create `lib/parsers/detection-equivalence.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { findParserForFile } from '@/lib/parsers';
import { readHeaderChunk } from './read-header-chunk';

const CRAWL = '/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25';

describe('peek-vs-full detection equivalence', () => {
  const files = fs.existsSync(CRAWL) ? fs.readdirSync(CRAWL).filter((f) => f.endsWith('.csv')) : [];
  for (const f of files) {
    it(`same parser from peek and full: ${f}`, async () => {
      const full = fs.readFileSync(path.join(CRAWL, f), 'utf-8');
      const peek = await readHeaderChunk(path.join(CRAWL, f));
      expect(findParserForFile(f, peek)).toBe(findParserForFile(f, full));
    });
  }

  it('SEMRush Position Tracking: peek detection equals full (metadata preamble)', () => {
    // Real matcher: trimmed content starts with '-----' and contains
    // 'Report type: position_tracking_pages'.
    const full = [
      '-----',
      'Project: example.com',
      'Report type: position_tracking_pages',
      '-----',
      'URL,Keywords,Average Position,Estimated Traffic',
      'https://a.com/x,5,3.2,120',
    ].join('\n');
    const peek = full.slice(0, 64 * 1024);
    const a = findParserForFile('pt_20260703.csv', peek);
    const b = findParserForFile('pt_20260703.csv', full);
    expect(a).toBe(b);
    expect(a && (a as { parserKey: string }).parserKey).toBe('semrushpositiontracking');
  });
});
```

> The exact `-----`/`Report type:` strings above are illustrative — confirm them against the real `SemrushPositionTrackingParser` before finalizing, and adjust if the matcher differs.

- [ ] **Step 8: Add route tests** in `app/api/parse/[sessionId]/route.test.ts`

These stay in the mocked route test (they exercise `parseOne`'s branching via the `findParserForFileMock`, not the real registry). Follow the file's existing named-mock convention:
- **streaming path:** configure `findParserForFileMock` to return a fake class with `streaming = true` + `consume`/`finalize`; write a small CSV to the session upload dir; assert the outcome is `parsed` with the fake's `finalize()` result and that the file was driven via `consume` (not `fs.readFile`).
- **unmatched not fully read:** `findParserForFileMock` returns `null`; assert outcome `unmatched`. (Optional: spy on `fs.readFile`/`readHeaderChunk` to assert only the peek ran.)
- **whole-file path unchanged:** `findParserForFileMock` returns a fake whole-file class (`parse()`), assert it still routes through the `readFile` branch.

- [ ] **Step 9: Run detection + route + parser suites — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers app/api/parse`
Expected: PASS. All real parsers still flow through the whole-file branch (none is `streaming` yet); the streaming branch is exercised by the route test's fake streaming class; detection-equivalence runs against the real registry.

- [ ] **Step 10: Commit**

```bash
git add lib/parsers/read-header-chunk.ts lib/parsers/read-header-chunk.test.ts lib/parsers/detection-equivalence.test.ts lib/parsers/index.ts lib/parsers/parser-key.test.ts app/api/parse/[sessionId]/route.ts app/api/parse/[sessionId]/route.test.ts
git commit -m "feat(c7): two-path parseOne (filename-first detect + header-peek + streamCsv) + widen registry to ParserClass"
```

---

## Task 7: Convert `ExternalLinksParser` + `LinksIssuesParser` to `StreamingParser`

Both live in `links.parser.ts`. Golden suites (Task 1) stay green.

**Files:**
- Modify: `lib/parsers/resources/links.parser.ts`

**Interfaces:**
- Consumes: `StreamingParser` (Task 4).
- Produces: `ExternalLinksParser`/`LinksIssuesParser` now expose `consume`/`finalize` and `static streaming = true`; still `parserKey` literals `'externallinks'`/`'linksissues'`; still exported + registered unchanged.

- [ ] **Step 1: Replace `links.parser.ts` with the streaming versions**

```ts
import { StreamingParser } from '../streaming-parser.base';
import { ParsedData, Issue, CSVRow } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class LinksIssuesParser extends StreamingParser {
  static parserKey = 'linksissues';
  static filenamePattern = 'links_';

  private addressCol: string | null = null;
  private crawlDepthCol: string | null = null;
  private urls: string[] = [];
  private maxDepth = 0;

  protected onHeaders(): void {
    this.addressCol = this.findColumn(['Address', 'URL']);
    this.crawlDepthCol = this.findColumn(['Crawl Depth', 'Depth']);
  }

  protected consumeRow(row: CSVRow): void {
    if (this.addressCol) {
      const url = toString(row[this.addressCol]);
      if (url) this.urls.push(url);
    }
    if (this.crawlDepthCol) {
      const depth = toNumber(row[this.crawlDepthCol]);
      if (depth !== null && depth > this.maxDepth) this.maxDepth = depth;
    }
  }

  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const stats: Record<string, number> = {};
    if (this.maxDepth > 0) stats.max_crawl_depth = this.maxDepth;
    const issues: Issue[] = [{
      type: 'links_quality_issue',
      severity: 'warning',
      count: this.length,
      description: `${this.length} page(s) with link quality issues`,
      urls: this.urls,
    }];
    return {
      total_pages: this.length,
      stats: Object.keys(stats).length > 0 ? stats : undefined,
      issues,
    };
  }
}

export class ExternalLinksParser extends StreamingParser {
  static parserKey = 'externallinks';
  static filenamePattern = 'all_outlinks';

  private destCol: string | null = null;
  private statusCol: string | null = null;
  private brokenUrls: string[] = [];
  private brokenCount = 0;

  protected onHeaders(): void {
    this.destCol = this.findColumn(['Destination', 'To', 'Target']);
    this.statusCol = this.findColumn(['Status Code', 'Status']);
  }

  protected consumeRow(row: CSVRow): void {
    if (this.statusCol && this.destCol) {
      const status = toNumber(row[this.statusCol]);
      if (status !== null && status >= 400 && status < 600) {
        this.brokenCount++;
        this.brokenUrls.push(toString(row[this.destCol]));
      }
    }
  }

  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const issues: Issue[] = [];
    const stats: Record<string, number> = {};
    if (this.statusCol && this.destCol) {
      stats.broken_external_links = this.brokenCount;
      if (this.brokenCount > 0) {
        issues.push({
          type: 'broken_external_links',
          severity: 'warning',
          count: this.brokenCount,
          description: `${this.brokenCount} broken external links`,
          urls: this.brokenUrls,
        });
      }
    }
    return { total_external_links: this.length, stats, issues };
  }
}
```

> **Parity note:** the whole-file `ExternalLinksParser` resolved `statusCol`/`destCol` at parse start and only accumulated when BOTH exist — `onHeaders` + the `this.statusCol && this.destCol` guard reproduce that exactly. `stats` is `{}` when the columns are absent (matches original). `total_external_links` = row count (`this.length`).

- [ ] **Step 2: Migrate the EXISTING `links.parser.test.ts` to `parseString` (Codex High 1)**

`lib/parsers/resources/links.parser.test.ts` calls `new LinksIssuesParser(csv).parse()` / `new ExternalLinksParser(csv).parse()` — these break now that the classes are streaming (no string ctor, no `parse()`). Replace every `new XParser(csv).parse()` with `parseString(XParser, csv)` and add `import { parseString } from '../test-parse-helper';`. Static-property assertions (`filenamePattern`, `matchesFile`) stay unchanged. This must be in THIS commit (same commit as the conversion) so the suite never has a red intermediate state.

- [ ] **Step 3: Run golden + parser suites — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/resources/externallinks.golden.test.ts lib/parsers/resources/linksissues.golden.test.ts lib/parsers/resources/links.parser.test.ts`
Expected: PASS (byte-identical to Task 1 snapshots).

- [ ] **Step 4: tsc — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/resources/links.parser.ts lib/parsers/resources/links.parser.test.ts
git commit -m "feat(c7): stream ExternalLinksParser + LinksIssuesParser via StreamingParser"
```

---

## Task 8: Convert `AnchorTextParser` to `StreamingParser`

Highest parity care: preserve `Record` structures, tie-order, and the capped-count quirk verbatim.

**Files:**
- Modify: `lib/parsers/resources/anchorText.parser.ts`

- [ ] **Step 1: Convert — loop body → `consumeRow`, post-loop → `finalize`, columns → `onHeaders`, accumulators → fields (verbatim)**

```ts
import { StreamingParser } from '../streaming-parser.base';
import { ParsedData, Issue, CSVRow } from '../../types';
import { toString } from '../../utils/columnMapper';

export class AnchorTextParser extends StreamingParser {
  static parserKey = 'anchortext';
  static filenamePattern = 'all_anchor_text';

  private static NON_DESCRIPTIVE_ANCHORS = [
    'click here', 'read more', 'learn more', 'more', 'here', 'link', 'this',
    'page', 'click', 'go', 'see more', 'view more', 'continue', 'details', 'info',
  ];

  private typeCol: string | null = null;
  private sourceCol: string | null = null;
  private destinationCol: string | null = null;
  private anchorCol: string | null = null;
  private followCol: string | null = null;
  private linkPositionCol: string | null = null;

  private anchorCounts: Record<string, number> = {};
  private destinationAnchors: Record<string, Set<string>> = {};
  private emptyAnchorUrls: string[] = [];
  private nonDescriptiveUrls: string[] = [];
  private positionCounts: Record<string, number> = {};
  private totalHyperlinks = 0;
  private followedLinks = 0;
  private nofollowedLinks = 0;

  protected onHeaders(): void {
    this.typeCol = this.findColumn(['Type']);
    this.sourceCol = this.findColumn(['Source']);
    this.destinationCol = this.findColumn(['Destination']);
    this.anchorCol = this.findColumn(['Anchor', 'Anchor Text']);
    this.followCol = this.findColumn(['Follow']);
    this.linkPositionCol = this.findColumn(['Link Position', 'Position']);
  }

  protected consumeRow(row: CSVRow): void {
    const type = this.typeCol ? toString(row[this.typeCol]).toLowerCase() : '';
    if (type !== 'hyperlink') return;
    this.totalHyperlinks++;

    const source = this.sourceCol ? toString(row[this.sourceCol]) : '';
    const destination = this.destinationCol ? toString(row[this.destinationCol]) : '';
    const anchor = this.anchorCol ? toString(row[this.anchorCol]).trim() : '';
    const follow = this.followCol ? toString(row[this.followCol]).toLowerCase() : 'true';
    const position = this.linkPositionCol ? toString(row[this.linkPositionCol]) : 'Unknown';

    if (follow === 'true') this.followedLinks++; else this.nofollowedLinks++;
    if (position) this.positionCounts[position] = (this.positionCounts[position] || 0) + 1;

    if (anchor) {
      const normalizedAnchor = anchor.toLowerCase();
      this.anchorCounts[normalizedAnchor] = (this.anchorCounts[normalizedAnchor] || 0) + 1;
      if (destination) {
        if (!this.destinationAnchors[destination]) this.destinationAnchors[destination] = new Set();
        this.destinationAnchors[destination].add(anchor);
      }
      if (AnchorTextParser.NON_DESCRIPTIVE_ANCHORS.includes(normalizedAnchor)) {
        if (this.nonDescriptiveUrls.length < 50) {
          this.nonDescriptiveUrls.push(`${source} -> "${anchor}" -> ${destination}`);
        }
      }
    } else {
      if (this.emptyAnchorUrls.length < 50 && source) {
        this.emptyAnchorUrls.push(`${source} -> ${destination}`);
      }
    }
  }

  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const issues: Issue[] = [];

    const topAnchors = Object.entries(this.anchorCounts)
      .filter(([anchor]) => anchor.length > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([anchor, count]) => ({ anchor, count }));

    const pagesWithVariedAnchors: Array<{ url: string; uniqueAnchors: number }> = [];
    const pagesWithSingleAnchor: string[] = [];
    for (const [url, anchors] of Object.entries(this.destinationAnchors)) {
      if (anchors.size >= 3) pagesWithVariedAnchors.push({ url, uniqueAnchors: anchors.size });
      else if (anchors.size === 1) pagesWithSingleAnchor.push(url);
    }
    pagesWithVariedAnchors.sort((a, b) => b.uniqueAnchors - a.uniqueAnchors);

    if (this.emptyAnchorUrls.length > 0) {
      issues.push({
        type: 'empty_anchor_text', severity: 'warning', count: this.emptyAnchorUrls.length,
        description: `${this.emptyAnchorUrls.length} internal links with empty anchor text`,
        urls: this.emptyAnchorUrls.slice(0, 30),
      });
    }
    if (this.nonDescriptiveUrls.length > 0) {
      issues.push({
        type: 'non_descriptive_anchor_text', severity: 'notice', count: this.nonDescriptiveUrls.length,
        description: `${this.nonDescriptiveUrls.length} internal links with non-descriptive anchor text (e.g., "click here", "read more")`,
        urls: this.nonDescriptiveUrls.slice(0, 30),
      });
    }
    if (pagesWithSingleAnchor.length > 10) {
      issues.push({
        type: 'single_anchor_variation', severity: 'notice', count: pagesWithSingleAnchor.length,
        description: `${pagesWithSingleAnchor.length} pages receive internal links with only one anchor text variation. Consider diversifying anchor text.`,
        urls: pagesWithSingleAnchor.slice(0, 30),
      });
    }

    return {
      total_hyperlinks: this.totalHyperlinks,
      followed_links: this.followedLinks,
      nofollowed_links: this.nofollowedLinks,
      unique_anchors: Object.keys(this.anchorCounts).length,
      top_anchors: topAnchors,
      link_positions: this.positionCounts,
      pages_with_varied_anchors: pagesWithVariedAnchors.slice(0, 20),
      stats: {
        total_hyperlinks: this.totalHyperlinks,
        unique_anchor_texts: Object.keys(this.anchorCounts).length,
        empty_anchors: this.emptyAnchorUrls.length,
        non_descriptive_anchors: this.nonDescriptiveUrls.length,
        followed_percentage: this.totalHyperlinks > 0
          ? Math.round((this.followedLinks / this.totalHyperlinks) * 100) : 0,
      },
      issues,
    };
  }
}
```

- [ ] **Step 2: Run the AnchorText golden — expect PASS (byte-identical)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/resources/anchortext.golden.test.ts`

- [ ] **Step 3: tsc — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/parsers/resources/anchorText.parser.ts
git commit -m "feat(c7): stream AnchorTextParser via StreamingParser (Records/tie-order/caps preserved)"
```

---

## Task 9: Convert `ImagesParser` to `StreamingParser`

**Files:**
- Modify: `lib/parsers/resources/images.parser.ts`

- [ ] **Step 1: Convert (columns → `onHeaders`, loop → `consumeRow`, post-loop → `finalize`)**

```ts
import { StreamingParser } from '../streaming-parser.base';
import { ParsedData, Issue, CSVRow } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class ImagesParser extends StreamingParser {
  static parserKey = 'images';
  static filenamePattern = ['images_all', 'images'];

  private static LARGE_IMAGE_SIZE = 100 * 1024;
  private static VERY_LARGE_IMAGE_SIZE = 500 * 1024;

  private addressCol: string | null = null;
  private altTextCol: string | null = null;
  private sizeCol: string | null = null;
  private statusCol: string | null = null;
  private widthCol: string | null = null;
  private heightCol: string | null = null;

  private missingAltUrls: string[] = [];
  private largeUrls: string[] = [];
  private veryLargeUrls: string[] = [];
  private brokenUrls: string[] = [];
  private missingDimsUrls: string[] = [];
  private missingAltCount = 0; private imagesWithAlt = 0;
  private largeCount = 0; private veryLargeCount = 0;
  private brokenCount = 0; private missingDimsCount = 0;

  protected onHeaders(): void {
    this.addressCol = this.findColumn(['Address', 'URL']);
    this.altTextCol = this.findColumn(['Alt Text', 'Alt']);
    this.sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    this.statusCol = this.findColumn(['Status Code', 'Status']);
    this.widthCol = this.findColumn(['Width', 'img width', 'Image Width']);
    this.heightCol = this.findColumn(['Height', 'img height', 'Image Height']);
  }

  protected consumeRow(row: CSVRow): void {
    const addr = this.addressCol ? toString(row[this.addressCol]) : '';
    if (this.altTextCol) {
      const alt = toString(row[this.altTextCol]);
      if (!alt) { this.missingAltCount++; if (this.addressCol && this.missingAltUrls.length < 30) this.missingAltUrls.push(addr); }
      else this.imagesWithAlt++;
    }
    if (this.sizeCol) {
      const size = toNumber(row[this.sizeCol]);
      if (size !== null) {
        if (size > ImagesParser.VERY_LARGE_IMAGE_SIZE) { this.veryLargeCount++; if (this.addressCol && this.veryLargeUrls.length < 20) this.veryLargeUrls.push(addr); }
        else if (size > ImagesParser.LARGE_IMAGE_SIZE) { this.largeCount++; if (this.addressCol && this.largeUrls.length < 30) this.largeUrls.push(addr); }
      }
    }
    if (this.statusCol) {
      const status = toNumber(row[this.statusCol]);
      if (status !== null && status >= 400 && status < 600) { this.brokenCount++; if (this.addressCol && this.brokenUrls.length < 30) this.brokenUrls.push(addr); }
    }
    if (this.widthCol || this.heightCol) {
      const width = this.widthCol ? toString(row[this.widthCol]) : null;
      const height = this.heightCol ? toString(row[this.heightCol]) : null;
      const missingWidth = this.widthCol && (!width || width === '0');
      const missingHeight = this.heightCol && (!height || height === '0');
      if (missingWidth || missingHeight) { this.missingDimsCount++; if (this.addressCol && this.missingDimsUrls.length < 30) this.missingDimsUrls.push(addr); }
    }
  }

  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const issues: Issue[] = [];
    const totalImages = this.length;
    const stats: Record<string, number> = {};

    if (this.altTextCol) {
      const altCoveragePercent = totalImages > 0 ? Math.round((this.imagesWithAlt / totalImages) * 1000) / 10 : 100;
      stats.missing_alt = this.missingAltCount;
      stats.alt_coverage_percent = altCoveragePercent;
      stats.images_with_alt = this.imagesWithAlt;
      if (this.missingAltCount > 0) issues.push({
        type: 'missing_alt_text', severity: altCoveragePercent < 80 ? 'warning' : 'notice', count: this.missingAltCount,
        description: `${this.missingAltCount} images missing alt text (${altCoveragePercent}% coverage)`, urls: this.missingAltUrls,
      });
    }
    if (this.sizeCol) {
      stats.large_images = this.largeCount;
      stats.very_large_images = this.veryLargeCount;
      if (this.veryLargeCount > 0) issues.push({ type: 'very_large_images', severity: 'critical', count: this.veryLargeCount, description: `${this.veryLargeCount} very large images (> 500KB)`, urls: this.veryLargeUrls });
      if (this.largeCount > 0) issues.push({ type: 'large_images', severity: 'warning', count: this.largeCount, description: `${this.largeCount} large images (> 100KB)`, urls: this.largeUrls });
    }
    if (this.statusCol) {
      stats.broken_images = this.brokenCount;
      if (this.brokenCount > 0) issues.push({ type: 'broken_images', severity: 'critical', count: this.brokenCount, description: `${this.brokenCount} broken images (4xx/5xx)`, urls: this.brokenUrls });
    }
    if (this.widthCol || this.heightCol) {
      stats.missing_dimensions = this.missingDimsCount;
      if (this.missingDimsCount > 0) issues.push({ type: 'images_missing_dimensions', severity: 'notice', count: this.missingDimsCount, description: `${this.missingDimsCount} images missing width/height attributes (layout shift risk)`, urls: this.missingDimsUrls });
    }
    return { total_images: totalImages, stats, issues };
  }
}
```

- [ ] **Step 2: Migrate the EXISTING `images.parser.test.ts` to `parseString` (Codex High 1)**

`lib/parsers/resources/images.parser.test.ts` calls `new ImagesParser(csv).parse()` throughout — these break now that `ImagesParser` is streaming. Replace every `new ImagesParser(csv).parse()` with `parseString(ImagesParser, csv)` and add `import { parseString } from '../test-parse-helper';`. Static-property assertions stay unchanged. Same commit as the conversion (no red intermediate).

- [ ] **Step 3: Run the Images golden + migrated images test — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/resources/images.golden.test.ts lib/parsers/resources/images.parser.test.ts`

- [ ] **Step 4: tsc — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/resources/images.parser.ts lib/parsers/resources/images.parser.test.ts
git commit -m "feat(c7): stream ImagesParser via StreamingParser"
```

---

## Task 10: Real-crawl byte-identical parity + memory-check harnesses (verification)

Prove behavior-preservation on real data and demonstrate the memory fix.

**Files:**
- Create: `scripts/streaming-parity-check.ts` (dev harness — not shipped in the app path)
- Create: `scripts/streaming-memory-check.ts` (dev harness)

**Interfaces:**
- Consumes: the converted parsers + `streamCsv`; the Manhattan crawl dir.

- [ ] **Step 1: Write `scripts/streaming-parity-check.ts` (self-diffing against the committed baselines)**

Runs the NEW streaming path over the real Manhattan exports and diffs each result against the pre-refactor baseline JSON committed in Task 1 Step 7 (`test-fixtures/streaming-parity-baseline/<parserKey>.json`). No manual worktree comparison — the script asserts equality itself and exits non-zero on any diff (Codex Medium).

```ts
import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { findParserForFile } from '@/lib/parsers';
import { streamCsv } from '@/lib/parsers/stream-csv';

const dir = '/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25';
const baselineDir = 'test-fixtures/streaming-parity-baseline';
const targets = ['all_outlinks.csv', 'all_anchor_text.csv', 'images_all.csv'];

let failures = 0;
for (const f of targets) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { console.log(`skip ${f} (absent)`); continue; }
  const P = findParserForFile(f) as any;                 // filename-first, no content
  const parser = new P();
  await streamCsv(p, (row: any) => parser.consume(row));
  const out = parser.finalize();
  const baselinePath = path.join(baselineDir, `${P.parserKey}.json`);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  try {
    assert.deepStrictEqual(out, baseline);
    console.log(`✓ ${f} (${P.parserKey}) byte-identical to pre-refactor baseline`);
  } catch {
    failures++;
    console.error(`✗ ${f} (${P.parserKey}) DIVERGED from baseline`);
    fs.writeFileSync(`/tmp/parity-${P.parserKey}.actual.json`, JSON.stringify(out, null, 2));
  }
}
if (failures) { console.error(`${failures} parser(s) diverged`); process.exit(1); }
console.log('All streaming parsers reproduce the pre-refactor baseline exactly.');
```

Run (post-refactor):
```bash
DATABASE_URL="file:./local-dev.db" npx tsx scripts/streaming-parity-check.ts
```
Expected: all `✓`, exit 0. Paste the output into the PR body as the real-crawl parity evidence.

- [ ] **Step 2: Write `scripts/streaming-memory-check.ts`** (sound OOM baseline via raw Papa — Codex Medium)

The whole-file baseline must reproduce the OLD memory profile (full string + full row array), which the converted `ExternalLinksParser` no longer does. Use raw `Papa.parse(content, config)` for `whole`, and **fail loudly if `whole` completes** under the constrained heap (so the evidence is unambiguous).

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import Papa from 'papaparse';
import { ExternalLinksParser } from '@/lib/parsers/resources/links.parser';
import { streamCsv } from '@/lib/parsers/stream-csv';

const CFG = { header: true, skipEmptyLines: true, dynamicTyping: true } as const;
const src = '/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25/all_outlinks.csv';
const big = path.join(os.tmpdir(), 'big_outlinks.csv');

function buildBigFile(): Promise<void> {
  return new Promise((resolve) => {
    const lines = fs.readFileSync(src, 'utf-8').split('\n');
    const header = lines[0]; const body = lines.slice(1).filter(Boolean);
    const ws = fs.createWriteStream(big);
    ws.write(header + '\n');
    const TARGET = 500 * 1024 * 1024;
    let written = header.length + 1;
    while (written < TARGET) { for (const l of body) { ws.write(l + '\n'); written += l.length + 1; if (written >= TARGET) break; } }
    ws.end(() => resolve());
  });
}

async function run() {
  await buildBigFile();
  const mode = process.argv[2] || 'stream';
  const before = process.memoryUsage().rss;
  if (mode === 'whole') {
    // OLD profile: full string + full row array. Expected to OOM at a tight heap.
    const content = fs.readFileSync(big, 'utf-8');
    Papa.parse(content, CFG);
    console.error('UNEXPECTED: whole-file parse COMPLETED under the constrained heap — baseline invalid, raise the file size / lower the heap.');
    process.exit(2);
  } else {
    const p = new ExternalLinksParser();
    await streamCsv(big, (r: any) => p.consume(r));
    p.finalize();
  }
  const after = process.memoryUsage().rss;
  console.log(mode, 'peak RSS MB:', Math.round(after / 1048576), 'delta MB:', Math.round((after - before) / 1048576));
  fs.rmSync(big, { force: true });
}
run();
```

Run:
```bash
# streaming completes under a tight heap:
NODE_OPTIONS='--max-old-space-size=512' DATABASE_URL="file:./local-dev.db" npx tsx scripts/streaming-memory-check.ts stream
# whole-file baseline OOMs (exit != 0) under the same heap:
NODE_OPTIONS='--max-old-space-size=512' DATABASE_URL="file:./local-dev.db" npx tsx scripts/streaming-memory-check.ts whole; echo "whole exit: $?"
```
Expected: `stream` prints a bounded peak RSS and exits 0; `whole` dies with a heap-OOM (`Reached heap limit`, non-zero exit — NOT exit 2). Record both for the tracker. If `whole` prints the "UNEXPECTED" line (exit 2), increase `TARGET` or lower the heap until it OOMs — the contrast must be unambiguous.

- [ ] **Step 3: Commit the harnesses**

```bash
git add scripts/streaming-parity-check.ts scripts/streaming-memory-check.ts
git commit -m "test(c7): real-crawl parity + memory-check harnesses for streaming parse"
```

---

## Task 11: Full gates + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: clean (tsc --noEmit).

- [ ] **Step 2: Full test suite**

Run: `DATABASE_URL="file:./local-dev.db" npm test`
Expected: all green (prior baseline 2968 tests + the new suites; no regressions).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean (`NODE_OPTIONS='--max-old-space-size=3072' next build`).

- [ ] **Step 4: Run the parity + memory harnesses (Task 10) and capture evidence**

Record byte-identical parity (or diff) and the memory OOM-vs-completes contrast in the PR body + for the tracker/handoff.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/c7-streaming-parse
gh pr create --title "C7 pt3: streaming parse (4 big-file parsers + header-peek detection)" --body "$(cat <<'EOF'
Streams the 4 big-file SEO parsers (externallinks/anchortext/images/linksissues) via a new StreamingParser sibling base + Papa NODE_STREAM_INPUT; adds filename-first + header-peek detection so unmatched files (all_inlinks, external_all) are never fully read. Synchronous + sequential preserved; InternalParser deferred; no migration/env/middleware/route change.

Byte-identical output proven: golden characterization (written first, green through the refactor) + generic Papa whole-file-vs-stream parity table + real-crawl diff over the Manhattan export. Memory: streaming completes under a 512 MB heap where the whole-file path OOMs. Closes the 2 deferred pt2 golden Minors.

Spec: docs/superpowers/specs/2026-07-03-streaming-parse-design.md (Codex accept-with-fixes applied).
Plan: docs/superpowers/plans/2026-07-03-streaming-parse.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (post-write)

- **Spec coverage:** §4.1 StreamingParser → Task 4; §4.2 conversions → Tasks 7–9; §4.2a registry type → Task 6 step 5; §4.3 route two-path → Task 6; §4.4 header-peek → Task 6 (`readHeaderChunk`); §5 golden+real-crawl → Tasks 1, 10; §5.3 Papa parity table → Task 5; §6 memory harness → Task 10; §7 tests → distributed; deferred Minors → Task 2; §8 rollout → Task 11 + post-merge deploy.
- **Ordering invariant:** the interface-agnostic `parseString` helper (Task 1) precedes every golden so no golden breaks on conversion (Codex High 1); header-map/type-widening (Task 3, Task 6 step 5) precede any parser conversion, so streaming subclasses type-check; the route streaming path (Task 6) precedes conversions, so each converted parser lands on a driver that already handles it; the existing `links`/`images` direct tests migrate to `parseString` in the SAME commit as their conversion (Tasks 7/9), so the suite never goes red. Detection-equivalence lives in a non-mocked file (Task 6 step 7), NOT the `@/lib/parsers`-mocked route test. Real-crawl parity self-diffs against baselines captured pre-refactor (Task 1 step 7 → Task 10 step 1).
- **Post-deploy (after merge):** app health; deployed-bundle minification-survival for the 4 `parserKey` literals; functional multi-file upload of the Manhattan crawl (also discharges pt1's pending panel-render check).
