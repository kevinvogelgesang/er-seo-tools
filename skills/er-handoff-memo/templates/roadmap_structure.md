# SEO Audit Roadmap Template

## Section schema (strict)

The roadmap MUST contain these sections in this order, with markdown headers
exactly as shown. Skip `## Duplicate Content` and `## Recommendations` only
if the data is absent from the audit export.

| # | Header | Length | Content |
|---|---|---|---|
| 1 | `## Executive Summary` | 2–4 sentences | Site name, URL count, severity breakdown, top themes |
| 2 | `## Critical Issues` | One subsection per critical issue | `### {issue.type}`, count, description, concrete fix guidance, URL block |
| 3 | `## High-Priority Warnings` | One subsection per warning (cap 8) | Same format as critical issues |
| 4 | `## Performance & Core Web Vitals` | 1–2 paragraphs + optional list | PageSpeed opportunities, GSC/GA4 summary |
| 5 | `## Duplicate Content` | Count table + top 3 groups | Omit if `duplicate_content` absent |
| 6 | `## Recommendations` | Numbered list | Render `audit.recommendations` verbatim; omit if empty |
| 7 | `## Implementation Order` | Markdown table | Top 5–8 items; columns: Priority, Issue/Theme, Effort, Affected Pages, Why First |

Total target: 800–1400 words.

## Issue subsection format

Each issue subsection looks like:

```markdown
### Missing Meta Descriptions

**Severity:** Warning  **Affected pages:** 47

Pages are missing `<meta name="description">` tags, which reduces click-through
rate from search results and means Google writes its own snippets.

**Fix:**
- Add unique meta descriptions (120–160 characters) to all 47 pages.
- Prioritise high-traffic pages first (see GSC data in §4 if available).
- For templated page types, update the CMS template — one change fixes the entire group.
- Use the affected-URL list below to build a prioritized backlog.

**Affected URLs** _(complete — 47 pages)_

- https://example.com/about/
- https://example.com/programs/cosmetology/
- … (list all when affectedUrlSource is derived-page-index or parser-complete)
```

When `affectedUrlSource` is `parser-sample`, use this phrasing instead:

```markdown
**Affected URLs** _(sample of 5 shown; full affected count: 47)_

- https://example.com/foo/
- …
```

## Voice

Internal, direct. The client never sees this. Accuracy beats diplomacy.
If a fix is simple, say it's simple. If a fix requires significant content
work, estimate the scope. Avoid filler phrases like "it is important to note."

## Implementation Order table format

```markdown
| Priority | Issue / Theme | Effort | Affected Pages | Why First |
|---|---|---|---|---|
| 1 | Broken internal links | Low | 31 | Fastest fix; direct crawl + UX impact |
| 2 | Missing H1 tags | Low | 18 | Template change; broad ranking signal |
| 3 | Missing meta descriptions | Low | 47 | CTR improvement; template-fixable |
| 4 | Thin content (<300 words) | High | 22 | Requires content work; high ranking impact |
| 5 | Duplicate title tags | Medium | 9 | Manual review + rewrite per page |
```

Effort scale:
- **Low** — template/config fix, one developer, < 1 day
- **Medium** — requires per-page review or moderate content work, 1–3 days
- **High** — significant content writing or structural change, 1+ weeks

---

## Example Roadmap

*Hypothetical client: Cascade Allied Health, a healthcare career college.
312 URLs crawled. Critical: 3, Warnings: 11, Notices: 7.*

