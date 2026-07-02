---
name: er-seo-tools-domain-reference
description: "Use when a session needs the SEO/accessibility domain semantics encoded in er-seo-tools: how the health score, live SEO score, or pillar fit score is computed, why a score changed, what an issue type means, which Screaming Frog CSVs the parser expects and what a missing one does, WCAG/axe scoring and tag expansion, VPAT semantics, broken-link / on-page live-scan rules, canonical-run selection, GA4/GSC report metrics, or the pat_/srt_/krt_/qct_ handoff tokens."
---

# er-seo-tools domain reference

## Overview

This is the domain-theory pack for er-seo-tools **as encoded in this repo** — not a
textbook. Every formula, threshold, and issue type below was read from the code on
2026-07-02 on branch `feat/autonomous-live-seo-source`. Where the branch diverges
from `main`, it is labeled. When code and this document disagree, the code wins —
re-verify with the one-liners in "Provenance and maintenance".

## When to use

- Explaining or debugging a health score, live SEO score, or ADA score number.
- Deciding what an issue type means, its severity, or whether its URL list is complete.
- Working out which Screaming Frog exports a session needs, or why a parse was rejected.
- Anything WCAG/axe: tag expansion, compliance verdicts, VPAT wording.
- Interpreting live-scan findings (broken links, on-page SEO, link-graph depth).
- Understanding GA4/GSC report metrics or the pat_/srt_/krt_/qct_ token taxonomy.

## When NOT to use

- **How the pipelines/jobs/recovery work** (queue mechanics, dual-write, retention) →
  `er-seo-tools-architecture-contract`.
- **Adding a parser, issue type, job type, or route** → `er-seo-tools-extension-recipes`.
- **Env vars and tunables** (concurrency, caps as config) → `er-seo-tools-config-and-flags`.
- **A score is wrong and you need to find out why** (triage steps, log greps) →
  `er-seo-tools-debugging-playbook`; this skill tells you what the number *should* be.
- **Retiring Screaming Frog** → `er-seo-tools-sf-retirement-campaign`.

## Glossary of project jargon

| Term | Meaning |
|---|---|
| **sf-upload** | A `CrawlRun` built from Screaming Frog CSV uploads via the seo-parser (`source: 'sf-upload'`, `tool: 'seo-parser'`). |
| **live-scan** | A `CrawlRun` built by the `broken-link-verify` job from data harvested during an ADA site audit (`source: 'live-scan'`, `tool: 'seo-parser'`). No SF involved. |
| **seoIntent** | Boolean on `SiteAudit` and `CrawlRun` (`prisma/schema.prisma`; **branch-only as of 2026-07-02** — migration `20260630120000_live_seo_source`): the audit was run *for SEO purposes* (set via POST `/api/site-audit` body or a schedule payload). Only seoIntent live-scans can become the canonical SEO run. |
| **canonical run** | The one `CrawlRun` whose score/findings represent a client domain's current SEO state. Selection is merge-state-sensitive — see "Canonical run selection" below and er-seo-tools-architecture-contract §6. |
| **findings run** | Any normalized `CrawlRun` → `CrawlPage`/`Finding`/`Violation` subtree (the A2 relational layer), as opposed to the legacy JSON blobs. |
| **dedupKey** | sha256 identity key on `Finding` (`lib/findings/keys.ts`): run-scope = hash(type), page-scope = hash(type, normalized URL). Diffing (`diffInstances`) is keyed on it. |
| **indexable (SF)** | Screaming Frog's `Indexability == 'indexable'` verdict on a crawled URL. Drives nearly every SF-side base set. |
| **indexable (live)** | Derived: status 2xx ∧ HTML ∧ ¬robots-noindex ∧ ¬x-robots-noindex (`lib/findings/onpage-seo-mapper.ts`). |
| **loginLike** | Live-scan heuristic (`lib/ada-audit/seo/parse-seo-dom.ts`): a password input exists, OR /sign-in\|log-in\|member login/i matches the title or H1, OR it matches the body text on a short page (<80 words). Login-like pages are excluded from on-page aggregation and scoring. |
| **thin content** | `0 < wordCount < 300` on an **indexable HTML** page. A page with exactly 0 words is NOT thin. Same rule in `lib/parsers/internal.parser.ts`, `lib/services/issue-membership.ts`, and the live score. |
| **crawl depth** | Clicks from the homepage (SF column `Crawl Depth`). ≤3.0 average is "good" in the health score. |
| **link score** | SF's PageRank-like 0–100 internal-authority metric (column `Link Score`), carried per-URL by `InternalParser`. |
| **page_index / per_url_index** | The aggregator's per-URL record set (from `InternalParser`) that powers complete affected-URL membership and pillar analysis. Empty page_index ⇒ "thin" completeness verdict. |
| **completeness verdict** | `thin` / `partial` / `complete` per session (`lib/services/completeness.ts`) — see SF input contract. |
| **archived** | A session/audit whose origin JSON blob was pruned (90 d); read surfaces serve a degraded findings-table fallback with a banner. |
| **keyword cannibalization** | One keyword ranking through multiple URLs of the same site (from SEMRush positions); emitted as a warning issue. |
| **pillar / pillar analysis** | Deterministic content-architecture pipeline (`lib/services/pillarAnalysis/`): classifies pages, clusters blog content to program/location anchors via local MiniLM embeddings, and scores pillar-strategy fit 1–10. |
| **quarter grid** | `/quarter-grid` drag-and-drop weekly SEO planning board; pushes planned weeks to Teamwork via qct_ tokens. |
| **HarvestedLink / HarvestedPageSeo** | Transient tables written during ADA site-audit page jobs; consumed and deleted by `broken-link-verify` when it builds the live-scan run. |

