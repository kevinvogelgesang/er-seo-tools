# Handoff — Review the SEO Audit Overhaul (6 stacked PRs)

**Purpose:** Everything a fresh Claude + Codex session needs to **review and verify** the 6-phase SEO Audit overhaul before merge. Read this top to bottom, then work the per-PR checklist. You are reviewing, not building.

**Repo:** `/Users/kevin/enrollment-resources/Claude/er-seo-tools` · Next.js 15 App Router, TS, Prisma+SQLite, deployed on RunCloud+PM2 (NOT serverless), Node 22.

---

## 0. What this is

The `/seo-parser` "SEO Audit" tool was overhauled from "upload CSVs → copy JSON" into: Screaming Frog + SEMRush in → (a) a prioritized technical-SEO **roadmap** written by a Claude skill and rendered in-app + pushable to Teamwork, and (b) **keyword-research** decision-making (strategy memo) — plus per-client history/trends. All AI work stays in **skills** via a mint-token/PATCH handoff (no in-app Anthropic billing). Design spec: `docs/superpowers/specs/2026-06-01-seo-audit-overhaul-design.md`. Consensus that seeded it: `docs/superpowers/todos/2026-06-01-seo-audit-consensus.md`. Each phase has a plan in `docs/superpowers/plans/2026-06-0*-seo-audit-phase-N.md`.

## 1. The stack (merge BOTTOM-UP)

Each PR is based on the previous branch (stacked). GitHub will auto-retarget to `main` as each lower PR merges; otherwise rebase/retarget manually.

| PR | Branch (→ base) | Phase | Commits / diff vs base | Plan doc |
|----|-----------------|-------|------------------------|----------|
| **#35** | `feat/seo-audit-overhaul` → `main` | P1 quick wins + compaction layer | 15 / ~5.5k lines* | `plans/2026-06-01-seo-audit-phase-1.md` |
| **#36** | `feat/seo-audit-phase-2` → `feat/seo-audit-overhaul` | P2 roadmap handoff | 12 / ~2.2k | `plans/2026-06-01-seo-audit-phase-2.md` |
| **#37** | `feat/seo-audit-phase-3` → `feat/seo-audit-phase-2` | P3 SessionPage persist + drill-down | 7 / ~1.1k | `plans/2026-06-01-seo-audit-phase-3.md` |
| **#38** | `feat/seo-audit-phase-4` → `feat/seo-audit-phase-3` | P4 structured recs + Teamwork push | 9 / ~870 | `plans/2026-06-01-seo-audit-phase-4.md` |
| **#39** | `feat/seo-audit-phase-5` → `feat/seo-audit-phase-4` | P5 per-client history/trends/diff | 7 / ~915 | `plans/2026-06-02-seo-audit-phase-5.md` |
| **#40** | `feat/seo-audit-phase-6` → `feat/seo-audit-phase-5` | P6 keyword research route | 9 / ~2.7k | `plans/2026-06-02-seo-audit-phase-6.md` |

*\*#35's diff vs `main` ALSO contains an unrelated doc-reorg commit (`chore(docs): reorganize superpowers specs/plans…`, ~63 file renames) that was already staged before the work. Review the **`feat(seo)`/`fix(seo)`/`refactor(seo)` commits only**; ignore the archive renames.*

To get the implementation-only diff for any PR: `git diff <base-branch>..<head-branch>` (the table's base column), or `git log --oneline <base>..<head>` then read the `seo`-scoped commits.

## 2. Setup for review

```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
git fetch origin
npm install            # RunCloud uses npm install, NOT npm ci
# DB for local test runs: the prod DATABASE_URL path needs root; use the local dev DB:
#   export DATABASE_URL="file:./prisma/local-dev.db"   (already in .env.local)
npx prisma migrate deploy   # apply the 4 new migrations on the local dev DB if testing a branch
```

## 3. Global verification (run per branch)

```bash
npx tsc --noEmit          # must be clean on every branch
npm run build             # must succeed (catches RSC/client-boundary + Suspense issues)
npx vitest run lib app    # scoped test run
```

**Known environmental caveat (NOT a regression):** `lib/ada-audit/*` integration tests fail locally with **"Unable to open the database file"** — they need a test SQLite DB that isn't provisioned in this sandbox. They are unrelated to the overhaul (no ADA/Prisma code was touched). Verify the SEO-scoped suites instead:
```bash
npx vitest run lib/services lib/parsers app/api/seo-roadmap app/api/keyword-memo app/api/clients
```
All SEO-scoped suites passed at authoring time (P1–P6 combined ≈ 1,200+ tests).

## 4. Using Codex for the review (leverage the warm session)

There is an existing Codex consultation thread for this workspace — **session `019e754d-a416-7d12-9bc1-3dfd9a3134d4`** — that already reviewed **every phase's plan AND final diff** during the build. Resuming it gives Codex full continuity across all 6 phases.

- Easiest: use the **`/ask-codex`** slash command (or the `consulting-codex` skill auto-routes) — it resumes that session for this workspace automatically.
- Ask Codex to **re-review each PR's diff adversarially as a reviewer who did NOT build it** (don't let it rubber-stamp its own prior approvals). Example per-PR prompt:
  > "Re-review `git diff <base>..<head>` for PR #N as a skeptical reviewer seeing it fresh. You reviewed it during the build; now hunt for anything you or the implementer rationalized away — correctness, security/auth, data integrity, regressions to earlier phases. List Critical/Important/Minor with file:line."
