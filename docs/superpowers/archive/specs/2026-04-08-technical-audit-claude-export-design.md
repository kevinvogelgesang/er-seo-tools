# Technical Audit Claude Export — Design Spec

**Date:** 2026-04-08  
**Status:** Approved

## Problem

The SEO Parser produces a single JSON output (currently ~13MB for large audits) that serves both the UI and any downstream use. The stated goal of the tool is to give Claude a condensed, actionable set of issues in JSON format to generate Technical SEO fix recommendations for an SEO professional. At 13MB this is too large for a Claude chat session.

The bulk comes from four sources:
1. **SEMRush `per_url_keyword_data`** — top 3 keywords for every URL in the SEMRush export (5–8MB)
2. **Issue `urls[]` arrays** — some parsers store full URL lists without caps (2–4MB)
3. **Duplicate content groups** — `affected_urls[]` per title/meta/H1 group (0.5–1MB)
4. **Analytics per-page arrays** — `gsc_top_pages`, `ga4_top_pages` (0.5–1MB)

## Solution

Add a second export path — **"Export Technical Audit for Claude"** — that transforms the full stored `AggregatedResult` at download time into a lean `TechnicalAuditExport` focused exclusively on technical SEO issues. The existing full JSON, storage, and parsing pipeline are unchanged.

## Approach

- Transform at export time (read full stored JSON, strip on the fly, return)
- No schema changes, no changes to parsing, no changes to existing export
- New dedicated API endpoint + pure transform function + UI button

## Files

### New

**`lib/parsers/claude-export-builder.ts`**  
Pure function: `buildTechnicalAuditExport(result: AggregatedResult): TechnicalAuditExport`  
Also defines the `TechnicalAuditExport` type.  
No side effects. Takes the full result, returns the lean export object.

**`app/api/seo-parser/[id]/claude-export/route.ts`**  
GET handler. Reads the audit record from DB by `[id]`, parses the stored JSON, calls `buildTechnicalAuditExport`, responds with:
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="technical-audit-claude.json"`

### Modified

**SEO parser results page** (wherever the existing export button lives)  
Adds "Export Technical Audit for Claude" button adjacent to the existing export button. Calls `GET /api/seo-parser/[id]/claude-export`.

## TechnicalAuditExport Shape

```typescript
type TechnicalAuditExport = {
  crawl_summary: AggregatedResult['crawl_summary']        // unchanged
  issues: AggregatedResult['issues']                      // unchanged, full urls[]
  technical_seo: AggregatedResult['technical_seo']        // unchanged
  resources: AggregatedResult['resources']                // unchanged
  site_structure: {
    crawl_depth_distribution: Record<number, number>
    hreflang_languages?: Record<string, number>
    non_indexable_reasons?: Array<{ Address: string; reason: string }>
    // internal_link_distribution OMITTED — informational
  }
  duplicate_content?: AggregatedResult['duplicate_content'] // unchanged
  performance: {
    core_web_vitals?: Record<string, number>              // summary scores kept
    server_response?: Record<string, number>              // response time distribution kept
    pagespeed_opportunities?: PageSpeedOpportunity[]      // kept — actionable
    gsc_summary?: {                                       // replaces gsc_top_pages
      total_clicks: number
      total_impressions: number
      avg_position: number
    }
    ga4_summary?: {                                       // replaces ga4_top_pages
      total_sessions: number
      avg_bounce_rate?: number
    }
    // gsc_top_pages OMITTED
    // ga4_top_pages OMITTED
    // ga4_traffic raw stat block OMITTED
    // search_console raw stat block OMITTED
  }
  link_analysis?: {
    total_internal_links?: number
    nofollow_ratio_pct?: number
    non_descriptive_anchor_pct?: number
    // top_linked_pages OMITTED — informational
    // top_anchor_texts OMITTED — informational
  }
  recommendations: string[]                               // unchanged
  metadata: AggregatedResult['metadata']                  // unchanged
  // keyword_signals OMITTED ENTIRELY — reserved for future keyword research feature
}
```

## What Is Excluded and Why

| Excluded | Reason |
|---|---|
| `keyword_signals` (entire section) | SEMRush keyword data is for on-page/content work, not technical fixes. Reserved for future keyword research feature. |
| `performance.gsc_top_pages` | Per-page traffic list — informational, not a technical fix |
| `performance.ga4_top_pages` | Per-page traffic list — informational, not a technical fix |
| `performance.ga4_traffic` (raw stat block) | Rolled into `ga4_summary` |
| `performance.search_console` (raw stat block) | Rolled into `gsc_summary` |
| `site_structure.internal_link_distribution` | Informational distribution map, not an actionable issue |
| `link_analysis.top_linked_pages` | Informational ranking, not a fix |
| `link_analysis.top_anchor_texts` | Informational distribution, not a fix |

## What Is Preserved and Why

All `issues[]` arrays including full `urls[]` — Claude needs specific page URLs to generate actionable fix directions for the SEO professional.

All `duplicate_content` data including `affected_urls[]` — duplicate titles, metas, H1s, and exact duplicate pages are technical SEO fixes.

All `technical_seo` data — canonicals, directives, structured data, security, sitemaps are all actionable.

`pagespeed_opportunities` — these include specific URLs with estimated savings, making them directly actionable.

## Expected Size Impact

Removing `keyword_signals` alone eliminates the largest contributor (est. 5–8MB on SEMRush-connected audits). Replacing analytics per-page arrays with summaries removes another 0.5–1MB. Remaining size is proportional to the number of real technical issues found — which is the correct behavior.

## Out of Scope

- Changes to what gets stored in the database
- Changes to the existing JSON export
- Changes to any parser or the parsing pipeline
- Any UI changes beyond adding one export button
