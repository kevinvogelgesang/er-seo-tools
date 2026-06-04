# Handoff — SEO Audit test findings (skill round-trip + parser coverage)

**Date:** 2026-06-04
**Context:** A *test* audit (not a real client engagement — do not continue/action the audit itself) used to (a) validate the unified `er-handoff-memo` skill end-to-end against production, and (b) surface remaining accuracy/coverage gaps in the SEO parser/aggregator. This doc captures everything needed to make the resulting fixes in a later session.

> All prior thread fixes are already shipped + deployed: parser-key minification (#45), `sf_*` dedup (#46), sitemap 2xx gate + completeness wording (#47), unified skill (#44), completeness banner (#43). This doc is the **next** batch.

---

## 1. Test artifacts / links

- **Audited site:** nuvani.edu (test crawl uploaded to staging).
- **Results page:** https://seo.erstaging.site/seo-parser/results/64c1a005-40e9-40d8-a62c-e4226cc78c0b
- **Roadmap row id:** `cmpzpitg00046131dn7ph9mnr` (the `srt_` token was short-lived and is expired — re-mint via the dashboard "Generate Roadmap" if you need to re-fetch).
- **Crawl stats:** 172 URLs (163 indexable), 147 pages indexed, **72 issues** (4 critical / 31 warnings / 37 notices), completeness **partial** (71% of issues have no affected URLs; `pageIndexCount` 147, `hasInternalCrawl` true).
- **Parser coverage:** **33 / 45** parsers matched (see §4).
- **Local SF exports (proway test crawls, for reproduction):** `/Users/kevin/enrollment-resources/sf-crawls/pro-way-hair-school/` (4 dated crawls; the June ones are near-empty/asset-only — useful for the "empty crawl" completeness path). The **nuvani** SF export was uploaded to staging and is **not** in the repo; server keeps no uploads on disk, so re-export from SF if needed.

## 2. Skill validation result — PASSED ✅

The unified `er-handoff-memo` skill (in-repo `skills/er-handoff-memo/`, symlinked to `~/.claude/skills/`) ran the full `srt_` round-trip live:
- `handoff.py fetch` → 285 KB payload, real data (transport UA + error taxonomy worked through Cloudflare + auth gate).
- Wrote a 1,207-word roadmap (honoring `affectedUrlSource`, rehydrated URLs, partial-completeness scope note).
- `handoff.py post` → `{ok:true}`; DB confirmed `SeoRoadmap.status=complete`, 9,597 bytes stored.
- `teamwork` block present (push offered, not executed — test only).

Transport + routing + completeness handling are validated in production. (Not yet exercised: `pat_` pillar and `krt_` keyword round-trips — lower risk, same transport.)

## 3. Findings → updates needed (the actual work)

Prioritized. Same workflow as the rest of this thread: **TDD → Codex-verify → deploy.**

### A. Issue dedup / accuracy (aggregator)
1. **Curated-vs-curated duplication.** The aggregator emits multiple curated types for the same problem: `duplicate_title` + `duplicate_titles` + `duplicate_title_tags` (all 3 fired for the same 2 groups), plus `duplicate_h1` + `duplicate_h1_tags` and `duplicate_meta_description` + `duplicate_meta_descriptions`. `dropSupersededSfIssues` only handles `sf_*`; this is curated↔curated. Pick ONE canonical type per duplicate-category and drop the rest (or merge). Files: `lib/services/aggregator.service.ts` (`buildIssues`), `lib/services/sf-issue-dedup.ts` (or a sibling).
2. **`sf_h2_*` not mapped.** `sf_h2_missing` (42) coexists with curated `missing_h2` (42); `sf_h2_multiple` (84) has no curated twin (keep). Add `sf_h2_missing → missing_h2` (and audit other `sf_h2_*`) to `SF_SUPERSEDED_BY` in `lib/services/sf-issue-dedup.ts`.
3. **`client_errors_4xx` shows EXTERNAL URLs.** Its 5 URLs were all external (enrollmentresources.com, ope.ed.gov, pewresearch…) — i.e. it overlaps `broken_external_links`, not internal-page 4xx. Source mislabel: `client_errors_4xx` should be internal pages only. Trace its source in the aggregator/internal/response-codes path.

### B. Parser orphans / filename patterns (parser registry)
4. **`insecurecontent` never matches when `security_*` present.** `security_form_url_insecure.csv` was uploaded but the **SecurityParser** (`filenamePattern: 'security'`) claims it first (substring match), so `InsecureContentParser` (`'insecure'`) is orphaned. Detection-order/overlap fix: tighten patterns or order so the insecure-content file routes to the right parser. (Reminder: each file matches exactly ONE parser via `findParserForFile`.)
5. **`responsetime` parser is orphaned.** It looks for a `response_time` file SF doesn't export standalone (response time is a column in `internal_all`). Either remove the parser, repoint it, or source from `internal_all`.
6. **`redirectchains` / `redirects` filename patterns may not match SF's real files.** Parser wants `redirect_chains` / `redirects`; the user had `response_codes_internal_redirect_chain.csv` and `response_codes_redirection_(3xx).csv` (matched by other parsers). Confirm against current SF export names (Reports → Redirects → Redirect Chains / All Redirects) and reconcile patterns vs the "enable this export" guidance in §4.

### C. Completeness / UX (lower priority)
7. **`partial` is driven mostly by legit count-only `sf_*` issues.** 71% no-URL here is largely the long-tail SF checks (security headers, title-length) that have **no** per-URL list by design — not a data gap. Consider excluding "known count-only `sf_*`" from the `noUrlIssueRatio` so `partial` reflects genuine missing-URL data, not inherent SF-summary issues. File: `lib/services/completeness.ts` (`NO_URL_PARTIAL_THRESHOLD` logic).
8. **Teamwork push volume.** A full push here = 72 subtasks, ~half count-only `sf_*` notices. Consider defaulting the push to URL-bearing issues (or a severity/`affectedUrlComplete` filter) so it doesn't create a wall of count-only notice tasks. Skill/contract: `skills/er-handoff-memo/references/teamwork-push.md`.

## 4. Parser coverage — 33/45 (cross off the real gaps)

Only ~6 are SF exports worth enabling; the rest are SEMRush (by design) or app-side quirks.

| Parser | Needs (file) | Screaming Frog export/setting | Verdict |
|---|---|---|---|
| `accessibility` | `accessibility…` | Config → Spider → Rendering = JavaScript, enable Accessibility; Bulk Export → Accessibility | enable export |
| `exactduplicates` | `exact_duplicates_report` | Config → Content → Duplicates; Reports → Duplicates → Exact (near-dupes were exported, not exact) | enable export |
| `linksissues` | `links_*` | Bulk Export → Links (per-issue link exports) | enable export |
| `lowcontent` | `low_content` | Bulk Export → Content → Low Content Pages (content analysis on) | enable export |
| `redirectchains` | `redirect_chains` | Reports → Redirects → Redirect Chains | enable export (+ see §B-6) |
| `redirects` | `redirects` | Reports → Redirects → All Redirects | enable export (+ see §B-6) |
| `semrushorganicpositions` / `…pages` / `…positiontracking` / `…keywordgap` | SEMRush exports | Not Screaming Frog — SEMRush Organic Positions/Pages/Gap | intentional (SF-only upload) |
| `insecurecontent` | `…insecure` | File WAS uploaded; Security parser claims it first | app-side bug (§B-4), not a settings issue |
| `responsetime` | `response_time` | No standalone SF export; data in `internal_all` | app-side quirk (§B-5) |

**Net:** enabling ~6 SF exports → ~39/45; the 4 SEMRush are by-design; 2 are app-side fixes. So "33/45" is **not** 12 missing user-exports.

---

## 5. The skill output (generated roadmap — for reference)

This is exactly what the skill produced and posted back to the dashboard for nuvani.edu:

```markdown
## Executive Summary

nuvani.edu (172 URLs crawled, 163 indexable) has **4 critical issues, 31 warnings, and 37 notices**. The dominant, actionable themes are **broken external links** (143), **image weight** (47 oversized images, 6 of them >500 KB), **on-page heading/title hygiene** (multiple/missing H1s, 67 over-long and 17 too-short titles), and **anchor-text quality** (50 empty + 26 non-descriptive internal anchors). A large share of the remaining findings are security-header and meta-length notices surfaced from Screaming Frog's issues summary.

> _Scope note: this audit is **partial** — 71% of issues have no affected-URL list (they come from Screaming Frog's count-only issues summary). On-page content data was captured (147 pages indexed), but no PageSpeed/GSC/GA4 exports were included, so Core Web Vitals and traffic signals are absent. Add those exports for a complete picture._

## Critical Issues

### client_errors_4xx

**Severity:** Critical  **Affected:** 5

Five linked URLs return 4xx. These are **external link targets** (not internal pages) — they overlap the broken-external-links warning below, so fix them together.

**Fix:**
- Update or remove the links pointing at these dead targets.
- For citations/resources, find the current URL or an archive.org snapshot.

**Affected URLs** _(sample of 5; full count: 5)_
- https://enrollmentresources.com/
- https://ope.ed.gov/dapip/#/home
- https://www.pewresearch.org/fact-tank/2019/01/17/where-millennials-end-and-generation-z-begins/
- https://www.researchgate.net/publication/312067839_Is_having_a_haircut_good_for_your_mental_health
- https://www.grandviewresearch.com/industry-analysis/nail-care-products-market-report

### very_large_images

**Severity:** Critical  **Affected:** 6

Six images exceed 500 KB, severely hurting load time (most are CDN-hosted PNGs that should be compressed/converted).

**Fix:**
- Convert to WebP/AVIF and compress; PNG screenshots of photos are the worst offenders.
- Set explicit width/height to prevent layout shift.

**Affected URLs** _(sample of 6; full count: 6)_
- https://cdn.nuvani.edu/wp-content/uploads/2023/05/nail-tech-classes.png
- https://cdn.nuvani.edu/wp-content/uploads/2023/05/nail-art.png
- https://cdn.nuvani.edu/wp-content/uploads/2023/05/abcs-beauty-school-austin.png
- https://cdn.nuvani.edu/wp-content/uploads/2023/05/beauty-school-graduate.png
- https://cdn.nuvani.edu/wp-content/uploads/2023/05/nuvani-oct.png

### Images Missing Alt Text

**Severity:** Critical  **Affected:** 66

Sixty-six images lack alt text — an accessibility (ADA) and image-SEO gap.

**Fix:**
- Add descriptive alt text; prioritise content/hero images over decorative ones (decorative can use empty `alt=""`).
- This is a per-image content task — budget accordingly.

_(URL list unavailable — 66 affected; surfaced from the SF issues summary. Re-run with the `images_all` export selected to get the per-image list.)_

### Missing H1

**Severity:** Critical  **Affected:** 1

One page has no H1. Confirmed complete from the page index.

**Fix:** Add a single, descriptive H1.

**Affected URLs** _(complete — 1 page)_
- https://nuvani.edu/SID/npcalc.htm

## High-Priority Warnings

### broken_external_links

**Severity:** Warning  **Affected:** 143

143 outbound links point to dead/erroring external URLs (the 5 critical 4xx above are a subset). Hurts UX and signals stale content.

**Fix:** Audit outbound links; remove or update. Prioritise links in templates/footers (they multiply across pages).

**Affected URLs** _(sample of 5; full count: 143)_
- https://enrollmentresources.com/
- https://ope.ed.gov/dapip/#/home
- https://www.pewresearch.org/fact-tank/2019/01/17/where-millennials-end-and-generation-z-begins/
- https://www.researchgate.net/publication/312067839_Is_having_a_haircut_good_for_your_mental_health
- https://www.grandviewresearch.com/industry-analysis/nail-care-products-market-report

### large_images

**Severity:** Warning  **Affected:** 41

41 images exceed 100 KB (on top of the 6 critical >500 KB). Same fix pipeline.

**Affected URLs** _(sample of 5; full count: 41)_
- https://cdn.nuvani.edu/wp-content/uploads/2025/09/nail-tech-student.jpeg
- https://cdn.nuvani.edu/wp-content/uploads/2023/05/hair-student.jpeg
- https://cdn.nuvani.edu/wp-content/uploads/2023/05/coe-logo.png
- https://cdn.enrollmentresources.com/ada/compliance_seal.png
- https://cdn.nuvani.edu/wp-content/uploads/2025/09/att.vXMT1X178VWESwxjG6H6aD-ANhyh3ts-kj8f6JcFAos-1024x1024.jpg

### empty_anchor_text

**Severity:** Warning  **Affected:** 50

50 internal links have empty anchor text (mostly logo/image links to the homepage). Wastes internal-linking signal.

**Fix:** Add `aria-label`/alt or visible anchor text to image links; ensure templated nav/footer links carry descriptive anchors.

### thin_content

**Severity:** Warning  **Affected:** 16

16 pages are under 300 words. Confirmed complete from the page index.

**Fix:** Expand utility/landing pages (contact, apply, book-tour, accessibility-statement) with genuine content, or noindex truly utility pages.

**Affected URLs** _(complete — 16 pages; sample)_
- https://nuvani.edu/contact-us/
- https://nuvani.edu/apply-online/
- https://nuvani.edu/book-tour/
- https://nuvani.edu/category/blog/
- https://nuvani.edu/accessibility-statement/

### title_too_short

**Severity:** Warning  **Affected:** 17

17 titles are under 30 characters — under-using a primary ranking/CTR signal.

**Affected URLs** _(sample of 5; full count: 17)_
- https://nuvani.edu/contact-us/
- https://nuvani.edu/admissions/
- https://nuvani.edu/locations/
- https://nuvani.edu/news/
- https://nuvani.edu/locations/uvalde/

### multiple_h1

**Severity:** Warning  **Affected:** 5

5 pages have multiple H1s (mostly blog posts — likely the theme rendering both a site title and post title as H1).

**Affected URLs** _(sample of 5; full count: 5)_
- https://nuvani.edu/blog/career-changers-starting-a-beauty-career-after-30-40-or-50/
- https://nuvani.edu/blog/how-long-is-cosmetology-school-your-complete-timeline-to-licensing/
- https://nuvani.edu/blog/what-to-look-for-in-a-beauty-school-10-essential-factors/

### missing_meta_description

**Severity:** Warning  **Affected:** 2

Confirmed complete. Add unique 120–160 char descriptions.

**Affected URLs** _(complete — 2 pages)_
- https://nuvani.edu/category/blog/
- https://nuvani.edu/SID/npcalc.htm

### Security headers (HSTS / CSP / Referrer-Policy)

**Severity:** Warning  **Affected:** up to 164

164 pages lack HSTS and Content-Security-Policy headers; 138 have unsafe cross-origin links; 10 lack a Referrer-Policy. These are server/security-hygiene items (low direct SEO weight, real best-practice value) and are count-only here.

**Fix:** Add the headers at the web-server/CDN layer — one config change covers the whole site. _(URL list unavailable — surfaced from the SF issues summary.)_

*Additional warnings (sitemap redirects 8, non-indexable-in-sitemap 1, canonicals missing 16, H2 missing/multiple, URL hygiene) are visible in the dashboard.*

## Performance & Core Web Vitals

No PageSpeed, GSC, or GA4 data was included in this audit, so Core Web Vitals and traffic signals are unavailable. The strongest performance proxy here is **image weight** — 6 images >500 KB and 41 >100 KB (above). Add the `pagespeed` and Search Console / GA4 exports to overlay real CWV and click/impression data on this list.

## Duplicate Content

| Type | Count |
|---|---|
| Exact duplicate pages | 0 |
| Near-duplicate pages | 0 |
| Duplicate title tags | 2 groups |
| Duplicate meta descriptions | 3 groups |
| Duplicate H1s | 1 group |

Top duplicate groups:
1. **Title "News - Nuvani Institute"** — 10 pages (the paginated `/news/page/N/` archive sharing one title).
2. **H1 "News"** — 19 pages (same news archive; give paginated pages distinct H1s/titles or noindex the pagination).
3. **Title "Cosmetology School Austin TX | Nuvani Institute Beauty Programs"** — 2 pages.

## Recommendations

1. Fix the 5 broken 4xx link targets (subset of the 143 broken external links).
2. Optimize the 6 critical (>500 KB) and 41 large (>100 KB) images — convert to WebP/AVIF, compress.
3. Add alt text to the 66 images missing it (accessibility + image SEO).
4. Add descriptive anchor text to the 50 empty-anchor internal links.
5. Expand the 16 thin pages or noindex true utility pages.
6. Differentiate the `/news/` pagination (titles/H1s) or noindex it — resolves the duplicate title/H1 clusters.
7. Lengthen the 17 too-short titles; add the 2 missing meta descriptions and 1 missing H1.
8. Add HSTS / CSP / Referrer-Policy headers at the server/CDN layer.

## Implementation Order

| Priority | Issue / Theme | Effort | Affected | Why First |
|---|---|---|---|---|
| 1 | Broken external links (incl. 5 critical 4xx) | Low–Medium | 143 | Direct UX/quality fix; template links multiply impact |
| 2 | Image optimization (>500 KB + >100 KB) | Low | 47 | Pipeline/CDN change; biggest load-time win |
| 3 | `/news/` pagination dup titles & H1s | Low | ~19 | One template/noindex change clears several dup groups |
| 4 | Missing/short titles, missing meta & H1 | Low | ~20 | Template + a few manual edits; broad CTR signal |
| 5 | Empty / non-descriptive anchor text | Medium | ~76 | Per-link review; internal-linking signal |
| 6 | Image alt text | High | 66 | Per-image content work; accessibility + image SEO |
| 7 | Thin content | High | 16 | Content writing; schedule after quick wins |
| 8 | Security headers (HSTS/CSP/Referrer) | Low | site-wide | One server/CDN config; best-practice hardening |
```
