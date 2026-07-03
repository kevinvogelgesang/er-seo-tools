# Parser Consolidation (C7 part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicated find-column→mask→iterate→accumulate logic across 7 SEO-parser files by extracting two declarative base classes, with zero change to parse output.

**Architecture:** Two new abstract bases (`LengthValidatorParser`, `ResourceFileParser`) own the shared `parse()` logic; each existing parser becomes a thin subclass that supplies a config object plus its explicit static `parserKey`/`filenamePattern`. Class names, `PARSER_MAP` registration, and the parse route are untouched. A golden-output test suite written first (against current code) is the byte-level parity net.

**Tech Stack:** TypeScript, Vitest, PapaParse (via `BaseParser`).

**Spec:** `docs/superpowers/specs/2026-07-03-parser-consolidation-design.md` (Codex-reviewed).

## Global Constraints

- **Behavior-preserving.** `parse()` output must be deep-equal to current output for identical input: issue-array order, every description string, thresholds, severities, URL caps, duplicate group value-key/slice, and `stats` key presence + insertion order all pinned.
- **Explicit static `parserKey` per subclass** — string literal, never derived from the class name. The base's `static parserKey` stays `''`. (2026-06-02 SWC class-name minification incident; `lib/parsers/parser-key.test.ts` guards it.)
- **In-code config only** — object literals on each subclass. No DB, no migration, no config tables.
- **Scope:** only `pageTitles`, `metaDescription`, `h1`, `h2` (→ `LengthValidatorParser`) and `css`, `javascript`, `pdf` (→ `ResourceFileParser`). `images` and `links` stay bespoke. No streaming/concurrency (that is C7 part 3). No aggregator/scoring/findings changes.
- **TS-safe config accessor:** base declares `protected abstract readonly config: <ConfigType>`; each subclass declares `protected readonly config: <ConfigType> = {…}`. No "abstract static" (unsupported). `config` is read only inside `parse()`, so BaseParser's constructor (which runs `parseCSV`) never touches it — no field-init ordering hazard.
- **Gate commands (all three green before PR):**
  ```bash
  npm run lint
  DATABASE_URL="file:./local-dev.db" npm test
  npm run build
  ```
- **Run a single test file** during tasks: `DATABASE_URL="file:./local-dev.db" npx vitest run <path>`.

---

## Golden-test authoring rule (applies to Tasks 1–2)

These are **characterization tests**: the current implementation is ground truth. For each case, build the fixture, run the parser, and assert the **entire** returned object with `toEqual(EXPECTED)`. Populate `EXPECTED` by running against the CURRENT (pre-refactor) code and pinning to the observed output — then eyeball it against the spec's per-parser table to confirm the observed output is itself correct (not a latent bug you are blessing). If your first `EXPECTED` guess mismatches current code, the current output wins; fix `EXPECTED`, not the parser. Every assertion is a full `toEqual` on the parser's return value (no partial field-picking) so ordering and key presence are covered.

Fixtures have no `Content Type` and no `Indexability` columns, so `getIndexableHtmlMask()` reduces to the SEO-relevant-URL mask; use ordinary page URLs (`https://ex.com/a`) so every row is in-mask. Keep fixtures small (≤6 rows).

---

### Task 1: Golden parity tests — on-page-element parsers (current code)

Characterization tests for the four `LengthValidatorParser` targets, green against today's implementations. `h1.parser.test.ts`, `metaDescription.parser.test.ts`, `pageTitles.parser.test.ts` already exist and assert *selected* fields — do NOT touch them; add a NEW full-output golden file each, plus the only-missing golden for h2 (which has no test today).

**Files:**
- Create: `lib/parsers/seoElements/pageTitles.golden.test.ts`
- Create: `lib/parsers/seoElements/metaDescription.golden.test.ts`
- Create: `lib/parsers/seoElements/h1.golden.test.ts`
- Create: `lib/parsers/seoElements/h2.golden.test.ts`

**Interfaces:**
- Consumes: current `PageTitlesParser`, `MetaDescriptionParser`, `H1Parser`, `H2Parser` (constructor `(csvContent: string)`, method `parse(): ParsedData`).
- Produces: golden files that must stay green through Tasks 3.

