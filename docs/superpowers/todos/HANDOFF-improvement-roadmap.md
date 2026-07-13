# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-12 (**D1 IN PROGRESS — PR1 (foundations) SHIPPED +
DEPLOYED + PROD-VERIFIED**, PR #162 / main `6c18848`: characterization net
(exact prompts ×6, 173-cell auth matrix, cat_ precedence + trio audience
walls) + `lib/handoff/` engine (registry/meta/errors/token factory/prompt) +
12 module facades, wire-invisible, opus branch review clean. Same session
earlier: **A6 closed as absorbed into A8** (stale handoff pointer corrected).
A5 unchanged: `[x]` flip still gated only on Kevin's live watches. Next:
**D1 PR2** (route-auth adoption, plan Tasks 8–11), then PR3 (cards + legacy
skill deletion, Tasks 12–17).)
· **Updated by:** the D1 session (A6 closure → spec → plan → PR1).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE: A5 (SSE push layer) is
CODE-COMPLETE — all 4 PRs shipped + deployed (PR #158 55ae1d7, PR #159 65dce3f,
PR #160 65b9417, PR #161 be2d1b9). PR1 prod-verified end-to-end (SSE streams
un-buffered through Cloudflare); PR2-PR4 autonomous prod checks pass (health,
401 gate, topic literals intact in minified chunks, quiet error log). Spec+plan
archived to docs/superpowers/archive/. A5 stays [~] pending ONLY Kevin's live
watches; when they pass, flip A5 to [x] AND mark D2 (memo arrival via SSE —
PR4 is its substance) with a dated status-log line + handoff rewrite in the
same commit.

KEVIN STEPS OUTSTANDING (one authenticated browser session covers all three):
with an er_auth session on https://seo.erstaging.site (Network tab showing the
/api/events stream), confirm (a) PR2 — a live single-page ADA audit + site
audit progress-update via ada-audit:<id>/site-audit:<id>/recents frames;
(b) PR3 — a report render / prospect scan / content-audit ingest each
push-update their UI without the old fast poll; (c) PR4 — an er-handoff-memo
write-back (any of pat_/srt_/krt_/kst_) pushes the memo into its card via
memo:<sid> at the 20s safety cadence, arriving immediately on the SSE frame.

