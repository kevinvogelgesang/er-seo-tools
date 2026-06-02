# Pillar Analysis Memo Template

## Section schema (strict)

The memo MUST contain exactly these six sections, in this order, with
markdown headers exactly as shown:

| # | Header | Length | Content |
|---|---|---|---|
| 1 | `## 1. Bottom line` | 1–3 sentences | "Worth it" / "Worth it but later" / "Don't bother — fix X first" verdict |
| 2 | `## 2. Score interpretation` | 1 paragraph | What the 1–10 means for THIS site. Name the weakest subscore explicitly. |
| 3 | `## 3. Hub recommendation` | 2 paragraphs | Picked format + reasoning + runner-up + how close the call was |
| 4 | `## 4. Pillar topics` | One subsection per cluster | `### {Cluster name}`, anchor URL, page count, topical strength, one risk |
| 5 | `## 5. Migration sequencing` | 1 paragraph + ordered list | First / second / third action items |
| 6 | `## 6. Caveats` | Bulleted list | Missing data, low-confidence verdicts, sample-size warnings |

Total target: 600–1000 words.

## Voice

Internal, blunt. The client NEVER sees this output. Accuracy beats
diplomacy. If the data says "don't pillar this site yet," write that
directly. If a cluster is borderline, say so. If a recommendation is
low-confidence, surface the doubt.

The two examples below model this voice. Mimic their tone, not just
their structure.

---

## Example A — Score 8, anchor-rich career college (confident pillar opportunity)

*Hypothetical client: Mountain Trade Institute, a career college teaching HVAC, electrical, and plumbing across two campuses (Phoenix, Tucson). 187 URLs crawled.*

```markdown
## 1. Bottom line

Worth it. The site is sitting on a textbook anchor-rich pillar setup — three substantive program pages, two location pages with regional content, and ~50 blog posts that map cleanly to those anchors. Three program pillars + two location pillars = real upside if the team commits to building out the catchall hub for the orphaned 8 posts.

## 2. Score interpretation

Score 8/10 is a high-confidence "go" call. Content volume (9.2/10) and topical concentration (10/10) are both strong — the site has enough informational depth and the clusters are coherent without being over-fragmented. Existing organic footprint (8.4/10) means there's already latent search demand for the cluster pages to harvest. The weakest subscore is internal-link gap at 4.5 — the site is already moderately well-linked, so pillar work captures less link-equity benefit than on a site with sparse linking. Net: this is a clean retrofit, not a rebuild.

## 3. Hub recommendation

Nest under programs. 87% of clusters are vertical (each maps cleanly to one program), and the program pages already pull informational impressions on terms like "HVAC technician training Phoenix" and "electrician apprenticeship cost." The program pages are commercially-strong with clear program details + apply CTAs, but they currently link sparsely to the supporting blog content. Pillar conversion = wire each program page to its 8–15 cluster pages and add a topical-overview section near the top.

The runner-up is hybrid (vertical clusters under programs, horizontal under /resources/) at score delta 1.8 — close enough that if the team wants to spin up a /resources/ hub for the catchall (financial aid, study tips), that's a defensible call. The fresh-/career-guides/ option scores far behind (delta 5.1) since SERP for these terms is dominated by program-comparison content, not guide-format competitors.

## 4. Pillar topics

### HVAC Technician Training (program: /programs/hvac-technician/)

12 cluster pages. Strong topical coverage spanning licensing, salary, day-in-the-life, certifications. Pillar candidate is the existing program page (high inlinks, ranks for transactional queries already). Risk: 3 of the 12 cluster posts are 4+ years old and reference outdated EPA cert numbers — refresh those before linking to the pillar.

### Electrical Trades (program: /programs/electrical-trades/)

9 cluster pages. Pillar coverage is solid except for a gap on residential vs. commercial career paths — a single new article would close that. Risk: minimal.

### Plumbing (program: /programs/plumbing/)

7 cluster pages. Smallest of the program pillars. Risk: this is the boundary of viable cluster size; if 2 of the 7 posts get pruned for thin content (see §6), the pillar drops below `minClusterSize=3` for any subtopic groupings.

### Phoenix Campus (location: /locations/phoenix/)

5 cluster pages, all blog posts about Phoenix-specific job market / employer partnerships / events. Anchor page is the existing campus page (good inlinks, geo-modifier ranks). Risk: 2 of the 5 are event recap posts that age fast — consider removing time-bound content from the cluster.

### Tucson Campus (location: /locations/tucson/)

3 cluster pages — at the floor for cluster viability. Risk: noted; the cluster is "real" but won't drive significant volume.

### General Resources (catchall)

8 unassigned posts on financial aid, FAFSA tips, study habits. Recommend nesting under a new `/resources/` hub OR splitting between programs (FAFSA → general program landing, study tips → maybe drop). Score-favored option is "rename /blog/ → /resources/" if the existing /blog/ has any backlink authority worth preserving.

## 5. Migration sequencing

Order matters here — start with the highest-confidence, lowest-risk pillars to validate the approach before touching weaker clusters.

1. **HVAC pillar (week 1).** Refresh the 3 outdated posts (EPA cert numbers), then add internal links from each cluster post → program page. Add a topical-overview section to the program page that links DOWN to the 12 cluster pages.
2. **Electrical pillar (week 2).** Same playbook + commission the residential-vs-commercial article to close the topical gap.
3. **Phoenix campus pillar (week 3).** Lower stakes — just the inlinks pass; no new content needed.
4. **Plumbing + Tucson (week 4).** Borderline clusters — measure HVAC's traffic lift before committing to these.
5. **Catchall hub (deferred).** Don't spin up `/resources/` until you've validated the program-pillar approach is delivering. The 8 catchall posts can sit where they are for 90 days.

## 6. Caveats

- Backlink data not uploaded — `backlinkDistribution` defaulted to 5/10 (neutral). If Mountain Trade Institute has a Semrush subscription, re-run the analysis with that export to refine the score and the consolidate verdicts.
- 4 cluster posts are >4 years old and may be ranking on stale terms. Verify before linking from the pillar.
- Tucson cluster is at the `minClusterSize=3` floor — if any of those posts get pruned for any reason, the cluster collapses.
- Anchor-based clustering used `verticalAlignmentThreshold=0.55` (default). On a site this anchor-rich, a slightly higher threshold might tighten cluster assignments — worth tuning if the analyst sees a borderline blog post mis-clustered.
```