## SEO health score (sf-upload) — `computeHealthScore`

`lib/services/scoring.service.ts`. 0–100. Six weighted factors; each factor joins
the denominator **only when its input data exists**, then
`score = clamp(round(earned / possible × 100), 0, 100)` (0 if nothing joined).
Full denominator = 100 (20+20+25+15+10+10).

| # | Factor | Weight | Joins denominator when | Points |
|---|---|---|---|---|
| 1 | Indexability | 20 | `total_urls > 0` and `indexable_urls` defined | full 20 at ratio ≥ 95%, else `(ratio/0.95)×20` |
| 2 | Error rate | 20 | `total_urls > 0` and BOTH `client_errors` and `server_errors` defined | full 20 at `(4xx+5xx)/total < 1%`, else `max(0, 20 − errorRate×20)` |
| 3 | Missing title / meta / H1 | 10 / 8 / 7 | base > 0 (base = `indexable_urls` if > 0, else `total_urls`) | each: `weight × (1 − count/base)`, clamped ≥ 0; counts read from the emitted issue objects, defaulting to 0 when absent |
| 4 | Crawl depth | 15 | `avg_crawl_depth` defined | 15 at avg ≤ 3.0, 0 at ≥ 6.0, linear between: `15×(1−(d−3)/3)` |
| 5 | Thin content | 10 | a `thin_content` **issue object exists** AND `indexable_urls > 0` | 10 at thin/indexable < 5%, 0 at > 40%, linear: `10×(1−(r−0.05)/0.35)` |
| 6 | Schema coverage | 10 | `technical_seo.structured_data` present AND `total_urls > 0` | full 10 at `pages_with_schema/total ≥ 30%`, else `(r/0.30)×10` |

Consequences you must internalize:

- **Scores renormalize.** Two crawls with different exports uploaded are NOT
  comparable — a crawl missing structured_data or depth data silently redistributes
  those weights.
- **Thin-content asymmetry.** The aggregator emits a `thin_content` issue only when
  count > 0, so a site with ZERO thin pages never earns the 10 thin points — the
  factor drops out entirely. Missing title/meta/H1 factors, by contrast, join
  whenever a base exists (zero missing = full points).
- **The score is never persisted on the blob.** `CrawlRun.score` is the durable copy
  (computed in the findings dual-write, `lib/findings/seo-mapper.ts`); history reads
  it. The Claude/srt_ export deliberately strips `health_score` so the LLM can't
  parrot it (`lib/parsers/claude-export-builder.ts`).