- Codex runs read-only. Render its response verbatim + your synthesis (per the consulting-codex skill).

## 5. Cross-cutting things to verify (apply to all PRs)

1. **The handoff token pattern (P2 roadmap, P6 keyword) mirrors pillar-analysis** — short-lived JWT (`srt_`/`krt_`), scope split (`read` vs write), `sub === id` binding, body-validated-before-auth on PATCH, 50k/200k caps. Confirm no token is over-scoped and no write route skips the scope check.
2. **No `Session.result` blob reads in hot/query paths** — P3 added scalar columns + `SessionPage`; P5 history reads ONLY scalars (assert the `select` excludes `result`). Confirm nothing reintroduced blob parsing into list/history/trend queries.
3. **`affectedUrlComplete` is the source of truth for "complete vs sample" sets** (P1/P4) — `parser-complete` is NOT a sample. The roadmap/skill payloads must honor `affectedUrlSource`/`affectedUrlComplete`, never overstate completeness.
4. **Workflow isolation (P6):** `Session.workflow` (`technical`|`keyword-research`). Keyword uploads must NOT appear in `/api/parse/history` (technical history + diff picker) or Phase 5 client trends (`getClientSeoHistory` filters `workflow:'technical'`), and must skip `triggerPillarAnalysis`. Verify the filters are present.
5. **Additive/nullable migrations** — 4 new migrations (`seo_roadmap`, `session_page` + Session scalars, `client_teamwork_tasklist`, `keyword_research_session` + `Session.workflow`). All additive; old rows default sensibly. Confirm no destructive column changes; confirm `prisma migrate deploy` applies cleanly in order.
6. **Back-compat for old sessions** — pre-overhaul sessions have null scalars / no `SessionPage` / no `url_registry`. The Crawled-Pages table, the trend chart, and `PageDetailModal` must degrade gracefully (empty states, `—`), not crash.
7. **Browser-safety** — `claude-export-builder.ts` and `keyword-research-export.ts` are imported by client components; they must stay type-only + pure (no server-only/Prisma imports).
8. **Idempotency is skill-side** (P4 Teamwork) — dedup by a plain-text `seo-hash:` marker scanned with pagination; there is no app-side task ledger. Confirm the skill contract documents the failure modes.

## 6. Per-PR review checklist

> For each: (a) `git checkout <branch>`, (b) `npx tsc --noEmit` + `npm run build` + scoped vitest, (c) read the plan doc + the `seo`-scoped commits, (d) ask Codex to adversarially re-review the diff, (e) check the listed risk points + the PR body's own "follow-ups" section.

### PR #35 — Phase 1 (quick wins + compaction)
- **Scope:** `UrlRegistry`/`PageIndexEntry`/`affectedUrlRefs` built in the aggregator + embedded in `buildTechnicalAuditExport`; complete-vs-sample completeness flags; "Copy for Claude" (trimmed payload, not raw blob); "Suggested priorities" (wires the previously-unused `priority.service`); health score dropped → severity summary; `optimization_gaps` title/H1 join fixed; `mergeParserData` object-array dedupe fixed.
- **Verify:** the **completeness contract** — only `missing_title`/`missing_h1`/`missing_meta_description`/`thin_content` are `affectedUrlRefsComplete:true` (derived independently from the page index, gated on `indexable`, thin = `wordCount>0 && <300`); everything else is `parser-sample`. This was the phase's riskiest logic (`lib/services/issue-membership.ts`, `aggregator.service.ts`). Confirm the derivation does NOT depend on the capped `issue.urls`.
- **Ignore:** the doc-reorg commit in the vs-`main` diff.

### PR #36 — Phase 2 (roadmap handoff)
- **Scope:** `SeoRoadmap` model; `srt_` token (`lib/seo-roadmap-token.ts`); routes `mint-token` (by-session, get-or-create→mint→processing), `[id]` GET payload, `[id]/roadmap` PATCH, by-session poll; `GenerateRoadmapButton` + `SeoRoadmapCard` (poller) on the results page; `seo-audit-roadmap` skill (OUT OF REPO).
- **Verify:** the poller auto-starts only when `status==='processing'`; mint flips to `processing` only AFTER a successful mint (failure → `error`); P2002-only race catch; `by-session` poll route returns markdown unauthenticated (parity with pillar — note, not a blocker).

