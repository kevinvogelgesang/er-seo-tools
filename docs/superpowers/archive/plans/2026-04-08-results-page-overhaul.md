# Results Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the SEO parser results page with a full-width layout, fix issue title formatting, add paginated URL lists with external-link icons, remove URL caps from the data layer, and filter spelling/grammar from JSON export.

**Architecture:** Five sequential tasks — data layer first (types + parsers + aggregator), then export filter, then new MetricsBar component, then ResultsView restructure, then IssueList improvements. Each task is independently shippable and tested before proceeding.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS (dark mode via `dark:` variants), Vitest for tests.

---

## File Structure

| File | Role |
|------|------|
| `lib/types/index.ts` | Remove `truncated` and `total_affected` from `Issue` interface |
| `lib/parsers/base.parser.ts` | Remove default URL limit from `getUrlsWhereMask` |
| `lib/parsers/resources/links.parser.ts` | Remove 30-URL caps in all three parsers |
| `lib/services/aggregator.service.ts` | Remove `.slice(0, 50)` and related assignments in `dedupeIssues` |
| `app/api/export/[sessionId]/[format]/route.ts` | Add spelling/grammar filter for JSON export |
| `components/seo-parser/MetricsBar.tsx` | New — 6 stat tiles, responsive grid |
| `components/seo-parser/ResultsView.tsx` | Replace sidebar layout with full-width + MetricsBar |
| `components/seo-parser/SummaryCard.tsx` | Delete — replaced by MetricsBar |
| `components/seo-parser/IssueList.tsx` | Title formatting, always-visible chevron, paginated URLs, ↗ icons |
| `lib/parsers/resources/links.parser.test.ts` | Update URL cap test to expect all URLs |
| `lib/parsers/base.parser.test.ts` | Add test for unlimited default |
| `lib/services/aggregator.service.test.ts` | New — test URL deduplication without slicing |

---

## Task 1: Remove URL caps from data layer

**Files:**
- Modify: `lib/types/index.ts:3-14`
- Modify: `lib/parsers/base.parser.ts:149-161`
- Modify: `lib/parsers/resources/links.parser.ts:28-29,55-56,99,148`
- Modify: `lib/services/aggregator.service.ts:24-27`
- Modify: `lib/parsers/resources/links.parser.test.ts:167-179`
- Modify: `lib/parsers/base.parser.test.ts`
- Create: `lib/services/aggregator.service.test.ts`

**Context:** The `Issue` type has optional `truncated` and `total_affected` fields that were set when URLs were sliced to 50. Since we're removing the slice, these fields are no longer written and can be removed from the type. Three parsers each have a 30-URL cap, and the aggregator has a 50-URL slice. All caps are removed so the paginated UI can access every URL.

- [ ] **Step 1: Write failing test for aggregator URL deduplication**

