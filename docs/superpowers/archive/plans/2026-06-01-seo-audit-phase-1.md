# SEO Audit Overhaul — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SEO Audit tool worth opening — a complete-but-compact Claude payload, a one-click "Copy for Claude" action, "Suggested priorities," a severity summary replacing the health score, the title/H1 bug fixed, and an upload checklist — with **no schema migration**.

**Architecture:** All new structures (`UrlRegistry`, `PageIndexEntry`, complete `affectedUrlRefs`) live in the aggregation layer and the export payload only; persistence is deferred to Phase 3. The InternalParser emits a per-URL index through the existing `addParserResult` path; the aggregator builds the registry + complete issue→URL membership and embeds them in `buildTechnicalAuditExport()`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, Vitest (tests live beside source, e.g. `priority.service.test.ts`), Prisma+SQLite (untouched this phase).

**Spec:** `docs/superpowers/specs/2026-06-01-seo-audit-overhaul-design.md` (Phase 1, §5a, D6/D8/D9).

**Run all tests with:** `npx vitest run <path>` · **Typecheck:** `npx tsc --noEmit` · **Build:** `npm run build`

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `lib/types/index.ts` | Add `UrlRef`, `UrlRegistry`, `PageIndexEntry`, `SupplementalData`; extend `Issue` + metadata | 1 |
| `lib/services/url-normalize.ts` (+ test) | Conservative URL normalization rules (§5a) | 2 |
| `lib/services/url-registry.ts` (+ test) | Build registry, intern URLs → `UrlRef`, rehydrate ref → absolute URL | 3 |
| `lib/parsers/internal.parser.ts` | `parse()` also emits `per_url_index: PageIndexEntry[]` | 4 |
| `lib/services/issue-membership.ts` (+ test) | Derive complete `affectedUrlRefs` per issue from page index + parser URL lists | 5 |
| `lib/services/aggregator.service.ts` | Build registry + membership; fix optimization_gaps join; stop writing health_score | 5,6,7 |
| `lib/parsers/claude-export-builder.ts` (+ test) | Embed `url_registry` + `affectedUrlRefs` + `supplemental_data`; drop `health_score` | 7,8 |
| `components/seo-parser/MetricsBar.tsx` | Remove health-score tile (severity summary remains) | 7 |
| `components/seo-parser/CopyToClipboard.tsx` | Copy trimmed export + invocation block; rename "Copy for Claude" | 9 |
| `components/seo-parser/ExportButtons.tsx` | Collapse JSON/Summary/Markdown into an "Export ▾" menu | 9 |
| `components/seo-parser/SuggestedPriorities.tsx` (new) | Render `getPrioritySummary()` top priorities + quick wins | 10 |
| `components/seo-parser/ResultsView.tsx` | Insert SuggestedPriorities; drop health-score prop | 7,10 |
| `components/seo-parser/UploadChecklist.tsx` (new) + `app/seo-parser/page.tsx` | "Which files to upload" + post-parse completeness | 11 |

---

## Task 1: Core types (UrlRegistry, PageIndexEntry, refs, supplemental_data)

**Files:**
- Modify: `lib/types/index.ts` (Issue at line 3; metadata at ~187; add new interfaces near top)

- [ ] **Step 1: Add the new types**

In `lib/types/index.ts`, add (place above `Issue`):

```typescript
export type UrlKind = 'page' | 'resource' | 'external' | 'redirect-target' | 'sitemap' | 'hreflang';

export interface UrlRegistryEntry {
  id: number;          // UrlRef target = index in UrlRegistry.urls
  kind: UrlKind;
  hostId: number;      // index into UrlRegistry.hosts
  scheme: string;      // per-entry scheme (external links may differ from sessionOrigin)
  path: string;        // path (+ optional query); host omitted only for sessionOrigin host
  query?: string;
  originalUrl?: string; // fallback when canonical reconstruction is unsafe
}

export interface UrlRegistry {
  sessionOrigin: { scheme: string; host: string };
  hosts: string[];
  urls: UrlRegistryEntry[];
}

export type UrlRef = number; // index into UrlRegistry.urls

export interface PageIndexEntry {
  ref: UrlRef;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  indexable: boolean;
  issueTypes: string[];
}

// Optional, all fields nullable — DataForSEO / Node-check outputs hang here (built later)
export interface SupplementalData {
  dataforseo?: Record<string, unknown>;
  liveChecks?: Record<string, unknown>;
}
```

- [ ] **Step 2: Extend `Issue` with complete refs (display `urls` kept for back-compat)**

Modify the `Issue` interface (line 3) to add one optional field:

```typescript
export interface Issue {
  type: string;
  severity: 'critical' | 'warning' | 'notice';
  count: number;
  description: string;
  urls?: string[];                 // display/sample/back-compat ONLY
  affectedUrlRefs?: UrlRef[];      // best-available set (see flags below)
  affectedUrlRefsComplete?: boolean;  // true only when the full affected set is known
  affectedUrlSource?: 'derived-page-index' | 'parser-complete' | 'parser-sample';
  groups?: Array<{ title?: string; h1?: string; meta_description?: string; count: number; urls?: string[] }>;
  source?: string;
  threshold?: string;
}
```

