# Per-file Parse Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-file parse outcomes (parsed / failed / unmatched / skipped) on the SEO parser results page, with a prominent warning when a *core* Screaming Frog export fails to parse.

**Architecture:** The parse route already isolates per-file failures; this plan structures those outcomes into `metadata.file_reports: FileReport[]` on the result blob (display-only, no relational storage), reuses the existing `EXPECTED_EXPORTS` table for core-severity, and renders a focused `FileProcessingPanel` component in `ResultsView`. The dead `result.parsing_errors` string array is removed.

**Tech Stack:** Next.js 15 App Router, TypeScript, React, Tailwind (class-based dark mode), Prisma/SQLite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-03-parse-file-reporting-design.md` (Codex-reviewed).

## Global Constraints

- **This is C7 Phase 3, part 1 of 3.** Do NOT build consolidation or streaming here.
- **No schema migration, no new env var, no `middleware.ts`/`isPublicPath` change.**
- **UI class:** every new element carries dark-mode `dark:` variants (map `bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, `border-gray-*`→`dark:border-navy-border`, status colors→`dark:bg-{color}-500/{opacity}`). No hydration-mismatch patterns.
- **`tsconfig.json` EXCLUDES `*.test.ts(x)` from `tsc`** — a test calling a changed signature passes `npm run lint` but fails at runtime. After any signature change, run the FULL suite.
- **Test DB prefix:** run vitest as `DATABASE_URL="file:./local-dev.db" npm test`.
- **vitest module mocks** must use `vi.hoisted(() => ({...}))` when the factory references outer vars. **No global RTL auto-cleanup** — React render tests need `afterEach(cleanup)` + the `// @vitest-environment jsdom` pragma.
- **`isCoreExport` severity rule:** core-severity iff filename matches ≥1 `tier:'core'` expected export AND matches 0 non-core expected exports (suppresses `response_codes` redirect-variant false positives).
- Commit after every task. End commit messages with the repo's Co-Authored-By + Claude-Session trailers.

---

### Task 1: `FileReport` types + `isCoreExport` helper

**Files:**
- Modify: `lib/types/index.ts` (the `AggregatedResult` interface + new exported types)
- Modify: `lib/parsers/expected-exports.ts` (append `isCoreExport`)
- Test: `lib/parsers/expected-exports.test.ts` (create if absent — the file `expected-exports.test.ts` already exists; append to it)

**Interfaces:**
- Produces: `FileReportStatus`, `FileReportSeverity`, `FileReport` (exported from `lib/types`), `metadata.file_reports?: FileReport[]` on `AggregatedResult`, and `isCoreExport(filename: string): boolean` (exported from `lib/parsers/expected-exports`).

- [ ] **Step 1: Write the failing test for `isCoreExport`**

Append to `lib/parsers/expected-exports.test.ts`:

```ts
import { isCoreExport } from './expected-exports';

describe('isCoreExport', () => {
  it('is true for the two score-critical core exports', () => {
    expect(isCoreExport('internal_all.csv')).toBe(true);
    expect(isCoreExport('response_codes.csv')).toBe(true);
    expect(isCoreExport('response_codes_internal_all.csv')).toBe(true);
  });

  it('is false for redirect variants that also substring-match the core response_codes pattern', () => {
    // These match core `response_codes` AND an optional export → demoted to non-core.
    expect(isCoreExport('response_codes_internal_redirect_chain.csv')).toBe(false);
    expect(isCoreExport('response_codes_redirection_(3xx).csv')).toBe(false);
  });

  it('is false for recommended/optional and unrecognized exports', () => {
    expect(isCoreExport('page_titles_all.csv')).toBe(false);
    expect(isCoreExport('images_missing_alt_text.csv')).toBe(false);
    expect(isCoreExport('totally_unknown_file.csv')).toBe(false);
  });
});
```

Note: `expected-exports.test.ts` already `import`s from `vitest`; if the top-level `import { describe, it, expect } from 'vitest'` is missing, add it. Reuse the existing import if present.

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/expected-exports.test.ts`
Expected: FAIL — `isCoreExport is not a function` / not exported.

- [ ] **Step 3: Implement `isCoreExport`**

Append to `lib/parsers/expected-exports.ts` (below `missingCoreExports`):

```ts
/**
 * True when the filename maps to a tier:'core' expected export and does NOT also
 * match a non-core (recommended/optional) export. The second clause suppresses
 * false positives from the broad core `response_codes` pattern, which otherwise
 * swallows the optional redirect exports (response_codes_internal_redirect_chain,
 * response_codes_redirection_(3xx)). Used for parse-failure SEVERITY only — it is
 * intentionally narrower than the presence-tolerant missingCoreExports gate.
 */
