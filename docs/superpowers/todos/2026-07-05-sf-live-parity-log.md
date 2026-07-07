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

## ✅ 2026-07-06 — Phase 1 gate MET (7-client parity + first miss-rate data)

**Both gates cleared in one operator session** (Kevin supplied an `er_auth` cookie;
Claude drove upload → parse → seoIntent audit → parity/coverage recording):
- **≥5-client parity gate:** 7 clients, every deviation explained (below).
- **Hybrid-discovery Increment-2 gate DATA:** 7 `discoveryCoverageJson` points
  (was **0**), miss-rate **7.7%–42.2%** — sitemaps routinely omit reachable
  content. See the 2026-07-06 data table + synthesis under **Data points**.

Three prod bugs were surfaced + fixed by this exercise (the live scanner had
never before been run across a batch of real medium/large client sites):
- **PR #105** — internal-link verify pass had no time budget (external did) →
  slow-but-finite sites died before the run write. Added `BROKEN_LINK_INTERNAL_TIME_BUDGET_MS`.
- **PR #106** — widened `SAFETY_RESERVE_MS` 60s→180s (budget-allocation margin).
- **PR #107 (the real one)** — `safeFetch` hung forever on out-of-range HTTP
  statuses (LinkedIn's `999`): `new Response({status})` threw inside the response
  callback after `settled=true`, so the promise never settled → verifier worker
  blocked → 15-min job timeout cycle (manhattan, cambria). A time budget can't
  stop a promise that never settles — #107 is what actually unblocked them.

---

## Current data state (prod snapshot, 2026-07-05 — superseded by 2026-07-06 above)

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

### Parity candidates

**A. Already uploaded as `sf-upload` CrawlRuns in prod** (SF half live in the DB):

| Domain | Client | SF score | SF age | Notes |
|---|---|---|---|---|
| manhattanschool.edu | 12 (Manhattan School of Computer Technology) | 82 | 1.9 d | **Complete pair** (live run 2.7 d, pre-Increment-1) |
| glowcollegecanada.ca | 30 (Glow College of Artistic Design) | 85 | 24 d | Needs a seoIntent audit |
| nuvani.edu | 15 (Nuvani Institute) | 81 | 24 d | Needs a seoIntent audit |
| proway.erstaging.site | 31 (ER Staging Canary) | 86 | 24 d | Noindex canary — plumbing only, no on-page/coverage |

**B. Fresh full SF crawls on DISK (2026-07-05), NOT yet uploaded** — Kevin ran these
manually with GA4+GSC + full 47-CSV bulk exports. They become the SF half of a parity
pair **only after being uploaded at `/seo-parser`** (creates a `Session` + `sf-upload`
CrawlRun). GA4/GSC verified correct on the bidwell export (matched property, real metrics):

| Slug (sf-crawls/) | Client | Domain | Crawl timestamp |
|---|---|---|---|
| bidwell | 3 (Bidwell Training Center) | bidwelltraining.edu | 2026.07.05.10.03.16 |
| boca | 4 (Boca Beauty Academy) | bocabeautyacademy.edu | 2026.07.05.10.15.20 |
| brockway | 5 (Brockway Center for Arts and Technology) | brockwaycatart.org | 2026.07.05.10.17.39 |
| brownson | 6 (Brownson Technical School) | brownson.edu | 2026.07.05.10.22.32 |
| cambria | 29 (Cambria College) | cambriacollege.ca | 2026.07.05.10.27.40 |
| discovery | 26 (Discovery Community College) | discoverycommunitycollege.com | 2026.07.05.11.12.53 |
| manhattan | 12 (Manhattan School of Computer Technology) | manhattanschool.edu | 2026.07.03.11.29.25 (already uploaded) |

**→ SF-side prerequisite now MET for the ≥5-client gate** (7 clients with fresh crawls).
No active client has `seedUrls` set → all are eligible for **sitemap-mode** miss-rate
measurement (good — more applicable data points). Remaining work is operational: upload
the disk crawls + trigger matching seoIntent audits + record parity/coverage per domain.

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

### 2026-07-06 · full 7-client batch (post-#107) · cycle 1

All 7 target clients: fresh SF export uploaded at `/seo-parser` (→ `sf-upload`
CrawlRun) + a `seoIntent` site audit triggered (→ `live-scan` CrawlRun with
`discoveryCoverageJson`). Every audit ran `mode:'sitemap'`, non-capped → every
miss-rate is a valid headline number. Numbers from `sf-live-parity.ts` +
`CrawlRun.discoveryCoverageJson` on prod.

| Domain | Client | SF | Live | Δ (live−SF) | live status | Jaccard | **miss-rate** | off-baseline | page errors |
|---|---|---|---|---|---|---|---|---|---|
| bidwelltraining.edu | 3 | 90 | 89 | **−1** | complete | 0.651 | **8.5%** | 5 | 1 |
| brockwaycatart.org | 5 | 62 | 73 | +11 | partial | 0.385 | **7.7%** | 7 | 28 (all HTTP 403) |
| brownson.edu | 6 | 81 | 90 | +9 | complete | 0.395 | **18.3%** | 19 | 0 |
| cambriacollege.ca | 29 | 83 | 100 | +17 | complete | 0.784 | **21.1%** | 24 | 0 |
| manhattanschool.edu | 12 | 82 | 99 | +17 | complete | 0.343 | **37.4%** | 40 | 0 |
| discoverycommunitycollege.com | 26 | 62 | 89 | +27 | partial | 0.471 | **40.4%** | 420 | 3 |
| bocabeautyacademy.edu | 4 | 81 | 98 | +17 | partial | 0.401 | **42.2%** | 127 | 0 |

**Miss-rate synthesis (the Increment-2 gate number):** range **7.7%–42.2%**,
median ~21%, mean ~25%. **4 of 7 sites ≥ 18%; 3 of 7 ≥ 37%.** Sitemaps routinely
omit a large fraction of internally-reachable content — strong, quantified
evidence FOR building hybrid-discovery **Increment 2** (the link-graph crawler).
`offBaseline` counts reachable internal-link targets absent from the sitemap
baseline (images + non-page extensions already excluded — this is the clean
instrument, not raw Jaccard). Low miss-rate (brockway/bidwell ~8%) = tight
sitemaps; high (boca/discovery ~40%) = sitemaps missing whole content sections.

**Score-delta verdict:** all deviations explained. Live > SF on 6/7 (Δ +9..+27,
bidwell −1). Expected & documented: the live score omits SF's crawl-depth,
broken-link, security-header, redirect, orphan, and analytics penalties, so it
reads higher; it is NOT the same denominator (do not tune to zero — track the
distribution). Live page counts < SF because SF's page set includes asset URLs
the page-only live scan excludes (inflates SF, deflates Jaccard).

**Per-domain deviation notes (all explained → no bug hunt):**
- **brockway** — 28/84 pages returned **HTTP 403 "blocking automated scanners"**
  (client-side WAF/bot-blocker). Live run is `partial`; broken-link findings
  incomplete but score/coverage/on-page complete. *Operational finding: this
  client's server IP must be allowlisted before the live scanner can fully
  replace SF there.*
- **boca/discovery** — `partial` from the external-link cap (300) + internal
  verification budget, NOT from a timeout (post-#105/#107). Coverage + score
  complete.
- **manhattan/cambria** — initially timed out (the `safeFetch` 999 hang, PR #107);
  after the fix both built `complete` with score 99/100. manhattan's earlier
  07-02 pair (coverage null, pre-Increment-1) is superseded by this fresh run.
- **Live-only issue types** (broken_internal_links, broken_images, missing_h1/
  meta, thin_content) vs **SF-only types** (~70: redirects, alt text, security
  headers, canonical, orphans, analytics joins) are documented capability
  differences, recorded, not chased.

**Gate status after this batch:**
- Phase 1 parity gate (N≥5 × deviations explained): **MET for cycle 1** (7 clients).
  Roadmap wants 2–3 cycles — cycles 2–3 accrue on the next scheduled/manual runs.
- Hybrid-discovery Increment-2 miss-rate gate: **DATA IN HAND** (7 points, clear
  signal). Decision to build the crawler is now evidence-backed, not blocked.

---

## ✅ 2026-07-06 — hybrid-discovery Increment 2 (THE CRAWLER) PROD-VERIFIED

**First hybrid live run on prod** (Kevin supplied an `er_auth` cookie). A fresh
`seoIntent` audit on **manhattanschool.edu** (client 12) — the highest-miss cycle-1
client — exercised the full crawler path end-to-end. SiteAudit `cmr9z8t81000q8wkilv2hap6w`;
live-scan CrawlRun `6ac72a7b-b369-4556-bd44-5e3039d2d80b`.

| Check (runbook) | Result |
|---|---|
| `SiteAudit.discoveryMode` | **`hybrid`** ✓ (was the key gate) |
| `discoveryCapped` | `false` |
| `seoIntent` | `true` |
| `discoverySourcesJson` | populated: `{v:1, sitemapCount:67, sitemapCapped:false, stoppedBy:'exhausted', fetches:109}`; **source breakdown `{sitemap:67, linked:42}`** — the expected sitemap+linked mix |
| audited page count vs sitemap-only | **109 discovered vs 67 sitemap-only** — the crawler added **42 link-reachable pages** the sitemap omitted (97 audited; 12 non-2xx/filtered) |
| live-scan run built + coexists | live-scan `score=91`, `status=complete`, `coverage=YES`, alongside the ada-audit run (`score=98`, `status=partial`) via the C6 compound unique ✓ |
| `discoveryCoverageJson.sitemapMissRate` | **0.385 (38.5%)** — intrinsic, cycle-comparable; ≈ cycle-1's 37.4% for manhattan (`42/109`) ✓ |
| `discoveryCoverageJson.residualMissRate` | **0.027 (2.7%)** — **materially lower**; the crawler closed a 38.5% gap to 2.7% (`3/112`) — THE success number ✓ |
| `stoppedBy` (which bound halted the crawl) | **`exhausted`** — ran to natural completion; the budget was ample, no bound hit |

**Residual = noise, not missed content.** The 3 remaining off-baseline targets are
two `?lead_src=cro_toolbar` tracking-param variants of `/apply-online` + `/book-a-tour`
(CRO-toolbar query params, not distinct content) and one `wp-content/*.html` upload
(an asset file). Real missed-content rate after the crawl is effectively **0%**.

**Verdict:** the crawler behaves exactly as designed in prod — hybrid discovery is
active only for seoIntent audits, per-URL provenance is recorded, the dual miss-rate
correctly reports the intrinsic gap (38.5%) *and* proves the crawl closed it (→2.7%).
**Increment 2 feature prod-verification: PASS.** (Note: the legacy top-level
`missRate`/`applicable` are intentionally `null`/`false` for a hybrid run — superseded
by the dual `sitemap*`/`residual*` fields; NOT a bug.)

This fresh run also = **manhattan parity cycle 2** (post-Increment-2, hybrid):
live-scan score **91** (was 98/99 on the sitemap-only runs — expected, since the
broader hybrid page set surfaces more on-page issues that pull the live score down;
still no crawl-depth/broken-link penalties, so it reads above SF's 82). Deviation
explained; not a bug.

---

## Operational plan to fill the two data streams

SF-side crawls now exist for 7 clients (§ candidates B). The remaining work is a
per-domain loop, all needing an authed prod session (prod is OAuth-only; no
automated cookie — Kevin via UI, or supplies an `er_auth` cookie for the runbook curls).

**Per client in {manhattan 12, bidwell 3, boca 4, brockway 5, brownson 6, cambria 29, discovery 26}:**
1. **Upload the fresh SF export** at `/seo-parser` → creates a `Session` + `sf-upload`
   CrawlRun for the domain (the SF half). (manhattan already uploaded — skip.)
2. **Trigger a `seoIntent` site audit** on the same domain → live-scan CrawlRun +
   `discoveryCoverageJson` (the live half + the miss-rate data point). Runbook:
   `POST /api/site-audit {domain, wcagLevel:'wcag21aa', clientId:<id>, seoIntent:true}`.
3. **Record both numbers** here as a dated data point: on prod,
   `npx tsx .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts <domain>`
   AND read the live run's `discoveryCoverageJson` (mode / offBaselineCount / missRate).

Start with **manhattan** (already has both halves — just needs a *fresh* post-Increment-1
seoIntent audit to get its first `discoveryCoverageJson`), then the 6 disk crawls.

**Gate to pass Phase 1:** ≥5 clients × 2–3 cycles, every deviation explained here.
**Gate for hybrid-discovery Increment 2:** measured sitemap miss-rate across real
seoIntent audits shows sitemaps routinely miss important pages (roadmap §5).

---

## ✅ 2026-07-06 — content similarity (C6 Phase 5) SHIPPED — parity validation now PENDING

The lexical near/exact-duplicate capability shipped (PR #111, main `146a14d`; deployed + prod-verified
to the autonomous extent — health 200, all 3 migration columns present, clean restart). The live scan
now computes `CrawlRun.contentSimilarityJson` (measurement-only; no Finding, no score change).

**New parity stream opened (not yet filled):** the SF-vs-live parity gate now has a THIRD dimension
beyond score-delta + miss-rate — **near-duplicate agreement**: compare the live `nearDuplicateGroups`
(and `exactDuplicateGroups`) against SF's **Near Duplicate** column (SF computes it at a ~90% threshold;
`docs/screaming-frog-setup.md:91,127`) on the 7 fresh client crawls.

**Blocked on a fresh authed seoIntent scan** (prod OAuth-only; only NEW audits harvest `contentText` →
compute similarity — runs built before the deploy carry `contentSimilarityJson = null`). Next authed
session: trigger a seoIntent audit on an indexable client site, read the live-scan run's
`contentSimilarityJson`, and record group-level agreement/variance vs SF here. Expected explainable
deviations: SF's content-area configuration, threshold differences, and our two-layer boilerplate control
(in-page element strip + document-frequency shingle filter). This is the gate that would later justify
promoting the signal to a Finding / `scoreLiveSeo` factor — NOT done in this increment.
