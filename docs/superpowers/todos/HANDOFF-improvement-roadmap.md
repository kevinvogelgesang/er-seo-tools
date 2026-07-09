# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (Two ships this session. (1) **A8 PR 6** — `/reports` StatusPill adoption (PR #134, prod-verified). (2) **Dashboard widget removal** — Kevin-directed: dropped the `quick-robots` + `quarter-week` homepage widgets (PR #135, merged + deployed + prod-verified); both tools stay nav-only + fully usable. D7 email arc remains fully COMPLETE. A8 stays `[~]` — open-ended.) · **Updated by:** the A8-reports / dashboard-widgets session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. There is NO in-flight work — the last session
shipped two things (both merged + deployed + prod-verified): A8 PR 6 (the /reports StatusPill
polish, PR #134) and a Kevin-directed dashboard tweak removing the Robots + Quarter-Grid homepage
widgets (PR #135; both tools stay nav-only + fully usable). The D7 scan-completion email arc is
fully COMPLETE (notifications PR #132 + enrichment PR #133, smoke passed, DMARC resolved env-only).
So this session STARTS at the roadmap menu.

STANDING GATE (decided 2026-07-08): NO AI API — Kevin ruled there are no plans to use any AI API
(Anthropic or any LLM provider). Never propose or build AI-API features: direct memo generation
(03 Phase 3), C12's data-correctness half, and any AI slice of SF-retirement Phase 6 are OFF. All
AI stays the pat_/srt_/krt_/qct_ skill-handoff clipboard flow. Only Kevin reopens this (tracker →
Gated decisions). SEMRush ingestion is a data API, not an AI API — separate, still-open question.

FIRST STEP — confirm main is clean and prod is healthy (git log origin/main; then /api/health via
ssh seo@144.126.213.242 "curl -s localhost:3000/api/health"). No deploy needed unless you ship
something. Two low-stakes OPTIONAL human checks are still open from prior sessions (mention, don't
block on them): (a) eyeball the enriched scan-completion email on Kevin's next real scan (tick
"Email me when this finishes"); (b) glance at the pill-shaped status chips on /reports in an authed
session (the route is cookie-gated so it can't be screenshotted headless).

Then pick the next roadmap item WITH Kevin (menu — no single pre-decided next item):
- A8 per-tool visual polish (OPEN-ENDED, spec §8): PRs 4 (seo-parser), 5 (ada-audit), 6 (/reports)
  shipped. Either do ANOTHER per-tool pass OR call the arc done and mark A8 [x]. Remaining
  candidates + their catch: /clients (has BOTH primitives but messier — Scorecard uses ≥90/≥70 &
  ≥8/≥5 score bands that must be EXCLUDED from ScoreRing, plus purple/teal/inline-hex chips that
  don't map); /robots-validator (SeverityBadge has borders the primitive lacks, no scores);
  /quarter-grid (non-Tailwind, inline-hex theme — does NOT map without re-theming, effectively out
  of scope). Reuse the PR-5/PR-6 recipe below. VISUAL/primitive-adoption ONLY — no
  behavior/data/API/scoring change; existing tests stay green.
- SF-retirement: further hybrid-discovery increments (Increment 2 = the actual crawler, gated on
  the sitemap miss-rate number), or parity cycles 2–3 (accrue on future runs).
- Track A infra: A5 (SSE progress), A6 (more UI primitives), A7 (auth + Playwright e2e).
- Track D workflow polish.

Read first: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (status log newest
first) and CLAUDE.md (architecture patterns). The A8 umbrella spec is
docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md (§8 = per-tool passes) — no per-tool
plan is written; each pass just executes the recipe below.

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): THIS PASTED PROMPT is
standing authorization to merge gate-green roadmap PRs at session start (re-run lint/test/build on
the branch this session first) and to deploy when needed, ALWAYS followed by post-deploy verify.
Destructive server ops (.env/secrets edits, DB restore, rm) stay Kevin-gated. NEVER scan non-client
sites (dev-test scans ONLY against a client domain in the system or an *.erstaging.site domain you
control). Brainstorm→spec→plan runs ungated (route each artifact to Codex, notify Kevin one line +
path, don't wait). Docs ritual mandatory: tracker status-log + rewrite this handoff in the SAME
commit as the ship, ending your final reply with this paste-in prompt. Trust ranking when docs
disagree: code > plan/spec > tracker/handoff.

WORKTREE ENV NOTE (fresh worktree off origin/main, no node_modules): `npm install`, write a root
`.env` (DATABASE_URL=file:./local-dev.db, UPLOADS_DIR=./local-uploads,
NEXT_PUBLIC_APP_URL=http://localhost:3000, CHROME_EXECUTABLE=/Applications/Google Chrome.app/
Contents/MacOS/Google Chrome), then `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy
&& … prisma generate` before trusting tsc. Gates: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db"
npm test + npm run build. UI class: dark: on every element, no hydration mismatch, new Tailwind
classes reachable by the content globs (incl. ./lib/**).
```

## Current state (2026-07-08)

- **Homepage dashboard widget set (2026-07-08 change):** the `quick-robots` + `quarter-week` widgets were removed from `lib/widgets/registry.tsx` (Kevin-directed; no prior written note existed — the A8 spec had included them). Registry is now **7 widgets** (kpi-strip, live-now, needs-attention, quick-site-audit, quick-parser, quick-report, recent-parses). Both tools remain in the left-nav (`tools-registry.ts`) and at their routes — only the dashboard tiles are gone. If re-adding a homepage widget later, `normalizeLayout` appends newly-registered ids at defaultSize (no version bump); removals rely on drop-unknown.

- **A8 per-tool visual polish arc — OPEN-ENDED (`[~]`, spec §8).** Shell/dashboard/widgets (PR 1–3.5) + PR 4 (seo-parser, #120) + PR 5 (ada-audit, #130) + **PR 6 (/reports StatusPill, #134, deployed + prod-verified 2026-07-08)** shipped. No pre-decided next tool — decide with Kevin: another per-tool pass or mark A8 `[x]`. Remaining candidates and why each is trickier than /reports was:
  - `/clients` — the only remaining tool with a ScoreRing surface, BUT `components/clients/Scorecard.tsx` uses ≥90/≥70 (max 100) and ≥8/≥5 (max 10) bands ≠ ScoreRing's ≥80/≥50 → those scores must be EXCLUDED; also purple `regression`/teal type-tags/inline-hex priority chips don't map to StatusPill tones. Bigger, messier slice.
  - `/robots-validator` — `SeverityBadge` colors map but it carries a `border` the primitive lacks (visual mismatch); `MetaBadge`/bot-type pills don't map; no scores.
  - `/quarter-grid` — non-Tailwind (pervasive inline `style` + custom hex theme in `theme.ts`); nothing maps without re-theming the whole tool. Effectively out of scope for a VISUAL-only pass.
- **A8 reports-pass code facts (if you touch it):** new `components/reports/status-tone.ts` `reportStatusTone(status)` maps BY COLOR (ready/complete→success, error→error, running + transient queued/fetching/rendering→running, default→neutral). The per-source GA4/GSC/Pros badges (`sourceBadgeCls` in `ReportLibrary.tsx`) were DELIBERATELY left hand-rolled — smaller 10px scale, label is source-name not status, `manual`=teal has no StatusPill tone (future `SeverityBadge`).

- **D7 scan-completion email — FULLY COMPLETE.**
  - Base feature: merged PR #132 (main `3df75ee`); migration `20260708120000` applied + health-verified. LIVE (not dark): `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` staged in prod `.env`.
  - **Real-send smoke DONE:** delivered + rendered. Gmail "Be careful with this message" banner on Kevin's own inbox = DMARC non-alignment (`From: @enrollmentresources.com`, sender `mg.enrollment.email`). **Resolved env-only:** `NOTIFY_FROM="Enrollment Resources SEO <seo-tools@enrollment.email>"` (+ `pm2 restart`, no redeploy). DKIM `d=mg.enrollment.email` relaxed-aligns with `enrollment.email` (org DMARC `p=reject`) → passes; banner gone. Fresh external recipient inboxed first try.
  - **Enrichment SHIPPED + DEPLOYED + health-verified** (PR #133, main `ee57455`; no migration). Branded table-based HTML (score cards colored by band, X-of-Y pages, counts table, change strip) + restyled failed email. Pure `lib/notify/content.ts` + best-effort `lib/notify/enrichment.ts`; handler wires it in a **5s-deadline try/catch** — `sendEmail` + `notifyCompleteSentAt` marker stay OUTSIDE (idempotency unchanged). Prod visual confirmation = Kevin's next scan (optional).
  - **Enrichment code gotchas:** counts independently nullable (`null`=run-absent, `0`=none-found; never conflate); deltas version-gated via `parseScoreVersion` (ADA v2, live-SEO v1); `newIssues = diff.diff.newCount` ALONE (already subsumes regressed + new-page — findings-shared.ts:270-272); previous ADA run via `diff.previous.runId` not `siteAuditId`; tests that create CrawlRuns must delete them BEFORE the SiteAudit (SetNull orphans contaminate previous-run selection).
  - **D7 base gotchas:** idempotency = durable sent-markers, NOT `dedupKey` (active-window only); `notify-email` job must NEVER carry `groupKey: site-audit:<id>` (`failSiteAudit` cancels that group); send hooks never throw into the audit/builder; `NOTIFY_*`/`MAILGUN_*` read only in `lib/notify/config.ts`, dark-by-default.

- **STANDING GATE (2026-07-08): NO AI API.** Kevin ruled there are no plans to use any AI API (Anthropic or otherwise). 03 Phase 3 (direct memo generation) off; C12 data-correctness half OFF (zero-AI Tier-0 only); SF-retirement Phase 6 AI slice off; all AI stays the skill-handoff clipboard flow (pat_/srt_/krt_/qct_). SEMRush ingestion is a data API, not an AI API — separate open question. Reopening = Kevin only (tracker → Gated decisions).

- **C11 — SEO Audits v1: COMPLETE ✅ ([x]).** `/seo-parser`→`/seo-audits` with 308 redirects; persisted `tool:'seo-parser'` discriminator + `/api/parse|seo-parser` routes + `@/…/seo-parser` module paths deliberately KEPT.

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12/C13/C14): unchanged — see the tracker for authoritative per-item status + the full status log.

## PR-5/PR-6-proven recipe (reuse for any A8 per-tool polish pass — VISUAL ONLY)

- Adopt the EXISTING `components/ui/` primitives — `ScoreRing` (`score: number|null`, `size`; bands ≥80 green / ≥50 amber / else red; null → dashed em-dash ring) and `StatusPill` (`label`, `tone: neutral|running|success|error|warning`). Do NOT modify `StatusPill`'s tone set (shared with the Home widgets — a tone change ripples cross-tool). Its tone type is exported: `import type { Tone } from '@/components/ui/StatusPill'`.
- For lifecycle/status pills map BY COLOR not by word so operational surfaces stay pixel-stable. Per-tool tone helpers are the pattern (`components/ada-audit/status-tone.ts` `auditStatusTone`, `components/reports/status-tone.ts` `reportStatusTone`) — copy the pattern per tool, don't force a global helper across tools with different status vocabularies. WATCH the fallback color: reports' transient statuses were BLUE (→`running`), ada-audit's `queued` was GRAY (→`neutral`) — preserve each tool's actual current color.
- EXCLUDE things the primitives don't model: impact/severity 4-level palettes, INTERACTIVE toggle chips (converting them = a behavior change → forbidden), score displays whose bands differ from ScoreRing's ≥80/≥50 (Lighthouse ≥90, clients Scorecard ≥90/≥70 — do NOT swap), pills carrying borders/icons/arbitrary-hex the primitive lacks, and pills whose label is not the status. Document each exclusion in code; these are future `SeverityBadge` work.
- The shell `<main>` (`components/shell/AppShell.tsx`, line ~91) supplies `bg-[#f4f6f9] dark:bg-navy-deep` + `min-h-screen`, so in-shell page roots should DROP their own `min-h-screen bg-*`; but a component rendered OUTSIDE the shell (public `/share` views) canNOT have its wrapper stripped — grep importers first.
- No behavior/data/API/scoring change; existing tests stay green; dark-mode variants on every surface. This repo has NO jest-dom — component tests use `.getAttribute()`/`.toBeTruthy()`/`queryByText(...)===null`, `// @vitest-environment jsdom`. A pure per-tool tone-helper unit test (see `components/reports/status-tone.test.ts`) is sufficient coverage for a primitive-swap pass.