- [ ] **Step 1: Write the pageTitles golden test** (triggers all four checks: missing, short, long, duplicate, multiple)

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PageTitlesParser } from './pageTitles.parser';

const CSV = [
  'Address,Title 1,Title 1 Length,Title 2',
  'https://ex.com/a,Home Page Title That Is A Good Length Yes,42,',
  'https://ex.com/b,,0,',                                   // missing title
  'https://ex.com/c,Short,5,',                              // too short (<30, >0)
  'https://ex.com/d,' + 'x'.repeat(75) + ',75,',            // too long (>60)
  'https://ex.com/e,Dupe Title,10,',                        // dup group + short
  'https://ex.com/f,Dupe Title,10,Second Title Tag',        // dup + short + multiple
].join('\n');

describe('PageTitlesParser golden', () => {
  it('produces exact current output for a mixed crawl', () => {
    const out = new PageTitlesParser(CSV).parse();
    expect(out).toEqual(/* PIN to current output per the authoring rule */);
  });
});
```

- [ ] **Step 2: Populate `EXPECTED` from current code**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/seoElements/pageTitles.golden.test.ts`
It fails (empty `toEqual`). Copy the received object into `EXPECTED`, then verify against the spec table: issue order must be `missing_title` (critical) → `title_too_short` (warning) → `title_too_long` (notice) → `duplicate_title` (warning) → `multiple_titles` (warning); duplicate group key is `title`, slice 100; `total_pages`/`excluded_urls` present. Re-run: PASS.

- [ ] **Step 3: Write the metaDescription golden test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MetaDescriptionParser } from './metaDescription.parser';

const CSV = [
  'Address,Meta Description 1,Meta Description 1 Length',
  'https://ex.com/a,' + 'A good meta description that clears seventy characters easily for sure yes indeed.'.slice(0,120) + ',95',
  'https://ex.com/b,,0',                                    // missing
  'https://ex.com/c,Too short meta,14',                     // short (<70,>0)
  'https://ex.com/d,' + 'y'.repeat(200) + ',200',           // long (>160)
  'https://ex.com/e,Dupe meta value,15',                    // dup + short
  'https://ex.com/f,Dupe meta value,15',                    // dup + short
].join('\n');

describe('MetaDescriptionParser golden', () => {
  it('produces exact current output for a mixed crawl', () => {
    const out = new MetaDescriptionParser(CSV).parse();
    expect(out).toEqual(/* PIN */);
  });
});
```

- [ ] **Step 4: Populate + verify metaDescription**

Run the file. Pin `EXPECTED`. Verify: order `missing_meta_description` (warning) → `meta_description_too_short` (notice) → `meta_description_too_long` (notice) → `duplicate_meta_description` (notice); duplicate group key `meta_description`, slice 200. Re-run: PASS.

- [ ] **Step 5: Write the h1 golden test** (no length block — order is missing → duplicate → multiple)

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { H1Parser } from './h1.parser';

const CSV = [
  'Address,H1-1,H1-2',
  'https://ex.com/a,Unique Heading,',
  'https://ex.com/b,,',                 // missing
  'https://ex.com/c,Dupe H1,',          // dup
  'https://ex.com/d,Dupe H1,Second H1', // dup + multiple
].join('\n');

describe('H1Parser golden', () => {
  it('produces exact current output', () => {
    const out = new H1Parser(CSV).parse();
    expect(out).toEqual(/* PIN */);
  });
});
```

- [ ] **Step 6: Populate + verify h1**

Run, pin. Verify order `missing_h1` (warning) → `duplicate_h1` (notice) → `multiple_h1` (warning); duplicate group key `h1`, slice 100. Re-run: PASS.

- [ ] **Step 7: Write the h2 golden test** (missing-only)

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { H2Parser } from './h2.parser';

const CSV = [
  'Address,H2-1',
  'https://ex.com/a,Some H2',
  'https://ex.com/b,',   // missing
].join('\n');

