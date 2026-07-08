# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (**D7 arc fully COMPLETE.** Scan-completion email notifications shipped + deployed earlier (PR #132). This session: (1) **real-send smoke DONE** — email delivered + rendered; Kevin's own inbox showed a "Be careful with this message" DMARC banner, **resolved env-only** by setting `NOTIFY_FROM="Enrollment Resources SEO <seo-tools@enrollment.email>"` + `pm2 restart` (DKIM `d=mg.enrollment.email` relaxed-aligns with the `enrollment.email` From org domain, `p=reject` → DMARC passes; a fresh external recipient inboxed first try — Kevin's inbox was a cousin-domain false-flag). (2) **Email enrichment SHIPPED** — branded, info-rich complete + failed emails (score cards, X-of-Y pages, issue counts, change-vs-last-scan). Feature-class: brainstorm → spec → Codex → plan → Codex → 3 TDD tasks; both artifacts accept-with-fixes (6 plan fixes applied); gates green (3777 tests). Branch `feat/d7-email-enrichment`.) · **Updated by:** the enrichment session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. The D7 scan-completion email arc is COMPLETE:
notifications shipped/deployed (PR #132), the real-send smoke passed, the Gmail "be careful"
DMARC banner was resolved env-only (NOTIFY_FROM=seo-tools@enrollment.email + pm2 restart, no
redeploy), and the email enrichment (branded HTML + score cards + pages + issue counts +
change-vs-last-scan) shipped on branch feat/d7-email-enrichment (merged + deployed this session —
verify state below). The only D7 follow-up is a nice-to-have: enriched-email inbox placement for
INTERNAL @enrollmentresources.com recipients (cousin-domain of the enrollment.email sender) —
optionally a Google Workspace admin allowlist, not code.

STANDING GATE (decided 2026-07-08): NO AI API — Kevin ruled there are no plans to use any AI API
(Anthropic or any LLM provider). Never propose or build AI-API features: direct memo generation
(03 Phase 3), C12's data-correctness half, and any AI slice of SF-retirement Phase 6 are OFF. All
AI stays the pat_/srt_/krt_/qct_ skill-handoff clipboard flow. Only Kevin reopens this (tracker →
Gated decisions). SEMRush ingestion is a data API, not an AI API — separate, still-open question.

FIRST STEP — confirm the enrichment PR is merged + deployed + prod-verified (git log origin/main;
ssh seo@144.126.213.242 "~/deploy.sh" if not yet deployed; then /api/health + confirm the process
restarted clean). The enriched email's real visual confirmation is Kevin's next real scan — ask him
to tick "Email me when this finishes" on any scan and eyeball the branded email.

Then pick the next roadmap item WITH Kevin (menu — no single pre-decided next item):
- A8 per-tool visual polish (OPEN-ENDED, spec §8): PR 4 (seo-parser) + PR 5 (ada-audit) shipped.
  Either do another per-tool pass (candidate tools still hand-rolling status/score chrome or owning
  page wrappers: /clients, /reports, /robots-validator, /quarter-grid — scope the tightest slice) OR
  call the arc done and mark A8 [x]. Reuse the PR-5 recipe below. VISUAL/primitive-adoption ONLY —
  no behavior/data/API/scoring change; existing tests stay green.
- SF-retirement: further hybrid-discovery increments, or parity cycles 2–3 (accrue on future runs).
- Track A infra: A5 (SSE progress), A6 (more UI primitives), A7 (auth + Playwright e2e).
- Track D workflow polish.

Read first: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (status log newest
first + the D7 entry), CLAUDE.md (the D7 + broken-link-verifier architecture patterns), and — if
touching notifications — docs/superpowers/archive/specs/2026-07-08-scan-email-enrichment-design.md
+ archive/plans/2026-07-08-scan-email-enrichment.md (and the D7 base spec/plan alongside them).

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

- **D7 scan-completion email — FULLY COMPLETE.**
  - Base feature: merged PR #132 (main `3df75ee`); migration `20260708120000` applied + health-verified. LIVE (not dark): `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` staged in prod `.env`.
  - **Real-send smoke DONE:** delivered + rendered. Gmail "Be careful with this message" banner on Kevin's own inbox = DMARC non-alignment (`From: @enrollmentresources.com`, sender `mg.enrollment.email`). **Resolved env-only:** `NOTIFY_FROM="Enrollment Resources SEO <seo-tools@enrollment.email>"` (+ `pm2 restart`, no redeploy). DKIM `d=mg.enrollment.email` relaxed-aligns with `enrollment.email` (org DMARC `p=reject`) → passes; banner gone. Mailgun Events API showed `DELIVERED` / Gmail `2.0.0 OK gsmtp`; fresh external recipient inboxed first try.
  - **Enrichment SHIPPED** (branch `feat/d7-email-enrichment`, PR #TBD — fill after merge). Branded table-based HTML (navy header, score cards colored by band, X-of-Y pages, counts table, change strip, incomplete-scan qualifier) + the failed email restyled with truncated error. Pure builder `lib/notify/content.ts` + new best-effort loader `lib/notify/enrichment.ts`; handler wires it inside a **5s-deadline try/catch** — `sendEmail` + `notifyCompleteSentAt` marker stay OUTSIDE (D7 idempotency byte-for-byte unchanged). Prod visual confirmation = Kevin's next scan.
  - **Enrichment code gotchas (if you touch it):** counts are independently nullable — `null` = run-absent (unknown), a rendered `0` = run-present-none-found; never conflate. Deltas are version-gated via `parseScoreVersion(scoreBreakdown)` (ADA runs are v2, live-SEO v1). `newIssues = diff.diff.newCount` ALONE — `newCount` already subsumes `regressedCount` + `newPageCount` (findings-shared.ts:270-272); do not add `newPageCount`. Previous ADA run loaded by `diff.previous.runId` (not `siteAuditId`, which can go null). SEO previous-run selection is deterministic (`completedAt ?? createdAt` desc, id tie-break, strictly-earlier, non-null score). Tests that create CrawlRuns must delete them BEFORE the SiteAudit (`SetNull` orphans contaminate previous-run selection).
  - **D7 base gotchas (unchanged):** idempotency = durable sent-markers, NOT `dedupKey` (active-window only); `notify-email` job must NEVER carry `groupKey: site-audit:<id>` (`failSiteAudit` cancels that group); send hooks never throw into the audit/builder; `NOTIFY_*`/`MAILGUN_*` read only in `lib/notify/config.ts`, none in `instrumentation.ts` fail-fast (dark-by-default).

- **STANDING GATE (2026-07-08): NO AI API.** Kevin ruled there are no plans to use any AI API (Anthropic or otherwise). 03 Phase 3 (direct memo generation) off the roadmap; C12 data-correctness half OFF (zero-AI Tier-0 only); SF-retirement Phase 6 AI slice off; all AI stays the skill-handoff clipboard flow (pat_/srt_/krt_/qct_). SEMRush ingestion is a data API, not an AI API — separate open question. Reopening = Kevin only (tracker → Gated decisions).

- **A8 per-tool visual polish arc — OPEN-ENDED (`[~]`, spec §8).** Shell/dashboard/widgets (PR 1–3.5) + PR 4 (seo-parser, #120) + PR 5 (ada-audit, #130, prod-verified) shipped. No pre-decided next tool — decide with Kevin: another per-tool pass (`/clients`, `/reports`, `/robots-validator`, `/quarter-grid`) or mark A8 `[x]`.

- **C11 — SEO Audits v1: COMPLETE ✅ ([x]).** `/seo-parser`→`/seo-audits` with 308 redirects; persisted `tool:'seo-parser'` discriminator + `/api/parse|seo-parser` routes + `@/…/seo-parser` module paths deliberately KEPT.

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12/C13/C14): unchanged — see the tracker for authoritative per-item status + the full status log.

## PR-5-proven recipe (reuse for any A8 per-tool polish pass — VISUAL ONLY)

- Adopt the EXISTING `components/ui/` primitives — `ScoreRing` (`score: number|null`, `size`; bands ≥80 green / ≥50 amber / else red; null → dashed em-dash ring) and `StatusPill` (`label`, `tone: neutral|running|success|error|warning`). Do NOT modify `StatusPill`'s tone set (shared with the Home widgets — a tone change ripples cross-tool). Its tone type is exported: `import type { Tone } from '@/components/ui/StatusPill'`.
- For lifecycle/status pills map BY COLOR not by word so operational surfaces stay pixel-stable (`components/ada-audit/status-tone.ts` `auditStatusTone(status)` is the template — copy the pattern per tool, don't force a global helper across tools with different status vocabularies).
- EXCLUDE things the primitives don't model: impact/severity 4-level palettes, INTERACTIVE toggle chips (converting them = a behavior change → forbidden), and score displays whose bands differ from ScoreRing's ≥80/≥50 (Lighthouse uses ≥90 — do NOT swap). Document each exclusion; these are future `SeverityBadge` work.
- The shell `<main>` (`components/shell/AppShell.tsx`) supplies `bg-[#f4f6f9] dark:bg-navy-deep`, so in-shell page roots should DROP their own `min-h-screen bg-*`; but a component rendered OUTSIDE the shell (public `/share` views) canNOT have its wrapper stripped — grep importers first.
- No behavior/data/API/scoring change; existing tests stay green; dark-mode variants on every surface. This repo has NO jest-dom — component tests use `.getAttribute()`/`.toBeTruthy()`/`queryByText(...)===null`, `// @vitest-environment jsdom`.
