# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (C17 session: scan-progress maturation SHIPPED — PR #138, merged + deployed + prod-verified; plan Codex-reviewed ×6, archived. Live seoOnly verifier phase + zero-click auto-navigation + live in-flight recents rows via the compact status endpoint. Next item: **C18** (results-page reorganization). A8 stays parked `[~]`.) · **Updated by:** the C17 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. The next item is PRE-DECIDED (Kevin, 2026-07-08):
**C18 — results-page reorganization** (P3, the LAST item of the audit-consolidation batch; C15
#136, C16 #137, C17 #138 all SHIPPED). Read the umbrella spec FIRST:
docs/superpowers/specs/2026-07-08-audit-consolidation-batch-design.md §P3 (Codex-reviewed ×12 —
batch decisions are SETTLED, do not re-litigate). Then write C18's implementation plan
(writing-plans skill → route to Codex → apply fixes → build; don't wait for Kevin between phases).

C18 scope (settled): applies to the FULL-audit results page (app/(app)/ada-audit/site/[id]/page.tsx
+ SiteAuditResultsView); seoOnly audits land on the SEO run page and are unaffected except where
noted. (1) Shared header (domain, ADA score, SEO score, SiteAuditExportBar, SiteAuditDiffPanel) +
two tabs below: Accessibility (compliance banner, scorecards, site-wide patterns, pages-with-issues,
redirects, clean pages, PDF issues) | SEO (BrokenLinks/OnPageSeo/TechnicalSeo/DiscoveryCoverage/
Reachability/ContentSimilarity — the current stack at page.tsx:~245+ moves inside the tab).
(2) Share view (spec Codex fix #11): same tab split, but ALL SEO tab data loads server-side in the
token-validated share page — zero cookie-gated fetches preserved; pattern screenshots + element
dropdowns OMITTED in shareMode (screenshot route stays cookie-gated; audit IDs/filenames are not
authorization). (3) Triage toggle moves from the header card (SiteAuditResultsView.tsx:~152) into
the Pages with Issues section header. (4) Site-wide patterns matured (CommonIssueCallout.tsx):
expandable cards — ONE representative element screenshot + deduped affected-element HTML+selector
list via a BOUNDED server loader (spec Codex fix #10: resolve the pattern's representative page,
load that ONE child audit's stored results, extract nodes for the rule — NEVER fan out); labelled
as a sample; "View affected pages →" link removed (C13 decision); archived (90-d-pruned) audits
degrade to the capped ~5-node no-image sample with honest copy (spec Codex fix #12). (5) C13
ride-alongs: reword "Pages are audited one at a time" (SiteAuditPoller.tsx), collapse/soften
KnownLimitationsNotice, paginate Pages with Issues at 25. (6) Fold in the triage checkedBy
legacy-cookie fix: app/api/site-audit/[id]/checks/route.ts:38 still derives checkedBy via
sanitizeOperatorName(er-operator-name cookie) — switch to SSO-aware getOperatorLabel (same fix as
C15's, route tests included).

C17 landed context you'll build on: SiteAuditPoller is seoOnly-aware (seo-poll-status.ts synthetic
statuses; useAuditPoller.onTerminal may return {redirect} → single-owner router.replace);
classifySeoPhase has a 12-min enqueue grace window (SEO_PHASE_ENQUEUE_GRACE_MS) — completedAt is
threaded at every call site, keep it that way; RecentItem.inFlight + GET
/api/ada-audit/recents/status (compact, ≤50 ids, zero blob parses) + useRecentsLivePoll drive live
recents rows. RecentsTable's status cell renders pulse + mini progress from a liveMeta map.

After C18: C14 (prospect sales audit view) is NEXT per Kevin's priority order. Kevin eyeballs
outstanding (accumulating): fresh authed site audit under "Mine" (C15), merged Audits page +
recents badges/filters + SF upload via collapsed Scan Type=SEO section (C16), watch one real
seoOnly scan auto-flip to results + a recents row tick live (C17).

STANDING GATE (decided 2026-07-08): NO AI API — Kevin ruled there are no plans to use any AI API
(Anthropic or any LLM provider). Never propose or build AI-API features. All AI stays the
pat_/srt_/krt_/qct_ skill-handoff clipboard flow. Only Kevin reopens this (tracker → Gated
decisions).

FIRST STEP — confirm main is clean and prod is healthy (git log origin/main; then /api/health via
ssh seo@144.126.213.242 "curl -s localhost:3000/api/health"). No deploy needed unless you ship
something.

Read first: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (status log newest
first) and CLAUDE.md (architecture patterns — C16 seoOnly routing + C17 poller semantics).

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): THIS PASTED PROMPT is
standing authorization to merge gate-green roadmap PRs at session start (re-run lint/test/build on
the branch this session first) and to deploy when needed, ALWAYS followed by post-deploy verify.
Destructive server ops (.env/secrets edits, DB restore, rm) stay Kevin-gated. NEVER scan non-client
sites (dev-test scans ONLY against a client domain in the system or an *.erstaging.site domain you
control). Brainstorm→spec→plan runs ungated (route each artifact to Codex, notify Kevin one line +
path, don't wait). Docs ritual mandatory: tracker status-log + rewrite this handoff in the SAME
commit as the ship, ending your final reply with this paste-in prompt. Trust ranking when docs
disagree: code > plan/spec > tracker/handoff.

ENV NOTE (main checkout or fresh worktree): if node_modules/Prisma client are stale, run
`npm install` then `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma
generate` before trusting tsc (the C17 session hit a stale client missing Session.requestedBy).
Prisma resolves relative SQLite URLs against prisma/ — the dev DB file is prisma/local-dev.db,
reached as DATABASE_URL="file:./local-dev.db". Gates: npx tsc --noEmit + DATABASE_URL="file:./
local-dev.db" npm test + npm run build (vitest WITHOUT the DATABASE_URL prefix fails DB-backed
tests with "Error code 14"). Dev server without a login wall: DATABASE_URL="file:./local-dev.db"
NEXT_PUBLIC_APP_URL="http://localhost:3000" APP_AUTH_PASSWORD="" npm run dev. UI class: dark: on
every element, no hydration mismatch, new Tailwind classes reachable by the content globs.
```

## Current state (2026-07-08)

- **C17 — SHIPPED 2026-07-08 (PR #138, main `ce79ae1`, deployed + prod-verified).**
  Live seoOnly progress end-to-end: `useAuditPoller.onTerminal` can return `{redirect}`
  (single navigation owner — one `router.replace`, refresh suppressed); pure
  `seo-poll-status.ts` maps seoOnly parent `complete` to non-terminal `seo-verifying`
  until run-ready/failed/unavailable; `SiteAuditPoller` renders the live `SeoPhaseBanner`
  (`live` prop) through the verifier and auto-navigates to
  `/seo-audits/results/run/[id]` on run-ready; the C16 static "reload" banner branch now
  mounts the live poller. Recents: `RecentItem.inFlight` (server-computed),
  client-safe `lib/ada-audit/recents-status-shared.ts`, server `fetchRecentsStatus`,
  cookie-gated `GET /api/ada-audit/recents/status?ids=type:id,…` (≤50 ids, ZERO blob
  parses, bounded progress fields), `useRecentsLivePoll` (8 s, visible in-flight ids,
  settle → ONE merged refetch). `classifySeoPhase` gained
  `SEO_PHASE_ENQUEUE_GRACE_MS` (12 min): complete + no run + no job within grace →
  `queued`, closing the finalizer flip→enqueue race AND the ≤10-min crash-recovery
  window — `completedAt` is threaded at every call site.
  ⚠ Gotchas for C18: `waitFor` hangs under vitest fake timers (use `act()` + direct
  asserts); mocked routers must be ONE stable object; vitest needs the
  `DATABASE_URL="file:./local-dev.db"` prefix or DB-backed tests fail with
  "Error code 14"; the local Prisma client can be stale after checkout (regenerate).
- **C16 — SHIPPED (PR #137).** One "Audits" section at `/ada-audit`
  (`aliases:['/seo-audits']`), unified 5-source recents (`{items,nextCursor}` envelope —
  never read `Session.result` blobs in the list path), `/seo-audits` index 308, seoOnly
  branch on the site page BEFORE ADA summary resolution (`seo-only-view.ts` — keep it
  there in C18's page refactor).
- **C15 — SHIPPED (PR #136).** ⚠ Sibling bug deliberately deferred INTO C18: triage
  `checkedBy` (`app/api/site-audit/[id]/checks/route.ts:38`) still uses the legacy
  cookie — fix with `getOperatorLabel` as part of C18.
- **Batch order: C15 ✅ → C16 ✅ → C17 ✅ → C18 → C14.** Umbrella spec
  `../specs/2026-07-08-audit-consolidation-batch-design.md` (Codex ×12). C18
  spec-critical bits: share view loads SEO tab data server-side token-validated,
  screenshots/element dropdowns OMITTED in shareMode; pattern dropdowns need a bounded
  representative-page loader (`CommonIssue` lacks node HTML/screenshots); archived
  audits degrade to the capped no-image sample.
- **C13** now holds ONLY the Bellus "0 rules passed" scorecard investigation.
- **A8 per-tool visual polish arc — parked `[~]`, open-ended**, resumes after the batch.
  Shipped passes: PR 4 seo-parser #120, PR 5 ada-audit #130, PR 6 /reports #134.
- **D7 scan-completion email — FULLY COMPLETE** (base #132 + enrichment #133).
- **STANDING GATE (2026-07-08): NO AI API.** All AI stays the skill-handoff clipboard flow.
- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12, C14): unchanged —
  see the tracker for authoritative per-item status + the full status log.