Create `lib/services/aggregator.service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AggregatorService } from './aggregator.service';

describe('AggregatorService URL deduplication', () => {
  it('stores all URLs without slicing when count exceeds 50', () => {
    const aggregator = new AggregatorService();
    const urls = Array.from({ length: 100 }, (_, i) => `https://example.com/page-${i}`);
    aggregator.addParserResult('test', {
      issues: [{
        type: 'test_issue',
        severity: 'warning',
        count: 100,
        description: 'test issue',
        urls,
      }],
    }, 'test.csv');
    const result = aggregator.aggregate();
    const allIssues = [
      ...result.issues.critical,
      ...result.issues.warnings,
      ...result.issues.notices,
    ];
    const issue = allIssues.find(i => i.type === 'test_issue');
    expect(issue).toBeDefined();
    expect(issue!.urls?.length).toBe(100);
    expect((issue as Record<string, unknown>).truncated).toBeUndefined();
    expect((issue as Record<string, unknown>).total_affected).toBeUndefined();
  });

  it('deduplicates URLs when the same issue type is added twice', () => {
    const aggregator = new AggregatorService();
    aggregator.addParserResult('test', {
      issues: [{
        type: 'dupe_issue',
        severity: 'warning',
        count: 3,
        description: 'first batch',
        urls: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
      }],
    }, 'test.csv');
    aggregator.addParserResult('test2', {
      issues: [{
        type: 'dupe_issue',
        severity: 'warning',
        count: 2,
        description: 'second batch',
        urls: ['https://example.com/b', 'https://example.com/d'],
      }],
    }, 'test2.csv');
    const result = aggregator.aggregate();
    const allIssues = [
      ...result.issues.critical,
      ...result.issues.warnings,
      ...result.issues.notices,
    ];
    const issue = allIssues.find(i => i.type === 'dupe_issue');
    expect(issue!.urls?.length).toBe(4); // a, b, c, d — b deduplicated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/services/aggregator.service.test.ts
```

Expected: FAIL — `issue!.urls?.length` is 50 (sliced), not 100.

- [ ] **Step 3: Update `Issue` type — remove `truncated` and `total_affected`**

In `lib/types/index.ts`, replace lines 3–14:

```typescript
export interface Issue {
  type: string;
  severity: 'critical' | 'warning' | 'notice';
  count: number;
  description: string;
  urls?: string[];
  groups?: Array<{ title?: string; h1?: string; meta_description?: string; count: number; urls?: string[] }>;
  source?: string;
  threshold?: string;
}
```

- [ ] **Step 4: Remove `.slice(0, 50)` and dead assignments in `dedupeIssues`**

In `lib/services/aggregator.service.ts`, replace lines 21–28:

```typescript
      // Merge URL lists
      const existingUrls = existing.urls || [];
      const newUrls = issue.urls || [];
      if (existingUrls.length > 0 || newUrls.length > 0) {
        existing.urls = Array.from(new Set([...existingUrls, ...newUrls]));
      }
```

- [ ] **Step 5: Remove default limit from `getUrlsWhereMask` in base.parser.ts**

In `lib/parsers/base.parser.ts`, replace the method signature at line 149:

```typescript
  protected getUrlsWhereMask(mask: boolean[], limit: number = Number.MAX_SAFE_INTEGER): string[] {
```

- [ ] **Step 6: Remove 30-URL caps in `links.parser.ts`**

Replace the entire `LinksParser.parse()` broken links block (lines 20–43):

```typescript
    // Broken internal links
    if (statusCol && destCol) {
      const brokenUrls: string[] = [];
      let brokenCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
          brokenUrls.push(toString(this.data[i][destCol]));
        }
      }

      stats.broken_internal_links = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: 'broken_internal_links',
          severity: 'critical',
          count: brokenCount,
          description: `${brokenCount} broken internal links`,
          urls: brokenUrls,
        });
      }
    }
```

Replace the empty anchor block (lines 47–70):

```typescript
    // Empty anchor text
    if (anchorCol) {
      const emptyAnchorUrls: string[] = [];
      let emptyCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const anchor = toString(this.data[i][anchorCol]).trim();
        if (!anchor) {
          emptyCount++;
          if (destCol) {
            emptyAnchorUrls.push(toString(this.data[i][destCol]));
          }
        }
      }

      stats.empty_anchor_text = emptyCount;
      if (emptyCount > 0) {
        issues.push({
          type: 'empty_anchor_text',
          severity: 'warning',
          count: emptyCount,
          description: `${emptyCount} links with empty anchor text`,
          urls: emptyAnchorUrls,
        });
      }
    }
```

In `LinksIssuesParser.parse()`, remove the cap on line 99:

```typescript
      if (addressCol) {
        const url = toString(this.data[i][addressCol]);
        if (url) urls.push(url);
      }
```

In `ExternalLinksParser.parse()`, replace the broken links loop (lines 141–163):

```typescript
    // Broken external links
    if (statusCol && destCol) {
      const brokenUrls: string[] = [];
      let brokenCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
          brokenUrls.push(toString(this.data[i][destCol]));
        }
      }

      stats.broken_external_links = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: 'broken_external_links',
          severity: 'warning',
          count: brokenCount,
          description: `${brokenCount} broken external links`,
          urls: brokenUrls,
        });
      }
    }
```

- [ ] **Step 7: Run the new aggregator test to verify it passes**

```bash
npx vitest run lib/services/aggregator.service.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 8: Update the existing links parser URL cap test**

In `lib/parsers/resources/links.parser.test.ts`, replace the `url cap` describe block (lines 167–179):

