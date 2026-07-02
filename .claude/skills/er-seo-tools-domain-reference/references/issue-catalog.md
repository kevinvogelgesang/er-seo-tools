# Issue-type catalog

Companion to `er-seo-tools-domain-reference` SKILL.md. Read that first for the
load-bearing rules (groups-not-pages, complete-vs-sampled, severity buckets).
Verified 2026-07-02 on branch `feat/autonomous-live-seo-source`.

## How to read this catalog

- **Weight** = `ISSUE_WEIGHTS[type]` in `lib/services/priority.service.ts`;
  types absent from that table get `DEFAULT_WEIGHT = 25`.
- **URL set**: `complete` only for the four `DERIVABLE_COMPLETE` types
  (`lib/services/issue-membership.ts`) and only when the page index is non-empty;
  everything else is a capped `parser-sample` (typical caps: missing_* 20,
  broken/thin 50, duplicate-title groups 10 — set inside the emitting parser).
- **Severity** is only listed where verified in the emitting code. Parsers outside
  the aggregator self-declare severity per issue object — read the parser file
  before quoting a severity not listed here.

## 1. Aggregator-curated issues (`lib/services/aggregator.service.ts`)

Emitted from `InternalParser` output and content/keyword parsers; these are the
issues most surfaces lead with. Severity verified from the aggregator's
critical/warnings/notices pushes.

| Type | Severity | Weight | Meaning | URL set |
|---|---|---|---|---|
| `broken_pages` | critical | 100 | Internal URLs returning 4xx/5xx (from internal_all status codes) | sample ≤50 |
| `missing_title` | critical | 95 | Indexable pages with no `<title>` | **complete** via page index |
| `missing_meta_description` | warning | 65 | Indexable pages with no meta description | **complete** via page index |
| `missing_h1` | warning | 60 | Indexable pages with no H1 | **complete** via page index |
| `duplicate_titles` | warning | 60 | Distinct title values shared by ≥2 pages — **count = groups** | groups ≤10 |
| `thin_content` | warning | 55 | Indexable HTML pages with 0 < words < 300. **Emitted only when count > 0** — a zero-thin site drops the factor from the health score | **complete** via page index |
| `accessibility_errors` | critical | 25 (default — `ISSUE_WEIGHTS` has `critical_accessibility`, a near-miss key that nothing emits) | SF accessibility-export errors | parser-sample |
| `missing_alt_text` | warning | 30 | Images without alt attributes | parser-sample |
| `images_missing_dimensions` | notice | 25 (default) | Images without width/height (CLS risk) | parser-sample |
| `exact_duplicate_pages` | warning | 25 (default — `duplicate_content` at 58 is another near-miss key) | Identical page content (SF hash match) | parser-sample |
| `near_duplicate_pages` | warning | 25 (default) | Near-identical content above SF's similarity threshold | sample ≤50 |
| `keyword_cannibalization` | warning | 25 (default) | One keyword ranking through multiple URLs (SEMRush positions) | parser-sample |

**Near-miss weight keys** (verified 2026-07-02): `ISSUE_WEIGHTS` contains
`critical_accessibility` (70), `duplicate_content` (58), `broken_internal_links` (90),
`poor_lcp` (45), `poor_cls` (40) — but no SF-side parser emits those exact type
strings, so the emitted cousins fall to weight 25 (except `broken_internal_links`,
which the live-scan mapper does emit). If a priority ranking looks wrong, check for
this key mismatch first.

## 2. Live-scan issues (C6, `lib/findings/onpage-seo-mapper.ts` + `broken-link-mapper.ts`)

Aggregation set: statusCode 2xx ∧ HTML ∧ ¬noindex ∧ ¬loginLike. Severity verified
from the mapper code.

| Type | Severity | Count semantics | Notes |
|---|---|---|---|
| `missing_title` | critical | affected pages | same predicate as SF (`deriveIssueTypesForPage`) |
| `missing_h1` | warning | affected pages | |
| `missing_meta_description` | warning | affected pages | |
| `thin_content` | warning | affected pages | 0 < words < 300 |
| `duplicate_title` | warning | **duplicate GROUPS** | trimmed-exact value match; note singular name vs SF's `duplicate_titles` |
| `duplicate_meta_description` | notice | **duplicate GROUPS** | |
| `duplicate_h1` | notice | **duplicate GROUPS** | |
| `broken_internal_links` | critical | distinct broken **targets** (run scope); page rows keyed by **source page** | weight 90; `unconfirmed` checks excluded |
| `broken_images` | critical | same | weight 85 |

