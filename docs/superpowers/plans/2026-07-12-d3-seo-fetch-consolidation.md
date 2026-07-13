# D3 — Shared `lib/seo-fetch/` Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the repo's three robots parsers and two sitemap parsers into one shared `lib/seo-fetch/` module (client-safe parse + server-only fetch through `safeFetch`), behavior-preserving except one named micro-delta, as the foundation for D4/D5.

**Architecture:** Move-not-rewrite: `lib/validators/*` and `lib/ada-audit/seo/robots-rules.ts` are `git mv`'d into `lib/seo-fetch/`; the fetch helpers private to `lib/ada-audit/sitemap-crawler.ts` are extracted into `lib/seo-fetch/fetch.ts` with a discriminated-union result taxonomy (backed by a new additive typed `reason` on `SafeUrlError`); the crawler keeps discovery orchestration and adapts the structured results back to its `''`/`null`-on-failure semantics. Spec: `docs/superpowers/specs/2026-07-12-d3-seo-fetch-consolidation-design.md` (Codex spec review ×1 fixes #1–#9 applied; Codex plan review ×1 fixes tagged "Codex plan #N" below).

**Tech Stack:** TypeScript, vitest, existing `lib/security/safe-url.ts` (`safeFetch`), `node:zlib`. No new dependencies, no schema change, no new routes.

## Resolved decisions (from the spec, Codex fixes folded in)