```typescript
  describe('url cap removed', () => {
    it('collects all broken link URLs without capping', () => {
      const rows = Array.from({ length: 40 }, (_, i) =>
        `https://example.com/src,https://example.com/broken${i},404,Link ${i}`
      ).join('\n');
      const csv = `Source,Destination,Status Code,Anchor\n${rows}`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_internal_links');
      expect(issue.count).toBe(40);
      expect(issue.urls.length).toBe(40);
    });
  });
```

- [ ] **Step 9: Add test for unlimited getUrlsWhereMask default**

In `lib/parsers/base.parser.test.ts`, after the existing `testGetUrlsWhereMask` tests, add:

```typescript
  describe('getUrlsWhereMask default limit', () => {
    it('collects all matching URLs when no limit is passed', () => {
      const rows = Array.from({ length: 60 }, (_, i) => `https://example.com/page${i}`).join('\n');
      const csv = `Address\n${rows}`;
      const parser = new TestParser(csv);
      const mask = Array(60).fill(true);
      const urls = parser.testGetUrlsWhereMask(mask);
      expect(urls.length).toBe(60);
    });
  });
```

- [ ] **Step 10: Run all parser + aggregator tests**

```bash
npx vitest run lib/parsers lib/services/aggregator.service.test.ts
```

Expected: All pass.

- [ ] **Step 11: Commit**

```bash
git add lib/types/index.ts lib/parsers/base.parser.ts lib/parsers/resources/links.parser.ts lib/services/aggregator.service.ts lib/parsers/resources/links.parser.test.ts lib/parsers/base.parser.test.ts lib/services/aggregator.service.test.ts
git commit -m "fix: remove URL caps from parsers, aggregator, and Issue type"
```

---

## Task 2: Filter spelling/grammar from JSON export

**Files:**
- Modify: `app/api/export/[sessionId]/[format]/route.ts:107-127`

**Context:** The export route streams the full `AggregatedResult` for the `json` format. Spelling and grammar issue types (`spelling_errors`, `grammar_errors`) should be excluded from the download since they're noisy but still useful in the UI. The `summary` and `markdown` formats do their own shaping and are unchanged.

- [ ] **Step 1: Add `filterResultForExport` and apply it in the json branch**

In `app/api/export/[sessionId]/[format]/route.ts`, add the filter function immediately before `makeJsonStream` (before line 107):

```typescript
const EXPORT_EXCLUDED_ISSUE_TYPES = new Set(['spelling_errors', 'grammar_errors']);