## Live SEO score — `scoreLiveSeo`

`lib/findings/live-seo-score.ts`. C6 (broken-link verifier) Phase 3 fork of the above with **explicit factor
availability** — all its factors are ALWAYS in the denominator (possible = 85:
20+20+10+8+7+10+10). Crawl-depth and broken-links are **never** in the denominator
(the live audit has no full crawl graph; the fork exists precisely because the
original would award full crawl-depth points for missing depth data).

Returns **null** (unscoreable, not zero) when any of:
- `attempted ≤ 0` (`SiteAudit.pagesTotal`)
- `observed / attempted < 0.5` — observed = **HarvestedPageSeo row count**, NOT
  `pagesComplete` (best-effort persist runs after the counter bump)
- `indexableScored ≤ 0` — a fully noindex or login-walled site is unscoreable;
  a partially-noindex site still scores.

Denominator bases differ from the SF score:

| Factor | Live formula |
|---|---|
| Indexability 20 | `indexableScored / observed` (≥95% full), where indexableScored = observed rows that are indexable ∧ ¬loginLike |
| Error rate 20 | `pagesError / attempted` (<1% full) |
| Missing title 10 / meta 8 / H1 7 | `weight × (1 − min(1, count/indexableScored))` |
| Thin 10 | `thin / indexableScored` (<5% full, >40% zero) |
| Schema 10 | `pagesWithSchema / observed` (≥30% full) |

Result is written to the live-scan `CrawlRun.score` by the `broken-link-verify`
builder, computed before the transient tables are deleted.

## Issue-type catalog

Full table (every type, meaning, severity, weight, effort, URL-set completeness):
**`references/issue-catalog.md`**. The load-bearing rules:

- **Three severity buckets**: critical / warnings / notices. The aggregator
  (`lib/services/aggregator.service.ts`) emits curated issues from parser data,
  passes SF's precomputed `issues_overview` issues through pre-categorized as
  `sf_*` types, dedupes by type (keeping the HIGHER count, unioning URL lists),
  then drops count-only `sf_*` issues superseded by richer curated ones.
- **Complete vs sampled URL sets.** Only four types recover complete membership
  from the page index (`DERIVABLE_COMPLETE` in `lib/services/issue-membership.ts`):
  `missing_title`, `missing_h1`, `missing_meta_description`, `thin_content` — and
  only when the page index is non-empty. Every other issue's URL list is a
  **capped parser sample** (`affectedUrlSource: 'parser-sample'`): missing_* samples
  cap at 20, thin/broken at 50, duplicate title groups at 10.
- **Duplicate counting is GROUPS, not pages.** SF path: `duplicate_titles.count` =
  number of distinct duplicated title values. Live path (`onpage-seo-mapper.ts`):
  `duplicate_title` / `duplicate_meta_description` / `duplicate_h1` run-scope count =
  number of duplicate groups (trimmed-EXACT value shared by ≥2 pages), while
  page-scope rows list every member page. A count of 3 can mean 30 affected pages.
- **Type-name mismatch across sources** (as of 2026-07-02): the SF aggregator emits
  `duplicate_titles` (plural); the live mapper emits `duplicate_title` (singular).
  Both carry weight 60 in `ISSUE_WEIGHTS`, but cross-source type diffs will not
  line these up.
- **Priority score** (`lib/services/priority.service.ts`):
  `priority_score = ISSUE_WEIGHTS[type] (default 25) × scale-multiplier × severity-multiplier`,
  rounded to 1 decimal. Scale: count ≥1000→2.0, ≥500→1.8, ≥100→1.5, ≥50→1.3,
  ≥20→1.2, ≥10→1.1, else 1.0. Severity: critical 1.5, warning 1.0, notice 0.6.
  Effort: LOW/HIGH_EFFORT_TYPES sets with escalation (count >100 bumps low→medium,
  >50 medium→high). ROI = score / {low:1, medium:2, high:3}; ≥40 high, ≥20 medium.
  quick_wins = top 5 high-ROI.

## Screaming Frog input contract

Full parser registry (45 parsers, keys, filename patterns, ordering traps):
**`references/sf-export-contract.md`**.

