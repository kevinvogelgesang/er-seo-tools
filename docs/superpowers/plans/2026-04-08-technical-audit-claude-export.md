# Technical Audit Claude Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Export Technical Audit for Claude" button that downloads a lean, technical-SEO-only JSON stripped of keyword signals, per-page analytics arrays, and informational link data — while preserving all issue URLs.

**Architecture:** A pure transform function (`buildTechnicalAuditExport`) reads the full stored `AggregatedResult` and returns a `TechnicalAuditExport` object. A new static API route at `/api/export/[sessionId]/claude` calls this function and streams the result as a JSON download. A new button in `ExportButtons.tsx` triggers that route.

**Tech Stack:** TypeScript, Next.js 15 App Router, Vitest

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lib/parsers/claude-export-builder.ts` | `TechnicalAuditExport` type + `buildTechnicalAuditExport` pure function |
| Create | `lib/parsers/claude-export-builder.test.ts` | Vitest unit tests for the transform |
| Create | `app/api/export/[sessionId]/claude/route.ts` | GET handler — reads DB, calls transform, streams JSON download |
| Modify | `components/seo-parser/ExportButtons.tsx` | Adds "Export Technical Audit for Claude" button |

---

## Task 1: Write failing tests for `buildTechnicalAuditExport`

**Files:**
- Create: `lib/parsers/claude-export-builder.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// lib/parsers/claude-export-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildTechnicalAuditExport } from './claude-export-builder';
import type { AggregatedResult } from '@/lib/types';

const mockResult: AggregatedResult = {
  crawl_summary: { total_urls: 100, indexable_urls: 80, non_indexable_urls: 20 },
  issues: {
    critical: [
      {
        type: 'broken_internal_links',
        severity: 'critical',
        count: 5,
        description: '5 broken internal links',
        urls: ['https://example.com/broken-1', 'https://example.com/broken-2'],
      },
    ],
    warnings: [],
    notices: [],
  },
  site_structure: {
    crawl_depth_distribution: { 0: 1, 1: 20, 2: 79 },
    internal_link_distribution: { homepage: 100, about: 50 },
    hreflang_languages: { en: 100 },
    non_indexable_reasons: [{ Address: 'https://example.com/noindex', reason: 'noindex' }],
  },
  resources: { images: { total: 50, stats: { missing_alt: 10 } } },
  technical_seo: {
    canonicals: { total_pages: 100, missing_canonical: 5 },
  },
  performance: {
    core_web_vitals: { lcp: 2500, cls: 0.1 },
    server_response: { avg_ms: 300 },
    pagespeed_opportunities: [
      {
        opportunity: 'render-blocking-resources',
        urls_affected: 10,
        total_savings_ms: 500,
        average_savings_ms: 50,
        total_savings_size_bytes: 0,
      },
    ],
    gsc_top_pages: [
      { url: 'https://example.com/page1', clicks: 100, impressions: 1000, ctr_pct: 10, average_position: 5 },
      { url: 'https://example.com/page2', clicks: 50, impressions: 500, ctr_pct: 10, average_position: 8 },
    ],
    ga4_top_pages: [
      {
        url: 'https://example.com/page1',
        sessions: 200,
        views: 300,
        engaged_sessions: 150,
        bounce_rate_pct: 25,
        average_session_duration_seconds: 120,
      },
    ],
    ga4_traffic: { total_sessions: 200, avg_bounce_rate: 0.25 },
    search_console: { total_clicks: 150, total_impressions: 1500, avg_position: 6.5 },
  },
  duplicate_content: {
    exact_duplicates: [
      {
        address: 'https://example.com/a',
        duplicate_of: 'https://example.com/b',
        similarity_pct: 100,
        indexability: 'Indexable',
      },
    ],
    near_duplicates: [],
    duplicate_titles: [{ title: 'Home', affected_urls: ['https://example.com/', 'https://example.com/home'] }],
    duplicate_meta_descriptions: [],
    duplicate_h1s: [],
  },
  keyword_signals: {
    semrush_connected: true,
    gsc_connected: true,
    ga4_connected: true,
    total_ranking_keywords: 5000,
    keyword_cannibalization: [
      {
        keyword: 'seo tools',
        search_volume: 1000,
        intent: 'commercial',
        competing_urls: [{ url: 'https://example.com/tools', position: 3, estimated_traffic: 200 }],
      },
    ],
    optimization_gaps: [],
    quick_wins: [
      {
        keyword: 'seo checker',
        position: 15,
        search_volume: 500,
        intent: 'informational',
        url: 'https://example.com/tools',
      },
    ],
    top_pages_by_organic_traffic: [],
  },
  link_analysis: {
    total_internal_links: 500,
    nofollow_ratio_pct: 5,
    non_descriptive_anchor_pct: 10,
    top_linked_pages: [{ url: 'https://example.com/', inlink_count: 100 }],
    top_anchor_texts: [{ anchor_text: 'click here', count: 50, is_descriptive: false }],
  },
  recommendations: ['Fix broken links', 'Add missing alt text'],
  metadata: {
    files_processed: ['internal_all.csv'],
    parsers_used: ['InternalParser'],
    total_parsers_available: 40,
    health_score: 72,
  },
};