function filterResultForExport(result: AggregatedResult): AggregatedResult {
  const filterIssues = (issues: Issue[]) =>
    issues.filter(i => !EXPORT_EXCLUDED_ISSUE_TYPES.has(i.type));
  return {
    ...result,
    issues: {
      critical: filterIssues(result.issues.critical),
      warnings: filterIssues(result.issues.warnings),
      notices: filterIssues(result.issues.notices),
    },
  };
}
```

Then in the `json` format handler (around line 156), apply it:

```typescript
    if (format === 'json') {
      const stream = makeJsonStream(filterResultForExport(result));
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="seo-audit-${sessionId}.json"`,
          'Transfer-Encoding': 'chunked',
        },
      });
    }
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/api/export/[sessionId]/[format]/route.ts'
git commit -m "feat: exclude spelling/grammar issues from JSON export"
```

---

## Task 3: Create MetricsBar component

**Files:**
- Create: `components/seo-parser/MetricsBar.tsx`

**Context:** This new component replaces the `SummaryCard` sidebar. It renders 6 stat tiles in a responsive horizontal grid. The health score tile uses the same color thresholds as the old `HealthBadge` (≥70 = green, ≥40 = orange, <40 = red). `ResultsView` will wire it up in Task 4.

- [ ] **Step 1: Create `MetricsBar.tsx`**

```tsx
interface MetricsBarProps {
  healthScore?: number;
  totalUrls: number;
  criticalCount: number;
  warningsCount: number;
  noticesCount: number;
  indexableUrls?: number;
}

function healthColors(score: number) {
  if (score >= 70) return { ring: 'bg-green-100 dark:bg-green-500/15', text: 'text-green-700 dark:text-green-400', label: 'Good' };
  if (score >= 40) return { ring: 'bg-orange-100 dark:bg-orange-500/15', text: 'text-orange-700 dark:text-orange-400', label: 'Fair' };
  return { ring: 'bg-red-100 dark:bg-red-500/15', text: 'text-red-700 dark:text-red-400', label: 'Poor' };
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg border border-gray-100 dark:border-navy-border p-4 flex flex-col items-center justify-center text-center gap-1">
      {children}
      <span className="text-xs text-gray-500 dark:text-white/50 uppercase tracking-wide font-medium">{label}</span>
    </div>
  );
}

export function MetricsBar({ healthScore, totalUrls, criticalCount, warningsCount, noticesCount, indexableUrls }: MetricsBarProps) {
  const colors = healthScore !== undefined ? healthColors(healthScore) : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Tile label="Health Score">
        {colors && healthScore !== undefined ? (
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${colors.ring}`}>
            <span className={`font-display font-extrabold text-lg leading-none ${colors.text}`}>{healthScore}</span>
          </div>
        ) : (
          <span className="text-2xl font-display font-extrabold text-gray-400 dark:text-white/40">—</span>
        )}
        {colors && <span className={`text-xs font-semibold ${colors.text}`}>{colors.label}</span>}
      </Tile>

      <Tile label="Total URLs">
        <span className="font-display font-extrabold text-2xl text-[#1c2d4a] dark:text-white">{totalUrls.toLocaleString()}</span>
      </Tile>

      <Tile label="Critical">
        <span className="font-display font-extrabold text-2xl text-red-600 dark:text-red-400">{criticalCount}</span>
      </Tile>

      <Tile label="Warnings">
        <span className="font-display font-extrabold text-2xl text-orange-500 dark:text-orange-400">{warningsCount}</span>
      </Tile>

      <Tile label="Notices">
        <span className="font-display font-extrabold text-2xl text-blue-600 dark:text-blue-400">{noticesCount}</span>
      </Tile>

      <Tile label="Indexable">
        {indexableUrls !== undefined ? (
          <span className="font-display font-extrabold text-2xl text-green-600 dark:text-green-400">{indexableUrls.toLocaleString()}</span>
        ) : (
          <span className="text-2xl font-display font-extrabold text-gray-400 dark:text-white/40">—</span>
        )}
      </Tile>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/seo-parser/MetricsBar.tsx
git commit -m "feat: add MetricsBar component — 6 stat tiles, responsive grid"
```

---

## Task 4: Restructure ResultsView layout

**Files:**
- Modify: `components/seo-parser/ResultsView.tsx`
- Delete: `components/seo-parser/SummaryCard.tsx`

**Context:** Replace the 3-column sidebar layout with full-width content. `MetricsBar` replaces the sidebar cards. The `IssuesPieChart` is removed (issue counts are shown in MetricsBar). The parsers footer moves into a `<details>` element. `SummaryCard.tsx` is deleted since it's no longer imported anywhere.

- [ ] **Step 1: Rewrite `ResultsView.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { AggregatedResult } from '@/lib/types';
import { MetricsBar } from './MetricsBar';
import { IssueTabs } from './IssueTabs';
import { RecommendationList } from './RecommendationList';
import { ExportButtons } from './ExportButtons';
import { CopyToClipboard } from './CopyToClipboard';
import { PageDetailModal } from './PageDetailModal';
import { ShareModal } from './ShareModal';
import { DuplicateContentSection } from './DuplicateContentSection';
import { KeywordSignalsPanel } from './KeywordSignalsPanel';

const StatusCodeBarChart = dynamic(() => import('./charts/StatusCodeBarChart').then(m => ({ default: m.StatusCodeBarChart })), { ssr: false });
const CrawlDepthChart = dynamic(() => import('./charts/CrawlDepthChart').then(m => ({ default: m.CrawlDepthChart })), { ssr: false });

interface ResultsViewProps {
  result: AggregatedResult;
  sessionId: string;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <h3 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide mb-4">{title}</h3>
      {children}
    </div>
  );
}