- **Expected exports** (`lib/parsers/expected-exports.ts`):
  - **core** — `internal_all`, `response_codes`. The parse route
    (`app/api/parse/[sessionId]/route.ts`) **hard-rejects (400)** technical-workflow
    sessions missing either, returning the missing ids. Keyword-research workflow
    sessions skip this gate.
  - **recommended** — `page_titles`, `meta_description`, `h1_`,
    `images_missing_alt_text`.
  - **optional** — `accessibility`, `exact_duplicates`, `low_content`,
    `redirect_chain`, `redirection`, `pagespeed`, `search_console`, plus SEMRush
    organic positions (`notExpectedFromSf`).
- **Detection order** (`findParserForFile`, `lib/parsers/index.ts`): filename
  substring over the ordered `PARSERS` array → raw-content match → CSV-header match.
  SEMRush files have date-stamped names, so they are content-detected and MUST sit
  last in the array.
- **Every parser declares an explicit `static parserKey` string literal.** The
  aggregator hardcodes `parsedData.<key>` lookups; deriving the key from the class
  name broke in production when the build minified class names (page_index and
  keyword data silently vanished, prod-only). New parsers go in BOTH `PARSERS` and
  `PARSER_MAP`.
- **What a missing export does**: recommended/optional gaps degrade the relevant
  issue sections and can flip the **completeness verdict**
  (`lib/services/completeness.ts`): `thin` when the page index is empty (internal_all
  never uploaded, or uploaded but captured 0 indexable HTML pages — two distinct
  messages); `partial` when >50% of issues carry no affected URLs; else `complete`.
  Health-score factors silently renormalize (see above).
- `InternalParser` is the keystone: status distribution, indexability, thin content,
  missing/duplicate SEO elements, crawl depth, link score, per-URL GSC
  (Clicks/Impressions/CTR/Position) and GA4 columns when SF is API-connected, and
  the per_url_index feeding page_index and pillar analysis.

## Live-scan semantics (C6, branch)

The ADA site-audit page job harvests, in ONE `page.evaluate`, all `<a href>`/
`<img src>` targets plus on-page SEO (`lib/ada-audit/link-harvest.ts` +
`lib/ada-audit/seo/parse-seo-dom.ts`). The `broken-link-verify` job later merges
both into one live-scan `CrawlRun`.

- **Harvest cap**: 300 deduped targets per page (`HARVEST_CAP`). Same-domain =
  exact host, www-insensitive; **subdomains are external** in v1. Externals are
  harvested but NOT checked.
