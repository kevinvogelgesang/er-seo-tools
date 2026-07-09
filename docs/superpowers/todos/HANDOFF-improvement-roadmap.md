# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (Re-prioritization session, part 2: after defining the **audit-consolidation batch C15–C18** (umbrella spec Codex-reviewed ×12), the same session BUILT AND SHIPPED **C15** — the Mine-filter SSO fix (PR #136, merged + deployed + prod-verified; plan Codex-reviewed ×4, archived). Next item: **C16** (full merge). A8 stays parked `[~]`.) · **Updated by:** the re-prioritization + C15 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. The next item is PRE-DECIDED (Kevin, 2026-07-08):
**C16 — audit consolidation, full merge of SEO Audits into Site Audits** (P1 of the
audit-consolidation batch; C15 already SHIPPED — PR #136). Read the umbrella spec FIRST:
docs/superpowers/specs/2026-07-08-audit-consolidation-batch-design.md §P1 (Codex-reviewed ×12,
all fixes applied — batch decisions are SETTLED, do not re-litigate them). Then write C16's
implementation plan (writing-plans skill → route to Codex → apply fixes → build; don't wait for
Kevin between phases).

C16 scope (settled): one sidebar group "Audits" at /ada-audit replacing both nav entries (keep
HIDDEN registry ownership of /seo-audits/* so toolForPathname() still resolves the retained
result/compare routes; update components/footer.tsx too); AuditIndexTabs → Site Audit tab first
+ default; SF CSV upload (SeoUploadCard) becomes a collapsed optional section when Scan Type =
SEO; unified recents (Site ADA · Site SEO · Single Page · SF Upload badges + All/Mine —
Session.workflow='technical' only, stable cursor order (createdAt DESC, type, id), page-two
correctness tested, keeps session delete/search/client-filter); additive Session.requestedBy
migration stamped ONLY at session creation (the /api/upload append path must NOT overwrite);
/seo-audits index → permanentRedirect() (308) with /seo-audits/results/* + share/compare URLs
untouched; seoOnly audits stop redirecting off /ada-audit/site/[id] (transient → SiteAuditPoller,
complete → SEO results run page — branch BEFORE the ADA summary resolution or seoOnly dead-ends
at "Result data unavailable"); update ALL 8 enumerated ?scan=/seoOnly link producers
(SiteAuditForm, QuickSiteAuditWidget, LiveNowWidget, QueueMemberRow, DashboardQueueStatus,
ScheduledScansCard, client-dashboard link-builders, footer), then retire SeoScanForm.

After C16: C17 (progress maturation), C18 (results-page Accessibility|SEO tabs + pattern
dropdowns; also fold in the triage checkedBy legacy-cookie derivation flagged in C15's tracker
entry), then C14 (prospect sales audit view). One leftover Kevin eyeball from C15: run a fresh
authed site audit and confirm it appears under "Mine" on /ada-audit recents.

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

- **C15 — SHIPPED 2026-07-08 (PR #136, main `348d46e`, deployed + prod-verified).**
  Both `POST /api/site-audit` + `bulk-queue` now derive `requestedBy` via SSO-aware
  `getOperatorLabel`. No backfill (nulls unattributable). New mock-based
  `app/api/site-audit/route.requested-by.test.ts` (do NOT convert it to DB-backed —
  real `queueSiteAuditRequest` fires unawaited `processNext()`). ⚠ Sibling bug left
  by design: triage `checkedBy` (`app/api/site-audit/[id]/checks/route.ts:38`) still
  uses the legacy cookie — fold into C18. Kevin eyeball pending: fresh audit under "Mine".
- **Audit-consolidation batch C15–C18 (Kevin's re-prioritization, this session).**
  Umbrella spec `../specs/2026-07-08-audit-consolidation-batch-design.md` — Codex
  accept-with-named-fixes ×12, all applied. Priority: **C15 ✅ → C16 → C17 → C18 → C14**.
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