export function ResultsView({ result, sessionId }: ResultsViewProps) {
  const router = useRouter();
  const siteName = result.metadata?.site_name || 'Site';

  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep py-12 px-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-extrabold text-2xl text-[#1c2d4a] dark:text-white">{siteName} — SEO Audit</h1>
            <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
              {result.metadata.files_processed.length} file{result.metadata.files_processed.length !== 1 ? 's' : ''} processed
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <CopyToClipboard result={result} />
            <ExportButtons sessionId={sessionId} />
            <button
              onClick={() => setShareOpen(true)}
              className="px-4 py-2 border border-[#1c2d4a] dark:border-navy-border rounded-lg text-sm text-[#1c2d4a] dark:text-white font-medium hover:bg-[#1c2d4a] hover:text-white transition-colors"
            >
              Share Report
            </button>
            <button
              onClick={() => router.push('/seo-parser')}
              className="px-4 py-2 border border-gray-200 dark:border-navy-border rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
            >
              New Analysis
            </button>
          </div>
        </div>

        {/* Metrics bar */}
        <MetricsBar
          healthScore={result.metadata?.health_score}
          totalUrls={result.crawl_summary.total_urls}
          criticalCount={result.issues.critical.length}
          warningsCount={result.issues.warnings.length}
          noticesCount={result.issues.notices.length}
          indexableUrls={result.crawl_summary.indexable_urls}
        />

        {/* Full-width issues */}
        <IssueTabs issues={result.issues} onUrlClick={(url) => setSelectedUrl(url)} />

        {/* Recommendations */}
        <RecommendationList recommendations={result.recommendations} />

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ChartCard title="Response Code Distribution">
            <StatusCodeBarChart summary={result.crawl_summary} />
          </ChartCard>
          {result.site_structure?.crawl_depth_distribution && (
            <ChartCard title="Crawl Depth Distribution">
              <CrawlDepthChart distribution={result.site_structure.crawl_depth_distribution} />
            </ChartCard>
          )}
        </div>

        {/* Duplicate content section */}
        {result.duplicate_content && (
          <DuplicateContentSection data={result.duplicate_content} />
        )}

        {/* Keyword signals section */}
        {result.keyword_signals && (
          <KeywordSignalsPanel data={result.keyword_signals} />
        )}

        {/* Debug footer */}
        <details className="text-xs text-gray-400 dark:text-white/40 pb-4">
          <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-white/60 select-none">Debug info</summary>
          <p className="mt-1">Parsers used: {result.metadata.parsers_used.join(', ')}</p>
        </details>

      </div>

      {/* Per-page drill-down modal */}
      {selectedUrl !== null && (
        <PageDetailModal
          url={selectedUrl}
          result={result}
          onClose={() => setSelectedUrl(null)}
        />
      )}

      {/* Share report modal */}
      {shareOpen && (
        <ShareModal
          sessionId={sessionId}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Delete `SummaryCard.tsx`**

```bash
rm components/seo-parser/SummaryCard.tsx
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors (SummaryCard import removed, MetricsBar wired correctly).

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/ResultsView.tsx
git rm components/seo-parser/SummaryCard.tsx
git commit -m "feat: full-width results layout with MetricsBar, remove sidebar"
```

---

## Task 5: Improve IssueList rows

**Files:**
- Modify: `components/seo-parser/IssueList.tsx`

**Context:** Three improvements to `IssueItem`:
1. `formatIssueTitle` strips the `sf_` prefix and capitalizes the first letter — purely a display-layer change, no data modified.
2. The expand chevron is now always visible (previously hidden when no URLs/groups). Expanding always shows `issue.description`.
3. URLs are rendered in a paginated scrollable list (50/page) with a `↗` icon on each entry that always opens the URL in a new tab. The existing `onUrlClick` behavior (opens the PageDetailModal) stays on the URL text itself.

- [ ] **Step 1: Rewrite `IssueList.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Issue } from '@/lib/types';
import { SEVERITY_BADGE_COLORS } from '@/lib/constants/severity';

interface IssueListProps {
  issues: Issue[];
  severity: 'critical' | 'warning' | 'notice';
  onUrlClick?: (url: string) => void;
}

const PAGE_SIZE = 50;

function formatIssueTitle(type: string): string {
  const stripped = type.startsWith('sf_') ? type.slice(3) : type;
  const spaced = stripped.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function IssueItem({
  issue,
  severity,
  onUrlClick,
}: {
  issue: Issue;
  severity: 'critical' | 'warning' | 'notice';
  onUrlClick?: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const totalUrls = issue.urls?.length ?? 0;
  const totalPages = Math.ceil(totalUrls / PAGE_SIZE);
  const pagedUrls = issue.urls?.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE) ?? [];
  const hasGroups = issue.groups && issue.groups.length > 0;

  const urlRangeStart = currentPage * PAGE_SIZE + 1;
  const urlRangeEnd = Math.min((currentPage + 1) * PAGE_SIZE, totalUrls);

  return (
    <div className="border border-gray-200 dark:border-navy-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
      >
        <div className="flex items-center space-x-3">
          <span className={`px-2 py-1 text-xs font-medium rounded ${SEVERITY_BADGE_COLORS[severity]}`}>
            {issue.count}
          </span>
          <span className="text-gray-900 dark:text-white font-medium text-sm text-left">
            {formatIssueTitle(issue.type)}
          </span>
        </div>
        <svg
          aria-hidden="true"
          className={`w-5 h-5 text-gray-400 dark:text-white/40 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-navy-deep border-t border-gray-200 dark:border-navy-border">
          {issue.description && (
            <p className="text-sm text-gray-600 dark:text-white/60 mb-3">{issue.description}</p>
          )}

          {totalUrls > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wide">
                  {totalUrls <= PAGE_SIZE
                    ? `Affected URLs — ${totalUrls} total`
                    : `Affected URLs — ${urlRangeStart}–${urlRangeEnd} of ${totalUrls} · export JSON for full list`}
                </p>
              </div>

              <ul className="text-sm space-y-1 max-h-64 overflow-y-auto">
                {pagedUrls.map((url, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-gray-600 dark:text-white/60 min-w-0">
                    {onUrlClick ? (
                      <button
                        type="button"
                        onClick={() => onUrlClick(url)}
                        className="hover:text-[#f5a623] text-left truncate flex-1 underline decoration-dotted underline-offset-2"
                        title={url}
                      >
                        {url}
                      </button>
                    ) : (
                      <span className="truncate flex-1" title={url}>{url}</span>
                    )}
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open in new tab"
                      className="flex-shrink-0 text-gray-400 dark:text-white/30 hover:text-[#f5a623] dark:hover:text-[#f5a623]"
                    >
                      <ExternalLinkIcon />
                    </a>
                  </li>
                ))}
              </ul>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1 border-t border-gray-200 dark:border-navy-border">
                  <span className="text-xs text-gray-400 dark:text-white/40">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                      className="text-xs px-3 py-1 rounded border border-gray-200 dark:border-navy-border text-gray-600 dark:text-white/60 disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#f5a623] hover:text-[#f5a623] transition-colors"
                    >
                      ← Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={currentPage === totalPages - 1}
                      className="text-xs px-3 py-1 rounded border border-gray-200 dark:border-navy-border text-gray-600 dark:text-white/60 disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#f5a623] hover:text-[#f5a623] transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {hasGroups && (
            <div className="space-y-1 mt-2">
              <p className="text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wide">Duplicate Groups</p>
              <ul className="text-sm space-y-2">
                {issue.groups?.map((group, i) => (
                  <li key={i} className="text-gray-600 dark:text-white/60">
                    <span className="font-medium">{group.count}x:</span>{' '}
                    <span className="italic">"{group.title || group.h1}"</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function IssueList({ issues, severity, onUrlClick }: IssueListProps) {
  if (issues.length === 0) {
    return <p className="text-gray-500 dark:text-white/50 text-center py-4 text-sm">No issues found</p>;
  }
  return (
    <div className="space-y-2">
      {issues.map((issue, i) => (
        <IssueItem
          key={`${issue.type}-${i}`}
          issue={issue}
          severity={severity}
          onUrlClick={onUrlClick}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/IssueList.tsx
git commit -m "feat: issue rows — title formatting, always-expandable, paginated URLs with external link icons"
```

---

## Final: Push and deploy

- [ ] **Step 1: Push and deploy**

```bash
git push && ssh $PROD_SSH "~/deploy.sh"
```

Expected: Build succeeds, PM2 restarts, app is online.

- [ ] **Step 2: Verify in browser**

Open a results page and confirm:
- Metrics bar shows 6 tiles at top, no sidebar
- Issue titles have no "sf " prefix ("Content spelling errors" not "sf content spelling errors")
- All issue rows have an expand chevron
- Expanded rows show description text
- URL lists show "Affected URLs — 1–50 of 780 · export JSON for full list" with Prev/Next controls
- Each URL has a ↗ icon that opens in a new tab
- "Export JSON" download does not contain `spelling_errors` or `grammar_errors` issues
- "Debug info" disclosure element at the bottom
