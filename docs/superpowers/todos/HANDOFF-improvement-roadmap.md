# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (**C11 PR 1 — SEO-only scan mode + URL scan form — SHIPPED, DEPLOYED, and PROD-VERIFIED** (PR #122, main `11fcaf6`; migration `20260707140000_seo_only` auto-applied). Next action = C11 PR 2 — toggles + SEO-phase visibility + seoOnly error-state UI, starting from brainstorming.) · **Updated by:** the C11 PR 1 execution session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: START C11 PR 2 — SEO-scan toggles + SEO-phase
visibility. C11 PR 1 (seoOnly render-only scan mode + URL scan form) is SHIPPED, DEPLOYED, and
PROD-VERIFIED (PR #122, main 11fcaf6). PR 2 has NO spec/plan yet — begin with brainstorming, then
spec → Codex review → plan → Codex review → build (all ungated per change-control rule 4; notify
Kevin as each artifact lands, don't wait).

WHAT C11 PR 2 IS (from tracker C11, line ~452, scope items (a)–(e)):
- (a) seoIntent/seoOnly intent toggle on the manual `SiteAuditForm` + the A8 quick-site-audit
  widget (today only the new URL form on /seo-parser can trigger seoOnly; the main forms can't).
- (b) seoIntent/seoOnly toggle on `ScheduledScansCard` schedule creation (D1-style: ADA + SEO
  schedules coexist per domain). DECISION NEEDED in the spec: do seoIntent schedules flip to
  seoOnly? (PR 1 deliberately left `scheduled-site-audit.ts` full-pipeline — the 2nd `// FUTURE`
  breadcrumb is still untouched.)
- (c) label the scan intent (ADA vs SEO) in queue/history views (PR 1 threaded `seoOnly` into the
  queue payload + added minimal "SEO" labels/exclusions; PR 2 is the full labeling pass).
- (d) SEO-phase VISIBILITY: the post-terminal `broken-link-verify` phase is INVISIBLE — the audit
  shows `complete` while the verifier runs (~36s median / p90 55s, up to 15 min), and
  BrokenLinksSection/OnPageSeoSection render "not verified/analyzed" indistinguishably from "still
  running". v1 fix = probe the `broken-link-verify` job state in group `site-audit:<id>` and
  surface "SEO analysis queued/running/failed" on the results page + a history chip.
- (e) fine-grained SEO-phase progress bar (COMMITTED, Kevin 2026-07-07): the verify job knows its
  total (deduped check count, cap 2000) and can report checked-so-far; recommend a generic nullable
  `Job.progress` (0–100) + `progressMessage` on the attempt-fenced heartbeat (benefits the ops page
  for every job type) vs an ADA-style SiteAudit column — decide in spec.
- PLUS the PR 1 carry-over: `SeoScanForm` has NO terminal error/failed state — a failed/errored
  seoOnly audit or a permanently-failing verifier shows "SEO scan running…" forever. Add an error
  phase (treat `status==='error'/'cancelled'` as terminal, clear sessionStorage). This is PR 2's
  error-UI scope.

C11 PR 3 (LATER, not PR 2): rename `/seo-parser` → `/seo-audits` (redirects, nav, handoff "Webapp:"
URL audit) + section maturation to structurally MIRROR the ADA-Audit section (tabbed index, form +
queue banner + poller + history parity, results-page section blocks). Also polish the live-scan
results view: it currently renders the C6 "Archived — rebuilt from findings data" fallback banner
for EVERY live-scan run (no Session.result blob by design) — misleading wording for a fresh scan.

1. Load skill er-seo-tools-change-control first. Gate policy (rules 1 & 4): THIS PASTED PROMPT is
   standing authorization to merge the gate-green PR at session end (re-run lint/test/build this
   session first) and to deploy when needed, ALWAYS followed by post-deploy verify. Destructive
   server ops stay Kevin-gated; docs rituals mandatory; NEVER scan non-client sites (dev-test any
   scan ONLY against a client domain already in the system or a domain you control).
2. Trust ranking when docs disagree: code > plan/spec > tracker/handoff.
3. Brainstorm PR 2 scope with Kevin (which of (a)–(e) + the error-state land in PR 2 vs deferred),
   then spec → Codex → plan → Codex → subagent-driven build. Use a fresh worktree off origin/main.
   Migration note if any schema change (e.g. Job.progress): `prisma migrate dev` is interactive-only
   here — author migration.sql by hand + `DATABASE_URL="file:./local-dev.db" npx prisma migrate
   deploy && … prisma generate`.
4. Gates before PR: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build.
   UI class (toggles, progress, labels): dark: on every element; no hydration mismatch. Then PR →
   merge → ~/deploy.sh → post-deploy verify (authed Playwright: trigger an SEO scan via the NEW
   toggle, confirm the intent label + SEO-phase visibility render for a client domain).
5. Docs ritual: tracker status-log + rewrite this handoff in the same commit as the ship. On ship,
   move spec + plan to docs/superpowers/archive/. C11 stays [ ] until all 3 PRs land (tick PR 2 in
   the status log). A8 stays [~] (paused mid per-tool polish — NEXT A8 pass is PR 5 = ada-audit
   visual polish; resume after C11 unless Kevin redirects).
```

## Current state (2026-07-08)

- **C11 (active, [ ]) — SEO Audits v1. PR 1 SHIPPED + PROD-VERIFIED; PR 2 is next (not started):**
  - **PR 1 (seoOnly render-only scan mode + URL scan form): DONE.** PR #122, merged to main
    `11fcaf6`, deployed, prod-verified 2026-07-08 (see tracker Status log for the full evidence
    trail). Migration `20260707140000_seo_only` auto-applied. Spec + plan moved to `archive/`.
    Delivered: `SiteAudit.seoOnly` column (`seoOnly⇒seoIntent` at enqueue); `renderOnly`
    runner path (`kind:'rendered'`, skips axe/screenshots/BOTH Lighthouse); parent-authoritative
    seoOnly page job (no PDF/PSI); finalizer skips ALL ADA output but keeps the live-scan builder
    (**no `tool:'ada-audit'` run — verified: ADA exports 409 `no_findings_run`**); `liveScanRunId`
    on the detail route; the `/seo-parser` URL scan form + pending→ready card; ADA-surface guards;
    zero-harvest seoOnly recovery. Prod loop confirmed end-to-end on `manhattanschool.edu`.
  - **PR 2 (next): toggles + labels + SEO-phase visibility + progress + seoOnly error-UI.** No
    spec/plan yet — starts at brainstorming. Scope (a)–(e) in tracker C11 + the PR1 error-state
    carry-over. See the paste-prompt above for the full breakdown and the open spec decisions
    (schedule seoOnly flip? `Job.progress` column vs SiteAudit column?).
  - **PR 3 (later): `/seo-parser`→`/seo-audits` rename + section maturation to mirror ADA-Audit**
    (tabbed index, form+queue+poller+history parity) + live-scan results-view fallback-banner polish.
  - Known minors logged for cleanup (non-blocking): recovery `seoOnlyComplete` query is
    unbounded-but-negligible (`NOT:{crawlRuns:{some:{tool:'seo-parser'}}}` one-liner); the unused
    `finalUrl?`/`redirected?` optional fields on the `kind:'rendered'` result variant.

- **A8 (active, [~]) — PAUSED mid per-tool polish (Kevin pivoted to C11 on 2026-07-07).**
  Homepage/shell system COMPLETE through PR 3.5. Per-tool polish: **PR 4 (seo-parser) SHIPPED +
  PROD-VERIFIED (PR #120)**; the next A8 pass is **PR 5 = ada-audit visual polish** (VISUAL-ONLY;
  watch the public share views `/ada-audit/share`, `/ada-audit/site/share` which render OUTSIDE the
  shell — a shared component can't have its min-h-screen/bg wrapper stripped). Resume A8 PR 5 after
  C11 unless Kevin redirects. PR-4 recipe + tokens (navy #1c2d4a, orange #f5a623, navy-deep #0f1d30;
  opacity `bg-navy/[0.08]` not `/8`) and the "measure widths in Playwright" verify lesson still apply.
  A8 stays [~]; mark [x] only when Kevin calls A8 done.

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports): unchanged — see the
  tracker (`2026-06-10-improvement-roadmap-tracker.md`) for authoritative per-item status
  and the full status log.
