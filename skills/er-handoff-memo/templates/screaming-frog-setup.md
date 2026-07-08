# Screaming Frog Setup — Master Reference

> **Audience:** ER analysts setting up Screaming Frog SEO Spider for client work that feeds into `er-seo-tools`. Three use cases covered: **Technical Audit**, **Keyword Research**, **Pillar Analysis**. Each builds on a shared base configuration.

This document is the single source of truth for what to configure in Screaming Frog and which exports to deliver to which tool. After configuring SF per a section below, save the result via **File → Configuration → Save Configuration As…** to create a reusable `.seospiderconfig` file. (SF saves configs in a binary format that varies by version, so we maintain *recipes* here rather than checking in pre-built config files.)

---

## Quick reference: which exports go where

| Export filename pattern (case-insensitive substring match) | Technical Audit | Keyword Research | Pillar Analysis |
|---|:---:|:---:|:---:|
| `internal_all` | ✅ required | ✅ required | ✅ required |
| `page_titles_all` (or `page_titles`) | ✅ | ✅ | — |
| `meta_description_all` (or `meta_description`) | ✅ | ✅ | — |
| `h1_all` (or `h1`) | ✅ | ✅ | — |
| `h2_all` (or `h2`) | ✅ | — | — |
| `response_codes_all` (or `response_codes`) | ✅ | — | — |
| `canonicals_all` (or `canonicals`) | ✅ | — | — |
| `directives_all` (or `directives`) | ✅ | — | — |
| `redirect_chains` | ✅ | — | — |
| `redirects` | ✅ | — | — |
| `hreflang` | ✅ | — | — |
| `pagination` | ✅ | — | — |
| `url_*` (URL issues exports) | ✅ | — | — |
| `images_all` (or `images`) | ✅ | — | — |
| `javascript_all` (or `javascript`) | ✅ | — | — |
| `internal_css` (or `css`) | ✅ | — | — |
| `pdf` | ✅ | — | — |
| `external_*` | ✅ | — | — |
| `security_all` (or `security`) | ✅ | — | — |
| `insecure` | ✅ | — | — |
| `sitemaps_all` (or `sitemaps`) | ✅ | — | — |
| `orphan` | ✅ | ✅ | — |
| `all_anchor_text` | ✅ | — | — |
| `all_outlinks` | ✅ | — | — |
| `links_*` (link issues) | ✅ | — | — |
| `accessibility` | ✅ | — | — |
| `analytics` (GA4) | ✅ | ✅ | ⚪ recommended |
| `search_console` (GSC) | ✅ | ✅ required | ⚪ strongly recommended |
| `crawl_overview` | ✅ | — | — |
| `pagespeed_all` + `pagespeed_opportunities_summary` | ✅ | — | — |
| `response_time` | ✅ | — | — |
| `structured_data_all` (or `structured_data`) | ✅ | — | ⚪ recommended |
| `spelling` | ✅ | — | — |
| `grammar` | ✅ | — | — |
| `readability` | ✅ | — | — |
| `low_content` | ✅ | — | — |
| `exact_duplicates_report` | ✅ | — | — |
| `content_near_duplicates` | ✅ | — | — |
| `issues_overview` | ✅ | — | — |
| `best_practice` | ✅ | — | — |
| `carbon` | ✅ | — | — |
| Semrush "Organic Research → Positions" CSV | — | ✅ | ⚪ recommended |
| Semrush "Organic Research → Pages" CSV | — | ✅ | ⚪ recommended |
| Semrush "Position Tracking" CSV | — | ✅ | — |

Legend: ✅ required for the use case to function, ⚪ optional but produces noticeably better output, — not consumed.

---

## Base configuration (applies to all three use cases)

These settings should be on for any er-seo-tools-bound crawl. Set them once, save as a base config, then layer use-case-specific extras on top.

### Spider behavior

- **Configuration → Spider → Crawl tab**
  - Resource Links: ✅ all (Images, CSS, JS, External, etc.)
  - Page Links: ✅ Subdomains if the client has subdomains worth crawling; otherwise leave default.
  - Crawl Behaviour: ✅ Internal Hyperlinks, ✅ External Links, ✅ Canonicals, ✅ Pagination (Rel Next/Prev), ✅ Hreflang.
  - Sitemaps: ✅ Crawl Linked XML Sitemaps; ✅ Auto-Discover from robots.txt.