`affectedComplete` on live findings = whether NO page hit the 300-target harvest cap
(`harvestTruncated`), not the page-index rule used on the SF side.

## 3. Full emitted-type inventory (type → emitter → weight)

Every `type:` string emitted by parsers/aggregator as of 2026-07-02 (grep over
`lib/parsers` + `lib/services/aggregator.service.ts`, test files excluded).
Severity: read the emitting file. Meaning column = standard SEO interpretation.

| Type | Emitter | Weight | Meaning (SEO) |
|---|---|---|---|
| `accessibility_alerts` | resources/accessibility.parser | 25 | SF accessibility warnings (non-error) |
| `accessibility_errors` | accessibility.parser + aggregator | 25 | SF accessibility errors |
| `best_practice_high_priority` | issues/bestPractice.parser | 25 | SF best-practice flags, high |
| `best_practice_medium_priority` | issues/bestPractice.parser | 25 | " medium |
| `best_practice_low_priority` | issues/bestPractice.parser | 25 | " low |
| `broken_css` | resources/css.parser | 40 | CSS files returning errors |
| `broken_external_links` | resources/links.parser | 35 | Outbound links to dead external URLs |
| `broken_hreflang_targets` | technical/hreflang.parser | 70 | hreflang alternates that 404/error |
| `broken_images` | resources/images.parser | 85 | Image URLs returning errors |
| `broken_js` | resources/javascript.parser | 80 | JS files returning errors |
| `broken_pages` | aggregator | 100 | Internal 4xx/5xx pages |
| `broken_pdfs` | resources/pdf.parser | 30 | PDF links returning errors |
| `canonicalised_pages` | technical/canonicals.parser | 10 | Pages canonicalizing elsewhere (informational) |
| `client_errors_4xx` | technical/responseCodes.parser | 95 | 4xx responses |
| `duplicate_h1` | seoElements/h1.parser | 30 | H1 shared across pages (groups) |
| `duplicate_meta_description` | seoElements/metaDescription.parser | 35 | Meta shared across pages (groups) |
| `duplicate_title` | seoElements/pageTitles.parser | 60 | Title shared across pages (groups) |
| `duplicate_titles` | aggregator | 60 | Same, aggregator name (plural) |
| `empty_anchor_text` | resources/anchorText.parser | 25 | Links with no anchor text |
| `exact_duplicate_pages` | aggregator | 25 | Byte-identical page content |
| `grammar_errors` | content/spellingGrammar.parser | 25 | SF grammar flags |
| `high_bounce_rate` | analytics/analytics.parser | 25 | GA4 high-bounce pages (SF API-connected) |
| `high_carbon_pages` | issues/carbon.parser | 25 | SF carbon-rating flags |
| `images_missing_dimensions` | images.parser + aggregator | 25 | width/height absent → CLS |
| `insecure_pages` | resources/security.parser | 70 | HTTP or insecure-form pages |
| `keyword_cannibalization` | aggregator | 25 | One keyword, multiple ranking URLs |
| `large_css_files` | resources/css.parser | 20 | Oversized CSS |
| `large_images` | resources/images.parser | 30 | Oversized images |
| `large_js_files` | resources/javascript.parser | 35 | Oversized JS |
| `large_pdfs` | resources/pdf.parser | 15 | Oversized PDFs |
| `links_quality_issue` | resources/links.parser | 25 | SF link-quality flags |
| `long_redirect_chains` | technical/redirectChains.parser | 80 | Chains above hop threshold |
| `low_content_pages` | content/contentReadability.parser | 25 | SF low-content export rows |
| `low_ctr_opportunities` | analytics/searchConsole.parser | 25 | High impressions, low CTR (GSC) |
| `meta_description_too_long` | metaDescription.parser | 20 | Truncated in SERP |
| `meta_description_too_short` | metaDescription.parser | 20 | Under-utilized snippet |
| `missing_alt_text` | images.parser + aggregator | 30 | Accessibility + image SEO |
| `missing_canonical` | technical/canonicals.parser | 55 | No canonical element |
| `missing_h1` | h1.parser + aggregator | 60 | No H1 on indexable page |
| `missing_h2` | seoElements/h2.parser | 15 | No H2 structure |
| `missing_hreflang_return` | technical/hreflang.parser | 35 | Non-reciprocal hreflang |
| `missing_meta_description` | metaDescription.parser + aggregator | 65 | No meta description |
| `missing_title` | pageTitles.parser + aggregator | 95 | No `<title>` |
| `missing_x_default` | technical/hreflang.parser | 25 | hreflang set without x-default |
| `mixed_content` | resources/security.parser | 48 | HTTPS pages loading HTTP assets |
| `multiple_h1` | seoElements/h1.parser | 30 | More than one H1 |
| `multiple_titles` | seoElements/pageTitles.parser | 30 | More than one `<title>` |
| `near_duplicate_pages` | aggregator | 25 | Near-identical content |
| `nofollow_pages` | technical/directives.parser | 25 | Pages with nofollow directives |
| `noindex_pages` | technical/directives.parser | 10 | Noindexed pages (often intentional) |
| `non_descriptive_anchor_text` | resources/anchorText.parser | 25 | "click here"-class anchors |
| `non_indexable_in_sitemap` | resources/sitemaps.parser | 35 | Sitemap lists non-indexable URLs |
| `non_self_canonical` | technical/canonicals.parser | 10 | Canonical points elsewhere |
| `orphan_pages` | resources/sitemaps.parser | 50 | In sitemap/GA but not internally linked |
| `pages_no_traffic` | analytics/analytics.parser | 25 | Crawled pages with zero GA4 sessions |
| `pagination_issues` | technical/pagination.parser | 25 | rel prev/next problems |
| `pagination_non_indexable` | technical/pagination.parser | 25 | Paginated pages blocked from index |
| `poor_performance_score` | performance/pagespeed.parser | 75 | Low CWV/PSI score (SF PSI-connected) |
| `readability_issue` | content/contentReadability.parser | 25 | SF readability flags |
| `redirect_chains` | technical/redirectChains.parser | 50 | Multi-hop redirects |
| `redirects_3xx` | technical/responseCodes.parser | 25 | 3xx responses (often fine) |
| `rich_result_errors` | structuredData/structuredData.parser | 25 | Schema errors blocking rich results |
| `schema_validation_errors` | structuredData.parser | 35 | Invalid structured data |
| `schema_validation_warnings` | structuredData.parser | 25 | Structured-data warnings |
| `server_errors_5xx` | technical/responseCodes.parser | 100 | 5xx responses |
| `single_anchor_variation` | resources/anchorText.parser | 25 | One anchor text for all inlinks to a page |
| `sitemap_errors` | resources/sitemaps.parser | 40 | Sitemap URLs erroring |
| `sitemap_redirects` | resources/sitemaps.parser | 38 | Sitemap URLs redirecting |
| `slow_server_response` | performance/responseTime.parser | 45 | High TTFB (latent — no standalone SF export) |
| `spelling_errors` | content/spellingGrammar.parser | 25 | SF spelling flags |
| `temporary_redirects` | technical/redirects.parser | 10 | 302/307 where 301 intended |
| `thin_content` | aggregator | 55 | 0 < words < 300, indexable HTML |
| `title_too_long` | seoElements/pageTitles.parser | 20 | Truncated in SERP |
| `title_too_short` | seoElements/pageTitles.parser | 25 | Under-utilized title |
| `url_issues` | technical/urlIssues.parser | 25 | Uppercase/underscores/params in URLs |
| `very_large_images` | resources/images.parser | 45 | Severely oversized images |

