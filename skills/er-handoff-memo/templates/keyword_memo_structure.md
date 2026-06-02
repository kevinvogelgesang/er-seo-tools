# Keyword Strategy Memo Template

## Section schema (strict)

The memo MUST contain these sections in this order, with markdown headers
exactly as shown. Skip `## Content Opportunities` detail only if `gap_keywords`
is absent (but always include the section with the "no data" note).

| # | Header | Length | Content |
|---|---|---|---|
| 1 | `## Executive Summary` | 2–4 sentences | Site name, total ranking keywords, data sources, top 2–3 themes |
| 2 | `## Keyword Performance Overview` | Table or bullets | Scale summary: total keywords, top-10 rankings count, traffic pages count, data-source notes |
| 3 | `## Target Keyword Priorities & Topic Clusters` | 3–5 clusters, 1 paragraph each | Pages grouped by theme; focus keyword per cluster; one on-page action |
| 4 | `## Cannibalization Fixes` | One subsection per cannibalized keyword | Keyword, competing URLs, ONE recommended canonical URL + disposition for others |
| 5 | `## Quick Wins` | Up to 10 items + overflow note | keyword, position, volume, URL, one-sentence action |
| 6 | `## Content Opportunities` | Two priority buckets (high/medium) | gap_keywords sorted by volume desc, difficulty asc; content type suggestion |
| 7 | `## Top Pages Analysis` | Table (top 10) | URL, estimated monthly traffic, keyword count, traffic share %, intent |
| 8 | `## Recommended Next Steps` | Priority table (5–8 rows) | Columns: Priority, Action, Effort, Expected Impact |

Total target: 700–1,300 words.

---

## Cannibalization subsection format

Each cannibalized keyword appears as:

```markdown
### {keyword}

**Search volume:** {search_volume}  **Intent:** {intent}

Competing pages:

| URL | Position | Est. Traffic |
|---|---|---|
| https://example.com/cosmetology-program/ | 7 | 140 |
| https://example.com/cosmetology/ | 14 | 55 |

**Recommendation:** Make `https://example.com/cosmetology-program/` the canonical
page — it holds position 7 and captures most traffic. 301-redirect
`https://example.com/cosmetology/` to it and consolidate any unique content.
```

One canonical URL per keyword — always name the URL, never say "one of these."
If both URLs have similar traffic and neither is clearly better, recommend the
more specific/descriptive slug and note the tradeoff.

---

## Quick Wins item format

```markdown
| Keyword | Position | Volume | URL | Action |
|---|---|---|---|---|
| cosmetology license requirements | 14 | 880 | /blog/cosmetology-faq/ | Expand the H2 covering licensing to 300+ words; add FAQ schema |
| best cosmetology school near me | 17 | 1,300 | /cosmetology-program/ | Add city/region modifier to title tag and H1 |
```

---

## Content Opportunities format

```markdown
### High Priority (volume ≥ 500, difficulty ≤ 60)

| Keyword | Volume | Difficulty | Intent | Suggested Content |
|---|---|---|---|---|
| cosmetology school financial aid | 1,600 | 38 | Informational | Dedicated Financial Aid page |
| how long does cosmetology school take | 2,400 | 29 | Informational | Blog post / FAQ expansion |

### Medium Priority (volume 100–499 or difficulty 61–80)

| Keyword | Volume | Difficulty | Intent | Suggested Content |
|---|---|---|---|---|
| cosmetology vs esthetics program | 320 | 55 | Informational | Comparison blog post |
```

If `gap_keywords` is absent:

```markdown
No gap keywords available in this dataset. Upload a SEMRush Keyword Gap
Analysis export to populate this section.
```

---

## Recommended Next Steps table format

```markdown
| Priority | Action | Effort | Expected Impact |
|---|---|---|---|
| 1 | Update title + H1 on /cosmetology-program/ to include "near me" variant | Low | Position 17 → 8–12 est. |
| 2 | 301-redirect /cosmetology/ to /cosmetology-program/ (cannibalization fix) | Low | Consolidate ranking authority |
| 3 | Create Financial Aid page targeting "cosmetology school financial aid" (1.6K vol) | Medium | New top-5 ranking opportunity |
| 4 | Expand FAQ section on /blog/cosmetology-faq/ with licensing content | Low | Capture 880 vol quick win |
| 5 | Commission blog post: "How long does cosmetology school take?" (2.4K vol) | Medium | High-volume informational entry point |
```

Effort scale:
- **Low** — on-page edit or redirect, < 2 hours
- **Medium** — new page or substantial content expansion, 1–3 days
- **High** — site-wide change or multi-page content project, 1+ weeks

---

## Voice

Internal, direct. The client never sees this. Name specific URLs and keywords.
Say "redirect X to Y" not "consider consolidating." Say "write a 1,000-word
FAQ" not "create content." If data is absent, say so plainly.

---

## Example Memo

*Hypothetical client: Poway Hair School, a cosmetology college.
847 ranking keywords. SEMRush + GSC connected. 3 cannibalization issues.
12 quick wins. 28 gap keywords.*

```markdown
## Executive Summary

