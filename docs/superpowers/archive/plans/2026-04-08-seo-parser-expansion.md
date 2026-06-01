# SEO Parser Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the SEO parser to support directory uploads, corrected Screaming Frog filename patterns, GSC/GA4 column extraction, 7 new parsers (4 SF + 3 SEMRush), duplicate content detection, and a keyword signals panel.

**Architecture:** New parsers follow the existing `BaseParser` subclass pattern. SEMRush parsers use content-based detection (header inspection) instead of filename matching — `findParserForFile` gains an optional `content` parameter. The `AggregatorService` gains new aggregation methods that run after all parsers complete. New UI sections (`DuplicateContentSection`, `KeywordSignalsPanel`) are conditionally rendered in `ResultsView` when the relevant data is present.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS (dark mode class-based), Prisma/SQLite, PapaParse (CSV), Vitest (tests), react-dropzone (file upload).

**Spec:** `docs/superpowers/specs/2026-04-08-seo-parser-expansion-design.md`

---

## File Map

### Create
- `lib/parsers/content/exactDuplicates.parser.ts`
- `lib/parsers/content/exactDuplicates.parser.test.ts`
- `lib/parsers/content/nearDuplicates.parser.ts`
- `lib/parsers/content/nearDuplicates.parser.test.ts`
- `lib/parsers/performance/pagespeedOpportunities.parser.ts`
- `lib/parsers/performance/pagespeedOpportunities.parser.test.ts`
- `lib/parsers/resources/allInlinks.parser.ts`
- `lib/parsers/resources/allInlinks.parser.test.ts`
- `lib/parsers/semrush/semrushOrganicPositions.parser.ts`
- `lib/parsers/semrush/semrushOrganicPositions.parser.test.ts`
- `lib/parsers/semrush/semrushOrganicPages.parser.ts`
- `lib/parsers/semrush/semrushOrganicPages.parser.test.ts`
- `lib/parsers/semrush/semrushPositionTracking.parser.ts`
- `lib/parsers/semrush/semrushPositionTracking.parser.test.ts`
- `lib/parsers/semrush/index.ts`
- `components/seo-parser/DuplicateContentSection.tsx`
- `components/seo-parser/KeywordSignalsPanel.tsx`

### Modify
- `lib/types/index.ts` — add `KeywordSignals`, `DuplicateContent`, `LinkAnalysis`, extend `AggregatedResult` and `PerformanceSummary`
- `lib/parsers/base.parser.ts` — add `static matchesContent(headers: string[]): boolean`
- `lib/parsers/index.ts` — update `findParserForFile` for content-based detection, register new parsers
- `lib/parsers/internal.parser.ts` — extract GSC + GA4 columns
- `lib/parsers/seoElements/pageTitles.parser.ts` — filenamePattern update
- `lib/parsers/seoElements/metaDescription.parser.ts` — filenamePattern update
- `lib/parsers/seoElements/h1.parser.ts` — filenamePattern update
- `lib/parsers/seoElements/h2.parser.ts` — filenamePattern update
- `lib/parsers/technical/canonicals.parser.ts` — filenamePattern update
- `lib/parsers/technical/directives.parser.ts` — filenamePattern update
- `lib/parsers/resources/images.parser.ts` — filenamePattern update
- `lib/parsers/resources/javascript.parser.ts` — filenamePattern update
- `lib/parsers/resources/css.parser.ts` — filenamePattern update
- `lib/parsers/resources/security.parser.ts` — filenamePattern update
- `lib/parsers/resources/sitemaps.parser.ts` — filenamePattern update
- `lib/parsers/technical/responseCodes.parser.ts` — filenamePattern update
- `lib/parsers/structuredData/structuredData.parser.ts` — filenamePattern update
- `lib/parsers/performance/pagespeed.parser.ts` — filenamePattern update
- `lib/parsers/content/index.ts` — export new parsers
- `lib/parsers/resources/index.ts` — export `AllInlinksParser`
- `lib/parsers/performance/index.ts` — export `PageSpeedOpportunitiesParser`
- `lib/services/aggregator.service.ts` — duplicate content, keyword signals, link analysis, new issues
- `app/api/upload/route.ts` — accept `.txt` files
- `app/api/parse/[sessionId]/route.ts` — pass content to `findParserForFile` for SEMRush detection
- `components/seo-parser/FileDropzone.tsx` — folder upload button + `.txt` support
- `components/seo-parser/SummaryCard.tsx` — GSC summary metrics
- `components/seo-parser/ResultsView.tsx` — render `DuplicateContentSection` + `KeywordSignalsPanel`

---

## Task 1: Add new types

**Files:**
- Modify: `lib/types/index.ts`

- [ ] **Step 1: Add new interfaces after `PerformanceSummary`**

```typescript
export interface GscPageStat {
  url: string;
  clicks: number;
  impressions: number;
  ctr_pct: number;
  average_position: number;
}

export interface Ga4PageStat {
  url: string;
  sessions: number;
  views: number;
  engaged_sessions: number;
  bounce_rate_pct: number;
  average_session_duration_seconds: number;
}

export interface PageSpeedOpportunity {
  opportunity: string;
  urls_affected: number;
  total_savings_ms: number;
  average_savings_ms: number;
  total_savings_size_bytes: number;
}

export interface TopLinkedPage {
  url: string;
  inlink_count: number;
}

export interface TopAnchorText {
  anchor_text: string;
  count: number;
  is_descriptive: boolean;
}

export interface LinkAnalysis {
  total_internal_links: number;
  nofollow_ratio_pct: number;
  non_descriptive_anchor_pct: number;
  top_linked_pages: TopLinkedPage[];
  top_anchor_texts: TopAnchorText[];
}

export interface CannibalizedKeyword {
  keyword: string;
  search_volume: number;
  intent: string;
  competing_urls: Array<{ url: string; position: number; estimated_traffic: number }>;
}

export interface OptimizationGap {
  url: string;
  title: string;
  h1: string;
  top_ranking_keywords: Array<{ keyword: string; position: number; search_volume: number }>;
}

export interface QuickWin {
  keyword: string;
  position: number;
  search_volume: number;
  intent: string;
  url: string;
}

export interface TopOrganicPage {
  url: string;
  estimated_monthly_traffic: number;
  keyword_count: number;
  traffic_share_pct: number;
  dominant_intent: string;
}

export interface KeywordSignals {
  semrush_connected: boolean;
  gsc_connected: boolean;
  total_ranking_keywords: number;
  keyword_cannibalization: CannibalizedKeyword[];
  optimization_gaps: OptimizationGap[];
  quick_wins: QuickWin[];
  top_pages_by_organic_traffic: TopOrganicPage[];
}

export interface DuplicateGroup {
  value: string;
  affected_urls: string[];
}

export interface ExactDuplicatePair {
  address: string;
  duplicate_of: string;
  similarity_pct: number;
  indexability: string;
}

export interface NearDuplicateEntry {
  address: string;
  closest_match: string;
  near_duplicate_count: number;
}

export interface DuplicateContent {
  exact_duplicates: ExactDuplicatePair[];
  near_duplicates: NearDuplicateEntry[];
  duplicate_titles: DuplicateGroup[];
  duplicate_meta_descriptions: DuplicateGroup[];
  duplicate_h1s: DuplicateGroup[];
}
```

- [ ] **Step 2: Extend `PerformanceSummary` and `AggregatedResult`**

Replace the existing `PerformanceSummary` interface and `AggregatedResult` interface with:

```typescript
export interface PerformanceSummary {
  core_web_vitals?: Record<string, number>;
  stats?: Record<string, number>;
  server_response?: Record<string, number>;
  ga4_traffic?: Record<string, number>;
  search_console?: Record<string, number>;
  pagespeed_opportunities?: PageSpeedOpportunity[];
  gsc_top_pages?: GscPageStat[];
  ga4_top_pages?: Ga4PageStat[];
}

export interface AggregatedResult {
  crawl_summary: CrawlSummary;
  issues: IssuesResult;
  site_structure: SiteStructure;
  resources: ResourcesSummary;
  technical_seo: TechnicalSummary;
  performance: PerformanceSummary;
  duplicate_content?: DuplicateContent;
  keyword_signals?: KeywordSignals;
  link_analysis?: LinkAnalysis;
  recommendations: string[];
  metadata: {
    files_processed: string[];
    parsers_used: string[];
    total_parsers_available: number;
    site_name?: string;
    health_score?: number;
  };
}
```

- [ ] **Step 3: Verify types compile**

