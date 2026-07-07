# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-07 (**A8 PR 1 — left-sidebar app shell SHIPPED + DEPLOYED + PROD-VERIFIED. Next action = write + execute the A8 PR 2 plan (fixed-layout quick-start dashboard).**) · **Updated by:** the A8 PR 1 execution session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: A8 PR 2 — the fixed-layout quick-start dashboard.

State: A8 PR 1 (left-sidebar app shell) SHIPPED + DEPLOYED + PROD-VERIFIED 2026-07-07
(PR #112, main f48c98d). The shell is live: (app)/(public) route-group split, tools
registry (lib/tools-registry.ts), components/shell/{SidebarNav,Topbar,AppShell}, old
components/nav.tsx deleted, hydration-safe CSS-driven collapse. The homepage is still the
OLD brochure content, now rendered INSIDE the shell at app/(app)/page.tsx (body untouched
by PR 1 — PR 2 replaces it). Spec (covers all A8 PRs, stays active through PR 4):
docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md (Codex ACCEPT-WITH-FIXES
x9, applied). PR 1 plan is archived at docs/superpowers/archive/plans/. There is NO PR 2
plan yet — writing it is the first step.

PR 2 = Dashboard v1, FIXED layout (spec §8 PR 2 + §3.3 + §4 + §5): a widget registry +
CSS-grid dashboard rendering the verified-data-source widget set at default sizes, and
DELETE the old homepage content. NO edit mode, NO drag, NO layout persistence (that's
PR 3), NO aggregate widgets (KPI strip + Needs-attention are DEFERRED to PR 3.5 — their
B1/B2 loaders must be verified/built first; do NOT build them in PR 2).

1. Load the skill er-seo-tools-change-control first. Gate policy (2026-07-03 ruling,
   rules 1 & 4): THIS PASTED PROMPT is standing authorization to merge pending roadmap
   PRs at session start (re-run gates lint/test/build on the branch this session first)
   and to deploy when needed, ALWAYS followed immediately by post-deploy verification.
   Destructive server ops stay Kevin-gated; docs rituals mandatory; never scan
   non-client sites. Brainstorm->spec->plan runs ungated (route design questions to
   Codex, not Kevin; notify Kevin one line per artifact, don't wait).
2. Read the spec (§3.3 widget system, §4 quick-start→live-flow routing, §5 shared
   primitives, §8 phasing). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff. VERIFY every widget data source exists in the code before using it
   (Codex fix 4/9 — this is why aggregates are deferred).
3. Write the PR 2 plan: docs/superpowers/plans/2026-07-07-app-shell-pr2.md, per-task TDD.
   Notify Kevin (one line + path), route to Codex review, apply named fixes in place,
   then execute (superpowers:subagent-driven-development, worktree per house style).
4. Gates: npx tsc --noEmit + npx vitest run + npm run build (UI-class change: dark-mode
   variants on every element; no hydration-mismatch patterns). Then PR -> merge ->
   plain ~/deploy.sh (no migration expected) -> post-deploy verify (homepage renders the
   dashboard inside the shell; each quick-start lands in the live flow).
5. Docs ritual: tracker checkbox/status-log + rewrite this handoff (next item = A8 PR 3
   widget editor) in the same commit as the ship.
```

## Current state (2026-07-07)

- **A8 (active, [~]) — PR 1 DONE:** shell shipped + deployed + prod-verified. Delivered:
  `lib/tools-registry.ts` (single nav source, absorbs A6) + `components/shell/icons.tsx`
  (hand-inlined SVG, no icon lib); `components/shell/` = SidebarNav (collapsible
  248↔68px, active orange notch, "Primary" nav landmark), Topbar (route title,
  ThemeToggle, plain form-POST logout, mobile hamburger), AppShell (desktop rail +
  mobile drawer + Escape/desktop auto-close + collapse persistence); `(app)`/`(public)`
  route groups; slimmed `app/layout.tsx` (providers + combined anti-FOUC theme+sidebar
  script + skip link); `app/route-groups.test.ts` drift test; hidden `admin` registry
  entry. Homepage content UNTOUCHED (lives at `app/(app)/page.tsx`, brochure body intact).
- **A8 next — PR 2 (fixed dashboard):** replace the brochure homepage with a widget grid.
  Verified-source widgets only (spec §3.3 table, PR-2 column): Quick-start Site Audit /
  SEO Parser / Performance Report / Robots Validator, plus Live-now, Recent-parses,
  Quarter-Grid-this-week. Aggregate widgets (KPI strip, Needs-attention) DEFERRED to PR 3.5.
  Edit mode + drag + persistence are PR 3.
- **SF-retirement validation:** parity cycles recorded; content-similarity near-dup parity
  at 5 clients (Crawl-Analysis re-crawls) — high-precision on primary content,
  archive/pagination-blind, measurement-only reinforced. No open WIP (optional: re-crawl
  brownson as 6th; brockway dropped). See docs/superpowers/todos/2026-07-05-sf-live-parity-log.md.
- **Remaining roadmap after A8:** A5 (SSE), A7 (auth/test hardening), C6 analytics
  integrations (partly billing-gated), D1–D6. See tracker.

## Gotchas for the next session (A8 PR 2)

- **Verify data sources before wiring a widget** (Codex fix 4/9). Exact quick-start
  targets, already spec-verified against `app/` (spec §4): Site audit → POST
  `/api/site-audit` → `{id}` → redirect `/ada-audit/site/[id]` (SiteAuditPoller); SF parse
  → existing `/api/upload` session flow → `/seo-parser/results/[sessionId]`; Report → POST
  `/api/reports` with the FULL required body (client, period, `comparisonMode` — widget
  supplies defaults) → `/reports` (highlight new row); Robots → client-side redirect to
  `/robots-validator?url=…` — this page needs a SMALL new param-read + auto-run-on-mount
  (the one piece of NEW page behavior in PR 2). Live-now = `/api/site-audit/queue` (5s
  poll); Recent parses = `/api/parse/history`; Quarter Grid this week = `/api/quarter-plan`.
- **Do NOT build KPI strip / Needs-attention in PR 2** — their B1/B2 fleet loaders don't
  exist yet; they are PR 3.5 behind a loader-verification task.
- **Widgets fault-isolated** like `loadOpsSnapshot` — a failed fetch renders a degraded
  card, never blanks the dashboard. Multiple widgets polling the same endpoint should
  share ONE module-level fetcher/interval (don't multiply queue-poll load); cadence stays
  at existing rates.
- **Extract `components/ui/` primitives as needed, not speculatively** (spec §5):
  StatusPill, ScoreRing (SVG), Card, KpiTile, DropZone, CopyButton, HistoryTable — first
  time the dashboard needs one.
- The shell is already live and wraps every `(app)` page — PR 2 only replaces the
  `app/(app)/page.tsx` body; do not re-touch the shell.
- UI-class change: dark-mode `dark:` variants on every element; ThemeToggle's only
  consumer is the Topbar now.
