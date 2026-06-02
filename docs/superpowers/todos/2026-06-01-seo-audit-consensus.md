# SEO Audit Tool — Multi-Agent Consensus Report

**Date:** 2026-06-01
**Agents:** 8 (neutral, risk-averse, ambitious, contrarian, first-principles, user-empathy, resource-constrained, systems-thinker), all reading the real code.
**Problem:** Review the `/seo-parser` ("SEO Audit"/"Technical Audit") tool and recommend how it should change to reach the owner's vision: a tool that turns Screaming Frog + SEMRush (+ later Node scripts + DataForSEO) into (a) a roadmap of real technical-SEO fixes and (b) keyword-research decisions.

## Fixed constraints (owner decisions)
1. **AI stays out of the app.** App emits a rich structured payload → a Claude Desktop/Code skill writes the roadmap & keyword memo and posts it back (reuse the existing pillar-analysis mint-token → PATCH pattern). No in-app Anthropic billing.
2. **Outputs wanted (all):** prioritized roadmap doc; push fixes to Teamwork; a genuinely usable in-app dashboard; a keyword strategy memo.
3. **DataForSEO + Node-script checks:** architect clean typed hooks now, build/spend later.
4. Internal single-/few-user tool; no heavy auth.

---

## CONSENSUS (7–8 / 8 agreed)

### C1. The JSON-blob-in-SQLite data model is the root problem — add a normalized per-URL store
`Session.result` is one serialized `AggregatedResult` TEXT blob. The aggregator reads every CSV row, extracts aggregate counts, then **throws the per-URL data away**. Flagged HIGH severity by ~all 8 agents. This single decision blocks the dashboard drill-down, Teamwork tasks with real affected-URLs, the keyword title/H1 join, and cross-crawl diff. **Fix:** add a `SessionPage` / page-index table (url, title, h1, meta, statusCode, wordCount, crawlDepth, issueTypes[]) built during aggregation; keep the blob for the full export but stop it being the only queryable store. Also denormalize scalar metrics (healthScore, criticalCount, totalUrls, siteHostname) into indexed `Session` columns. *(2 of 8 named this the single highest-leverage change.)*

### C2. Close the Claude handoff loop — and make the export the front door
Verified: the prominent **"Copy JSON" button copies the full untrimmed `AggregatedResult`**; the good trimmed `buildTechnicalAuditExport` is a separate download. The owner's whole workflow is upload → copy → paste into Claude Desktop, then the result lives only in Claude Desktop. **Fix (5 of 8 named a version of this as the single highest-leverage change):** replicate the pillar-analysis handoff for the Technical Audit — a `SeoRoadmap`/`SeoAuditReport` model, mint-token endpoint, PATCH write-back, and a `seo-audit-roadmap` skill — so the roadmap renders *in the app*. At minimum, immediately make the primary button copy the trimmed payload (+ invocation template), not the raw blob.

### C3. `optimization_gaps` title/H1 are always blank — fix the join (cheap, do first)
Verified at aggregator.service.ts:901–905 (`title: ''`, `h1: ''`, comment "We don't have per-URL title/H1 from parsers"). The data exists in the internal parser; it's just never joined. Named by ~6/8 as a quick early win. Becomes trivial once C1's page index exists.

### C4. Recommendations must become structured objects, not flat strings
`buildRecommendations()` returns `string[]` (capped 15) from `ISSUE_RECOMMENDATIONS` templates. To drive Teamwork tasks, the roadmap view, and a clean skill payload, return `Recommendation{ type, severity, count, affected_urls[], effort, fix_guidance }`. ~5/8.