```bash
cd /Users/kevinvogelgesang/Enrollment-Resources/er-seo-tools
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors unrelated to these types).

- [ ] **Step 4: Commit**

```bash
git add lib/types/index.ts
git commit -m "feat(types): add KeywordSignals, DuplicateContent, LinkAnalysis types"
```

---

## Task 2: Add `matchesContent` to BaseParser + update `findParserForFile`

**Files:**
- Modify: `lib/parsers/base.parser.ts`
- Modify: `lib/parsers/index.ts`

- [ ] **Step 1: Write failing test for `matchesContent` in `lib/parsers/base.parser.test.ts`**

Open `lib/parsers/base.parser.test.ts` and add at the end of the existing `describe` block:

```typescript
describe('matchesContent', () => {
  it('returns false by default for any headers', () => {
    // BaseParser.matchesContent is not abstract — subclasses opt in
    class StubParser extends BaseParser {
      static filenamePattern = 'stub';
      parse() { return {}; }
    }
    expect(StubParser.matchesContent(['Keyword', 'Position', 'URL'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run lib/parsers/base.parser.test.ts 2>&1 | tail -20
```

Expected: FAIL — `matchesContent is not a function`.

- [ ] **Step 3: Add `matchesContent` to `BaseParser`**

In `lib/parsers/base.parser.ts`, add this static method after `matchesFile`:

```typescript
/**
 * Check if this parser handles a file by inspecting its header row.
 * Override in parsers that are detected by content rather than filename
 * (e.g. SEMRush exports with dynamic date-stamped filenames).
 * Base implementation always returns false.
 */
static matchesContent(_headers: string[]): boolean {
  return false;
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
npx vitest run lib/parsers/base.parser.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Update `findParserForFile` in `lib/parsers/index.ts`**

Replace the existing `findParserForFile` function with:

```typescript
/**
 * Find the appropriate parser for a given filename.
 * If no filename match is found and csvFirstLine is provided,
 * falls back to content-based detection (header inspection).
 * Content-based detection is used for SEMRush exports whose filenames are date-stamped.
 */
export function findParserForFile(
  filename: string,
  csvFirstLine?: string
): typeof BaseParser | null {
  // 1. Filename-based detection (fast path, covers all SF parsers)
  for (const ParserClass of PARSERS) {
    if (ParserClass.matchesFile(filename)) {
      return ParserClass;
    }
  }

  // 2. Content-based detection for parsers with dynamic filenames (SEMRush)
  if (csvFirstLine) {
    const headers = csvFirstLine
      .replace(/^\uFEFF/, '') // strip BOM
      .split(',')
      .map(h => h.trim().replace(/^"|"$/g, ''));
    for (const ParserClass of PARSERS) {
      if (ParserClass.matchesContent(headers)) {
        return ParserClass;
      }
    }

    // Also check for metadata-prefixed files (Position Tracking starts with ----)
    const SEMRUSH_PARSERS = PARSERS.filter(p =>
      p.name.startsWith('Semrush') || p.name.startsWith('semrush')
    );
    for (const ParserClass of SEMRUSH_PARSERS) {
      if ((ParserClass as unknown as { matchesRawContent(content: string): boolean }).matchesRawContent?.(csvFirstLine)) {
        return ParserClass;
      }
    }
  }

  return null;
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/parsers/base.parser.ts lib/parsers/index.ts lib/parsers/base.parser.test.ts
git commit -m "feat(parser): add content-based detection to BaseParser and findParserForFile"
```

---

## Task 3: Update filename patterns for 14 existing SF parsers

**Files:** All parsers listed below — one-line change each.

- [ ] **Step 1: Update `filenamePattern` in each parser**

Each change is: replace the single-string `filenamePattern` with an array of patterns, and update `matchesFile` to check all of them. Since `BaseParser.matchesFile` uses a single string, the simplest approach is to override `matchesFile` in each updated parser.

A cleaner approach: update `BaseParser.matchesFile` to support arrays, then update individual parsers.

In `lib/parsers/base.parser.ts`, replace `matchesFile`:

```typescript
static matchesFile(filename: string): boolean {
  const pattern = this.filenamePattern;
  if (!pattern) return false;
  const lower = filename.toLowerCase();
  if (Array.isArray(pattern)) {
    return pattern.some(p => lower.includes(p.toLowerCase()));
  }
  return lower.includes(pattern.toLowerCase());
}
```

Update `filenamePattern` declaration to accept arrays:

```typescript
static filenamePattern: string | string[] = '';
```

- [ ] **Step 2: Update each parser's `filenamePattern`**

`lib/parsers/seoElements/pageTitles.parser.ts`:
```typescript
static filenamePattern = ['page_titles_all', 'page_titles'];
```

`lib/parsers/seoElements/metaDescription.parser.ts`:
```typescript
static filenamePattern = ['meta_description_all', 'meta_descriptions'];
```

`lib/parsers/seoElements/h1.parser.ts`:
```typescript
static filenamePattern = ['h1_all', 'h1'];
```

`lib/parsers/seoElements/h2.parser.ts`:
```typescript
static filenamePattern = ['h2_all', 'h2'];
```

`lib/parsers/technical/canonicals.parser.ts`:
```typescript
static filenamePattern = ['canonicals_all', 'canonicals'];
```

`lib/parsers/technical/directives.parser.ts`:
```typescript
static filenamePattern = ['directives_all', 'directives'];
```

`lib/parsers/resources/images.parser.ts`:
```typescript
static filenamePattern = ['images_all', 'images'];
```

`lib/parsers/resources/javascript.parser.ts`:
```typescript
static filenamePattern = ['javascript_all', 'javascript'];
```

`lib/parsers/resources/css.parser.ts`:
```typescript
static filenamePattern = ['internal_css', 'css'];
```

`lib/parsers/resources/security.parser.ts`:
```typescript
static filenamePattern = ['security_all', 'security'];
```

`lib/parsers/resources/sitemaps.parser.ts`:
```typescript
static filenamePattern = ['sitemaps_all', 'sitemaps'];
```

`lib/parsers/technical/responseCodes.parser.ts`:
```typescript
static filenamePattern = ['response_codes_all', 'response_codes'];
```

`lib/parsers/structuredData/structuredData.parser.ts`:
```typescript
static filenamePattern = ['structured_data_all', 'structured_data'];
```

`lib/parsers/performance/pagespeed.parser.ts`:
```typescript
static filenamePattern = ['pagespeed_all', 'pagespeed'];
```

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npx vitest run lib/parsers/seoElements lib/parsers/technical lib/parsers/resources lib/parsers/performance 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Verify the new patterns match the real filenames**

```bash
node -e "
const patterns = [
  ['page_titles_all', 'page_titles_all.csv', true],
  ['page_titles_all', 'page_titles.csv', false],
  ['page_titles', 'page_titles.csv', true],
  ['internal_css', 'internal_css.csv', true],
  ['response_codes_all', 'response_codes_all.csv', true],
];
for (const [pat, file, expected] of patterns) {
  const result = file.toLowerCase().includes(pat.toLowerCase());
  const ok = result === expected ? 'OK' : 'FAIL';
  console.log(ok, pat, file, result);
}
"
```

Expected: all OK.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/base.parser.ts \
  lib/parsers/seoElements/pageTitles.parser.ts \
  lib/parsers/seoElements/metaDescription.parser.ts \
  lib/parsers/seoElements/h1.parser.ts \
  lib/parsers/seoElements/h2.parser.ts \
  lib/parsers/technical/canonicals.parser.ts \
  lib/parsers/technical/directives.parser.ts \
  lib/parsers/resources/images.parser.ts \
  lib/parsers/resources/javascript.parser.ts \
  lib/parsers/resources/css.parser.ts \
  lib/parsers/resources/security.parser.ts \
  lib/parsers/resources/sitemaps.parser.ts \
  lib/parsers/technical/responseCodes.parser.ts \
  lib/parsers/structuredData/structuredData.parser.ts \
  lib/parsers/performance/pagespeed.parser.ts
git commit -m "feat(parsers): update filename patterns to match SF _all suffix convention"
```

---

## Task 4: Extract GSC and GA4 columns from InternalParser

**Files:**
- Modify: `lib/parsers/internal.parser.ts`
- Modify: `lib/parsers/internal.parser.test.ts`

- [ ] **Step 1: Write failing tests in `lib/parsers/internal.parser.test.ts`**

Open `lib/parsers/internal.parser.test.ts` and add a new describe block:

```typescript
describe('GSC and GA4 column extraction', () => {
  const csv = `Address,Status Code,Indexability,Clicks,Impressions,CTR,Position,GA4 Sessions,GA4 Views,GA4 Engaged sessions,GA4 Bounce rate,GA4 Average session duration
https://example.com/page-a,200,Indexable,120,5000,0.024,3.2,800,1200,600,0.45,142
https://example.com/page-b,200,Indexable,30,2000,0.015,8.7,200,350,180,0.52,98
https://example.com/page-c,200,Indexable,0,500,0,45.0,50,80,40,0.60,61`;

  it('extracts GSC columns when present', () => {
    const parser = new InternalParser(csv);
    const result = parser.parse();
    expect(result.gsc_data).toBeDefined();
    expect(result.gsc_data.connected).toBe(true);
    expect(result.gsc_data.total_clicks).toBe(150);
    expect(result.gsc_data.total_impressions).toBe(7500);
    expect(result.gsc_data.top_pages_by_impressions).toHaveLength(3);
    expect(result.gsc_data.top_pages_by_impressions[0].url).toBe('https://example.com/page-a');
    expect(result.gsc_data.top_pages_by_impressions[0].impressions).toBe(5000);
  });

  it('flags pages with avg position > 50 as low-visibility', () => {
    const parser = new InternalParser(csv);
    const result = parser.parse();
    expect(result.gsc_data.low_visibility_urls).toContain('https://example.com/page-c');
  });

  it('extracts GA4 columns when present', () => {
    const parser = new InternalParser(csv);
    const result = parser.parse();
    expect(result.ga4_data).toBeDefined();
    expect(result.ga4_data.connected).toBe(true);
    expect(result.ga4_data.total_sessions).toBe(1050);
    expect(result.ga4_data.top_pages_by_sessions[0].url).toBe('https://example.com/page-a');
    expect(result.ga4_data.top_pages_by_sessions[0].sessions).toBe(800);
  });

  it('returns gsc_data.connected false when GSC columns absent', () => {
    const minimalCsv = `Address,Status Code\nhttps://example.com/,200`;
    const parser = new InternalParser(minimalCsv);
    const result = parser.parse();
    expect(result.gsc_data?.connected).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run lib/parsers/internal.parser.test.ts 2>&1 | tail -20
```

Expected: FAIL — `gsc_data` is undefined.

- [ ] **Step 3: Add GSC and GA4 parsing to `InternalParser`**

In `lib/parsers/internal.parser.ts`, add to `COLUMN_MAPPINGS`:

```typescript
// GSC
gsc_clicks: ['Clicks'],
gsc_impressions: ['Impressions'],
gsc_ctr: ['CTR'],
gsc_position: ['Position'],
// GA4
ga4_sessions: ['GA4 Sessions'],
ga4_views: ['GA4 Views'],
ga4_engaged_sessions: ['GA4 Engaged sessions'],
ga4_bounce_rate: ['GA4 Bounce rate'],
ga4_avg_session_duration: ['GA4 Average session duration'],
```

Add these two private methods to `InternalParser`:

```typescript
private parseGscData(): Record<string, unknown> | null {
  const clicksCol = this.getColumn('gsc_clicks');
  const impressionsCol = this.getColumn('gsc_impressions');
  const ctrCol = this.getColumn('gsc_ctr');
  const positionCol = this.getColumn('gsc_position');
  const addressCol = this.getColumn('address');

  if (!clicksCol && !impressionsCol) return null;

  let totalClicks = 0;
  let totalImpressions = 0;
  const lowVisibilityUrls: string[] = [];
  const pages: Array<{ url: string; clicks: number; impressions: number; ctr_pct: number; average_position: number }> = [];

  for (const row of this.data) {
    const url = addressCol ? toString(row[addressCol]) : '';
    const clicks = toNumber(row[clicksCol ?? '']) ?? 0;
    const impressions = toNumber(row[impressionsCol ?? '']) ?? 0;
    const ctr = toNumber(row[ctrCol ?? '']) ?? 0;
    const position = toNumber(row[positionCol ?? '']) ?? 0;

    totalClicks += clicks;
    totalImpressions += impressions;

    if (impressions > 0) {
      pages.push({ url, clicks, impressions, ctr_pct: Math.round(ctr * 1000) / 10, average_position: Math.round(position * 10) / 10 });
    }
    if (position > 50 && impressions > 0 && url && lowVisibilityUrls.length < 50) {
      lowVisibilityUrls.push(url);
    }
  }

  pages.sort((a, b) => b.impressions - a.impressions);

  return {
    connected: true,
    total_clicks: totalClicks,
    total_impressions: totalImpressions,
    avg_ctr_pct: pages.length > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : 0,
    top_pages_by_impressions: pages.slice(0, 50),
    low_visibility_urls: lowVisibilityUrls,
  };
}

private parseGa4Data(): Record<string, unknown> | null {
  const sessionsCol = this.getColumn('ga4_sessions');
  const viewsCol = this.getColumn('ga4_views');
  const engagedCol = this.getColumn('ga4_engaged_sessions');
  const bounceCol = this.getColumn('ga4_bounce_rate');
  const durationCol = this.getColumn('ga4_avg_session_duration');
  const addressCol = this.getColumn('address');

  if (!sessionsCol) return null;

  let totalSessions = 0;
  const pages: Array<{ url: string; sessions: number; views: number; engaged_sessions: number; bounce_rate_pct: number; average_session_duration_seconds: number }> = [];

  for (const row of this.data) {
    const url = addressCol ? toString(row[addressCol]) : '';
    const sessions = toNumber(row[sessionsCol]) ?? 0;
    const views = toNumber(row[viewsCol ?? '']) ?? 0;
    const engaged = toNumber(row[engagedCol ?? '']) ?? 0;
    const bounce = toNumber(row[bounceCol ?? '']) ?? 0;
    const duration = toNumber(row[durationCol ?? '']) ?? 0;

    totalSessions += sessions;
    if (sessions > 0) {
      pages.push({ url, sessions, views, engaged_sessions: engaged, bounce_rate_pct: Math.round(bounce * 1000) / 10, average_session_duration_seconds: Math.round(duration) });
    }
  }

  pages.sort((a, b) => b.sessions - a.sessions);

  return {
    connected: true,
    total_sessions: totalSessions,
    top_pages_by_sessions: pages.slice(0, 50),
  };
}
```

In `parse()`, add after the existing optional fields:

```typescript
const gscData = this.parseGscData();
if (gscData) result.gsc_data = gscData;

const ga4Data = this.parseGa4Data();
if (ga4Data) result.ga4_data = ga4Data;
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run lib/parsers/internal.parser.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/internal.parser.ts lib/parsers/internal.parser.test.ts
git commit -m "feat(parser): extract GSC and GA4 columns from internal_all.csv"
```

---

## Task 5: Create ExactDuplicatesParser

**Files:**
- Create: `lib/parsers/content/exactDuplicates.parser.ts`
- Create: `lib/parsers/content/exactDuplicates.parser.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// lib/parsers/content/exactDuplicates.parser.test.ts
import { describe, it, expect } from 'vitest';
import { ExactDuplicatesParser } from './exactDuplicates.parser';

describe('ExactDuplicatesParser', () => {
  it('matches exact_duplicates_report filename', () => {
    expect(ExactDuplicatesParser.matchesFile('exact_duplicates_report.csv')).toBe(true);
  });

  it('returns empty issues for empty CSV', () => {
    const parser = new ExactDuplicatesParser('');
    expect(parser.parse()).toEqual({});
  });

  it('filters out tracking/pixel URLs', () => {
    const csv = `"Address","Exact Duplicate Address","Similarity","Indexability","Indexability Status"
"https://example.com/gtm/js?id=AW-123&v=3&t=l&pid=123&gtm=456","https://example.com/other","100","Indexable",""
"https://example.com/real-page/","https://example.com/real-page-2/","100","Indexable",""`;
    const parser = new ExactDuplicatesParser(csv);
    const result = parser.parse();
    expect(result.exact_duplicate_pairs).toHaveLength(1);
    expect(result.exact_duplicate_pairs[0].address).toBe('https://example.com/real-page/');
  });

  it('extracts duplicate pairs with correct fields', () => {
    const csv = `"Address","Exact Duplicate Address","Similarity","Indexability","Indexability Status"
"https://example.com/page-a/","https://example.com/page-b/","100","Indexable",""`;
    const parser = new ExactDuplicatesParser(csv);
    const result = parser.parse();
    expect(result.exact_duplicate_pairs[0]).toEqual({
      address: 'https://example.com/page-a/',
      duplicate_of: 'https://example.com/page-b/',
      similarity_pct: 100,
      indexability: 'Indexable',
    });
  });

  it('generates a warning issue when duplicates exist', () => {
    const csv = `"Address","Exact Duplicate Address","Similarity","Indexability","Indexability Status"
"https://example.com/page-a/","https://example.com/page-b/","100","Indexable",""
"https://example.com/page-c/","https://example.com/page-d/","100","Indexable",""`;
    const parser = new ExactDuplicatesParser(csv);
    const result = parser.parse();
    const issue = result.issues.find((i: { type: string }) => i.type === 'exact_duplicate_pages');
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
    expect(issue.count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run lib/parsers/content/exactDuplicates.parser.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/content/exactDuplicates.parser.ts
import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

// Query string patterns that identify tracking/pixel URLs — not actionable SEO duplicates
const TRACKING_PATTERNS = ['gtm=', 'pid=', 'v=3&t=', 'rv=', 'tag_exp='];
const MAX_URL_LENGTH = 300;

function isTrackingUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) return true;
  return TRACKING_PATTERNS.some(p => url.includes(p));
}

export class ExactDuplicatesParser extends BaseParser {
  static filenamePattern = 'exact_duplicates_report';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const duplicateCol = this.findColumn(['Exact Duplicate Address', 'Duplicate Address']);
    const similarityCol = this.findColumn(['Similarity']);
    const indexabilityCol = this.findColumn(['Indexability']);

    if (!addressCol || !duplicateCol) return {};

    const pairs: Array<{ address: string; duplicate_of: string; similarity_pct: number; indexability: string }> = [];

    for (const row of this.data) {
      const address = toString(row[addressCol]);
      const duplicateOf = toString(row[duplicateCol]);

      if (!address || !duplicateOf) continue;
      if (isTrackingUrl(address) || isTrackingUrl(duplicateOf)) continue;

      const similarity = toNumber(row[similarityCol ?? '']) ?? 100;
      const indexability = toString(row[indexabilityCol ?? '']) || 'Unknown';

      pairs.push({ address, duplicate_of: duplicateOf, similarity_pct: similarity, indexability });
    }

    const issues: Issue[] = [];
    if (pairs.length > 0) {
      issues.push({
        type: 'exact_duplicate_pages',
        severity: 'warning',
        count: pairs.length,
        description: `${pairs.length} exact duplicate page${pairs.length !== 1 ? 's' : ''} detected — consolidate with canonical tags or redirects`,
        urls: pairs.slice(0, 20).map(p => p.address),
      });
    }

    return {
      exact_duplicate_pairs: pairs,
      total_exact_duplicates: pairs.length,
      issues,
    };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run lib/parsers/content/exactDuplicates.parser.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/content/exactDuplicates.parser.ts lib/parsers/content/exactDuplicates.parser.test.ts
git commit -m "feat(parser): add ExactDuplicatesParser for exact_duplicates_report.csv"
```

---

## Task 6: Create NearDuplicatesParser

**Files:**
- Create: `lib/parsers/content/nearDuplicates.parser.ts`
- Create: `lib/parsers/content/nearDuplicates.parser.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// lib/parsers/content/nearDuplicates.parser.test.ts
import { describe, it, expect } from 'vitest';
import { NearDuplicatesParser } from './nearDuplicates.parser';

describe('NearDuplicatesParser', () => {
  it('matches content_near_duplicates filename', () => {
    expect(NearDuplicatesParser.matchesFile('content_near_duplicates.csv')).toBe(true);
  });

  it('returns empty for empty CSV', () => {
    expect(new NearDuplicatesParser('').parse()).toEqual({});
  });

  it('extracts near duplicate entries', () => {
    const csv = `"Address","Closest Near Duplicate Match","No. Near Duplicates","Indexability","Indexability Status","Canonical Link Element 1"
"https://example.com/page-a/","https://example.com/page-b/","3","Indexable","",""
"https://example.com/page-b/","https://example.com/page-a/","3","Indexable","",""`;
    const parser = new NearDuplicatesParser(csv);
    const result = parser.parse();
    expect(result.near_duplicate_entries).toHaveLength(2);
    expect(result.near_duplicate_entries[0].address).toBe('https://example.com/page-a/');
    expect(result.near_duplicate_entries[0].closest_match).toBe('https://example.com/page-b/');
    expect(result.near_duplicate_entries[0].near_duplicate_count).toBe(3);
  });

  it('generates a warning issue when near duplicates exist', () => {
    const csv = `"Address","Closest Near Duplicate Match","No. Near Duplicates","Indexability","Indexability Status","Canonical Link Element 1"
"https://example.com/page-a/","https://example.com/page-b/","2","Indexable","",""`;
    const parser = new NearDuplicatesParser(csv);
    const result = parser.parse();
    const issue = result.issues.find((i: { type: string }) => i.type === 'near_duplicate_pages');
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run lib/parsers/content/nearDuplicates.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/content/nearDuplicates.parser.ts
import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class NearDuplicatesParser extends BaseParser {
  static filenamePattern = 'content_near_duplicates';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const matchCol = this.findColumn(['Closest Near Duplicate Match', 'Near Duplicate Match']);
    const countCol = this.findColumn(['No. Near Duplicates', 'Near Duplicates']);

    if (!addressCol) return {};

    const entries: Array<{ address: string; closest_match: string; near_duplicate_count: number }> = [];

    for (const row of this.data) {
      const address = toString(row[addressCol]);
      if (!address) continue;
      const closestMatch = matchCol ? toString(row[matchCol]) : '';
      const count = countCol ? (toNumber(row[countCol]) ?? 0) : 0;
      entries.push({ address, closest_match: closestMatch, near_duplicate_count: count });
    }

    const issues: Issue[] = [];
    if (entries.length > 0) {
      issues.push({
        type: 'near_duplicate_pages',
        severity: 'warning',
        count: entries.length,
        description: `${entries.length} pages with near-duplicate content — review for keyword cannibalization or consolidate`,
        urls: entries.slice(0, 20).map(e => e.address),
      });
    }

    return {
      near_duplicate_entries: entries,
      total_near_duplicates: entries.length,
      issues,
    };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run lib/parsers/content/nearDuplicates.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/content/nearDuplicates.parser.ts lib/parsers/content/nearDuplicates.parser.test.ts
git commit -m "feat(parser): add NearDuplicatesParser for content_near_duplicates.csv"
```

---

## Task 7: Create PageSpeedOpportunitiesParser

**Files:**
- Create: `lib/parsers/performance/pagespeedOpportunities.parser.ts`
- Create: `lib/parsers/performance/pagespeedOpportunities.parser.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// lib/parsers/performance/pagespeedOpportunities.parser.test.ts
import { describe, it, expect } from 'vitest';
import { PageSpeedOpportunitiesParser } from './pagespeedOpportunities.parser';

describe('PageSpeedOpportunitiesParser', () => {
  it('matches pagespeed_opportunities_summary filename', () => {
    expect(PageSpeedOpportunitiesParser.matchesFile('pagespeed_opportunities_summary.csv')).toBe(true);
    expect(PageSpeedOpportunitiesParser.matchesFile('pagespeed_all.csv')).toBe(false);
  });

  it('returns empty for empty CSV', () => {
    expect(new PageSpeedOpportunitiesParser('').parse()).toEqual({});
  });

  it('filters out opportunities with zero URLs affected', () => {
    const csv = `Opportunity,Number of URLs Affected,Total Size Bytes,Total Savings ms,Total Savings Size Bytes,Average Savings ms,Average Savings Size Bytes
"Minify CSS",0,0,0,0,0,0
"Eliminate render-blocking resources",12,0,4500,0,375,0`;
    const parser = new PageSpeedOpportunitiesParser(csv);
    const result = parser.parse();
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].opportunity).toBe('Eliminate render-blocking resources');
  });

  it('sorts opportunities by total_savings_ms descending', () => {
    const csv = `Opportunity,Number of URLs Affected,Total Size Bytes,Total Savings ms,Total Savings Size Bytes,Average Savings ms,Average Savings Size Bytes
"Opportunity A",5,0,1000,0,200,0
"Opportunity B",3,0,5000,0,1667,0`;
    const parser = new PageSpeedOpportunitiesParser(csv);
    const result = parser.parse();
    expect(result.opportunities[0].opportunity).toBe('Opportunity B');
  });

  it('generates a warning issue for high-impact opportunities', () => {
    const csv = `Opportunity,Number of URLs Affected,Total Size Bytes,Total Savings ms,Total Savings Size Bytes,Average Savings ms,Average Savings Size Bytes
"Eliminate render-blocking resources",12,0,4500,0,375,0
"Reduce unused JavaScript",8,0,3200,0,400,0
"Minify JavaScript",5,0,1200,0,240,0`;
    const parser = new PageSpeedOpportunitiesParser(csv);
    const result = parser.parse();
    const issue = result.issues.find((i: { type: string }) => i.type === 'pagespeed_opportunities');
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run lib/parsers/performance/pagespeedOpportunities.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/performance/pagespeedOpportunities.parser.ts
import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class PageSpeedOpportunitiesParser extends BaseParser {
  static filenamePattern = 'pagespeed_opportunities_summary';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const opportunityCol = this.findColumn(['Opportunity']);
    const urlsAffectedCol = this.findColumn(['Number of URLs Affected', 'URLs Affected']);
    const totalSavingsMsCol = this.findColumn(['Total Savings ms', 'Total Savings (ms)']);
    const avgSavingsMsCol = this.findColumn(['Average Savings ms', 'Average Savings (ms)']);
    const totalSavingsBytesCol = this.findColumn(['Total Savings Size Bytes', 'Total Savings Size (Bytes)']);

    if (!opportunityCol) return {};

    const opportunities: Array<{
      opportunity: string;
      urls_affected: number;
      total_savings_ms: number;
      average_savings_ms: number;
      total_savings_size_bytes: number;
    }> = [];

    for (const row of this.data) {
      const opportunity = toString(row[opportunityCol]);
      const urlsAffected = toNumber(row[urlsAffectedCol ?? '']) ?? 0;
      if (!opportunity || urlsAffected === 0) continue;

      opportunities.push({
        opportunity,
        urls_affected: urlsAffected,
        total_savings_ms: toNumber(row[totalSavingsMsCol ?? '']) ?? 0,
        average_savings_ms: toNumber(row[avgSavingsMsCol ?? '']) ?? 0,
        total_savings_size_bytes: toNumber(row[totalSavingsBytesCol ?? '']) ?? 0,
      });
    }

    opportunities.sort((a, b) => b.total_savings_ms - a.total_savings_ms);

    const issues: Issue[] = [];
    if (opportunities.length > 0) {
      const top3 = opportunities.slice(0, 3);
      issues.push({
        type: 'pagespeed_opportunities',
        severity: 'warning',
        count: opportunities.length,
        description: `${opportunities.length} PageSpeed opportunities — top fix: "${top3[0].opportunity}" (${top3[0].urls_affected} URLs, ~${Math.round(top3[0].average_savings_ms)}ms avg savings)`,
      });
    }

    return { opportunities, total_opportunities: opportunities.length, issues };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run lib/parsers/performance/pagespeedOpportunities.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/performance/pagespeedOpportunities.parser.ts lib/parsers/performance/pagespeedOpportunities.parser.test.ts
git commit -m "feat(parser): add PageSpeedOpportunitiesParser"
```

---

## Task 8: Create AllInlinksParser

**Files:**
- Create: `lib/parsers/resources/allInlinks.parser.ts`
- Create: `lib/parsers/resources/allInlinks.parser.test.ts`

This parser aggregates only — it never stores individual rows. The file can be 200K+ rows.

- [ ] **Step 1: Write failing test**

```typescript
// lib/parsers/resources/allInlinks.parser.test.ts
import { describe, it, expect } from 'vitest';
import { AllInlinksParser } from './allInlinks.parser';

describe('AllInlinksParser', () => {
  it('matches all_inlinks filename', () => {
    expect(AllInlinksParser.matchesFile('all_inlinks.csv')).toBe(true);
    expect(AllInlinksParser.matchesFile('internal_links.csv')).toBe(false);
  });

  const csv = `Type,Source,Destination,Size (Bytes),Alt Text,Anchor,Status Code,Status,Follow,Target,Rel,Path Type,Link Path,Link Position,Link Origin
Hyperlink,https://example.com/,https://example.com/about/,0,,About Us,200,,true,,,,/body/a,Content,HTML
Hyperlink,https://example.com/,https://example.com/contact/,0,,Contact,200,,true,,,,/body/a,Content,HTML
Hyperlink,https://example.com/about/,https://example.com/,0,,Home,200,,false,,nofollow,,/body/a,Content,HTML
Hyperlink,https://example.com/blog/,https://example.com/about/,0,,Click here,200,,true,,,,/body/a,Content,HTML`;

  it('counts total links', () => {
    const parser = new AllInlinksParser(csv);
    const result = parser.parse();
    expect(result.total_internal_links).toBe(4);
  });

  it('calculates nofollow ratio', () => {
    const parser = new AllInlinksParser(csv);
    const result = parser.parse();
    expect(result.nofollow_ratio_pct).toBe(25); // 1 of 4
  });

  it('identifies top linked pages', () => {
    const parser = new AllInlinksParser(csv);
    const result = parser.parse();
    expect(result.top_linked_pages[0].url).toBe('https://example.com/about/');
    expect(result.top_linked_pages[0].inlink_count).toBe(2);
  });

  it('flags non-descriptive anchors', () => {
    const parser = new AllInlinksParser(csv);
    const result = parser.parse();
    expect(result.non_descriptive_anchor_pct).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run lib/parsers/resources/allInlinks.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/resources/allInlinks.parser.ts
import { BaseParser } from '../base.parser';
import { ParsedData } from '../../types';
import { toString } from '../../utils/columnMapper';

const NON_DESCRIPTIVE_ANCHORS = new Set([
  'click here', 'click', 'here', 'read more', 'learn more', 'more', 'more info',
  'this', 'link', 'page', 'website', 'site', 'url', 'go', 'visit', 'view',
  'download', 'continue', 'see more', 'find out more', '',
]);

function isDescriptive(anchor: string): boolean {
  return !NON_DESCRIPTIVE_ANCHORS.has(anchor.toLowerCase().trim());
}

export class AllInlinksParser extends BaseParser {
  static filenamePattern = 'all_inlinks';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const destinationCol = this.findColumn(['Destination', 'Destination URL']);
    const anchorCol = this.findColumn(['Anchor', 'Anchor Text']);
    const followCol = this.findColumn(['Follow', 'Dofollow']);

    if (!destinationCol) return {};

    let totalLinks = 0;
    let nofollowCount = 0;
    let nonDescriptiveCount = 0;

    const destinationCounts = new Map<string, number>();
    const anchorCounts = new Map<string, number>();

    for (const row of this.data) {
      totalLinks++;

      const dest = toString(row[destinationCol]);
      if (dest) {
        destinationCounts.set(dest, (destinationCounts.get(dest) ?? 0) + 1);
      }

      const followValue = toString(row[followCol ?? '']).toLowerCase();
      if (followValue === 'false' || followValue === 'nofollow') {
        nofollowCount++;
      }

      const anchor = toString(row[anchorCol ?? '']);
      if (anchor !== null) {
        const key = anchor.toLowerCase().trim();
        anchorCounts.set(key, (anchorCounts.get(key) ?? 0) + 1);
        if (!isDescriptive(anchor)) nonDescriptiveCount++;
      }
    }

    const topLinkedPages = [...destinationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([url, inlink_count]) => ({ url, inlink_count }));

    const topAnchorTexts = [...anchorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([anchor_text, count]) => ({ anchor_text, count, is_descriptive: isDescriptive(anchor_text) }));

    const nofollowRatioPct = totalLinks > 0 ? Math.round((nofollowCount / totalLinks) * 1000) / 10 : 0;
    const nonDescriptivePct = totalLinks > 0 ? Math.round((nonDescriptiveCount / totalLinks) * 1000) / 10 : 0;

    return {
      total_internal_links: totalLinks,
      nofollow_ratio_pct: nofollowRatioPct,
      non_descriptive_anchor_pct: nonDescriptivePct,
      top_linked_pages: topLinkedPages,
      top_anchor_texts: topAnchorTexts,
    };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run lib/parsers/resources/allInlinks.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/resources/allInlinks.parser.ts lib/parsers/resources/allInlinks.parser.test.ts
git commit -m "feat(parser): add AllInlinksParser with aggregate-only link analysis"
```

---

## Task 9: Create SemrushOrganicPositionsParser

**Files:**
- Create: `lib/parsers/semrush/semrushOrganicPositions.parser.ts`
- Create: `lib/parsers/semrush/semrushOrganicPositions.parser.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// lib/parsers/semrush/semrushOrganicPositions.parser.test.ts
import { describe, it, expect } from 'vitest';
import { SemrushOrganicPositionsParser } from './semrushOrganicPositions.parser';

const csv = `Keyword,Position,Previous position,Search Volume,Keyword Difficulty,CPC,URL,Traffic,Traffic (%),Traffic Cost,Competition,Number of Results,Trends,Timestamp,SERP Features by Keyword,Keyword Intents,Position Type
wellspring,5,5,14800,61,3.04,https://example.com/,651,33.94,1979.00,0.04,8020000,"[66]",2026-04-06,"Video",navigational,Organic
massage therapy program,12,14,1200,45,2.50,https://example.com/massage/,85,4.42,212.00,0.03,500000,"[50]",2026-04-06,"",informational,Organic
massage school,15,15,1300,52,2.80,https://example.com/massage/,45,2.34,126.00,0.03,600000,"[50]",2026-04-06,"",informational,Organic
online programs,4,4,8000,70,5.00,https://example.com/online/,320,16.67,1600.00,0.05,2000000,"[60]",2026-04-06,"",informational,Organic`;

describe('SemrushOrganicPositionsParser', () => {
  it('does not match by filename', () => {
    expect(SemrushOrganicPositionsParser.matchesFile('organic_positions.csv')).toBe(false);
    expect(SemrushOrganicPositionsParser.matchesFile('wellspring.edu-organic.Positions-us-20260407.csv')).toBe(false);
  });

  it('matches by content headers', () => {
    const headers = ['Keyword', 'Position', 'Previous position', 'Search Volume', 'Keyword Difficulty', 'CPC', 'URL', 'Traffic', 'Traffic (%)', 'Traffic Cost', 'Competition', 'Number of Results', 'Trends', 'Timestamp', 'SERP Features by Keyword', 'Keyword Intents', 'Position Type'];
    expect(SemrushOrganicPositionsParser.matchesContent(headers)).toBe(true);
  });

  it('does not match Organic Pages headers', () => {
    const headers = ['URL', 'Traffic (%)', 'Number of Keywords', 'Traffic', 'Adwords Positions'];
    expect(SemrushOrganicPositionsParser.matchesContent(headers)).toBe(false);
  });

  it('extracts keyword rows', () => {
    const parser = new SemrushOrganicPositionsParser(csv);
    const result = parser.parse();
    expect(result.total_ranking_keywords).toBe(4);
  });

  it('detects cannibalization (same keyword, multiple URLs)', () => {
    const parser = new SemrushOrganicPositionsParser(csv);
    const result = parser.parse();
    // massage therapy program and massage school both point to /massage/
    // These are different keywords, same URL — not cannibalization
    // Cannibalization = same keyword, different URLs
    expect(result.keyword_cannibalization).toEqual([]);
  });

  it('detects cannibalization when present', () => {
    const cannibalCsv = `Keyword,Position,Previous position,Search Volume,Keyword Difficulty,CPC,URL,Traffic,Traffic (%),Traffic Cost,Competition,Number of Results,Trends,Timestamp,SERP Features by Keyword,Keyword Intents,Position Type
massage school,5,5,1300,52,2.80,https://example.com/massage/,200,10,560,0.03,600000,"[50]",2026-04-06,"",informational,Organic
massage school,12,12,1300,52,2.80,https://example.com/programs/massage-therapy/,80,4,224,0.03,600000,"[50]",2026-04-06,"",informational,Organic`;
    const parser = new SemrushOrganicPositionsParser(cannibalCsv);
    const result = parser.parse();
    expect(result.keyword_cannibalization).toHaveLength(1);
    expect(result.keyword_cannibalization[0].keyword).toBe('massage school');
    expect(result.keyword_cannibalization[0].competing_urls).toHaveLength(2);
  });

  it('identifies quick wins (position 11-20, volume >= 100)', () => {
    const parser = new SemrushOrganicPositionsParser(csv);
    const result = parser.parse();
    const quickWinKeywords = result.quick_wins.map((q: { keyword: string }) => q.keyword);
    expect(quickWinKeywords).toContain('massage therapy program');
    expect(quickWinKeywords).toContain('massage school');
  });

  it('builds per-URL keyword rollup', () => {
    const parser = new SemrushOrganicPositionsParser(csv);
    const result = parser.parse();
    const massagePage = result.per_url_keywords['https://example.com/massage/'];
    expect(massagePage).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run lib/parsers/semrush/semrushOrganicPositions.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/semrush/semrushOrganicPositions.parser.ts
import { BaseParser } from '../base.parser';
import { ParsedData } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class SemrushOrganicPositionsParser extends BaseParser {
  // No filename pattern — detected by content
  static filenamePattern = '';

  static matchesContent(headers: string[]): boolean {
    const required = ['Keyword', 'Search Volume', 'URL', 'Keyword Intents', 'Position'];
    return required.every(r => headers.some(h => h.trim() === r));
  }

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const keywordCol = this.findColumn(['Keyword']);
    const positionCol = this.findColumn(['Position']);
    const prevPositionCol = this.findColumn(['Previous position', 'Previous Position']);
    const volumeCol = this.findColumn(['Search Volume', 'Volume']);
    const urlCol = this.findColumn(['URL']);
    const trafficCol = this.findColumn(['Traffic']);
    const intentCol = this.findColumn(['Keyword Intents', 'Intent']);
    const kdCol = this.findColumn(['Keyword Difficulty', 'KD %', 'KD']);

    if (!keywordCol || !urlCol) return {};

    // Build per-keyword map: keyword → [{url, position, traffic}]
    const keywordMap = new Map<string, Array<{ url: string; position: number; estimated_traffic: number }>>();
    // Build per-URL map: url → [{keyword, position, volume, intent}]
    const urlMap = new Map<string, Array<{ keyword: string; position: number; search_volume: number; intent: string; kd: number }>>();

    let totalKeywords = 0;

    for (const row of this.data) {
      const keyword = toString(row[keywordCol]).toLowerCase().trim();
      const url = toString(row[urlCol]);
      if (!keyword || !url) continue;

      const position = toNumber(row[positionCol ?? '']) ?? 0;
      const volume = toNumber(row[volumeCol ?? '']) ?? 0;
      const traffic = toNumber(row[trafficCol ?? '']) ?? 0;
      const intent = toString(row[intentCol ?? '']) || 'unknown';
      const kd = toNumber(row[kdCol ?? '']) ?? 0;

      totalKeywords++;

      // keyword map
      const existing = keywordMap.get(keyword) ?? [];
      existing.push({ url, position, estimated_traffic: traffic });
      keywordMap.set(keyword, existing);

      // url map
      const urlKeywords = urlMap.get(url) ?? [];
      urlKeywords.push({ keyword, position, search_volume: volume, intent, kd });
      urlMap.set(url, urlKeywords);
    }

    // Cannibalization: keywords where 2+ distinct URLs compete
    const cannibalization: Array<{
      keyword: string;
      search_volume: number;
      intent: string;
      competing_urls: Array<{ url: string; position: number; estimated_traffic: number }>;
    }> = [];

    for (const [keyword, entries] of keywordMap.entries()) {
      const uniqueUrls = new Set(entries.map(e => e.url));
      if (uniqueUrls.size < 2) continue;
      // Look up volume from first entry's row
      const urlKeywords = urlMap.get(entries[0].url) ?? [];
      const kwData = urlKeywords.find(k => k.keyword === keyword);
      const volume = kwData?.search_volume ?? 0;
      const intent = kwData?.intent ?? 'unknown';
      cannibalization.push({
        keyword,
        search_volume: volume,
        intent,
        competing_urls: entries.sort((a, b) => a.position - b.position),
      });
    }
    cannibalization.sort((a, b) => b.search_volume - a.search_volume);

    // Quick wins: position 11-20, volume >= 100
    const quickWins: Array<{ keyword: string; position: number; search_volume: number; intent: string; url: string }> = [];
    for (const [keyword, entries] of keywordMap.entries()) {
      for (const entry of entries) {
        if (entry.position >= 11 && entry.position <= 20) {
          const urlKeywords = urlMap.get(entry.url) ?? [];
          const kwData = urlKeywords.find(k => k.keyword === keyword);
          const volume = kwData?.search_volume ?? 0;
          const intent = kwData?.intent ?? 'unknown';
          if (volume >= 100) {
            quickWins.push({ keyword, position: entry.position, search_volume: volume, intent, url: entry.url });
          }
        }
      }
    }
    quickWins.sort((a, b) => b.search_volume - a.search_volume);

    // Per-URL keyword rollup (sorted by traffic desc per URL)
    const perUrlKeywords: Record<string, Array<{ keyword: string; position: number; search_volume: number; intent: string }>> = {};
    for (const [url, keywords] of urlMap.entries()) {
      perUrlKeywords[url] = keywords.sort((a, b) => b.search_volume - a.search_volume);
    }

    return {
      total_ranking_keywords: totalKeywords,
      keyword_cannibalization: cannibalization,
      quick_wins: quickWins,
      per_url_keywords: perUrlKeywords,
    };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run lib/parsers/semrush/semrushOrganicPositions.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/semrush/semrushOrganicPositions.parser.ts lib/parsers/semrush/semrushOrganicPositions.parser.test.ts
git commit -m "feat(parser): add SemrushOrganicPositionsParser with cannibalization detection"
```

---

## Task 10: Create SemrushOrganicPagesParser

**Files:**
- Create: `lib/parsers/semrush/semrushOrganicPages.parser.ts`
- Create: `lib/parsers/semrush/semrushOrganicPages.parser.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// lib/parsers/semrush/semrushOrganicPages.parser.test.ts
import { describe, it, expect } from 'vitest';
import { SemrushOrganicPagesParser } from './semrushOrganicPages.parser';

const csv = `URL,Traffic (%),Number of Keywords,Traffic,Adwords Positions,Positions with commercial intents in top 20,Positions with informational intents in top 20,Positions with navigational intents in top 20,Positions with transactional intents in top 20,Positions with unknown intents in top 20,Traffic with commercial intents in top 20,Traffic with informational intents in top 20,Traffic with navigational intents in top 20,Traffic with transactional intents in top 20,Traffic with unknown intents in top 20,Traffic Change
https://example.com/,39.67,89,761,0,14,11,11,6,0,6,45,710,4,0,626
https://example.com/massage/,10.45,23,201,0,5,12,2,1,0,2,120,60,5,0,50
https://example.com/contact/,2.10,5,40,0,0,2,1,0,0,0,20,15,0,0,-10`;

describe('SemrushOrganicPagesParser', () => {
  it('does not match by filename', () => {
    expect(SemrushOrganicPagesParser.matchesFile('organic_pages.csv')).toBe(false);
  });

  it('matches by content headers', () => {
    const headers = ['URL', 'Traffic (%)', 'Number of Keywords', 'Traffic', 'Adwords Positions',
      'Positions with commercial intents in top 20'];
    expect(SemrushOrganicPagesParser.matchesContent(headers)).toBe(true);
  });

  it('does not match Organic Positions headers', () => {
    const headers = ['Keyword', 'Position', 'Search Volume', 'URL', 'Keyword Intents'];
    expect(SemrushOrganicPagesParser.matchesContent(headers)).toBe(false);
  });

  it('extracts top pages sorted by traffic', () => {
    const parser = new SemrushOrganicPagesParser(csv);
    const result = parser.parse();
    expect(result.top_pages_by_organic_traffic[0].url).toBe('https://example.com/');
    expect(result.top_pages_by_organic_traffic[0].estimated_monthly_traffic).toBe(761);
  });

  it('determines dominant intent from intent columns', () => {
    const parser = new SemrushOrganicPagesParser(csv);
    const result = parser.parse();
    // Homepage: navigational traffic = 710, informational = 45, so dominant = navigational
    expect(result.top_pages_by_organic_traffic[0].dominant_intent).toBe('navigational');
  });

  it('exposes per_url_traffic for joining with Positions data', () => {
    const parser = new SemrushOrganicPagesParser(csv);
    const result = parser.parse();
    expect(result.per_url_traffic['https://example.com/']).toBe(761);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run lib/parsers/semrush/semrushOrganicPages.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement the parser**

```typescript
// lib/parsers/semrush/semrushOrganicPages.parser.ts
import { BaseParser } from '../base.parser';
import { ParsedData } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

const INTENT_TRAFFIC_COLS: Record<string, string> = {
  commercial: 'Traffic with commercial intents in top 20',
  informational: 'Traffic with informational intents in top 20',
  navigational: 'Traffic with navigational intents in top 20',
  transactional: 'Traffic with transactional intents in top 20',
};

export class SemrushOrganicPagesParser extends BaseParser {
  static filenamePattern = '';

  static matchesContent(headers: string[]): boolean {
    const required = ['Number of Keywords', 'Adwords Positions'];
    const hasUrl = headers.some(h => h.trim() === 'URL');
    return hasUrl && required.every(r => headers.some(h => h.trim() === r));
  }

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const urlCol = this.findColumn(['URL']);
    const trafficCol = this.findColumn(['Traffic']);
    const trafficPctCol = this.findColumn(['Traffic (%)']);
    const keywordsCol = this.findColumn(['Number of Keywords']);

    if (!urlCol) return {};

    const pages: Array<{
      url: string;
      estimated_monthly_traffic: number;
      keyword_count: number;
      traffic_share_pct: number;
      dominant_intent: string;
    }> = [];

    const perUrlTraffic: Record<string, number> = {};

    for (const row of this.data) {
      const url = toString(row[urlCol]);
      if (!url) continue;

      const traffic = toNumber(row[trafficCol ?? '']) ?? 0;
      const trafficPct = toNumber(row[trafficPctCol ?? '']) ?? 0;
      const keywords = toNumber(row[keywordsCol ?? '']) ?? 0;

      // Determine dominant intent by traffic
      let dominantIntent = 'unknown';
      let maxIntentTraffic = -1;
      for (const [intent, colName] of Object.entries(INTENT_TRAFFIC_COLS)) {
        const col = this.findColumn([colName]);
        const val = col ? (toNumber(row[col]) ?? 0) : 0;
        if (val > maxIntentTraffic) {
          maxIntentTraffic = val;
          dominantIntent = intent;
        }
      }

      pages.push({ url, estimated_monthly_traffic: traffic, keyword_count: keywords, traffic_share_pct: trafficPct, dominant_intent: dominantIntent });
      perUrlTraffic[url] = traffic;
    }

    pages.sort((a, b) => b.estimated_monthly_traffic - a.estimated_monthly_traffic);

    return {
      top_pages_by_organic_traffic: pages.slice(0, 20),
      per_url_traffic: perUrlTraffic,
      total_pages_with_traffic: pages.filter(p => p.estimated_monthly_traffic > 0).length,
    };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run lib/parsers/semrush/semrushOrganicPages.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/semrush/semrushOrganicPages.parser.ts lib/parsers/semrush/semrushOrganicPages.parser.test.ts
git commit -m "feat(parser): add SemrushOrganicPagesParser"
```

---

## Task 11: Create SemrushPositionTrackingParser

**Files:**
- Create: `lib/parsers/semrush/semrushPositionTracking.parser.ts`
- Create: `lib/parsers/semrush/semrushPositionTracking.parser.test.ts`

The Position Tracking export starts with a metadata block (5 lines of dashes/text/blank) before the CSV data.

- [ ] **Step 1: Write failing test**

```typescript
// lib/parsers/semrush/semrushPositionTracking.parser.test.ts
import { describe, it, expect } from 'vitest';
import { SemrushPositionTrackingParser } from './semrushPositionTracking.parser';

const rawFile = `------------------------------
ID: 22438480_2549003
Report type: position_tracking_pages
Period: 20260402 - 20260408
------------------------------
URL,Keywords (Organic),Keywords,Traffic Forecast,Traffic Forecast Change,Average Position,Average Position Change,Visibility,Visibility Change,SERP Features
https://example.com/,89,45,120,10,4.5,-0.2,75.3,1.2,Featured snippet
https://example.com/massage/,23,12,50,-5,11.2,0.8,45.1,-0.5,`;

describe('SemrushPositionTrackingParser', () => {
  it('does not match by filename', () => {
    expect(SemrushPositionTrackingParser.matchesFile('tracking_landing_pages.csv')).toBe(false);
  });

  it('detects position_tracking_pages files by raw content', () => {
    expect(SemrushPositionTrackingParser.matchesRawContent(rawFile)).toBe(true);
  });

  it('does not match other SEMRush files', () => {
    const otherContent = `Keyword,Position,URL\ntest,5,https://example.com/`;
    expect(SemrushPositionTrackingParser.matchesRawContent(otherContent)).toBe(false);
  });

  it('skips metadata header and parses CSV data', () => {
    const parser = new SemrushPositionTrackingParser(rawFile);
    const result = parser.parse();
    expect(result.tracked_pages).toHaveLength(2);
  });

  it('extracts URL and avg position', () => {
    const parser = new SemrushPositionTrackingParser(rawFile);
    const result = parser.parse();
    expect(result.tracked_pages[0].url).toBe('https://example.com/');
    expect(result.tracked_pages[0].avg_position).toBe(4.5);
  });

  it('returns per_url_avg_position map', () => {
    const parser = new SemrushPositionTrackingParser(rawFile);
    const result = parser.parse();
    expect(result.per_url_avg_position['https://example.com/']).toBe(4.5);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run lib/parsers/semrush/semrushPositionTracking.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement the parser**

This parser overrides the constructor to pre-process the raw content before PapaParse sees it. The metadata block is stripped, leaving only valid CSV.

```typescript
// lib/parsers/semrush/semrushPositionTracking.parser.ts
import { BaseParser } from '../base.parser';
import { ParsedData } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class SemrushPositionTrackingParser extends BaseParser {
  static filenamePattern = '';

  /**
   * Called by findParserForFile when filename-based and header-based detection both fail.
   * Checks the raw file content for the position_tracking_pages metadata signature.
   */
  static matchesRawContent(rawContent: string): boolean {
    return rawContent.includes('position_tracking_pages');
  }

  static matchesContent(_headers: string[]): boolean {
    return false; // uses matchesRawContent instead
  }

  constructor(rawContent: string) {
    // Strip the metadata header block before passing to BaseParser's CSV parser.
    // The block ends after the second `-----` line. Find it and slice past it.
    super(SemrushPositionTrackingParser.stripMetadataHeader(rawContent));
  }

  private static stripMetadataHeader(content: string): string {
    const lines = content.split('\n');
    let dashCount = 0;
    let csvStartIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('---')) {
        dashCount++;
        if (dashCount === 2) {
          // CSV starts after this line (skip any blank lines)
          csvStartIndex = i + 1;
          while (csvStartIndex < lines.length && lines[csvStartIndex].trim() === '') {
            csvStartIndex++;
          }
          break;
        }
      }
    }

    return lines.slice(csvStartIndex).join('\n');
  }

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const urlCol = this.findColumn(['URL', 'Landing Page']);
    const avgPositionCol = this.findColumn(['Average Position', 'Avg. Position']);
    const keywordsCol = this.findColumn(['Keywords (Organic)', 'Keywords', 'Number of Keywords']);
    const trafficCol = this.findColumn(['Traffic Forecast', 'Traffic']);

    if (!urlCol) return {};

    const trackedPages: Array<{ url: string; avg_position: number; keyword_count: number; traffic_forecast: number }> = [];
    const perUrlAvgPosition: Record<string, number> = {};

    for (const row of this.data) {
      const url = toString(row[urlCol]);
      if (!url) continue;

      const avgPosition = toNumber(row[avgPositionCol ?? '']) ?? 0;
      const keywords = toNumber(row[keywordsCol ?? '']) ?? 0;
      const traffic = toNumber(row[trafficCol ?? '']) ?? 0;

      trackedPages.push({ url, avg_position: avgPosition, keyword_count: keywords, traffic_forecast: traffic });
      perUrlAvgPosition[url] = avgPosition;
    }

    trackedPages.sort((a, b) => b.traffic_forecast - a.traffic_forecast);

    return {
      tracked_pages: trackedPages,
      per_url_avg_position: perUrlAvgPosition,
      total_tracked_pages: trackedPages.length,
    };
  }
}
```

- [ ] **Step 4: Update `findParserForFile` in `lib/parsers/index.ts` to call `matchesRawContent`**

In the `findParserForFile` function, the `matchesRawContent` path is already scaffolded from Task 2. But we need to pass the full raw content, not just the first line. Update the parse route call in Task 15 to pass full content. For now ensure the import is in place.

- [ ] **Step 5: Run tests — confirm they pass**

```bash
npx vitest run lib/parsers/semrush/semrushPositionTracking.parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Create `lib/parsers/semrush/index.ts`**

```typescript
export { SemrushOrganicPositionsParser } from './semrushOrganicPositions.parser';
export { SemrushOrganicPagesParser } from './semrushOrganicPages.parser';
export { SemrushPositionTrackingParser } from './semrushPositionTracking.parser';
```

- [ ] **Step 7: Commit**

```bash
git add lib/parsers/semrush/
git commit -m "feat(parser): add SemrushPositionTrackingParser with metadata header stripping"
```

---

## Task 12: Register all new parsers + update index exports

**Files:**
- Modify: `lib/parsers/index.ts`
- Modify: `lib/parsers/content/index.ts`
- Modify: `lib/parsers/resources/index.ts`
- Modify: `lib/parsers/performance/index.ts`

- [ ] **Step 1: Update `lib/parsers/content/index.ts`**

Add exports:

```typescript
export { ExactDuplicatesParser } from './exactDuplicates.parser';
export { NearDuplicatesParser } from './nearDuplicates.parser';
```

- [ ] **Step 2: Update `lib/parsers/resources/index.ts`**

Add:

```typescript
export { AllInlinksParser } from './allInlinks.parser';
```

- [ ] **Step 3: Update `lib/parsers/performance/index.ts`**

Add:

```typescript
export { PageSpeedOpportunitiesParser } from './pagespeedOpportunities.parser';
```

- [ ] **Step 4: Update `lib/parsers/index.ts`**

Add imports at the top:

```typescript
import { ExactDuplicatesParser, NearDuplicatesParser } from './content';
import { AllInlinksParser } from './resources';
import { PageSpeedOpportunitiesParser } from './performance';
import {
  SemrushOrganicPositionsParser,
  SemrushOrganicPagesParser,
  SemrushPositionTrackingParser,
} from './semrush';
```

Add to the `PARSERS` array (after the existing Content parsers, before Issues):

```typescript
// Content — duplicate detection
ExactDuplicatesParser,
NearDuplicatesParser,

// Resources — link analysis
AllInlinksParser,

// Performance — opportunities
PageSpeedOpportunitiesParser,

// SEMRush
SemrushOrganicPositionsParser,
SemrushOrganicPagesParser,
SemrushPositionTrackingParser,
```

Add to `PARSER_MAP`:

```typescript
exactduplicates: ExactDuplicatesParser,
nearduplicates: NearDuplicatesParser,
allinlinks: AllInlinksParser,
pagespeedopportunities: PageSpeedOpportunitiesParser,
semrushorganicpositions: SemrushOrganicPositionsParser,
semrushorganicpages: SemrushOrganicPagesParser,
semrushpositiontracking: SemrushPositionTrackingParser,
```

Update `findParserForFile` to also handle `matchesRawContent` for Position Tracking. Replace the function body with:

```typescript
export function findParserForFile(
  filename: string,
  rawContent?: string
): typeof BaseParser | null {
  // 1. Filename-based detection
  for (const ParserClass of PARSERS) {
    if (ParserClass.matchesFile(filename)) {
      return ParserClass;
    }
  }

  if (!rawContent) return null;

  // 2. Raw content detection (for files with metadata headers, e.g. Position Tracking)
  for (const ParserClass of PARSERS) {
    const cls = ParserClass as unknown as { matchesRawContent?(content: string): boolean };
    if (cls.matchesRawContent?.(rawContent)) {
      return ParserClass;
    }
  }

  // 3. Header-based detection (for clean CSV files with dynamic filenames, e.g. Organic Positions/Pages)
  const firstLine = rawContent.replace(/^\uFEFF/, '').split('\n')[0] ?? '';
  const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  for (const ParserClass of PARSERS) {
    if (ParserClass.matchesContent(headers)) {
      return ParserClass;
    }
  }

  return null;
}
```

- [ ] **Step 5: Add re-exports for new parsers at bottom of `lib/parsers/index.ts`**

```typescript
export { ExactDuplicatesParser, NearDuplicatesParser };
export { AllInlinksParser };
export { PageSpeedOpportunitiesParser };
export { SemrushOrganicPositionsParser, SemrushOrganicPagesParser, SemrushPositionTrackingParser };
```

- [ ] **Step 6: Run all parser tests to confirm nothing is broken**

```bash
npx vitest run lib/parsers/ 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/parsers/index.ts lib/parsers/content/index.ts lib/parsers/resources/index.ts lib/parsers/performance/index.ts
git commit -m "feat(parsers): register all new parsers; update findParserForFile for content-based detection"
```

---

## Task 13: Update parse route to pass raw content to `findParserForFile`

**Files:**
- Modify: `app/api/parse/[sessionId]/route.ts`

- [ ] **Step 1: Update the parse loop**

In `app/api/parse/[sessionId]/route.ts`, find this block:

```typescript
const ParserClass = findParserForFile(filename);
if (!ParserClass) return null;

try {
  const content = await fs.readFile(filePath, 'utf-8');
```

Replace with (read content first, then pass to `findParserForFile`):

```typescript
let content: string;
try {
  content = await fs.readFile(filePath, 'utf-8');
} catch {
  errors.push(`Could not read file: ${filename}`);
  return null;
}

// Skip non-CSV files (e.g. .txt stored for future use)
if (!filename.toLowerCase().endsWith('.csv')) return null;

const ParserClass = findParserForFile(filename, content);
if (!ParserClass) return null;

try {
```

- [ ] **Step 2: Run a quick type check**

```bash
npx tsc --noEmit 2>&1 | grep "parse\[sessionId\]" | head -5
```

Expected: no errors in that file.

- [ ] **Step 3: Commit**

```bash
git add app/api/parse/[sessionId]/route.ts
git commit -m "feat(parse-route): pass raw content to findParserForFile for SEMRush detection"
```

---

## Task 14: Update AggregatorService — duplicate content + keyword signals + link analysis

**Files:**
- Modify: `lib/services/aggregator.service.ts`

This is the largest single task. Read the full `aggregator.service.ts` before making changes.

- [ ] **Step 1: Read `lib/services/aggregator.service.ts` in full**

```bash
wc -l lib/services/aggregator.service.ts
```

Read the file to understand `addParserResult` and `aggregate` signatures before modifying.

- [ ] **Step 2: Add `computeDuplicateContent` method**

Add this private method to `AggregatorService`:

```typescript
private computeDuplicateContent(): import('../types').DuplicateContent | undefined {
  const exactPairs = this.parserResults['exactduplicates']?.exact_duplicate_pairs as Array<{
    address: string; duplicate_of: string; similarity_pct: number; indexability: string;
  }> ?? [];

  const nearEntries = this.parserResults['nearduplicates']?.near_duplicate_entries as Array<{
    address: string; closest_match: string; near_duplicate_count: number;
  }> ?? [];

  // Compute duplicate titles from PageTitlesParser data
  const titleGroups = this.computeDuplicateGroups('pagetitles', 'title');
  const metaGroups = this.computeDuplicateGroups('metadescription', 'meta_description');
  const h1Groups = this.computeDuplicateGroups('h1', 'h1');

  const hasAny = exactPairs.length > 0 || nearEntries.length > 0 ||
    titleGroups.length > 0 || metaGroups.length > 0 || h1Groups.length > 0;

  if (!hasAny) return undefined;

  return {
    exact_duplicates: exactPairs,
    near_duplicates: nearEntries,
    duplicate_titles: titleGroups,
    duplicate_meta_descriptions: metaGroups,
    duplicate_h1s: h1Groups,
  };
}

private computeDuplicateGroups(
  parserKey: string,
  _fieldHint: string
): Array<{ value: string; affected_urls: string[] }> {
  // Duplicate groups are already computed inside PageTitlesParser, MetaDescriptionParser, H1Parser
  // and stored as issues with type 'duplicate_title', 'duplicate_meta_description', 'duplicate_h1'
  // Pull them from the collected issues
  const allIssues = this.collectedIssues.filter(
    i => i.type === `duplicate_${_fieldHint}` || i.type === `duplicate_${_fieldHint}s`
  );
  if (allIssues.length === 0) return [];

  const groups: Array<{ value: string; affected_urls: string[] }> = [];
  for (const issue of allIssues) {
    if (issue.groups) {
      for (const g of issue.groups) {
        const value = g.title ?? g.h1 ?? '';
        if (value && !groups.some(existing => existing.value === value)) {
          groups.push({ value: value.slice(0, 200), affected_urls: issue.urls ?? [] });
        }
      }
    }
  }
  return groups;
}
```

> **Note:** `this.collectedIssues` needs to be a private array that `addParserResult` populates. Check whether this already exists in `aggregator.service.ts`. If not, add `private collectedIssues: Issue[] = [];` and populate it in `addParserResult`.

- [ ] **Step 3: Add `computeKeywordSignals` method**

```typescript
private computeKeywordSignals(): import('../types').KeywordSignals | undefined {
  const positionsResult = this.parserResults['semrushorganicpositions'];
  const pagesResult = this.parserResults['semrushorganicpages'];
  const internalResult = this.parserResults['internal'];

  const gscData = internalResult?.gsc_data as { connected?: boolean } | undefined;
  const semrushConnected = !!positionsResult;
  const gscConnected = gscData?.connected === true;

  if (!semrushConnected && !gscConnected) return undefined;

  const cannibalization = (positionsResult?.keyword_cannibalization as import('../types').CannibalizedKeyword[]) ?? [];
  const quickWins = (positionsResult?.quick_wins as import('../types').QuickWin[]) ?? [];
  const topPages = (pagesResult?.top_pages_by_organic_traffic as import('../types').TopOrganicPage[]) ?? [];
  const totalKeywords = (positionsResult?.total_ranking_keywords as number) ?? 0;

  // Compute optimization gaps: pages where title/H1 shares no tokens with top ranking keywords
  const optimizationGaps: import('../types').OptimizationGap[] = [];
  const perUrlKeywords = positionsResult?.per_url_keywords as Record<string, Array<{ keyword: string; position: number; search_volume: number }>> | undefined;

  if (perUrlKeywords && internalResult) {
    const urlData = internalResult.per_url_seo_data as Record<string, { title: string; h1: string }> | undefined;
    const STOPWORDS = new Set(['the', 'a', 'an', 'in', 'of', 'for', 'and', 'or', 'to', 'with', 'at', 'by', 'from']);

    const tokenize = (text: string): Set<string> => {
      return new Set(
        text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
          .filter(t => t.length > 2 && !STOPWORDS.has(t))
      );
    };

    for (const [url, keywords] of Object.entries(perUrlKeywords)) {
      const pageData = urlData?.[url];
      if (!pageData) continue;

      const top3 = keywords.slice(0, 3);
      const pageTitleTokens = tokenize(pageData.title);
      const pageH1Tokens = tokenize(pageData.h1);
      const pageTokens = new Set([...pageTitleTokens, ...pageH1Tokens]);

      const hasOverlap = top3.some(kw =>
        tokenize(kw.keyword).size > 0 && [...tokenize(kw.keyword)].some(t => pageTokens.has(t))
      );

      if (!hasOverlap && top3.length > 0) {
        optimizationGaps.push({
          url,
          title: pageData.title,
          h1: pageData.h1,
          top_ranking_keywords: top3.map(k => ({ keyword: k.keyword, position: k.position, search_volume: k.search_volume })),
        });
      }
    }

    // Sort by traffic desc using SEMRush Pages data
    const perUrlTraffic = pagesResult?.per_url_traffic as Record<string, number> | undefined;
    if (perUrlTraffic) {
      optimizationGaps.sort((a, b) => (perUrlTraffic[b.url] ?? 0) - (perUrlTraffic[a.url] ?? 0));
    }
  }

  return {
    semrush_connected: semrushConnected,
    gsc_connected: gscConnected,
    total_ranking_keywords: totalKeywords,
    keyword_cannibalization: cannibalization,
    optimization_gaps: optimizationGaps.slice(0, 20),
    quick_wins: quickWins.slice(0, 50),
    top_pages_by_organic_traffic: topPages,
  };
}
```

> **Note:** For optimization gaps to work, `InternalParser` must expose `per_url_seo_data` — a map of URL → `{ title, h1 }`. Add this to `InternalParser.parse()`: after `parseSeoElements()`, build and attach `per_url_seo_data` from the title and h1 columns.

- [ ] **Step 4: Add `computeLinkAnalysis` method**

```typescript
private computeLinkAnalysis(): import('../types').LinkAnalysis | undefined {
  const inlinksResult = this.parserResults['allinlinks'];
  if (!inlinksResult) return undefined;

  return {
    total_internal_links: (inlinksResult.total_internal_links as number) ?? 0,
    nofollow_ratio_pct: (inlinksResult.nofollow_ratio_pct as number) ?? 0,
    non_descriptive_anchor_pct: (inlinksResult.non_descriptive_anchor_pct as number) ?? 0,
    top_linked_pages: (inlinksResult.top_linked_pages as import('../types').TopLinkedPage[]) ?? [],
    top_anchor_texts: (inlinksResult.top_anchor_texts as import('../types').TopAnchorText[]) ?? [],
  };
}
```

- [ ] **Step 5: Update `computePerformanceSummary` to include new fields**

Inside the existing `computePerformanceSummary` (or wherever `performance` is built in `aggregate()`), add:

```typescript
// PageSpeed opportunities
const psOpps = this.parserResults['pagespeedopportunities'];
if (psOpps?.opportunities) {
  performance.pagespeed_opportunities = psOpps.opportunities as import('../types').PageSpeedOpportunity[];
}

// GSC top pages (from InternalParser)
const internalGsc = this.parserResults['internal']?.gsc_data as {
  connected?: boolean;
  top_pages_by_impressions?: import('../types').GscPageStat[];
} | undefined;
if (internalGsc?.connected) {
  performance.gsc_top_pages = internalGsc.top_pages_by_impressions?.slice(0, 50) ?? [];
}

// GA4 top pages (from InternalParser)
const internalGa4 = this.parserResults['internal']?.ga4_data as {
  connected?: boolean;
  top_pages_by_sessions?: import('../types').Ga4PageStat[];
} | undefined;
if (internalGa4?.connected) {
  performance.ga4_top_pages = internalGa4.top_pages_by_sessions?.slice(0, 50) ?? [];
}
```

- [ ] **Step 6: Add new issue entries to `ISSUE_RECOMMENDATIONS` map**

```typescript
exact_duplicate_pages: 'Resolve {count} exact duplicate pages with canonical tags or 301 redirects.',
near_duplicate_pages: 'Review {count} near-duplicate pages for keyword cannibalization — consolidate or differentiate content.',
keyword_cannibalization: 'Fix keyword cannibalization across {count} keyword groups — designate one canonical page per keyword cluster.',
pagespeed_opportunities: 'Address {count} PageSpeed opportunities to improve Core Web Vitals and search ranking signals.',
```

- [ ] **Step 7: Call new methods in `aggregate()`**

At the end of `aggregate()`, before returning `result`, add:

```typescript
const duplicateContent = this.computeDuplicateContent();
if (duplicateContent) result.duplicate_content = duplicateContent;

const keywordSignals = this.computeKeywordSignals();
if (keywordSignals) result.keyword_signals = keywordSignals;

const linkAnalysis = this.computeLinkAnalysis();
if (linkAnalysis) result.link_analysis = linkAnalysis;
```

- [ ] **Step 8: Add `per_url_seo_data` to InternalParser**

In `lib/parsers/internal.parser.ts`, in the `parse()` method, add after existing optional fields:

```typescript
// Build per-URL SEO metadata map for use by AggregatorService (optimization gap detection)
const perUrlSeoData: Record<string, { title: string; h1: string }> = {};
const titleCol = this.getColumn('title');
const h1Col = this.getColumn('h1');
if (titleCol || h1Col) {
  for (const row of this.data) {
    const url = addressCol ? toString(row[addressCol]) : '';
    if (!url) continue;
    perUrlSeoData[url] = {
      title: titleCol ? toString(row[titleCol]) : '',
      h1: h1Col ? toString(row[h1Col]) : '',
    };
  }
  result.per_url_seo_data = perUrlSeoData;
}
```

- [ ] **Step 9: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Fix any type errors before committing.

- [ ] **Step 10: Commit**

```bash
git add lib/services/aggregator.service.ts lib/parsers/internal.parser.ts
git commit -m "feat(aggregator): add duplicate content, keyword signals, and link analysis aggregation"
```

---

## Task 15: Update upload route and FileDropzone for .txt + folder upload

**Files:**
- Modify: `app/api/upload/route.ts`
- Modify: `components/seo-parser/FileDropzone.tsx`

- [ ] **Step 1: Update upload route to accept `.txt` files**

In `app/api/upload/route.ts`, find:

```typescript
if (ext === '.csv' || value.type === 'text/csv') {
```

Replace with:

```typescript
if (ext === '.csv' || ext === '.txt' || value.type === 'text/csv' || value.type === 'text/plain') {
```

Also update the error message:

```typescript
return NextResponse.json({ error: 'No CSV or TXT files uploaded' }, { status: 400 });
```

And the success sanitizer — update `sanitizeFilename` to default to `'file.csv'` only for `.csv` files, `'file.txt'` for `.txt`:

```typescript
function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[/\\]/g, '_')
    .replace(/\0/g, '')
    .replace(/\.\./g, '_');
  const ext = sanitized.endsWith('.txt') ? 'file.txt' : 'file.csv';
  return sanitized || ext;
}
```

- [ ] **Step 2: Update `FileDropzone` for .txt accept + folder upload button**

Replace the contents of `components/seo-parser/FileDropzone.tsx` with:

```typescript
'use client';

import { useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileDropzoneProps {
  files: string[];
  isUploading: boolean;
  onDrop: (files: File[]) => void;
}

export function FileDropzone({ files, isUploading, onDrop }: FileDropzoneProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      const validFiles = acceptedFiles.filter(f => {
        const name = f.name.toLowerCase();
        return name.endsWith('.csv') || name.endsWith('.txt');
      });
      if (validFiles.length > 0) onDrop(validFiles);
    },
    [onDrop]
  );

  const handleFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter(f => {
        const name = f.name.toLowerCase();
        return name.endsWith('.csv') || name.endsWith('.txt');
      });
      if (files.length > 0) onDrop(files);
      // Reset so the same folder can be re-selected
      if (folderInputRef.current) folderInputRef.current.value = '';
    },
    [onDrop]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    multiple: true,
    disabled: isUploading,
  });

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive ? 'border-[#f5a623] bg-orange-50 dark:bg-orange-500/5' : 'border-gray-300 dark:border-navy-border hover:border-[#f5a623]'}
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        <div className="space-y-2">
          <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-white/40" stroke="currentColor" fill="none" viewBox="0 0 48 48">
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {isUploading ? (
            <p className="text-gray-600 dark:text-white/60">Uploading...</p>
          ) : isDragActive ? (
            <p className="text-[#f5a623] font-medium">Drop files here</p>
          ) : (
            <>
              <p className="text-gray-600 dark:text-white/60">Drag and drop Screaming Frog exports or SEMRush CSVs here</p>
              <p className="text-sm text-gray-500 dark:text-white/50">or click to select individual files (.csv, .txt)</p>
            </>
          )}
        </div>
      </div>

      {/* Folder upload button */}
      <div className="flex justify-center">
        <button
          type="button"
          disabled={isUploading}
          onClick={() => folderInputRef.current?.click()}
          className="px-4 py-2 text-sm font-medium text-[#1c2d4a] dark:text-white border border-gray-300 dark:border-navy-border rounded-lg hover:border-[#f5a623] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          Upload Folder
        </button>
        {/* Hidden folder input — webkitdirectory makes browser send all files in selected folder */}
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is not in React's HTMLInputElement types but is supported by all modern browsers
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={handleFolderChange}
          disabled={isUploading}
        />
      </div>

      {files.length > 0 && (
        <div className="bg-gray-50 dark:bg-navy-deep rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-white/70 mb-2">Uploaded Files ({files.length})</h3>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {files.map((file, index) => (
              <li key={index} className="text-sm text-gray-600 dark:text-white/60 flex items-center">
                <svg className="w-4 h-4 mr-2 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit 2>&1 | grep -E "FileDropzone|upload/route" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/upload/route.ts components/seo-parser/FileDropzone.tsx
git commit -m "feat(upload): accept .txt files and add folder upload support"
```

---

## Task 16: Update SummaryCard with GSC metrics

**Files:**
- Modify: `components/seo-parser/SummaryCard.tsx`

- [ ] **Step 1: Read the full `SummaryCard.tsx` first**

```bash
cat components/seo-parser/SummaryCard.tsx
```

- [ ] **Step 2: Add GSC metrics to the summary**

The `SummaryCard` receives `CrawlSummary`. Update it to also accept optional `keywordSignals` and `performance` props, or pass them through `result`. Check how `ResultsView` calls `SummaryCard` and thread the new data.

In `SummaryCard.tsx`, update the props interface to accept optional GSC totals:

```typescript
interface SummaryCardProps {
  summary: CrawlSummary;
  healthScore?: number;
  gscTotals?: { clicks: number; impressions: number; avg_position: number } | null;
}
```

At the bottom of the stat list, add conditionally:

```typescript
{gscTotals && (
  <>
    <div className="pt-2 border-t border-gray-100 dark:border-navy-border mt-2">
      <p className="text-xs font-semibold text-gray-400 dark:text-white/30 uppercase tracking-wide mb-2">GSC (last 3 months)</p>
    </div>
    <StatItem label="Total Clicks" value={gscTotals.clicks} />
    <StatItem label="Total Impressions" value={gscTotals.impressions} />
    <StatItem label="Avg Position" value={gscTotals.avg_position.toFixed(1)} />
  </>
)}
```

- [ ] **Step 3: Update `ResultsView.tsx` to compute and pass GSC totals**

In `ResultsView.tsx`, compute GSC totals from `result`:

```typescript
const gscTotals = (() => {
  const pages = result.performance?.gsc_top_pages;
  if (!pages || pages.length === 0) return null;
  const clicks = pages.reduce((s, p) => s + p.clicks, 0);
  const impressions = pages.reduce((s, p) => s + p.impressions, 0);
  const avgPos = pages.reduce((s, p) => s + p.average_position, 0) / pages.length;
  return { clicks, impressions, avg_position: Math.round(avgPos * 10) / 10 };
})();
```

Pass to `<SummaryCard>`:

```typescript
<SummaryCard summary={result.crawl_summary} healthScore={result.metadata.health_score} gscTotals={gscTotals} />
```

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/SummaryCard.tsx components/seo-parser/ResultsView.tsx
git commit -m "feat(ui): add GSC summary metrics to SummaryCard"
```

---

## Task 17: Create DuplicateContentSection component

**Files:**
- Create: `components/seo-parser/DuplicateContentSection.tsx`

- [ ] **Step 1: Implement the component**

```typescript
// components/seo-parser/DuplicateContentSection.tsx
'use client';

import { useState } from 'react';
import { DuplicateContent } from '@/lib/types';

interface DuplicateContentSectionProps {
  data: DuplicateContent;
}

function Badge({ count, color = 'orange' }: { count: number; color?: string }) {
  const colors: Record<string, string> = {
    orange: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400',
    red: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
    yellow: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors[color] ?? colors.orange}`}>
      {count}
    </span>
  );
}

function TableSection({ title, items, columns }: {
  title: string;
  items: Array<Record<string, unknown>>;
  columns: Array<{ key: string; label: string }>;
}) {
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  if (items.length === 0) return null;

  const paged = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 dark:text-white/70 mb-2">
        {title} <Badge count={items.length} />
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-navy-deep">
              {columns.map(c => (
                <th key={c.key} className="text-left py-2 px-3 font-medium text-gray-500 dark:text-white/50 border-b border-gray-200 dark:border-navy-border">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((item, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-navy-border hover:bg-gray-50 dark:hover:bg-navy-deep/50">
                {columns.map(c => (
                  <td key={c.key} className="py-2 px-3 text-gray-700 dark:text-white/70 break-all max-w-xs truncate" title={String(item[c.key] ?? '')}>
                    {String(item[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > PAGE_SIZE && (
        <div className="flex gap-2 mt-2 justify-end">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="text-xs px-2 py-1 border rounded disabled:opacity-40 dark:border-navy-border dark:text-white/60">
            Prev
          </button>
          <span className="text-xs text-gray-500 dark:text-white/50 self-center">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, items.length)} of {items.length}
          </span>
          <button disabled={(page + 1) * PAGE_SIZE >= items.length} onClick={() => setPage(p => p + 1)}
            className="text-xs px-2 py-1 border rounded disabled:opacity-40 dark:border-navy-border dark:text-white/60">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export function DuplicateContentSection({ data }: DuplicateContentSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const totalCount =
    data.exact_duplicates.length +
    data.near_duplicates.length +
    data.duplicate_titles.length +
    data.duplicate_meta_descriptions.length +
    data.duplicate_h1s.length;

  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">
            Duplicate Content
          </h2>
          <Badge count={totalCount} color="orange" />
        </div>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-xs text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/60 transition-colors"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TableSection
              title="Exact Duplicates"
              items={data.exact_duplicates}
              columns={[
                { key: 'address', label: 'URL' },
                { key: 'duplicate_of', label: 'Duplicate Of' },
                { key: 'indexability', label: 'Indexable' },
              ]}
            />
            <TableSection
              title="Near Duplicates"
              items={data.near_duplicates}
              columns={[
                { key: 'address', label: 'URL' },
                { key: 'closest_match', label: 'Closest Match' },
                { key: 'near_duplicate_count', label: 'Count' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <TableSection
              title="Duplicate Titles"
              items={data.duplicate_titles.map(g => ({ value: g.value, urls: g.affected_urls.join(', ') }))}
              columns={[
                { key: 'value', label: 'Title' },
                { key: 'urls', label: 'Affected URLs' },
              ]}
            />
            <TableSection
              title="Duplicate Meta Descriptions"
              items={data.duplicate_meta_descriptions.map(g => ({ value: g.value, urls: g.affected_urls.join(', ') }))}
              columns={[
                { key: 'value', label: 'Meta Description' },
                { key: 'urls', label: 'Affected URLs' },
              ]}
            />
            <TableSection
              title="Duplicate H1s"
              items={data.duplicate_h1s.map(g => ({ value: g.value, urls: g.affected_urls.join(', ') }))}
              columns={[
                { key: 'value', label: 'H1' },
                { key: 'urls', label: 'Affected URLs' },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/seo-parser/DuplicateContentSection.tsx
git commit -m "feat(ui): add DuplicateContentSection component"
```

---

## Task 18: Create KeywordSignalsPanel component

**Files:**
- Create: `components/seo-parser/KeywordSignalsPanel.tsx`

- [ ] **Step 1: Implement the component**

```typescript
// components/seo-parser/KeywordSignalsPanel.tsx
'use client';

import { useState } from 'react';
import { KeywordSignals, CannibalizedKeyword, QuickWin, OptimizationGap, TopOrganicPage } from '@/lib/types';

function Card({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">{title}</h3>
        {count !== undefined && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const colors: Record<string, string> = {
    informational: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400',
    navigational: 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400',
    commercial: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400',
    transactional: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
    unknown: 'bg-gray-100 dark:bg-gray-500/15 text-gray-600 dark:text-gray-400',
  };
  const normalized = intent.toLowerCase().split(/[,/]/)[0].trim();
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[normalized] ?? colors.unknown}`}>
      {normalized}
    </span>
  );
}

function CannibalizationCard({ items }: { items: CannibalizedKeyword[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (items.length === 0) return <p className="text-xs text-gray-400 dark:text-white/40">No cannibalization detected.</p>;

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {items.slice(0, 30).map(item => (
        <div key={item.keyword} className="border border-gray-100 dark:border-navy-border rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-navy-deep/50 transition-colors"
            onClick={() => setExpanded(e => e === item.keyword ? null : item.keyword)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-gray-800 dark:text-white truncate">{item.keyword}</span>
              <IntentBadge intent={item.intent} />
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              <span className="text-xs text-gray-400 dark:text-white/40">{item.search_volume.toLocaleString()} vol</span>
              <span className="text-xs text-red-500">{item.competing_urls.length} URLs</span>
            </div>
          </button>
          {expanded === item.keyword && (
            <div className="px-3 pb-2 bg-gray-50 dark:bg-navy-deep/30 space-y-1">
              {item.competing_urls.map(u => (
                <div key={u.url} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 dark:text-white/60 truncate max-w-xs" title={u.url}>{u.url}</span>
                  <span className="text-gray-400 dark:text-white/40 ml-2 flex-shrink-0">pos {u.position} · {u.estimated_traffic} traffic</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function QuickWinsCard({ items }: { items: QuickWin[] }) {
  if (items.length === 0) return <p className="text-xs text-gray-400 dark:text-white/40">No quick wins found (position 11–20, volume ≥ 100).</p>;

  return (
    <div className="space-y-1.5 max-h-80 overflow-y-auto">
      {items.slice(0, 30).map((item, i) => (
        <div key={i} className="flex items-start justify-between py-1.5 border-b border-gray-100 dark:border-navy-border last:border-0">
          <div className="min-w-0 mr-3">
            <p className="text-xs font-medium text-gray-800 dark:text-white">{item.keyword}</p>
            <p className="text-xs text-gray-400 dark:text-white/40 truncate max-w-xs" title={item.url}>{item.url}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <IntentBadge intent={item.intent} />
            <span className="text-xs text-gray-500 dark:text-white/50">#{item.position}</span>
            <span className="text-xs font-medium text-gray-700 dark:text-white/70">{item.search_volume.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function OptimizationGapsCard({ items }: { items: OptimizationGap[] }) {
  if (items.length === 0) return <p className="text-xs text-gray-400 dark:text-white/40">No optimization gaps detected.</p>;

  return (
    <div className="space-y-3 max-h-80 overflow-y-auto">
      {items.slice(0, 20).map((item, i) => (
        <div key={i} className="border border-gray-100 dark:border-navy-border rounded-lg p-3">
          <p className="text-xs text-gray-400 dark:text-white/40 truncate mb-1" title={item.url}>{item.url}</p>
          <p className="text-xs font-medium text-gray-800 dark:text-white mb-0.5">Title: <span className="font-normal text-gray-600 dark:text-white/60">{item.title || '(missing)'}</span></p>
          <p className="text-xs font-medium text-gray-800 dark:text-white mb-1">H1: <span className="font-normal text-gray-600 dark:text-white/60">{item.h1 || '(missing)'}</span></p>
          <p className="text-xs text-gray-500 dark:text-white/50">Ranking for: {item.top_ranking_keywords.map(k => `"${k.keyword}" (#${k.position})`).join(', ')}</p>
        </div>
      ))}
    </div>
  );
}

function TopPagesCard({ items }: { items: TopOrganicPage[] }) {
  if (items.length === 0) return <p className="text-xs text-gray-400 dark:text-white/40">No traffic data available.</p>;

  return (
    <div className="space-y-1.5 max-h-80 overflow-y-auto">
      {items.map((item, i) => (
        <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-navy-border last:border-0">
          <div className="min-w-0 mr-3">
            <p className="text-xs text-gray-700 dark:text-white/70 truncate max-w-xs" title={item.url}>{item.url}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <IntentBadge intent={item.dominant_intent} />
            <span className="text-xs text-gray-400 dark:text-white/40">{item.keyword_count} kw</span>
            <span className="text-xs font-semibold text-gray-800 dark:text-white">{item.estimated_monthly_traffic.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface KeywordSignalsPanelProps {
  data: KeywordSignals;
}

export function KeywordSignalsPanel({ data }: KeywordSignalsPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">
          Keyword Signals
        </h2>
        <span className="text-xs text-gray-400 dark:text-white/40">
          {data.total_ranking_keywords.toLocaleString()} ranking keywords · SEMRush
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Cannibalization Alerts" count={data.keyword_cannibalization.length}>
          <CannibalizationCard items={data.keyword_cannibalization} />
        </Card>
        <Card title="Quick Wins" count={data.quick_wins.length}>
          <QuickWinsCard items={data.quick_wins} />
        </Card>
        <Card title="Optimization Gaps" count={data.optimization_gaps.length}>
          <OptimizationGapsCard items={data.optimization_gaps} />
        </Card>
        <Card title="Top Organic Pages" count={data.top_pages_by_organic_traffic.length}>
          <TopPagesCard items={data.top_pages_by_organic_traffic} />
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/seo-parser/KeywordSignalsPanel.tsx
git commit -m "feat(ui): add KeywordSignalsPanel with cannibalization, quick wins, and optimization gaps"
```

---

## Task 19: Wire new sections into ResultsView

**Files:**
- Modify: `components/seo-parser/ResultsView.tsx`

- [ ] **Step 1: Add imports to `ResultsView.tsx`**

```typescript
import { DuplicateContentSection } from './DuplicateContentSection';
import { KeywordSignalsPanel } from './KeywordSignalsPanel';
```

- [ ] **Step 2: Add sections after the existing chart cards**

In `ResultsView.tsx`, after the closing of the chart row, add:

```tsx
{/* Duplicate Content */}
{result.duplicate_content && (
  <DuplicateContentSection data={result.duplicate_content} />
)}

{/* Keyword Signals */}
{result.keyword_signals?.semrush_connected && (
  <KeywordSignalsPanel data={result.keyword_signals} />
)}

{/* GSC-only notice when no SEMRush data */}
{result.keyword_signals?.gsc_connected && !result.keyword_signals?.semrush_connected && (
  <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg p-4 text-sm text-blue-700 dark:text-blue-300">
    GSC data available in the summary above. Add SEMRush Organic Research exports to unlock keyword signals, cannibalization detection, and quick wins.
  </div>
)}
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Fix any type errors.

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/ResultsView.tsx
git commit -m "feat(ui): wire DuplicateContentSection and KeywordSignalsPanel into ResultsView"
```

---

## Task 20: Build verification + smoke test

- [ ] **Step 1: Run all tests**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all tests pass, no failures.

- [ ] **Step 2: TypeScript full check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Next.js production build**

```bash
npm run build 2>&1 | tail -30
```

Expected: build succeeds with no errors. Warnings about `use client` boundaries are OK.

- [ ] **Step 4: Smoke test with real files**

Start dev server and upload the test directory:

```bash
npm run dev
```

Upload `/Users/kevinvogelgesang/Enrollment-Resources/clients/testing/` using the "Upload Folder" button.

Verify:
- All 22 SF files are detected and parsed (check parsers_used in the response)
- All 3 SEMRush files are detected (semrushorganicpositions, semrushorganicpages, semrushpositiontracking in parsers_used)
- Results page shows Duplicate Content section
- Results page shows Keyword Signals panel
- SummaryCard shows GSC metrics

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete SEO parser expansion — SF filename patterns, GSC/GA4, 7 new parsers, duplicate content, keyword signals"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Directory upload (.csv + .txt) | Task 15 |
| SF filename pattern fixes (14 parsers) | Task 3 |
| InternalParser GSC/GA4 extraction | Task 4 |
| ExactDuplicatesParser | Task 5 |
| NearDuplicatesParser | Task 6 |
| PageSpeedOpportunitiesParser | Task 7 |
| AllInlinksParser (aggregate-only) | Task 8 |
| SemrushOrganicPositionsParser | Task 9 |
| SemrushOrganicPagesParser | Task 10 |
| SemrushPositionTrackingParser | Task 11 |
| Content-based detection in findParserForFile | Task 2 + Task 12 |
| Parse route passes content to findParserForFile | Task 13 |
| duplicate_content in result JSON | Task 14 |
| keyword_signals in result JSON | Task 14 |
| link_analysis in result JSON | Task 14 |
| Optimization gap detection | Task 14 |
| New issues (8 types) | Tasks 5, 6, 7, 14 |
| SummaryCard GSC metrics | Task 16 |
| DuplicateContentSection UI | Task 17 |
| KeywordSignalsPanel UI | Task 18 |
| Wire into ResultsView | Task 19 |
| Build verification | Task 20 |

**Placeholder scan:** None found.

**Type consistency check:**
- `DuplicateContent`, `KeywordSignals`, `LinkAnalysis` defined in Task 1; used in Tasks 14, 17, 18 — consistent.
- `GscPageStat`, `Ga4PageStat` defined in Task 1; produced by InternalParser (Task 4), consumed by aggregator (Task 14) — consistent.
- `per_url_seo_data` produced by InternalParser (Task 14 step 8) and consumed by `computeKeywordSignals` (Task 14 step 3) — consistent.
- `per_url_keywords` produced by SemrushOrganicPositionsParser (Task 9), consumed by `computeKeywordSignals` — consistent.
- `per_url_traffic` produced by SemrushOrganicPagesParser (Task 10), consumed by `computeKeywordSignals` for sorting optimization gaps — consistent.