---

## Example B — Score 4, missing data, pump-the-brakes

*Hypothetical client: Riverside Beauty Academy, a small single-program cosmetology school in a regional market. 64 URLs crawled. No GSC export, no Semrush data.*

```markdown
## 1. Bottom line

Don't bother yet. The site doesn't have the topical depth to support a pillar model — only 12 informational posts that mostly fail to cluster, a single program page that's confused commercially-vs-informationally, and ~60% of the score signals are missing because no GSC or Semrush data was provided. Fix the program page first, expand the blog inventory, then re-run this analysis in 6 months.

## 2. Score interpretation

Score 4/10 with `dataCompleteness: 60%` is a soft no. Three of six subscores are real measurements; the other three defaulted to neutral 5.0 because no GSC export and no Semrush data were uploaded. The weakest measured subscore is content volume (2.1/10) — 12 informational posts is below the 15-post floor where pillar models start to make sense. Topical concentration is also weak (3.5) — only 1 cluster of size ≥3 forms, so there's nothing to actually pillar around.

The score being a 4 rather than a 2 is mostly the neutral-default subscores propping it up. If GSC and Semrush data confirm what the structural data already implies, expect this to drop to a 2 or 3.

## 3. Hub recommendation

Fresh `/resources/` hub — but with low confidence. The decision tree picked this because clusters skew horizontal (no clear program-anchor matching) and the existing `/blog/` doesn't have detectable backlink authority worth preserving. Score: 5.4/10. Runner-up is `fresh-career-guides-hub` at 4.1, which would be more defensible IF Riverside had topical content matching career-guide patterns ("how to become an esthetician," "cosmetologist salary"). It doesn't.

The honest read: hub format is moot until the content inventory grows. Recommendation is provisional — re-run after the content expansion in §5 and the answer may shift.

## 4. Pillar topics

### Cosmetology Career Topics (program: /programs/cosmetology/)

3 cluster pages — barely above the `minClusterSize=3` floor. Pillar candidate is the program page. Risk: it's commercially-confused. The page has sections that read transactional ("Apply now") AND informational ("What does a cosmetologist do?"), and the intent classifier flagged it as commercial with low confidence (0.62). Before pillaring, split this into two pages: a clean transactional program landing + a "what is cosmetology" informational hub.

### General Resources (catchall)

7 unassigned posts on miscellaneous topics (industry trends, school stories, alumni interviews). No coherent topic emerges; treat these as standalone blog posts, not cluster fodder.

(Only one anchor cluster of viable size — the rest of the inventory is too thin or too scattered.)

## 5. Migration sequencing

The fastest win is NOT pillaring. Spend the next quarter doing this instead:

1. **Fix the program page.** Split `/programs/cosmetology/` into a transactional landing page + a `/what-is-cosmetology/` hub. Disambiguates intent for both Google and analysts.
2. **Commission 8–10 new informational posts** to push content volume above the 15-post floor. Topics: licensing process by state, salary expectations, day-in-the-life, career paths from cosmetology (esthetician, salon owner, etc.).
3. **Upload GSC and Semrush data** to the next analysis run. Without those signals, half the scoring is guesswork.
4. **Re-run the pillar analysis in 6 months.** If content volume + completeness both move up, the score should land in the 6–8 range and the recommendation becomes actionable.

## 6. Caveats

- **dataCompleteness 60%** — three subscores are neutral defaults, not real measurements. The score is directional only. Re-run with full data before making strategic calls.
- **Single program** means no anchor diversity. If Riverside expands its program catalog, this analysis becomes much more useful.
- **Content inventory below floor.** 12 posts is too thin to support any pillar structure; recommendations are mostly "grow first."
- **Program page commercial-intent confidence is low (0.62)**. Worth a manual review of the page; the classifier may be flagging real ambiguity that hurts both organic ranking and pillar viability.
- **No backlink data** — verdict logic for "leave-as-blog" (singletons with authority) couldn't trigger correctly. Some of the 7 catchall posts may have backlinks that change their classification. Re-run with Semrush data to refine.
```