- **Broken-link verification** (`lib/ada-audit/broken-link-check.ts`) — precision
  posture: HEAD first; HEAD < 400 → `ok`; HEAD ≥ 400 or HEAD network error →
  confirm with GET; GET ≥ 400 → `broken`; SSRF-blocked / network error / timeout →
  `unconfirmed`, which is **excluded from broken counts** entirely. Caps: 2000
  checks per audit (deterministic ordering so the cap is stable), 4 workers, 250 ms
  per-host spacing (no wait on a host's first request), 10 s per request, 15-min job.
- **Broken finding shape** (`lib/findings/broken-link-mapper.ts`): types
  `broken_internal_links` and `broken_images`, severity critical. Run-scope count =
  distinct broken TARGET URLs; page-scope rows are keyed by **SOURCE page** (one per
  (type, source page)) to avoid dedupKey collisions when many pages link to one
  broken target.
- **On-page aggregation set** = indexable (2xx ∧ HTML ∧ ¬noindex) ∧ ¬loginLike.
  Types: `missing_title` (critical), `missing_h1`/`missing_meta_description`/
  `thin_content`/`duplicate_title` (warning), `duplicate_meta_description`/
  `duplicate_h1` (notice). Missing/thin reuse `deriveIssueTypesForPage` so the live
  rule can never drift from the SF parser.
- **Link graph / BFS depth** (branch: `lib/ada-audit/seo/link-graph.ts`, consumed by
  the verify builder): inlinks/outlinks = distinct audited sources/targets over
  harvested internal-link edges; `crawlDepth` = BFS hops from the homepage over that
  graph. Depth is an **approximation** (only audited pages, only harvested edges,
  capped at 300 targets/page) and is `null` for every page when the homepage itself
  was not audited (`depthAvailable = false`).

## Canonical run selection (branch-sensitive)

Canonical-run selection is merge-state-sensitive (branch vs main) — the full
rules and both merge states live in er-seo-tools-architecture-contract §6;
verify which world you are in: `git branch --show-current && grep -n
pickCanonicalSeo lib/services/findings-shared.ts`.

## ADA / accessibility

- **Model**: axe-core (file-injected `axe.min.js`) runs in headless Chrome against
  the rendered DOM. Automation detects *failures*; it cannot prove conformance.
- **wcagLevel tag expansion** (`lib/ada-audit/runner.ts`) — WCAG AA inherits all of
  A, and 2.x inherits 2.0/2.1, so the tag list must include the whole chain:
  - `wcag21aa` ("Required", default): `['wcag2a','wcag2aa','wcag21a','wcag21aa']`
  - `wcag22aa` ("Aspirational"): the above + `'wcag22aa','best-practice'`
  - axe options: `resultTypes ['violations','incomplete']`, reporter `no-passes`,
    `iframes: false`. Nodes truncated to **20 per violation before storage** —
    recomputing scores from stored blobs uses capped node counts.
- **Score** (`lib/ada-audit/scoring.ts`): penalty is per **rule**, not per node:
  critical 4, serious 3, moderate 2, minor 1. `totalElements` = Σ nodes across
  violations. `score = max(0, round(100 − penalty / log10(max(10, totalElements))))`.
  `compliant` = literally zero violation nodes (the interface comment says
  "zero violations with wcag21aa tags" — the code is stricter/simpler; trust the
  code). Note the counter-intuitive divisor: MORE violation nodes soften the
  per-rule penalty. `computeScoreFromCounts` mirrors it for site-level aggregates
  (there totalElements = violation count).
- **domElementCount** = `querySelectorAll('*').length` captured before axe; values
  < 50 render an "Unreliable result" warning (JS-rendered SPA suspicion), suppressed
  for archived results.
- **Why DCL + settle**: `waitUntil: 'networkidle'` never fires on real client sites
  (analytics/chat polling), so navigation uses `domcontentloaded` (30 s) followed by
  a best-effort `waitForNetworkIdle({idleTime: 500, timeout: 5000})` that swallows
  ONLY its own TimeoutError. This came out of the 2026-05-21 incident (1128 nav
  timeouts, 99.1% from third-party beacon hosts).
- **Screenshots**: branded reports embed ≤6 screenshots, ≤300 KB each,
  path-traversal-guarded, fresh (non-archived) audits only; top issues capped at 10,
  worst pages at 50 (`lib/report/report-data.ts`).
- **VPAT** (`lib/report/vpat.ts`): a two-state scaffold — every WCAG A/AA criterion
  is either **"Does Not Support"** (automated failures found, with rule/page counts)
  or **"Not Evaluated"** (no automated failures; manual review required). It never
  says "Supports": absence of axe failures is not evidence of conformance. WCAG
  2.2-only criteria are omitted with a note when the audit ran at 2.1 AA.

## Lighthouse / PSI

- Measures Lighthouse categories PERFORMANCE, ACCESSIBILITY, BEST_PRACTICES at
  DESKTOP strategy (`lib/ada-audit/lighthouse-pagespeed.ts`).
- Provider switch (`lib/ada-audit/lighthouse-provider.ts`): `LIGHTHOUSE_ENABLED=false`
  forces `off`; else `LIGHTHOUSE_PROVIDER` ∈ `pagespeed | local | off`, code default
  `local`, prod `pagespeed` (unknown values fall back to `local`). `local` Lighthouse
  owns `page.goto` and mutates CDP throttling — it must be reset afterwards or axe
  runs throttled.
- **PSI's accessibility category is NOT the accessibility authority here.** Scores
  and compliance verdicts come exclusively from axe-core via `computeScore`;
  Lighthouse's a11y number is a partial heuristic audit and is informational only.
  Expect PSI performance-score variance vs historical local-Lighthouse numbers
  (Google's infrastructure, different throttling). Per-page PSI failure never fails
  the axe portion.

## GA4 / GSC / Prospects (C10 reports)

Service-account auth (key file at `GOOGLE_SA_KEY_FILE`), no OAuth. All fetches are
per **window**, and every report fetches the period window AND a comparison window.

- **GA4** (`lib/analytics/google/ga4-provider.ts`) — 6 `runReport` calls per window:
  totals (`sessions, engagedSessions, averageSessionDuration, eventsPerSession,
  bounceRate, keyEvents`), date series (sessions×date), landing pages
  (sessions+keyEvents × landingPagePlusQueryString), cities (sessions+keyEvents ×
  city), new-vs-returning (sessions), devices (sessions × deviceCategory).
- **GSC** (`lib/analytics/google/gsc-provider.ts`) — 3 `searchanalytics.query` calls
  per window: totals (no dimensions), date series, top 100 queries. `siteUrl` is
  passed verbatim (a mismatch → 403 → classified `unmapped`).
- **Period-over-period** (`lib/analytics/dates.ts`, pure UTC math): monthly reports
  use `lastFullMonth`; comparison is `prev_period` (same-length window immediately
  before) or `prev_year` (same dates one year earlier).
- **Prospects**: CRM adapter only when the client has `crmClientRef` AND
  `CRM_API_BASE` is set; else a manual `ProspectsEntry` row matched on
  (clientId, periodStart, periodEnd); else the source is `unmapped`.
- Shared error taxonomy per source: `quota` (429/RESOURCE_EXHAUSTED), `auth` (401),
  `unmapped` (403 or missing property/siteUrl), `error`. A report renders with
  degraded sections unless all three sources fail.

## Handoff-token taxonomy (pat_ / srt_ / krt_ / qct_)

Four dashboard features hand structured payloads to the external `er-handoff-memo`
Claude skill. Same envelope everywhere: HS256 JWT, 1 h expiry (`EXPIRY_SECONDS =
3600`), issuer `er-seo-tools`, per-feature secret env var with production fail-fast
and a dev fallback. The clipboard payload is three locked lines: `Webapp: <url>`,
`<X> ID: <id>`, `Access token: <prefix>_...`.

| Prefix | Module | Scope | Export content | Skill produces |
|---|---|---|---|---|
| `pat_` | `lib/pillar-token.ts` | `['read','narrative-write']` | Pillar-analysis structured export | Strategic pillar memo, PATCHed back |
| `srt_` | `lib/seo-roadmap-token.ts` | `['read','roadmap-write']` | `buildTechnicalAuditExport` (crawl summary, issues, url_registry, page_index, completeness — **health_score deliberately stripped**) | Technical-SEO roadmap (optional Teamwork push) |
| `krt_` | `lib/keyword-memo-token.ts` | `['read','memo-write']` | Keyword-research export (cannibalization, quick wins, optimization gaps, gap keywords capped at 500) | Keyword strategy memo |
| `qct_` | `lib/quarter-push-token.ts` | `['read','receipt-write']` | Quarter-grid planned weeks | Teamwork tasks + receipt PATCH |

The token-authed GET/PATCH routes are regex-exempted from the cookie gate in
`middleware.ts`; mint-token and poll routes stay cookie-gated. As of 2026-07-02,
srt_/krt_ payloads remain **session-bound / SF-only** (plan decision D3) — live
srt_/krt_ memos are not built, whatever older handoff docs claim.

## Pillar analysis fit score (context)

1–10 composite of six subscores (`lib/services/pillarAnalysis/score.ts`) with
default weights (`config.ts`): contentVolume 0.25, topicalConcentration 0.20,
organicFootprint 0.20, internalLinkGap 0.15, programPageClarity 0.15,
backlinkDistribution 0.05. Absent signals substitute a neutral 5.0 and are flagged
via `subscorePresence` (the UI must render N/A, not the 5). Two traps:
**internalLinkGap is inverted** — FEWER inlinks on informational pages = MORE pillar
opportunity = higher subscore; and `dataCompleteness = 17%` means "1 of 6 subscores
computable", not "data missing". Viability gate: no informational pages and no
anchors caps the score at 1; anchors but no informational pages caps at 2.

## Common mistakes

1. Comparing health scores across crawls with different export sets — the
   denominator renormalizes silently. Check `metadata.files_processed` first.
2. Reading a duplicate_* count as "pages affected" — it is duplicate GROUPS; page
   membership lives in the page-scope findings / group lists.
3. Treating a capped URL list as complete. Only missing_title / missing_h1 /
   missing_meta_description / thin_content are derivable-complete, and only when
   the page index is non-empty.
4. Calling a page with 0 words "thin" — thin is strictly `0 < wc < 300`, indexable
   HTML only.
5. Writing "Supports" into a VPAT or calling a site "compliant" from axe output —
   automation proves failures only; compliant means zero violation *nodes* found by
   the rules that ran.
6. Quoting the axe score divisor as page DOM size — it is `log10` of total violation
   nodes (floored at 10), and penalties count rules, not nodes.
7. Counting `unconfirmed` link checks as broken. They are excluded by design
   (precision posture).
8. Using PSI's accessibility number as the compliance verdict.
9. Quoting canonical-run behavior without stating the merge state — main and this
   branch genuinely differ (see "Canonical run selection").
10. Expecting `scoreLiveSeo` to return 0 for a login-walled site — it returns null
    (unscoreable), and the UI treats null and 0 very differently.

## Provenance and maintenance

Authored 2026-07-02 against branch `feat/autonomous-live-seo-source` (23 commits
ahead of main, not merged, not deployed). Everything above was read from that
working tree. The canonical-run section is the only part known to differ on `main`;
formulas, parsers, and the ADA engine sections match main's behavior as described
in CLAUDE.md but were verified on the branch only.

Re-verify volatile facts:

| Fact | Command |
|---|---|
| Health-score factors/weights | `sed -n '15,145p' lib/services/scoring.service.ts` |
| Live-score null guards + weights | `sed -n '1,80p' lib/findings/live-seo-score.ts` |
| ADA score formula | `sed -n '1,36p' lib/ada-audit/scoring.ts` |
| wcag tag expansion | `grep -n -A3 'wcagTags' lib/ada-audit/runner.ts` |
| Parser count/order (45 as of 2026-07-02) | read `PARSERS` in `lib/parsers/index.ts` |
| Core-export gate | `grep -n 'missingCore' 'app/api/parse/[sessionId]/route.ts' lib/parsers/expected-exports.ts` |
| DERIVABLE_COMPLETE set | `sed -n '1,10p' lib/services/issue-membership.ts` |
| Priority weights/multipliers | `sed -n '1,110p' lib/services/priority.service.ts` |
| Canonical window (30 d) + branch selection | `grep -n 'SEO_SF_CANONICAL_WINDOW_DAYS' lib/services/seo-canonical.ts; grep -n pickCanonicalSeo lib/services/findings-shared.ts` |
| Broken-link caps (2000/4/250ms/10s/15min) | `grep -n 'BROKEN_LINK\|timeoutMs' lib/jobs/handlers/broken-link-verify.ts lib/ada-audit/broken-link-check.ts` |
| Harvest cap 300 / sitemap cap 1000 | `grep -n 'HARVEST_CAP\|HARD_CAP' lib/ada-audit/link-harvest.ts lib/ada-audit/sitemap-crawler.ts` |
| GA4/GSC metric sets | `sed -n '88,113p' lib/analytics/google/ga4-provider.ts; grep -n 'runQuery' lib/analytics/google/gsc-provider.ts` |
| Token prefixes/scopes/TTL | `grep -n "TOKEN_PREFIX\|EXPIRY_SECONDS\|scope" lib/pillar-token.ts lib/seo-roadmap-token.ts lib/keyword-memo-token.ts lib/quarter-push-token.ts` |
| Lighthouse provider default | `sed -n '11,27p' lib/ada-audit/lighthouse-provider.ts` |
| Pillar subscore weights | `sed -n '36,48p' lib/services/pillarAnalysis/config.ts` |
| Merge state | `git branch --show-current && git log --oneline -3` |