### C5. Technical Audit leads; Keyword Research follows
7/8 agree Technical Audit should be finished first (it's closer to working and has a clear output path). Only the "ambitious" agent argued Keyword Research should lead *new build* work (because the tech-audit UI was already overhauled in the April plan).

### C6. Teamwork push must be human-confirmed and staleness-guarded — never auto-push
The single most-repeated risk ("the stale auto-generated task graveyard"). Tasks must be anchored to `sessionId + issueType`, created in a defined client tasklist, capped per crawl, and resolved/closed via the next crawl's diff. Push is a deliberate action after reviewing the roadmap, not automatic. ~5/8.

### C7. DataForSEO + Node-script hooks = a typed `supplemental_data` interface NOW
Universal agreement with the owner's "hooks now" call, with one sharp point (contrarian): define the optional `supplemental_data` shape in `AggregatedResult` + the export *now*, or you'll later do a breaking migration on every stored session JSON. No API calls until a flag is flipped.

### C8. Keep the parser registry; add a detection-order test
`BaseParser` + 40-parser registry with 3-stage detection (filename → raw content → headers) is the best part of the codebase — [KEEP]. But ordering is a load-bearing code comment (e.g. PageSpeedOpportunities before PageSpeed; SEMRush content-detection after filename parsers). Add a routing test. ~4/8.

### C9. AggregatorService is a 921-line god object with unsafe typing
`buildIssues()` alone is ~270 lines of imperative if-chains; `ParsedData` is effectively `unknown` with hundreds of `as` casts. Every new feature gets jammed in here. Decompose into IssueBuilder / KeywordSignalBuilder / DuplicateContentBuilder + typed parser results. MED severity, ~4/8 — do it as features force the area open, not as standalone churn.

---

## DIVERGENCES (genuine judgment calls — need owner decision)

### D1. Keyword Research: separate `/keyword-research` route vs. enriched panel in the same tool — ~3/3 split
- **Separate route** (ambitious, first-principles, systems + the FUTURE spec): different inputs (SEMRush positions/pages/gap + SF page text), different output (memo vs roadmap), different cadence; cleaner data-join; avoids a confusing mega-upload.
- **Same tool / enrich existing `KeywordSignalsPanel`** (neutral, contrarian, resource-constrained): SEMRush parsers + a 490-line panel already exist; a separate route duplicates upload/session/client/export infra and forces re-uploading the same files. *This is the top question for the owner.*

### D2. How much in-app dashboard to build at all
The contrarian view: if the owner only ever copies JSON, a fancy dashboard is theater — **fix the export + skill loop, build minimal UI.** Most agents disagree and want a usable dashboard, but the warning stands: the dashboard is only worth it if the skill posts results *back into* it (C2). Build the loop before the chrome.

### D3. Health score: demote vs. explain
All agree the single opaque number is weak (schema-coverage weighting questioned for edu/nonprofit sites; not comparable across sessions with different uploaded files). Split on whether to **demote it** (first-principles) or **keep it and show a factor breakdown + trend sparkline** (resource-constrained, user-empathy, systems). Cheap either way.

---

## OUTLIERS / HIGH-VALUE SINGLE FINDINGS

- **★ `priority.service.ts` already exists, is fully unit-tested, and is NOT wired into the UI** (systems agent; verified). It computes `ScoredIssue` (severity × effort × ROI), `top_priorities`, `quick_wins`. The "prioritized roadmap" engine the owner wants is **already half-built** and only surfaced in the markdown export route. Wiring `getPrioritySummary()` into a "Top Priorities" hero on the results page is ~1 component + 1 import — possibly the cheapest high-impact change available.
- **Cross-crawl / per-client longitudinal view** (user-empathy, systems, ambitious): `Session.clientId` + `healthScore` + a working diff service already exist but aren't surfaced per client. For a 30-client agency, a client timeline (score sparkline, persistent issues, auto-diff latest-vs-previous, re-audit cadence badge) turns the tool from one-shot into a weekly habit.
- **`mergeParserData` array dedup is a no-op** (contrarian): `value.filter(i => !existingList.includes(i))` on arrays of objects never matches → uploading two files that both emit array data silently double-counts. Specific bug to verify.
- **Client domain normalization** (resource-constrained): `www.client.com` vs `client.com` produce two `siteName`s → breaks any trend matching. Strip `www` before trend features.
- **Fire-and-forget pillar trigger** has no retry/queue/visible status (1,2,3,5): borrow the ADA `queue-manager` pattern before adding more fire-and-forget work (roadmap, Teamwork).
- **Quarter-grid could consume read-only SEO signals** (systems): health badge + overdue-audit indicator on grid chips, no bidirectional sync.
- **"Data completeness: N/43 parsers matched" badge + upload checklist** (contrarian, user-empathy): most sessions upload 3–5 files, so 35 parsers match nothing and the tool *feels* half-baked from thin input. Tell the user which files to export from Screaming Frog.

---

## STRONGEST-SINGLE-IDEA VOTE TALLY
- Close/improve the Claude handoff loop (mint-token post-back like pillar, or one-click trimmed copy): **5/8**
- Add normalized per-URL page index (`SessionPage`): **2/8**
- Wire the existing `priority.service` into a Priority Hero UI: **1/8** (but verified as nearly free)

## Suggested sequencing synthesis (to be confirmed in spec)
1. **Quick wins (days):** copy-trimmed-payload button; fix `optimization_gaps` join; wire `priority.service` → Top Priorities hero; health-score factor breakdown; dec{lutter export buttons; upload checklist.
2. **Close the loop:** Technical-Audit roadmap handoff (mint-token + PATCH + `SeoRoadmap` model + skill), reusing pillar pattern.
3. **Data foundation:** `SessionPage` page index + denormalized scalar metrics; structured `Recommendation` objects; `supplemental_data` typed hook.
4. **Teamwork push** (human-confirmed, sessionId+issueType anchored, diff-resolved).
5. **Per-client history / trend / cadence + client-context diff.**
6. **Keyword Research** (route-vs-panel per D1) + SEMRush Keyword Gap parser + keyword-memo skill.
7. Decompose AggregatorService as features force it open; add parser-routing test; DataForSEO/Node real implementations when green-lit.
