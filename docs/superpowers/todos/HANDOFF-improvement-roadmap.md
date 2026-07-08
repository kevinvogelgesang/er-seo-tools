# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (**C11 COMPLETE — PR 3 (`/seo-parser`→`/seo-audits` rename + section maturation + live-scan polish) SHIPPED + DEPLOYED + PROD-VERIFIED** (PR #128, main `b679038`; migration-free). C11 is now fully done (all 3 PRs). **Next action = A8 PR 5 — ada-audit visual polish**, the second per-tool polish pass, resuming the paused A8 arc.) · **Updated by:** the C11 PR 3 execution session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: A8 PR 5 — ada-audit visual polish (the
second per-tool polish pass, spec §8 PR 4+). C11 (SEO Audits v1) is now FULLY COMPLETE —
all 3 PRs shipped, deployed, prod-verified (PR #122/#124/#126/#128). A8 PRs 1–3.5 (shell,
dashboard, widget editor, aggregate widgets) AND PR 4 (seo-parser polish, #120) are all
SHIPPED + DEPLOYED + PROD-VERIFIED. Kevin chose seo-parser + ada-audit back-to-back for the
per-tool polish, so ada-audit is the pre-decided next section — do NOT re-ask which tool.

PR 4+ is the open-ended final A8 phase (spec §8 PR 4, §5): "one PR per tool section adopting
components/ui/ primitives + the deck visual language. Each independently shippable; adjust
per-section as Kevin reviews." VISUAL/primitive-adoption ONLY — DO NOT alter tool
behavior/data/API. Existing page tests must stay green (§7: the shell wraps pages, it doesn't
change them).

*** FIRST STEP for ada-audit: brainstorm→spec→plan for the ada-audit surface only, keep it
small + independently shippable. Scope it WITH Kevin (like PR 4 did for seo-parser): the
ada-audit surface is large — single-page + site-wide audit results, AuditPoller,
SiteAuditResultsView, exports, share views. Propose a tight slice (e.g. the results header +
score display via ScoreRing/StatusPill + wrapper reconciliation) rather than the whole
surface. WATCH: ada-audit has BOTH authed (app) pages AND public share views
(/ada-audit/share, /ada-audit/site/share) — public views render OUTSIDE the shell, so a
component shared between them CANNOT have its min-h-screen/bg wrapper stripped (PR 4 verified
seo-parser's ResultsView was authed-only before reconciling it — do the same ownership check
here; note ResultsView is now shared by the SEO results pages which ARE in-shell, and the
public /share/[token] view which is NOT). SiteAuditResultsView renders in shareMode; check its
importers. ***

PR-4/C11-proven recipe (reuse it): (a) hex→Tailwind-token swap is pixel-safe — tokens
navy=#1c2d4a, orange=#f5a623, navy-deep=#0f1d30, orange-dark=#d4881a (orange-dark≠the old
#e8971a hover, negligible shade shift, OK); opacity uses the arbitrary form bg-navy/[0.08]
(NOT /8 — invalid step). (b) The shell <main> (components/shell/AppShell.tsx) already supplies
bg-[#f4f6f9] dark:bg-navy-deep, so in-shell page roots should DROP their own min-h-screen bg-*
(keep py/px + max-w/mx-auto); centered fallbacks → min-h-[60vh]. NOTE the nested-<main> pattern
(page <main> inside shell <main>) is the established convention (ada-audit + seo-audits index
both do it) — mirror, don't "fix". (c) ScoreRing takes score:number|null, size; keep any != null
guard. (d) A test fixture for ScoreExplanation MUST be a JSON PersistedBreakdown string (it
only JSON.parses). (e) This repo has NO jest-dom — component tests use .getAttribute()/
.toBeTruthy()/queryByText(...)===null, never toBeInTheDocument/toHaveAttribute; jsdom tests
start with `// @vitest-environment jsdom`.

Design language + primitives: components/ui/ (StatusPill/ScoreRing/DropZone), navy/orange
+ Barlow (Tailwind config), dark: on every element. Reference: "Navy Command Deck" (Dir A).

1. Load skill er-seo-tools-change-control first. Gate policy (rules 1 & 4): THIS PASTED PROMPT
   is standing authorization to merge gate-green roadmap PRs at session start (re-run
   lint/test/build on the branch this session first) and to deploy when needed, ALWAYS
   followed by post-deploy verify. FOR UI PRs, post-deploy verify SHOULD drive the real authed
   tool page via Playwright and MEASURE layout (getComputedStyle / widths) — server-side health
   is NOT enough (A8 PR 2 shipped a purged-CSS size bug caught only by a real-browser width
   measure). Prod URL: https://seo.erstaging.site (authed — but login is Google OAuth ONLY,
   NOT headlessly automatable; the Playwright MCP session may NOT be authed, in which case
   authed-UI checks fall to Kevin — verify redirects/HTTP + public surfaces yourself, flag the
   authed spot-check for Kevin). Destructive server ops stay Kevin-gated; docs rituals
   mandatory; NEVER scan non-client sites (dev-test scans ONLY against a client domain in the
   system or an *.erstaging.site domain you control). Brainstorm→spec→plan runs ungated (route
   each artifact to Codex, notify Kevin one line + path, don't wait).
2. Trust ranking when docs disagree: code > plan/spec > tracker/handoff.
3. Fresh worktree off origin/main. WORKTREE ENV NOTE (no node_modules): run `npm install`
   (~15s cache-warm), write a root `.env` (`DATABASE_URL=file:./local-dev.db`,
   `UPLOADS_DIR=./local-uploads`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`,
   `CHROME_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`), then
   `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate` before
   trusting tsc. A8 PR 5 is almost certainly migration-free (visual only).
4. Gates before PR: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run
   build. UI class: dark: on every element; no hydration mismatch; existing page tests stay
   green. Then PR → merge (gate-green) → ~/deploy.sh → post-deploy verify.
5. Docs ritual: tracker status-log + rewrite this handoff in the same commit as the ship. On
   ship, move spec + plan to docs/superpowers/archive/. A8 stays [~] until Kevin calls the
   whole A8 arc done (per-tool polish is open-ended). Decide with Kevin whether ada-audit is
   the LAST per-tool pass or others follow.
```

## Current state (2026-07-08)

- **C11 — SEO Audits v1: COMPLETE ✅ ([x]).** All 3 PRs shipped + deployed + prod-verified.
  - PR 1 (seoOnly render-only scan mode + URL scan form): PR #122, main `11fcaf6`. Migration `20260707140000_seo_only`.
  - PR 2a (intent toggles + labels + error-state): PR #124, main `2d18ac9`. Migration-free.
  - PR 2b (SEO-phase visibility + fine-grained progress): PR #126, main `c457eb1`. Migration `20260707120000_job_progress`.
  - **PR 3 (rename + maturation + live-scan polish): PR #128, main `b679038`. Migration-free.**
    - **Rename** `/seo-parser`→`/seo-audits`: `git mv` route tree (history preserved); nav registry +
      footer label "SEO Parser"→"SEO Audits" (internal nav `id:'seo-parser'` KEPT); all product link
      hrefs incl. the 4 seoOnly behavioral routes (`seo-only-redirect.ts` +
      LiveNowWidget/QueueMemberRow/DashboardQueueStatus) and `SiteAuditForm`/`QuickSiteAuditWidget`
      `?scan=` handoffs; `er-handoff-memo` srt_ "Webapp:" line + README + CLAUDE tools-table.
    - **KEPT (deliberately NOT renamed):** persisted `tool:'seo-parser'` CrawlRun discriminator,
      `/api/parse/*` + `/api/seo-parser/*` API routes, `@/components/seo-parser` / `@/lib/seo-parser`
      import paths & directories. (URL surface ≠ data/API/module names.)
    - **Redirects:** `next.config.ts` `redirects()` — `/seo-parser` + `/seo-parser/:path*` →
      `/seo-audits*` permanent 308 (runs before middleware; old bookmarks + shipped srt_ links
      survive, still auth-gated). No `isPublicPath` change; `middleware.test.ts` guards `/seo-audits*`
      stays gated.
    - **Live-scan polish:** `buildSeoResultFromRun` `archived` opt; `loadRunSeoResult` selects
      `run.source`, passes `archived: source!=='live-scan'`; `ResultsView` `isLiveScan = !!runId &&
      !sessionId` branch renders a first-class "Live scan" `SeoSourceBadge` and suppresses BOTH the
      archived and (false) completeness banners. Pruned-session fallback unchanged.
    - **Maturation:** `SeoAuditTabs` (ADA-style pill toggle mirroring `AuditIndexTabs`, Scan-a-URL
      default + Upload-CSVs) + extracted `SeoUploadCard`; page → server component, `max-w-5xl`
      ADA-mirror header, reuses the merged `HistoryList`.
    - Gate-green (tsc / 3727 tests / build). Codex-reviewed spec+plan (archived). Final opus
      whole-branch review: READY TO MERGE (6 rename invariants confirmed).
    - **Prod-verified:** 308 redirects work for base/subpaths/deep-links, query preserved;
      `/seo-audits` auth-gated with correct `?next=`; login-page footer shows "SEO Audits"; PM2
      online 0-error. **Authed-UI spot-check (tabbed hub + live-scan first-class result) pending
      Kevin — staging login is Google OAuth only, not headlessly automatable; covered by the 3727
      passing tests + build.**

- **A8 (active, [~]) — NEXT: PR 5 = ada-audit visual polish.** Homepage/shell system COMPLETE
  through PR 3.5. Per-tool polish: PR 4 (seo-parser) SHIPPED (#120); ada-audit is the pre-decided
  next section (Kevin chose seo-parser + ada-audit back-to-back). VISUAL/primitive-adoption ONLY.
  WATCH the public share views `/ada-audit/share`, `/ada-audit/site/share` (render OUTSIDE the
  shell — a shared component can't have its `min-h-screen`/bg wrapper stripped). Tokens: navy
  #1c2d4a, orange #f5a623, navy-deep #0f1d30; opacity `bg-navy/[0.08]` not `/8`; "measure widths in
  Playwright" verify lesson applies. A8 stays [~]; mark [x] only when Kevin calls A8 done.

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12/C13/C14): unchanged — see the
  tracker (`2026-06-10-improvement-roadmap-tracker.md`) for authoritative per-item status and the
  full status log.