IMMEDIATE NEXT (build): D1 PR2+PR3. D1 (handoff engine consolidation) is IN
PROGRESS: spec + plan Codex-reviewed (accept-with-fixes, applied) and PR1
(foundations) SHIPPED + DEPLOYED + PROD-VERIFIED (PR #162, main 6c18848) —
characterization net (exact-string prompts x6; 173-cell route-auth matrix;
cat_ transport precedence + shared-secret-trio audience walls) + lib/handoff/
(registry/meta/errors/token factory/prompt engine) + six token facades + six
composer facades, wire-invisible. DONE ALSO: PR2 route-auth adoption SHIPPED+DEPLOYED+PROD-VERIFIED (PR #163, main d5193bd; all 8 routes on requireHandoffToken, matrix green untouched). Remaining: PR3 only. PR2 was (plan
Tasks 8-11: requireHandoffToken w/ per-family transport+error policy,
VERIFIERS table importing the FACADE verify fns to keep route-test mocks
alive, kst/cat helper facades, 8 route adoptions; smoke mandatory) and PR3 =
client consolidation (Tasks 12-17: useMemoPoller hook w/ 13 enumerated
contract tests + MemoHandoffCard for srt/krt, MemoPoller + KeywordStrategyCard
adopt the hook, kst tests FROZEN, legacy skills/pillar-analysis-narrative +
scripts/build-skill.sh + package.json build:skill deletion, docs + family-7
checklist, tracker D1 [x] ritual). Plan:
docs/superpowers/plans/2026-07-12-d1-handoff-engine-consolidation.md ·
Spec: docs/superpowers/specs/2026-07-12-d1-handoff-engine-consolidation-design.md ·
SDD ledger: .superpowers/sdd/progress.md (D1 PR1 section = per-task history).
Execute via superpowers:subagent-driven-development. Wire contracts FROZEN
(deployed er-handoff-memo skill consumes them); characterization suite must
stay green UNTOUCHED through PR2/PR3. Pinned wart: token_expired is dead code
(jose expiry msg lacks 'expired') — preserved, never "fix" it.

DO NOT BUILD A6: closed 2026-07-12 as absorbed into A8 (tracker had said
"do not build separately" since 2026-07-07). Its substance shipped in A8:
lib/tools-registry.ts nav (PR #112) + components/ui/ primitives (PR #113).

A5 REFERENCE (shipped architecture): one process-global in-memory bus
(lib/events/bus.ts; publishInvalidation(topic) POST-COMMIT, outside the tx,
gated on count===1 or the resolved write — a .update() P2025-throw counts as
the fence; synchronous + never-throws) -> cookie-gated /api/events SSE route ->
one shared per-tab EventSource (lib/events/client.ts; subscribeTopic/
subscribeHealth, generation-token reconnect + 45s watchdog) fanning {topic}
invalidations to hooks that REFETCH FROM THE DB. SSE is invalidation-only;
cadence is transport-health-gated (ORIGINAL fast interval until SSE
connected+healthy, then safety cadence 60s / 30s export-bar / 20s memo flows,
re-arm fast on error/watchdog) so "SSE never connects" degrades to the
original polling, never slower. Topics: lib/events/topics.ts (LITERAL strings).
Memo flows route SSE through memo-poller-machine.invalidate() (visible+polling/
idle -> immediate refetch; hidden -> dirty, consumed on resume from any
non-expired status; expired -> no-op — the 15-min cap is never resurrected).
Emit topic IDs come off the RETURNED ROW's sessionId FK, never the route PK.

RECORDED FOLLOW-UPS (Kevin's call, non-blocking): (1) report-render.ts (ADA
site-audit PDFs) also emits report-list — only C10 /reports UIs subscribe;
plan-mandated, runtime-harmless, one-line cleanup if preferred. (2)
KeywordStrategyCard's SSE-handler pre-fetch is vestigial (its onChange now
refetches at call time) — one-line cleanup. (3) memo:<sessionId> is shared
across 3 memo families: cross-TAB extra idempotent refetch only, plan-level
design, no same-page double-fire.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test + npm
  run build before EVERY merge. npm run smoke mandatory if the PR touches
  auth/SF-upload/ADA-pipeline; also run it when a touched component renders on
  a page the smoke walks (PR4 precedent: PillarAnalysisButtonClient on the
  results page — 11.3s, cheap insurance).
- Array-form $transaction ONLY. publishInvalidation fires AFTER the awaited
  write resolves, OUTSIDE the tx, effect-gated. Emit can never fail the write.
- Topics are LITERAL strings (lib/events/topics.ts) — no Class.name deps.
  Emit/subscribe identity per family is test-pinned with
  not.toHaveBeenCalledWith(<wrongId>) — keep that pattern for new topics.
- Component tests: // @vitest-environment jsdom + afterEach(cleanup), no
  jest-dom. vi.mock('@/lib/events/client') BEFORE importing module-level stores.
- Effects keyed on store snapshots re-run on EVERY tick (new ref, same
  content) — guard timer state (a2e0933 freeze-frame fix + PR4's samePa button
  fix are the recipes).
- Tests self-provision per-worker SQLite DBs, run PARALLEL. Absolute file:
  URLs for tooling DBs (Prisma resolves relative against prisma/).
- DateTime columns are INTEGER ms — raw SQL binds ${x.getTime()}.
- Never git add -A/-u at repo root (pentest-results/ etc untracked) — stage
  explicit paths. No backticks in Bash -m commit messages.
- .superpowers/sdd/task-N-*.md files are REUSED across PR series — a stale
  same-numbered brief/report may exist; overwrite, don't trust.
- UI-class changes (any): dark: variants on every element (bg-white ->
  dark:bg-navy-card etc.) + the ThemeToggle mounted-guard hydration pattern.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy. Load skill
er-seo-tools-change-control FIRST. Gate policy rules 1 & 4: merge gate-green
PRs (re-run gates in-session) + deploy with post-deploy verify autonomously;
destructive server ops Kevin-gated; brainstorm->spec->plan ungated. Docs
ritual in the same commit as any ship. Then: if Kevin reports the live watches
passed, do the A5 [x] + D2 flip ritual; otherwise start (or continue) D1 with
superpowers:brainstorming, picking up any existing D1 spec/plan in
docs/superpowers/specs|plans first.
```

---

## Current state (2026-07-12, A5 PR4 shipped + deployed — A5 code-complete)

- **Main** @ `be2d1b9` (A5 PR4 merge) + this docs commit. **Prod deployed on
  PR4**, healthy (`status:ok`, no crash-loop, no migration, no new env).
- **A5 → `[~]`, code-complete:** all 4 PRs shipped + deployed. PR4 delivered
  the memo topology: `invalidate()` seam (review loop caught + fixed a real
  dirty-drop on idle-resume, `ddea203`), 4 write-back emit seams keyed off the
  returned row's sessionId FK, `runFromSession` pillar emits, 4 memo cards +
  `PillarAnalysisButtonClient` migrated onto health-gated 20s safety cadence.
  Gates: tsc · 4764 tests/543 files · build · smoke 11.3s, all green in the
  merging session. Opus whole-branch review: READY TO MERGE (emit/subscribe
  topology grep-swept complete; zero schema/middleware/env changes).
- **The ONLY thing between A5 and `[x]`:** Kevin's live authenticated watches
  (PR2+PR3+PR4, one browser session — see the paste-in prompt). When they
  pass: flip A5 `[x]` AND mark D2 (PR4 is D2's substance), status-log +
  handoff rewrite in the same commit.
- SDD ledger: `.superpowers/sdd/progress.md` (gitignored recovery map, PR1–PR4).
- **A7 `[x]`**, **C20 `[x]`** (volume dark pending DataForSEO creds), **C12
  `[~]`** (Tier-2 future scope; D2 flips with A5; D3 deferred).
- **Kevin manual checks:** `todos/2026-07-11-kevin-manual-checks-tracker.md`.

## The single next item

**D1 — handoff engine consolidation (1 wk).** Token factory (`lib/handoff/`)
+ `HANDOFF_TYPES` registry + one `<MemoHandoffCard>` across the six token
families (pat_/srt_/krt_/kst_/cat_/qct_); retire anything the unified
er-handoff-memo skill already replaced. Source: `nyi/improvement-roadmaps/
03-ai-memo-tools.md` Phase 1 (its Phase 2 = A5/D2, shipped; Phase 3 gated
OFF by the no-AI-API ruling; Phase 4 largely landed as KS-1/KS-2/KS-5).
Unify code, never per-family secrets/audiences; preserve the A5 SSE memo
topology. No dependency on A5's pending watches.

**A6 was closed 2026-07-12 as absorbed into A8** (nav registry + `components/ui/`
primitives shipped in A8 PR1/PR2) — the previous handoff's "next: A6" line was
stale; do not build it.

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — authoritative this cycle.
Headline additions from PR4: smoke is cheap insurance when a touched component
renders on a smoke-walked page; emit-vs-subscribe identity is test-pinned via
`not.toHaveBeenCalledWith(<wrongId>)`; the memo machine's expired state is
never resurrected by SSE.

## C12 D1 follow-ups (still non-blocking)

- I2 (Low): a manual `npx tsx scripts/findings-rebuild.ts <id>` on a run-bearing
  audit would wipe an ingested `contentAuditJson`. Unreachable in normal flow.
- Retention canary: observe retained-`HarvestedPageSeo` count + DB-size delta +
  `sweepExpiredContentAudit` duration over a busy 2-hour window.
