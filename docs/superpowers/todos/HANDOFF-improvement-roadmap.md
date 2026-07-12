# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-12 (**A5 PR3 (reports/prospects/content-audit/batch/client-summary
SSE consumers) — SHIPPED + DEPLOYED** PR #160/`65b9417`; report/prospect/content-audit
emit seams + 7 poller migrations; opus whole-branch review clean; review loop caught +
fixed a batch freeze-frame regression. PR2+PR3 live push-update watches still want
Kevin's `er_auth` cookie. A5 → `[~]`. Next: **PR4 (memos, Tasks 23–25) + A5 CLOSE**.)
· **Updated by:** the A5 PR3 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. IN PROGRESS: A5 (SSE push layer),
4-PR feature — PR1-PR3 of 4 SHIPPED + DEPLOYED (PR #158 55ae1d7, PR #159 65dce3f,
PR #160 65b9417). PR1 prod-verified end-to-end (SSE streams un-buffered through
Cloudflare). PR3 shipped: report emits (seo-report-render child/rollup,
report-render PDF stamp, create/delete/regenerate routes) + prospect-list emits
(finalizer both terminal branches + failSiteAudit gated on prospectId,
create/delete routes) + content-audit ingest PATCH emit; migrated
SiteAuditExportBar (2s→report:<id>+30s), GenerateReportForm (2s+3s→60s),
ReportLibrary (5s→report-list+60s), ProspectDashboard (8s→prospect-list+60s),
ContentAuditCard (8s→content-audit:<id>+60s, bounded mint→poll kept),
QueueActiveView (5s→audit-batch:<id>+60s + shared useQueueStatus store),
ClientsAuditSummary (topics added, 30s kept). Gates were green (534 files/4708
tests + build + smoke 11.8s).

KEVIN STEPS OUTSTANDING (PR2+PR3, one authenticated browser session covers both):
with an er_auth session on https://seo.erstaging.site (Network tab showing the
/api/events stream), confirm (a) a live single-page ADA audit + site audit
progress-update via ada-audit:<id>/site-audit:<id>/recents frames (PR2), and
(b) a report render / prospect scan / content-audit ingest each push-update
their UI without the old fast poll (PR3). Not load-bearing for PR4; do before
A5 CLOSE.

IMMEDIATE NEXT — PR4 memos (plan Tasks 23-25):
- Task 23: memo-poller-machine.invalidate() seam + dirty-while-hidden (queue a
  refetch for hidden tabs, flush on visibility) + SAFETY_POLL_MEMO_MS=20s active
  cadence.
- Task 24: emit memoTopic(sessionId)/pillarAnalysisTopic(sessionId) at the memo
  write-back seams (srt_/krt_/kst_/pat_ PATCH routes + pillar-analysis writes);
  migrate the 4 memo cards + PillarAnalysisButtonClient onto the invalidate seam.
- Task 25: gates + deploy + prod-verify + docs ritual + A5 CLOSE (archive
  spec/plan to docs/superpowers/archive/, final tracker flip to [x] after
  Kevin's live watches).

- Spec: docs/superpowers/specs/2026-07-11-a5-sse-push-layer-design.md
- Plan: docs/superpowers/plans/2026-07-11-a5-sse-push-layer.md (25 tasks / 4 PRs)
- SDD ledger (recovery map): .superpowers/sdd/progress.md (gitignored)

ARCHITECTURE: one process-global in-memory bus (lib/events/bus.ts;
publishInvalidation(topic) called POST-COMMIT, outside the tx, gated on count===1,
synchronous + never-throws) → cookie-gated /api/events SSE route → one shared
per-tab EventSource (lib/events/client.ts; subscribeTopic/subscribeHealth,
generation-token reconnect + 45s watchdog) fanning {topic} invalidations to hooks
that REFETCH FROM THE DB. SSE is invalidation-only; DB stays source of truth;
cadence is transport-health-gated (ORIGINAL fast interval until SSE
connected+healthy, then safety cadence, re-arm fast on error/watchdog) so "SSE
never connects" degrades to the original polling, never slower. Established
migration pattern: lib/widgets/queue-poll.ts (store), useAuditPoller.ts (hook),
and PR3's components/reports/ReportLibrary.tsx (mount-scoped list sub + bounded
transient poll — the cleanest recent exemplar).

EMIT LEDGER (who publishes what, as of PR3 — everything below is now SUBSCRIBED
except memo/pillar):
- queue: settlePage/discover/finalizer/enqueueAudit/failSiteAudit/pdf/psi/batch/
  cancel (PR1).
- site-audit:<id> + recents: worker claim/heartbeat-delta/terminal/requeue;
  site-audit-page settle; finalizer; broken-link-verify builder post-
  writeFindingsRun (PR2).
- ada-audit:<id> + recents: worker + standalone ada-audit onProgress (PR2).
- report:<id> + report-list: worker groupKey report:/seo-report:; seo-report-render
  child status + batch rollup; report-render PDF stamp; report create/delete/
  regenerate routes (PR3 Task 18).
- prospect-list: builder (PR2) + finalizer terminals/failSiteAudit/create/delete
  routes (PR3 Task 19).
- content-audit:<siteAuditId>: cat_ ingest PATCH (PR3 Task 20).
- audit-batch:<id> (PR1) + client-audit-summary (PR2): subscribed by
  QueueActiveView/ClientsAuditSummary (PR3 Task 21).
