# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-09 (C14 prospect sales audit view SHIPPED — PR #140 merged + deployed + prod-verified at the infra + security-boundary + schema level. This CLOSES the C15→C16→C17→C18→C14 audit arc. No single pre-decided next item — pick from the roadmap menu below.) · **Updated by:** the C14 implementation session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action (or, now, the menu when no item is pre-decided).

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. NO single item is pre-decided right now — the
C15→C16→C17→C18→C14 audit arc is COMPLETE (all shipped + deployed). Pick the next item from the
roadmap menu (present it to Kevin, one line each, and let him choose — or take the top of the menu
if he's hands-off):
  • C13 — Bellus "0 rules passed" scorecard investigation (small; the only thing left in C13).
  • A8 per-tool visual-polish arc (parked [~], open-ended) — another per-tool pass
    (/clients messier ≥90/≥70 score bands · /robots-validator · /quarter-grid non-Tailwind) OR mark A8 [x].
  • C12 — Content auditing (data correctness · keyword cannibalization · content decay) — larger, needs a spec.
  • SF-retirement — hybrid-discovery Increment 2 is BUILT; run live-vs-SF parity cycles 2–3 (needs real seoIntent audits).
  • Track A infra — A5 (shared status hook → SSE), A6 (shared UI primitives in components/ui/ + data-driven nav), A7 (auth hardening + per-worker test DBs + Playwright smoke).
  • Track D — workflow polish.
Authoritative per-item status + full history: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
(status log is newest-first; the top two 2026-07-09 entries are C14 then C18).

⚠ DEPLOY RECIPE CHANGED until the build-OOM gated decision is resolved (tracker → Gated
decisions): `~/deploy.sh` alone OOMs at next build while the app is running (2026-07-09 incident
left a partial .next landmine). Deploy with:
  git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID exists and run the post-deploy checklist (health, boot log, schedules).
(C14 deployed cleanly this way 2026-07-09 — recipe confirmed working.)

Kevin eyeballs outstanding (accumulating, all authed-UI): fresh audit under "Mine" (C15), merged
Audits page + recents badges/filters (C16), one real seoOnly scan auto-flipping to results (C17),
C18 results page (score rings, Accessibility|SEO tabs + ?resultTab= sync, triage in the
Pages-with-Issues header, expandable pattern cards, collapsed Known limitations, share view tabs),
and C14 — /sales intake + a real /sales/[token] report. The FIRST REAL prospect scan is
Kevin-initiated (owner-sanctioned). No-scan visual path for C14:
  DATABASE_URL="file:./local-dev.db" npx tsx scripts/dev-seed-prospect.ts
then open the printed http://localhost:3000/sales/<token> (and /sales when logged in).

STANDING GATE (decided 2026-07-08): NO AI API — Kevin ruled there are no plans to use any AI API
(Anthropic or any LLM provider). Never propose or build AI-API features. All AI stays the
pat_/srt_/krt_/qct_ skill-handoff clipboard flow. Only Kevin reopens this (tracker → Gated
decisions).

FIRST STEP — confirm main is clean and prod is healthy (git log origin/main; then
ssh seo@144.126.213.242 "curl -s localhost:3000/api/health"). No deploy needed unless you ship.

Read first: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (status log newest
first) and CLAUDE.md (architecture patterns — C14 prospect sales view, C16 seoOnly routing, C17
poller semantics, C18 results shell).

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
Tailwind classes reachable by the content globs. Test gotchas (C17/C18/C14): waitFor hangs under
vitest fake timers (use act() + direct asserts); mocked routers must be ONE stable object;
getByText/getByRole THROW on multiple matches — use getAllBy* (or an exact-string name) when the
copy legitimately appears in more than one node. Next.js App Router route files may export ONLY
HTTP handlers + route config — any other named export fails `next build` (tsc+vitest stay green),
so put shared helpers in a lib module, not the route file.
```

## Current state (2026-07-09)

- **C14 — SHIPPED 2026-07-09 (PR #140, main `79828c3`, deployed + prod-verified at the
  infra + security-boundary + schema level; first REAL prospect scan + authed-UI eyeball
  pending Kevin).** `/sales` cookie-gated intake (`ProspectDashboard` — form + prospect
  list + 8s smart polling) creates a `Prospect` + a FULL prospect-domain site audit;
  stable token-gated PUBLIC `/sales/[token]` report (server components: hero tiles +
  Accessibility/SEO/Performance-Lighthouse/GEO-schema progressive-disclosure sections +
  CTA; curated real screenshots). Safety boundary = server-side curation: the token
  authorizes ONLY what `loadSalesReportData` chose; the screenshot route enforces
  ownership chain AND curated-set membership via the SAME `topPatternIssues` selection as
  the report (allowlist ⊆ render), pinning the child-audit id so open reports survive a
  re-scan; anchored single-segment regex middleware matchers keep the intake + prospect
  APIs gated; honest labeling (no WCAG-compliant/CWV-pass claims). New `Prospect` model,
  `SiteAudit.prospectId` (SetNull), `CrawlRun.schemaTypesJson`; additive migration
  `20260709120000_prospect_sales_view`. Prospect audits are manual-class + carry a
  "Prospect" recents badge (not a new RecentType). Built subagent-driven (13 tasks, every
  per-task review Approved; final Opus whole-branch review READY-TO-MERGE YES, 0
  Critical/Important). Two gate-caught bugs fixed on-branch (a T2 exact-match test
  regression; a `next build`-only non-handler-export failure). Gates: tsc · 3892 tests /
  450 files · build; loader verified end-to-end on seeded synthetic rows. Spec/plan
  archived (`../archive/specs/2026-07-09-prospect-sales-audit-view-design.md` +
  `../archive/plans/2026-07-09-c14-prospect-sales-audit-view.md`).
- **⚠ Deploy build-OOM incident (2026-07-09, still an OPEN Gated decision).** `~/deploy.sh`
  alone OOMs at `next build` with the live app running on the 3.9 GB box. Interim recipe
  (used for both C18 and C14, confirmed working): `pm2 stop seo-tools && ~/deploy.sh` then
  verify `.next/BUILD_ID`. Kevin must pick the durable fix: deploy.sh stops the app before
  building (server-owned edit), or disable the redundant server-side type-check in
  `next.config.ts`.
- **Audit arc C15 ✅ → C16 ✅ → C17 ✅ → C18 ✅ → C14 ✅ — COMPLETE.** No single
  pre-decided next item — see the paste-prompt menu above.
- **C13** now holds ONLY the Bellus "0 rules passed" scorecard investigation.
- **A8 per-tool visual polish arc — parked `[~]`, open-ended.** Shipped passes: PR 4
  seo-parser #120, PR 5 ada-audit #130, PR 6 /reports #134.
- **D7 scan-completion email — FULLY COMPLETE** (base #132 + enrichment #133); real-send
  smoke is Kevin's (recipient comes from his session).
- **STANDING GATE (2026-07-08): NO AI API.** All AI stays the skill-handoff clipboard flow.
- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12): unchanged — see
  the tracker for authoritative per-item status + the full status log.
