# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (**A5 (SSE push layer) — SPEC + PLAN READY**, Codex/Sol
reviewed each (×10 / ×14), all fixes applied. A5 → `[~]`. Next: **implement PR1**.)
· **Updated by:** the A5 spec+plan session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. IN PROGRESS: A5 (shared status hook
→ SSE push layer). Spec + plan are WRITTEN, Codex/Sol-reviewed (accept-with-fixes
×10 spec / ×14 plan), all fixes applied and committed. A5 → [~]. NEXT: implement
PR1 via subagent-driven-development (or Kevin's chosen execution mode).

- Spec: docs/superpowers/specs/2026-07-11-a5-sse-push-layer-design.md
- Plan: docs/superpowers/plans/2026-07-11-a5-sse-push-layer.md (25 tasks / 4 PRs)

SCOPE (reshaped by discovery): the "shared status hook" half of A5 is ALREADY
built (useAuditPoller [C9-B/C17], lib/memo-poller-machine.ts, useRecentsLivePoll),
so A5 = the SSE notification layer + full consolidation of the ~9 remaining
hand-rolled pollers. Kevin chose the ambitious scope (SSE + full poller
consolidation), NOT hook-only.

ARCHITECTURE: one process-global in-memory bus (lib/events/bus.ts;
publishInvalidation(topic) called POST-COMMIT, outside the tx, gated on count===1,
synchronous + never-throws) → cookie-gated /api/events SSE route
(app/api/events/route.ts; runtime=nodejs, withRoute, X-Accel-Buffering:no +
no-transform, 503 over MAX_CONNECTIONS=100, 30-min finite lifetime, backpressure
via controller.desiredSize) → one shared per-tab EventSource (lib/events/client.ts;
generation-token reconnect + 45s watchdog + subscribeTopic/subscribeHealth,
manager-level visibilitychange) fanning {topic} invalidations to hooks that REFETCH
FROM THE DB. SSE is invalidation-only; DB stays source of truth; cadence is
transport-health-gated (fast until connected+own-refetch, then 60s safety / 20s
memo) so "SSE never connects" degrades to the ORIGINAL fast poll, never slower.

PR PLAN (each independently gate-green + shippable):
- PR1 = infra (bus + /api/events + client) + queue canary (SSE-aware
  lib/widgets/queue-poll.ts + migrate AuditIndexTabs off its inline poll) + the
  queue emit seams (settlePage/discover/finalizer/enqueue/fail/pdf/psi/batch/cancel
  route). *** PR1's prod-verify — that SSE actually STREAMS end-to-end through the
  Cloudflare/NGINX edge un-buffered — is THE make-or-break gate. curl -N through the
  real host; confirm connected-immediately + heartbeats at 15s/30s individually + a
  real settlePage-caused queue frame. If buffered and headers don't fix it: STOP,
  the layer is inert (safety poll holds correctness), flag the NGINX/Cloudflare
  proxy change to Kevin (server config = his domain), defer PR2-4. ***
- PR2 = audit progress (worker groupKey→topic emit w/ per-executeJob flush chain
  awaited before settle; useAuditPoller + useRecentsLivePoll SSE-aware).
- PR3 = reports / prospects / content-audit / batch / client-summary pollers.
- PR4 = memos (memo-poller-machine.invalidate() seam; keep 15-min cap + visibility
  pause; 4 memo cards + PillarAnalysisButtonClient).

KEY CODEX/SOL CATCHES BAKED INTO THE PLAN (don't re-derive):
- seoOnly completion race: emit site-audit:<id> AGAIN only after the live-scan
  CrawlRun commits (SiteAuditPoller deliberately polls past parent 'complete' via
  deriveSeoOnlyStatus until the run exists) — Task 14.
- ClaimedJob is a PRIVATE type in worker.ts (~line 26), NOT lib/jobs/types.ts; add
  groupKey there AND add groupKey:true to claimNext's select (type change alone =
  no runtime data) — Task 12.
- The worker heartbeat fake-timer test is KNOWN-IMPOSSIBLE (worker.progress.test.ts
  :36 documents it); extract a testable flushJobHeartbeat helper, test it directly —
  Task 13. Flush chain is per-executeJob (module-global would serialize all jobs)
  and AWAITED before terminal settle (else stale progress emits after settle).
- Route over-cap returns a REAL 503 (Retry-After:5), not a closed 200; lifetime
  expiry must close the controller too — Task 4.
- Private settlePage is driven via its job entry point (runSiteAuditPageJob), not
  imported; queue-poll test must vi.mock('@/lib/events/client') BEFORE importing the
  module-level store (else jsdom calls undefined native EventSource) — Tasks 8/10.

CODEX MODEL: Kevin's 2026-07-11 ruling — consultations use gpt-5.6-sol when the 5h
window has >25% remaining (5h used <75%), else gpt-5.6-terra; both high effort.
Encoded in the consulting-codex skill (Command shapes → Model, budget-gated via a
<MODEL> placeholder). Resuming a session recorded under the other model prints a
one-line warning then proceeds — expected, not a failure.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate (in-build tsc/eslint disabled since the
  2026-07-11 OOM fix). npx tsc --noEmit + npm test + npm run build, all green,
  before EVERY merge. PR1 touches the ADA/site-audit pipeline (settlePage/pdf/psi/
  finalizer) → `npm run smoke` is MANDATORY (macOS: export CHROME_EXECUTABLE first).
- SSE prod-divergence is THE risk (works dev, silently buffered prod). Do NOT trust
  a green local run — the PR1 prod-verify curl through the real edge is load-bearing.
- Tests self-provision a per-worker SQLite DB and run PARALLEL (pool:'forks',
  minForks:1/maxForks:4). .test-dbs/ is gitignored + rebuilt each run.
- Prisma resolves relative sqlite file: URLs against prisma/, not repo root — use
  ABSOLUTE file: paths for test/tooling DBs.
- DateTime columns are stored INTEGER ms; any raw-SQL DateTime comparison binds
  ${x.getTime()}, never a bare Date.
- Array-form $transaction ONLY (no interactive tx). publishInvalidation fires
  AFTER the awaited write resolves, OUTSIDE the tx, gated on count===1.
- Topics are LITERAL strings (lib/events/topics.ts) — no Class.name/minification
  risk (the parser-key + parse-seo-dom incidents).
- er-handoff-memo skill lives INSIDE this repo (skills/er-handoff-memo, symlinked
  to ~/.claude/skills). Never git add -A/-u at repo root (pentest-results/ +
  .playwright-mcp/ deletions + SEO_Report_1st_Draft.pdf + googlefc*.html are
  untracked/pre-existing) — stage explicit paths.
- Component tests: NO jest-dom → // @vitest-environment jsdom + afterEach(cleanup)
  + getByRole/getAllByText + .toBeTruthy()/.getAttribute().
- COMMIT MESSAGES: no backticks in -m strings via the Bash tool.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow. (DataForSEO is a DATA API. The LOCAL MiniLM embedding model is
on-box, zero network — not an AI API.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health"). Then execute A5 PR1
task-by-task from the plan (superpowers:subagent-driven-development or
executing-plans), starting at Task 1.

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) + deploy
with post-deploy verify; destructive server ops Kevin-gated; spec→plan ungated
(Codex each artifact, notify Kevin one line + path, don't wait). Docs ritual in
the same commit as any ship.
```

---

## Current state (2026-07-11, A5 spec+plan ready)

- **Main** @ `0e10706` (A7 COMPLETE) + the A5 spec/plan/tracker/handoff commits (no
  code shipped yet). **Prod on `4a03c82`** (A7 PR3), healthy (`status:ok`,
  version 0.2.0).
- **A5 → `[~]`:** spec + plan written and Codex/Sol-reviewed (×10 / ×14), all fixes
  applied. NO code yet. Next = implement PR1 (the SSE infra + queue canary +
  prod-verify gate). Spec/plan in the ACTIVE folders (`specs/`, `plans/`) — move to
  `archive/` only when A5 ships.
- **A7 → `[x]` COMPLETE.** Spec/plan archived.
- **C12 `[~]`:** Tier-0 (A+B) + Tier-1 (MiniLM topic-overlap) + D1 (`cat_` bridge)
  shipped. Tier-2 AI data-correctness = future scope, OFF per the no-AI-API gate.
  D2 (claim filter + recall eval) + D3 (incremental exports) deferred.
- **C20 `[x]`:** KS-1..5 MVP complete. Volume endpoint dark until DataForSEO creds
  land in prod `.env` (Kevin).
- **Kevin manual checks:** canonical tracker =
  `todos/2026-07-11-kevin-manual-checks-tracker.md`.

## The single next item

**A5 PR1** — the SSE infrastructure (`lib/events/bus.ts` + `app/api/events/route.ts`
+ `lib/events/client.ts`) + the queue canary + the **prod-verify SSE-streams-through-
the-edge gate**. Execute the plan task-by-task from Task 1. If PR1's prod-verify
shows the edge buffers SSE and headers don't fix it, STOP and escalate the proxy
change to Kevin before investing in PR2–4.

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — authoritative this cycle (SSE
prod-divergence is the headline risk; local-gates-only + mandatory `npm run smoke`
for PR1; per-worker parallel test DBs; Prisma schema-relative SQLite URLs; integer-ms
DateTime binds; array-form-tx + post-commit emit; literal topic strings; in-repo
skill + untracked clutter → explicit staging; no-jest-dom components; no backticks
in Bash `-m`). Plus the Codex-model budget-gating rule (sol >25% 5h remaining).

## C12 D1 follow-ups (still non-blocking)

- I2 (Low): a manual `npx tsx scripts/findings-rebuild.ts <id>` on a run-bearing
  audit would wipe an ingested `contentAuditJson`. Unreachable in normal flow.
- Retention canary: observe retained-`HarvestedPageSeo` count + DB-size delta +
  `sweepExpiredContentAudit` duration over a busy 2-hour window.
