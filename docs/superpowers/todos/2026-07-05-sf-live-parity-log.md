# SF-vs-Live Parity Log (SF-retirement campaign, Phase 1)

**Started:** 2026-07-05 · **Owner:** improvement-roadmap sessions · **Skill:** `er-seo-tools-sf-retirement-campaign`

Purpose: accumulate the **documented, explainable** SF-vs-live variance that the
retirement gate (roadmap §4 / Phase 7) requires — **N ≥ 5 representative clients
× 2–3 reporting cycles, every deviation explained** — AND the sitemap **miss-rate**
data (`discoveryCoverageJson`, C6 Increment 1) that gates hybrid-discovery
**Increment 2** (the crawler). This is a measurement log, not a build.

Data source: prod DB (`$DATA_HOME/db.sqlite`). Parity numbers from
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

---

## ✅ 2026-07-07 — content-similarity parity (cycle 1) + parity cycle 2 (7 clients)

**Operator session** (Kevin supplied an `er_auth` cookie). Fresh `seoIntent` live scans on 7 clients
(manhattan 12, bidwell 3, boca 4, brockway 5, brownson 6, cambria 29, nuvani 15 — discovery 26 dropped
mid-session: 1287-page SF crawl too slow). All 7 built a `live-scan` `CrawlRun` with
`contentSimilarityJson` populated + `discoveryCoverageJson`. **This also closes the content-similarity
BEHAVIORAL prod-verify** (was pending since PR #111): `contentSimilarityJson` confirmed populating on
fresh seoIntent scans across 7 real client sites.

### A. Content-similarity near-dup parity (the NEW stream)

**Live content-similarity output (2026-07-07):**

| Client | pagesEligible | thin skipped | boilerplate shingles dropped | EXACT groups | NEAR groups |
|---|---|---|---|---|---|
| manhattan | 70 | 1 | 54 | 0 | 0 |
| bidwell | 43 | 11 | 10 | 0 | 0 |
| boca | 148 | 47 | 4 | **2** (sizes 4, 2) | 0 |
| brockway | 24 | 2 | 0 | 0 | 0 |
| brownson | 76 | 8 | 5 | 0 | 0 |
| cambria | 86 | 4 | 4 | 0 | 0 |
| nuvani | 121 | 1 | 26 | 0 | 0 |

**SF near-dup half — only nuvani is valid.** The 6 cycle-1 SF crawls carry **no near-duplicate data**:
the columns exist in `internal_all.csv` but are blank because SF's post-crawl **Crawl Analysis** step was
not run before export (exact-hash dupes populate at crawl time; near-dupes require the Analysis pass).
Kevin re-crawled **nuvani** with Crawl Analysis + JS rendering + content-area boilerplate exclusion
(`sf-crawls/070726-testcrawls/2026.07.07.08.30.42/`) → SF near-dup **is** populated there:
- **nuvani SF: 6 pages flagged near-dup @95%**, all WordPress pagination archives
  (`/news/page/{6,9,10}`, `/category/news/page/{5,8,9}`); 0 exact.

**nuvani deviation (SF 6 near-dup vs Live 0) — EXPLAINED, not a bug:**
- The 6 SF near-dupes are pagination archives. nuvani ran **sitemap-mode** (the hybrid crawler added
  0 linked pages); those pages are **not in nuvani's XML sitemap** and sit in the off-baseline/residual
  set (11.5%). Confirmed: `discoveryCoverageJson.sample` for the nuvani run lists `/news/page/2` (plus
  thank-you pages). Our page-only scan (122 CrawlPages, **zero** `/page/` or `/category/` URLs) never
  included them → nothing to flag.
- Pagination archives are **low-SEO-value** near-dupes (they should be canonicalized/noindexed, not
  chased as duplicate content). SF flags them because it link-crawls to them and hashes the listing area.
- Even if scanned, our two-layer boilerplate control (element strip + DF shingle filter — 26 shingles
  dropped on nuvani) is stricter than SF's default, so we would flag fewer.

**boca exact-dup (Live 2 groups vs SF 0 on the old boca crawl) — EXPLAINED:**
- Live exact groups: `{4 category archives: /category/{beauty-career,beauty-school,blog,esthetics}/}`
  + `{/blog/, /category/news/}`. After boilerplate stripping these thin taxonomy listings are
  byte-identical → identical sha256. A defensible "thin duplicate archive pages" signal.
- The on-disk boca SF crawl is the cycle-1 raw-HTML export (no Crawl Analysis, no JS render, full-page
  hashing incl. distinct category names) → 0 exact. **Not comparable**; a fresh 070726-style boca crawl
  is the real comparison.

**Content-similarity verdict:** our engine is **precise/conservative** — zero near-dup false positives
across 7 real client sites; it fires only on genuinely-identical thin archives (boca exact). The only SF
near-dup signal (nuvani pagination) is low-value and outside our scanned page set. **No unexplained
deviation → no bug hunt.** This is consistent with the measurement-only posture: promoting content
similarity to a Finding / `scoreLiveSeo` factor is NOT justified by this data (the signal is sparse and,
where SF has more, it's pagination noise). Fuller comparison needs the other clients re-crawled with
Crawl Analysis (and optionally SF's `Bulk Export → Content → Near Duplicates` for page-pair detail).

### B. Score + miss-rate parity — cycle 2

| Client | SF | Live | Δ | Jaccard | disc mode | sitemapMiss | residualMiss | live status |
|---|---|---|---|---|---|---|---|---|
| manhattan | 82 | 91 | +9 | 0.506 | hybrid | 38.5% | **2.7%** | complete |
| bidwell | 90 | 88 | **−2** | 0.667 | hybrid | 8.5% | **0.0%** | complete |
| boca | 81 | 90 | +9 | 0.758 | hybrid | 47.4% | **3.3%** | partial |
| brockway | 62 | 85 | +23 | 0.444 | hybrid | **87.0%** | 29.8% | partial |
| brownson | 81 | 90 | +9 | 0.395 | hybrid | 18.3% | 18.1% | complete |
| cambria | 83 | 100 | +17 | 0.784 | sitemap | 21.1% | 21.1% | complete |
| nuvani | 81\* | 100 | +19 | 0.787 | sitemap | 11.5% | 11.5% | complete |

\*nuvani SF is the old **2026-06-11** upload (the fresh 070726 crawl is on disk, not yet uploaded to
prod) — its Δ is indicative only.

**Score-delta verdict:** Live > SF on 6/7 (Δ +9..+23); **bidwell −2** (the near-parity case). Same,
documented reason as cycle 1 — the live score omits SF's crawl-depth, broken-link, security-header,
redirect, orphan, and analytics penalties, so it reads higher; different denominator, do not tune to
zero. All explained.

**Discovery / miss-rate — NEW in cycle 2 (hybrid crawler, Increment 2, now live):**
- **Where the crawler expanded well it closed the gap dramatically:** manhattan 38.5%→**2.7%**,
  boca 47.4%→**3.3%**, bidwell 8.5%→**0.0%** (source mix e.g. manhattan `{sitemap:67, linked:42}`,
  boca `{sitemap:174, linked:147}`). This is the Increment-2 success signal, now reproduced across
  multiple clients.
- **Crawler expansion is INCONSISTENT** (worth a follow-up, not a regression): brownson ran hybrid but
  added only +1 linked (residual 18.1%); nuvani/cambria fell back to **sitemap-mode** (0 expansion →
  residual = sitemapMiss, 11.5% / 21.1%). For these the residual is largely pagination + thank-you
  pages (low value — nuvani sample confirms `/news/page/2` + thank-you URLs). Candidate for a
  crawler-depth/frontier tuning increment; measured here, not chased.
- **brockway — EXCLUDE from parity conclusions (data unreliable).** sitemapMiss swung **7.7%
  (2026-07-06) → 87% (2026-07-07, only 6 sitemap URLs seen)** between cycles. Kevin confirmed
  (2026-07-07) the site 403s **randomly** — it is NOT a fixable server-IP allowlist issue and NOT
  crawl-related; the random blocking makes brockway's live numbers non-reproducible. **Decision: skip
  brockway for the live scanner / parity going forward.**

**Gate status after cycle 2:**
- Phase-1 parity gate (N≥5 × deviations explained): **cycle 2 MET** (7 clients, every deviation
  explained). manhattan is now on cycle 3 (07-06 hybrid + this run). Roadmap wants 2–3 cycles — on track.
- Content-similarity parity: **cycle 1 recorded** (live baseline for 7 + true SF comparison for nuvani).
  Broader SF comparison pending the other 6 re-crawled with Crawl Analysis.
- **Follow-ups surfaced (none blocking):** (1) hybrid-crawler expansion inconsistency (brownson/nuvani/
  cambria under-expand) — possible frontier/depth tuning; (2) upload the fresh 070726-style SF crawls to
  prod for clean score/near-dup pairs on the remaining clients (re-crawled WITH Crawl Analysis). **brockway
  DROPPED — random 403s (not allowlistable, not crawl-related); excluded from parity going forward.**

---

## ✅ 2026-07-07 (later) — content-similarity near-dup parity EXPANDED to 5 clients

Kevin re-crawled 5 clients WITH Crawl Analysis + JS render + content-area boilerplate exclusion
(`sf-crawls/070726-testcrawls/`: nuvani, manhattan, bidwell, boca, cambria — brownson not re-crawled,
brockway dropped). This upgrades the content-similarity parity from **1 client (nuvani) to 5**, compared
against the same-day live scans (§2026-07-07 above). Cross-check script confirmed, per SF-flagged page,
whether it is in our live page set and in our exact/near dup groups.

| Client | SF near-dup pages | Live near / exact | Verdict |
|---|---|---|---|
| **cambria** | 0 | 0 / 0 | **Full agreement** (both clean) |
| **boca** | 30 (25 pagination + **5 category-index**) | 0 / **2 groups** | **Agreement on scanned pages** — all 5 SF-flagged category-index pages are IN our exact-dup groups; 25 pagination pages absent from our set (sitemap-mode) |
| **nuvani** | 6 (all pagination) | 0 / 0 | Pagination absent from our page set (sitemap-mode) |
| **manhattan** | 2 (`/contact-us/`, `/apply-online/` @96%) | 0 / 0 | Both scanned + eligible (422 / 453 words) — we correctly **do NOT** flag (precision by design) |
| **bidwell** | 2 (`/blog/`, `/blog/category/blog/` @100%) | 0 / 0 | Both scanned + eligible (238 / 239 words) — real listing dup we **under-detect** |

**Two divergence classes, both explained, both reflecting our precision-first design:**

1. **Archive / pagination / listing pages (nuvani 6, boca 25, bidwell 2).** WordPress pagination
   (`/category/*/page/N`) and blog-index-vs-category listings. Cause is twofold: (a) **not in our page
   set** — sitemap-mode audits don't scan pagination (nuvani/boca pagination confirmed absent); (b) even
   when scanned (bidwell `/blog/` + `/blog/category/blog/`, 238/239 words, both in-set & eligible), our
   **DF-boilerplate shingle filter treats recurring listing text as boilerplate and drops it**, and the
   two listing pages aren't byte-identical (238≠239) → neither exact nor ≥0.9 near. This is a **known
   archive/listing blind spot** — but these are canonical-handled, lower-priority dupes (our separate
   redirect/canonical validation covers the SEO concern).

2. **Shared-template content pages (manhattan `/contact-us/` + `/apply-online/` @96%).** Both fully
   scanned, indexable, 422/453 words — NOT thin. SF flags them near-dup because its content area still
   includes the shared conversion template (address, phone, program list, CTAs, testimonial blocks). Our
   **DF-boilerplate filter drops shingles recurring across ≥3 pages** (exactly that shared template),
   leaving each page's distinct content → below 0.9. **This is our design intent** — contact-us and
   apply-online are distinct-intent pages; flagging them as duplicate content would be a false positive.
   Here our conservative result is arguably **more correct** than SF's.

3. **Genuine duplicate primary content (boca category-index pages).** SF flags the 5 category landing
   pages (e.g. beauty-school / beauty-career, 703 words each) as near-dup 91–100%; **our engine
   independently grouped 4 of them + a blog/news pair as EXACT dupes.** Same conclusion, different label
   (we say byte-identical-after-strip, SF says ~100% near). **Strong agreement where it matters.**

**Verdict (content-similarity parity, 5 clients):** our engine is **high-precision on primary content**
(agrees with SF on real dupes — boca; correctly rejects shared-template false positives — manhattan) and
**archive/pagination-blind** (nuvani, boca pagination, bidwell listings — partly sitemap-mode coverage,
partly DF-boilerplate filtering). Every deviation is explained; **no bug.** This **reinforces the
measurement-only posture**: promoting the signal to a Finding / `scoreLiveSeo` factor would neither
false-positive on content pages NOR fully replace SF's archive-dup detection — so it is not justified by
this data. If archive-dup coverage is later wanted, the lever is discovery (hybrid must reach pagination)
+ a listing-aware relaxation of the DF filter — a deliberate future increment, not a bug fix.

**Remaining for a fuller comparison:** re-crawl brownson with Crawl Analysis (the 6th); optionally SF
`Bulk Export → Content → Near Duplicates` for page-pair (group-vs-group) detail.

---

## ✅ 2026-07-20 — cycles 3 & 4 (AUTONOMOUS, read-only): the weekly sweep now GENERATES parity data

**No operator cookie needed.** The weekly-client-sweep infrastructure (deployed 2026-07-16;
first scheduled sweep Mon 2026-07-20 01:00 UTC) runs a FULL `wcag21aa`+seoIntent audit of every
registered client domain automatically. Two full-cohort sweeps have now completed —
**2026-07-16** (cycle 3) and **2026-07-20** (cycle 4) — each covering **~29 client domains** (up
from the hand-run 7 of cycles 1–2). Every fresh run carries `discoveryCoverageJson` +
`contentSimilarityJson` + `contentSignalsJson`. This session read the numbers off prod (read-only
Prisma probe; `parity-probe.ts` / `parity-analysis.ts`, scp'd + removed) — no scans triggered.

**Headline: the parity dataset is now self-generating.** The Phase-1 gate (N≥5 clients × 2–3
cycles) is over-satisfied on the cohort AND cycle-count dimensions — 29 clients × cycles 3–4, on
top of the 7 × cycles 1–2. The remaining Phase-7 work is judgment (Kevin's retirement bar), not
more data collection.

### A. Cohort inventory (prod, 2026-07-20 19:28 UTC)

| Metric | Value |
|---|---|
| `seo-parser` CrawlRuns total | 247 |
| `live-scan` runs | 232 |
| `sf-upload` runs | 15 |
| seoIntent live-scan runs (all) | 63 fresh since 2026-07-08 + earlier |
| **Parity pairs (domain has sf-upload + seoIntent live-scan)** | **11** (was 1 at cycle-0) |
| `topicOverlapJson` present on ANY run | **0** — confirms C12 topic-overlap is still env-gated OFF (`VERIFIER_TOPIC_OVERLAP_ENABLED` default OFF, the ONNX-memory gate) |

Parity pairs (SF half mostly 2026-07-06, live half 2026-07-20): healthcarecareercollege.edu,
bocabeautyacademy.edu, discoverycommunitycollege.com, cambriacollege.ca, brownson.edu,
bidwelltraining.edu, brockwaycatart.org, manhattanschool.edu, glowcollegecanada.ca, nuvani.edu,
proway.erstaging.site (canary, `score:null` by noindex design — plumbing only).

### B. ⚠→✅ The systematic live-score drop cycles 2→3 is the C19 recalibration (NOT a regression)

Comparing cycle-2 (07-07, PRE-C19) live scores against the 07-16/07-20 sweeps (POST-C19) shows a
uniform downward shift with **identical page/finding inputs** — the exact "bug-hunt, not a
footnote" trigger. Root-caused to **C19 PR2+PR3 (PRs #143/#144, deployed 2026-07-10)**, which
recalibrated the SEO scorer AFTER cycle 2 was recorded:

| Client | cyc2 (07-07) | cyc3/4 (07-16/20) | pages | indexable | on-page findings | verdict |
|---|---|---|---|---|---|---|
| **bidwell** | **88** | **71** | 54 → 54 | 54 → 54 | **byte-identical** (missing_h1=2, missing_meta=10, thin=17, dup_meta=1) | smoking gun — same inputs, −17 |
| manhattan | 91 | 77 | 97 → 97 | 71 → 71 | identical (thin 7→6) | −14 |
| brownson | 90 | 74 | 84 → 84 | 84 → 84 | identical | −16 |
| cambria | 100 | 97 | 90 → 91 | 90 → 91 | identical (dup_meta=1) | −3 |
| nuvani | 100 | 100 | 122 → 122 | 122 → 122 | identical | 0 (no broken links → no penalty) |
| boca | 90 | 87 | 314 → 316 | 195 → 197 | ≈identical | −3 |

**What C19 changed** (from the tracker's C19 status log): (1) steepened all SEO curve knees
(`SEO_KNEES`: missing-elements knee 2%→30%, error-rate 1%→20%, thin 5%→25%) so the same missing/
thin ratios now earn fewer points; (2) added a **live broken-links factor** (`ScoringWeights.brokenLinks`
weight 10) to the `scoreLiveSeo` denominator, active whenever the verify pass is complete. Sites
with broken links (bidwell/manhattan/brownson) lose points on a factor that **did not exist** at
cycle 2; the byte-identical nuvani (100→100) has no broken links, so it's unmoved — a clean control.

**This is a cross-formula-version comparability break, exactly what C19's
`comparabilityBreak:'version'` trend flag was built to signal — NOT a bug.** The C19 PR2 SF-replay
evidence recorded fleet Δ 0..−11 (median ≈ −7); live runs drop a few points more because the
broken-links factor also fires on them (SF replay honestly skipped live runs). **Cycles 1–2 scores
are pre-C19 and must NOT be compared point-to-point against cycles 3–4.** The post-C19 baseline
starts at cycle 3.

### C. ✅ Cross-sweep reproducibility (07-16 vs 07-20): 26/29 identical over 4 days

Both full sweeps ran the SAME 29-domain cohort 4 days apart under the SAME (post-C19) formula.
Per-domain live scores:

- **26 of 29 byte-identical** (tint 90, prowayhair 62, glow 91, ccbst 95, canadian 92, discovery 89,
  valley 98, urbanriver 70, soma 91, cw 90, sutter 74, sdgku 86, prism 89, nuvani 100, nyinstitute 78,
  manhattan 77, innovate 66, hilbert 94, healthcare 76, federico 75, brownson 74, brockway 68, boca 87,
  bidwell 71, beonair 94, beal 75; proway null/null).
- **Only 2 moved:** cambria 100→97 (−3), sws 88→87 (−1) — small, site-drift-plausible.

**This is the strongest retirement-gate signal to date:** the live scanner produces stable,
reproducible scores across independent weekly runs. Phase-7 wants "N consecutive weekly seoIntent
runs with a non-null score and stable timing" — cycles 3–4 are the first two consecutive AUTOMATED
weekly runs, and they agree.

### D. Miss-rate distribution across 29 clients (cycle 4, 2026-07-20)

The hybrid crawler (Increment 2) is live for all seoIntent audits. `sitemapMiss` = intrinsic gap
(what the XML sitemap omits vs internal-link-reachable content); `residualMiss` = what remains
UNfound after the crawler expanded the frontier — the success number.

- **sitemapMiss** (29 clients): range 7.5%–92.2%, **median ≈ 19.4%, mean ≈ 24% (≈21.7% excluding the
  healthcare outlier)** — consistent with cycles 1–2 (median ~21%). Sitemaps routinely omit reachable
  content; the Increment-2 build decision remains well-founded.
- **residualMiss**: **17 of 29 clients (59%) closed to <5%** (e.g. manhattan 38.5%→2.7%, boca
  47.4%→3.0%, bidwell 8.5%→0%, sutter 41.9%→0%). Where the crawler expanded, it closed the gap hard.
- **Sitemap-mode fallback (no expansion, residual = sitemapMiss):** glow (12.9%), cambria (19.5%),
  nuvani (11.5%) — 3 clients the hybrid crawler declined to expand. **Under-expansion (hybrid but
  residual stays high):** discovery (41%→41%, a 1287-page site that overruns the frontier), brownson
  (18.3%→18.1%), federico (14.6%→14.5%). This reproduces the cycle-2 "hybrid-crawler expansion
  inconsistency" follow-up — a candidate frontier/depth-tuning increment, measured here, not a bug.
- **healthcarecareercollege.edu sitemapMiss 92.2%** is the sweep-error-triage 404-bearing client
  (PR #227) — expected outlier, not a crawl failure; excluded from the distribution stats above.

### E. SF-vs-newest-live parity (core 6 pairs, cycle 4)

| Client | SF | Live (07-20) | scoreΔ | Jaccard | note |
|---|---|---|---|---|---|
| manhattan | 82 | 77 | −5 | 0.506 | post-C19 live now BELOW SF (broken-links + steeper knees) — inverts the pre-C19 sign |
| bidwell | 90 | 71 | −19 | 0.667 | largest gap; bidwell has broken links + high thin ratio, both now penalized harder |
| brownson | 81 | 74 | −7 | 0.395 | — |
| cambria | 83 | 97 | +14 | 0.777 | still live>SF (clean site, few broken links) |
| nuvani | 81 | 100 | +19 | 0.787 | clean control — live>SF unchanged |
| boca | 81 | 87 | +6 | 0.759 | — |

**Score-delta verdict:** under the post-C19 formula the live↔SF relationship is now **client-dependent**
(sign flips both ways) rather than uniformly live>SF as in cycles 1–2. Explained: C19 deliberately
tightened live scoring toward SF-comparable strictness AND added the broken-links factor SF has always
had. Clean sites (cambria/nuvani/boca) still read above SF (live omits SF's crawl-depth/security-header/
orphan/analytics penalties); link-heavy sites (bidwell/manhattan) now read at or below SF. **Different
denominators, do not tune to zero** — the campaign posture is unchanged. Jaccard is SF-asset-inflated as
before (the clean discovery instrument is `discoveryCoverageJson`, not raw page-set Jaccard).

### Gate status after cycles 3–4

- **Phase-1 parity gate (N≥5 × 2–3 cycles, every deviation explained):** **MET and then some** — 29
  clients across cycles 3–4 (plus 7 across cycles 1–2), every deviation explained (the cycle-2→3
  score shift = C19 recalibration; miss-rate under-expansion = known follow-up; healthcare 92% = the
  404 client). No unexplained deviation → no open bug hunt.
- **Cross-run stability (Phase-7 input):** 2 consecutive automated weekly runs agree 26/29 — the
  first hard reproducibility evidence.
- **Follow-ups surfaced (none blocking):** (1) hybrid-crawler under-expansion on ~6 clients
  (discovery/brownson/federico/glow/cambria/nuvani) — frontier/depth tuning candidate; (2) the SF
  halves for most pairs are 2026-07-06 uploads — a fresh SF re-crawl round would give a clean
  same-week post-C19 score pair, but the score comparison is now dominated by the known formula
  difference, so this is low-priority; (3) topic-overlap remains OFF pending the ONNX child-process
  embed-worker follow-up (C12 gate, unchanged).
- **Retirement-gate readiness:** the DATA side of Phase 7 (coverage, reproducibility, explained
  variance) is essentially in hand for the fleet. What remains is Kevin's judgment call on the bar
  (proposed N=8 consecutive weekly runs) + the analytics-independence and dashboards-default-to-live
  criteria — process/decision items, not measurement gaps.

---

## 🎯 2026-07-20 — SF RETIREMENT BAR **SET** (Kevin's judgment call — Phase 7 knobs locked)

The DATA side of Phase 7 is over-satisfied (above). This section locks the four owner-policy knobs
the roadmap explicitly reserves to Kevin ("Kevin sets the final bar"). **These numbers are now the
falsifiable retirement gate** — they supersede the "proposed N=8" placeholder in the campaign skill's
Phase 7 and annotate the roadmap §4 gate.

### The bar (all must hold to demote SF-as-CRAWLER, fleet-wide)

| # | Knob | **Locked value** | Rationale |
|---|---|---|---|
| 1 | **N — consecutive stable weekly sweeps** | **N = 8** | Roadmap default. Each = a full-fleet `wcag21aa`+seoIntent weekly sweep that, for the client, is **QUALIFYING**: non-null score + **NO recovery-path rescue** (no `stale-audit-reset` / `recoverBrokenLinkVerifies` intervention on that audit) + **"stable timing/score"** (see objective def below) + meets #2. A client's streak counts **only qualifying sweeps**; a non-qualifying sweep resets it to 0. Fleet streak = 2 as of cycle 4 (2026-07-20) **for the clients that already meet #2** — 0 for the under-expanders (they fail #2, so no qualifying sweep yet). |
| 2 | **Discovery-coverage threshold** | **`residualMiss` ≤ 5%, strict** (per run, per in-scope client) | The 95% end of the roadmap's "90–95% of known pages" range. **No coverage-level capped/blocked escape** — an in-scope client must genuinely reach ≤5% residual on the run. Because #1 counts only sweeps that also meet #2, an under-expander's N=8 clock **starts after** the crawler fix lands (see consequence below). *(Sub-decision Kevin can relax later: whether ≤5% must hold on ALL 8 qualifying sweeps, as written here, or only on the exit sweep. Default = all 8.)* |
| 3 | **Scope** | **Fleet-wide** | SF stays routine for the ENTIRE fleet until EVERY in-scope client clears #1 and #2. Not per-client-rolling. |
| 4 | **Analytics coupling** | **Split gate** | This bar governs SF-as-**crawler** only. SF-as-**keyword-joiner** (SEMrush/DataForSEO) retirement is a SEPARATE gate, deferred until DataForSEO gets prod creds (KS-2 layer built but dark). Roadmap §4 bullet 6 (analytics independent) is REMOVED from the crawler gate and tracked separately. |

**Objective "stable timing/score" (criterion #1), so the streak is mechanically reproducible:** a
qualifying sweep's live score is within **±3** of the client's previous qualifying sweep, OR any larger
move is explained by a recorded site change or a labeled formula-version break (`comparabilityBreak`);
AND the sweep's `broken-link-verify` job completed within its normal window (no 15-min verify-timeout
`partial`-by-timeout, no recovery rescue). "Stable" is NOT eyeballed.

### In-scope cohort vs. standing carve-outs (so the fleet-wide bar is satisfiable)

The retirement cohort = **indexable client production domains**. A domain is carved out (keeps SF
regardless, per the roadmap's standing *"Keep SF deliberately for … any client whose live run is
low-confidence / blocked / capped"* clause) **only by an OBJECTIVE, recorded predicate** — never by
hand-wave. This is NOT a coverage escape hatch (#2 stays strict for in-scope clients); a carved-out
domain is simply not in the retirement cohort. **Carve-out predicate (auditable):**

- `scoreLiveSeo === null` on the run (noindex / login-walled / `indexableScored===0` / <50% observed
  coverage — the builder's own unscoreable conditions), OR
- `SiteAudit.discoveryCapped === true` (the 1000-page cap bit), OR
- a **manually flagged** blocked domain with the blocking evidence recorded in the cohort ledger
  (below) — e.g. a WAF/CDN block on the VPS crawler, an auth wall, a mid-window migration.

**Frozen in-scope cohort ledger (OPEN action — a prerequisite to first evaluating the gate):** freeze,
in this log, the enumerated list of all ~29 sweep-cohort domains with, per domain: latest `residualMiss`,
`scoreLiveSeo` (null?), `discoveryCapped`, and **in-scope vs carved-out + the objective reason**. Entry/
re-entry rule: a domain that leaves carve-out (e.g. block clears) enters as a fresh in-scope client with
streak 0. Without this ledger the fleet-wide gate cannot be mechanically evaluated. (Build it from a
read-only prod probe — the cohort membership is not yet frozen as of this bar-set.)

**Carve-out examples — evidence required, NOT pre-granted:**
- **The canary** `proway.erstaging.site` — noindex by design → `scoreLiveSeo === null` always → meets the
  predicate. A plumbing probe, not a client. Carved out.
- **`healthcarecareercollege.edu` is NOT auto-excluded.** It produced a **non-null** live score (76,
  byte-identical across cycles 3–4), so it does NOT meet the predicate. Its 92.2% *sitemapMiss* is
  intrinsic, not a crawl failure — but its `residualMiss` has not been recorded here. Treat it as
  **in-scope**: if its `residualMiss` > 5% it is simply another failing client that blocks the fleet-wide
  gate (like the under-expanders), UNLESS the PR #227 triage resolves to a recorded manual block. Do not
  drop it from the cohort on the sitemapMiss number alone.

### ⚠ Consequence of Kevin's fleet-wide + ≤5%-strict choice (flagged deliberately)

Under fleet-wide scope, the **~6 INDEXABLE under-expanding clients** from cycle 4 currently **FAIL #2**
and therefore **BLOCK the whole-fleet gate**:

| Client | cycle-4 residualMiss | why it fails ≤5% |
|---|---|---|
| discovery | 41% | 1287-page site — hybrid frontier overruns/under-covers |
| cambria | 19.5% | sitemap-mode fallback — crawler declined to expand |
| brownson | 18.1% | hybrid but under-expands |
| federico | 14.5% | hybrid but under-expands |
| glow | 12.9% | sitemap-mode fallback — crawler declined to expand |
| nuvani | 11.5% | sitemap-mode fallback — crawler declined to expand |

**Therefore the hybrid-crawler frontier/depth under-expansion follow-up — previously logged as a
"candidate increment" — is now promoted to a HARD RETIREMENT PREREQUISITE.** It must land and drive
these 6 to ≤5% residual before the fleet-wide bar can clear. (Frontier-overrun on `discovery` and
no-expansion on `glow`/`cambria`/`nuvani` are distinct failure modes the increment must both address.)

### Gate criteria status against the locked bar

**MET (do not re-litigate):**
- ✅ Broken-link verification **shipped** (C6). *(NOTE: this is the "shipped" half of the roadmap gate
  only — the SF false-positive-rate half is OPEN below.)*
- ✅ Documented, explainable **SF-vs-live variance** — on the **11 SF-paired domains** (6 detailed in
  cycle 4), every deviation explained, no open bug hunt. *(Distinct from the 29-client figure, which is
  live-vs-live reproducibility — see next.)*
- ✅ **Live-vs-live reproducibility** — 29 clients, cycles 3→4, 26/29 byte-identical. Strong Phase-7
  stability evidence (this is NOT the SF-parity cohort; the two datasets are separate).
- ✅ Miss-rate verdict / Phase 2 discovery — hybrid crawler (Increment 2) shipped + prod-verified.

**OPEN (what actually gates retirement now — larger than the first draft implied):**
1. **(Passive, per-client) N = 8 qualifying-sweep streak.** Clients already at ≤5% are at 2/8. The
   under-expanders are at 0/8 (they fail #2 until fixed). Record each sweep's per-client qualifying status
   (score / recovery-rescue / stability / coverage) here.
2. **(ACTIVE / BLOCKING) hybrid-crawler under-expansion fix** → drive the 6 indexable under-expanders
   (+ possibly healthcare) to ≤5%. **This is the next buildable code item the bar gates on** (Phase 2
   frontier/depth tuning — full change-control cycle). Fleet-wide + per-run ≤5% makes this the long pole.
3. **(BLOCKING, code) anchor-text capture** — the roadmap's 2026-07-06 note requires anchor-text capture
   *before* the Phase-7 gate. Today `HarvestedLink` stores only source/target/kind and the live pipeline
   emits none of the three anchor findings. Either build it (change-control cycle) or Kevin explicitly
   supersedes that prerequisite (recorded). Until then: OPEN.
4. **(BLOCKING, code) graph-signal labeling + consumer acceptance.** NOT met — `brief.service.ts` output
   still says "Orphaned pages" and plain "inlinks" without the required "ER audited-set authority"
   qualification. Needs the labeling change AND consumer (brief/pillar) sign-off. Hard OPEN, not soft.
5. **(BLOCKING, evidence) broken-link false-positive rate.** The roadmap gate wants the verifier's FP rate
   "low enough that analysts act on findings unreviewed." Not yet measured — the parity log explicitly notes
   SF/live broken-link counts aren't directly comparable and records no target-level FP audit. OPEN.
6. **(Decision + CODE, at-retirement) §4 #7 "dashboards/roadmap/Teamwork default to live".** Selector-backed
   surfaces flip via `pickCanonicalSeo` (fresh SF ≤30 d wins today; stop routine SF uploads → live becomes
   canonical by absence). BUT the `srt_` SEO roadmap + `qct_` Teamwork push are still `Session`-bound (read
   `Session.result`) — **live-source roadmap/Teamwork generation does not exist yet**. So closing #7 is
   partly implementation work, not merely a config flip.

**Realistic clear date — NOT ~2026-08-31.** The passive N=8 streak for the already-clean clients would
finish ≈ run #8 (2026-08-31), but the gate is fleet-wide and multiple BLOCKING code items remain
(under-expansion fix, anchor-text, graph labeling — each a change-control cycle). Because an under-expander's
qualifying streak only starts *after* its coverage reaches ≤5%, the fleet clears roughly at **(latest
blocking-fix ship date) + 8 clean weekly sweeps**, not +1. The long pole is the code, not the calendar.

**Rollback triggers (automatic — SF returns to routine, no debate):** repeated low-confidence/null-score
runs, **`residualMiss` regressing above 5% (discovery coverage below 95%)**, verifier false-positive spike,
or a client site migration/redesign.

**Keep SF forever for:** discovery sweeps, migrations, staging/pre-launch QA, competitor & ad-hoc/list
crawls, custom XPath extraction, and any blocked/capped/low-confidence client — this is the *deliberate
fallback*, not a gate failure.

---

## 🔧 2026-07-20 — Hybrid-discovery under-expansion fix (L1 shipped; L2/L3 planned)

**Trigger:** the retirement bar (≤5% residualMiss STRICT, fleet-wide) now GATES on discovery
coverage. A fresh 29-domain prod probe showed ~11 domains still exceed 5% residual.

**Diagnosis (empirical, prod probe 2026-07-20 — see spec `2026-07-20-hybrid-discovery-under-expansion-design.md`):**
1. **Raw-HTTP crawler is JS-blind** — cambria/glow/nuvani/brownson/federico nav is client-rendered;
   raw HTML has 0 same-host `<a href>` (verified: 60–120KB HTML, 0 links). BFS tuning cannot help
   these; the missed pages (cambria `/education`, glow `/course/*`, nuvani `/locations/*`) are
   rendered-DOM-only. → **L2** (rendered-DOM adaptive discovery).
2. **Bound hits** — discovery (maxFetches@400, 623+ pages), soma (maxFetches@400), healthcarecareer
   (maxAdded@300), beal (timeBudget). → **L3** (bound adaptivity; Beal is time-bound, needs the
   deadline reuse, not cap raises).
3. **Metric noise** — much of "residual" is tracking-param dupes, `%C2%A0`, pagination, taxonomy,
   thank-you, account URLs. → **L1** (this ship).

### 29-domain raw-residual ledger (2026-07-20, `discoveryCoverageJson.residualMissRate`, pre-L1)

Worst-first, active clients' latest seoIntent live-scan. (`added` = pages the crawler expanded beyond
the sitemap; `stoppedBy` from `discoverySourcesJson`.)

| domain | resMiss | added | stoppedBy | class |
|---|---|---|---|---|
| discoverycommunitycollege.com | 40.8% | 3 | maxFetches | JS-blind + bound |
| cambriacollege.ca | 19.5% | 0 | exhausted | JS-blind |
| brownson.edu | 18.1% | 1 | exhausted | JS-blind |
| healthcarecareercollege.edu | 14.9% | 300 | maxAdded | bound |
| federico.edu | 14.5% | 1 | exhausted | JS-blind |
| glowcollegecanada.ca | 12.9% | 0 | exhausted | JS-blind |
| nuvani.edu | 11.5% | 0 | exhausted | JS-blind |
| soma.edu | 9.7% | 160 | maxFetches | bound + pagination noise |
| ccbst.ca | 7.6% | 1 | exhausted | JS-blind |
| canadiancollege-hst.com | 7.5% | 10 | exhausted | mixed |
| beal.edu | 6.9% | 18 | timeBudget | bound (time) |
| prowayhairschool.com | 6.5% | 4 | exhausted | mixed |
| (17 more ≤5%) | ≤5% | — | — | already passing |

### L1 — policy-filtered coverage metric (SHIPPED this session)

`residualMissRate` is now **policy-filtered** (the gate); `residualMissRateRaw` retains the pre-L1
number above. Two-sided attribution (`excludedByReason` numerator + `baselineExcludedByReason`
denominator + `nonContentExcludedCount`/`baselineExcludedCount`) fully reconciles the raw→filtered delta.

**Policy filter (fuller, Kevin 2026-07-20):**
- **Tracking params stripped** (beyond utm_*): `lead_src, gclid, gad, gbraid, wbraid, fbclid, msclkid,
  yclid, mc_cid, mc_eid, _ga`. Functional params (`position, page, s, p, id, paged`) NEVER stripped.
- **Malformed:** trailing `%C2%A0` / `%20` / whitespace trimmed off the pathname (collapses onto the real page).
- **Non-content patterns excluded** from both numerator and denominator: pagination `/page/N`,
  WP taxonomy first-segment `category|tag|author`, `/thank-you*` confirmations, `/my-account/*`.

**Honesty caveats (Codex-reviewed):**
- "**policy-filtered**", never "identifies indexable content" — taxonomy/pagination CAN be indexable
  landing pages; this is a policy choice, surfaced per-reason with the raw number retained.
- **Fuller ≠ exhaustive.** Known false-negatives intentionally NOT caught (documented, not silently
  "content"): `/blog/category/news` (taxonomy not at segment 0), `?paged=2` (query-form pagination),
  `/thankyou` (no hyphen), `/thank_you_application`, `/thank-you/application` (not last segment).
- `residualMissRateRaw ≥ residualMissRate` is **NOT** an invariant — filtering both sides can make the
  filtered rate *rise* when the denominator loses more than the numerator (e.g. a taxonomy-heavy sitemap).

**Re-baseline:** authoritative filtered per-domain numbers land from the **next weekly sweep** after L1
deploys (coverage is recomputed there). Do NOT record sample-derived pre-deploy filtered residuals as
recomputed values — the stored `sample` is capped at 50 off-baseline URLs and cannot reconstruct baseline
exclusions; any pre-deploy figure is a **directional estimate only**.

**Still open:** L2 (rendered-DOM discovery — the JS-blind fix, own plan) + L3 (bound adaptivity, own plan).
