# SEO Parser Expansion — Design Spec
**Date:** 2026-04-08  
**Status:** Approved  
**Scope:** Expand the existing `/seo-parser` tool to support a fuller Screaming Frog export bundle, add SEMRush data ingestion, surface keyword signals and duplicate content, and enable directory-based uploads.

---

## Background

The current parser handles ~40 Screaming Frog CSV exports but has three gaps:
1. Filename patterns don't match SF's current `_all` suffix convention, so many exports silently fail to parse.
2. GSC and GA4 columns present in `internal_all.csv` (when SF is connected to both) are dropped.
3. No support for SEMRush exports, duplicate content detection, or keyword signals.

This spec addresses all three. A future separate spec will cover the full keyword research tool (SF + GSC + SEMRush + page text analysis).

---

## AI Consumability Directive

The aggregated result JSON is designed to be consumed by an AI as well as by the UI. All field names must be self-describing, units explicit, arrays ordered by relevance (most actionable first), and no ambiguous abbreviations. This directive applies to every new field added to the result JSON.

---

## Export Bundle

### Screaming Frog exports (upload these)

| File | Source in SF |
|------|-------------|
| `internal_all.csv` | Internal tab → Export All (GSC + GA4 connected) |
| `page_titles_all.csv` | Page Titles tab → Export All |
| `meta_description_all.csv` | Meta Descriptions tab → Export All |
| `h1_all.csv` | H1 tab → Export All |
| `h2_all.csv` | H2 tab → Export All |
| `response_codes_all.csv` | Response Codes tab → Export All |
| `canonicals_all.csv` | Canonicals tab → Export All |
| `directives_all.csv` | Directives tab → Export All |
| `images_all.csv` | Images tab → Export All |
| `javascript_all.csv` | JavaScript tab → Export All |
| `internal_css.csv` | CSS tab → Export All |
| `security_all.csv` | Security tab → Export All |
| `structured_data_all.csv` | Structured Data tab → Export All |
| `pagespeed_all.csv` | PageSpeed tab → Export All |
| `sitemaps_all.csv` | Sitemaps tab → Export All |
| `content_near_duplicates.csv` | Content tab → Near Duplicates filter → Export |
| `exact_duplicates_report.csv` | Bulk Exports → Content:Exact Duplicates |
| `all_inlinks.csv` | Bulk Exports → Links → All Inlinks |
| `issues_overview_report.csv` | Reports → Issues → Export Issues Overview |
| `redirects.csv` | Reports → Redirects:All Redirects |
| `redirect_chains.csv` | Reports → Redirects:Redirect Chains |
| `pagespeed_opportunities_summary.csv` | Reports → PageSpeed:PageSpeed Opportunities Summary |

### SEMRush exports (include in same upload bundle)

| Report | Export path in SEMRush |
|--------|------------------------|
| Organic Research Positions | Organic Research → Positions tab → Export → CSV (all keywords) |
| Organic Research Pages | Organic Research → Pages tab → Export → CSV |
| Position Tracking Landing Pages | Position Tracking → Landing Pages tab → Export → CSV |

SEMRush filenames are dynamic (date-stamped, account-prefixed). Detection is by header content, not filename.

---

## Upload & File Detection