### PR #37 — Phase 3 (persist page index)
- **Scope:** `SessionPage` table (per crawled URL, `issueTypes` JSON, `issueCount`) + denormalized `Session` scalars (`siteHost`/`totalUrls`/`criticalCount`/`warningCount`/`noticeCount`); written at parse-finalize via an atomic `$transaction([deleteMany, chunked createMany(75), update])`; paginated read API `/api/seo-parser/[sessionId]/pages`; Crawled-Pages drill-down; `PageDetailModal` fixed to match `affectedUrlRefs` (rehydrated), not just capped `issue.urls`.
- **Verify:** transaction is inside the parse try/catch (rolls back + errors the session); idempotent on re-parse; the `issueTypes` filter uses the QUOTED token (`{contains: '"missing_title"'}`) so it can't substring-match. **Note:** the scalar columns are written but only *read* starting in P5 (intentional groundwork) — `*Count` are issue-group counts, not page counts.

### PR #38 — Phase 4 (structured recs + Teamwork)
- **Scope:** structured `Recommendation[]` (effort via `priority.service`, `fixGuidance`, refs, stable `affectedSetHash`, `groups`/`sampleUrls`); `Client.teamworkTasklistId`; roadmap payload gains `structured_recommendations` + a `teamwork` directive (`parentTaskName:"Audit Optimizations"`, rules: matchParentAssignee, no estimates, no priority); in-app `RecommendationsPanel`; `seo-audit-roadmap` skill gained the **skill-driven MCP Teamwork push** (OUT OF REPO).
- **Verify:** the in-app sample label uses `affectedUrlComplete` (not `source !== 'derived-page-index'`); the GET payload's `teamwork` block matches Kevin's rules; no Teamwork credentials anywhere in the app (push is skill+MCP only).

### PR #39 — Phase 5 (per-client history/trends/diff)
- **Scope:** `normalizeHost` (applied to `siteHost` + parse-time client matching); `getClientSeoHistory` shared helper (scalar-only, no blob, ISO dates) used by BOTH the API and the `/clients/[id]` page; trend chart (Recharts lazy, ISO-keyed); session list; "compare latest two" → `/seo-parser/diff?a=&b=`; diff page reads `window.location.search` (NO `useSearchParams`).
- **Verify:** history `select` excludes `result`; grouping is by `clientId`; diff auto-run works even when the ids aren't in the global dropdown; chart/table tolerate null scalars (old sessions). Old sessions with `clientId:null` won't appear under a client (a backfill is a noted follow-up).

### PR #40 — Phase 6 (keyword research route)
- **Scope:** `SemrushKeywordGapParser` → `keyword_signals.gap_keywords` (header detection disambiguated from the 3 sibling SEMRush parsers); `KeywordResearchSession` model + `Session.workflow`; keyword-memo handoff (`krt_` token, 4 routes mirroring seo-roadmap, `buildKeywordResearchExport` with gap cap 500); `/keyword-research` route (reuses upload pipeline); `keyword-strategy-memo` skill (OUT OF REPO).
- **Verify:** the workflow isolation (§5.4) is fully wired; gap-only uploads still produce `keyword_signals` (`computeKeywordSignals` early-return includes `gapData`); the keyword results page is intentionally NOT workflow-gated (memo works for any session with keyword data — there's a code comment); `matchesContent` won't false-match Organic Positions/Pages/Position-Tracking (tests prove this — re-confirm with a REAL "Keyword Gap → Missing" export, since SEMRush headers vary).

## 7. Before merging — operational

- **Production env secrets to set** (PM2 `ecosystem.config.js` / RunCloud env), alongside the existing `PILLAR_TOKEN_SECRET`:
  - `SEO_ROADMAP_TOKEN_SECRET` (P2/P4 roadmap handoff)
  - `KEYWORD_MEMO_TOKEN_SECRET` (P6 keyword handoff)
  Without these, the deployed mint routes throw (prod refuses the dev fallback) — verify the deploy config.
- **Two out-of-repo skills** were added under `~/.claude/skills/` (NOT in any PR; they're the Claude-Desktop handoff counterparts):
  - `seo-audit-roadmap` (writes the roadmap, optional Teamwork push)
  - `keyword-strategy-memo` (writes the keyword memo)
  Confirm they're installed wherever the team runs the handoff.
- **Deploy:** `git push` then `ssh $PROD_SSH "~/deploy.sh"` (runs `prisma migrate deploy`). Migrations are additive; safe to apply in order.

## 8. Deferred / out of scope (don't flag as missing — they're intentional)
- Auto-resolve-on-recrawl (close Teamwork tasks when a re-crawl shows the issue gone) — `affectedSetHash` is cross-crawl stable to enable it later.
- `.txt` page-content ingestion for deeper content-gap analysis (P6).
- Pushing keyword tasks to Teamwork (keyword is memo-only).
- Persistent-issue table; quarter-grid health badge.
- Backfill for pre-overhaul sessions (null `clientId`/scalars) so they appear in P5 trends.
- DataForSEO + Node-script live-URL checks — only the typed `supplemental_data` hook exists (no calls).

## 9. Suggested review order
Bottom-up (#35 → #40), because later phases depend on earlier shapes. For each: tsc + build + scoped tests on the branch, read the plan, Codex adversarial diff review, walk the §5 cross-cutting list + the per-PR risk points. Land #35 first; the rest auto-retarget.
