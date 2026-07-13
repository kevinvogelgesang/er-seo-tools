# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-13 (**D5 COMPLETE — scheduled robots/sitemap
monitoring with change-only alerts shipped + deployed + prod-verified in one
session**: PR #167, full pipeline brainstorm → spec (Codex ×8 fixes) → plan
(Codex ×6 fixes, incl. the slot-boundary idempotency hole) → 8-task subagent
TDD (zero fix loops — every task review-clean first pass) → fable final
review READY-TO-MERGE → gates 5243 tests/build → merge `025729b` → deploy →
prod-verify incl. one real robots-monitor job exercised end-to-end on
beal.edu. The weekly `system-robots-monitor` schedule is live, first sweep
2026-07-20 06:30 UTC. A5 unchanged: code-complete, `[x]` flip still gated
only on Kevin's live watches (D2 flips with it). **No ungated build item
remains** — next is Kevin's unblocks (A5 watches, D6 decision) and then the
SF-parity campaign.)
· **Updated by:** the D5 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE: D5 (scheduled
robots/sitemap monitoring with change-only alerts) is COMPLETE — PR #167
merged (main 025729b), deployed, prod-verified 2026-07-13; tracker status
log 2026-07-13 has the full entry; spec+plan archived. The weekly
system-robots-monitor schedule is live (weekly:1@06:30 server-local=UTC,
immediate:false) — FIRST SWEEP FIRES 2026-07-20 ~06:30 UTC. A5 (SSE push
layer) remains [~] CODE-COMPLETE, gated ONLY on Kevin's live authenticated
watches; when they pass, flip A5 to [x] AND mark D2 (memo arrival via SSE —
A5 PR4 is its substance) with a dated status-log line + handoff rewrite in
the same commit. A6 closed as absorbed into A8 — never build it. D4+D5 are
both [x].

