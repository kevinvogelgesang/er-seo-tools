# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (**C11 PR 2b — SEO-phase visibility + fine-grained progress — SHIPPED, DEPLOYED, PROD-VERIFIED** (PR #126, main `c457eb1`; migration `20260707120000_job_progress` auto-applied). PR 2a also shipped (PR #124, main `2d18ac9`). Next action = C11 **PR 3** — `/seo-parser`→`/seo-audits` rename + section maturation + live-scan results-banner polish, starting from brainstorming.) · **Updated by:** the C11 PR 2b execution session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: START C11 PR 3 — the FINAL PR of the C11 arc:
rename /seo-parser → /seo-audits + section maturation + live-scan results-view polish. C11 PR 1
(seoOnly scan mode), PR 2a (intent toggles/labels/error-state), and PR 2b (SEO-phase visibility +
fine-grained progress bar) are ALL SHIPPED, DEPLOYED, PROD-VERIFIED (PR #122 main 11fcaf6; PR #124
main 2d18ac9; PR #126 main c457eb1). PR 3 has NO spec/plan yet — begin with brainstorming, then
spec → Codex review → plan → Codex review → subagent-driven build (all ungated per change-control
rule 4; notify Kevin as each artifact lands, don't wait).

WHAT C11 PR 3 IS (tracker C11 scope item (h) + the maturation/polish carry-overs):
- (RENAME) `/seo-parser` → `/seo-audits`. This is the risky part — brainstorm the blast radius WITH
  Kevin before scoping: (1) the App-Router folder move `app/(app)/seo-parser/**` → `seo-audits/**`
  incl. `results/[sessionId]`, `results/run/[runId]`, `diff`; (2) a permanent redirect from the old
  paths (middleware or `next.config` redirects) so bookmarks + shipped share/handoff links survive;
  (3) nav labels + links (sidebar "SEO Parser" → "SEO Audits"); (4) the er-handoff-memo skill / srt_
  (and pat_/krt_/qct_) token flow embeds a "Webapp:" URL + the results page reads a clipboard payload
  — AUDIT every hard-coded /seo-parser URL in `skills/`, `lib/`, `components/`, and the token/export
  routes (grep `seo-parser` repo-wide). DECISION for the spec: keep `/seo-parser/*` as permanent
  redirects forever, or dual-serve for a window? Public share paths in `middleware.ts isPublicPath`
  must keep working.
- (MATURATION) make the SEO-audit surface structurally MIRROR the ADA-Audit section: a tabbed index
  (form + recents), form + queue banner + poller + history parity, results-page section blocks —
  so SEO audits feel like a first-class tool, not a CSV parser. Scope tightly WITH Kevin; this can
  balloon. Consider splitting maturation into its own PR if the rename alone is substantial.
- (POLISH) the live-scan results view at `/seo-parser/results/run/[runId]` renders the C6
  "Archived — rebuilt from findings data" fallback banner for EVERY live-scan run (there is no
  `Session.result` blob by design — it's a live scan, not an SF upload), which is misleading for a
  fresh scan. Fix the wording/branch so a live-scan run reads as a first-class result, not "archived".

When PR 3 ships, C11 flips to [x] (it is the last of the 3 PRs).

1. Load skill er-seo-tools-change-control first. Gate policy (rules 1 & 4): THIS PASTED PROMPT is
   standing authorization to merge the gate-green PR at session end (re-run lint/test/build this
   session first) and to deploy when needed, ALWAYS followed by post-deploy verify. Destructive
   server ops stay Kevin-gated; docs rituals mandatory; NEVER scan non-client sites (dev-test any
   scan ONLY against a client domain already in the system or a domain you control, e.g. an
   *.erstaging.site staging domain).
2. Trust ranking when docs disagree: code > plan/spec > tracker/handoff.
3. Brainstorm PR 3 scope with Kevin (rename-only vs rename+maturation in one PR; redirect strategy;
   how far the ADA-mirror maturation goes), then spec → Codex → plan → Codex → subagent-driven build.
   Use a fresh worktree off origin/main. LIKELY migration-free (rename + UI) — if any schema change
   creeps in, `prisma migrate dev` is interactive-only here: hand-author migration.sql +
   `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate`.
4. Gates before PR: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build.
   UI class: dark: on every element; no hydration mismatch. Verify redirects don't break the
   middleware auth gate (any new public path needs an isPublicPath entry + a middleware.test.ts case).
   Then PR → merge → ~/deploy.sh → post-deploy verify (authed Playwright, seo.erstaging.site: hit an
   OLD /seo-parser URL and confirm it redirects to /seo-audits; confirm a shipped share/handoff link
   still resolves; trigger/observe an SEO audit on the renamed surface for a client domain).
5. Docs ritual: tracker status-log + rewrite this handoff in the same commit as the ship. On ship,
   move spec + plan to docs/superpowers/archive/. Tick C11 [x] (PR 3 is the last of the 3). A8 stays
   [~] (paused mid per-tool polish — NEXT A8 pass is PR 5 = ada-audit visual polish; resume after C11
   unless Kevin redirects).

WORKTREE ENV NOTE (fresh worktree off origin/main has NO node_modules): run `npm install`
(~15s cache-warm), write a root `.env` (`DATABASE_URL=file:./local-dev.db`, `UPLOADS_DIR=./local-uploads`,
`NEXT_PUBLIC_APP_URL=http://localhost:3000`, `CHROME_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`),
then `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate` before trusting tsc.
```

## Current state (2026-07-08)

- **C11 (active, [ ]) — SEO Audits v1. PR 1 + PR 2a + PR 2b SHIPPED + PROD-VERIFIED; only PR 3 remains:**
  - **PR 1 (seoOnly render-only scan mode + URL scan form): DONE.** PR #122, main `11fcaf6`,
    prod-verified. Migration `20260707140000_seo_only`. `SiteAudit.seoOnly`; `renderOnly` runner
    (skips axe/screenshots/Lighthouse); finalizer skips ALL ADA output but keeps the live-scan
    builder; `liveScanRunId` on the detail route; `/seo-parser` URL scan form.
  - **PR 2a (intent toggles + labels + error-state): DONE.** PR #124, main `2d18ac9`, prod-verified.
    Migration-free. seoIntent/seoOnly toggles on `SiteAuditForm` + quick-widget + `ScheduledScansCard`;
    shared scan-intent helper + `IntentChip`; queue/history labeling; `SeoScanForm` terminal
    error-state; `scheduled-site-audit` forwards seoOnly (render-only SEO schedules). (Its tracker/
    handoff status-log entry was skipped that session; folded into the PR 2b log entry.)
  - **PR 2b (SEO-phase visibility + fine-grained progress): DONE.** PR #126, main `c457eb1`,
    prod-verified 2026-07-08. Migration `20260707120000_job_progress` (additive nullable
    `Job.progress`/`progressMessage`). Generic `ctx.reportProgress` flushed on the worker's fenced
    heartbeat (benefits every job type); `broken-link-verify` reports resolution progress →
    "Building SEO report…"; `classifySeoPhase`/`getLatestSeoVerifyJob`/`getSeoPhase`
    (`lib/ada-audit/seo-phase.ts`); `seoPhase` on `GET /api/site-audit/[id]`; ADA `SeoPhaseBanner`
    (server-probe, no poller) gating the six SEO sections when the live-scan run is absent;
    `SeoScanForm` progress bar + failed/unavailable terminals (kills the infinite "Building…" spin).
    Opus whole-branch review CLEAN (fencing airtight). Prod loop confirmed on `proway.erstaging.site`
    (running → building → results) + verify Job `progress:100` at completion + API `seoPhase:done`.
    Spec + plan → `archive/`.
  - **PR 3 (next, LAST): `/seo-parser`→`/seo-audits` rename + ADA-mirror section maturation +
    live-scan results-view fallback-banner polish.** No spec/plan — starts at brainstorming. See the
    paste-prompt above for the rename blast-radius checklist (folder move, permanent redirects,
    nav, the srt_/handoff "Webapp:" URL audit, share-path preservation) and the open scope decisions.
    When PR 3 ships, C11 → [x].

- **A8 (active, [~]) — PAUSED mid per-tool polish (Kevin pivoted to C11 on 2026-07-07).**
  Homepage/shell system COMPLETE through PR 3.5. Per-tool polish: PR 4 (seo-parser) SHIPPED
  (PR #120); the next A8 pass is **PR 5 = ada-audit visual polish** (VISUAL-ONLY; watch the public
  share views `/ada-audit/share`, `/ada-audit/site/share` which render OUTSIDE the shell — a shared
  component can't have its `min-h-screen`/bg wrapper stripped). Resume A8 PR 5 after C11 unless Kevin
  redirects. Tokens: navy #1c2d4a, orange #f5a623, navy-deep #0f1d30; opacity `bg-navy/[0.08]` not
  `/8`; "measure widths in Playwright" verify lesson applies. A8 stays [~]; mark [x] only when Kevin
  calls A8 done.

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports): unchanged — see the
  tracker (`2026-06-10-improvement-roadmap-tracker.md`) for authoritative per-item status
  and the full status log.
