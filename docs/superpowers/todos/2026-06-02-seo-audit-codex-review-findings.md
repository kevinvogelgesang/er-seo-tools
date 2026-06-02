# SEO Audit Overhaul — Codex Adversarial Review Findings (PRs #35–#40)

**Date:** 2026-06-02
**Reviewer:** Claude + Codex (warm workspace session `019e754d-a416-7d12-9bc1-3dfd9a3134d4`, resumed once per PR for a fresh adversarial pass).
**Procedure:** Per `HANDOFF-2026-06-02-seo-audit-overhaul-review.md` §4–§6. Each PR reviewed against its `base..head` implementation-only diff (doc-reorg renames ignored).
**Bottom line:** All six PRs are **ship-with-fixes**. **No Critical findings, no blockers.** Two Codex claims were independently verified against the code (P38 hash, P40 gating) — both real.

---

## Cumulative verification (top-of-stack `feat/seo-audit-phase-6`)
- `npx tsc --noEmit` → **exit 0** (clean)
- `npm run build` → **succeeded** (no RSC/client-boundary/Suspense errors)
- `npx vitest run lib/services lib/parsers app/api/seo-roadmap app/api/keyword-memo app/api/clients` → **838 tests / 62 files passed**
- ADA integration suites still fail locally on "Unable to open the database file" — **environmental, not a regression** (handoff §3).

---

## Cross-cutting themes (appear in 2+ PRs — fix once, benefit everywhere)

### T1. Offset pagination / "latest two" need a stable secondary sort — **Important**
- **P37** `app/api/seo-parser/[sessionId]/pages/route.ts:18-24` — all three sort modes order by a *non-unique* column only (`issueCount` / `wordCount` / `crawlDepth`). With tied rows, offset pagination can duplicate or skip rows between pages. Fix: `[{ issueCount: 'desc' }, { url: 'asc' }]` etc.
- **P39** `lib/services/client-seo-history.ts:26` — `latestTwo` ordering by `createdAt` alone is non-deterministic on equal timestamps. Add `{ id: 'asc' }`.

### T2. Mint-token "processing" never ages out (sticky poll) — **Important** (P2 + P6, same bug twice)
- **P36** `SeoRoadmapCard.tsx:119` + `.../mint-token/route.ts:48`
- **P40** `KeywordMemoCard.tsx:119` + `.../keyword-memo/by-session/[sessionId]/mint-token/route.ts:66-68`
- Mint sets `status:'processing'`. If the skill never PATCHes (token expires / skill fails / user never runs it), the row stays `processing` forever and **every future page load auto-starts a fresh 15-minute polling cycle.** Fix once: pass `tokenMintedAt` and only auto-poll inside the token/poller window (or compute an effective expired/error state server-side).

### T3. Unauthenticated by-session poll returns the full generated markdown — **Minor** (P2 + P6)
- **P36** `app/api/seo-roadmap/by-session/[sessionId]/route.ts:14`
- **P40** `app/api/keyword-memo/by-session/[sessionId]/route.ts:14`
- The poller only needs `status / error / updatedAt`, but the route returns the whole `roadmapMarkdown` / `memoMarkdown`. Anyone with a sessionId can fetch the finished doc. Acceptable for an internal tool (parity with pillar-analysis), but trivially trimmable.

### T4. URL normalization gaps — **Important**
- **P35** `aggregator.service.ts:932/:944` — the `optimization_gaps` title/H1 join is still **exact-URL only**. `metaByUrl` keys on raw `per_url_index.url`; SEMRush URLs are looked up raw. A trailing-slash / protocol / query mismatch between Screaming Frog and SEMRush leaves title/H1 **blank** — i.e. the "title/H1 bug fixed" claim only holds when the two tools emit byte-identical URLs. Normalize both sides with one key before joining.
- **P39** `lib/services/normalize-host.ts:7-11` — trailing-dot FQDNs aren't stripped (`example.edu.` ≠ `example.edu`) → client-match / `siteHost` fragmentation. Add `host.replace(/\.+$/, '')`.

---

## Per-PR findings