NO UNGATED BUILD ITEM REMAINS on the roadmap. Everything left is either
Kevin-gated or campaign work: D6 (RankMath redirect generator) needs Kevin's
build-or-freeze decision ("decide, don't drift"); C6 hybrid-discovery
Increment 2 + C12 Tier promotions stay [~] pending campaign
data/sign-offs; the standing direction after Kevin's unblocks is the SF
parity campaign (Kevin, 2026-07-13: "I'll be unblocking the remaining, then
we'll move onto the SF parity") — load skill
er-seo-tools-sf-retirement-campaign for that work (parity measurement on
real client crawls, sf-upload vs live-scan comparison; the Manhattan SF
crawl export memory is the reusable fixture).

KEVIN STEPS OUTSTANDING (one er_auth browser session on
https://seo.erstaging.site): (a) A5 live watches (Network tab on
/api/events): PR2 audit-progress frames, PR3 report/prospect/content-audit
push updates, PR4 memo write-back into its card via memo:<sid>; (b) from
D4 — open any client page, run one Robots & Sitemap check, glance card +
history row (Beal University already has one SCHEDULED row from the D5
prod-verify — a manual run on beal.edu will show a changed/no-change badge
against it); (c) D6 build-or-freeze decision; (d) still pending from D3:
glance page-count sanity of the next site audit; (e) NEW from D5 — after
Monday 2026-07-20, glance that scheduled rows appeared for all client
domains, and if a real change happened, that ONE alert email landed at
NOTIFY_ADMIN_EMAIL (dark env = no email by design; in-app changed badge
still shows).

D5 REFERENCE (shipped architecture): weekly system-robots-monitor Schedule
(SYSTEM_SCHEDULES, immediate:false) -> lib/jobs/handlers/
robots-monitor-sweep.ts (fan-out: active clients, normalizeClientDomain-
normalized + Set-deduped domains, dedupKey robots-monitor:<clientId>:
<domain>, payload carries slotStartedAt = the SWEEP job's createdAt — the
durable reuse boundary that survives child re-enqueues after terminal
siblings) -> lib/jobs/handlers/robots-monitor.ts per-domain handler,
ORDER IS LOAD-BEARING: revalidate FIRST every path (archived/delisted
silent; membership over the NORMALIZED stored domains list) -> slot-scoped
reuse (createdAt >= slotStartedAt, newest scheduled row; retries never
refetch; prior week never reuses; fallback boundary = own Job.createdAt) ->
fresh run source-fence (manual single-flight winner absorbs silently —
manual checks NEVER alert) -> resolve via getRobotsCheck (StoredRobotsCheck
now carries changeSummary on BOTH service paths, computed by client-safe
pure lib/robots-check/change-summary.ts: multiset robots diff capped
50 lines/200 chars, (url,ordinal)-paired sitemap deltas, robotsContentChanged/
orderChanged honesty flags, NULL diff = "line diff unavailable" vs non-null
EMPTY = "reordering or formatting only" — never conflate) -> alert ONLY on
changed === true: alertSentAt marker read (migration 20260713120000) ->
dark gate (isNotifyEnabled() false = PERMANENT suppression, no stamp, no
catch-up) -> buildRobotsChangeEmail (lib/notify/robots-change-content.ts,
escaped, transport-honest: "could not be fetched (timeout)" never
"removed") to notifyAdminEmail() -> conditional stamp updateMany({id,
alertSentAt: null}) (at-least-once). Change-only semantics: byte-identical =
silence; re-observed broken state = silence; parser-upgrade issue-set
changes = silence (deferred by design); changed:null = silence. Card:
expanded history rows render changeSummary as "Changed vs previous" +
childrenExcluded line (D4 follow-up #2 closed). Handler config: monitor
concurrency 1 / maxAttempts 2 / timeout 120s, sweep 1/3/30s.

ACCEPTED v1 TRADE-OFFS (spec "Flags for Kevin"): one-observation
transient-fetch alerts (a single timeout emails with honest wording,
recovery emails again — confirmation-refetch is the recorded follow-up if
flapping proves noisy); manual checks absorb changes silently; a change
whose email exhausts both attempts is lost AS EMAIL (in-app badge remains).

RECORDED FOLLOW-UPS (non-blocking): (1) NEW from D5 final review:
resolveListedDomain (D4 routes) compares normalized submitted domain vs RAW
stored Client.domains list — a legacy non-normalized stored entry could be
monitored+alerted under a domain the card 400s history for; API-written
data is always normalized so likely zero rows affected; one-line fix =
normalize the stored list inside resolveListedDomain (exact parity with the
monitor). (2) changed-alert email path not yet prod-exercised (unit-covered;
first natural exercise = a real change under a weekly sweep). (3) email
esc() omits &#39; vs content.ts sibling (inert — double-quoted attrs only).
(4) carried from D4: 'unrecognized' probe double-counts one error in totals;
route error-code drift invalid_client vs invalid_id; fetch.test.ts
toMatchObject tightening; kst latestSessionRef vestigial; jose-version-
coupled substring assertions in token tests.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test +
  npm run build before EVERY merge. npm run smoke mandatory if the PR
  touches auth/SF-upload/ADA-pipeline or a component on a smoke-walked page
  (export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/
  Google Chrome" first on macOS).
- Schema changes are hand-authored migration SQL (migrate dev is
  interactive-only), applied with DATABASE_URL="file:./local-dev.db" npx
  prisma migrate deploy; array-form $transaction ONLY; DateTime columns are
  INTEGER ms — raw SQL binds ${x.getTime()}.
- New cookie-gated client routes need NO middleware change; anything public
  needs anchored middleware matchers + middleware.test.ts cases.
- Never weaken safeFetch/SSRF guards. Only scan client sites already in the
  system. lib/seo-fetch is FROZEN (51-test characterization gate) — consume,
  never modify. The D4 runner (lib/robots-check/runner.ts) is likewise
  settled — D5 consumed it without edits.
- Prod box has NO sqlite3 CLI — prod DB probes go through node + the app's
  generated Prisma client from /home/seo/webapps/seo-tools (D5 precedent).
- Tests self-provision per-worker SQLite DBs, run PARALLEL. Component
  tests: // @vitest-environment jsdom + afterEach(cleanup) +
  vi.unstubAllGlobals(), no jest-dom. Suite cleanup deletes ONLY owned rows
  (recorded ids / PREFIX-scoped / dedupKey-prefix) — never type-wide.
- Never git add -A/-u at repo root (pentest-results/ etc untracked) — stage
  explicit paths. No backticks in Bash -m commit messages.
- .superpowers/sdd/task-N-*.md files are REUSED across PR series — a stale
  same-numbered brief/report may exist; overwrite, don't trust.
- UI: dark: variants on every element + the ThemeToggle mounted-guard
  hydration pattern; date rendering pins timeZone UTC when server-preloaded.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy. Load skill
er-seo-tools-change-control FIRST. Gate policy rules 1 & 4: merge gate-green
PRs (re-run gates in-session) + deploy with post-deploy verify autonomously;
destructive server ops Kevin-gated; brainstorm->spec->plan ungated. Docs
ritual in the same commit as any ship. Then: if Kevin reports the live
watches passed, do the A5 [x] + D2 flip ritual; if Kevin has decided D6,
follow that (build = full pipeline; freeze = docs-only tracker close-out);
otherwise begin the SF-parity campaign via
er-seo-tools-sf-retirement-campaign (measurement-first: pick a client with
a fresh SF upload + run a seoOnly live scan on the same domain, compare
findings/scores, record parity gaps in the campaign doc).
```

---

## Current state (one paragraph)

Roadmap spine complete: A1 job queue, A2 findings layer, A3 route kit, A4
logging/observability, A7 (via D0/D7), B-series, C-series through C20, D0,
D1 (handoff engine), D3 (seo-fetch), D4 (client robots checks), D5
(scheduled robots monitoring), D7 (scan emails) are all [x]. A5 is
code-complete awaiting Kevin's live watches (D2 rides on it). A6 absorbed
into A8. D6 awaits a build-or-freeze decision. C6 hybrid-discovery
Increment 2 and C12 tier promotions are campaign-gated (SF-parity
evidence + Kevin sign-offs). The next substantive work after Kevin's
unblocks is the SF-retirement parity campaign.
