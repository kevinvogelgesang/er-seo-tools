# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-12 (**A5 PR2 (audit-progress topics) — SHIPPED + DEPLOYED**
PR #159/`65dce3f`; worker groupKey→topic emits + readiness re-emits +
useAuditPoller/useRecentsLivePoll SSE-aware; opus final review caught + fixed the
standalone ada-audit emit gap. PR2's live-audit SSE-frame prod-verify still wants
Kevin's `er_auth` cookie. A5 → `[~]`. Next: **PR3 (reports/prospects/content-audit/
batch/client-summary)**.)
· **Updated by:** the A5 PR2 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. IN PROGRESS: A5 (SSE push layer),
4-PR feature. PR1 (infra + queue canary) SHIPPED + DEPLOYED + PROD-VERIFIED
(PR #158, 55ae1d7 — SSE streams un-buffered through Cloudflare, gate passed).
PR2 (audit-progress topics) SHIPPED + DEPLOYED (PR #159, merge 65dce3f): worker
groupKey→topic emit (flushJobHeartbeat + per-executeJob flush chain awaited before
settle), readiness re-emits post-writeFindingsRun (builder + finalizer), standalone
ada-audit onProgress emit (final-review catch), useAuditPoller (30s/60s safety) +
useRecentsLivePoll (60s) SSE-aware. Gates were green (530 files/4654 tests + smoke).
KEVIN STEP OUTSTANDING: PR2 prod-verify of live SSE frames — open an authenticated
stream (er_auth cookie) to https://seo.erstaging.site/api/events, trigger a live
single-page ADA audit + a site audit, confirm ada-audit:<id>/site-audit:<id>/recents
frames arrive as progress commits (or just watch the audit page update with the
Network tab showing the stream, not 1s polling).

IMMEDIATE NEXT — PR3 (plan Tasks 18-22):
- Task 18 reports: emit reportTopic(id)+reportListTopic() from seo-report-render
  child/batch rollup + report-render PDF stamp + report create/delete/regenerate
  routes; migrate SiteAuditExportBar (2s → report:<id> + 30s safety),
  GenerateReportForm (2s/3s), ReportLibrary (5s → report-list + 60s).
- Task 19 prospects: emit at prospect scan settle (prospect-list emit from the
  live-scan builder already landed in PR2 Task 14); migrate ProspectDashboard
  (8s → prospect-list + 60s safety).
- Task 20 content-audit: emit contentAuditTopic(siteAuditId) at the ingest PATCH
  route; migrate ContentAuditCard (8s → content-audit:<id> + 60s, keep the bounded
  mint→poll semantics as safety backstop).
- Task 21 batch + client-summary: migrate QueueActiveView (5s → audit-batch:<id>,
  emit landed in PR1 Task 10) + ClientsAuditSummary (two 30s polls →
  client-audit-summary + queue topics, keep 30s safety; emit landed in PR2 Task 14).
- Task 22 gates + deploy + prod-verify + docs ritual.
Then PR4 (memos: memo-poller-machine.invalidate() + dirty-while-hidden, 4 memo
cards + PillarAnalysisButtonClient, Tasks 23-25) and A5 CLOSE (archive spec/plan).

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
migration pattern to copy: lib/widgets/queue-poll.ts (store) and
components/ada-audit/useAuditPoller.ts (hook) — topic + safety-interval props,
restartTimer(healthy), immediate refetch on invalidate.

EMIT LEDGER (who publishes what, as of PR2):
- queue: settlePage/discover/finalizer/enqueueAudit/failSiteAudit/pdf/psi/batch/
  cancel (PR1 Task 10).
- site-audit:<id> + recents: worker claim/heartbeat-delta/terminal/requeue (via
  topicForGroup(groupKey)); site-audit-page settle; finalizer transitions; the
  broken-link-verify builder AFTER writeFindingsRun commits (seoOnly readiness).
- ada-audit:<id> + recents: worker (groupKey ada-audit:<id>) + the standalone
  ada-audit handler's fenced onProgress write (fix 6efa0f5).
- report:<id>: worker groupKey report:/seo-report: → EMITTED BUT NOT YET SUBSCRIBED
  (PR3 Task 18 subscribes; job-level only — the render handlers' own stamps emit in
  Task 18).
- client-audit-summary + prospect-list: PR2 Task 14 (builder + finalizer dual-write
  .then) → NOT YET SUBSCRIBED (PR3 Tasks 18/19/21).
- audit-batch:<id>: PR1 Task 10 (ensureOpenBatch/closeBatchIfDrained) → NOT YET
  SUBSCRIBED (PR3 Task 21).
- memo:<sid> / pillar-analysis:<sid>: nothing yet (PR4).

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test + npm run
  build before EVERY merge. npm run smoke is mandatory only if the PR touches
  auth/SF-upload/ADA-pipeline (PR3 mostly doesn't — report-render/seo-report
  handlers are NOT the ADA page pipeline; judge per diff).
- Array-form $transaction ONLY. publishInvalidation fires AFTER the awaited write
  resolves, OUTSIDE the tx, gated on count===1 (or write-resolved for plain
  update/create). Emit can never fail the write.
- Topics are LITERAL strings (lib/events/topics.ts) — no Class.name deps.
- Component tests: // @vitest-environment jsdom + afterEach(cleanup), no jest-dom.
  vi.mock('@/lib/events/client') BEFORE importing a module-level store.
- Tests self-provision per-worker SQLite DBs, run PARALLEL. Absolute file: URLs
  for tooling DBs (Prisma resolves relative against prisma/).
- DateTime columns are INTEGER ms — raw SQL binds ${x.getTime()}.
- Never git add -A/-u at repo root (pentest-results/ etc untracked) — stage
  explicit paths. No backticks in Bash -m commit messages.
- .superpowers/sdd/task-N-*.md files are REUSED across PR series — a stale
  same-numbered brief/report from an old feature may exist; overwrite, don't trust.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy. Load skill
er-seo-tools-change-control FIRST. Gate policy rules 1 & 4: merge gate-green PRs
(re-run gates in-session) + deploy with post-deploy verify autonomously;
destructive server ops Kevin-gated; spec→plan ungated. Docs ritual in the same
commit as any ship. Then execute A5 PR3 via subagent-driven-development from plan
Task 18.
```

---

## Current state (2026-07-12, A5 PR2 shipped + deployed)

- **Main** @ `65dce3f` (A5 PR2 merge) + this docs commit. **Prod deployed on PR2**,
  healthy (`status:ok`, no crash-loop, no migration, no new env).
- **A5 → `[~]`:** PR1 + PR2 of 4 shipped. PR2 adds the audit-progress emit topology:
  worker (groupKey→topic, flush chain awaited before settle), readiness re-emits
  (builder post-writeFindingsRun + finalizer dual-write .then), standalone
  ada-audit onProgress emit, SSE-aware useAuditPoller + useRecentsLivePoll.
  Per-task reviews clean; opus whole-branch review "with fixes" → all 3 findings
  fixed (`6efa0f5`) + re-verified. Gates: tsc · 4654 tests/530 files · build ·
  smoke, all green in the merging session.
- **PR2 prod-verify:** autonomous checks pass (health, clean restart, error-log
  quiet). The live-audit SSE-frame watch (trigger a real audit while holding an
  authenticated /api/events stream) needs Kevin's `er_auth` cookie — same
  Kevin-step as PR1's streaming gate. Not load-bearing for PR3 (transport already
  prod-proven in PR1; PR2 is emit seams + hooks, all locally verified + smoke-run),
  but do it before calling A5 complete.
- SDD ledger: `.superpowers/sdd/progress.md` (gitignored recovery map, PR1+PR2).
- **A7 `[x]`**, **C20 `[x]`** (volume dark pending DataForSEO creds), **C12 `[~]`**
  (Tier-2 future scope; D2/D3 deferred).
- **Kevin manual checks:** `todos/2026-07-11-kevin-manual-checks-tracker.md`.

## The single next item

**A5 PR3 (reports / prospects / content-audit / batch / client-summary)** — plan
Tasks 18–22, same SDD rhythm. Emit seams: report handlers/routes (Task 18) +
content-audit ingest PATCH (Task 20); the prospect-list / client-summary /
audit-batch emits ALREADY landed (PR2 Task 14 / PR1 Task 10) — PR3 mostly
subscribes. Poller migrations: SiteAuditExportBar, GenerateReportForm,
ReportLibrary, ProspectDashboard, ContentAuditCard, QueueActiveView,
ClientsAuditSummary. Copy the queue-poll.ts / useAuditPoller.ts health-gated
cadence pattern. Then PR4 (memos, Tasks 23–25) closes A5.

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — authoritative this cycle. Headline:
emits post-commit/outside-tx/effect-gated; literal topics; health-gated cadence
never slower than the original poll; stale same-numbered SDD brief/report files;
smoke only when the diff touches auth/SF/ADA pipeline.

## C12 D1 follow-ups (still non-blocking)

- I2 (Low): a manual `npx tsx scripts/findings-rebuild.ts <id>` on a run-bearing
  audit would wipe an ingested `contentAuditJson`. Unreachable in normal flow.
- Retention canary: observe retained-`HarvestedPageSeo` count + DB-size delta +
  `sweepExpiredContentAudit` duration over a busy 2-hour window.