export function isCoreExport(filename: string): boolean {
  const matches = matchExpectedExports([filename]).filter((c) => c.present);
  if (matches.length === 0) return false;
  const hasCore = matches.some((c) => c.export.tier === 'core');
  const hasNonCore = matches.some((c) => c.export.tier !== 'core');
  return hasCore && !hasNonCore;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/expected-exports.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `FileReport` types**

In `lib/types/index.ts`, add the exported types near the `AggregatedResult` interface:

```ts
export type FileReportStatus = 'parsed' | 'failed' | 'unmatched' | 'skipped';
export type FileReportSeverity = 'core' | 'normal' | 'info';

export interface FileReport {
  filename: string;
  status: FileReportStatus;
  /** parser key, present when status === 'parsed' */
  parser?: string;
  /** failure message, present when status === 'failed' */
  error?: string;
  severity: FileReportSeverity;
}
```

Then extend the `AggregatedResult.metadata` object type — add one optional field (keep the existing fields verbatim):

```ts
  metadata: {
    files_processed: string[];
    parsers_used: string[];
    total_parsers_available: number;
    site_name?: string;
    health_score?: number;
    /** Per-file parse outcomes (display-only). Absent on pre-2026-07 sessions and on archived (pruned-blob) fallbacks. */
    file_reports?: FileReport[];
  };
```

- [ ] **Step 6: Verify types compile**

Run: `npm run lint`
Expected: PASS (tsc clean — additive optional field, no caller breaks).

- [ ] **Step 7: Commit**

```bash
git add lib/types/index.ts lib/parsers/expected-exports.ts lib/parsers/expected-exports.test.ts
git commit -m "feat(c7): FileReport types + isCoreExport severity helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 2: Parse route — structured per-file reports, drop `parsing_errors`

**Files:**
- Modify: `app/api/parse/[sessionId]/route.ts` (the `parseFile` closure + the loop + metadata attach, lines ~104-170)
- Test: `app/api/parse/[sessionId]/route.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `FileReport` (Task 1), `isCoreExport` (Task 1).
- Produces: `result.metadata.file_reports` populated on every completed parse; `result.parsing_errors` no longer written.

- [ ] **Step 1: Write the failing route test**

Append to `app/api/parse/[sessionId]/route.test.ts`. This test drives the real parse loop with a mocked parser resolver and real on-disk files. Add these mocks at the TOP of the file alongside the existing ones (extend, do not duplicate the existing `vi.mock('@/lib/db', ...)` — add the extra prisma methods to it):

```ts
// --- extend the existing '@/lib/db' mock to cover the full parse path ---
// The existing mock only stubs session.findUnique/updateMany. Add:
//   session.update, client.findMany, $transaction, sessionPage.deleteMany
// (Replace the existing vi.mock('@/lib/db', ...) with this fuller version.)
const sessionUpdateMock = vi.fn().mockResolvedValue({});
const clientFindManyMock = vi.fn().mockResolvedValue([]);
const txMock = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: (...a: unknown[]) => sessionFindUniqueMock(...a),
      updateMany: (...a: unknown[]) => sessionUpdateManyMock(...a),
      update: (...a: unknown[]) => sessionUpdateMock(...a),
    },
    client: { findMany: (...a: unknown[]) => clientFindManyMock(...a) },
    sessionPage: { deleteMany: vi.fn().mockResolvedValue({}) },
    $transaction: (...a: unknown[]) => txMock(...a),
  },
}));

// Real aggregator is heavy; stub it to a minimal valid result skeleton.
vi.mock('@/lib/services/aggregator.service', () => ({
  AggregatorService: class {
    addParserResult() {}
    aggregate() {
      return {
        crawl_summary: {}, issues: { critical: [], warnings: [], notices: [] },
        site_structure: {}, resources: {}, technical_seo: {}, performance: {},
        recommendations: [],
        metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0 },
      };
    }
  },
}));
vi.mock('@/lib/services/session-page-builder', () => ({
  buildSessionPages: () => ({
    scalars: { siteHost: null, totalUrls: 0, criticalCount: 0, warningCount: 0, noticeCount: 0 },
  }),
}));
vi.mock('@/lib/findings/seo-write', () => ({ writeSeoFindings: vi.fn().mockResolvedValue(undefined) }));

// Control parser resolution per-filename. A "throwing" parser => failed;
// a "good" parser => parsed; null => unmatched.
const findParserForFileMock = vi.fn();
vi.mock('@/lib/parsers', () => ({
  findParserForFile: (...a: unknown[]) => findParserForFileMock(...a),
}));
```

Then the test body (uses the file's existing `VALID_ID` and `ctx`):

```ts
import fs from 'fs/promises';
import path from 'path';
import { getUploadDir } from '@/lib/upload-helpers';

function goodParser(key: string) {
  return class {
    static parserKey = key;
    constructor(_c: string) {}
    parse() { return {}; }
    getPrimaryDomain() { return 'example.com'; }
  };
}
function throwingParser(key: string) {
  return class {
    static parserKey = key;
    constructor(_c: string) {}
    parse(): Record<string, unknown> { throw new Error('boom'); }
    getPrimaryDomain() { return null; }
  };
}

describe('POST /api/parse/[sessionId] — file_reports', () => {
  const dir = getUploadDir(VALID_ID);
  const manifest = [
    'internal_all.csv',                              // parsed (core) — passes gate
    'response_codes.csv',                            // parsed — passes gate
    'page_titles.csv',                               // failed (normal)
    'response_codes_internal_redirect_chain.csv',    // failed (normal — over-inclusion guard)
    'badfile.csv',                                   // unmatched
    'notes.txt',                                     // skipped
  ];

  beforeEach(async () => {
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'technical', files: JSON.stringify(manifest),
    });
    sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    sessionUpdateMock.mockReset().mockResolvedValue({});
    clientFindManyMock.mockReset().mockResolvedValue([]);
    txMock.mockReset().mockResolvedValue([]);
    findParserForFileMock.mockReset().mockImplementation((filename: string) => {
      if (filename === 'internal_all.csv') return throwingParser('internal');   // core FAIL
      if (filename === 'response_codes.csv') return goodParser('responsecodes'); // parsed
      if (filename === 'page_titles.csv') return throwingParser('pagetitles');   // normal FAIL
      if (filename === 'response_codes_internal_redirect_chain.csv') return throwingParser('responsecodes');
      return null; // badfile.csv -> unmatched
    });
    await fs.mkdir(dir, { recursive: true });
    for (const f of manifest) await fs.writeFile(path.join(dir, f), 'Address\nhttps://example.com/\n');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('emits one FileReport per manifest file with correct status + severity', async () => {
    const res = await POST({} as never, ctx as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    const reports = body.result.metadata.file_reports as Array<{ filename: string; status: string; severity: string }>;
    const by = Object.fromEntries(reports.map(r => [r.filename, r]));

    expect(reports).toHaveLength(6);
    expect(by['response_codes.csv'].status).toBe('parsed');
    expect(by['internal_all.csv']).toMatchObject({ status: 'failed', severity: 'core' });
    expect(by['page_titles.csv']).toMatchObject({ status: 'failed', severity: 'normal' });
    expect(by['response_codes_internal_redirect_chain.csv']).toMatchObject({ status: 'failed', severity: 'normal' });
    expect(by['badfile.csv'].status).toBe('unmatched');
    expect(by['notes.txt'].status).toBe('skipped');
  });

  it('no longer writes result.parsing_errors and preserves parsers_used for parsed files', async () => {
    const res = await POST({} as never, ctx as never);
    const body = await res.json();
    expect(body.result.parsing_errors).toBeUndefined();
    expect(body.result.metadata.parsers_used).toContain('responsecodes');
    expect(body.result.metadata.parsers_used).not.toContain('pagetitles'); // it threw
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/parse/[sessionId]/route.test.ts"`
Expected: FAIL — `file_reports` is `undefined` (route still uses the string `errors[]` + `parsing_errors`).

- [ ] **Step 3: Refactor `parseFile` and the loop in the route**

In `app/api/parse/[sessionId]/route.ts`, add the import (top of file):

```ts
import { isCoreExport } from '@/lib/parsers/expected-exports';
import type { FileReport } from '@/lib/types';
```

Replace the block from `const aggregator = new AggregatorService();` through the `result.metadata.parsers_used = ...` / `parsing_errors` attach (current lines ~104-170) with:

```ts
    const aggregator = new AggregatorService();

    type AnyParser = { parse(): Record<string, unknown>; getPrimaryDomain(): string | null };
    type ParseSuccess = { parserName: string; result: Record<string, unknown>; filename: string; primaryDomain: string | null };
    type FileOutcome = { report: FileReport; success?: ParseSuccess };

    const failed = (filename: string, error: string): FileOutcome => ({
      report: {
        filename,
        status: 'failed',
        error,
        severity: isCoreExport(filename) ? 'core' : 'normal',
      },
    });

    const parseOne = async (filename: string): Promise<FileOutcome> => {
      const filePath = path.join(uploadDir, filename);

      if (path.extname(filename).toLowerCase() !== '.csv') {
        return { report: { filename, status: 'skipped', severity: 'info' } };
      }

      try {
        await fs.access(filePath);
      } catch {
        return failed(filename, 'File not found');
      }

      let rawContent: string;
      try {
        rawContent = await fs.readFile(filePath, 'utf-8');
      } catch (readError) {
        return failed(filename, readError instanceof Error ? readError.message : 'Unknown error');
      }

      const ParserClass = findParserForFile(filename, rawContent);
      if (!ParserClass) {
        return { report: { filename, status: 'unmatched', severity: 'info' } };
      }

      try {
        const ParserConstructor = ParserClass as unknown as new (content: string) => AnyParser;
        const parser = new ParserConstructor(rawContent);
        const result = parser.parse();
        const primaryDomain = parser.getPrimaryDomain();
        // Explicit static parserKey, NOT ParserClass.name — prod minifies class names.
        const parserName = (ParserClass as unknown as { parserKey?: string }).parserKey
          || ParserClass.name.replace('Parser', '').toLowerCase();
        return {
          report: { filename, status: 'parsed', parser: parserName, severity: 'info' },
          success: { parserName, result, filename, primaryDomain },
        };
      } catch (parseError) {
        return failed(filename, parseError instanceof Error ? parseError.message : 'Unknown error');
      }
    };

    const reports: FileReport[] = [];
    const successes: ParseSuccess[] = [];
    for (const filename of sessionFiles) {
      const outcome = await parseOne(filename);
      reports.push(outcome.report);
      if (outcome.success) successes.push(outcome.success);
    }

    const parsersUsed: string[] = [];
    for (const s of successes) {
      aggregator.addParserResult(s.parserName, s.result, s.filename);
      parsersUsed.push(s.parserName);
    }

    const result = aggregator.aggregate();
    result.metadata.parsers_used = Array.from(new Set(parsersUsed));
    result.metadata.file_reports = reports;
```

Then update the primary-domain detection loop below it to iterate `successes` instead of the old `parseResults`:

```ts
    if (!result.metadata.site_name) {
      const domainCounts = new Map<string, number>();
      for (const s of successes) {
        if (s.primaryDomain) {
          domainCounts.set(s.primaryDomain, (domainCounts.get(s.primaryDomain) ?? 0) + 1);
        }
      }
      if (domainCounts.size > 0) {
        result.metadata.site_name = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
    }
```

Delete the old `errors`, `parseFile`, `parseResults`, and the `if (errors.length > 0) { ...parsing_errors... }` block entirely. Leave the rest of the route (client match, `$transaction`, `writeSeoFindings`, pillar trigger) unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/parse/[sessionId]/route.test.ts"`
Expected: PASS (both new tests + the existing gate tests).

- [ ] **Step 5: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/api/parse/[sessionId]/route.ts" "app/api/parse/[sessionId]/route.test.ts"
git commit -m "feat(c7): structured per-file reports in parse route; drop parsing_errors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 3: Strip `file_reports` from the Claude memo export

**Files:**
- Modify: `lib/parsers/claude-export-builder.ts` (the metadata destructure, ~line 94)
- Test: `lib/parsers/claude-export-builder.test.ts` (append a case)

**Interfaces:**
- Consumes: `FileReport` type + `metadata.file_reports` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `lib/parsers/claude-export-builder.test.ts` (inside the existing top-level `describe`, or a new one). Build a minimal result with `file_reports` on metadata and assert it is stripped. Reuse the file's existing fixture/builder if present; otherwise:

```ts
it('omits file_reports (and health_score) from the Claude export metadata', () => {
  const result = buildClaudeExport({
    crawl_summary: {}, issues: { critical: [], warnings: [], notices: [] },
    site_structure: {}, resources: {}, technical_seo: {}, performance: {},
    recommendations: [],
    metadata: {
      files_processed: ['internal_all.csv'], parsers_used: ['internal'],
      total_parsers_available: 40, health_score: 88,
      file_reports: [{ filename: 'internal_all.csv', status: 'parsed', parser: 'internal', severity: 'info' }],
    },
  } as never);
  expect((result.metadata as Record<string, unknown>).file_reports).toBeUndefined();
  expect((result.metadata as Record<string, unknown>).health_score).toBeUndefined();
  expect(result.metadata.files_processed).toEqual(['internal_all.csv']);
});
```

Match the actual exported function name in `claude-export-builder.ts` (verify it is `buildClaudeExport`; if different, use the real name).

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/claude-export-builder.test.ts`
Expected: FAIL — `file_reports` is present (only `health_score` is stripped today).

- [ ] **Step 3: Extend the destructure**

In `lib/parsers/claude-export-builder.ts`, change:

```ts
  const { health_score, ...metadataForClaude } = result.metadata;
```

to:

```ts
  const { health_score, file_reports, ...metadataForClaude } = result.metadata;
```

(`health_score` and `file_reports` are intentionally unused here — they are destructured out to exclude them from the memo payload.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers/claude-export-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify lint (no unused-var error)**

Run: `npm run lint`
Expected: PASS. If tsc/eslint flags the unused `file_reports`, mirror however `health_score` is currently handled (it is already destructured-and-unused there, so the same config tolerates it).

- [ ] **Step 6: Commit**

```bash
git add lib/parsers/claude-export-builder.ts lib/parsers/claude-export-builder.test.ts
git commit -m "feat(c7): exclude file_reports from Claude memo export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 4: `FileProcessingPanel` component

**Files:**
- Create: `components/seo-parser/FileProcessingPanel.tsx`
- Test: `components/seo-parser/FileProcessingPanel.test.tsx`

**Interfaces:**
- Consumes: `FileReport` (Task 1).
- Produces: `FileProcessingPanel({ reports, archived, legacy })` default-exported/named component.

Props:
```ts
interface FileProcessingPanelProps {
  reports: FileReport[] | undefined;   // result.metadata.file_reports
  archived?: boolean;                  // result.archived
  legacy: { filesProcessed: number; parsersUsed: number; totalParsers?: number }; // fallback summary
}
```

Behavior:
- `archived === true` → render `null`.
- `reports` undefined/empty → render the legacy summary line: `{filesProcessed} files · {parsersUsed}{/totalParsers} parsers matched` (backward-compat for pre-2026-07 sessions).
- Otherwise → summary line `N parsed · M failed · K not recognized` (omit zero buckets; `unmatched`+`skipped` both count toward "not recognized"); a core-failure banner if any `status==='failed' && severity==='core'`; and a `<details>` list (non-parsed rows first, then parsed), each row a status badge + `parser` or `error`.

- [ ] **Step 1: Write the failing render tests**

Create `components/seo-parser/FileProcessingPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { FileProcessingPanel } from './FileProcessingPanel';
import type { FileReport } from '@/lib/types';

afterEach(cleanup);

const legacy = { filesProcessed: 4, parsersUsed: 3, totalParsers: 40 };

describe('FileProcessingPanel', () => {
  it('renders nothing for archived results', () => {
    const { container } = render(<FileProcessingPanel reports={undefined} archived legacy={legacy} />);
    expect(container.textContent).toBe('');
  });

  it('falls back to the legacy summary when file_reports is absent', () => {
    const { container } = render(<FileProcessingPanel reports={undefined} legacy={legacy} />);
    expect(container.textContent).toContain('4 files');
    expect(container.textContent).toContain('3');
  });

  it('shows a core-failure banner when a core export failed', () => {
    const reports: FileReport[] = [
      { filename: 'internal_all.csv', status: 'failed', severity: 'core', error: 'boom' },
      { filename: 'response_codes.csv', status: 'parsed', severity: 'info', parser: 'responsecodes' },
    ];
    const { container } = render(<FileProcessingPanel reports={reports} legacy={legacy} />);
    expect(container.textContent).toContain('internal_all.csv');
    expect(container.textContent?.toLowerCase()).toContain('unreliable');
  });

  it('summarizes buckets and does not show the banner without a core failure', () => {
    const reports: FileReport[] = [
      { filename: 'a.csv', status: 'parsed', severity: 'info', parser: 'x' },
      { filename: 'b.csv', status: 'failed', severity: 'normal', error: 'oops' },
      { filename: 'c.csv', status: 'unmatched', severity: 'info' },
      { filename: 'notes.txt', status: 'skipped', severity: 'info' },
    ];
    const { container } = render(<FileProcessingPanel reports={reports} legacy={legacy} />);
    expect(container.textContent).toContain('1 parsed');
    expect(container.textContent).toContain('1 failed');
    expect(container.textContent?.toLowerCase()).not.toContain('unreliable');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/FileProcessingPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component (dark-mode compliant)**

Create `components/seo-parser/FileProcessingPanel.tsx`:

```tsx
import type { FileReport, FileReportStatus } from '@/lib/types';

interface FileProcessingPanelProps {
  reports: FileReport[] | undefined;
  archived?: boolean;
  legacy: { filesProcessed: number; parsersUsed: number; totalParsers?: number };
}

const STATUS_LABEL: Record<FileReportStatus, string> = {
  parsed: 'Parsed',
  failed: 'Failed',
  unmatched: 'Not recognized',
  skipped: 'Skipped',
};

const STATUS_BADGE: Record<FileReportStatus, string> = {
  parsed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  unmatched: 'bg-gray-100 text-gray-600 dark:bg-navy-light dark:text-white/60',
  skipped: 'bg-gray-100 text-gray-600 dark:bg-navy-light dark:text-white/60',
};

export function FileProcessingPanel({ reports, archived, legacy }: FileProcessingPanelProps) {
  if (archived) return null;

  if (!reports || reports.length === 0) {
    return (
      <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
        {legacy.filesProcessed} files · {legacy.parsersUsed}
        {legacy.totalParsers ? `/${legacy.totalParsers}` : ''} parsers matched
      </p>
    );
  }

  const parsed = reports.filter((r) => r.status === 'parsed').length;
  const failed = reports.filter((r) => r.status === 'failed').length;
  const notRecognized = reports.filter((r) => r.status === 'unmatched' || r.status === 'skipped').length;
  const coreFailures = reports.filter((r) => r.status === 'failed' && r.severity === 'core');

  const summaryParts = [
    parsed ? `${parsed} parsed` : null,
    failed ? `${failed} failed` : null,
    notRecognized ? `${notRecognized} not recognized` : null,
  ].filter(Boolean);

  // Non-parsed first (failed → unmatched → skipped), then parsed.
  const order: Record<FileReportStatus, number> = { failed: 0, unmatched: 1, skipped: 2, parsed: 3 };
  const sorted = [...reports].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div className="mt-2 text-sm">
      {coreFailures.length > 0 && (
        <div
          role="alert"
          className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          Core export{coreFailures.length > 1 ? 's' : ''}{' '}
          {coreFailures.map((r) => r.filename).join(', ')} failed to parse — the health score may be unreliable.
        </div>
      )}

      <details className="text-gray-500 dark:text-white/50">
        <summary className="cursor-pointer select-none hover:text-gray-700 dark:hover:text-white/70">
          File processing: {summaryParts.join(' · ')}
        </summary>
        <ul className="mt-2 space-y-1">
          {sorted.map((r) => (
            <li key={r.filename} className="flex items-start gap-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}>
                {STATUS_LABEL[r.status]}
              </span>
              <span className="text-gray-700 dark:text-white/70 break-all">
                {r.filename}
                {r.status === 'parsed' && r.parser ? ` — ${r.parser}` : ''}
                {r.status === 'failed' && r.error ? ` — ${r.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/FileProcessingPanel.test.tsx`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add components/seo-parser/FileProcessingPanel.tsx components/seo-parser/FileProcessingPanel.test.tsx
git commit -m "feat(c7): FileProcessingPanel component (dark-mode, banner + buckets)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 5: Wire the panel into `ResultsView`; remove the debug footer

**Files:**
- Modify: `components/seo-parser/ResultsView.tsx` (import + render the panel in the header area; remove the "Debug info" `<details>` footer)

**Interfaces:**
- Consumes: `FileProcessingPanel` (Task 4).

- [ ] **Step 1: Import the panel**

At the top of `components/seo-parser/ResultsView.tsx`, add:

```ts
import { FileProcessingPanel } from './FileProcessingPanel';
```

- [ ] **Step 2: Replace the header summary `<p>` with the panel**

In the header block, replace the existing summary paragraph:

```tsx
            {result.archived ? (
              <p className="text-gray-500 dark:text-white/50 text-sm mt-1">Archived — rebuilt from findings data</p>
            ) : (
              <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
                {result.metadata.files_processed.length} files · {result.metadata.parsers_used.length}
                {result.metadata.total_parsers_available ? `/${result.metadata.total_parsers_available}` : ''} parsers matched
              </p>
            )}
```

with:

```tsx
            {result.archived ? (
              <p className="text-gray-500 dark:text-white/50 text-sm mt-1">Archived — rebuilt from findings data</p>
            ) : (
              <FileProcessingPanel
                reports={result.metadata.file_reports}
                archived={result.archived}
                legacy={{
                  filesProcessed: result.metadata.files_processed.length,
                  parsersUsed: result.metadata.parsers_used.length,
                  totalParsers: result.metadata.total_parsers_available,
                }}
              />
            )}
```

- [ ] **Step 3: Remove the redundant "Debug info" footer**

Delete this block (the parsers-used debug `<details>`, ~lines 206-211):

```tsx
        {/* Debug footer */}
        {result.metadata.parsers_used.length > 0 && (
          <details className="text-xs text-gray-400 dark:text-white/40 pb-4">
            <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-white/60 select-none">Debug info</summary>
            <p className="mt-1">Parsers used: {result.metadata.parsers_used.join(', ')}</p>
          </details>
        )}
```

(The parsers-used info now lives in the panel's parsed rows.)

- [ ] **Step 4: Verify lint + build**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/seo-parser/ResultsView.tsx
git commit -m "feat(c7): render FileProcessingPanel in results, drop debug footer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY"
```

---

### Task 6: Full gate + PR

- [ ] **Step 1: Run all three gates**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: tsc clean; all vitest green (existing count + the new tests); build succeeds.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/c7-parse-file-reporting
gh pr create --title "C7 pt1: per-file parse reporting (failure-isolation surfacing)" --body "$(cat <<'EOF'
Implements C7 Phase 3 part 1 of 3 (isolation surfacing). Spec:
docs/superpowers/specs/2026-07-03-parse-file-reporting-design.md (Codex-reviewed).

- Structured `metadata.file_reports` (parsed/failed/unmatched/skipped + severity)
- Core-export failure banner on the SEO results page
- Drops dead `result.parsing_errors`; excludes file_reports from the Claude memo export
- New `FileProcessingPanel` (dark-mode); backward-compat + archived-safe

No schema migration, no new env var, no middleware change.

**Kevin pre-merge notes:** none. **Prod-verify plan:** upload a small crawl to a
client/staging site with one deliberately-corrupt CSV + one mis-named CSV; confirm
the panel buckets + core-failure banner; confirm a pre-PR session still renders.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: STOP.** Do not merge or deploy — hard gate 1 (Kevin only, in-conversation).

---

## Self-Review

**Spec coverage:**
- FileReport types + `metadata.file_reports` → Task 1. ✓
- `isCoreExport` over-inclusion guard → Task 1 (+ tests). ✓
- Structured reports, parallel success list, drop `parsing_errors`, `extname().toLowerCase()` skipped, primary-domain from successes → Task 2. ✓
- Claude export strip (keep JSON export) → Task 3. ✓
- Panel + core banner + legacy fallback + archived-hidden + dark mode → Tasks 4-5. ✓
- Share-page unaffected → structural (ResultsView-only; panel never imported there). ✓
- Tests: route taxonomy, isCoreExport, claude-export, ResultsView/panel render → Tasks 1-4. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**Type consistency:** `FileReport`/`FileReportStatus`/`FileReportSeverity` and `file_reports` used identically across Tasks 1-5; `isCoreExport(filename)` signature consistent; `FileProcessingPanel` props match its call site. ✓