describe('H2Parser golden', () => {
  it('produces exact current output (missing-only)', () => {
    const out = new H2Parser(CSV).parse();
    expect(out).toEqual(/* PIN */);
  });
  it('returns {} on empty CSV', () => {
    expect(new H2Parser('Address,H2-1').parse()).toEqual({});
  });
});
```

- [ ] **Step 8: Populate + verify h2**

Run, pin. Verify single issue `missing_h2` (notice), `total_pages`/`excluded_urls` present. Re-run: PASS.

- [ ] **Step 9: Add the `length===0` boundary assertion to the pageTitles golden file**

Append to `pageTitles.golden.test.ts`:

```ts
it('does not count length 0 as too short', () => {
  const csv = 'Address,Title 1,Title 1 Length\nhttps://ex.com/a,,0';
  const out = new PageTitlesParser(csv).parse() as { issues: { type: string }[] };
  expect(out.issues.some(i => i.type === 'title_too_short')).toBe(false);
  expect(out.issues.some(i => i.type === 'missing_title')).toBe(true);
});
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/seoElements/` → all PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/parsers/seoElements/*.golden.test.ts
git commit -m "test(c7): golden parity tests for on-page-element parsers"
```

---

### Task 2: Golden parity tests — static-resource parsers (current code)

Characterization tests for `css`, `javascript`, `pdf` (none have a test file today), including the only-size / only-status / neither-column and empty-CSV cases.

**Files:**
- Create: `lib/parsers/resources/css.golden.test.ts`
- Create: `lib/parsers/resources/javascript.golden.test.ts`
- Create: `lib/parsers/resources/pdf.golden.test.ts`

**Interfaces:**
- Consumes: current `CSSParser`, `JavaScriptParser`, `PDFParser`.
- Produces: golden files that must stay green through Task 4.

- [ ] **Step 1: Write the css golden test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CSSParser } from './css.parser';

const large = 200 * 1024, ok = 10 * 1024;   // threshold is 100KB
const MIXED = [
  'Address,Size (Bytes),Status Code',
  `https://ex.com/a.css,${large},200`,   // large
  `https://ex.com/b.css,${ok},404`,      // broken
  `https://ex.com/c.css,${ok},200`,      // clean
].join('\n');

describe('CSSParser golden', () => {
  it('large + broken + clean → exact output', () => {
    expect(new CSSParser(MIXED).parse()).toEqual(/* PIN */);
  });
  it('only size column → stats has large_css_files, no broken_css', () => {
    const csv = `Address,Size (Bytes)\nhttps://ex.com/a.css,${large}`;
    expect(new CSSParser(csv).parse()).toEqual(/* PIN */);
  });
  it('only status column → stats has broken_css, no large_css_files', () => {
    const csv = 'Address,Status Code\nhttps://ex.com/a.css,500';
    expect(new CSSParser(csv).parse()).toEqual(/* PIN */);
  });
  it('neither size nor status → stats is {} but present, on a non-empty CSV', () => {
    const csv = 'Address\nhttps://ex.com/a.css';
    const out = new CSSParser(csv).parse() as { total_css_files: number; stats: object; issues: unknown[] };
    expect(out).toEqual({ total_css_files: 1, stats: {}, issues: [] });
  });
  it('empty CSV → {}', () => {
    expect(new CSSParser('Address,Size (Bytes),Status Code').parse()).toEqual({});
  });
});
```

- [ ] **Step 2: Populate + verify css**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/resources/css.golden.test.ts`. Pin the four `PIN` slots. Verify from the spec table: `total_css_files`; `stats` order `large_css_files` then `broken_css`; large issue `large_css_files`/notice/`… large CSS files (> 100KB)`; broken issue `broken_css`/warning/`… broken CSS files`; issue order large → broken. Re-run: PASS.

- [ ] **Step 3: Write the javascript golden test**

Same structure as Step 1 with `JavaScriptParser`, keys `total_js_files`/`large_js_files`/`broken_js`, large severity **warning** desc `N large JavaScript files (> 100KB)`, broken severity **critical** desc `N broken JavaScript files`, threshold 100KB. Include the same five cases (`.js` URLs).

