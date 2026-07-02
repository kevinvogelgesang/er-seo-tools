# Screaming Frog export contract — parser registry

Companion to `er-seo-tools-domain-reference` SKILL.md. Verified 2026-07-02 on
branch `feat/autonomous-live-seo-source`. 45 parsers in the `PARSERS` array
(`lib/parsers/index.ts`), all extending `BaseParser` (`lib/parsers/base.parser.ts`:
papaparse `header:true` + `dynamicTyping`, case-insensitive O(1) `headerMap`).

## Registry rules (all load-bearing)

1. **Explicit `static parserKey` is mandatory.** The aggregator hardcodes
   `parsedData.<key>` lookups; class-name derivation broke under prod minification
   (page_index and keyword data silently vanished, prod-only). A new parser goes in
   BOTH `PARSERS` (ordered array) and `PARSER_MAP` (key → class).
2. **Filename patterns are bare case-insensitive substrings**, so array order is
   load-bearing:
   - `InsecureContentParser` (`insecure`) MUST precede `UrlIssuesParser` (`url_`)
     and `SecurityParser` (`security`), or `security_*_insecure.csv` is swallowed.
   - `PageSpeedOpportunitiesParser` (`pagespeed_opportunities_summary`) MUST precede
     `PageSpeedParser` (`pagespeed`).
   - SEMRush parsers have `filenamePattern = ''` (content-detected) and MUST sit
     last, in the order PositionTracking → OrganicPositions → KeywordGap →
     OrganicPages (negative-header disambiguation).
3. **Detection order** (`findParserForFile`): filename substring → raw-content
   (`matchesRawContent`, e.g. Position Tracking metadata header) → CSV header row
   (`matchesContent`).
4. **Latent parsers** (registered, but no modern standalone SF export matches):
   `RedirectChainsParser`, `RedirectsParser` (SF ships redirect data inside
   `response_codes_*` files, which ResponseCodesParser matches first) and
   `ResponseTimeParser` (response time is a column in internal_all). Retained
   because the aggregator still reads their keys when present.

## Parser registry (in PARSERS array order)

| Parser | parserKey | Filename pattern(s) | Contributes |
|---|---|---|---|
| InternalParser | `internal` | `internal_all` | **Keystone**: status distribution, indexability, thin content, missing/duplicate title/meta/H1 summaries, crawl depth, link score, inlinks/outlinks, per-URL GSC (Clicks/Impressions/CTR/Position) + GA4 columns when SF is API-connected, `per_url_index` → page_index + pillar analysis |
| IssuesOverviewParser | `issuesoverview` | `issues_overview` | SF's precomputed issue list, passed through pre-categorized |
| PageTitlesParser | `pagetitles` | `page_titles_all`, `page_titles` | missing/duplicate(groups)/multiple/too-long/too-short titles |
| MetaDescriptionParser | `metadescription` | `meta_description_all`, `meta_description` | missing/duplicate/length meta issues |
| H1Parser | `h1` | `h1_all`, `h1` | missing/duplicate/multiple H1 |
| H2Parser | `h2` | `h2_all`, `h2` | missing H2 |
| InsecureContentParser | `insecurecontent` | `insecure` | mixed/insecure content (must precede url_/security) |
| ResponseCodesParser | `responsecodes` | `response_codes_all`, `response_codes` | 4xx/5xx/3xx buckets (core tier) |
| CanonicalsParser | `canonicals` | `canonicals_all`, `canonicals` | missing/non-self canonical, canonicalised pages |
| DirectivesParser | `directives` | `directives_all`, `directives` | noindex/nofollow pages |
| RedirectChainsParser | `redirectchains` | `redirect_chains` | latent (see rule 4) |
| HreflangParser | `hreflang` | `hreflang` | broken targets, missing return links, missing x-default |
| RedirectsParser | `redirects` | `redirects` | latent (see rule 4) |
| PaginationParser | `pagination` | `pagination` | rel prev/next issues |
| UrlIssuesParser | `urlissues` | `url_` | URL hygiene (uppercase, underscores, params) |
| ImagesParser | `images` | `images_all`, `images` | broken/large/missing-alt/missing-dimension images |
| JavaScriptParser | `javascript` | `javascript_all`, `javascript` | broken/large JS |
| CSSParser | `css` | `internal_css`, `css` | broken/large CSS |
| PDFParser | `pdf` | `pdf` | broken/large PDFs |
| ExternalLinksParser | `externallinks` | `all_outlinks` | broken external links |
| LinksIssuesParser | `linksissues` | `links_` | link-quality flags |
| SecurityParser | `security` | `security_all`, `security` | insecure pages, security headers |
| SitemapsParser | `sitemaps` | `sitemaps_all`, `sitemaps` | sitemap errors/redirects/non-indexable-in-sitemap |
| OrphanPagesParser | `orphanpages` | `orphan` | orphan pages |
| AnchorTextParser | `anchortext` | `all_anchor_text` | empty/non-descriptive/single-variation anchors |
| AccessibilityParser | `accessibility` | `accessibility` | SF accessibility errors/alerts (needs JS rendering enabled in SF) |
| AnalyticsParser | `analytics` | `analytics` | GA4 bounce/no-traffic pages (SF API-connected) |
| SearchConsoleParser | `searchconsole` | `search_console` | low-CTR opportunities (SF API-connected) |
| CrawlOverviewParser | `crawloverview` | `crawl_overview` | crawl summary stats |
| PageSpeedOpportunitiesParser | `pagespeedopportunities` | `pagespeed_opportunities_summary` | PSI opportunity list (must precede pagespeed) |
| PageSpeedParser | `pagespeed` | `pagespeed_all`, `pagespeed` | CWV / performance scores (SF PSI-connected) |
| ResponseTimeParser | `responsetime` | `response_time` | latent (see rule 4) |
| StructuredDataParser | `structureddata` | `structured_data_all`, `structured_data` | schema validation errors/warnings, rich-result errors, `pages_with_schema` → health-score factor 6 |
| SpellingGrammarParser | `spellinggrammar` | `spelling` | spelling flags |
| GrammarParser | `grammar` | `grammar` | grammar flags |
| ContentReadabilityParser | `contentreadability` | `readability` | readability flags |
| LowContentParser | `lowcontent` | `low_content` | SF low-content rows |
| ExactDuplicatesParser | `exactduplicates` | `exact_duplicates_report` | exact duplicate pages |
| NearDuplicatesParser | `nearduplicates` | `content_near_duplicates` | near duplicates |
| BestPracticeParser | `bestpractice` | `best_practice` | best-practice flags by priority |
| CarbonParser | `carbon` | `carbon` | carbon-rating flags |
| SemrushPositionTrackingParser | `semrushpositiontracking` | *(content: raw metadata header)* | position-tracking keyword data |
| SemrushOrganicPositionsParser | `semrushorganicpositions` | *(content: header row)* | ranking keywords → cannibalization, quick wins |
| SemrushKeywordGapParser | `semrushkeywordgap` | *(content: header row)* | gap keywords (capped 500 by volume in `keyword-research-export.ts`) |
| SemrushOrganicPagesParser | `semrushorganicpages` | *(content: header row)* | per-page keyword counts → optimization gaps |

