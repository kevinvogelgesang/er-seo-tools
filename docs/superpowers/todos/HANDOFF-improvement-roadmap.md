# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-14 (**A5 + D2 shipped-verified and flipped `[x]`, and
D6 FROZEN — the roadmap now has no ungated and no Kevin-gated build item
left.** A5/D2: Kevin live-watched the SSE push layer in a Playwright session
on `seo.erstaging.site` (PR1 connected+heartbeat, PR2 live site-audit/queue
frames, PR4 a real `srt_` memo write-back firing `memo:<sessionId>` 126 ms
post-PATCH with the card auto-rendering; + cross-page fan-out + 3/5 PR3 topics;
report/prospect/content-audit accepted as sharing the proven transport). Same
session closed the D3 page-count glance (canary 24/24) and exercised D4
(manual Beal robots check rendered + flagged `changed`). D6 (RankMath redirect
generator): Kevin's call — **FROZEN**, descoped, existing `/rankmath-redirects`
guide stands. **The sole standing direction is now the SF-parity campaign.**)
· **Updated by:** the A5/D2 + D6-freeze session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE (2026-07-14): the roadmap
is effectively DONE except campaign work. A5 (SSE push layer) + D2 (memo via
SSE) are COMPLETE — live-watch verified in a Playwright session on
seo.erstaging.site (tracker Status log 2026-07-14). D6 (RankMath redirect
generator) is FROZEN by Kevin — descoped, do NOT build; the /rankmath-redirects
guide page is the substitute. A6 absorbed into A8 (never build). D3/D4/D5/D7 all
[x].

THE ONLY REMAINING WORK is the two campaign-gated [~] items and the campaign
itself:
  - C6 hybrid-discovery Increment 2 (the real crawler) — gated on SF-parity
    evidence.
  - C12 tier promotions (content-signals/topic-overlap → Finding/score) —
    gated on SF-parity evidence + Kevin sign-off.
  - STANDING DIRECTION: the SF-parity campaign (Kevin, 2026-07-13: "I'll be
    unblocking the remaining, then we'll move onto the SF parity"). Both are
    unblocked now. Load skill er-seo-tools-sf-retirement-campaign and start
    measurement-first: pick a client with a fresh SF upload, run a seoOnly
    live scan on the same domain, compare findings/scores, record parity gaps
    in the campaign doc. The Manhattan SF crawl export memory is the reusable
    fixture.

KEVIN STEPS OUTSTANDING (small, non-blocking, none block the campaign):
  (a) D5 first natural sweep: after Monday 2026-07-20 ~06:30 UTC, glance that
      scheduled RobotsCheck rows appeared for all client domains, and if a
      real change happened that ONE alert email landed at NOTIFY_ADMIN_EMAIL
      (prod notify env is DARK by design → no email; in-app "changed" badge
      is the real signal).
  (b) D3: optional glance of the page-count on the next real (non-canary)
      site audit (canary already sanity-checked at 24/24).

A5/D2 REFERENCE (for when a memo/audit push misbehaves): one shared
EventSource per tab (lib/events/client.ts) — an INVALIDATION bus, not a
data-push stream. Server emits named frames: connected on open, periodic
heartbeat, invalidate with {topic} payload, server-restart. /api/events is
param-less and receives ALL invalidate frames; the CLIENT filters by topic
(subscribeTopic). Topics seen live: site-audit:<id>, queue, audit-batch:<id>,
recents, client-audit-summary, memo:<sessionId>. Memo cards use useMemoPoller
-> subscribeTopic('memo:'+sid) -> refetch on frame. Manual verify: in DevTools
open an EventSource('/api/events'), addEventListener('invalidate', e=>console
.log(e.data)), then trigger the action.

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
  never modify.
- Prod box has NO sqlite3 CLI — prod DB probes go through node + the app's
  generated Prisma client from $APP_HOME.
- Tests self-provision per-worker SQLite DBs, run PARALLEL. Component
  tests: // @vitest-environment jsdom + afterEach(cleanup) +
  vi.unstubAllGlobals(), no jest-dom. Suite cleanup deletes ONLY owned rows.
- Never git add -A/-u at repo root (pentest-results/ etc untracked) — stage
  explicit paths. No backticks in Bash -m commit messages.
- UI: dark: variants on every element + the ThemeToggle mounted-guard
  hydration pattern; date rendering pins timeZone UTC when server-preloaded.

RECORDED FOLLOW-UPS (non-blocking): (1) A5 PR3 report/prospect/content-audit
emit-sites never literally watched (transport proven, autonomous checks
passed — flip accepted). (2) D5 changed-alert EMAIL path not yet
prod-exercised (first natural exercise = a real change under a weekly sweep).
(3) D4 resolveListedDomain compares normalized-vs-RAW stored Client.domains —
API data is always normalized so likely zero rows; one-line parity fix
available. (4) misc carried minors: 'unrecognized' probe double-counts one
error in totals; fetch.test.ts toMatchObject tightening; kst latestSessionRef
vestigial; jose-version-coupled token-test assertions.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy. Load skill
er-seo-tools-change-control FIRST, then er-seo-tools-sf-retirement-campaign.
Gate policy rules 1 & 4: merge gate-green PRs (re-run gates in-session) +
deploy with post-deploy verify autonomously; destructive server ops
Kevin-gated; brainstorm->spec->plan ungated. Docs ritual in the same commit as
any ship. Begin the SF-parity campaign measurement-first (per the paste above).
```

---

## Current state (one paragraph)

Roadmap spine complete: A1 job queue, A2 findings layer, A3 route kit, A4
logging/observability, A5 SSE push layer, A7 (auth/testing hardening),
A8 app-shell, B-series, C-series through C20, D0, D1 (handoff engine),
D2 (memo-via-SSE), D3 (seo-fetch), D4 (client robots checks), D5 (scheduled
robots monitoring), D7 (scan emails) are all [x]; D6 (RankMath redirect
generator) is FROZEN [x]; A6 absorbed into A8. The ONLY remaining work is the
two campaign-gated [~] items — C6 hybrid-discovery Increment 2 and C12 tier
promotions — both now unblocked and pursued through the SF-retirement parity
campaign, which is the sole standing direction.
