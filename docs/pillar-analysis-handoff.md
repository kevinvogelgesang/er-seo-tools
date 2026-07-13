# Pillar Analysis — Project Handoff

**Last updated:** 2026-04-29 (post-prod-deploy)
**Branch:** `main` (Phases 1, 2.1, 2.2, 2.3 squash-merged via PR #2 as commit `1035b0b`; v1.0.1 polish on top)
**Status: shipped to production and end-to-end validated.**

> **2026-07-13 update:** the `skills/pillar-analysis-narrative/` directory and
> `scripts/build-skill.sh` / `npm run build:skill` build wiring described
> throughout this doc were retired as part of the D1 handoff-engine
> consolidation. `skills/er-handoff-memo/` now covers this surface (and five
> other handoff families) with no local build step — see
> `docs/superpowers/archive/specs/2026-07-12-d1-handoff-engine-consolidation-design.md`.
> The narrative below is kept as the historical record of Phases 1–2.3 and is
> otherwise unchanged.

---

## TL;DR

Internal pillar-analysis tool for er-seo-tools. Given a Screaming Frog crawl already imported into `/seo-parser`, it produces a 1–10 site fit score, a hub-format recommendation, and per-URL verdicts (`pillar` / `cluster` / `leave-as-blog` / `consolidate` / `prune` / `excluded`). Surfaced at `/pillar-analysis/[id]` and reachable from a "Pillar Analysis →" button on the seo-parser results page. **All four phases shipped: Phase 1 (deterministic backbone), Phase 2.1 (clipboard prompt UX), Phase 2.2 (skill artifact + narrative writeback), Phase 2.3 (dashboard memo rendering with action-triggered polling, sticky page nav, contextual regenerate button).** End-to-end validated against staging via Claude Code on 2026-04-29 — analyst pasted prompt, skill fetched analysis, generated 6-section memo, PATCHed back, dashboard auto-refreshed. v1.0.1 polish ships alongside: trimmed GET endpoint (60K → ~3K tokens), inline-code styling on memo, 403 sandbox-allowlist diagnosis in fetch script.

---

## Quick orientation — where things live

### Specs & plans (the long-form record)
- `docs/superpowers/specs/2026-04-28-pillar-analysis-design.md` — original Phase 1 design spec
- `docs/superpowers/plans/2026-04-28-pillar-analysis-phase-1.md` — Phase 1 implementation plan (22 tasks)
- `docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-1-clipboard-prompt-design.md` — Phase 2.1 spec
- `docs/superpowers/plans/2026-04-29-pillar-analysis-phase-2-1-clipboard-prompt.md` — Phase 2.1 plan (11 tasks)
- `docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-2-skill-artifact-design.md` — Phase 2.2 spec
- `docs/superpowers/plans/2026-04-29-pillar-analysis-phase-2-2-skill-artifact.md` — Phase 2.2 plan (13 tasks)

### Operational docs (read these for setup / contracts)
- `docs/screaming-frog-setup.md` — full SF configuration recipe for all three er-seo-tools use cases (audit, keyword research, pillar analysis)
- `docs/pillar-prompt-contract.md` — locked format contract for the clipboard payload (synced between dashboard button and skill regex)

### Code locations
- `lib/pillar-prompt.ts` — `composePayload` + `parsePillarPrompt` (the format contract)
- `lib/pillar-token.ts` — JWT mint/verify with prod fail-fast + dev fallback
- `lib/services/pillarAnalysis/` — the analysis service (modular)
  - `types.ts`, `config.ts` — shared types + tunable thresholds
  - `pageType.ts`, `intent.ts` — classifiers
  - `embeddings.ts`, `cluster.ts`, `verticality.ts` — semantic vector ops (cluster.ts and verticality.ts are dead code now post-redesign, see "Known issues" below)
  - `anchorClustering.ts` — the active clustering algorithm (anchor-based, replaces free clustering)
  - `joinRecords.ts`, `extractors.ts` — data joining across parsers
  - `score.ts`, `subscoreLabels.ts` — site fit score + per-subscore semantic labels
  - `verdict.ts` — five-bucket verdict assignment
  - `hubDecision.ts` — hub-format recommendation
  - `topicNaming.ts` — dead code (used by old free-clustering flow)
- `lib/services/pillarAnalysis.service.ts` — public entry point, orchestrator
- `app/api/pillar-analysis/` — API routes
  - `route.ts` — POST (run analysis on a session)
  - `[id]/route.ts` — GET (Bearer-protected, requires `read` scope)
  - `[id]/mint-token/route.ts` — POST (mint 1h JWT)
  - `[id]/narrative/route.ts` — PATCH (write narrative back, requires `narrative-write` scope)
  - `by-session/[sessionId]/route.ts` — GET (trimmed payload for dashboard polling, public)
- `app/pillar-analysis/[id]/` — dashboard route + components
- `app/seo-parser/results/[sessionId]/components/PillarAnalysisButton{,Client}.tsx` — the "Pillar Analysis →" button in the audit page action row
- `skills/pillar-analysis-narrative/` — the Claude skill artifact (SKILL.md + scripts + templates + README + version.txt)
- `scripts/build-skill.sh` — packages the skill folder into `dist/skills/pillar-analysis-narrative-<v>.zip`. Wired as `npm run build:skill`.
- `instrumentation.ts` — startup hook; refuses to start in production if `PILLAR_TOKEN_SECRET` is missing.

---

## Architecture overview

### Three layers

**1. The webapp (Next.js, RunCloud-deployed)**
- Existing `/seo-parser` flow handles Screaming Frog CSV upload + parse.
- New pillar-analysis service runs automatically when a parse completes (pipeline hook in `app/api/parse/[sessionId]/route.ts`).
- Dashboard at `/pillar-analysis/[id]` renders the deterministic output.
- Audit page now has a "Pillar Analysis →" button in the action row that polls every 1.5s while the analysis is running and links to the dashboard once complete.

**2. The deterministic analysis pipeline (in `lib/services/pillarAnalysis/`)**
1. Parse seo-parser CSVs → per-URL records (URL, title, H1, word count, inlinks, GSC clicks/impressions, GA4 sessions, schema types).
2. Classify page type (program / location / blog / news / resource / nav / home / unknown) using URL slug primary, schema.org tiebreaker, depth tertiary.
3. Classify intent (informational / commercial / transactional / navigational) via rule-based heuristics + pageType fallback.
4. Embed each record via `Xenova/all-MiniLM-L6-v2` running locally in-process (no external API calls).
5. Anchor-based clustering: for each in-scope blog/news/resource page, find the closest program or location anchor by cosine similarity and assign to that anchor if ≥ `verticalAlignmentThreshold`. Unmatched pages → catchall.
6. Per-URL verdict assignment.
7. Site fit score (six weighted subscores, 1–10) with a viability gate that caps the score at 1 when there are zero informational pages and zero anchors.
8. Hub format recommendation (5 formats + `insufficient-content` for empty-cluster sites).

**3. The Claude skill (in `skills/pillar-analysis-narrative/`)**
- Activates when an analyst pastes a clipboard payload from the dashboard.
- Fetches the structured JSON via Bearer-protected GET endpoint.
- Generates a strict 6-section memo (~600–1000 words) following the template in `templates/memo_structure.md`.
- PATCHes the memo back to the analysis row via `aiNarrative` column.
- Replies in chat with a one-screen summary + dashboard URL.

### Key design decisions

- **Anchor-based clustering, not free clustering.** Programs and locations are the predetermined pillars (HubSpot canonical model for higher-ed). Blog content clusters UNDER them. We tried free clustering first; it produced semantic-vocabulary clusters that didn't map to strategic pillars. See the Phase 1 spec section 6 + the redesign commit `4abe08d`.
- **Local embeddings, not external API.** `@xenova/transformers` runs MiniLM in-process. No outbound API calls from the webapp. Pre-warmed at deploy via `postinstall` hook so first analysis isn't a cold download.
- **Viability gate.** Sites with zero informational pages and zero anchors get score = 1 with hub recommendation = `insufficient-content`. Avoids the "5/10 across the board because we couldn't compute anything" trap.
- **N/A presence semantics.** A subscore is "present" only when it can be MEANINGFULLY computed for the site. If informational pages are absent, the input-derived signals (organic footprint, internal-link gap, backlink distribution) all report N/A even when the data is uploaded — because the score function operates on informational records.
- **JWT tokens with prod fail-fast.** `PILLAR_TOKEN_SECRET` env var required in production. If missing, `instrumentation.ts` refuses to start. Dev environment falls back to a hardcoded constant with a logged warning.
- **Single source of truth for the prompt format.** `docs/pillar-prompt-contract.md` locks the field labels + regex pattern. The dashboard button (`composePayload`) and the skill regex must stay in sync; a regression test in `lib/pillar-prompt.test.ts` catches composer/parser drift.

---

## Status by phase

### Phase 1 — Deterministic backbone — **SHIPPED + REAL-DATA TESTED**

**What's in:** Per-URL join, page-type classification, intent classification, anchor-based clustering, verdict logic, site fit score (six subscores), hub recommendation, dashboard at `/pillar-analysis/[id]`, pipeline hook for auto-trigger from seo-parser completion, "Pillar Analysis →" button on audit page with client-side polling.

**Smoke-tested on:**
- nuvani.edu (159 URLs, anchor-rich career college) — score 8/10, 4 program pillars + 3 location pillars + 1 catchall. Strategic output makes sense to the analyst.
- prowayhairschool.com (26 URLs, mostly nav-only site) — score 1/10 with `insufficient-content` hub recommendation. Correctly identifies the site has nothing to pillar around.

**Real findings from smoke testing that drove iteration:**
- Free clustering produced semantically-coherent but strategically-meaningless clusters. → Replaced with anchor-based clustering.
- Hub recommendation produced nonsense reasoning ("100% horizontal clusters" on a site with zero clusters). → Added `insufficient-content` short-circuit.
- Generic "Low/Moderate/High opportunity" labels conflated different score meanings across subscores. → Added per-subscore semantic labels.
- Score 4 on a content-less site felt too generous. → Added viability gate.
- Semrush exports use canonical filenames like `*-organic.Positions-*.csv` (not `*semrush*`). → Broadened the loader regex.
- Subscore presence semantics initially conflated "data uploaded" with "data applicable to this site." → Reverted to informational-scoped presence (a subscore is "present" only if it could be meaningfully computed).

### Phase 2.1 — Clipboard prompt UX — **SHIPPED + PROD VALIDATED**

**What's in:** `POST /api/pillar-analysis/[id]/mint-token` (1h JWT, HS256). "Copy Claude Prompt" button on the dashboard. Clipboard fallback modal for browsers without `navigator.clipboard.writeText`. Production fail-fast on missing `PILLAR_TOKEN_SECRET`.

**Tested:** Validated end-to-end on prod via Claude Code on 2026-04-29 — analyst pasted prompt, skill fetched analysis with the minted JWT, memo PATCHed back, dashboard auto-refreshed. The fail-fast check on `PILLAR_TOKEN_SECRET` worked (PM2 came up clean after the env var was set).

### Phase 2.2 — Skill artifact + narrative writeback — **SHIPPED + PROD VALIDATED**

**What's in:**
- `PATCH /api/pillar-analysis/[id]/narrative` with structured error codes. 9 route tests.
- `GET /api/pillar-analysis/[id]` tightened to require Bearer + `read` scope. As of v1.0.1, the response is also trimmed to a narrative-shaped payload (~3K tokens vs ~63K before — see "v1.0.1 polish" below).
- `skills/pillar-analysis-narrative/` folder with SKILL.md, version.txt, README, two reference Python scripts (fetch_analysis.py, post_narrative.py), `templates/memo_structure.md`.
- `npm run build:skill` packages the folder into `dist/skills/pillar-analysis-narrative-{version}.zip` (7 files including the build-time-copied SF setup doc).

**Tested end-to-end on prod (Claude Code, 2026-04-29):** Analyst on staging (`seo.erstaging.site`) clicked "Copy Claude Prompt" → pasted into Claude Code (which uses local network, not cloud sandbox) → skill activated → fetched the analysis → wrote a 6-section memo → PATCHed it back → dashboard auto-refreshed within ~3s and rendered the markdown with dashboard-matched typography.

**Cloud-Claude environments (Claude Desktop / web / claude.ai sandbox)** cannot reach the webapp because their bash tool's egress proxy has a hardcoded allowlist that doesn't include `seo.erstaging.site` or `seo.enrollmentresources.com`. v1.0.1's `fetch_analysis.py` now surfaces the 403 + response headers so an analyst hitting this gets a one-line diagnosis ("switch to Claude Code, or have org admin add the domain to the allowlist") instead of a debugging round-trip. To fix this for cloud-Claude analysts, an Anthropic org admin would need to add the domains to the workspace's bash sandbox allowlist.

### Phase 2.3 — Strategic memo rendering — **SHIPPED + PROD VALIDATED**

**What's in:**
- `StrategicMemoCard` (server component) between Score grid and HubRecommendationCard. Branches on `aiNarrative` presence: renders memo + relative timestamp when set, instructional hint when null.
- `MemoMarkdown` (client) wraps `react-markdown` with hand-rolled component overrides matching the dashboard's typography. As of v1.0.1, includes inline `code` styling (Tailwind badge with bg/border/rounded/monospace).
- `RelativeTime` (client) returns `null` on server/initial render to eliminate timezone hydration mismatches.
- `MemoPoller` (client) wraps a pure state machine in `lib/memo-poller-machine.ts` — action-triggered (page mount with no memo OR Regenerate-button click), 15-min cumulative-active cap, visibility-paused, watches `narrativeUpdatedAt` for change → `router.refresh()`.
- `SectionNav` (client) sticky page nav at `top-[60px]` (stacks below global Nav). All section anchors use `scroll-mt-28` to clear the combined nav stack.
- `CopyClaudePromptButton` accepts `hasMemo` prop — label switches to "Regenerate via Claude" when memo exists. Emits a trigger event after successful copy so the poller starts a fresh cycle.
- Site-wide `scroll-smooth` on `<html>` for polished anchor navigation.
- `GET /api/pillar-analysis/by-session/[sessionId]` additively returns `aiNarrative` + `narrativeUpdatedAt` for the poller's change detection.

**Tested end-to-end on prod (Claude Code, 2026-04-29):** Memo arrived from the skill and rendered with full 6-section structure on the live dashboard. Auto-refresh worked within ~3s. Sticky nav cleared the global Nav. Inline code styling on backtick-wrapped tokens (`programPageClarity`, `/programs/`, etc.) was the one polish item flagged in QA — addressed in v1.0.1.

### v1.0.1 polish — **SHIPPED**

- **Trimmed GET endpoint** (`/api/pillar-analysis/[id]`). The skill's first prod run did 8 tool calls because the GET endpoint dumped the full Prisma row including the per-URL list with embeddings — 63K tokens for nuvani's 159 URLs. The endpoint now returns a narrative-shaped payload via `lib/services/pillarAnalysis/narrativePayload.ts`: score block, hub, `clusters[]` with anchor stats + sample members, `verdictSummary`, `lowConfidenceAssignments`, `excludedAnchors`. ~3K tokens for typical sites. Skill drops to 1 read + 1 memo write + 1 PATCH. Pure transform, 8 unit tests.
- **Inline `code` styling** in `MemoMarkdown.tsx` — Tailwind badge with bg + border + rounded + monospace. Visible on backtick-wrapped tokens like `topicalConcentration`, `/programs/`, etc.
- **403 / network_blocked branch** in `fetch_analysis.py` — surfaces response headers when the cloud-Claude egress proxy blocks the request. SKILL.md error table updated to direct analysts to Claude Code or the allowlist fix.
- **Skill version bumped** to 1.0.1; ZIP rebuilt.

---

## Production deployment notes (post-deploy)

- **Real env path is `/home/seo/webapps/seo-tools/.env`**, not `/home/seo/.env` as an earlier draft of CLAUDE.md said. `PILLAR_TOKEN_SECRET` lives there.
- **`ecosystem.config.js` on the server has long-standing prod-specific customizations** (`seo` user, `seo-tools` paths) that diverge from the repo version (`seotools` user). The deploy works because `git pull` only fast-forwards files that are actually in the incoming diff, and `ecosystem.config.js` hasn't been touched in the repo's recent history. If a future PR modifies `ecosystem.config.js`, expect a merge conflict on the server — manual reconciliation required.
- **`package-lock.json` accumulates a small drift** between deploys (3-line additions from the npm install during deploy). The deploy script's first `git pull` will refuse to overwrite it. Workaround: `cd /home/seo/webapps/seo-tools && git checkout -- package-lock.json` before re-running deploy. Worth investigating root cause when there's downtime; deploy works fine with the workaround.
- **MiniLM pre-warm runs in postinstall** and completes in ~0.6s on this VPS. Memory steady-state ~225MB after first analysis.
- **Cloud-Claude egress allowlist** is a hard barrier for analysts running the skill from Claude Desktop / web / claude.ai. Two options: (a) instruct analysts to use Claude Code locally, OR (b) Anthropic org admin adds `seo.erstaging.site` and `seo.enrollmentresources.com` to the workspace bash sandbox allowlist. Option (a) is in place today; option (b) would unblock the broader team.

## Known issues / limitations

1. **Token expiration UX friction.** 1h JWT expiry. If the analyst pauses (lunch, meeting) and resumes the chat to revise the memo, the skill returns `token_expired` and they have to copy a fresh prompt. Acceptable V1.

2. **Memo regeneration is implicit.** SKILL.md instructs Claude to re-PATCH on every revision (the "narrative-staleness rule"). Validated in the prod smoke test that this works on a single regenerate, but multi-revision behavior hasn't been exercised.

3. **Dead code from the redesign:** `lib/services/pillarAnalysis/cluster.ts`, `verticality.ts`, `topicNaming.ts` are no longer in the orchestrator's path (replaced by `anchorClustering.ts` + direct anchor naming in the orchestrator). Their tests still pass; they're harmless. Could be deleted in a cleanup commit if desired.

4. **Embedding fallback for sites with no `<main>` landmark.** The Phase 1 spec recommended a SF custom XPath for first-paragraph extraction. Sites where the XPath doesn't match still produce useful clustering from title + H1 + meta description, but cluster quality drops. SF setup doc recommends fallback XPaths.

5. **`prisma migrate dev` can fail when the dev server holds the SQLite lock.** Workaround: stop the dev server, run the migration, restart.

6. **Windows parity for Claude Desktop skills** is unverified. The SF setup doc + skill ZIP install assume macOS/Linux paths; Windows analysts may hit friction. Less impactful now since the recommended path for cloud-Claude analysts is Claude Code anyway.

7. **dataCompleteness percentage on the dashboard** can be misleading on small sites — users may interpret "17%" as "data is missing" when it actually means "1 of 6 subscores is meaningfully computable for this site." The semantic-label updates (per-subscore labels) help, but the dashboard's `DataCompletenessBanner.tsx` could use a tooltip update to clarify the meaning.

---

## Deferred work — what to pick up next

### Operational follow-ups

- [x] ~~Smoke-test skill end-to-end~~ Done 2026-04-29 via Claude Code on staging.
- [x] ~~Set `PILLAR_TOKEN_SECRET` in prod env~~ Done. Lives at `/home/seo/webapps/seo-tools/.env`.
- [x] ~~Verify migrations apply cleanly~~ Done — all 4 pillar migrations applied on prod deploy.
- [x] ~~RAM check~~ Done — ~225MB steady-state.
- [x] ~~Postinstall pre-warm~~ Done — completes in 0.6s.
- [ ] **Build + distribute the skill ZIP to the team.** `npm run build:skill` → ship `dist/skills/pillar-analysis-narrative-1.0.1.zip`. README has install instructions.
- [ ] **(Optional) Anthropic egress allowlist.** If the team wants analysts to use Claude Desktop / web instead of Claude Code, an Anthropic org admin needs to add `seo.erstaging.site` and `seo.enrollmentresources.com` to the workspace's bash sandbox allowlist.

### Phase 3+ — Refinements driven by accumulated use

These are nice-to-haves identified during smoke testing and reviews. Triage when they become real friction:

- **Cluster merge/split UI on the dashboard.** Right now if the analyst sees a borderline cluster, their only recourse is to tune the threshold globally. Per-analysis manual override would help.
- **Per-client page-type override table.** URL-slug heuristics break on clients with weird IA. Currently the override is editable directly on the `Client` Prisma row JSON; a UI would make this self-serve.
- **Subscore weight surface in JSON config** — currently in `lib/services/pillarAnalysis/config.ts`. Per-client overrides are already supported via `mergeConfig`; surfacing in a UI is the gap.
- **Memo regeneration UX** — explicit "regenerate" button on the dashboard, possibly with a "what would you like to change?" textarea that adds context to the next prompt.
- **Real client memo examples** in the skill template, replacing the synthetic ones once we have a few real analyses through the skill.
- **Narrative diffing / version history** — store all narrative versions, show diffs between regenerations.
- **MCP server fallback** for users on Claude tiers without Python sandbox. Skill spec §14 risk #2.
- **Cross-environment writeback safety** — defensive same-origin check on the PATCH endpoint. Spec 2.1 §6 + 2.2 §14.5. Not actionable until ER actually has multi-environment deployment.

### Code cleanup (low-priority hygiene)

- [ ] Delete `lib/services/pillarAnalysis/cluster.ts`, `verticality.ts`, `topicNaming.ts` if they're confirmed unused (they were replaced by anchor-based clustering; tests still pass but they're not in the orchestrator path).
- [ ] Update the open PR description to reflect Phase 2.1 + 2.2 (currently it only describes Phase 1).
- [ ] Consider squashing some of the 70 commits before merge (or leave the commit history; reviewer's call).

---

## Key conventions / gotchas

### When the verdict logic skips a page

A page's verdict is `excluded` (renamed from `unclear` mid-development; rename happened in commit `94f105f`) when its pageType isn't `blog`/`news`/`resource`. The dashboard's URL Verdicts table defaults to "Actionable only" filter to hide these. Switch to "All verdicts" or "excluded" to inspect them.

### Subscore presence vs subscore value

Two separate columns in the response:
- `subscores: { contentVolume: 0, ... }` — the numeric value, even when computed via fallback.
- `subscorePresence: { contentVolume: true, ... }` — whether the subscore could be meaningfully computed.

The dashboard renders **N/A** when presence is `false`, regardless of the underlying value. This is what prevents the "5 · Moderate" rendering bug for sites with no informational pages but uploaded data.

### The prompt format contract

Defined in `docs/pillar-prompt-contract.md`. Both `lib/pillar-prompt.ts` and `skills/pillar-analysis-narrative/SKILL.md` have to stay in sync. The regression test at `lib/pillar-prompt.test.ts` catches composer/parser drift but NOT documentation drift — manual PR review is the safeguard.

### Cleanup is the pillar route's responsibility

The seo-parser route used to delete the upload directory after parsing completed. We moved it: now the pillar-analysis route deletes the upload dir in its `finally` block AFTER reading the files. The race condition pattern (parse fires async pillar trigger, then immediately deletes files before pillar can read them) was a real Phase 1 bug — fixed in commit `95dadcb`.

### Build script reads `version.txt`, not SKILL.md frontmatter

`scripts/build-skill.sh` extracts the skill version from `skills/pillar-analysis-narrative/version.txt` (single-line file). Earlier draft used `awk` on YAML frontmatter — too brittle. Bump `version.txt` manually before building a new skill ZIP.

### `dist/` is gitignored

The build script outputs to `dist/skills/` which is ignored by git. Don't commit ZIPs.

### Dev fallback for `PILLAR_TOKEN_SECRET`

`lib/pillar-token.ts` falls back to `'dev-pillar-token-secret-do-not-use-in-prod'` when `NODE_ENV !== 'production'` and the env var is unset. Logs a one-time warning. **Never** use this in production — `instrumentation.ts` enforces this with a startup-time fail-loud check.

---

## How to resume work in a new session

The shortest path to ramp up:

1. **Read this doc.**
2. **Skim the Phase 1 spec** (`docs/superpowers/specs/2026-04-28-pillar-analysis-design.md`) for the architectural mental model.
3. **Skim the most recent commit log** (`git log --oneline 604aedd..HEAD`) for what shipped.
4. **Run baseline tests** (`npm test`) to confirm the env is sane → expect 922 passing.
5. **Run baseline lint/types** (`npx tsc --noEmit`) → expect clean.
6. **Pick the next item from "Pre-merge checklist" or "Phase 2.3"** above.
7. **For any non-trivial work, follow the brainstorm → spec → plan → implementer/reviewer pattern** that produced everything in this branch. The pattern is:
   - `superpowers:brainstorming` to nail down the design (lightweight if the design is mostly clear)
   - Save spec to `docs/superpowers/specs/`
   - `superpowers:writing-plans` to produce the implementation plan
   - `superpowers:subagent-driven-development` to execute the plan via dispatched subagents

If you're picking up Phase 2.3 specifically: the Phase 1 spec (§11–13) and Phase 2.2 spec (§15–16) both reference it. The skill artifact already writes `aiNarrative` to the row; Phase 2.3 is "render that on the dashboard."

---

## Reading list (in priority order)

1. **This document.** Status + orientation.
2. **`docs/superpowers/specs/2026-04-28-pillar-analysis-design.md`.** Phase 1 architectural design — the mental model.
3. **`docs/screaming-frog-setup.md`.** How analysts produce the input data.
4. **`docs/pillar-prompt-contract.md`.** The locked clipboard format.
5. **The smoke-test learnings sections in the Phase 1 plan** — explains why several decisions changed mid-implementation (free clustering → anchor-based, presence semantics revisions, viability gate, etc.).
6. **`skills/pillar-analysis-narrative/SKILL.md` + `templates/memo_structure.md`.** What the skill actually does.

---

## Contact

Original author: Kevin Vogelgesang (kevin@enrollmentresources.com).
Built collaboratively with Claude over ~2 days (2026-04-28 to 2026-04-29).