- **Configuration → Spider → Extraction tab**
  - URL Details: ✅ Crawl Depth, ✅ Indexability, ✅ HTTP Headers (optional).
  - Page Details: ✅ Page Title, ✅ Meta Description, ✅ Meta Keywords (off — useless), ✅ H1, ✅ H2, ✅ Word Count.
  - Structured Data: ✅ JSON-LD, ✅ Microdata, ✅ RDFa.
  - Content: ✅ Store HTML, ✅ Store Rendered HTML (only enable if you'll need extractions; doubles memory).
- **Configuration → Spider → Limits**
  - Crawl Limit: 0 (no limit) for full audits. Set a cap (10k–50k) for sanity-test crawls only.
  - Max URL Depth: leave unlimited unless you specifically want to skip deep pages.
- **Configuration → Spider → Rendering**
  - Use **JavaScript Rendering** if the client site is React/Vue/Next/Angular (anything where View Source ≠ DOM). For mostly-static sites, leave on **Text Only** for speed.
- **Configuration → robots.txt → Settings**
  - ✅ Respect robots.txt (required for production audits; turn off only for dev environments).

### Issues / Pre-computed reports

These are essentially free — SF computes them during the crawl.

- **Configuration → Content → Spelling & Grammar:** ✅ both, set the language.
- **Configuration → Content → Duplicates:** ✅ Near Duplicates, threshold 90%.
- **Configuration → Custom → Search:** leave empty unless you have client-specific patterns to flag.

### API integrations (optional but high-value)

Configure these in **Configuration → API Access**:

- **Google Search Console:** ✅ Connect the client property. SF pulls clicks/impressions/CTR/position into the `Search Console` tab and into `internal_all.csv` rows. Required for keyword research; strongly recommended for pillar analysis.
- **Google Analytics 4:** ✅ Connect the client property. SF pulls sessions/engagement-rate/key-events per URL.
- **PageSpeed Insights:** ✅ Connect with an API key. Slows the crawl noticeably (PSI is rate-limited). Only for technical audits where Core Web Vitals matter.
- **Semrush:** SF can ingest Semrush API if you have a paid account, but the parsers consume Semrush's *own* CSV exports (downloaded from semrush.com), not SF's API output. You don't need to wire up Semrush in SF.

---

## Use case 1 — Technical Audit (`/seo-audits`)

The bread-and-butter audit that produces the prioritized SEO report at `/seo-audits/results/[id]`.

### What to enable on top of the base config

Everything in the base config above. No additional settings required.

### Required exports

Use **Bulk Export → All** with the **Internal** and **All Issues** preset selected, OR run the individual exports listed in the table above. Most SF versions have a "Save All Reports" option under **Reports**.

The parser ingests any file matching the patterns in the table — filenames don't have to be exact. SF's defaults are fine.

### Useful but optional exports for an audit

- `accessibility.csv` — only present if Accessibility Validation is enabled in **Spider → Crawl Analysis → Accessibility**.
- `pagespeed_all.csv` and `pagespeed_opportunities_summary.csv` — only present if PSI API is connected.
- `analytics.csv` and `search_console.csv` — only present if GA4/GSC API is connected. These boost the audit with traffic and query data per URL.

### Crawl analysis step (don't forget this)

After the spider finishes, click **Crawl Analysis → Start**. This computes Link Score, near-duplicates, orphan pages, and other cross-page metrics. **Without it, several reports will be empty.**

### Save as

`er-technical-audit.seospiderconfig` (your local copy — not checked into the repo).

---

## Use case 2 — Keyword Research

Keyword research isn't a built tool inside er-seo-tools — it's a workflow that combines SF's URL inventory with Semrush exports and GSC data, then surfaces opportunities through the same `/seo-audits` upload flow plus the Semrush parsers.

### What to enable on top of the base config

- **Configuration → API Access → Google Search Console:** required. The query-level data is the keyword research signal.
- **Configuration → API Access → Google Analytics 4:** required if you want to correlate queries to engaged sessions / conversions.
- **Spider → Extraction:** ensure ✅ HTML Word Count and ✅ Page Title / Meta Description / H1 are all checked (these are the on-page signals you'll match against ranking queries).
- **Search Console → Configuration:** select the client's property; pull at least the past 16 months of data. Set Search Type = "Web."

### Required exports from SF

- `internal_all.csv` — the URL inventory the keyword data joins onto.
- `search_console.csv` — GSC clicks/impressions/CTR/position per URL (joined by SF during crawl).
- `analytics.csv` — GA4 traffic per URL.
- `page_titles_all.csv`, `meta_description_all.csv`, `h1_all.csv` — used to detect "ranks for X but doesn't mention X" and similar opportunity signals.
- `orphan.csv` — pages with traffic potential that aren't linked to.

### Required exports from Semrush (downloaded separately, then uploaded alongside SF CSVs)

Pull these from the client's Semrush project and include in the same `/seo-audits` upload:

- **Organic Research → Positions** (export type: "Organic Research → Positions" → CSV). Filename will look like `client.com-organic.Positions-<region>-<date>.csv`. Parsed by `SemrushOrganicPositionsParser`.
- **Organic Research → Pages** (export type: "Organic Research → Pages" → CSV). Filename like `client.com-organic.Pages-<region>-<date>.csv`. Parsed by `SemrushOrganicPagesParser`.
- **Position Tracking** (if a project exists for this client). Export "Landscape" view → CSV. Filename like `position_tracking_full_<...>.csv`. Parsed by `SemrushPositionTrackingParser`.

The parsers detect Semrush exports by content (header signature), so the exact filename doesn't matter — just include the CSVs in the upload.

### Save as

`er-keyword-research.seospiderconfig` (your local copy).

---

## Use case 3 — Pillar Analysis (this feature)

Phase 1 of pillar-analysis runs automatically when an SF crawl completes parsing in `/seo-audits`. The crawl just needs to be configured so the per-URL signals exist.

### What to enable on top of the base config

- **Configuration → API Access → Google Search Console:** strongly recommended. Without GSC, the `organicFootprint` subscore goes neutral (5/10) and `dataCompleteness` drops to ~83% — the dashboard will show the low-confidence banner.
- **Configuration → API Access → Google Analytics 4:** optional. Adds engagement-rate signals to per-URL records (currently informational; verdict logic works without it).
- **Spider → Extraction → Structured Data:** ✅ JSON-LD, ✅ Microdata. The page-type classifier uses schema.org `Course` / `EducationalOccupationalProgram` / `Article` / `BlogPosting` / `NewsArticle` as a tiebreaker when URL slug is ambiguous.

### Custom Extraction (the highest-leverage setup step)

Configure under **Configuration → Custom → Extraction**.

**Extraction 1: First paragraph text** — the single biggest cluster-quality lever.

| Field | Value |
|---|---|
| Name | `First Paragraph` |
| Type | `XPath` |
| Expression | `(//main//p[normalize-space(.)])[1]` |
| Extracted | `Extract Text` |

If the client's CMS doesn't use a `<main>` landmark, fall back to:

```
(//article//p[normalize-space(.)])[1]
```

or the most permissive form:

```
(//p[string-length(normalize-space(.)) > 60])[1]
```

(Filters to the first `<p>` with at least 60 chars of text — avoids picking up nav-link paragraphs, breadcrumbs, etc.)

The pillar parser detects this column under any of these header names: `First Paragraph`, `first_paragraph`, `Intro Text`. Naming the extraction `First Paragraph` (default) works.

### Required exports

- `internal_all.csv` — required. Includes the custom-extracted `First Paragraph` column.
- `search_console.csv` — strongly recommended.
- `analytics.csv` — optional.
- `structured_data_all.csv` — optional but improves page-type classification confidence.

### Optional Semrush exports

If the client has Semrush data, include the same Organic Research → Pages / Positions exports listed under Keyword Research. The parser uses them to populate per-URL `referringDomains` and `organicKeywords`, which improve the verdict logic (singletons with strong authority → `leave-as-blog` instead of `prune`).

### Save as

`er-pillar-analysis.seospiderconfig` (your local copy).

### Pre-flight checklist before exporting

- [ ] Crawl Analysis was run (**Crawl Analysis → Start**).
- [ ] GSC connection shows green in **API Access**.
- [ ] First Paragraph custom extraction has at least one row with non-null text in the Internal tab.
- [ ] Crawl is on the canonical domain (no `staging.` or `dev.` mixed in).

---

## Useful "save once, use everywhere" SF features

Once you've configured SF for a use case, lock it in:

- **File → Configuration → Save Configuration As…** saves all spider settings + custom extractions + API keys (encrypted) to a `.seospiderconfig` file.
- **File → Configuration → Load Configuration** restores everything in one click.
- **File → Configuration → Set as Default** uses the current config for new sessions.

Keep your three configs in `~/Documents/SF Configs/` (or wherever you prefer). They contain encrypted API tokens — don't share them across team members; each analyst should generate their own from this recipe.

---

## When something doesn't work

- **`internal_all.csv` produced but rows are empty:** the spider was set to External Links or some narrow mode. Reset to "Spider → Crawl: Internal Hyperlinks ✅" and recrawl.
- **`First Paragraph` column is empty for everything:** the XPath didn't match the site's HTML structure. Right-click any URL in the Internal tab → "View Custom Extraction" to see what the spider actually pulled. Try the alternative XPaths in §3.2.
- **`search_console.csv` missing:** GSC API connection didn't authenticate. Check **API Access → Google Search Console → Account** is signed in and the property is selected.
- **Bulk Export only produces 5 files:** SF's "Bulk Export" submenu has many sub-sections. Use **Reports → Bulk Reports** or run **Bulk Export → All** for a full dump.
- **Pillar analysis dashboard shows score but no clusters:** SF crawl was fine, but the cluster threshold is too strict for the site's content. Lower `clusterSimilarityThreshold` in `lib/services/pillarAnalysis/config.ts` (default 0.55 → try 0.45). Re-run via the seo-audits pipeline.
