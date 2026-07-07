# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-07 (**A8 app-shell redesign: direction picked, spec + PR 1 plan WRITTEN + CODEX-REVIEWED. Next action = EXECUTE the PR 1 plan.**) · **Updated by:** the A8 brainstorm/spec/plan session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: EXECUTE the A8 PR 1 plan.

State: A8 (app-shell + homepage redesign, absorbs A6) is fully designed and planned.
Kevin picked Direction A "Navy Command Deck" (dark navy left sidebar, white canvas,
orange accents) from two delivered mockups; decisions locked: incremental per-section
PRs, dark mode retained, Guides under a "Reference" nav group, mobile-first, and FULL
macOS-style homepage widgets (sizes + drag reorder + persisted layout) in later PRs.
Spec: docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md (Codex
ACCEPT-WITH-FIXES x9, all applied). PR 1 plan (the thing to execute now):
docs/superpowers/plans/2026-07-07-app-shell-pr1.md (Codex ACCEPT-WITH-FIXES x5, all
applied — incl. the hydration-safe CSS-driven initial collapse via
html[data-sidebar] arbitrary variant; do NOT regress that to React-state-only).
PR 1 = (app)/(public) route-group split + tools registry + sidebar shell + topbar
with form-POST logout + old nav deletion + sticky-offset fixes. 7 TDD tasks, ~+22
tests, no migration, no new deps. PR 2 (fixed dashboard) and PR 3 (widget editor)
follow from the spec after PR 1 ships.

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03 ruling,
   rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge pending roadmap
   PRs at session start (re-run gates lint/test/build on the branch this session first)
   and to deploy when needed, ALWAYS followed immediately by post-deploy verification.
   Destructive server ops stay Kevin-gated; docs rituals mandatory; never scan
   non-client sites. Brainstorm->spec->plan runs ungated (route design questions to
   Codex, not Kevin; notify Kevin one line per artifact, don't wait).
2. Read the PR 1 plan docs/superpowers/plans/2026-07-07-app-shell-pr1.md + spec
   docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md. Trust ranking when
   docs disagree: code > plan/spec > tracker/handoff.
3. Execute the plan with superpowers:subagent-driven-development (or executing-plans)
   on a feature branch (worktree per house style). UI-class change: every component
   needs dark-mode variants; watch the two intentional gotchas — (a) hydration: server
   HTML and first client render must be identical (collapse width is CSS-driven off
   the html[data-sidebar] stamp, React state syncs post-mount), (b) the (public)
   route group must track middleware isPublicPath (the plan's drift test pins it).
4. Gates: npx tsc --noEmit + npx vitest run + npm run build, then PR -> merge ->
   plain ~/deploy.sh (no migration) -> post-deploy verify (login page chrome-less,
   share URL chrome-less, app pages shelled, collapsed-reload no hydration warnings).
5. Do the docs ritual: tracker checkbox/status-log + rewrite this handoff (next item
   = A8 PR 2 dashboard) in the same commit as the ship.
```

## Current state (2026-07-07)

- **A8 (active, [~]):** spec + PR 1 plan done and Codex-reviewed; NO code built yet.
  Homepage mockups (direction A chosen) live in the session scratchpad — visual
  reference is the spec §1 + the mockup description; PR 2 rebuilds the homepage as a
  widget dashboard (verified-source widgets only; KPI/needs-attention deferred to
  PR 3.5), PR 3 adds the widget editor (sizes + drag + keyboard reorder +
  localStorage layout), PR 4+ per-tool polish.
- **SF-retirement validation:** 7-client parity cycles recorded; content-similarity
  behavioral prod-verify complete; content-similarity near-dup parity now **5 clients**
  (SF Crawl-Analysis re-crawls) — engine is high-precision on primary content,
  archive/pagination-blind, every deviation explained, measurement-only reinforced. See
  2026-07-07 sections of docs/superpowers/todos/2026-07-05-sf-live-parity-log.md. No open
  validation work-in-progress (optional: re-crawl brownson as the 6th; brockway dropped).
- **Remaining roadmap after A8:** A5 (SSE), A7 (auth/test hardening), C6 analytics
  integrations (partly billing-gated), D1–D6. See tracker.

## Gotchas for the next session

- The PR 1 plan's Task 5 hydration approach is deliberate (Codex-flagged): do not
  "simplify" it back to a useState initializer that reads the DOM — that mismatches.
- ThemeToggle gets restyled in Task 4 Step 3b because its only post-PR consumer is
  the new light topbar; if another consumer appears, use a className prop instead.
- ada-audit's share subtrees move to (public) with mkdir -p + git mv — URLs must not
  change (route groups are URL-invisible; the build route table is the check).
- keyword-research + pillar-analysis are hidden registry entries (titles only, no
  nav) — they were never in the old nav either.
