# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (Re-prioritization session: Kevin defined the **audit-consolidation batch C15–C18** (umbrella spec written + Codex-reviewed ×12 fixes applied, committed) and set the priority order **C15 → C16 → C17 → C18 → C14**. C13's UI one-liners redistributed into the batch; A8 per-tool arc parked `[~]` behind it. NO code shipped this session — docs only.) · **Updated by:** the re-prioritization/brainstorm session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. The next item is PRE-DECIDED (Kevin, 2026-07-08):
**C15 — fix the "Mine" recents filter (SSO regression)**, an hours-scale bugfix PR. It is PR0 of
the audit-consolidation batch C15→C16→C17→C18 (then C14). Read the umbrella spec FIRST:
docs/superpowers/specs/2026-07-08-audit-consolidation-batch-design.md (Codex-reviewed ×12, all
fixes applied — batch decisions are SETTLED, do not re-litigate them).

C15 facts (verified 2026-07-08): app/api/site-audit/route.ts (~line 34) + bulk-queue/route.ts
still derive requestedBy via sanitizeOperatorName(er-operator-name cookie) — Google SSO never
sets that cookie, so every site audit since SSO has requestedBy = null and can never match
"Mine" (lib/ada-audit/recents-query.ts compares against getOperatorLabel = session.name ??
email). A stale legacy cookie can also MISattribute. Fix = both routes use
getOperatorLabel(authCookie, operatorCookie) exactly like app/api/ada-audit/route.ts:56-59.
Scheduled audits keep 'scheduled'. NO backfill. Tests: all four operator-resolution branches
(session name / session email / legacy-cookie fallback — "no session" does NOT mean null / null
when both absent). No migration, no UI change. Write the plan (writing-plans skill, route to
Codex, apply fixes, don't wait for Kevin), then build per ritual.

After C15 ships: C16 (full merge of SEO Audits into Site Audits — one "Audits" section, unified
recents + Session.requestedBy migration, /seo-audits index 308, seoOnly audits adopt
/ada-audit/site/[id] as progress page), then C17 (progress maturation), C18 (results-page
Accessibility|SEO tabs + pattern dropdowns), then C14 (prospect sales audit view). Each gets its
own plan via the ritual; the umbrella spec §s carry the settled design + Codex catches.

STANDING GATE (decided 2026-07-08): NO AI API — Kevin ruled there are no plans to use any AI API
(Anthropic or any LLM provider). Never propose or build AI-API features. All AI stays the
pat_/srt_/krt_/qct_ skill-handoff clipboard flow. Only Kevin reopens this (tracker → Gated
decisions).

FIRST STEP — confirm main is clean and prod is healthy (git log origin/main; then /api/health via
ssh seo@144.126.213.242 "curl -s localhost:3000/api/health"). No deploy needed unless you ship
something.

Read first: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (status log newest
first) and CLAUDE.md (architecture patterns).

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

- **NEW: audit-consolidation batch C15–C18 (Kevin's re-prioritization, this session).**
  Umbrella spec `../specs/2026-07-08-audit-consolidation-batch-design.md` — Codex
  accept-with-named-fixes ×12, all applied. Priority: **C15 → C16 → C17 → C18 → C14**.
  Kevin-locked decisions: FULL merge (SEO Audits folds into one "Audits" section at
  `/ada-audit`; SF CSV upload becomes an optional section under Scan Type = SEO); ONE
  unified recents list (4 type badges + All/Mine); results page gets Accessibility|SEO
  TABS; packaging = 4 projects with the bug fix first; section name "Audits".
  Key Codex catches already folded into the spec (honor them in the per-project plans):
  - seoOnly complete-branch on `/ada-audit/site/[id]` must run BEFORE ADA summary
    resolution (else "Result data unavailable").
  - Share view: SEO tab data server-side token-validated; pattern screenshots/element
    dropdowns OMITTED in shareMode; screenshot route stays cookie-gated.
  - Pattern dropdowns need a bounded representative-page server loader (`CommonIssue`
    has no node HTML/screenshot/child-audit id); archived audits degrade to the capped
    no-image sample (~5 nodes/page).
  - Unified recents: `Session.workflow='technical'` only; stable cursor order
    `(createdAt DESC, type, id)` — per-source offset merge is wrong beyond page one;
    keep session delete/search/client-filter (feature parity, not silent removal).
  - `Session.requestedBy` stamped ONLY at session creation (`/api/upload` append path
    must not overwrite).
  - Poller: seoOnly parent `complete` is NON-terminal until run-ready/failed;
    auto-navigation through a single owner (no `router.replace` vs `refresh` race).
  - All 8 `?scan=`/seoOnly link producers enumerated in the spec must be updated
    (widgets, queue rows, client dashboard, footer), not just `SeoScanForm`.
- **C13** now holds ONLY the Bellus "0 rules passed" scorecard investigation (its five
  UI one-liners moved into C16/C18).
- **A8 per-tool visual polish arc — parked `[~]`, open-ended**, resumes after the batch
  (or Kevin calls it done). Shipped passes: PR 4 seo-parser #120, PR 5 ada-audit #130,
  PR 6 /reports #134. The PR-5/PR-6 recipe lives in this doc's git history (2026-07-08
  version) — restore it to this file when A8 resumes.
- **D7 scan-completion email — FULLY COMPLETE** (base #132 + enrichment #133, smoke
  passed, DMARC resolved env-only via `NOTIFY_FROM` alignment). Gotchas if touched:
  idempotency = durable sent-markers NOT dedupKey; notify job NEVER carries
  `groupKey: site-audit:<id>`; counts independently nullable; `newIssues =
  diff.diff.newCount` alone.
- **STANDING GATE (2026-07-08): NO AI API.** All AI stays the skill-handoff clipboard
  flow (pat_/srt_/krt_/qct_). SEMRush ingestion is a data API — separate open question.
- **C11 — SEO Audits v1: COMPLETE ✅.** `/seo-parser`→`/seo-audits` with 308s;
  `tool:'seo-parser'` discriminator + API routes + module paths deliberately KEPT.
  Note: C16 will supersede parts of C11 PR 3's hub maturation (Kevin knows — he used
  the merged hub and decided the separate section isn't worth it).
- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12, C14): unchanged —
  see the tracker for authoritative per-item status + the full status log.