- **D1** Consolidation only — no DB, no routes, no UI features; validator page UX unchanged.
- **D2** Two matchers remain semantically distinct (rich validator matcher vs minimal crawl matcher), one home, cross-referencing header comments.
- **D3** `lib/validators/` deleted via `git mv` (no facades — single-page consumer); moved test suites pass unmodified except import lines.
- **D4** Fetch primitives return a discriminated union (`SeoFetchResult`); crawler adapts at call sites. `SafeUrlError` gains additive typed `reason` (Codex #1/#2).
- **D5** Puppeteer stays in `lib/ada-audit/`; the shared collector takes an injected fetcher.
- **D6** `Sitemap:` extraction strips `#`-comments — the ONLY intended behavior change, isolated in its own commit (Task 7) with an e2e test matrix (Codex #8).
- **D7** Sitemap-index expansion stays ONE level (frozen, characterization-tested); collector returns `childrenTotal`/`childrenFailed` diagnostics the crawler ignores (Codex #4/#5).

## Global Constraints

- Branch: `feat/d3-seo-fetch` off current `main`. Never commit to main directly.
- Gates before merge: `npm run lint` (tsc --noEmit) + `npm test` (vitest run) + `npm run build`; **plus `npm run smoke`** (this touches the ADA-audit discovery path). On macOS export `CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` first.
- Security-sensitive class: **never weaken `lib/security/safe-url.ts`** — the `SafeUrlError.reason` change must be strictly additive (no throw/no-throw change, no message change); audit-ci must stay green. No new raw fetch paths — every network call in `lib/seo-fetch/fetch.ts` goes through `safeFetch`.
- The `assertSafeHttpUrl` check-then-fetch ordering in `discoverPages` is untouched.
- Use `git mv` for all file moves (history). Stage explicit paths only — never `git add -A`/`-u` at repo root (`pentest-results/` is untracked).
- No backticks in `git commit -m` messages.
- `lib/seo-fetch/robots-parse.ts`, `robots-match.ts`, `sitemap-parse.ts` must stay client-safe (pure, no node imports — the robots-validator page is a client component). `lib/seo-fetch/fetch.ts` starts with `import 'server-only'`.
- The crawler's behavioral test blocks (`discoverPages`/`discoverPagesWithDeps` describes in `lib/ada-audit/sitemap-crawler.test.ts`) must pass with ZERO edits through Task 6; Task 7 (D6) adds one new test and changes no existing assertion.
- Tests self-provision per-worker SQLite DBs and run parallel (not relevant here — every test in this plan is pure/mocked; no DB).

## File Structure

```
lib/seo-fetch/
  robots-match.ts        Task 1  ← git mv lib/ada-audit/seo/robots-rules.ts (verbatim + header note)
  robots-match.test.ts   Task 1  ← git mv lib/ada-audit/seo/robots-rules.test.ts (import line only)
  robots-parse.ts        Task 2  ← git mv lib/validators/robots.validator.ts (+ extractSitemapUrls)
  robots-parse.test.ts   Task 2  ← git mv lib/validators/robots.validator.test.ts (+ new describe)
  sitemap-parse.ts       Task 3  ← git mv lib/validators/sitemap.validator.ts (+ XML helpers)
  sitemap-parse.test.ts  Task 3  ← git mv lib/validators/sitemap.validator.test.ts (+ new describes)
  fetch.ts               Task 5  ← NEW (extracted from sitemap-crawler.ts privates)
  fetch.test.ts          Task 5  ← NEW
lib/security/safe-url.ts           Task 4  (additive SafeUrlErrorReason)
lib/security/safe-url.test.ts      Task 4  (additive reason-tag cases)
lib/ada-audit/sitemap-crawler.ts   Tasks 1,6,7  (import swap; delegate to seo-fetch; D6)
lib/ada-audit/sitemap-crawler.test.ts  Tasks 6,7  (helper copies → imports; D6 e2e test)
lib/ada-audit/seo/hybrid-crawl.ts  Task 1  (import path only)
app/(app)/robots-validator/page.tsx  Tasks 2,3  (import paths only)
CLAUDE.md                          Task 8  (Key files entry)
```

---

### Task 1: Move `robots-rules.ts` → `lib/seo-fetch/robots-match.ts`

**Files:**
- Create (via git mv): `lib/seo-fetch/robots-match.ts`, `lib/seo-fetch/robots-match.test.ts`
- Modify: `lib/ada-audit/sitemap-crawler.ts:9`, `lib/ada-audit/seo/hybrid-crawl.ts:22`

**Interfaces:**
- Produces: `parseRobots(text: string): RobotsRules`, `isAllowed(pathname: string, rules: RobotsRules): boolean`, `interface RobotsRules { disallow: string[]; allow: string[] }` at `@/lib/seo-fetch/robots-match` — signatures byte-identical to today's `lib/ada-audit/seo/robots-rules.ts`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p lib/seo-fetch
git mv lib/ada-audit/seo/robots-rules.ts lib/seo-fetch/robots-match.ts
git mv lib/ada-audit/seo/robots-rules.test.ts lib/seo-fetch/robots-match.test.ts
```

- [ ] **Step 2: Fix the test import and run it (it should pass — pure move)**

In `lib/seo-fetch/robots-match.test.ts` change `from './robots-rules'` → `from './robots-match'`. No other edits.

Run: `npx vitest run lib/seo-fetch/robots-match.test.ts`
Expected: PASS, same test count as before the move.

- [ ] **Step 3: Update the two consumers' imports**

`lib/ada-audit/sitemap-crawler.ts:9`:
```ts
import { parseRobots, type RobotsRules } from '@/lib/seo-fetch/robots-match'
```
`lib/ada-audit/seo/hybrid-crawl.ts:22`:
```ts
import { isAllowed, type RobotsRules } from '@/lib/seo-fetch/robots-match'
```

- [ ] **Step 4: Add the cross-reference header line**

In `lib/seo-fetch/robots-match.ts`, extend the existing header comment (keep every existing line) with:
```ts
// NOTE: this is the MINIMAL crawl-frontier matcher (star-group only, $-aware).
// The UA-aware, issue-reporting validator parser lives in ./robots-parse.ts —
// the two are intentionally distinct (spec D2); do not unify.
```

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run lib/seo-fetch/robots-match.test.ts lib/ada-audit/sitemap-crawler.test.ts lib/ada-audit/seo/hybrid-crawl.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/seo-fetch/robots-match.ts lib/seo-fetch/robots-match.test.ts lib/ada-audit/sitemap-crawler.ts lib/ada-audit/seo/hybrid-crawl.ts
git commit -m "refactor(d3): move robots-rules to lib/seo-fetch/robots-match (verbatim)"
```

---

### Task 2: Move `robots.validator.ts` → `lib/seo-fetch/robots-parse.ts` + shared `extractSitemapUrls`

**Files:**
- Create (via git mv): `lib/seo-fetch/robots-parse.ts`, `lib/seo-fetch/robots-parse.test.ts`
- Modify: `app/(app)/robots-validator/page.tsx:5-11`

**Interfaces:**
- Produces (all at `@/lib/seo-fetch/robots-parse`): everything `lib/validators/robots.validator.ts` exports today, byte-identical (`parseRobotsTxt`, `testUrlAgainstRobots`, `KNOWN_AI_BOTS`, `RobotsIssue`, `RobotsGroup`, `RobotsParseResult`), **plus** `extractSitemapUrls(robotsText: string): string[]` — Task 7 consumes it.

- [ ] **Step 1: Move the files**

```bash
git mv lib/validators/robots.validator.ts lib/seo-fetch/robots-parse.ts
git mv lib/validators/robots.validator.test.ts lib/seo-fetch/robots-parse.test.ts
```

In `lib/seo-fetch/robots-parse.test.ts` change `from './robots.validator'` → `from './robots-parse'`. No other edits to existing tests.

- [ ] **Step 2: Write the failing tests for `extractSitemapUrls` (D6 matrix, Codex #8)**

Append to `lib/seo-fetch/robots-parse.test.ts` (add `extractSitemapUrls` to the import):

```ts
describe('extractSitemapUrls', () => {
  it('extracts a plain Sitemap directive', () => {
    expect(extractSitemapUrls('Sitemap: https://x.com/sitemap.xml')).toEqual([
      'https://x.com/sitemap.xml',
    ])
  })

  it('is case-insensitive and tolerates leading whitespace', () => {
    expect(extractSitemapUrls('  sitemap: https://x.com/s.xml')).toEqual(['https://x.com/s.xml'])
  })

  it('D6: strips a trailing space-separated comment', () => {
    expect(extractSitemapUrls('Sitemap: https://x.com/sitemap.xml # primary')).toEqual([
      'https://x.com/sitemap.xml',
    ])
  })

  it('D6: strips an adjacent # with no space', () => {
    expect(extractSitemapUrls('Sitemap: https://x.com/sitemap.xml#note')).toEqual([
      'https://x.com/sitemap.xml',
    ])
  })

  it('D6: handles CRLF line endings', () => {
    expect(
      extractSitemapUrls('User-agent: *\r\nSitemap: https://x.com/a.xml\r\nSitemap: https://x.com/b.xml\r\n')
    ).toEqual(['https://x.com/a.xml', 'https://x.com/b.xml'])
  })

  it('D6: keeps duplicate directives (dedup is the caller concern)', () => {
    expect(
      extractSitemapUrls('Sitemap: https://x.com/s.xml\nSitemap: https://x.com/s.xml')
    ).toEqual(['https://x.com/s.xml', 'https://x.com/s.xml'])
  })

  it('D6: percent-encoded %23 survives (only literal # is a comment)', () => {
    expect(extractSitemapUrls('Sitemap: https://x.com/s%23a.xml')).toEqual([
      'https://x.com/s%23a.xml',
    ])
  })

  it('ignores full-line comments and non-sitemap fields', () => {
    expect(
      extractSitemapUrls('# Sitemap: https://x.com/no.xml\nUser-agent: *\nDisallow: /')
    ).toEqual([])
  })

  it('ignores a Sitemap directive with an empty value', () => {
    expect(extractSitemapUrls('Sitemap:')).toEqual([])
    expect(extractSitemapUrls('Sitemap:   # only comment')).toEqual([])
  })

  it('agrees with parseRobotsTxt().sitemapUrls on a mixed file', () => {
    const txt = [
      'User-agent: *',
      'Disallow: /admin',
      'Sitemap: https://x.com/a.xml # main',
      'sitemap: https://x.com/b.xml',
      '# Sitemap: https://x.com/commented.xml',
      'Sitemap: https://x.com/c%23d.xml',
    ].join('\r\n')
    expect(extractSitemapUrls(txt)).toEqual(parseRobotsTxt(txt).sitemapUrls)
  })
})
```

- [ ] **Step 3: Run to verify the new describe fails**

Run: `npx vitest run lib/seo-fetch/robots-parse.test.ts`
Expected: FAIL — `extractSitemapUrls` is not exported. (Also confirms the agreement test's expectations: `parseRobotsTxt` already comment-strips, so `sitemapUrls` for the mixed file is `['https://x.com/a.xml','https://x.com/b.xml','https://x.com/c%23d.xml']`.)

- [ ] **Step 4: Implement `extractSitemapUrls`**

Append to `lib/seo-fetch/robots-parse.ts` (reuses the exact comment-strip + field-parse discipline `parseRobotsTxt` uses, so the two can never disagree):

```ts
/**
 * Pure `Sitemap:` line scan over a robots.txt body. Strips #-comments the
 * same way parseRobotsTxt does (spec D6) — a trailing " # note" or adjacent
 * "#fragment" never reaches the returned URL; percent-encoded %23 survives.
 * Duplicates are preserved (callers dedupe). Cheap alternative to running
 * the full parser on the discovery path.
 */
export function extractSitemapUrls(robotsText: string): string[] {
  const urls: string[] = []
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const field = line.slice(0, colonIdx).trim().toLowerCase()
    if (field !== 'sitemap') continue
    const value = line.slice(colonIdx + 1).trim()
    if (value) urls.push(value)
  }
  return urls
}
```

Also add the D2 cross-reference at the very top of `lib/seo-fetch/robots-parse.ts` (vice-versa of Task 1 Step 4):

```ts
// Rich UA-aware robots.txt parser + issue reporter for the validator UI and
// future D4 checks. The MINIMAL crawl-frontier matcher (star-group only,
// $-aware) lives in ./robots-match.ts — intentionally distinct semantics
// (spec D2); do not unify.
```

- [ ] **Step 5: Update the page import**

In `app/(app)/robots-validator/page.tsx`, change the robots import block to:
```ts
import {
  parseRobotsTxt,
  testUrlAgainstRobots,
  KNOWN_AI_BOTS,
  type RobotsParseResult,
  type RobotsIssue,
} from '@/lib/seo-fetch/robots-parse'
```

- [ ] **Step 6: Run tests + tsc**

Run: `npx vitest run lib/seo-fetch/robots-parse.test.ts && npx tsc --noEmit`
Expected: PASS (existing suite unmodified + new describe green), tsc clean.

- [ ] **Step 7: Commit**

```bash
git add lib/seo-fetch/robots-parse.ts lib/seo-fetch/robots-parse.test.ts "app/(app)/robots-validator/page.tsx"
git commit -m "refactor(d3): move robots validator parser to lib/seo-fetch/robots-parse; add shared extractSitemapUrls"
```

---

### Task 3: Move `sitemap.validator.ts` → `lib/seo-fetch/sitemap-parse.ts` + XML helpers

**Files:**
- Create (via git mv): `lib/seo-fetch/sitemap-parse.ts`, `lib/seo-fetch/sitemap-parse.test.ts`
- Modify: `app/(app)/robots-validator/page.tsx:12`

**Interfaces:**
- Produces (all at `@/lib/seo-fetch/sitemap-parse`): everything `lib/validators/sitemap.validator.ts` exports today, byte-identical (`parseSitemapXml`, `SitemapIssue`, `SitemapParseResult`), **plus** `isSitemapIndex(xml: string): boolean`, `extractPageLocs(xml: string): string[]`, `extractChildSitemapLocs(xml: string): string[]` — Tasks 5/6 consume them.

- [ ] **Step 1: Move the files**

```bash
git mv lib/validators/sitemap.validator.ts lib/seo-fetch/sitemap-parse.ts
git mv lib/validators/sitemap.validator.test.ts lib/seo-fetch/sitemap-parse.test.ts
```

In `lib/seo-fetch/sitemap-parse.test.ts` change `from './sitemap.validator'` → `from './sitemap-parse'`. No other edits to existing tests.

Also delete the now-empty `lib/validators/` directory (git tracks files, not dirs — nothing to do if empty).

- [ ] **Step 2: Write the failing tests for the crawl-side helpers**

Append to `lib/seo-fetch/sitemap-parse.test.ts` (extend the import):

```ts
describe('isSitemapIndex', () => {
  it('detects a sitemapindex root with attributes', () => {
    expect(isSitemapIndex('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true)
  })
  it('detects a bare sitemapindex tag', () => {
    expect(isSitemapIndex('<sitemapindex>')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(isSitemapIndex('<SITEMAPINDEX>')).toBe(true)
  })
  it('returns false for a urlset', () => {
    expect(isSitemapIndex('<urlset><url><loc>https://x.com/</loc></url></urlset>')).toBe(false)
  })
  it('returns false for bare text mentioning sitemapindex', () => {
    expect(isSitemapIndex('this is about sitemapindex stuff')).toBe(false)
  })
})

describe('extractPageLocs', () => {
  it('extracts locs from url blocks', () => {
    const xml = '<urlset><url><loc>https://x.com/a</loc></url><url><loc>https://x.com/b</loc></url></urlset>'
    expect(extractPageLocs(xml)).toEqual(['https://x.com/a', 'https://x.com/b'])
  })
  it('strips CDATA wrappers and whitespace', () => {
    const xml = '<urlset><url><loc> <![CDATA[https://x.com/a]]> </loc></url></urlset>'
    expect(extractPageLocs(xml)).toEqual(['https://x.com/a'])
  })
  it('ignores sitemap-index child locs', () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/child.xml</loc></sitemap></sitemapindex>'
    expect(extractPageLocs(xml)).toEqual([])
  })
  it('is stateless across calls (fresh regex per call)', () => {
    const xml = '<urlset><url><loc>https://x.com/a</loc></url></urlset>'
    expect(extractPageLocs(xml)).toEqual(['https://x.com/a'])
    expect(extractPageLocs(xml)).toEqual(['https://x.com/a'])
  })
})

describe('extractChildSitemapLocs', () => {
  it('extracts child sitemap locs from an index', () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap><sitemap><loc>https://x.com/b.xml</loc></sitemap></sitemapindex>'
    expect(extractChildSitemapLocs(xml)).toEqual(['https://x.com/a.xml', 'https://x.com/b.xml'])
  })
  it('ignores url-block locs', () => {
    const xml = '<urlset><url><loc>https://x.com/a</loc></url></urlset>'
    expect(extractChildSitemapLocs(xml)).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify the new describes fail**

Run: `npx vitest run lib/seo-fetch/sitemap-parse.test.ts`
Expected: FAIL — the three helpers are not exported.

- [ ] **Step 4: Implement the helpers**

Append to `lib/seo-fetch/sitemap-parse.ts` (logic lifted verbatim from `sitemap-crawler.ts`'s `extractLocs`/`isSitemapIndex`; fresh RegExp per call because `g` regexes are stateful):

```ts
// ── Crawl-side XML helpers (moved from lib/ada-audit/sitemap-crawler.ts) ────
// NOTE: parseSitemapXml above intentionally keeps its own extractTagValues —
// it validates the raw document (counts every <loc>), while these helpers
// feed the crawl/discovery path (scoped to <url>/<sitemap> blocks).

function extractLocs(xml: string, tagPattern: RegExp): string[] {
  const urls: string[] = []
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(xml)) !== null) {
    // Strip CDATA wrappers and whitespace
    const raw = match[1].replace(/<!\[CDATA\[([\s\S]*?)]]>/, '$1').trim()
    if (raw) urls.push(raw)
  }
  return urls
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml)
}

/** Page URLs from a plain urlset sitemap (`<url>…<loc>` pairs). */
export function extractPageLocs(xml: string): string[] {
  return extractLocs(xml, /<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
}

/** Child sitemap URLs from a sitemapindex (`<sitemap>…<loc>` pairs). */
export function extractChildSitemapLocs(xml: string): string[] {
  return extractLocs(xml, /<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
}
```

- [ ] **Step 5: Update the page import**

In `app/(app)/robots-validator/page.tsx`:
```ts
import { parseSitemapXml, type SitemapParseResult, type SitemapIssue } from '@/lib/seo-fetch/sitemap-parse'
```

- [ ] **Step 6: Run tests + tsc**

Run: `npx vitest run lib/seo-fetch/sitemap-parse.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean. Also verify `lib/validators/` is gone: `ls lib/validators 2>&1` → No such file or directory.

- [ ] **Step 7: Commit**

```bash
git add lib/seo-fetch/sitemap-parse.ts lib/seo-fetch/sitemap-parse.test.ts "app/(app)/robots-validator/page.tsx"
git commit -m "refactor(d3): move sitemap validator to lib/seo-fetch/sitemap-parse; absorb crawl XML helpers"
```

---

### Task 4: Additive typed `reason` on `SafeUrlError`

**Files:**
- Modify: `lib/security/safe-url.ts` (class at :26; throws at :249, :253, :405, :408, :424, :488, :492, :500)
- Test: `lib/security/safe-url.test.ts` (append only)

**Interfaces:**
- Produces: `export type SafeUrlErrorReason = 'policy' | 'dns' | 'redirect' | 'invalid-response'`; `SafeUrlError` gains `readonly reason: SafeUrlErrorReason` (constructor default `'policy'`). Task 5 consumes `err.reason`.

**Security constraint restated:** strictly additive — every existing throw site keeps its exact message; no throw becomes a non-throw; `instanceof SafeUrlError` checks everywhere are unaffected. Existing safe-url tests must pass UNTOUCHED.

- [ ] **Step 1: Write the failing tests**

Append to `lib/security/safe-url.test.ts` (follow the file's existing import/setup conventions — `SafeUrlError` is already imported there):

```ts
describe('SafeUrlError.reason', () => {
  it('defaults to policy', () => {
    expect(new SafeUrlError('nope').reason).toBe('policy')
    expect(new SafeUrlError('nope').name).toBe('SafeUrlError')
  })

  it('carries an explicit reason', () => {
    expect(new SafeUrlError('gone', 'dns').reason).toBe('dns')
    expect(new SafeUrlError('loop', 'redirect').reason).toBe('redirect')
    expect(new SafeUrlError('bad', 'invalid-response').reason).toBe('invalid-response')
  })

  it('tags DNS resolution failure with reason dns', async () => {
    const lookup = async () => { throw new Error('ENOTFOUND') }
    await expect(
      assertSafeHttpUrl('https://does-not-resolve.example', { lookup })
    ).rejects.toMatchObject({ name: 'SafeUrlError', reason: 'dns' })
  })

  it('tags empty DNS results with reason dns', async () => {
    const lookup = async () => []
    await expect(
      assertSafeHttpUrl('https://empty-dns.example', { lookup })
    ).rejects.toMatchObject({ name: 'SafeUrlError', reason: 'dns' })
  })

  it('keeps policy reason for private-address rejection', async () => {
    const lookup = async () => [{ address: '127.0.0.1', family: 4 }]
    await expect(
      assertSafeHttpUrl('https://internal.example', { lookup })
    ).rejects.toMatchObject({ name: 'SafeUrlError', reason: 'policy' })
  })
})
```

(If `assertSafeHttpUrl` with an injected `lookup` is exercised differently in the existing suite, mirror that existing pattern — the assertions on `reason` are the contract; do not change any existing test.)

Also add reason assertions at the REAL transport throw sites (Codex plan #6) —
constructor-only tests don't prove the eight sites were tagged. Locate the
existing `safe-url.test.ts` tests that exercise (a) the redirect limit /
missing-Location paths and (b) the unsupported-status / missing-status paths,
and add NEW sibling tests reusing their exact setup (mock server / mocked
`node:http` layer — whatever the existing tests use) asserting:

```ts
await expect(/* same call the existing redirect-limit test makes */)
  .rejects.toMatchObject({ name: 'SafeUrlError', reason: 'redirect' })
await expect(/* same call the existing unsupported-status test makes */)
  .rejects.toMatchObject({ name: 'SafeUrlError', reason: 'invalid-response' })
```

Existing tests stay byte-identical; only new tests are added.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/security/safe-url.test.ts`
Expected: FAIL — `reason` is `undefined` / constructor rejects second arg.

- [ ] **Step 3: Implement**

In `lib/security/safe-url.ts`, replace the class:

```ts
/** Classification for SafeUrlError causes. 'policy' = the SSRF guard itself
 *  rejected the request (private host, credentials, scheme, invalid URL);
 *  the others distinguish operational failures that are NOT policy blocks so
 *  callers (lib/seo-fetch, D4 checks) can report them truthfully. Additive
 *  only — never changes what throws. */
export type SafeUrlErrorReason = 'policy' | 'dns' | 'redirect' | 'invalid-response'

export class SafeUrlError extends Error {
  readonly reason: SafeUrlErrorReason
  constructor(message: string, reason: SafeUrlErrorReason = 'policy') {
    super(message)
    this.name = 'SafeUrlError'
    this.reason = reason
  }
}
```

Tag exactly these construction sites (messages unchanged):
- `:249` and `:253` — `` `Could not resolve hostname: ${hostname}` `` → add `, 'dns'`
- `:488` — `'Redirect response missing Location header'` → add `, 'redirect'`
- `:492` and `:500` — `'Too many redirects'` → add `, 'redirect'`
- `:405` — `'Response missing status code'` → add `, 'invalid-response'`
- `:408` — `` `Unsupported response status: ${status}` `` → add `, 'invalid-response'`
- `:424` — `` `Response construction failed: …` `` → add `, 'invalid-response'`

All other sites (policy rejections, `'Hostname resolved to an invalid address'`, `'Unsupported request body type'`) keep the default `'policy'` — no edit.

- [ ] **Step 4: Run the full safe-url suite**

Run: `npx vitest run lib/security/safe-url.test.ts`
Expected: PASS — all pre-existing tests untouched and green, new describe green.

- [ ] **Step 5: Commit**

```bash
git add lib/security/safe-url.ts lib/security/safe-url.test.ts
git commit -m "feat(d3): additive typed reason on SafeUrlError (dns/redirect/invalid-response; default policy)"
```

---

### Task 5: `lib/seo-fetch/fetch.ts` — server-only fetch primitives

**Files:**
- Create: `lib/seo-fetch/fetch.ts`
- Test: `lib/seo-fetch/fetch.test.ts`

**Interfaces:**
- Consumes: `safeFetch`, `readResponseTextWithLimit`, `readResponseBytesWithLimit`, `SafeUrlError` (with `reason`, Task 4) from `@/lib/security/safe-url`; `isSitemapIndex`, `extractPageLocs`, `extractChildSitemapLocs` from `./sitemap-parse` (Task 3).
- Produces (Task 6 consumes): `SEO_FETCH_USER_AGENT: string`, `MAX_ROBOTS_BYTES`, `MAX_SITEMAP_XML_BYTES`, `type SeoFetchFailure`, `type SeoFetchResult` (discriminated union), `fetchRobotsTxt(baseUrl: string): Promise<SeoFetchResult>`, `fetchSitemapXml(url: string): Promise<SeoFetchResult>`, `interface CollectSitemapResult { urls: string[]; childrenTotal: number; childrenFailed: number }`, `collectSitemapPageUrls(xml: string, isSameDomain: (url: string) => boolean, fetchXml: (url: string) => Promise<string | null>): Promise<CollectSitemapResult>`.

- [ ] **Step 1: Write the failing tests**

Create `lib/seo-fetch/fetch.test.ts`. Mock harness mirrors `sitemap-crawler.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'

const safeFetchMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/security/safe-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safe-url')>()
  return {
    ...actual,
    safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  }
})

import {
  fetchRobotsTxt,
  fetchSitemapXml,
  collectSitemapPageUrls,
  SEO_FETCH_USER_AGENT,
  MAX_ROBOTS_BYTES,
} from './fetch'
import { SafeUrlError } from '@/lib/security/safe-url'

afterEach(() => {
  safeFetchMock.mockReset()
})

function respond(body: BodyInit | null, init: ResponseInit & { url?: string } = {}) {
  const { url, ...responseInit } = init
  safeFetchMock.mockImplementation(async (input: string | URL) => ({
    response: new Response(body, responseInit),
    url: url ?? input.toString(),
    redirects: [],
  }))
}

describe('fetchRobotsTxt', () => {
  it('ok: returns the body with full metadata', async () => {
    respond('User-agent: *\nDisallow:', { status: 200 })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toEqual({
      ok: true,
      status: 200,
      text: 'User-agent: *\nDisallow:',
      finalUrl: 'https://example.com/robots.txt',
      failure: null,
      truncated: false,
    })
  })

  it('input contract: trailing slash, path, port, http all resolve to /robots.txt (Codex #7)', async () => {
    const requested: string[] = []
    safeFetchMock.mockImplementation(async (input: string | URL) => {
      requested.push(input.toString())
      return { response: new Response('ok', { status: 200 }), url: input.toString(), redirects: [] }
    })
    await fetchRobotsTxt('https://example.com/')
    await fetchRobotsTxt('https://example.com/deep/path')
    await fetchRobotsTxt('https://example.com:8443')
    await fetchRobotsTxt('http://example.com')
    expect(requested).toEqual([
      'https://example.com/robots.txt',
      'https://example.com/robots.txt',
      'https://example.com:8443/robots.txt',
      'http://example.com/robots.txt',
    ])
  })

  it('sends the browser-shaped UA', async () => {
    respond('ok', { status: 200 })
    await fetchRobotsTxt('https://example.com')
    const [, init] = safeFetchMock.mock.calls[0] as [unknown, RequestInit]
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(SEO_FETCH_USER_AGENT)
  })

  it('http-error: carries status + finalUrl, cancels the body (Codex #3/#9)', async () => {
    let cancelled = false
    const stream = new ReadableStream({ cancel() { cancelled = true } })
    safeFetchMock.mockImplementation(async () => ({
      response: new Response(stream, { status: 404 }),
      url: 'https://example.com/robots.txt',
      redirects: [],
    }))
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toEqual({
      ok: false, status: 404, text: null,
      finalUrl: 'https://example.com/robots.txt',
      failure: 'http-error', truncated: false,
    })
    expect(cancelled).toBe(true)
  })

  it('too-large: truncated body is never returned (Codex #9)', async () => {
    respond('x'.repeat(MAX_ROBOTS_BYTES + 1), { status: 200 })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toMatchObject({ ok: false, status: 200, text: null, failure: 'too-large', truncated: true })
  })

  it.each([
    ['policy', 'unsafe-url'],
    ['dns', 'dns'],
    ['redirect', 'redirect'],
    ['invalid-response', 'invalid-response'],
  ] as const)('SafeUrlError reason %s → failure %s with null metadata', async (reason, failure) => {
    safeFetchMock.mockImplementation(async () => { throw new SafeUrlError('boom', reason) })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toEqual({ ok: false, status: null, text: null, finalUrl: null, failure, truncated: false })
  })

  it('timeout: TimeoutError → failure timeout', async () => {
    safeFetchMock.mockImplementation(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toMatchObject({ ok: false, status: null, finalUrl: null, failure: 'timeout' })
  })

  it('network: anything else thrown → failure network', async () => {
    safeFetchMock.mockImplementation(async () => { throw new Error('ECONNRESET') })
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toMatchObject({ ok: false, status: null, finalUrl: null, failure: 'network' })
  })

  it('body-read failure AFTER acquisition retains status + finalUrl (Codex plan #2)', async () => {
    const stream = new ReadableStream({ pull() { throw new Error('stream reset') } })
    safeFetchMock.mockImplementation(async () => ({
      response: new Response(stream, { status: 200 }),
      url: 'https://example.com/robots.txt',
      redirects: [],
    }))
    const r = await fetchRobotsTxt('https://example.com')
    expect(r).toMatchObject({
      ok: false, status: 200, finalUrl: 'https://example.com/robots.txt', failure: 'network',
    })
  })

  it('invalid baseUrl → unsafe-url without a network call', async () => {
    const r = await fetchRobotsTxt('not a url')
    expect(r).toMatchObject({ ok: false, failure: 'unsafe-url' })
    expect(safeFetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchSitemapXml', () => {
  it('ok: returns XML', async () => {
    respond('<urlset><url><loc>https://x.com/a</loc></url></urlset>', {
      status: 200, headers: { 'content-type': 'application/xml' },
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true, status: 200, text: expect.stringContaining('<urlset>') })
  })

  it('not-xml: HTML content-type is rejected with metadata, body cancelled (Codex #3/#9)', async () => {
    let cancelled = false
    const stream = new ReadableStream({ cancel() { cancelled = true } })
    safeFetchMock.mockImplementation(async () => ({
      response: new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }),
      url: 'https://example.com/sitemap.xml',
      redirects: [],
    }))
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toEqual({
      ok: false, status: 200, text: null,
      finalUrl: 'https://example.com/sitemap.xml',
      failure: 'not-xml', truncated: false,
    })
    expect(cancelled).toBe(true)
  })

  it('gz: gunzips a .gz URL', async () => {
    const gz = gzipSync('<urlset><url><loc>https://x.com/a</loc></url></urlset>')
    respond(new Uint8Array(gz), { status: 200, url: 'https://example.com/sitemap.xml.gz' })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml.gz')
    expect(r).toMatchObject({ ok: true, text: expect.stringContaining('https://x.com/a') })
  })

  it('gz: corrupt gzip → invalid-response with status/finalUrl retained', async () => {
    respond(new Uint8Array([1, 2, 3, 4]), { status: 200, url: 'https://example.com/sitemap.xml.gz' })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml.gz')
    expect(r).toMatchObject({ ok: false, status: 200, failure: 'invalid-response', truncated: false })
  })

  it('gz: decompressed output over the cap → too-large (real zlib size branch, Codex plan #4)', async () => {
    // Highly compressible: tiny wire size, >5 MB decompressed → gunzipSync
    // throws (maxOutputLength) → too-large. Pins the runtime error-code path.
    const big = '<urlset>' + '<url><loc>https://x.com/a</loc></url>'.repeat(160_000) + '</urlset>'
    expect(big.length).toBeGreaterThan(5_000_000)
    respond(new Uint8Array(gzipSync(big)), { status: 200, url: 'https://example.com/sitemap.xml.gz' })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml.gz')
    expect(r).toMatchObject({ ok: false, status: 200, failure: 'too-large', truncated: true })
  })

  it('gz: compressed payload over the read cap → too-large (Codex plan #4)', async () => {
    const { randomBytes } = await import('node:crypto')
    respond(new Uint8Array(gzipSync(randomBytes(6_000_000))), {
      status: 200, url: 'https://example.com/sitemap.xml.gz',
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml.gz')
    expect(r).toMatchObject({ ok: false, status: 200, failure: 'too-large', truncated: true })
  })

  it('http-error carries status + finalUrl', async () => {
    respond('gone', { status: 410 })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: false, status: 410, failure: 'http-error' })
  })

  // Content-type edges inherited from the crawler — load-bearing for
  // "behavior-preserving" (Codex plan #5):
  it('accepts application/xhtml+xml (contains both html and xml)', async () => {
    respond('<urlset><url><loc>https://x.com/a</loc></url></urlset>', {
      status: 200, headers: { 'content-type': 'application/xhtml+xml' },
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true })
  })

  it('accepts a missing content-type', async () => {
    respond('<urlset><url><loc>https://x.com/a</loc></url></urlset>', { status: 200 })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true })
  })

  it('accepts text/plain', async () => {
    respond('<urlset><url><loc>https://x.com/a</loc></url></urlset>', {
      status: 200, headers: { 'content-type': 'text/plain' },
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true })
  })

  it('gzip content-type triggers decompression even without a .gz suffix', async () => {
    respond(new Uint8Array(gzipSync('<urlset><url><loc>https://x.com/a</loc></url></urlset>')), {
      status: 200, headers: { 'content-type': 'application/gzip' },
    })
    const r = await fetchSitemapXml('https://example.com/sitemap.xml')
    expect(r).toMatchObject({ ok: true, text: expect.stringContaining('https://x.com/a') })
  })
})

describe('collectSitemapPageUrls', () => {
  const same = () => true
  it('plain urlset: page locs, zero children', async () => {
    const r = await collectSitemapPageUrls(
      '<urlset><url><loc>https://x.com/a</loc></url></urlset>', same, async () => null,
    )
    expect(r).toEqual({ urls: ['https://x.com/a'], childrenTotal: 0, childrenFailed: 0 })
  })

  it('index: fetches same-domain children and collects their pages', async () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap><sitemap><loc>https://other.com/b.xml</loc></sitemap></sitemapindex>'
    const fetched: string[] = []
    const r = await collectSitemapPageUrls(
      xml,
      (u) => u.startsWith('https://x.com'),
      async (u) => { fetched.push(u); return '<urlset><url><loc>https://x.com/p1</loc></url></urlset>' },
    )
    expect(fetched).toEqual(['https://x.com/a.xml'])   // cross-domain child filtered BEFORE fetch
    expect(r).toEqual({ urls: ['https://x.com/p1'], childrenTotal: 1, childrenFailed: 0 })
  })

  it('failed children are counted, not silent (Codex #4)', async () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap><sitemap><loc>https://x.com/b.xml</loc></sitemap></sitemapindex>'
    const r = await collectSitemapPageUrls(xml, same, async (u) =>
      u.endsWith('a.xml') ? '<urlset><url><loc>https://x.com/p1</loc></url></urlset>' : null,
    )
    expect(r).toEqual({ urls: ['https://x.com/p1'], childrenTotal: 2, childrenFailed: 1 })
  })

  it('an empty-string child body counts as failed, matching the crawler falsy check (Codex plan #3)', async () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap></sitemapindex>'
    const r = await collectSitemapPageUrls(xml, same, async () => '')
    expect(r).toEqual({ urls: [], childrenTotal: 1, childrenFailed: 1 })
  })

  it('nested index child yields no pages — one level only, frozen (Codex #5)', async () => {
    const xml = '<sitemapindex><sitemap><loc>https://x.com/nested.xml</loc></sitemap></sitemapindex>'
    const r = await collectSitemapPageUrls(xml, same, async () =>
      '<sitemapindex><sitemap><loc>https://x.com/deeper.xml</loc></sitemap></sitemapindex>',
    )
    expect(r).toEqual({ urls: [], childrenTotal: 1, childrenFailed: 0 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/seo-fetch/fetch.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/seo-fetch/fetch.ts`**

```ts
import 'server-only'
import {
  SafeUrlError,
  readResponseBytesWithLimit,
  readResponseTextWithLimit,
  safeFetch,
} from '@/lib/security/safe-url'
import { extractChildSitemapLocs, extractPageLocs, isSitemapIndex } from './sitemap-parse'

// Browser-shaped UA. CDN/WAF heuristics frequently 403 transparently bot
// user-agents like "ER-SEO-Tools/1.0", which causes silent sitemap discovery
// failures. Pretending to be Chrome matches what a manual fetch of the same
// URL looks like to those filters. (Moved from lib/ada-audit/sitemap-crawler.ts.)
export const SEO_FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const MAX_ROBOTS_BYTES = 500_000
export const MAX_SITEMAP_XML_BYTES = 5_000_000
const FETCH_TIMEOUT_MS = 15_000

export type SeoFetchFailure =
  | 'http-error'        // response arrived, response.ok false
  | 'not-xml'           // sitemap fetch got HTML content-type (login redirect / soft 404)
  | 'too-large'         // byte cap exceeded (truncated body is never returned)
  | 'unsafe-url'        // SafeUrlError reason 'policy' — SSRF guard rejected
  | 'dns'               // SafeUrlError reason 'dns' — hostname did not resolve
  | 'redirect'          // SafeUrlError reason 'redirect'
  | 'invalid-response'  // bad response shape (or corrupt gzip body)
  | 'timeout'           // AbortSignal.timeout fired
  | 'network'           // anything else thrown (TCP reset, TLS, ...)

// Discriminated union — impossible states are unrepresentable.
export type SeoFetchResult =
  | { ok: true; status: number; text: string; finalUrl: string; failure: null; truncated: false }
  | { ok: false; status: number | null; text: null; finalUrl: string | null; failure: SeoFetchFailure; truncated: boolean }

function classifyThrown(err: unknown): SeoFetchFailure {
  if (err instanceof SafeUrlError) {
    if (err.reason === 'dns') return 'dns'
    if (err.reason === 'redirect') return 'redirect'
    if (err.reason === 'invalid-response') return 'invalid-response'
    return 'unsafe-url'
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout'
  return 'network'
}

function thrownFailure(err: unknown): SeoFetchResult {
  return { ok: false, status: null, text: null, finalUrl: null, failure: classifyThrown(err), truncated: false }
}

async function cancelBody(response: Response): Promise<void> {
  try { await response.body?.cancel() } catch { /* already consumed/closed */ }
}

// Acquisition is split from body processing (Codex plan #2): a throw BEFORE a
// response exists yields null status/finalUrl; a throw while READING an
// acquired response retains the response's status + finalUrl.
async function acquire(
  url: string,
  accept?: string,
): Promise<{ response: Response; finalUrl: string } | SeoFetchResult> {
  try {
    const { response, url: finalUrl } = await safeFetch(url, {
      headers: accept
        ? { 'User-Agent': SEO_FETCH_USER_AGENT, Accept: accept }
        : { 'User-Agent': SEO_FETCH_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    return { response, finalUrl }
  } catch (err) {
    return thrownFailure(err)
  }
}

function isFailure(a: { response: Response; finalUrl: string } | SeoFetchResult): a is SeoFetchResult {
  return 'ok' in a
}

/**
 * GET robots.txt via safeFetch. Input contract: `new URL('/robots.txt', baseUrl)`
 * — accepts an origin with or without trailing slash; any path on baseUrl is
 * REPLACED, never appended. 15 s timeout, 500 KB cap.
 */
export async function fetchRobotsTxt(baseUrl: string): Promise<SeoFetchResult> {
  let target: string
  try {
    target = new URL('/robots.txt', baseUrl).toString()
  } catch {
    return { ok: false, status: null, text: null, finalUrl: null, failure: 'unsafe-url', truncated: false }
  }
  const acquired = await acquire(target)
  if (isFailure(acquired)) return acquired
  const { response, finalUrl } = acquired
  try {
    if (!response.ok) {
      await cancelBody(response)
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'http-error', truncated: false }
    }
    const { text, truncated } = await readResponseTextWithLimit(response, MAX_ROBOTS_BYTES)
    if (truncated) {
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'too-large', truncated: true }
    }
    return { ok: true, status: response.status, text, finalUrl, failure: null, truncated: false }
  } catch (err) {
    return { ok: false, status: response.status, text: null, finalUrl, failure: classifyThrown(err), truncated: false }
  }
}

/**
 * GET one sitemap document via safeFetch. Handles .gz (gunzip, capped),
 * rejects HTML content-types (login redirects, soft 404s), 5 MB cap.
 */
export async function fetchSitemapXml(url: string): Promise<SeoFetchResult> {
  const acquired = await acquire(url, 'text/xml,application/xml,*/*')
  if (isFailure(acquired)) return acquired
  const { response, finalUrl } = acquired
  try {
    if (!response.ok) {
      await cancelBody(response)
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'http-error', truncated: false }
    }
    const ct = response.headers.get('content-type') ?? ''
    // Reject HTML responses (login redirects, 404 pages served as 200, etc.).
    // NOTE application/xhtml+xml contains BOTH substrings and is accepted —
    // inherited crawler behavior, test-pinned (Codex plan #5).
    if (ct.includes('html') && !ct.includes('xml')) {
      await cancelBody(response)
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'not-xml', truncated: false }
    }

    // Handle gzip-compressed sitemaps
    if (finalUrl.endsWith('.gz') || ct.includes('gzip')) {
      const { bytes, truncated } = await readResponseBytesWithLimit(response, MAX_SITEMAP_XML_BYTES)
      if (truncated) {
        return { ok: false, status: response.status, text: null, finalUrl, failure: 'too-large', truncated: true }
      }
      let xml: string
      try {
        const { gunzipSync } = await import('node:zlib')
        xml = gunzipSync(Buffer.from(bytes), { maxOutputLength: MAX_SITEMAP_XML_BYTES }).toString('utf-8')
      } catch (err) {
        const tooLarge = (err as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE'
        return {
          ok: false, status: response.status, text: null, finalUrl,
          failure: tooLarge ? 'too-large' : 'invalid-response', truncated: tooLarge,
        }
      }
      if (xml.length > MAX_SITEMAP_XML_BYTES) {
        return { ok: false, status: response.status, text: null, finalUrl, failure: 'too-large', truncated: true }
      }
      return { ok: true, status: response.status, text: xml, finalUrl, failure: null, truncated: false }
    }

    const { text, truncated } = await readResponseTextWithLimit(response, MAX_SITEMAP_XML_BYTES)
    if (truncated) {
      return { ok: false, status: response.status, text: null, finalUrl, failure: 'too-large', truncated: true }
    }
    return { ok: true, status: response.status, text, finalUrl, failure: null, truncated: false }
  } catch (err) {
    return { ok: false, status: response.status, text: null, finalUrl, failure: classifyThrown(err), truncated: false }
  }
}

export interface CollectSitemapResult {
  urls: string[]
  /** Same-domain children found in a sitemapindex (0 for a plain urlset). */
  childrenTotal: number
  /** Children whose fetch returned null. */
  childrenFailed: number
}

/**
 * Given fetched sitemap XML: plain urlset → its page locs; sitemapindex →
 * fetch same-domain children via the injected fetcher (batches of 5, polite)
 * and collect their page locs. ONE level of index expansion only — a child
 * that is itself an index contributes no pages (frozen current behavior;
 * do not introduce recursion). The injected fetcher is where the ADA crawler
 * plugs in its direct→browser-fallback fetch; D4/D5 pass a direct fetch.
 */
export async function collectSitemapPageUrls(
  xml: string,
  isSameDomain: (url: string) => boolean,
  fetchXml: (url: string) => Promise<string | null>,
): Promise<CollectSitemapResult> {
  if (!isSitemapIndex(xml)) {
    return { urls: extractPageLocs(xml), childrenTotal: 0, childrenFailed: 0 }
  }

  const childUrls = extractChildSitemapLocs(xml).filter((u) => isSameDomain(u))
  const urls: string[] = []
  let childrenFailed = 0

  const BATCH = 5
  for (let i = 0; i < childUrls.length; i += BATCH) {
    const batch = childUrls.slice(i, i + BATCH)
    const childXmls = await Promise.all(batch.map((u) => fetchXml(u)))
    for (const childXml of childXmls) {
      // Falsy check on purpose: an empty-string body counts as a failed child,
      // matching the crawler's historical `if (!childXml) continue` (Codex plan #3).
      if (!childXml) {
        childrenFailed++
        continue
      }
      urls.push(...extractPageLocs(childXml))
    }
  }

  return { urls, childrenTotal: childUrls.length, childrenFailed }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/seo-fetch/fetch.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/seo-fetch/fetch.ts lib/seo-fetch/fetch.test.ts
git commit -m "feat(d3): lib/seo-fetch/fetch.ts server-only robots/sitemap fetch primitives over safeFetch"
```

---

### Task 6: Rewire `sitemap-crawler.ts` onto `lib/seo-fetch/` (behavior-preserving)

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts`, `lib/ada-audit/sitemap-crawler.test.ts`

**Interfaces:**
- Consumes: everything Task 5 produces, plus `isSitemapIndex`/`extractPageLocs`/`extractChildSitemapLocs` (Task 3).
- Produces: `discoverPages`/`discoverPagesWithDeps`/`fetchPageLinks` signatures and behavior UNCHANGED.

**The frozen gate:** the `discoverPages`/`discoverPagesWithDeps` behavioral describe blocks in `sitemap-crawler.test.ts` pass with ZERO edits. The `vi.mock('../security/safe-url')` seam keeps intercepting because vitest mocks by resolved module path — `@/lib/security/safe-url` (imported by `lib/seo-fetch/fetch.ts`) resolves to the same file. Verify this holds during Step 3; if it does not, STOP and re-plan (do not weaken assertions).

- [ ] **Step 1: Replace the test file's local helper copies with imports (Codex #6)**

In `lib/ada-audit/sitemap-crawler.test.ts`:
1. Delete the local `function extractLocs(...)` and `function isSitemapIndex(...)` copies (the "Copies of internal pure functions" block keeps `normaliseDomain`, `isSameDomain`, `dedupeUrls` — those stay crawler-private).
2. Add import: `import { extractPageLocs, extractChildSitemapLocs, isSitemapIndex } from '@/lib/seo-fetch/sitemap-parse'`.
3. In the `describe('extractLocs')` block: calls of the form `extractLocs(xml, urlLocPattern)` become `extractPageLocs(xml)`; calls with the sitemap pattern become `extractChildSitemapLocs(xml)`; delete the now-unused local pattern constants. **Every `expect(...)` value stays byte-identical.** Rename the describe to `'extractPageLocs / extractChildSitemapLocs (shared)'`.
4. The `describe('isSitemapIndex')` block now exercises the imported function — no edits inside it.

Run: `npx vitest run lib/ada-audit/sitemap-crawler.test.ts`
Expected: PASS (the shared helpers are behavior-identical).

- [ ] **Step 2: Delegate the crawler's fetch/parse internals**

In `lib/ada-audit/sitemap-crawler.ts`:

1. Imports — replace the `safe-url` import block's usage and add seo-fetch (keep `assertSafeHttpUrl`, `readResponseTextWithLimit`, `safeFetch` — still used by `fetchHtml`/`fetchPageLinks`):
```ts
import {
  fetchRobotsTxt,
  fetchSitemapXml as fetchSitemapXmlDirect,
  collectSitemapPageUrls,
  SEO_FETCH_USER_AGENT,
} from '@/lib/seo-fetch/fetch'
```
2. Delete the local `USER_AGENT`, `MAX_XML_BYTES`, `MAX_ROBOTS_BYTES` constants; replace the two remaining `USER_AGENT` references (in `fetchHtml`, `fetchPageLinks`) with `SEO_FETCH_USER_AGENT`. `MAX_HTML_BYTES` stays.
3. Delete `extractLocs`, `isSitemapIndex`, `fetchXml`, and `fetchRobotsRaw`'s body; delete `collectFromSitemap`. Replace with adapters preserving `''`/`null`-on-failure semantics:
```ts
/** Single robots.txt fetch — returns the raw body, or '' on any failure. */
async function fetchRobotsRaw(base: string): Promise<string> {
  const r = await fetchRobotsTxt(base)
  return r.ok ? r.text : ''
}

/**
 * Try direct fetch first, fall back to a Puppeteer-driven fetch when direct
 * fails (CDN/WAF blocking). The browser path is expensive (~1 s warmup, up
 * to 20 s navigation) but only fires when needed. A successful-but-EMPTY
 * direct body also falls back — historical `if (direct)` was falsy on ''
 * (Codex plan #1, blocker).
 */
async function fetchSitemapXml(url: string): Promise<string | null> {
  const direct = await fetchSitemapXmlDirect(url)
  if (direct.ok && direct.text.length > 0) return direct.text
  return await fetchSitemapViaBrowser(url)
}
```
4. In `resolveSeedsReal`, replace the `collectFromSitemap(xml, normDomain)` call:
```ts
    const collected = await collectSitemapPageUrls(
      xml,
      (u) => isSameDomain(u, normDomain),
      fetchSitemapXml,
    )
    if (collected.urls.length > 0) {
      allPageUrls = collected.urls
      break
    }
```
(The crawler ignores `childrenTotal`/`childrenFailed` — spec D7.)
5. `extractSitemapUrls` (the private `Sitemap:` regex scan) **stays untouched in this task** — the D6 behavior change is Task 7's isolated commit.

- [ ] **Step 3: Add the empty-direct-body fallback test + mock-seam canary (new tests only)**

Append to the `discoverPages` describe block (same harness as siblings):

```ts
  it('falls back to the browser fetch when direct sitemap fetch is 200 but EMPTY (Codex plan #1)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/robots.txt') {
        return new Response('Sitemap: https://example.com/sitemap.xml', {
          status: 200, headers: { 'content-type': 'text/plain' },
        })
      }
      if (url === 'https://example.com/sitemap.xml') {
        return new Response('', { status: 200, headers: { 'content-type': 'application/xml' } })
      }
      return new Response('not found', { status: 404 })
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      return { response, url: url.toString(), redirects: [] }
    })
    vi.mocked(fetchSitemapViaBrowser).mockResolvedValue(
      '<urlset><url><loc>https://example.com/page</loc></url></urlset>'
    )

    await expect(discoverPages('example.com')).resolves.toEqual({
      urls: ['https://example.com/page'],
      mode: 'sitemap',
      capped: false,
    })
    expect(fetchSitemapViaBrowser).toHaveBeenCalledWith('https://example.com/sitemap.xml')
  })

  it('mock-seam canary: delegated fetches still route through the safeFetch mock (Codex plan #7)', async () => {
    safeFetchMock.mockImplementation(async (url: string | URL) => ({
      response: new Response('not found', { status: 404 }),
      url: url.toString(),
      redirects: [],
    }))
    await discoverPages('example.com').catch(() => {})
    const requested = safeFetchMock.mock.calls.map((c) => String(c[0]))
    expect(requested).toContain('https://example.com/robots.txt')
  })
```

(Reset/clear the `fetchSitemapViaBrowser` mock per the file's existing `afterEach` conventions so these don't leak into sibling tests.)

- [ ] **Step 4: Run the frozen gate**

Run: `npx vitest run lib/ada-audit/sitemap-crawler.test.ts && npx tsc --noEmit`
Expected: PASS — pre-existing behavioral assertions zero-edit, the two new tests green, tsc clean. If any pre-existing `discoverPages*` test fails, the refactor changed behavior — fix the crawler code, never the test.

- [ ] **Step 5: Run the wider affected suites**

Run: `npx vitest run lib/ada-audit lib/seo-fetch`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/sitemap-crawler.ts lib/ada-audit/sitemap-crawler.test.ts
git commit -m "refactor(d3): sitemap-crawler delegates robots/sitemap fetch+parse to lib/seo-fetch (behavior-preserving)"
```

---

### Task 7: D6 — crawler adopts comment-stripping `extractSitemapUrls` (isolated commit)

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts`, `lib/ada-audit/sitemap-crawler.test.ts`

**Interfaces:**
- Consumes: `extractSitemapUrls` from `@/lib/seo-fetch/robots-parse` (Task 2).

- [ ] **Step 1: Write the failing e2e discovery test (Codex #8)**

Append to the `discoverPages` describe block in `lib/ada-audit/sitemap-crawler.test.ts` (same harness as its sibling tests):

```ts
  it('D6: strips a trailing #-comment from a robots.txt Sitemap directive', async () => {
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url === 'https://example.com/robots.txt') {
        return new Response('Sitemap: https://example.com/from-robots.xml # primary sitemap', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }
      if (url === 'https://example.com/from-robots.xml') {
        return new Response('<urlset><url><loc>https://example.com/page</loc></url></urlset>', {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    safeFetchMock.mockImplementation(async (url: string | URL) => {
      const response = await fetchMock(url.toString())
      return { response, url: url.toString(), redirects: [] }
    })

    await expect(discoverPages('example.com')).resolves.toEqual({
      urls: ['https://example.com/page'],
      mode: 'sitemap',
      capped: false,
    })
    // The comment-polluted URL must never be requested
    expect(requestedUrls).toContain('https://example.com/from-robots.xml')
    expect(requestedUrls.every((u) => !u.includes('#') && !u.includes('%20primary'))).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ada-audit/sitemap-crawler.test.ts -t 'D6'`
Expected: FAIL — the current regex keeps `... # primary sitemap` in the URL, so the clean `from-robots.xml` is never fetched (discovery falls through to `/sitemap.xml` → 404 → shallow crawl → different result).

- [ ] **Step 3: Switch the crawler to the shared extractor**

In `lib/ada-audit/sitemap-crawler.ts`: delete the private `extractSitemapUrls` function and import the shared one:
```ts
import { extractSitemapUrls } from '@/lib/seo-fetch/robots-parse'
```
(No call-site changes — same name, same signature.)

- [ ] **Step 4: Run the full crawler suite**

Run: `npx vitest run lib/ada-audit/sitemap-crawler.test.ts`
Expected: PASS — new D6 test green, every pre-existing test untouched and green.

- [ ] **Step 5: Commit (D6 isolated — spec §3 D6)**

```bash
git add lib/ada-audit/sitemap-crawler.ts lib/ada-audit/sitemap-crawler.test.ts
git commit -m "fix(d3): D6 sitemap directive extraction strips #-comments (shared extractor; latent trailing-comment bug)"
```

---

### Task 8: Sweep, docs, full gates

**Files:**
- Modify: `CLAUDE.md` (Key files section)

- [ ] **Step 1: Reference sweep**

```bash
rg -n "lib/validators|robots\.validator|sitemap\.validator|seo/robots-rules|robots-rules'" app components lib middleware.ts --glob '!*.md'
```
Expected: zero hits. (Docs/archive mentions are fine and stay.)

```bash
rg -n "from '@/lib/seo-fetch/fetch'" app components --glob '*.tsx' | rg -v "server"
```
Expected: zero hits — no client component imports the server-only module.

- [ ] **Step 2: Add the CLAUDE.md Key files entry**

Add one bullet to `## Key files` (after the `lib/sales/` area, before `lib/handoff/`):

```markdown
- `lib/seo-fetch/` — D3 shared robots/sitemap layer, ONE home ending the 3-robots-parsers/2-sitemap-parsers drift: `robots-parse.ts` (client-safe rich validator parser: `parseRobotsTxt` 23 issue types/AI-bot audit/`testUrlAgainstRobots`, + shared comment-stripping `extractSitemapUrls`), `robots-match.ts` (client-safe MINIMAL crawl-frontier matcher `parseRobots`/`isAllowed` — star-group-only, $-aware; intentionally distinct from the validator matcher, never unify), `sitemap-parse.ts` (client-safe `parseSitemapXml` validation + crawl helpers `isSitemapIndex`/`extractPageLocs`/`extractChildSitemapLocs`), `fetch.ts` (server-only primitives over `safeFetch` — NEVER a raw fetch: `fetchRobotsTxt` (`new URL('/robots.txt', base)` contract), `fetchSitemapXml` (gzip, 5 MB cap, HTML-content-type reject), `collectSitemapPageUrls` (ONE-level index expansion frozen, injected fetcher = crawler's browser fallback, `childrenTotal/childrenFailed` diagnostics); discriminated-union `SeoFetchResult` with failure taxonomy backed by `SafeUrlError.reason` ('policy'|'dns'|'redirect'|'invalid-response', additive)). Consumers: robots-validator page (client-side parse), `sitemap-crawler.ts` (adapters preserve ''/null-on-failure), future D4/D5 checks. D6 micro-delta: `Sitemap:` extraction strips #-comments
```

- [ ] **Step 3: Full gates**

```bash
npm run lint && npm test && npm run build
```
Expected: all green. Record test counts.

- [ ] **Step 4: Smoke (ADA pipeline touched)**

```bash
export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run smoke
```
Expected: PASS (login → SF upload → parse → report → single-page ADA audit → complete).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(d3): CLAUDE.md key-files entry for lib/seo-fetch"
```

---

## Ship checklist (after Task 8, per change-control rule 1)

1. Push branch, open PR (`gh pr create`), body notes: behavior-preserving except D6 (own commit), frozen-gate evidence (crawler behavioral tests zero-edit), smoke green.
2. Merge when gate-green (re-run gates if merging in a later session).
3. Deploy: `ssh seo@144.126.213.242 "~/deploy.sh"`; post-deploy verify: `/api/health` ok, then prod robots-validator page fetch-and-parse of a real client robots.txt + sitemap (identical issue output), and one site-audit discovery on an existing client domain completes with a sane page count.
4. Docs ritual in the same commit: tracker D3 `[x]` + dated status-log line + handoff rewrite; `git mv` spec+plan to `docs/superpowers/archive/`.