## Expected-exports manifest (`lib/parsers/expected-exports.ts`)

Coverage checklist only — `findParserForFile` remains the parser selector.

| id | Tier | Pattern(s) | SF menu path |
|---|---|---|---|
| `internal_all` | **core** | `internal_all` | Bulk Export → Internal → All |
| `response_codes` | **core** | `response_codes` | Bulk Export → Response Codes (prefer Internal) |
| `page_titles` | recommended | `page_titles` | Bulk Export → Page Titles → All |
| `meta_description` | recommended | `meta_description` | Bulk Export → Meta Description → All |
| `h1` | recommended | `h1_` | Bulk Export → H1 → All |
| `images_missing_alt_text` | recommended | `images_missing_alt_text` | Bulk Export → Images → Missing Alt Text |
| `accessibility` | optional | `accessibility` | Config → Spider → Rendering = JavaScript, enable Accessibility; Bulk Export → Accessibility |
| `exact_duplicates` | optional | `exact_duplicates` | Config → Content → Duplicates; Reports → Duplicates → Exact |
| `low_content` | optional | `low_content` | Bulk Export → Content → Low Content Pages |
| `redirect_chains` | optional | `redirect_chain` | Reports → Redirects → Redirect Chains |
| `redirection_3xx` | optional | `redirection` | Bulk Export → Response Codes → Redirection (3xx) |
| `pagespeed` | optional | `pagespeed` | Configure PSI API in SF; Bulk Export → PageSpeed |
| `search_console` | optional | `search_console` | Connect GSC in SF; Bulk Export → Search Console |
| `semrush_organic_positions` | optional, `notExpectedFromSf` | `organic.positions`, `organic_positions` | SEMRush → Organic Research → Positions |

## What happens when exports are missing

- **Core missing** (technical workflow only — `session.workflow !== 'keyword-research'`):
  the parse route returns **400** with human guidance + `missingCore` ids
  (`app/api/parse/[sessionId]/route.ts`). A corrupt file manifest skips the gate and
  fails downstream instead.
- **Recommended/optional missing**: the relevant issue sections are absent; the
  health score renormalizes over the remaining factors (silently — scores stop
  being comparable across crawls); completeness may downgrade
  (`lib/services/completeness.ts`: page index empty ⇒ `thin`; >50% of issues with
  no URLs ⇒ `partial`).
- **Keyword-research workflow** exists to let SEMRush-only uploads skip the core
  gate, skip the pillar trigger, and stay out of the technical SEO trend. A pending
  session's marker can flip technical → keyword-research by appending files, never back.

## Re-verify

- Registry + order + traps: read `lib/parsers/index.ts` (comments at the
  InsecureContent, PageSpeed, SEMRush positions are the ordering rationale).
- Keys/patterns: `grep -rn "static parserKey\|static filenamePattern" lib/parsers --include='*.ts' | grep -v test`
- Manifest tiers: `grep -n "tier:" lib/parsers/expected-exports.ts`
- Core gate: `sed -n '48,80p' 'app/api/parse/[sessionId]/route.ts'`
- Analyst-facing crawl-config recipe: `docs/screaming-frog-setup.md`