Additionally, SF's own `issues_overview.csv` rows pass through pre-categorized
(deduped by type, higher count kept, URL lists unioned) — those `sf_*`/passthrough
types are whatever SF names them, and count-only ones are dropped when a richer
curated issue covers the same problem (`canonicalizeCuratedIssues`,
`lib/services/curated-issue-dedup.ts`).

## Effort / ROI classification (`lib/services/priority.service.ts`)

- LOW_EFFORT: missing_meta_description, missing_alt_text, title_too_long/short,
  meta_description_too_long/short, temporary_redirects.
- HIGH_EFFORT: thin_content, duplicate_content, poor_performance_score,
  critical_accessibility, server_errors_5xx, poor_lcp, poor_cls, orphan_pages.
- Everything else: medium. Escalation: count >100 bumps low→medium; count >50 bumps
  medium→high. ROI = priority_score / {low 1, medium 2, high 3}: ≥40 high, ≥20 medium.

## Re-verify

- Type inventory: `grep -rhn "type: '" lib/parsers lib/services/aggregator.service.ts --include='*.ts' | grep -v test`
- Weights: `sed -n '1,70p' lib/services/priority.service.ts`
- Aggregator severities: `grep -n -B2 "type: '" lib/services/aggregator.service.ts`
- Live mapper severities: `sed -n '33,55p' lib/findings/onpage-seo-mapper.ts`