```markdown
## Executive Summary

Cascade Allied Health (cascade-allied.edu, 312 URLs) has three critical issues
and eleven warnings. The dominant themes are on-page SEO gaps (missing/duplicate
meta elements), crawl-accessibility problems (redirect chains, broken links), and
thin content on program sub-pages. Core Web Vitals data was included and shows
LCP outside the "Good" threshold on mobile — addressed in §4.

## Critical Issues

### Broken Internal Links

**Severity:** Critical  **Affected pages:** 31

Thirty-one internal links point to 404 pages. Each broken link wastes crawl
budget, degrades user experience, and signals poor site maintenance to Google.

**Fix:**
- Audit each broken destination; either restore the content at that URL or
  redirect to the correct replacement.
- Prioritise pages in the `/programs/` folder — these are revenue-critical.
- Once redirects are in place, update the source links to point directly to
  the final destination (avoid redirect chains).

**Affected URLs** _(complete — 31 pages)_

- https://cascade-allied.edu/programs/medical-assisting/externship/
- https://cascade-allied.edu/blog/2022/cna-salary-guide/
- … (31 total)

---

### Duplicate Title Tags

**Severity:** Critical  **Affected pages:** 19

Nineteen pages share identical `<title>` tags — primarily location pages and
program-sub-pages that use the same template string without unique overrides.
Google suppresses duplicate titles in SERPs, which compresses impressions
for all affected pages.

**Fix:**
- Audit the CMS template for location and sub-program pages; add a
  `{program_name} | {location} | Cascade Allied Health` title pattern.
- For blog posts with duplicate titles, the content is likely too similar —
  consider consolidating rather than rewriting both titles.

**Affected URLs** _(sample of 5 shown; full affected count: 19)_

- https://cascade-allied.edu/locations/portland/
- https://cascade-allied.edu/locations/seattle/
- …

---

### Pages with No Indexable Inbound Links (Orphan Pages)

**Severity:** Critical  **Affected pages:** 14

Fourteen pages receive no internal links from any other crawled page. These
pages are effectively invisible to crawlers and receive no link equity — even
if they rank occasionally, they cannot compound authority from the rest of
the site.

**Fix:**
- Review each orphan page; most should be wired into the nearest relevant
  section (programs, blog, resources).
- Add a sitemap XML entry as a minimum safety net, but internal links are
  non-negotiable for pages you want to rank.

**Affected URLs** _(complete — 14 pages)_

- https://cascade-allied.edu/financial-aid/scholarship-fund/
- …

## High-Priority Warnings

### Missing Meta Descriptions

**Severity:** Warning  **Affected pages:** 47

…

### Thin Content (<300 words)

**Severity:** Warning  **Affected pages:** 22

…

*(additional warnings follow in same format)*

## Performance & Core Web Vitals

LCP (Largest Contentful Paint) is 4.1 s on mobile — outside Google's "Good"
threshold (< 2.5 s). The audit captured two PageSpeed opportunities worth
acting on:

- **Eliminate render-blocking resources** — 12 pages affected, average 880 ms
  savings. Defer non-critical JS and CSS.
- **Properly size images** — 28 pages affected, average 1.2 s savings.
  Serve WebP/AVIF and set explicit width/height attributes.

No GSC or GA4 data was included in this audit. Upload those exports to the
SEO Parser to get click/impression signals overlaid on the issue list.

## Duplicate Content

| Type | Count |
|---|---|
| Exact duplicate pages | 4 |
| Near-duplicate pages | 11 |
| Duplicate title tags | 19 |
| Duplicate meta descriptions | 31 |
| Duplicate H1s | 8 |

Top duplicate title groups:
1. "Cascade Allied Health" — 7 pages (homepage template leaking)
2. "Healthcare Career Training" — 5 pages (program sub-page template)
3. "About Us | Cascade Allied Health" — 4 pages (multi-locale About pages)

## Recommendations

1. Fix broken internal links — start with /programs/ folder
2. Add unique title tags across all location and program sub-pages
3. Wire orphan pages into the site via internal links or navigation
4. Compress and convert images to WebP/AVIF sitewide
5. Add meta descriptions to all 47 affected pages

## Implementation Order

| Priority | Issue / Theme | Effort | Affected Pages | Why First |
|---|---|---|---|---|
| 1 | Broken internal links | Low | 31 | Direct fix; crawl + UX impact; no content needed |
| 2 | Orphan pages | Low | 14 | Internal links only; high crawlability leverage |
| 3 | Duplicate title tags | Low–Medium | 19 | Template fix covers most cases |
| 4 | Missing meta descriptions | Low | 47 | Template fix; broad CTR impact |
| 5 | Image optimization (LCP) | Low | 28 | Pipeline change; measurable CWV win |
| 6 | Thin content | High | 22 | Content work; schedule after quick wins |
| 7 | Near-duplicate pages | Medium | 11 | Requires per-page review and consolidation decision |
```