- [ ] **Step 3: Add `url_registry` + `page_index` + `supplemental_data` to `AggregatedResult`**

Find the `AggregatedResult` interface and add three optional fields:

```typescript
  url_registry?: UrlRegistry;
  page_index?: PageIndexEntry[];
  supplemental_data?: SupplementalData;
```

Leave `metadata.health_score?` in the type (sessions still in the DB carry it) but it will stop being written (Task 7).

- [ ] **Step 3b: Extend `InternalParserResult`**

`InternalParser.parse()` returns a typed `InternalParserResult` (in `lib/types/index.ts`). Add the per-URL index field so Task 4 typechecks:

```typescript
  per_url_index?: PageIndexEntry['_raw'][]; // see note
```

Since `PageIndexEntry` is the *aggregated* shape (carries a `ref`), the parser emits the **pre-ref raw rows**. Define a separate raw type and use it in both `InternalParserResult` and `parsePerUrlForPillar()`'s return:

```typescript
export interface PerUrlRecord {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  indexable: boolean;
}
```

Then `InternalParserResult` gains `per_url_index?: PerUrlRecord[];` (replace the `PageIndexEntry['_raw']` placeholder above with `PerUrlRecord[]`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (only additive optional fields).

- [ ] **Step 5: Commit**

```bash
git add lib/types/index.ts
git commit -m "feat(seo): add UrlRegistry/PageIndexEntry/affectedUrlRefs types"
```

---

## Task 2: URL normalization utility

**Files:**
- Create: `lib/services/url-normalize.ts`
- Test: `lib/services/url-normalize.test.ts`

Normalization rules (spec §5a): preserve query by default; drop fragment; lowercase host only (never path); do NOT strip trailing slash; strip UTM params but keep `originalUrl` traceable.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeUrl } from './url-normalize';

