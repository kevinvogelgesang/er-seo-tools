# Keyword Research Tool — Future Spec (Not Yet Started)

This is a placeholder for the unified keyword research tool. Do not implement until a full design spec has been written and approved.

## Planned scope

A new route (likely `/keyword-research`) that ingests exports from Screaming Frog, SEMRush, and optionally Google Search Console to support keyword research strategy and cannibalization detection workflows.

## Data sources planned

| Source | Export | Purpose |
|--------|--------|---------|
| Screaming Frog | All Page Text bulk export (`.txt` files, one per page) | Full page content for keyword analysis and cannibalization detection |
| Screaming Frog | `internal_all.csv` (with GSC + GA4) | Page metadata: title, H1, meta description, word count, crawl depth, internal links |
| SEMRush | Organic Research Positions (CSV) | Keyword universe per page: keyword, position, volume, intent |
| SEMRush | Organic Research Pages (CSV) | Per-URL traffic rollup |
| SEMRush | Keyword Gap — Missing filter (CSV) | Keywords competitors rank for that the client doesn't |
| SEMRush | Organic Traffic Insights (CSV) | GA4 + GSC + SEMRush combined per landing page (requires GA4 + GSC connected in SEMRush) |

## Key workflows to design

1. **Keyword cannibalization detection** — group Organic Positions by keyword, surface every URL competing for the same term with position + traffic data. Recommend which URL should be canonical/primary.
2. **Content gap analysis** — keywords from Keyword Gap "Missing" export cross-referenced against existing pages to confirm no page already targets those terms outside top 100.
3. **Page content keyword audit** — parse `.txt` page content files to identify primary topic, compare against SEMRush ranking keywords, surface mismatches.
4. **Keyword research strategy report** — per-page summary: what keywords does this page rank for, which are its best performers, what intent does it serve, where are the quick wins.

## Prerequisites

- SEO parser expansion (spec: `2026-04-08-seo-parser-expansion-design.md`) must be implemented first — the `.txt` upload support and SEMRush parser infrastructure are built there.
- Determine whether this is a new route or an extension of `/seo-parser`.
- Evaluate storage implications of `.txt` file content (potentially large).
- Consider whether AI analysis (Claude API) is in scope by that point.

## Notes

- SEMRush is the preferred keyword data source over Google Search Console — more comprehensive, more trusted for volume and difficulty data.
- SEMRush's native Cannibalization report (Position Tracking) is view-only with no CSV export — cannibalization detection must be built from Organic Positions grouped by keyword.
- Keyword Gap export does not include URLs — it is keyword-only. Use for content creation targeting, not for joining with existing page data.