- memo:<sid> / pillar-analysis:<sid>: nothing yet (PR4).

RECORDED FOLLOW-UP (Kevin's call, non-blocking): report-render.ts (ADA site-audit
PDFs) also emits report-list, whose only subscribers are the C10 /reports UIs —
runtime-harmless cross-feature invalidation noise. PLAN-MANDATED as written, so
left as-specced; dropping it is a one-line cleanup if Kevin prefers.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test + npm run
  build before EVERY merge. npm run smoke is mandatory only if the PR touches
  auth/SF-upload/ADA-pipeline (PR4 memo routes/cards mostly don't; judge per diff.
  PR3 needed it because Task 19 touched finalizer + queue-manager).
- Array-form $transaction ONLY. publishInvalidation fires AFTER the awaited write
  resolves, OUTSIDE the tx, gated on count===1 (or write-resolved for plain
  update/create; a .update() P2025-throw counts as the fence — PR3 Task 20
  precedent). Emit can never fail the write.
- Topics are LITERAL strings (lib/events/topics.ts) — no Class.name deps.
- Component tests: // @vitest-environment jsdom + afterEach(cleanup), no jest-dom.
  vi.mock('@/lib/events/client') BEFORE importing a module-level store.
- Effects keyed on useQueueStatus()/useSyncExternalStore snapshots re-run on EVERY
  store tick (new ref, same content) — guard any timer/freeze-frame state against
  spurious re-runs (PR3 Task 21 fix a2e0933 is the cautionary tale + test recipe).
- The memo-poller-machine has its own bounded/backoff semantics — PR4 must add
  invalidate() WITHOUT breaking them (same "SSE only adds immediacy" rule as
  ContentAuditCard's mint→poll).
- Tests self-provision per-worker SQLite DBs, run PARALLEL. Absolute file: URLs
  for tooling DBs (Prisma resolves relative against prisma/).
- DateTime columns are INTEGER ms — raw SQL binds ${x.getTime()}.
- Never git add -A/-u at repo root (pentest-results/ etc untracked) — stage
  explicit paths. No backticks in Bash -m commit messages.
- .superpowers/sdd/task-N-*.md files are REUSED across PR series — a stale
  same-numbered brief/report from an old feature may exist; overwrite, don't trust
  (bit again in PR3: task-18-brief.md + base-pr3.txt were stale).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy. Load skill
er-seo-tools-change-control FIRST. Gate policy rules 1 & 4: merge gate-green PRs
(re-run gates in-session) + deploy with post-deploy verify autonomously;
destructive server ops Kevin-gated; spec→plan ungated. Docs ritual in the same
commit as any ship. Then execute A5 PR4 via subagent-driven-development from plan
Task 23.
```

---

## Current state (2026-07-12, A5 PR3 shipped + deployed)

- **Main** @ `65b9417` (A5 PR3 merge) + this docs commit. **Prod deployed on PR3**,
  healthy (`status:ok`, no crash-loop, no migration, no new env).
- **A5 → `[~]`:** PR1–PR3 of 4 shipped. PR3 completes the non-memo consumer
  topology: report/prospect/content-audit emit seams + all 7 remaining non-memo
  poller migrations (see the tracker's 2026-07-12 PR3 status line for the full
  inventory). Per-task reviews + opus whole-branch review clean; the Task-21
  review loop caught a real freeze-frame regression (fixed `a2e0933`,
  regression-tested). Gates: tsc · 4708 tests/534 files · build · smoke, all
  green in the merging session.
- **PR3 prod-verify:** autonomous checks pass (health, quiet error log,
  `/api/events` 401 gate, all five new topic literals intact in the minified
  prod client chunks). The live push-update watch needs Kevin's `er_auth`
  cookie — combined with PR2's outstanding watch, one browser session covers
  both. Not load-bearing for PR4.
- SDD ledger: `.superpowers/sdd/progress.md` (gitignored recovery map, PR1–PR3).
- **A7 `[x]`**, **C20 `[x]`** (volume dark pending DataForSEO creds), **C12 `[~]`**
  (Tier-2 future scope; D2/D3 deferred).
- **Kevin manual checks:** `todos/2026-07-11-kevin-manual-checks-tracker.md`.

## The single next item

**A5 PR4 (memos)** — plan Tasks 23–25, same SDD rhythm. Task 23:
`memo-poller-machine.invalidate()` + dirty-while-hidden + 20s active memo safety
cadence, WITHOUT breaking the machine's bounded/backoff semantics. Task 24: emit
`memo:<sid>`/`pillar-analysis:<sid>` at the memo write-back seams; migrate the 4
memo cards + `PillarAnalysisButtonClient`. Task 25: gates + deploy + prod-verify
+ docs ritual + **A5 CLOSE** (archive spec/plan; final `[x]` flip after Kevin's
live watches land).

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — authoritative this cycle.
Headline additions from PR3: store-snapshot effect re-runs vs timer state
(freeze-frame fix `a2e0933`); P2025-throw counts as an emit fence; stale SDD
scratch files bit again.

## C12 D1 follow-ups (still non-blocking)

- I2 (Low): a manual `npx tsx scripts/findings-rebuild.ts <id>` on a run-bearing
  audit would wipe an ingested `contentAuditJson`. Unreachable in normal flow.
- Retention canary: observe retained-`HarvestedPageSeo` count + DB-size delta +
  `sweepExpiredContentAudit` duration over a busy 2-hour window.