Poway Hair School (prowayhairschool.com) currently ranks for 847 keywords across
SEMRush and GSC. The most actionable opportunities are twelve quick wins in
positions 11–20 (combined search volume ~8,400/month), three cannibalization
conflicts splitting authority across near-duplicate program pages, and a
content gap in the financial aid and career-outcomes space where competitors
rank but Poway does not. A linked technical audit is available in the dashboard
for cross-referencing crawl and on-page issues.

## Keyword Performance Overview

| Metric | Value |
|---|---|
| Total ranking keywords | 847 |
| Keywords in positions 1–10 | 94 |
| Keywords in positions 11–20 (quick wins) | 12 |
| Pages with organic traffic data | 38 |
| Data sources | SEMRush + GSC (GA4 not connected) |

Traffic estimates are SEMRush-based; GSC actuals may vary. GA4 not connected —
upload GA4 export for session-level confirmation.

## Target Keyword Priorities & Topic Clusters

### Cosmetology Programs

Core pages: `/cosmetology-program/`, `/cosmetology/` (competing — see §4).
Top ranking keywords: "cosmetology school San Diego" (pos. 6, 1,300/mo),
"cosmetology license California" (pos. 9, 880/mo).
**Focus intent:** Commercial + local. **Action:** Consolidate the two
competing program pages (§4) and add a "Why Choose Poway" section with
structured data.

### Financial Aid & Tuition

No dedicated Financial Aid page exists. Competitors rank for "cosmetology
school financial aid" (1,600/mo) and "how to pay for cosmetology school"
(720/mo). **Action:** Create `/financial-aid/` targeting these terms.

### Career Outcomes

`/careers/` exists but ranks for zero top-20 keywords. Competitor analysis
shows "cosmetologist salary California" (2,900/mo, difficulty 45) is
unclaimed. **Action:** Expand `/careers/` with salary data and job-placement
statistics.

## Cannibalization Fixes

### cosmetology school san diego

**Search volume:** 1,300  **Intent:** Commercial

| URL | Position | Est. Traffic |
|---|---|---|
| /cosmetology-program/ | 6 | 210 |
| /cosmetology/ | 19 | 40 |

**Recommendation:** Make `/cosmetology-program/` the canonical page — it
holds position 6 and 80% of the traffic. 301-redirect `/cosmetology/` to it.
Migrate any unique content (e.g. curriculum detail) into `/cosmetology-program/`
before redirecting.

## Quick Wins

| Keyword | Position | Volume | URL | Action |
|---|---|---|---|---|
| cosmetology license requirements | 14 | 880 | /blog/cosmetology-faq/ | Expand licensing H2 to 300+ words; add FAQ schema markup |
| best cosmetology school near me | 17 | 1,300 | /cosmetology-program/ | Add city modifier to title: "Best Cosmetology School in San Diego" |
| cosmetology program length | 11 | 480 | /cosmetology-program/ | Add a visible "Program Duration" section above the fold |

*(9 additional quick wins — see full data in dashboard)*

## Content Opportunities

### High Priority (volume ≥ 500, difficulty ≤ 60)

| Keyword | Volume | Difficulty | Intent | Suggested Content |
|---|---|---|---|---|
| cosmetology school financial aid | 1,600 | 38 | Informational | Dedicated /financial-aid/ page |
| how long does cosmetology school take | 2,400 | 29 | Informational | Blog post or FAQ section |
| cosmetologist salary california | 2,900 | 45 | Informational | Expand /careers/ with salary data |

### Medium Priority (volume 100–499 or difficulty 61–80)

| Keyword | Volume | Difficulty | Intent | Suggested Content |
|---|---|---|---|---|
| cosmetology vs esthetics | 320 | 55 | Informational | Comparison page or blog post |
| cosmetology school accreditation | 210 | 48 | Informational | Add accreditation section to About page |

*(23 additional gap keywords available — see full list in dashboard)*

## Top Pages Analysis

| URL | Est. Monthly Traffic | Keywords | Traffic Share | Intent |
|---|---|---|---|---|
| /cosmetology-program/ | 680 | 94 | 28% | Commercial |
| / (homepage) | 510 | 61 | 21% | Navigational |
| /blog/cosmetology-faq/ | 290 | 47 | 12% | Informational |
| /careers/ | 45 | 8 | 2% | Informational |

Traffic estimates from SEMRush. GSC actuals may be higher for branded terms.

## Recommended Next Steps

| Priority | Action | Effort | Expected Impact |
|---|---|---|---|
| 1 | 301-redirect /cosmetology/ → /cosmetology-program/ (cannibalization fix) | Low | Consolidate positions 6 + 19 into single ranking |
| 2 | Update /cosmetology-program/ title + H1 to include "San Diego" | Low | Quick win: position 17 → est. 8–12 |
| 3 | Create /financial-aid/ page targeting "cosmetology school financial aid" (1.6K vol) | Medium | New top-5 ranking opportunity |
| 4 | Expand /blog/cosmetology-faq/ licensing section with FAQ schema | Low | Capture 880/mo quick win |
| 5 | Commission "How long does cosmetology school take?" blog post (2.4K vol, diff 29) | Medium | High-volume informational entry |
| 6 | Expand /careers/ with salary data + structured data markup | Medium | Capture 2.9K/mo cosmetologist salary keyword |
```