describe('buildTechnicalAuditExport', () => {
  it('excludes keyword_signals entirely', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result).not.toHaveProperty('keyword_signals');
  });

  it('excludes performance.gsc_top_pages', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance).not.toHaveProperty('gsc_top_pages');
  });

  it('excludes performance.ga4_top_pages', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance).not.toHaveProperty('ga4_top_pages');
  });

  it('excludes performance.ga4_traffic raw block', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance).not.toHaveProperty('ga4_traffic');
  });

  it('excludes performance.search_console raw block', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance).not.toHaveProperty('search_console');
  });

  it('replaces gsc_top_pages with gsc_summary derived from search_console stats', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance.gsc_summary).toEqual({
      total_clicks: 150,
      total_impressions: 1500,
      avg_position: 6.5,
    });
  });

  it('replaces ga4_top_pages with ga4_summary derived from ga4_traffic stats', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance.ga4_summary).toEqual({
      total_sessions: 200,
      avg_bounce_rate: 0.25,
    });
  });

  it('omits gsc_summary when no search_console stats present', () => {
    const noGsc = { ...mockResult, performance: { core_web_vitals: { lcp: 2500 } } };
    const result = buildTechnicalAuditExport(noGsc);
    expect(result.performance).not.toHaveProperty('gsc_summary');
  });

  it('omits ga4_summary when no ga4_traffic stats present', () => {
    const noGa4 = { ...mockResult, performance: { core_web_vitals: { lcp: 2500 } } };
    const result = buildTechnicalAuditExport(noGa4);
    expect(result.performance).not.toHaveProperty('ga4_summary');
  });

  it('excludes site_structure.internal_link_distribution', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.site_structure).not.toHaveProperty('internal_link_distribution');
  });

  it('preserves site_structure.crawl_depth_distribution', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.site_structure.crawl_depth_distribution).toEqual({ 0: 1, 1: 20, 2: 79 });
  });

  it('preserves site_structure.hreflang_languages', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.site_structure.hreflang_languages).toEqual({ en: 100 });
  });

  it('preserves site_structure.non_indexable_reasons', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.site_structure.non_indexable_reasons).toHaveLength(1);
  });

  it('excludes link_analysis.top_linked_pages', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.link_analysis).not.toHaveProperty('top_linked_pages');
  });

  it('excludes link_analysis.top_anchor_texts', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.link_analysis).not.toHaveProperty('top_anchor_texts');
  });

  it('preserves link_analysis scalar metrics', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.link_analysis?.total_internal_links).toBe(500);
    expect(result.link_analysis?.nofollow_ratio_pct).toBe(5);
    expect(result.link_analysis?.non_descriptive_anchor_pct).toBe(10);
  });

  it('preserves issues with full urls arrays', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.issues.critical[0].urls).toEqual([
      'https://example.com/broken-1',
      'https://example.com/broken-2',
    ]);
  });

  it('preserves duplicate_content unchanged', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.duplicate_content?.exact_duplicates).toHaveLength(1);
    expect(result.duplicate_content?.duplicate_titles[0].affected_urls).toHaveLength(2);
  });

  it('preserves crawl_summary unchanged', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.crawl_summary).toEqual(mockResult.crawl_summary);
  });

  it('preserves performance.pagespeed_opportunities', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance.pagespeed_opportunities).toHaveLength(1);
    expect(result.performance.pagespeed_opportunities![0].opportunity).toBe('render-blocking-resources');
  });

  it('preserves performance.core_web_vitals', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance.core_web_vitals).toEqual({ lcp: 2500, cls: 0.1 });
  });

  it('preserves recommendations unchanged', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.recommendations).toEqual(['Fix broken links', 'Add missing alt text']);
  });

  it('preserves metadata unchanged', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.metadata).toEqual(mockResult.metadata);
  });

  it('handles result with no link_analysis', () => {
    const noLinks = { ...mockResult, link_analysis: undefined };
    const result = buildTechnicalAuditExport(noLinks);
    expect(result.link_analysis).toBeUndefined();
  });

  it('handles result with no duplicate_content', () => {
    const noDups = { ...mockResult, duplicate_content: undefined };
    const result = buildTechnicalAuditExport(noDups);
    expect(result.duplicate_content).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (module not found)**

```bash
cd /path/to/er-seo-tools && npx vitest run lib/parsers/claude-export-builder.test.ts
```

Expected: `Error: Cannot find module './claude-export-builder'`

---

## Task 2: Implement `TechnicalAuditExport` type + `buildTechnicalAuditExport`

**Files:**
- Create: `lib/parsers/claude-export-builder.ts`

- [ ] **Step 1: Create the implementation file**

```typescript
// lib/parsers/claude-export-builder.ts
import type {
  AggregatedResult,
  CrawlSummary,
  IssuesResult,
  ResourcesSummary,
  TechnicalSummary,
  DuplicateContent,
  PageSpeedOpportunity,
} from '@/lib/types';

export interface TechnicalAuditSiteStructure {
  crawl_depth_distribution?: Record<number, number>;
  non_indexable_reasons?: Array<Record<string, string>>;
  hreflang_languages?: Record<string, number>;
}

export interface GscSummary {
  total_clicks: number;
  total_impressions: number;
  avg_position: number;
}

export interface Ga4Summary {
  total_sessions: number;
  avg_bounce_rate?: number;
}

export interface TechnicalAuditPerformance {
  core_web_vitals?: Record<string, number>;
  server_response?: Record<string, number>;
  pagespeed_opportunities?: PageSpeedOpportunity[];
  gsc_summary?: GscSummary;
  ga4_summary?: Ga4Summary;
}

export interface TechnicalAuditLinkAnalysis {
  total_internal_links?: number;
  nofollow_ratio_pct?: number;
  non_descriptive_anchor_pct?: number;
}

export interface TechnicalAuditExport {
  crawl_summary: CrawlSummary;
  issues: IssuesResult;
  site_structure: TechnicalAuditSiteStructure;
  resources: ResourcesSummary;
  technical_seo: TechnicalSummary;
  performance: TechnicalAuditPerformance;
  duplicate_content?: DuplicateContent;
  link_analysis?: TechnicalAuditLinkAnalysis;
  recommendations: string[];
  metadata: AggregatedResult['metadata'];
}

export function buildTechnicalAuditExport(result: AggregatedResult): TechnicalAuditExport {
  const { site_structure, performance, link_analysis } = result;

  const technicalSiteStructure: TechnicalAuditSiteStructure = {
    crawl_depth_distribution: site_structure.crawl_depth_distribution,
    hreflang_languages: site_structure.hreflang_languages,
    non_indexable_reasons: site_structure.non_indexable_reasons,
  };

  const technicalPerformance: TechnicalAuditPerformance = {
    core_web_vitals: performance.core_web_vitals,
    server_response: performance.server_response,
    pagespeed_opportunities: performance.pagespeed_opportunities,
  };

  if (performance.search_console) {
    const sc = performance.search_console;
    if (sc.total_clicks !== undefined || sc.total_impressions !== undefined || sc.avg_position !== undefined) {
      technicalPerformance.gsc_summary = {
        total_clicks: sc.total_clicks ?? 0,
        total_impressions: sc.total_impressions ?? 0,
        avg_position: sc.avg_position ?? 0,
      };
    }
  }

  if (performance.ga4_traffic) {
    const ga4 = performance.ga4_traffic;
    if (ga4.total_sessions !== undefined) {
      technicalPerformance.ga4_summary = {
        total_sessions: ga4.total_sessions,
        avg_bounce_rate: ga4.avg_bounce_rate,
      };
    }
  }

  let technicalLinkAnalysis: TechnicalAuditLinkAnalysis | undefined;
  if (link_analysis) {
    technicalLinkAnalysis = {
      total_internal_links: link_analysis.total_internal_links,
      nofollow_ratio_pct: link_analysis.nofollow_ratio_pct,
      non_descriptive_anchor_pct: link_analysis.non_descriptive_anchor_pct,
    };
  }

  return {
    crawl_summary: result.crawl_summary,
    issues: result.issues,
    site_structure: technicalSiteStructure,
    resources: result.resources,
    technical_seo: result.technical_seo,
    performance: technicalPerformance,
    duplicate_content: result.duplicate_content,
    link_analysis: technicalLinkAnalysis,
    recommendations: result.recommendations,
    metadata: result.metadata,
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run lib/parsers/claude-export-builder.test.ts
```

Expected: All 24 tests pass, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add lib/parsers/claude-export-builder.ts lib/parsers/claude-export-builder.test.ts
git commit -m "feat: add buildTechnicalAuditExport — technical-SEO-only JSON transform"
```

---

## Task 3: Add API route `/api/export/[sessionId]/claude`

**Files:**
- Create: `app/api/export/[sessionId]/claude/route.ts`

Note: In Next.js App Router, static path segments take priority over dynamic ones, so `claude/route.ts` matches before `[format]/route.ts` for requests ending in `/claude`.

- [ ] **Step 1: Create the route**

```typescript
// app/api/export/[sessionId]/claude/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isValidSessionId } from '@/lib/upload-helpers';
import { AggregatedResult } from '@/lib/types';
import { buildTechnicalAuditExport } from '@/lib/parsers/claude-export-builder';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ sessionId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, result: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status !== 'complete' || !session.result) {
      return NextResponse.json({ error: 'Parsing not complete' }, { status: 400 });
    }

    const full = JSON.parse(session.result) as AggregatedResult;
    const export_ = buildTechnicalAuditExport(full);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify(export_, null, 2)));
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="technical-audit-claude-${sessionId.slice(0, 8)}.json"`,
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Claude export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/export/[sessionId]/claude/route.ts
git commit -m "feat: add /api/export/[sessionId]/claude route for technical audit download"
```

