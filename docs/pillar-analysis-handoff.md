# Pillar Analysis — Project Handoff

**Last updated:** 2026-04-29
**Branch:** `feature/pillar-analysis-phase-1` (HEAD: `4727fb4`)
**Open PR:** [#2 — Pillar Analysis Phase 1](https://github.com/kevinvogelgesang/er-seo-tools/pull/2)
**70 commits** on the branch. **922 vitest tests passing.** TS clean.

---

## TL;DR

Internal pillar-analysis tool for er-seo-tools. Given a Screaming Frog crawl already imported into `/seo-parser`, it produces a 1–10 site fit score, a hub-format recommendation, and per-URL verdicts (`pillar` / `cluster` / `leave-as-blog` / `consolidate` / `prune` / `excluded`). Surfaced at `/pillar-analysis/[id]` and reachable from a "Pillar Analysis →" button on the seo-parser results page. **Phase 1 (deterministic backbone) and Phase 2.1 (clipboard prompt UX) and Phase 2.2 (skill artifact + narrative writeback) are all implemented and on the branch, but only Phase 1 has been smoke-tested end-to-end on real client data.** Phase 2.3 (dashboard rendering of the narrative memo, plus full end-to-end smoke testing of the skill) is the open work.

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

### Phase 2.1 — Clipboard prompt UX — **SHIPPED, locally smoke-tested**

**What's in:** `POST /api/pillar-analysis/[id]/mint-token` (1h JWT, HS256). "Copy Claude Prompt" button on the dashboard. Clipboard fallback modal for browsers without `navigator.clipboard.writeText` (auto-select textarea + execCommand). Production fail-fast on missing `PILLAR_TOKEN_SECRET`.

**Tested:** Mint endpoint via curl. Button click → token in clipboard → JWT decodable on jwt.io with correct `iss`/`aud`/`sub`/`exp`. Disabled state on incomplete analyses works. Dev server flow works.

**Not tested:** Production HTTPS env behavior. Windows Claude Desktop installation parity.

### Phase 2.2 — Skill artifact + narrative writeback — **SHIPPED, NOT YET TESTED END-TO-END**

**What's in:**
- `PATCH /api/pillar-analysis/[id]/narrative` with structured error codes (auth_missing, auth_malformed, token_expired, token_invalid_signature, token_wrong_analysis_id, token_missing_scope, narrative_required, narrative_too_long, not_found, token_service_unavailable). 9 route tests.
- `GET /api/pillar-analysis/[id]` tightened to require Bearer + `read` scope. 3 route tests.
- `skills/pillar-analysis-narrative/` folder with SKILL.md (132 lines), version.txt, README.md, two reference Python scripts (fetch_analysis.py, post_narrative.py with structured error handling), `templates/memo_structure.md` (strict 6-section schema + 2 synthetic full-length example memos).
- `npm run build:skill` packages the folder into `dist/skills/pillar-analysis-narrative-1.0.0.zip` (7 files including the build-time-copied SF setup doc).

**Tested:** All API routes via vitest. Build produces a valid ZIP. ZIP contents verified manually.

**NOT tested:** Skill installation in real Claude Desktop. End-to-end flow (paste prompt → skill activates → fetches → generates memo → PATCHes back). The cloud-sandbox attempt failed because the cloud session can't reach localhost (expected — needs a tunnel or production deploy).

---

## Known issues / limitations

1. **Phase 2.2 hasn't been validated end-to-end.** A trial run from Anthropic's cloud sandbox correctly identified that it couldn't reach the developer's localhost — and refused to fabricate a memo (correct behavior baked into SKILL.md). To smoke-test, either (a) tunnel the dev server via cloudflared/ngrok and re-mint a token, (b) use Claude Code on the developer's machine where bash can reach localhost, or (c) wait until production deploy.

2. **Token expiration UX friction.** 1h JWT expiry. If the analyst pauses (lunch, meeting) and resumes the chat to revise the memo, the skill returns `token_expired` and they have to copy a fresh prompt. Acceptable V1; flagged in spec §14.6 with mitigation paths.

3. **Memo regeneration is implicit.** SKILL.md instructs Claude to re-PATCH on every revision (the "narrative-staleness rule"). Whether Claude reliably follows this in practice hasn't been observed; should be checked during the eventual end-to-end smoke test.

4. **Dead code from the redesign:** `lib/services/pillarAnalysis/cluster.ts`, `verticality.ts`, `topicNaming.ts` are no longer in the orchestrator's path (replaced by `anchorClustering.ts` + direct anchor naming in the orchestrator). Their tests still pass; they're harmless. Could be deleted in a cleanup commit if desired.

5. **Embedding fallback for sites with no `<main>` landmark.** The Phase 1 spec recommended a SF custom XPath for first-paragraph extraction. Sites where the XPath doesn't match still produce useful clustering from title + H1 + meta description, but cluster quality drops. SF setup doc recommends fallback XPaths.

6. **`prisma migrate dev` can fail when the dev server holds the SQLite lock.** Workaround: stop the dev server, run the migration, restart. The most recent migration (`add_subscore_context`) was applied manually via `sqlite3` because of this; the migration file is correct and will apply normally on production deploy.

7. **Windows parity for Claude Desktop skills** is unverified. The SF setup doc + skill ZIP install assume macOS/Linux paths; Windows analysts may hit friction.

8. **dataCompleteness percentage on the dashboard** can be misleading on small sites — users may interpret "17%" as "data is missing" when it actually means "1 of 6 subscores is meaningfully computable for this site." The semantic-label updates (per-subscore labels) help, but the dashboard's `DataCompletenessBanner.tsx` could use a tooltip update to clarify the meaning.

---

## Deferred work — what to pick up next

### Pre-merge checklist (gate before shipping Phase 1 + 2.1 + 2.2 to production)

- [ ] **Smoke-test the skill end-to-end** in real Claude Desktop. Either tunnel localhost (cloudflared/ngrok) and run with the dev DB, OR deploy a staging environment and run against that.
- [ ] **Verify the migration applies cleanly** on a fresh deploy — `npx prisma migrate deploy` should produce `Database schema is up to date!` after running through all migrations including `add_subscore_context`.
- [ ] **Set `PILLAR_TOKEN_SECRET`** in the production env (`/home/seo/.env` on RunCloud). Generate via `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. The `instrumentation.ts` startup check will fail-loud if it's missing.
- [ ] **RAM check on RunCloud** after first deploy. MiniLM should add ~150MB resident on first analysis.
- [ ] **Confirm `postinstall` model pre-warm** runs in the deploy environment. Logs should show `Pre-warm complete in {N}s`.
- [ ] **Build + distribute the skill ZIP** to the team. `npm run build:skill` → upload `dist/skills/pillar-analysis-narrative-1.0.0.zip` to a shared location, update the README's install instructions if the path differs.

### Phase 2.3 — Dashboard rendering of the narrative (NOT YET DESIGNED)

The PATCH endpoint stores the memo on `aiNarrative`. The dashboard currently doesn't render it — analysts have to query the GET endpoint or DB directly. Phase 2.3 should:

- Add a "Strategic memo" section to the dashboard between the score area and the pillar-topics list.
- Render markdown (the memo is markdown — needs a renderer like `react-markdown` or similar).
- Show "Last updated: N minutes ago" with the `narrativeUpdatedAt` timestamp.
- Add a "Regenerate via Claude" affordance — probably just a copy-prompt button that explicitly says "regenerate" and refreshes the token. (Different from the existing Copy Claude Prompt? Or the same? Brainstorm question.)
- Handle the case where `aiNarrative` is null (memo hasn't been generated yet) — show a hint to use the Copy Claude Prompt button.

This is its own brainstorm-spec-plan-implement cycle. Estimated effort: 1 spec, 1 plan, ~4–6 implementation tasks. Lighter than 2.1 or 2.2 because no new backend or skill work — pure dashboard UI.

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