### Directory upload
- Add a "Upload Folder" option to the file input using `webkitdirectory` attribute alongside the existing file picker.
- The upload route accepts `.csv` and `.txt` files only. `.txt` files are stored but not parsed (reserved for the future "All Page Text" keyword research feature).
- Both flat directories and directories with one level of subdirectory (e.g. SF's timestamped export folder) are supported — the route walks one level deep when needed.

### SF file detection
All existing filename patterns updated to match the `_all` suffix convention. Old patterns retained as fallbacks for backwards compatibility.

| Parser | Patterns (in priority order) |
|--------|------------------------------|
| PageTitlesParser | `page_titles_all`, `page_titles` |
| MetaDescriptionParser | `meta_description_all`, `meta_descriptions` |
| H1Parser | `h1_all`, `h1` |
| H2Parser | `h2_all`, `h2` |
| CanonicalsParser | `canonicals_all`, `canonicals` |
| DirectivesParser | `directives_all`, `directives` |
| ImagesParser | `images_all`, `images` |
| JavaScriptParser | `javascript_all`, `javascript` |
| CSSParser | `internal_css`, `css` |
| SecurityParser | `security_all`, `security` |
| StructuredDataParser | `structured_data_all`, `structured_data` |
| PageSpeedParser | `pagespeed_all`, `pagespeed` |
| SitemapsParser | `sitemaps_all`, `sitemaps` |
| ResponseCodesParser | `response_codes_all`, `response_codes` |
| NearDuplicatesParser | `content_near_duplicates` |

### SEMRush file detection
Detected by inspecting the header row (or metadata block), not the filename.

| Parser | Detection signal |
|--------|-----------------|
| SemrushOrganicPositionsParser | Headers contain: `Keyword`, `Search Volume`, `Keyword Intents`, `URL` |
| SemrushOrganicPagesParser | Headers contain: `Number of Keywords`, `Adwords Positions` |
| SemrushPositionTrackingParser | File starts with `-----` metadata block; `Report type: position_tracking_pages` line present |

---

## New & Updated Parsers

### InternalParser (updated)
Extract additional columns when present:
- GSC: `Clicks`, `Impressions`, `CTR`, `Position`
- GA4: `GA4 Sessions`, `GA4 Views`, `GA4 Engaged sessions`, `GA4 Engagement rate`, `GA4 Bounce rate`, `GA4 Average session duration`

### ExactDuplicatesParser (new)
- File: `exact_duplicates_report.csv`
- Columns: Address, Exact Duplicate Address, Similarity, Indexability, Indexability Status
- Filters out tracking/pixel URLs before storing: skip rows where Address contains query parameters matching patterns `gtm=`, `pid=`, `v=3&t=`, or URLs longer than 300 characters.

### NearDuplicatesParser (new — replaces reliance on `Near Duplicate` column in internal_all)
- File: `content_near_duplicates.csv`
- Columns: Address, Closest Near Duplicate Match, No. Near Duplicates, Indexability, Indexability Status, Canonical Link Element 1
- When this file is present, supersedes the near-duplicate data from the `Near Duplicate` column in `internal_all.csv`.

### PageSpeedOpportunitiesParser (new)
- File: `pagespeed_opportunities_summary.csv`
- Columns: Opportunity, Number of URLs Affected, Total Savings ms, Average Savings ms, Total Savings Size Bytes, Average Savings Size Bytes
- Filters out rows where `Number of URLs Affected` is 0.

### AllInlinksParser (new)
- File: `all_inlinks.csv`
- **Aggregate only** — does not store rows. File can exceed 200K rows; only summary stats are persisted.
- Columns: Type, Source, Destination, Anchor, Follow, Status Code, Link Position
- Extracts: total internal link count, nofollow ratio, top 20 most-linked-to pages (by inlink count), anchor text distribution (descriptive vs non-descriptive ratio), top 20 anchor texts by frequency.

### SemrushOrganicPositionsParser (new)
- Detection: headers contain `Keyword`, `Search Volume`, `Keyword Intents`, `URL`
- Columns used: Keyword, URL, Position, Previous position, Search Volume, Keyword Difficulty, Traffic, Traffic (%), Keyword Intents
- Derives:
  - **Cannibalization alerts**: group by keyword; any keyword with 2+ distinct URLs → cannibalization candidate. Sorted by Search Volume descending.
  - **Quick wins**: Position 11–20, Search Volume ≥ 100, sorted by Search Volume descending.
  - **Per-URL keyword rollup**: for joining with InternalParser data to compute optimization gaps.

### SemrushOrganicPagesParser (new)
- Detection: headers contain `Number of Keywords`, `Adwords Positions`
- Columns used: URL, Traffic (%), Number of Keywords, Traffic, intent breakdown columns
- Extracts: top 20 pages by Traffic descending, with keyword count and dominant intent type.

### SemrushPositionTrackingParser (new)
- Detection: file starts with `-----` metadata block containing `position_tracking_pages`
- Skips all lines until the first blank line after the metadata block, then parses as CSV.
- Columns used: URL (or landing page column), keyword count, average position, estimated traffic.
- Provides a secondary traffic/position signal per URL for cross-referencing with Organic Pages data.

---

## Computed Aggregations (in AggregatorService)

These are derived during aggregation, not by individual parsers:

### Duplicate title/meta/H1 detection
After PageTitlesParser, MetaDescriptionParser, and H1Parser run:
- Group non-empty values; any value appearing on 2+ URLs is flagged as a duplicate.
- Stored in `duplicate_content.duplicate_titles`, `duplicate_meta_descriptions`, `duplicate_h1s`.

### Optimization gap detection
After SemrushOrganicPositionsParser and InternalParser both run:
- For each URL in the SEMRush positions data, find its top 3 ranking keywords by Traffic descending.
- Tokenize those keywords (lowercase, remove stopwords).
- Tokenize the page's `Title 1` and `H1-1` from InternalParser.
- If no token overlap exists → optimization gap.
- Sorted by SEMRush Traffic descending (highest-traffic gaps first).

---

## Result JSON Shape (new fields)

All new fields are additive. Existing fields unchanged.

```typescript
keyword_signals: {
  semrush_connected: boolean,           // true if any SEMRush file was parsed
  gsc_connected: boolean,               // true if internal_all had GSC columns
  total_ranking_keywords: number,       // total keyword rows in Organic Positions export
  keyword_cannibalization: Array<{
    keyword: string,
    search_volume: number,
    intent: string,
    competing_urls: Array<{
      url: string,
      position: number,
      estimated_traffic: number,
    }>,
  }>,                                   // sorted by search_volume descending
  optimization_gaps: Array<{
    url: string,
    title: string,
    h1: string,
    top_ranking_keywords: Array<{
      keyword: string,
      position: number,
      search_volume: number,
    }>,
  }>,                                   // sorted by estimated_traffic descending
  quick_wins: Array<{
    keyword: string,
    position: number,
    search_volume: number,
    intent: string,
    url: string,
  }>,                                   // sorted by search_volume descending, position 11-20 only
  top_pages_by_organic_traffic: Array<{
    url: string,
    estimated_monthly_traffic: number,
    keyword_count: number,
    traffic_share_pct: number,
    dominant_intent: string,            // intent type with highest keyword count for that page (informational/navigational/commercial/transactional)
  }>,                                   // top 20, sorted by estimated_monthly_traffic descending
}

duplicate_content: {
  exact_duplicates: Array<{
    address: string,
    duplicate_of: string,
    similarity_pct: number,
    indexability: string,
  }>,
  near_duplicates: Array<{
    address: string,
    closest_match: string,
    near_duplicate_count: number,
  }>,
  duplicate_titles: Array<{
    title: string,
    affected_urls: string[],
  }>,
  duplicate_meta_descriptions: Array<{
    meta_description: string,
    affected_urls: string[],
  }>,
  duplicate_h1s: Array<{
    h1: string,
    affected_urls: string[],
  }>,
}

// Added to existing performance object:
performance: {
  // ...existing fields...
  pagespeed_opportunities: Array<{
    opportunity: string,
    urls_affected: number,
    total_savings_ms: number,
    average_savings_ms: number,
    total_savings_size_bytes: number,
  }>,                                   // sorted by total_savings_ms descending, zero-count rows excluded
  gsc_top_pages: Array<{
    url: string,
    clicks: number,
    impressions: number,
    ctr_pct: number,
    average_position: number,
  }>,                                   // top 50 by impressions descending; only present if gsc_connected
  ga4_top_pages: Array<{
    url: string,
    sessions: number,
    views: number,
    engaged_sessions: number,
    bounce_rate_pct: number,
    average_session_duration_seconds: number,
  }>,                                   // top 50 by sessions descending; only present if ga4_connected
}

// Added to existing link_analysis object (or created if not present):
link_analysis: {
  total_internal_links: number,
  nofollow_ratio_pct: number,
  non_descriptive_anchor_pct: number,
  top_linked_pages: Array<{
    url: string,
    inlink_count: number,
  }>,                                   // top 20 by inlink_count descending
  top_anchor_texts: Array<{
    anchor_text: string,
    count: number,
    is_descriptive: boolean,
  }>,                                   // top 20 by count descending
}
```

---

## Issues (new entries)

| Issue | Source | Severity | Condition |
|-------|--------|----------|-----------|
| Exact duplicate pages detected | ExactDuplicatesParser | Warning | Count > 0 (after filtering) |
| Near duplicate pages detected | NearDuplicatesParser | Warning | Count > 0 |
| Duplicate title tags | Computed from page_titles_all | Warning | Any title shared by 2+ URLs |
| Duplicate meta descriptions | Computed from meta_description_all | Notice | Any meta shared by 2+ URLs |
| Duplicate H1s | Computed from h1_all | Notice | Any H1 shared by 2+ URLs |
| Keyword cannibalization detected | SemrushOrganicPositionsParser | Warning | Any keyword with 2+ competing URLs |
| High-impact PageSpeed opportunities | PageSpeedOpportunitiesParser | Warning | Top 3 opportunities by total_savings_ms |
| Pages indexed but ranking below position 50 | InternalParser + GSC columns | Notice | Indexable pages with avg GSC position > 50 |

---

## Health Score

No changes to the existing 6-factor formula. New data enriches issues and the keyword signals panel but does not affect the score — keyword metrics are not comparable across sites the way technical ratios are.

---

## UI Changes

### Summary Card (existing — minor additions)
When `gsc_connected` is true, add to the existing metric grid:
- Total GSC Clicks (sum)
- Total GSC Impressions (sum)  
- Average GSC Position (mean)

### Duplicate Content section (new)
- Renders below the existing issue tabs.
- Only renders if any of the five duplicate arrays are non-empty.
- Collapsible, collapsed by default if total duplicate count < 10.
- Four sub-sections in a 2×2 grid: Exact Duplicates, Near Duplicates, Duplicate Titles/Meta/H1s (combined as a tabbed sub-panel).
- Each sub-section shows count badge + paginated table (50 rows).

### Keyword Signals panel (new)
- Full-width section at the bottom of the results page.
- Only renders if `keyword_signals.semrush_connected` is true.
- Four cards in a 2×2 grid:

| Card | Content | Sort |
|------|---------|------|
| Cannibalization Alerts | Keyword + volume + competing URLs (expandable rows) | Volume descending |
| Quick Wins | Keyword + position + URL + volume | Volume descending |
| Optimization Gaps | Page URL + title + H1 + top keywords it actually ranks for | Traffic descending |
| Top Organic Pages | URL + traffic + keyword count + intent badge | Traffic descending |

- If `gsc_connected` but not `semrush_connected`, a muted notice appears: "Connect SEMRush exports for keyword signals."

---

## Future: Keyword Research Tool

A separate spec (to be written before implementation) will cover the unified keyword research tool combining:
- Screaming Frog "All Page Text" bulk export (`.txt` files per page)
- SEMRush Keyword Gap "Missing" filter export
- SEMRush Organic Traffic Insights (if GA4 + GSC connected in SEMRush)
- Full cannibalization workflow with keyword grouping and consolidation recommendations

The `.txt` file upload support added in this spec is forward-compatible with that future tool.