---

## Task 4: Add "Export Technical Audit for Claude" button to `ExportButtons.tsx`

**Files:**
- Modify: `components/seo-parser/ExportButtons.tsx`

The existing component maps over `['json', 'summary', 'markdown']` with a `Format` type and shared `handleExport` handler. The Claude export uses a different endpoint (`/api/export/${sessionId}/claude` instead of `/api/export/${sessionId}/${format}`), so it gets its own handler rather than being jammed into the existing format map.

- [ ] **Step 1: Update `ExportButtons.tsx`**

Replace the entire file content with:

```tsx
'use client';

import { useState } from 'react';
import { Spinner } from '@/components/Spinner';

interface ExportButtonsProps {
  sessionId: string;
}

type Format = 'json' | 'summary' | 'markdown';

const EXTENSIONS: Record<Format, string> = {
  json: 'json',
  summary: 'txt',
  markdown: 'md',
};

export function ExportButtons({ sessionId }: ExportButtonsProps) {
  const [loading, setLoading] = useState<Format | 'claude' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: Format) => {
    setLoading(format);
    setError(null);
    try {
      const res = await fetch(`/api/export/${sessionId}/${format}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seo-report-${sessionId.slice(0, 8)}.${EXTENSIONS[format]}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(null);
    }
  };

  const handleClaudeExport = async () => {
    setLoading('claude');
    setError(null);
    try {
      const res = await fetch(`/api/export/${sessionId}/claude`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `technical-audit-claude-${sessionId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {(['json', 'summary', 'markdown'] as Format[]).map((format) => {
          const labels: Record<Format, string> = {
            json: 'Export JSON',
            summary: 'Export Summary',
            markdown: 'Export Markdown',
          };
          const colors: Record<Format, string> = {
            json: 'bg-[#1c2d4a] hover:bg-[#0f1d30]',
            summary: 'bg-gray-600 hover:bg-gray-700',
            markdown: 'bg-green-700 hover:bg-green-800',
          };
          return (
            <button
              key={format}
              onClick={() => void handleExport(format)}
              disabled={loading !== null}
              className={`px-4 py-2 ${colors[format]} text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5`}
            >
              {loading === format && <Spinner />}
              {labels[format]}
            </button>
          );
        })}
        <button
          onClick={() => void handleClaudeExport()}
          disabled={loading !== null}
          className="px-4 py-2 bg-[#c07f2a] hover:bg-[#a86e22] text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {loading === 'claude' && <Spinner />}
          Export Technical Audit for Claude
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Verify the build compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/ExportButtons.tsx
git commit -m "feat: add Export Technical Audit for Claude button to SEO parser results"
```

---

## Post-implementation verification

- [ ] Run `npm run build` locally and confirm no build errors
- [ ] Start dev server (`npm run dev`), run a parse session, open results page, confirm the new button appears
- [ ] Click "Export Technical Audit for Claude" — confirm download starts and the filename matches `technical-audit-claude-<8chars>.json`
- [ ] Open the downloaded file — confirm `keyword_signals` is absent, `gsc_top_pages` is absent, `gsc_summary` is present (if GSC data was in the audit)
- [ ] Confirm existing JSON / Summary / Markdown exports are unaffected