### PR #35 — Phase 1 (compaction + completeness contract) · ship-with-fixes
- ✅ **Completeness contract is sound** (the phase's riskiest logic): only `missing_title`/`missing_h1`/`missing_meta_description`/`thin_content` can be `affectedUrlRefsComplete:true`; derived independently from `per_url_index` (not capped `issue.urls`); gated on `indexable`; thin = `wordCount>0 && <300`. No path mislabels a non-derivable issue complete.
- ✅ `mergeParserData` object-array dedupe really fixed (special branch precedes the generic array branch); "Copy for Claude" uses `buildTechnicalAuditExport`, not the raw blob; priority.service won't crash on empty input.
- **Important — T4:** `optimization_gaps` join still exact-URL (`aggregator.service.ts:932/:944`).
- **Minor:** `url-registry.ts:25` registry key appends `originalUrl` → UTM variants don't actually collapse; registry identity excludes `kind` → first-seen kind wins; `per_url_index` merge dedupes by raw URL only.

### PR #36 — Phase 2 (roadmap handoff) · ship-with-fixes
- ✅ **Auth correct:** GET requires `read`, PATCH requires `roadmap-write`, both verify `sub === roadmapId`; a token for roadmap A **cannot** write roadmap B.
- **Important — T2:** sticky `processing`.
- **Important — T3:** unauthenticated poll returns full markdown.
- **Minor:** body parsed before the 50k/200k cap is applied (`[id]/roadmap/route.ts:20`) — not a true pre-parse limit; minted token always carries both scopes (intentional — note it).

### PR #37 — Phase 3 (SessionPage persist) · ship-with-fixes
- ✅ **Transaction correct:** `$transaction([deleteMany, createMany×75, update])` is inside the parse `try` (failure → catch → session `error`); delete-before-insert is idempotent on re-parse; 75-row chunk stays under SQLite's 999-variable limit.
- ✅ **issueTypes filter is quoted** (`JSON.stringify(issueType)`); no raw substring filters; `PageDetailModal` rehydration falls back safely for old sessions.
- **Important — T1:** unstable pagination ordering (`pages/route.ts:18-24`).
- **Minor:** JSON `contains` filter scans page rows (not index-friendly — fine at scale); pages API doesn't distinguish bad id from old session (returns 0 rows); `PagesTable.tsx:182` row key `p.url` could collide on dup normalized URLs.

### PR #38 — Phase 4 (structured recs + Teamwork) · ship-with-fixes — **densest findings**
- ✅ **No Teamwork credentials / no app-side Teamwork API** (push is skill+MCP only); the GET `teamwork` block matches Kevin's rules exactly (`parentTaskName:"Audit Optimizations"`, `taskType:'subtask'`, `matchParentAssignee:true`, `addTimeEstimates:false`, `usePriorityFlags:false`); in-app sample label uses `!rec.affectedUrlComplete` (not source-string inference) — won't overstate completeness.
- **Important — affectedSetHash (verified in code, `recommendation-builder.ts:40`):**
  1. Hash folds in `source` → same issue type + same URL set hashes **differently** when source flips `parser-sample`→`derived-page-index`. Breaks the "same affected-URL set → same hash" contract. Hash `type` + sorted-URL list only; keep `source` as metadata.
  2. **Grouped issues hash an empty set.** `duplicate_title_tags` / `duplicate_h1_tags` / some duplicate-meta paths carry URLs in `issue.groups[*].urls`, not `issue.urls`/`affectedUrlRefs`. The builder hashes only the latter → `affectedUrlCount: 0` and an empty-set hash. **This collides across all such grouped types and breaks the P4 skill's `seo-hash:` Teamwork dedupe *now*** (not just future recrawl-resolve). Fold group URLs into the hashed set.
  3. Incomplete-issue hashes use capped/sample URLs → unstable across parser order/caps even after sorting. Treat the hash as authoritative only when `affectedUrlComplete === true` (or flag it).
- **Minor:** `sortedUrls.join(',')` is delimiter-ambiguous (URLs can contain commas) — use `JSON.stringify`; several P4 issue types uncalibrated in `priority.service` effort sets (default medium — make it intentional); `RecommendationsPanel.tsx:39-40` index row keys.

### PR #39 — Phase 5 (per-client history/trends/diff) · ship-with-fixes
- ✅ `getClientSeoHistory` is **scalar-only** (`select` excludes `result`, ISO dates, null-scalar rows safe); chart filters null counts, table renders dashes; the diff page's `window.location.search` read sits inside a client `useEffect` — **correctly avoids the App Router `useSearchParams`/Suspense gotcha**; query-param ids auto-run even when absent from the dropdown.
- **Important:** the *global* `/api/parse/history` (`route.ts:15-24,:39-46`) **still selects + parses `result`**, and the diff page calls it (`diff/page.tsx:141-148`). The "no blob deserialization in history paths" contract holds only for the new `/clients/[id]` helper. Decide whether the global endpoint must also go scalar-only or that's a separate cleanup.
- **Important — T4:** `normalizeHost` trailing-dot gap.
- **Minor:** `/clients/[id]` calls `getClientSeoHistory` in both `generateMetadata` and the page (duplicate DB read); chart labels use local-TZ formatting (UTC-midnight crawls can show a different local day).

### PR #40 — Phase 6 (keyword-research route) · ship-with-fixes
- ✅ **Workflow isolation correct for the named list surfaces:** upload writes `workflow`; parse skips `triggerPillarAnalysis` for `keyword-research`; `/api/parse/history` filters `technical`; `getClientSeoHistory` filters `technical`; migration backfills legacy rows via `workflow TEXT NOT NULL DEFAULT 'technical'`. Gap-only uploads still produce `keyword_signals` (early-return includes `gapData`).
- **Important — isolation gap (verified in code):** direct technical surfaces are **not** workflow-gated. `/seo-parser/results/{id}` (`page.tsx:16` — `findUnique` + `notFound` only) renders the technical UI for a known keyword sessionId; `/api/diff/route.ts:32-45` compares any two `complete` sessions regardless of `workflow`. Add `workflow:'technical'` guards (redirect/`notFound`/reject) if isolation is meant to cover direct URLs, not just pickers. *(Note: the keyword **results** page being un-gated is intentional per the P6 plan; this is about the **technical** results/diff surfaces accepting keyword ids.)*
- **Important — T2:** sticky `processing` (keyword-memo mirror).
- **Important — T3:** unauthenticated poll returns full `memoMarkdown`.
- **Minor:** `SemrushKeywordGapParser` (`semrushKeywordGap.parser.ts:60-88`) disambiguates the 3 siblings but will match *other* SEMRush keyword-list exports (`Keyword`+`Volume`+`KD %`, no URL/position headers) — not uniquely "Keyword Gap → Missing"; header aliases narrow (BOM-prefixed `Keyword`, `Difficulty`/`Keyword Difficulty Score` could false-negative — validate vs real exports); `keywordResearch:{is:null}` auto-link filter (`mint-token/route.ts:32`) can exclude a technical session that already minted a memo — `workflow:'technical'` already covers it, consider dropping.

---

## Recommended pre-merge action (Claude synthesis)

**Fix before merge (cheap, correctness/UX):**
1. **T1** — stable secondary sort in the pages API + `client-seo-history` `latestTwo`. (Real duplicate/skip bug.)
2. **P38 affectedSetHash** — drop `source` from the hash, fold `issue.groups[*].urls` into the hashed set, `JSON.stringify` the URL list. This one bites the **Teamwork dedupe today**, not just the deferred recrawl-resolve, so it's the highest-value fix despite being labelled Important.
3. **T2** — `tokenMintedAt` stale-processing guard (one fix pattern, applied to both roadmap + keyword cards).

**Fix or consciously accept (judgment calls):**
4. **T4** — URL normalization on the `optimization_gaps` join (P35) and trailing-dot in `normalizeHost` (P39). The P35 one is worth doing because it silently re-opens the "blank title/H1" bug the phase claimed to fix.
5. **P40 isolation** — decide whether `/seo-parser/results/{id}` + `/api/diff` should reject keyword sessions. Low exploit surface (need the id) but trivial to gate.
6. **P39 global history blob** — decide: make `/api/parse/history` scalar-only now, or log as follow-up.

**Accept as-is for an internal tool (note, don't block):**
7. **T3** unauthenticated poll exposure (parity with pillar); pre-parse body-size caps; local-TZ chart labels; uncalibrated effort defaults; parser-detection breadth (verify against real SEMRush exports during smoke).

**Operational gate (handoff §7):** set `SEO_ROADMAP_TOKEN_SECRET` + `KEYWORD_MEMO_TOKEN_SECRET` in prod (mint fails closed without them); confirm the two out-of-repo skills are installed.

Full verbatim Codex responses retained at `/tmp/seo-codex-review/out3{5,6,7,8,9}.txt` and `out40.txt` for this session.
