# SF-vs-Live Parity Log (SF-retirement campaign, Phase 1)

**Started:** 2026-07-05 · **Owner:** improvement-roadmap sessions · **Skill:** `er-seo-tools-sf-retirement-campaign`

Purpose: accumulate the **documented, explainable** SF-vs-live variance that the
retirement gate (roadmap §4 / Phase 7) requires — **N ≥ 5 representative clients
× 2–3 reporting cycles, every deviation explained** — AND the sitemap **miss-rate**
data (`discoveryCoverageJson`, C6 Increment 1) that gates hybrid-discovery
**Increment 2** (the crawler). This is a measurement log, not a build.

Data source: prod DB (`/home/seo/data/seo-tools/db.sqlite`). Parity numbers from
`.claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts`
(read-only). Miss-rate from `CrawlRun.discoveryCoverageJson`.

---

## Current data state (prod snapshot, 2026-07-05)

Read-only inventory of all `tool:'seo-parser'` CrawlRuns:

| Metric | Count |
|---|---|
| Total seo-parser runs | 83 |
| `sf-upload` runs | 7 |
| `live-scan` runs (all) | 76 |
| `live-scan` **seoIntent** runs | **1** (manhattanschool.edu) |
| Runs with `discoveryCoverageJson` | **0** |
| SiteAudits with `discoveryMode` set | **0** |
| Parity pairs (domain has BOTH sf-upload + seoIntent live-scan) | **1** (manhattanschool.edu) |

### Why the miss-rate stream is empty (0 data points)

C6 Increment 1 (sitemap miss-rate: `discoveryMode`/`discoveryCapped` on SiteAudit
+ `discoveryCoverageJson` on the live-scan run) deployed **2026-07-04** (PR #101).
**No site audit has run since it deployed:**
- The weekly canary (`weekly:1@06:00`, client 31 proway.erstaging.site) last fired
  **Mon 2026-06-30**, before Increment 1. Next: **Mon 2026-07-07**. (Canary is
  noindex → will populate `discoveryMode` but produce no useful miss-rate.)
- The one existing seoIntent live run (manhattan, completed 2026-07-02) also
  predates Increment 1 → no `discoveryCoverageJson` on it.

**→ The first real miss-rate data point requires a seoIntent audit of an indexable
client site (with a sitemap) triggered after 2026-07-04.** This is the handoff's
long-standing "FIRST GATE DATA POINT still pending."

### Parity candidates (domains that already have an SF upload)

Only these have the SF half already (need a seoIntent audit to complete/refresh a pair):

| Domain | Client | SF score | SF age | Notes |
|---|---|---|---|---|
| manhattanschool.edu | 12 (Manhattan School of Computer Technology) | 82 | 1.9 d | **Complete pair** (live run 2.7 d, pre-Increment-1) |
| glowcollegecanada.ca | 30 (Glow College of Artistic Design) | 85 | 24 d | Needs a seoIntent audit |
| nuvani.edu | 15 (Nuvani Institute) | 81 | 24 d | Needs a seoIntent audit |
| proway.erstaging.site | 31 (ER Staging Canary) | 86 | 24 d | Noindex canary — plumbing only, no on-page/coverage |

No active client has `seedUrls` set → none are `pre-discovered` by seed URLs → all
are eligible for **sitemap-mode** miss-rate measurement (good — more applicable data points).
30 active clients total; only 3 real client domains have SF data → **reaching the
≥5-client gate needs fresh SF uploads on ≥2 more clients** (analyst action).

---

## Data points

### 2026-07-05 · manhattanschool.edu · cycle 1 (baseline)

Runs compared (prod):
- SF   run `de498917` — completed 2026-07-03T18:30Z — score **82** (168 pages)
- Live run `54680dd9` — completed 2026-07-02T22:44Z — score **98** (66 pages), seoIntent, complete

| Metric | Value | Reading |
|---|---|---|
| **Score delta (Live − SF)** | **+16** | Expected direction & non-zero. Live scores a narrower factor set (no crawl-depth, no broken-links, and none of SF's security-header / redirect / orphan / analytics penalties), so it reads higher. Not a bug; track the distribution across clients, don't tune to zero. |
| **Page-set Jaccard** | **0.337** (SF 168 / Live 66 / overlap 59) | LOW, but SF's 168 is inflated by **asset URLs** (`wp-content/*.css`, `*.jpg`, `*.png`) that SF crawls and the live scan (page-only) does not. The clean miss-rate instrument is `discoveryCoverageJson`, not raw Jaccard. |
| **Real content pages SF found that Live missed** | `/admissions`, `/programs`, `/career-placement-support/`, `/student-success`, `/book-a-tour/` (among 109 SF-only, most of which are assets) | **Evidence FOR hybrid-discovery Phase 2** — sitemap-based discovery omitted reachable content pages. Quantify precisely with `discoveryCoverageJson` on a fresh audit. |
| **Live-only pages** | 7 (`/consumer-info-ae/`, `/thank-you*`, `/locations/`, `/locations/online/`, …) | Pages the live crawl reached that this SF export didn't include. Small. |
| **Shared issue type** | `duplicate_title` 1 \| 1 (Δ0) | Perfect agreement on the one type both sides emit. |
| **SF-only issue types** | ~70 types ("—" on Live) | Expected capability gaps: redirects, alt text, security headers, orphans, canonical, analytics joins, readability, etc. Record; do not chase. |
| **Live-only issue types** | `broken_images` (40), `broken_internal_links` (4), `missing_h1` (1), `missing_meta_description` (3), `thin_content` (5) | Live emits live-verified broken-link + on-page findings; SF reports broken links differently (`broken_pages` 62 / `client_errors_4xx` 122). Not directly comparable — a known semantic difference, not a regression. |

**Deviation verdict:** all deviations explained (score-denominator difference;
asset-URL Jaccard inflation; documented issue-type capability gaps). No unexplained
deviation → no bug hunt. **⚠ Caveat:** this pair predates Increment 1, so it carries
no `discoveryCoverageJson`. Re-run a fresh seoIntent audit on manhattan to (a) capture
the **first miss-rate data point** and (b) refresh the pair on post-Increment-1 code.

---

## Operational plan to fill the two data streams

Both streams are blocked on the same operational action — **triggering seoIntent
audits of indexable client sites** — which needs an authed prod session (prod is
OAuth-only; no automated cookie available). Options:
1. Kevin triggers seoIntent audits from the UI (or supplies an `er_auth` cookie so
   a session can run the runbook curls), starting with **manhattanschool.edu**
   (validated, indexable, has a sitemap → first `discoveryCoverageJson` point).
2. Analysts run fresh SF uploads on ≥2 more clients (beyond manhattan / glow / nuvani)
   to reach the ≥5-client parity gate.
3. After each audit: run `sf-live-parity.ts <domain>` + record the
   `discoveryCoverageJson` value here as a new dated data point.

**Gate to pass Phase 1:** ≥5 clients × 2–3 cycles, every deviation explained here.
**Gate for hybrid-discovery Increment 2:** measured sitemap miss-rate across real
seoIntent audits shows sitemaps routinely miss important pages (roadmap §5).