- [ ] **Step 4: Populate + verify javascript** — run the file, pin, verify against the spec table, PASS.

- [ ] **Step 5: Write the pdf golden test**

Same structure with `PDFParser`, keys `total_pdfs`/`large_pdfs`/`broken_pdfs`, threshold **5MB** (`5*1024*1024`; large fixture size `6*1024*1024`), large severity **notice** desc `N large PDFs (> 5MB)`, broken severity **warning** desc `N broken PDF links`, `.pdf` URLs.

- [ ] **Step 6: Populate + verify pdf** — run, pin, verify, PASS.

- [ ] **Step 7: Run the whole resources dir**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/resources/` → PASS (existing images/links tests unaffected).

- [ ] **Step 8: Commit**

```bash
git add lib/parsers/resources/css.golden.test.ts lib/parsers/resources/javascript.golden.test.ts lib/parsers/resources/pdf.golden.test.ts
git commit -m "test(c7): golden parity tests for static-resource parsers"
```

---

### Task 3: Extract `LengthValidatorParser` + convert the 4 on-page subclasses

**Files:**
- Create: `lib/parsers/seoElements/length-validator.base.ts`
- Modify: `lib/parsers/seoElements/pageTitles.parser.ts` (full rewrite → thin subclass)
- Modify: `lib/parsers/seoElements/metaDescription.parser.ts` (full rewrite)
- Modify: `lib/parsers/seoElements/h1.parser.ts` (full rewrite)
- Modify: `lib/parsers/seoElements/h2.parser.ts` (full rewrite)
- Test: `lib/parsers/seoElements/*.golden.test.ts` + existing `*.parser.test.ts` (all must stay green; do not edit)

**Interfaces:**
- Consumes: `BaseParser` (`this.data`, `this.length`, `this.isEmpty`, `findColumn`, `getIndexableHtmlMask`, `getSeoRelevantMask`, `countMask`), `toString`/`toNumber` from `../../utils/columnMapper`, `Issue`/`ParsedData` from `../../types`.
- Produces: `abstract class LengthValidatorParser extends BaseParser` with `protected abstract readonly config: LengthValidatorConfig`, concrete `parse()`. Subclasses keep static `parserKey`/`filenamePattern`.

- [ ] **Step 1: Write the base class**

Create `lib/parsers/seoElements/length-validator.base.ts` exactly:

```ts
import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

type Severity = 'critical' | 'warning' | 'notice';

export interface LengthValidatorConfig {
  valueColumn: string[];
  missing: { type: string; severity: Severity; label: string };
  length?: {
    column: string[]; min: number; max: number; noun: string;
    shortType: string; shortSeverity: Severity;
    longType: string; longSeverity: Severity;
  };
  duplicate?: { type: string; severity: Severity; label: string; groupValueKey: 'title' | 'meta_description' | 'h1'; groupValueSlice: number };
  multiple?: { column: string[]; type: string; severity: Severity; label: string };
}

export abstract class LengthValidatorParser extends BaseParser {
  protected abstract readonly config: LengthValidatorConfig;

  parse(): ParsedData {
    if (this.isEmpty) return {};
    const cfg = this.config;

    const addressCol = this.findColumn(['Address', 'URL']);
    const valueCol = this.findColumn(cfg.valueColumn);
    const lengthCol = cfg.length ? this.findColumn(cfg.length.column) : null;
    const secondCol = cfg.multiple ? this.findColumn(cfg.multiple.column) : null;

    const indexableMask = this.getIndexableHtmlMask();
    const hasIndexable = indexableMask.some(Boolean);
    const mask = hasIndexable ? indexableMask : this.getSeoRelevantMask(addressCol);

    const issues: Issue[] = [];
    const totalPages = this.countMask(mask);

    // Missing
    if (valueCol) {
      const missingUrls: string[] = [];
      let missingCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const value = toString(this.data[i][valueCol]);
        if (!value) {
          missingCount++;
          if (addressCol && missingUrls.length < 20) missingUrls.push(toString(this.data[i][addressCol]));
        }
      }
      if (missingCount > 0) {
        issues.push({
          type: cfg.missing.type,
          severity: cfg.missing.severity,
          count: missingCount,
          description: `${missingCount} pages missing ${cfg.missing.label}`,
          urls: missingUrls,
        });
      }
    }

    // Length (short / long)
    if (cfg.length && lengthCol) {
      const { min, max, noun, shortType, shortSeverity, longType, longSeverity } = cfg.length;
      const shortUrls: string[] = [];
      const longUrls: string[] = [];
      let shortCount = 0;
      let longCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const length = toNumber(this.data[i][lengthCol]);
        if (length === null) continue;
        if (length < min && length > 0) {
          shortCount++;
          if (addressCol && shortUrls.length < 20) shortUrls.push(toString(this.data[i][addressCol]));
        } else if (length > max) {
          longCount++;
          if (addressCol && longUrls.length < 20) longUrls.push(toString(this.data[i][addressCol]));
        }
      }
      if (shortCount > 0) {
        issues.push({
          type: shortType, severity: shortSeverity, count: shortCount,
          description: `${shortCount} pages with ${noun} under ${min} characters`,
          threshold: `< ${min} chars`, urls: shortUrls,
        });
      }
      if (longCount > 0) {
        issues.push({
          type: longType, severity: longSeverity, count: longCount,
          description: `${longCount} pages with ${noun} over ${max} characters`,
          threshold: `> ${max} chars`, urls: longUrls,
        });
      }
    }

    // Duplicate
    if (cfg.duplicate && valueCol) {
      const { type, severity, label, groupValueKey, groupValueSlice } = cfg.duplicate;
      const counts: Record<string, number> = {};
      const urlMap: Record<string, string[]> = {};
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const value = toString(this.data[i][valueCol]);
        if (value) {
          counts[value] = (counts[value] || 0) + 1;
          if (addressCol) {
            if (!urlMap[value]) urlMap[value] = [];
            if (urlMap[value].length < 50) urlMap[value].push(toString(this.data[i][addressCol]));
          }
        }
      }
      const duplicates = Object.entries(counts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
      if (duplicates.length > 0) {
        issues.push({
          type, severity, count: duplicates.length,
          description: `${duplicates.length} groups of pages with duplicate ${label}`,
          groups: duplicates.slice(0, 10).map(([value, count]) => ({
            [groupValueKey]: value.slice(0, groupValueSlice),
            count,
            urls: urlMap[value] ?? [],
          })) as Issue['groups'],
        });
      }
    }

    // Multiple
    if (cfg.multiple && secondCol) {
      const { type, severity, label } = cfg.multiple;
      const multipleUrls: string[] = [];
      let multipleCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const second = toString(this.data[i][secondCol]).trim();
        if (second) {
          multipleCount++;
          if (addressCol && multipleUrls.length < 20) multipleUrls.push(toString(this.data[i][addressCol]));
        }
      }
      if (multipleCount > 0) {
        issues.push({
          type, severity, count: multipleCount,
          description: `${multipleCount} pages with multiple ${label}`,
          urls: multipleUrls,
        });
      }
    }

    return { total_pages: totalPages, excluded_urls: this.length - totalPages, issues };
  }
}
```

- [ ] **Step 2: Convert `pageTitles.parser.ts`**

Replace its entire contents:

```ts
import { LengthValidatorParser, LengthValidatorConfig } from './length-validator.base';

export class PageTitlesParser extends LengthValidatorParser {
  static parserKey = 'pagetitles';
  static filenamePattern = ['page_titles_all', 'page_titles'];

  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['Title 1', 'Title'],
    missing: { type: 'missing_title', severity: 'critical', label: 'title tags' },
    length: {
      column: ['Title 1 Length', 'Title Length', 'Length'],
      min: 30, max: 60, noun: 'titles',
      shortType: 'title_too_short', shortSeverity: 'warning',
      longType: 'title_too_long', longSeverity: 'notice',
    },
    duplicate: { type: 'duplicate_title', severity: 'warning', label: 'titles', groupValueKey: 'title', groupValueSlice: 100 },
    multiple: { column: ['Title 2'], type: 'multiple_titles', severity: 'warning', label: 'title tags' },
  };
}
```

- [ ] **Step 3: Convert `metaDescription.parser.ts`**

```ts
import { LengthValidatorParser, LengthValidatorConfig } from './length-validator.base';

export class MetaDescriptionParser extends LengthValidatorParser {
  static parserKey = 'metadescription';
  static filenamePattern = ['meta_description_all', 'meta_description'];

  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['Meta Description 1', 'Meta Description'],
    missing: { type: 'missing_meta_description', severity: 'warning', label: 'meta descriptions' },
    length: {
      column: ['Meta Description 1 Length', 'Length'],
      min: 70, max: 160, noun: 'meta descriptions',
      shortType: 'meta_description_too_short', shortSeverity: 'notice',
      longType: 'meta_description_too_long', longSeverity: 'notice',
    },
    duplicate: { type: 'duplicate_meta_description', severity: 'notice', label: 'meta descriptions', groupValueKey: 'meta_description', groupValueSlice: 200 },
    // no multiple check
  };
}
```

- [ ] **Step 4: Convert `h1.parser.ts`**

```ts
import { LengthValidatorParser, LengthValidatorConfig } from './length-validator.base';

export class H1Parser extends LengthValidatorParser {
  static parserKey = 'h1';
  static filenamePattern = ['h1_all', 'h1'];

  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['H1-1', 'H1'],
    missing: { type: 'missing_h1', severity: 'warning', label: 'H1 headings' },
    // no length check
    duplicate: { type: 'duplicate_h1', severity: 'notice', label: 'H1 headings', groupValueKey: 'h1', groupValueSlice: 100 },
    multiple: { column: ['H1-2'], type: 'multiple_h1', severity: 'warning', label: 'H1 headings' },
  };
}
```

- [ ] **Step 5: Convert `h2.parser.ts`**

```ts
import { LengthValidatorParser, LengthValidatorConfig } from './length-validator.base';

export class H2Parser extends LengthValidatorParser {
  static parserKey = 'h2';
  static filenamePattern = ['h2_all', 'h2'];

  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['H2-1', 'H2'],
    missing: { type: 'missing_h2', severity: 'notice', label: 'H2 headings' },
    // missing-only
  };
}
```

- [ ] **Step 6: Run golden + existing tests for seoElements**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/seoElements/`
Expected: ALL pass (4 golden files + existing pageTitles/meta/h1 suites), unchanged. If any differ, the config transcription is wrong — fix the config, never the test.

- [ ] **Step 7: Run the parserKey guard**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/parser-key.test.ts`
Expected: PASS (each subclass still declares its literal `parserKey`; uniqueness intact).

- [ ] **Step 8: Commit**

```bash
git add lib/parsers/seoElements/
git commit -m "refactor(c7): extract LengthValidatorParser; on-page parsers become thin subclasses"
```

---

### Task 4: Extract `ResourceFileParser` + convert css/js/pdf

**Files:**
- Create: `lib/parsers/resources/resource-file.base.ts`
- Modify: `lib/parsers/resources/css.parser.ts` (full rewrite → thin subclass)
- Modify: `lib/parsers/resources/javascript.parser.ts` (full rewrite)
- Modify: `lib/parsers/resources/pdf.parser.ts` (full rewrite)
- Test: `lib/parsers/resources/*.golden.test.ts` (must stay green)

**Interfaces:**
- Consumes: `BaseParser` (`this.data`, `this.length`, `this.isEmpty`, `findColumn`), `toNumber`/`toString`, `Issue`/`ParsedData`.
- Produces: `abstract class ResourceFileParser extends BaseParser` with `protected abstract readonly config: ResourceFileConfig`, concrete `parse()`.

- [ ] **Step 1: Write the base class**

Create `lib/parsers/resources/resource-file.base.ts`:

```ts
import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

type Severity = 'critical' | 'warning' | 'notice';

export interface ResourceFileConfig {
  totalKey: string;
  large: { threshold: number; type: string; severity: Severity; statKey: string; description: (count: number) => string };
  broken: { type: string; severity: Severity; statKey: string; description: (count: number) => string };
}

export abstract class ResourceFileParser extends BaseParser {
  protected abstract readonly config: ResourceFileConfig;

  parse(): ParsedData {
    if (this.isEmpty) return {};
    const cfg = this.config;

    const addressCol = this.findColumn(['Address', 'URL']);
    const sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    if (sizeCol) {
      const largeUrls: string[] = [];
      let largeCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        const size = toNumber(this.data[i][sizeCol]);
        if (size !== null && size > cfg.large.threshold) {
          largeCount++;
          if (addressCol && largeUrls.length < 30) largeUrls.push(toString(this.data[i][addressCol]));
        }
      }
      stats[cfg.large.statKey] = largeCount;
      if (largeCount > 0) {
        issues.push({
          type: cfg.large.type, severity: cfg.large.severity, count: largeCount,
          description: cfg.large.description(largeCount), urls: largeUrls,
        });
      }
    }

    if (statusCol) {
      const brokenUrls: string[] = [];
      let brokenCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
          if (addressCol && brokenUrls.length < 30) brokenUrls.push(toString(this.data[i][addressCol]));
        }
      }
      stats[cfg.broken.statKey] = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: cfg.broken.type, severity: cfg.broken.severity, count: brokenCount,
          description: cfg.broken.description(brokenCount), urls: brokenUrls,
        });
      }
    }

    return { [cfg.totalKey]: this.length, stats, issues };
  }
}
```

- [ ] **Step 2: Convert `css.parser.ts`**

```ts
import { ResourceFileParser, ResourceFileConfig } from './resource-file.base';

export class CSSParser extends ResourceFileParser {
  static parserKey = 'css';
  static filenamePattern = ['internal_css', 'css'];

  protected readonly config: ResourceFileConfig = {
    totalKey: 'total_css_files',
    large: { threshold: 100 * 1024, type: 'large_css_files', severity: 'notice', statKey: 'large_css_files', description: (n) => `${n} large CSS files (> 100KB)` },
    broken: { type: 'broken_css', severity: 'warning', statKey: 'broken_css', description: (n) => `${n} broken CSS files` },
  };
}
```

- [ ] **Step 3: Convert `javascript.parser.ts`**

```ts
import { ResourceFileParser, ResourceFileConfig } from './resource-file.base';

export class JavaScriptParser extends ResourceFileParser {
  static parserKey = 'javascript';
  static filenamePattern = ['javascript_all', 'javascript'];

  protected readonly config: ResourceFileConfig = {
    totalKey: 'total_js_files',
    large: { threshold: 100 * 1024, type: 'large_js_files', severity: 'warning', statKey: 'large_js_files', description: (n) => `${n} large JavaScript files (> 100KB)` },
    broken: { type: 'broken_js', severity: 'critical', statKey: 'broken_js', description: (n) => `${n} broken JavaScript files` },
  };
}
```

- [ ] **Step 4: Convert `pdf.parser.ts`**

```ts
import { ResourceFileParser, ResourceFileConfig } from './resource-file.base';

export class PDFParser extends ResourceFileParser {
  static parserKey = 'pdf';
  static filenamePattern = 'pdf';

  protected readonly config: ResourceFileConfig = {
    totalKey: 'total_pdfs',
    large: { threshold: 5 * 1024 * 1024, type: 'large_pdfs', severity: 'notice', statKey: 'large_pdfs', description: (n) => `${n} large PDFs (> 5MB)` },
    broken: { type: 'broken_pdfs', severity: 'warning', statKey: 'broken_pdfs', description: (n) => `${n} broken PDF links` },
  };
}
```

- [ ] **Step 5: Run golden + existing resource tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/resources/`
Expected: ALL pass (3 golden files + existing images/links suites). If any differ, fix the config.

- [ ] **Step 6: Run the parserKey guard**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/parser-key.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/parsers/resources/css.parser.ts lib/parsers/resources/javascript.parser.ts lib/parsers/resources/pdf.parser.ts lib/parsers/resources/resource-file.base.ts
git commit -m "refactor(c7): extract ResourceFileParser; css/js/pdf become thin subclasses"
```

---

### Task 5: Base unit tests + full gate

**Files:**
- Create: `lib/parsers/seoElements/length-validator.base.test.ts`
- Create: `lib/parsers/resources/resource-file.base.test.ts`

**Interfaces:**
- Consumes: exported `LengthValidatorParser`/`LengthValidatorConfig`, `ResourceFileParser`/`ResourceFileConfig`.
- Produces: direct base-level coverage of config branches via minimal test subclasses.

- [ ] **Step 1: Write base tests for `LengthValidatorParser`**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LengthValidatorParser, LengthValidatorConfig } from './length-validator.base';

class MissingOnly extends LengthValidatorParser {
  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['V'],
    missing: { type: 'missing_v', severity: 'notice', label: 'V values' },
  };
}

describe('LengthValidatorParser base', () => {
  it('missing-only config emits just the missing issue, with total/excluded', () => {
    const out = new MissingOnly('Address,V\nhttps://ex.com/a,x\nhttps://ex.com/b,').parse() as { total_pages: number; excluded_urls: number; issues: { type: string }[] };
    expect(out.issues.map(i => i.type)).toEqual(['missing_v']);
    expect(out.total_pages).toBe(2);
    expect(out.excluded_urls).toBe(0);
  });
  it('returns {} on empty', () => {
    expect(new MissingOnly('Address,V').parse()).toEqual({});
  });
});
```

- [ ] **Step 2: Write base tests for `ResourceFileParser`**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ResourceFileParser, ResourceFileConfig } from './resource-file.base';

class Res extends ResourceFileParser {
  protected readonly config: ResourceFileConfig = {
    totalKey: 'total_x',
    large: { threshold: 1000, type: 'large_x', severity: 'notice', statKey: 'large_x', description: (n) => `${n} large` },
    broken: { type: 'broken_x', severity: 'warning', statKey: 'broken_x', description: (n) => `${n} broken` },
  };
}

describe('ResourceFileParser base', () => {
  it('neither column → stats {} present on non-empty CSV', () => {
    expect(new Res('Address\nhttps://ex.com/a').parse()).toEqual({ total_x: 1, stats: {}, issues: [] });
  });
  it('size only → large stat + issue, no broken key', () => {
    const out = new Res('Address,Size (Bytes)\nhttps://ex.com/a,5000').parse() as { stats: Record<string, number> };
    expect(out.stats).toEqual({ large_x: 1 });
  });
  it('status only → broken stat + issue, no large key', () => {
    const out = new Res('Address,Status Code\nhttps://ex.com/a,404').parse() as { stats: Record<string, number> };
    expect(out.stats).toEqual({ broken_x: 1 });
  });
});
```

- [ ] **Step 3: Run the base tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/seoElements/length-validator.base.test.ts lib/parsers/resources/resource-file.base.test.ts`
Expected: PASS.

- [ ] **Step 4: Full gate**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: tsc clean; full vitest suite green (parser-key + all parser tests + everything else); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/seoElements/length-validator.base.test.ts lib/parsers/resources/resource-file.base.test.ts
git commit -m "test(c7): base-level unit tests for the two consolidated parser bases"
```

---

## Self-review notes

- **Spec coverage:** LengthValidatorParser (Task 3) + ResourceFileParser (Task 4) cover the two bases; golden suites (Tasks 1–2) implement the spec's mandated parity net for all 7 including the 4 untested ones; base unit tests (Task 5) cover config branches; parserKey guard run in Tasks 3–5; images/links untouched; no schema/scoring/streaming work. Prod verification is in the spec and executed post-deploy by Kevin.
- **parserKey landmine:** every subclass keeps its literal `static parserKey`; base default stays `''`; guarded by `parser-key.test.ts` in Tasks 3, 4, 5.
- **Ordering pinned:** check order lives in each base (missing→length→duplicate→multiple; large→broken) and is asserted by full-`toEqual` golden tests.
- **TS accessor:** `protected abstract readonly config` on bases, concrete instance field on subclasses — no abstract-static; config read only in `parse()`.
