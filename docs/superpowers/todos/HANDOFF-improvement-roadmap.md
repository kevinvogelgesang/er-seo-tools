# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-09 (C18 recovery session: C18 results-page reorganization SHIPPED — PR #139 merged + deployed + prod-verified (infra) after a build-OOM incident on the server (recovered stop-app-then-build; durable fix flagged as a new Gated decision). Audit-consolidation batch C15–C18 COMPLETE; plan + umbrella spec archived. Next item: **C14** (prospect sales audit view — spec+plan already written and Codex-reviewed; go straight to implementation).) · **Updated by:** the C18 deploy-recovery session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. The next item is PRE-DECIDED (Kevin, 2026-07-08):
**C14 — prospect sales audit view** (client-facing pruned Site Audit results for sales meetings).
The audit-consolidation batch is COMPLETE (C15 #136, C16 #137, C17 #138, C18 #139 all SHIPPED).

C14 is ALREADY SPECCED AND PLANNED — do NOT re-brainstorm or re-plan. Read, then execute:
1. docs/superpowers/specs/2026-07-09-prospect-sales-audit-view-design.md (Codex-reviewed)
2. docs/superpowers/plans/2026-07-09-c14-prospect-sales-audit-view.md (13 tasks, Codex
   plan-review fixes ×8 applied — curated screenshot set, Finding.severity, similarity shape,
   fixtures). Execute it task-by-task via superpowers:subagent-driven-development or
   superpowers:executing-plans, on a feature branch.
NOTE: a separate paused session authored those C14 docs and may hold uncommitted C14 doc edits
in ITS working tree — this repo's tree is clean; if Kevin resumes that session instead, defer.

C14 policy nuance (owner-sanctioned 2026-07-07): the FEATURE deliberately scans prospect
(non-client) domains — that's its business purpose. The "never scan third-party sites" rule
STILL APPLIES to dev/testing: test against client domains in the system or *.erstaging.site only.

⚠ DEPLOY RECIPE CHANGED until the build-OOM gated decision is resolved (tracker → Gated
decisions): `~/deploy.sh` alone OOMs at next build while the app is running (2026-07-09 incident
left a partial .next landmine). Deploy with:
  git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID exists and run the post-deploy checklist (health, boot log, schedules).

Kevin eyeballs outstanding (accumulating, all authed-UI): fresh audit under "Mine" (C15), merged
Audits page + recents badges/filters (C16), one real seoOnly scan auto-flipping to results (C17),
C18 results page — score rings, Accessibility|SEO tabs + ?resultTab= sync, triage in the
Pages-with-Issues header, expandable pattern cards, collapsed Known limitations, share view tabs.

STANDING GATE (decided 2026-07-08): NO AI API — Kevin ruled there are no plans to use any AI API
(Anthropic or any LLM provider). Never propose or build AI-API features. All AI stays the
pat_/srt_/krt_/qct_ skill-handoff clipboard flow. Only Kevin reopens this (tracker → Gated
decisions). Note for C14: the spec's E-E-A-T section is // FUTURE partly BECAUSE of this gate.

FIRST STEP — confirm main is clean and prod is healthy (git log origin/main; then
ssh seo@144.126.213.242 "curl -s localhost:3000/api/health"). No deploy needed unless you ship.

Read first: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (status log newest
first — the 2026-07-09 entry has the C18 ship + build-OOM incident details) and CLAUDE.md
(architecture patterns — C16 seoOnly routing, C17 poller semantics, C18 results shell).

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): THIS PASTED PROMPT is
standing authorization to merge gate-green roadmap PRs at session start (re-run lint/test/build on
the branch this session first) and to deploy when needed, ALWAYS followed by post-deploy verify.
Destructive server ops (.env/secrets edits, DB restore, rm) stay Kevin-gated. Brainstorm→spec→plan
runs ungated (route each artifact to Codex, notify Kevin one line + path, don't wait). Docs ritual
mandatory: tracker status-log + rewrite this handoff in the SAME commit as the ship, ending your
final reply with this paste-in prompt. Trust ranking when docs disagree: code > plan/spec >
tracker/handoff.

ENV NOTE (main checkout or fresh worktree): if node_modules/Prisma client are stale, run
`npm install` then `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma
generate` before trusting tsc. Prisma resolves relative SQLite URLs against prisma/ — the dev DB
file is prisma/local-dev.db, reached as DATABASE_URL="file:./local-dev.db". Gates: npx tsc
--noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build (vitest WITHOUT the
DATABASE_URL prefix fails DB-backed tests with "Error code 14"). Dev server without a login wall:
DATABASE_URL="file:./local-dev.db" NEXT_PUBLIC_APP_URL="http://localhost:3000"
APP_AUTH_PASSWORD="" npm run dev. UI class: dark: on every element, no hydration mismatch, new
Tailwind classes reachable by the content globs. Test gotchas from C17/C18: waitFor hangs under
vitest fake timers (use act() + direct asserts); mocked routers must be ONE stable object.
```

## Current state (2026-07-09)

- **C18 — SHIPPED 2026-07-09 (PR #139, main `97262a9`, deployed + prod-verified at the
  infra level; authed UI eyeball pending Kevin).** Shared header (scores, export bar,
  diff panel) extracted into `components/ada-audit/SiteAuditResultsShell.tsx` with
  Accessibility | SEO tabs (`?resultTab=` sync); share view mirrors the tabs with ALL
  SEO data server-loaded token-validated (zero cookie-gated fetches; screenshots/element
  dropdowns omitted); triage toggle lives in the Pages-with-Issues header; pattern cards
  expand via the bounded `GET /api/site-audit/[id]/pattern-sample` loader (never fans
  out; archived audits degrade to the capped no-image sample); Pages-with-Issues
  paginated at 25; KnownLimitations collapsed; triage `checkedBy` now SSO-aware
  (`getOperatorLabel` — the C15 leftover). Plan archived
  (`../archive/plans/2026-07-09-c18-results-page-reorganization.md`, Codex ×7); umbrella
  batch spec archived (`../archive/specs/2026-07-08-audit-consolidation-batch-design.md`).
- **⚠ Deploy build-OOM incident 2026-07-09 (recovered; durable fix = open Gated
  decision).** `~/deploy.sh` OOM'd at `next build` (type-check worker SIGKILL'd with the
  live app running on the 3.9 GB box), leaving `.next` partial while the old build served
  from memory. Recovery: `pm2 stop` → server-side `npm run build` → verify
  `.next/BUILD_ID` → `pm2 start`. **Interim deploy recipe:**
  `ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"`. Kevin must pick:
  deploy.sh stops the app before building (server-owned edit), or the redundant
  server-side type-check is disabled in `next.config.ts`.
- **Batch C15 ✅ → C16 ✅ → C17 ✅ → C18 ✅ — COMPLETE. Next: C14** (prospect sales
  audit view). Spec + 13-task plan already written and Codex-reviewed (rode in PR #139,
  authored by a separate paused session — check with Kevin if that session resumes).
  Sections: Accessibility READY, SEO READY, CWV needs presentation, GEO partial
  (schema-signal slice only), E-E-A-T `// FUTURE`. Prospect scanning is owner-sanctioned
  for the feature; dev-test scans stay client/erstaging-only.
- **C13** now holds ONLY the Bellus "0 rules passed" scorecard investigation.
- **A8 per-tool visual polish arc — parked `[~]`, open-ended**, resumes after C14.
  Shipped passes: PR 4 seo-parser #120, PR 5 ada-audit #130, PR 6 /reports #134.
- **D7 scan-completion email — FULLY COMPLETE** (base #132 + enrichment #133).
- **STANDING GATE (2026-07-08): NO AI API.** All AI stays the skill-handoff clipboard flow.
- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12): unchanged —
  see the tracker for authoritative per-item status + the full status log.