describe('normalizeUrl', () => {
  it('lowercases host but not path', () => {
    const r = normalizeUrl('HTTPS://WWW.Example.EDU/Blog/Post');
    expect(r.host).toBe('www.example.edu');
    expect(r.path).toBe('/Blog/Post');
    expect(r.scheme).toBe('https');
  });
  it('drops the fragment', () => {
    expect(normalizeUrl('https://x.edu/a#section').path).toBe('/a');
  });
  it('preserves non-UTM query but strips UTM params', () => {
    const r = normalizeUrl('https://x.edu/s?q=1&utm_source=nl&utm_medium=email');
    expect(r.query).toBe('q=1');
    expect(r.originalUrl).toContain('utm_source');
  });
  it('keeps query undefined when none present', () => {
    expect(normalizeUrl('https://x.edu/a').query).toBeUndefined();
  });
  it('does not strip trailing slash', () => {
    expect(normalizeUrl('https://x.edu/a/').path).toBe('/a/');
  });
  it('falls back to originalUrl for unparseable input', () => {
    const r = normalizeUrl('not a url');
    expect(r.originalUrl).toBe('not a url');
    expect(r.host).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/services/url-normalize.test.ts`
Expected: FAIL ("normalizeUrl is not a function").

- [ ] **Step 3: Implement**

```typescript
export interface NormalizedUrl {
  scheme: string;
  host: string;       // lowercased; '' if unparseable
  path: string;       // case preserved; '' if unparseable
  query?: string;     // non-UTM query, original order; undefined if none
  originalUrl?: string; // present when UTM stripped or parse failed
}

const UTM_RE = /^utm_/i;

export function normalizeUrl(input: string): NormalizedUrl {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { scheme: '', host: '', path: '', originalUrl: input };
  }
  const kept: string[] = [];
  let strippedAny = false;
  for (const [k, v] of u.searchParams.entries()) {
    if (UTM_RE.test(k)) { strippedAny = true; continue; }
    kept.push(`${k}=${v}`);
  }
  const query = kept.length ? kept.join('&') : undefined;
  return {
    scheme: u.protocol.replace(/:$/, '').toLowerCase(),
    host: u.host.toLowerCase(),
    path: u.pathname,                // case preserved, trailing slash preserved
    query,
    originalUrl: strippedAny ? input : undefined,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/services/url-normalize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/url-normalize.ts lib/services/url-normalize.test.ts
git commit -m "feat(seo): conservative URL normalization util"
```

---

## Task 3: UrlRegistry builder + rehydration

**Files:**
- Create: `lib/services/url-registry.ts`
- Test: `lib/services/url-registry.test.ts`

`UrlRegistryBuilder` interns URLs into refs (dedup by canonical key), tracks hosts, and rehydrates a ref back to an absolute URL. Internal same-host pages store path only; other hosts resolve via `hostId`.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { UrlRegistryBuilder, rehydrate } from './url-registry';

describe('UrlRegistryBuilder', () => {
  it('interns same URL to the same ref', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'www.x.edu' });
    const a = b.intern('https://www.x.edu/a', 'page');
    const a2 = b.intern('https://www.x.edu/a', 'page');
    expect(a).toBe(a2);
    expect(b.build().urls).toHaveLength(1);
  });
  it('treats subdomains as distinct hosts', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'www.x.edu' });
    b.intern('https://www.x.edu/a', 'page');
    b.intern('https://apply.x.edu/b', 'external');
    expect(b.build().hosts).toContain('apply.x.edu');
  });
  it('rehydrates a ref to an absolute url', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'www.x.edu' });
    const ref = b.intern('https://www.x.edu/a?q=1', 'page');
    const reg = b.build();
    expect(rehydrate(reg, ref)).toBe('https://www.x.edu/a?q=1');
  });
  it('rehydrates external host correctly', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'www.x.edu' });
    const ref = b.intern('http://other.com/z', 'external');
    expect(rehydrate(b.build(), ref)).toBe('http://other.com/z');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/services/url-registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { UrlRegistry, UrlRegistryEntry, UrlKind, UrlRef } from '../types';
import { normalizeUrl } from './url-normalize';

export class UrlRegistryBuilder {
  private origin: { scheme: string; host: string };
  private hosts: string[] = [];
  private urls: UrlRegistryEntry[] = [];
  private keyToId = new Map<string, number>();

  constructor(origin: { scheme: string; host: string }) {
    this.origin = { scheme: origin.scheme.toLowerCase(), host: origin.host.toLowerCase() };
    this.hostId(this.origin.host);
  }

  private hostId(host: string): number {
    let i = this.hosts.indexOf(host);
    if (i === -1) { i = this.hosts.length; this.hosts.push(host); }
    return i;
  }

  intern(rawUrl: string, kind: UrlKind): UrlRef {
    const n = normalizeUrl(rawUrl);
    const host = n.host || this.origin.host;
    const scheme = n.scheme || this.origin.scheme;
    const key = `${scheme}://${host}${n.path}${n.query ? '?' + n.query : ''}|${n.originalUrl ?? ''}`;
    const existing = this.keyToId.get(key);
    if (existing !== undefined) return existing;
    const id = this.urls.length;
    this.urls.push({
      id, kind, scheme,
      hostId: this.hostId(host),
      path: n.path,
      query: n.query,
      originalUrl: n.host ? n.originalUrl : rawUrl, // keep raw if unparseable
    });
    this.keyToId.set(key, id);
    return id;
  }

  build(): UrlRegistry {
    return { sessionOrigin: this.origin, hosts: this.hosts, urls: this.urls };
  }
}

export function rehydrate(reg: UrlRegistry, ref: UrlRef): string {
  const e = reg.urls[ref];
  if (!e) return '';
  if (e.originalUrl && e.path === '') return e.originalUrl;
  const host = reg.hosts[e.hostId] ?? reg.sessionOrigin.host;
  const scheme = e.scheme || reg.sessionOrigin.scheme;
  const q = e.query ? `?${e.query}` : '';
  return `${scheme}://${host}${e.path}${q}`;
}
```

> **Kind inference:** callers must pass the right `UrlKind` — do NOT intern every issue URL as `'page'` (Fix #7). The membership builder (Task 5) infers kind from the issue type: resource issues (`broken_images`, `large_js_files`, `broken_css`, `broken_pdfs`) → `'resource'`; `broken_external_links` → `'external'`; redirect targets → `'redirect-target'`; sitemap issues → `'sitemap'`; hreflang → `'hreflang'`; everything else → `'page'`. Add a small `kindForIssueType(type: string): UrlKind` map in `issue-membership.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/services/url-registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/url-registry.ts lib/services/url-registry.test.ts
git commit -m "feat(seo): UrlRegistry builder + rehydration"
```

---

## Task 4: InternalParser emits a per-URL index

**Files:**
- Modify: `lib/parsers/internal.parser.ts` (already has `parsePerUrlForPillar()` at line 619; add a `parse()` field)
- Test: `lib/parsers/internal.parser.test.ts` (add a case)

The aggregator only sees `parser.parse()` output (via `addParserResult`). Surface the per-URL records there so the aggregator can build the page index.

- [ ] **Step 1: Write failing test**

Add to `lib/parsers/internal.parser.test.ts` (follow the file's existing fixture/setup style):

```typescript
it('parse() includes a per_url_index with title/h1 per url', () => {
  const csv = [
    'Address,Title 1,H1-1,Meta Description 1,Word Count,Crawl Depth,Indexability',
    'https://x.edu/a,Home,Welcome,Desc A,800,0,Indexable',
    'https://x.edu/b,About,About Us,Desc B,300,1,Indexable',
  ].join('\n');
  const parser = new InternalParser(csv);   // BaseParser ctor takes CSV content only
  const out = parser.parse() as Record<string, unknown>;
  const idx = out.per_url_index as Array<{ url: string; title: string | null }>;
  expect(idx).toHaveLength(2);
  expect(idx.find(r => r.url === 'https://x.edu/a')?.title).toBe('Home');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/parsers/internal.parser.test.ts -t per_url_index`
Expected: FAIL (`per_url_index` undefined).

- [ ] **Step 3: Implement**

In `internal.parser.ts`, inside `parse()`, before the final `return`, add:

```typescript
const perUrlIndex = this.parsePerUrlForPillar(); // reuse existing extraction
```

and include it in the returned object:

```typescript
      per_url_index: perUrlIndex,
```

(`parsePerUrlForPillar()` already returns `{ url, title, h1, metaDescription, wordCount, crawlDepth, indexable, ... }[]` — exactly what the page-index builder needs.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/parsers/internal.parser.test.ts -t per_url_index`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/internal.parser.ts lib/parsers/internal.parser.test.ts
git commit -m "feat(seo): InternalParser.parse() emits per_url_index"
```

---

## Task 5: Aggregator builds the registry + complete issue membership

**Files:**
- Create: `lib/services/issue-membership.ts`
- Test: `lib/services/issue-membership.test.ts`
- Modify: `lib/services/aggregator.service.ts` (`aggregate()` ~line 224; uses `this.parsedData.internal`)

The membership builder converts each issue's `urls?: string[]` (and the page index) into complete `affectedUrlRefs` via the registry. Where parsers capped `urls`, the page index supplies the rest by `issueTypes` membership.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildAffectedRefs } from './issue-membership';
import { UrlRegistryBuilder } from './url-registry';
import { PageIndexEntry, Issue } from '../types';

describe('buildAffectedRefs', () => {
  it('interns an issue url list with the issue-type-appropriate kind', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const issue: Issue = { type: 'missing_title', severity: 'critical', count: 2, description: '', urls: ['https://x.edu/a', 'https://x.edu/b'] };
    const { refs, complete, source } = buildAffectedRefs(issue, [], b);
    expect(refs).toHaveLength(2);
    expect(complete).toBe(true);            // missing_title is fully derivable
    expect(source).toBe('derived-page-index');
  });
  it('recovers capped URLs from independently-derived page-index issue types', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    // issueTypes here are derived from page attributes (Task 5 wiring), NOT from issue.urls
    const pageIndex: PageIndexEntry[] = [
      { ref: b.intern('https://x.edu/a', 'page'), title: null, h1: '', metaDescription: '', wordCount: 0, crawlDepth: 0, indexable: true, issueTypes: ['missing_title'] },
      { ref: b.intern('https://x.edu/c', 'page'), title: null, h1: '', metaDescription: '', wordCount: 0, crawlDepth: 0, indexable: true, issueTypes: ['missing_title'] },
    ];
    const issue: Issue = { type: 'missing_title', severity: 'critical', count: 2, description: '', urls: ['https://x.edu/a'] }; // capped sample
    const { refs } = buildAffectedRefs(issue, pageIndex, b);
    expect(new Set(refs).size).toBe(2); // /a (sample) + /c (recovered), deduped
  });
  it('marks non-derivable issue types as parser-sample', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const issue: Issue = { type: 'broken_external_links', severity: 'warning', count: 1, description: '', urls: ['http://dead.example.com/x'] };
    const { complete, source } = buildAffectedRefs(issue, [], b);
    expect(complete).toBe(false);
    expect(source).toBe('parser-sample');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/services/issue-membership.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { Issue, PageIndexEntry, UrlRef, UrlKind, PerUrlRecord } from '../types';
import { UrlRegistryBuilder } from './url-registry';

// Issue types we can fully re-derive from the internal per-URL index (so refs are COMPLETE).
const DERIVABLE_COMPLETE = new Set([
  'missing_title', 'missing_h1', 'missing_meta_description', 'thin_content',
]);

export function kindForIssueType(type: string): UrlKind {
  if (['broken_images', 'large_images', 'very_large_images', 'broken_js', 'large_js_files', 'broken_css', 'large_css_files', 'broken_pdfs', 'large_pdfs'].includes(type)) return 'resource';
  if (type === 'broken_external_links') return 'external';
  if (['redirect_chains', 'long_redirect_chains', 'temporary_redirects'].includes(type)) return 'redirect-target';
  if (['sitemap_errors', 'sitemap_redirects', 'non_indexable_in_sitemap'].includes(type)) return 'sitemap';
  if (type.startsWith('missing_hreflang') || type === 'broken_hreflang_targets') return 'hreflang';
  return 'page';
}

// Independent derivation from the per-URL record — does NOT depend on capped issue.urls.
export function deriveIssueTypesForPage(r: PerUrlRecord): string[] {
  const t: string[] = [];
  if (r.title == null || r.title === '') t.push('missing_title');
  if (r.h1 == null || r.h1 === '') t.push('missing_h1');
  if (r.metaDescription == null || r.metaDescription === '') t.push('missing_meta_description');
  if (r.wordCount != null && r.wordCount < 300) t.push('thin_content');
  return t;
}

export function buildAffectedRefs(
  issue: Issue,
  pageIndex: PageIndexEntry[],
  builder: UrlRegistryBuilder,
): { refs: UrlRef[]; complete: boolean; source: NonNullable<Issue['affectedUrlSource']> } {
  const kind = kindForIssueType(issue.type);
  const refs = new Set<UrlRef>();
  for (const u of issue.urls ?? []) refs.add(builder.intern(u, kind));
  // Add page-index entries whose INDEPENDENTLY-derived issue types include this type.
  for (const p of pageIndex) {
    if (p.issueTypes.includes(issue.type)) refs.add(p.ref);
  }
  const complete = DERIVABLE_COMPLETE.has(issue.type);
  return {
    refs: [...refs],
    complete,
    source: complete ? 'derived-page-index' : 'parser-sample',
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/services/issue-membership.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into the aggregator**

At module scope in `aggregator.service.ts` (top-level helper, NOT a class method — it's a free function):

```typescript
import { UrlRegistryBuilder } from './url-registry';
import { buildAffectedRefs, deriveIssueTypesForPage } from './issue-membership';
import { PageIndexEntry, PerUrlRecord } from '../types';

function deriveOrigin(sampleUrl: string | undefined, siteName?: string): { scheme: string; host: string } {
  const src = sampleUrl ?? (siteName ? `https://${siteName}` : 'https://localhost');
  try { const u = new URL(src); return { scheme: u.protocol.replace(/:$/, ''), host: u.host }; }
  catch { return { scheme: 'https', host: siteName ?? 'localhost' }; }
}
```

In `aggregate()`, after issues are built and before returning `result`:

```typescript
const internal = this.parsedData.internal as Record<string, unknown> | undefined;
const rawPerUrl = (internal?.per_url_index as PerUrlRecord[]) ?? [];

const origin = deriveOrigin(rawPerUrl[0]?.url, result.metadata.site_name);
const builder = new UrlRegistryBuilder(origin);

// Build page index; derive issue types INDEPENDENTLY from page attributes (NOT from capped issue.urls).
const pageIndex: PageIndexEntry[] = rawPerUrl.map((p) => ({
  ref: builder.intern(p.url, 'page'),
  title: p.title, h1: p.h1, metaDescription: p.metaDescription,
  wordCount: p.wordCount, crawlDepth: p.crawlDepth, indexable: p.indexable,
  issueTypes: deriveIssueTypesForPage(p),   // <-- independent derivation
}));

// Complete affectedUrlRefs + completeness flags per issue
for (const list of [result.issues.critical, result.issues.warnings, result.issues.notices]) {
  for (const issue of list) {
    const { refs, complete, source } = buildAffectedRefs(issue, pageIndex, builder);
    issue.affectedUrlRefs = refs;
    issue.affectedUrlRefsComplete = complete;
    issue.affectedUrlSource = source;
  }
}

result.page_index = pageIndex;
result.url_registry = builder.build();
```

- [ ] **Step 5b: Special-case `per_url_index` in `mergeParserData` (do NOT defer to P3)**

`mergeParserData` (aggregator.service.ts ~160-188) dedupes arrays with `existingList.includes(item)`, which compares object identity and therefore **fails to dedupe** `per_url_index` rows — two `internal_all`-type uploads would double the page index. Add an explicit, deterministic strategy keyed by normalized URL **before** the generic array branch:

```typescript
// inside mergeParserData, when key === 'per_url_index' and both sides are arrays:
if (key === 'per_url_index' && Array.isArray(existingVal) && Array.isArray(newVal)) {
  const byUrl = new Map<string, unknown>();
  for (const row of [...(existingVal as { url: string }[]), ...(newVal as { url: string }[])]) {
    byUrl.set(row.url, row); // latest wins, deterministic, no object-identity dedupe
  }
  return [...byUrl.values()];
}
```

- [ ] **Step 6: Run aggregator + full suite**

Run: `npx vitest run lib/services/ lib/parsers/` and `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/services/issue-membership.ts lib/services/issue-membership.test.ts lib/services/aggregator.service.ts
git commit -m "feat(seo): build UrlRegistry + complete issue affectedUrlRefs in aggregator"
```

---

## Task 6: Fix `optimization_gaps` title/H1 join

**Files:**
- Modify: `lib/services/aggregator.service.ts` (`computeKeywordSignals()` line 875; gap push at line 902)

- [ ] **Step 1: Write failing test**

Add `lib/services/aggregator.keyword-gaps.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AggregatorService } from './aggregator.service';

describe('optimization_gaps title/h1 join', () => {
  it('populates title/h1 from the internal per_url_index', () => {
    const agg = new AggregatorService();
    agg.addParserResult('internal', { per_url_index: [
      { url: 'https://x.edu/p', title: 'P Title', h1: 'P H1', metaDescription: null, wordCount: 100, crawlDepth: 1, indexable: true },
    ] }, 'internal_all.csv');
    agg.addParserResult('semrushorganicpositions', {
      total_ranking_keywords: 1,
      per_url_keyword_data: [{ url: 'https://x.edu/p', keywords: [{ keyword: 'k', position: 12, search_volume: 500 }] }],
    }, 'positions.csv');
    const result = agg.aggregate();
    const gap = result.keyword_signals?.optimization_gaps?.find(g => g.url === 'https://x.edu/p');
    expect(gap?.title).toBe('P Title');
    expect(gap?.h1).toBe('P H1');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/services/aggregator.keyword-gaps.test.ts`
Expected: FAIL (`title` is `''`).

- [ ] **Step 3: Implement the join**

In `computeKeywordSignals()`, build a URL→metadata map from the internal per-URL index and use it when pushing gaps. Replace the `title: '', h1: ''` block (lines ~901-905):

```typescript
const internal = this.parsedData.internal as Record<string, unknown> | undefined;
const perUrlIndex = (internal?.per_url_index as Array<{ url: string; title: string | null; h1: string | null }>) ?? [];
const metaByUrl = new Map(perUrlIndex.map((p) => [p.url, { title: p.title ?? '', h1: p.h1 ?? '' }]));

// ...inside the loop:
const meta = metaByUrl.get(url) ?? { title: '', h1: '' };
optimization_gaps.push({
  url,
  title: meta.title,
  h1: meta.h1,
  top_ranking_keywords: keywords,
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/services/aggregator.keyword-gaps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/aggregator.service.ts lib/services/aggregator.keyword-gaps.test.ts
git commit -m "fix(seo): join title/H1 into optimization_gaps from per_url_index"
```

---

## Task 7: Drop the health score (compute, UI, export)

**Files:**
- Modify: `lib/services/aggregator.service.ts` (line 230 `result.metadata.health_score = computeHealthScore(result);`)
- Modify: `components/seo-parser/MetricsBar.tsx` (remove Health Score tile + `healthScore` prop)
- Modify: `components/seo-parser/ResultsView.tsx` (drop `healthScore={...}` prop)
- Modify: `lib/parsers/claude-export-builder.ts` (exclude `health_score` from exported metadata)

- [ ] **Step 1: Stop computing health_score for new sessions**

In `aggregator.service.ts`, delete line 230 (`result.metadata.health_score = computeHealthScore(result);`) and its now-unused import of `computeHealthScore`. Leave `scoring.service.ts` file in place (deprecated; deletion is a later cleanup).

- [ ] **Step 2: Remove the Health Score tile from MetricsBar**

In `MetricsBar.tsx`: delete the `healthScore?` prop, the `healthColors` helper, and the `<Tile label="Health Score">` block. Change the grid to `lg:grid-cols-5`. Resulting tiles: Total URLs, Critical, Warnings, Notices, Indexable.

- [ ] **Step 3: Update BOTH consumers of MetricsBar**

`MetricsBar` is rendered in two places — removing the `healthScore` prop breaks the build unless both are updated in this task:
- `components/seo-parser/ResultsView.tsx` — remove the `healthScore={result.metadata?.health_score}` line.
- `app/share/[token]/page.tsx` — remove the `healthScore={...}` prop it passes to `MetricsBar`.

`grep -rn "healthScore" components app` and clear every `MetricsBar` call site.

- [ ] **Step 3b: Legacy tolerance for history/diff (no change required)**

`HistoryList`, `/api/parse/history`, and `diff.service` still read `metadata.health_score` from **old** sessions — that's intentional and fine (those rows carry it). New sessions simply won't have it; ensure those surfaces render gracefully when it's `undefined` (they already use optional access). Do not rip health-score out of history/diff in Phase 1.

- [ ] **Step 4: Exclude health_score from the Claude export**

In `claude-export-builder.ts`, where `metadata` is assigned to the export, strip `health_score`:

```typescript
const { health_score, ...metadataForClaude } = result.metadata;
// use metadataForClaude in the returned object's `metadata` field
```

- [ ] **Step 5: Update the export builder test**

In `claude-export-builder.test.ts`, add/adjust an assertion: `expect(exported.metadata).not.toHaveProperty('health_score');`

- [ ] **Step 6: Typecheck + tests + build**

Run: `npx tsc --noEmit && npx vitest run lib/parsers/claude-export-builder.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/services/aggregator.service.ts components/seo-parser/MetricsBar.tsx components/seo-parser/ResultsView.tsx lib/parsers/claude-export-builder.ts lib/parsers/claude-export-builder.test.ts
git commit -m "feat(seo): drop composite health score (compute, UI tile, export)"
```

---

## Task 8: Export carries url_registry + affectedUrlRefs + supplemental_data

**Files:**
- Modify: `lib/parsers/claude-export-builder.ts` (`TechnicalAuditExport` interface + `buildTechnicalAuditExport`)
- Test: `lib/parsers/claude-export-builder.test.ts`

- [ ] **Step 1: Write failing test**

Use the existing fixture in `claude-export-builder.test.ts` — it's named **`mockResult`** (not `makeMinimalResult`). Extend `mockResult` to include `url_registry`, `page_index`, and at least one issue carrying `affectedUrlRefs`.

```typescript
it('embeds url_registry, page_index and per-issue affectedUrlRefs', () => {
  const out = buildTechnicalAuditExport(mockResult);
  expect(out.url_registry).toBeDefined();
  expect(out.page_index).toBeDefined();
  expect(out.issues.critical[0].affectedUrlRefs).toBeDefined();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/parsers/claude-export-builder.test.ts -t affectedUrlRefs`
Expected: FAIL (`url_registry` undefined on export type).

- [ ] **Step 3: Implement**

Add to the `TechnicalAuditExport` interface:

```typescript
  url_registry?: UrlRegistry;
  page_index?: PageIndexEntry[];
  supplemental_data?: SupplementalData;
```

(import `UrlRegistry`, `PageIndexEntry`, `SupplementalData` from `@/lib/types`). In `buildTechnicalAuditExport`, pass them through:

```typescript
    url_registry: result.url_registry,
    page_index: result.page_index,
    supplemental_data: result.supplemental_data,
```

`issues` is already passed through verbatim, so `affectedUrlRefs` + completeness flags flow automatically. **Keep this module browser-safe** — it is imported by the client `CopyToClipboard` component (Task 9); use type-only imports and pure functions, no server-only code.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/parsers/claude-export-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/claude-export-builder.ts lib/parsers/claude-export-builder.test.ts
git commit -m "feat(seo): export embeds url_registry + supplemental_data passthrough"
```

---

## Task 9: "Copy for Claude" button + Export ▾ menu

**Files:**
- Modify: `components/seo-parser/CopyToClipboard.tsx`
- Modify: `components/seo-parser/ExportButtons.tsx`

- [ ] **Step 1: Make CopyToClipboard copy the trimmed payload + invocation block**

Replace the body of `handleCopy` and the label:

```typescript
import { buildTechnicalAuditExport } from '@/lib/parsers/claude-export-builder';
// ...
  const handleCopy = async () => {
    const payload = buildTechnicalAuditExport(result);
    const text =
      `Run the seo-audit-roadmap skill on the SEO audit payload below.\n` +
      `It contains complete affected-URL sets (compact refs in url_registry).\n\n` +
      '```json\n' + JSON.stringify(payload, null, 2) + '\n```';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Failed to copy to clipboard');
    }
  };
```

Change the button label from `Copy JSON` to `Copy for Claude` and give it the primary amber style (`bg-[#c07f2a] hover:bg-[#a86e22] text-white`) so it reads as the primary action.

- [ ] **Step 2: Collapse Export buttons into a dropdown**

In `ExportButtons.tsx`, replace the three inline `json/summary/markdown` buttons with a single "Export ▾" `<details>`/menu that contains those three options (keep `handleExport` logic). Remove the separate "Export Technical Audit for Claude" download button (the Copy-for-Claude button now covers the Claude path; the raw download stays available under the menu as "Technical Audit JSON" if desired). Keep `error` rendering.

```tsx
<details className="relative">
  <summary className="list-none px-4 py-2 bg-gray-200 dark:bg-navy-light text-gray-700 dark:text-white/70 rounded-lg text-sm font-medium cursor-pointer">Export ▾</summary>
  <div className="absolute z-10 mt-1 bg-white dark:bg-navy-card border border-gray-100 dark:border-navy-border rounded-lg shadow-sm p-1 min-w-[12rem]">
    {(['json','summary','markdown'] as Format[]).map((f) => (
      <button key={f} onClick={() => void handleExport(f)} disabled={loading !== null}
        className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-gray-50 dark:hover:bg-navy-light disabled:opacity-60">
        {{ json: 'Raw JSON', summary: 'Summary (.txt)', markdown: 'Markdown' }[f]}
      </button>
    ))}
  </div>
</details>
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/CopyToClipboard.tsx components/seo-parser/ExportButtons.tsx
git commit -m "feat(seo): primary Copy-for-Claude action + Export dropdown"
```

---

## Task 10: "Suggested priorities" block

**Files:**
- Create: `components/seo-parser/SuggestedPriorities.tsx`
- Modify: `components/seo-parser/ResultsView.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';
import React from 'react';
import { IssuesResult } from '@/lib/types';
import { getPrioritySummary, ScoredIssue } from '@/lib/services/priority.service';

function Row({ issue }: { issue: ScoredIssue }) {
  const sev = { critical: 'text-red-600', warning: 'text-orange-500', notice: 'text-blue-600' }[issue.severity];
  return (
    <li className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-navy-border last:border-0">
      <span className="text-sm text-[#1c2d4a] dark:text-white truncate">{issue.description || issue.type}</span>
      <span className="flex items-center gap-2 shrink-0">
        <span className={`text-xs font-semibold ${sev}`}>{issue.severity}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-white/60">{issue.effort} effort</span>
        <span className="text-xs text-gray-400">{issue.count}</span>
      </span>
    </li>
  );
}

export function SuggestedPriorities({ issues }: { issues: IssuesResult }) {
  const summary = getPrioritySummary(issues);
  if (summary.total_issues === 0) return null;
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">Suggested Priorities</h3>
        <span className="text-xs text-gray-400 dark:text-white/40">Heuristic ranking of issue types — confirm against the Claude roadmap</span>
      </div>
      <ul>{summary.top_priorities.slice(0, 8).map((i, k) => <Row key={`${i.type}-${k}`} issue={i} />)}</ul>
    </div>
  );
}
```

- [ ] **Step 2: Insert into ResultsView**

In `ResultsView.tsx`, import `SuggestedPriorities` and render it directly under `<MetricsBar .../>`:

```tsx
import { SuggestedPriorities } from './SuggestedPriorities';
// ...
        <SuggestedPriorities issues={result.issues} />
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/SuggestedPriorities.tsx components/seo-parser/ResultsView.tsx
git commit -m "feat(seo): Suggested Priorities block (labeled heuristic)"
```

---

## Task 11: Upload data-completeness checklist

**Files:**
- Create: `components/seo-parser/UploadChecklist.tsx`
- Modify: `app/seo-parser/page.tsx` (render the checklist near the dropzone)

- [ ] **Step 1: Create the checklist component**

A static list of the high-value Screaming Frog (+ optional SEMRush) exports the parsers consume, so a first-time user knows what to upload.

```tsx
'use client';
import React from 'react';

const RECOMMENDED = [
  { file: 'internal_all.csv', why: 'Core crawl: titles, H1s, meta, status, depth, indexability' },
  { file: 'response_codes_*.csv', why: 'Broken pages / redirects' },
  { file: 'page_titles_*.csv / meta_description_*.csv / h1_*.csv', why: 'Duplicate & missing SEO elements' },
  { file: 'images_missing_alt_text.csv', why: 'Accessibility & image SEO' },
  { file: 'pagespeed_*.csv', why: 'Core Web Vitals / performance' },
  { file: 'search_console_*.csv', why: 'Clicks / impressions / position' },
  { file: 'SEMRush Organic Positions (optional)', why: 'Keyword signals: cannibalization, quick wins' },
];

export function UploadChecklist() {
  return (
    <details className="text-sm text-gray-600 dark:text-white/60">
      <summary className="cursor-pointer font-medium text-[#1c2d4a] dark:text-white">Which files should I upload?</summary>
      <ul className="mt-2 space-y-1">
        {RECOMMENDED.map((r) => (
          <li key={r.file}><code className="text-xs">{r.file}</code> — {r.why}</li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 2: Render it on the upload page**

In `app/seo-parser/page.tsx`, import and render `<UploadChecklist />` beneath the dropzone.

- [ ] **Step 3: Post-parse completeness (uses existing metadata)**

On the results page header (ResultsView, near the "N files processed" line), show matched-parser count from existing metadata:

```tsx
<p className="text-gray-500 dark:text-white/50 text-sm mt-1">
  {result.metadata.files_processed.length} files · {result.metadata.parsers_used.length}
  {result.metadata.total_parsers_available ? `/${result.metadata.total_parsers_available}` : ''} parsers matched
</p>
```

(If `metadata.total_parsers_available` isn't already populated, set it in the aggregator's metadata block alongside `parsers_used` — it's the count of registered parsers in `PARSERS`.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/seo-parser/UploadChecklist.tsx app/seo-parser/page.tsx components/seo-parser/ResultsView.tsx
git commit -m "feat(seo): upload checklist + parsers-matched count"
```

---

## Phase 1 Exit Verification

- [ ] `npx tsc --noEmit` — clean
- [ ] `npx vitest run lib/` — all green (new: url-normalize, url-registry, issue-membership, internal per_url_index, keyword-gaps, export)
- [ ] `npm run build` — succeeds
- [ ] Manual: upload a real SF crawl → results page shows Suggested Priorities + severity tiles (no health score) → "Copy for Claude" copies a payload whose `url_registry` is present and whose `issues.critical[].affectedUrlRefs` rehydrate to the right URLs → Export ▾ still downloads JSON/Summary/Markdown.
- [ ] Confirm `optimization_gaps` rows show real titles/H1s when SEMRush positions are uploaded.

## Out of scope (later phases / plans)
- P2: `SeoRoadmap` model + mint-token/PATCH handoff + `seo-audit-roadmap` skill (the in-app roadmap render).
- P3: persist `SessionPage`/`UrlRegistry` + denormalized scalar columns.
- P4: structured `Recommendation` objects + Teamwork push.
- P5: per-client history/trend/diff. P6: `/keyword-research` route.
- General parser-routing test — fold into P2/P3 when those areas open. (The `per_url_index` `mergeParserData` fix is now IN Phase 1, Task 5b.)

## Notes / risk
- **Completeness is explicit, not assumed.** Only `missing_title`/`missing_h1`/`missing_meta_description`/`thin_content` are marked `affectedUrlRefsComplete: true` (re-derived from the full `per_url_index`). All other issue types carry `affectedUrlSource: 'parser-sample'` until their parsers emit complete sets or are derived in a later phase — the Claude payload and any future Teamwork task must honor these flags and disclose "sample" sets. **Open item for Kevin:** which additional issue types must be complete in Phase 1 vs. allowed to stay "sampled until Phase 3" (esp. duplicate title/H1/meta groups, and whether external/resource broken-target URLs must be complete now).
- `per_url_index` rows whose URLs aren't in `internal_all.csv` (external/resource/redirect targets) intern via the issue's own `urls` list with the inferred `UrlKind` (Task 3 note) — they will not be "complete" unless the source parser provides the full list.
- **Open item:** multiple `internal_all.csv` uploads now merge latest-wins per URL (Task 5b) — confirm that's the desired behavior vs. replace/reject.
