# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (C16 session: the audit-consolidation FULL MERGE shipped — PR #137, merged + deployed + prod-verified; plan Codex-reviewed ×9, archived. One "Audits" section at `/ada-audit`, unified 5-source recents, `Session.requestedBy` migration, `/seo-audits` index 308, seoOnly audits live on the site page. Next item: **C17** (progress maturation). A8 stays parked `[~]`.) · **Updated by:** the C16 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. The next item is PRE-DECIDED (Kevin, 2026-07-08):
**C17 — scan-progress maturation** (P2 of the audit-consolidation batch; C15 #136 and C16 #137
both SHIPPED). Read the umbrella spec FIRST:
docs/superpowers/specs/2026-07-08-audit-consolidation-batch-design.md §P2 (Codex-reviewed ×12 —
batch decisions are SETTLED, do not re-litigate). Then write C17's implementation plan
(writing-plans skill → route to Codex → apply fixes → build; don't wait for Kevin between phases).

C17 scope (settled): (1) SiteAuditPoller surfaces the seoOnly verifier sub-phase from
GET /api/site-audit/[id]'s seoPhase{state,progress,message} — no dead gap between crawl-done and
results-ready (C16 already hosts seoOnly on /ada-audit/site/[id]: transient → poller; complete →
server redirect to /seo-audits/results/run/[id] or a STATIC SeoPhaseBanner page — C17 makes that
live). (2) Poller terminal semantics (spec Codex fix #8): useAuditPoller treats status==='complete'
as terminal — exactly when a seoOnly audit enters the verifier phase; for seoOnly, parent complete
stays NON-terminal while seoPhase is queued/running; stop only on run-ready (liveScanRunId
present), failed, or unavailable. (3) Auto-navigation on completion through a SINGLE owner: an
explicit redirect outcome that suppresses the hook's unconditional router.refresh() — never
router.replace() racing a refresh; full ADA audits likewise flip to results with zero clicks.
(4) Live in-flight rows in the unified recents (spec Codex fix #9): poll a COMPACT status endpoint
for the visible in-flight IDs only — NEVER re-fetch the whole merged history every 8s (the C16
recents API is a 5-source cursor merge; treat it as expensive); refresh the merged list once they
settle; polling stops when nothing is in flight. Single-page audits are already granular — untouched.

C16 landed context you'll build on: RecentsTable (components/ada-audit/RecentsTable.tsx) is the
unified 5-source table ({items,nextCursor} envelope from /api/ada-audit/recents; server-computed
item.href); the seoOnly complete-branch lives in app/(app)/ada-audit/site/[id]/page.tsx via pure
seo-only-view.ts (BEFORE ADA summary resolution — keep it that way); GET /api/site-audit/[id]
already returns seoOnly, liveScanRunId, seoPhase.

After C17: C18 (results-page Accessibility|SEO tabs + pattern dropdowns; also fold in the triage
checkedBy legacy-cookie derivation at app/api/site-audit/[id]/checks/route.ts:38), then C14
(prospect sales audit view). Kevin eyeballs outstanding: fresh authed site audit under "Mine"
(C15) + a glance at the merged /ada-audit page, unified recents badges/filters, and an SF upload
through the new collapsed Scan Type=SEO section (C16).

STANDING GATE (decided 2026-07-08): NO AI API — Kevin ruled there are no plans to use any AI API
(Anthropic or any LLM provider). Never propose or build AI-API features. All AI stays the
pat_/srt_/krt_/qct_ skill-handoff clipboard flow. Only Kevin reopens this (tracker → Gated
decisions).

FIRST STEP — confirm main is clean and prod is healthy (git log origin/main; then /api/health via
ssh seo@144.126.213.242 "curl -s localhost:3000/api/health"). No deploy needed unless you ship
something.

Read first: docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (status log newest
first) and CLAUDE.md (architecture patterns — the C16 seoOnly routing invariant changed).

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

- **C16 — SHIPPED 2026-07-08 (PR #137, main `6cbef45`, deployed + prod-verified).**
  Full merge delivered: one "Audits" nav entry (`id:'audits'`, `aliases:['/seo-audits']` —
  alias-aware `toolForPathname`; the spec's hidden-entry option was NOT used, aliases keep
  sidebar active-state/child-expansion working on `/seo-audits/diff`); Site Audit tab
  first+default; collapsed SF-upload section under Scan Type=SEO; unified recents =
  **5-source** cursor merge (Codex overturned the plan's orphan-run exclusion: seoOnly
  SCHEDULES exist since C11 PR 2a, so schedule-pruned seoOnly parents orphan their
  live-scan runs → orphans are a source, all-scope only); `Session.requestedBy`
  (migration `20260708210000_session_requested_by`, stamped at `/api/upload` CREATE only);
  `/seo-audits` index 308; seoOnly branch on `/ada-audit/site/[id]` BEFORE ADA summary
  resolution (`seo-only-view.ts`); all 8 producers → site page; SeoScanForm/SeoAuditTabs/
  HistoryList retired, `/api/parse/history` KEPT (RecentParsesWidget + diff page).
  ⚠ Gotchas for C17/C18: recents list NEVER reads `Session.result` blobs (pre-A2 sessions
  show "—"); the recents API envelope is `{items,nextCursor}` — compact in-flight polling
  must not refetch it wholesale; the C16 seoOnly "building" page is STATIC (reload-based) —
  C17 replaces it with live seoPhase polling + auto-navigate; `useAuditPoller` still treats
  `complete` as terminal (the C17 core change).
- **C15 — SHIPPED (PR #136).** ⚠ Sibling bug left by design: triage `checkedBy`
  (`app/api/site-audit/[id]/checks/route.ts:38`) still uses the legacy cookie — fold into C18.
- **Batch order: C15 ✅ → C16 ✅ → C17 → C18 → C14.** Umbrella spec
  `../specs/2026-07-08-audit-consolidation-batch-design.md` (Codex ×12). C18 spec-critical
  bits: share view loads SEO tab data server-side token-validated, screenshots/element
  dropdowns OMITTED in shareMode; pattern dropdowns need a bounded representative-page
  loader; archived audits degrade to the capped no-image sample.
- **C13** now holds ONLY the Bellus "0 rules passed" scorecard investigation.
- **A8 per-tool visual polish arc — parked `[~]`, open-ended**, resumes after the batch.
  Shipped passes: PR 4 seo-parser #120, PR 5 ada-audit #130, PR 6 /reports #134.
- **D7 scan-completion email — FULLY COMPLETE** (base #132 + enrichment #133). C16 note:
  the notify checkbox now lives ONLY on `SiteAuditForm` (SeoScanForm retired — no loss).
- **STANDING GATE (2026-07-08): NO AI API.** All AI stays the skill-handoff clipboard flow.
- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12, C14): unchanged —
  see the tracker for authoritative per-item status + the full status log.
