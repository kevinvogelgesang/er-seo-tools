# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-14 (**A5 + D2 COMPLETE — the SSE push layer's live
watches passed and both flipped `[x]`.** Kevin ran a guided Playwright session
on `seo.erstaging.site` (his own `er_auth` login); an injected
`EventSource('/api/events')` probe recorded named frames while real actions
were driven. Verified: PR1 `connected`+`heartbeat` (holds through Cloudflare);
PR2 re-queued the canary → 24 `invalidate` frames (`site-audit:*`/`queue`/
`audit-batch`/`recents`) + Current Scan panel updated live; PR4 a REAL `srt_`
roadmap authored via the er-handoff-memo skill → `memo:<sessionId>` fired
126 ms after the PATCH and the card auto-rendered with no reload. Also saw
cross-page fan-out + 3 of PR3's 5 topics. PR3's report/prospect/content-audit
emit-sites weren't literally watched but share the proven transport + passed
autonomous checks — Kevin accepted and flipped. Same session also closed the
**D3** page-count glance (canary 24/24) and exercised **D4** (manual Beal
robots check rendered + flagged `changed` vs the D5 scheduled row).
**No ungated build item remains** — next is Kevin's D6 build-or-freeze
decision, then the SF-parity campaign.)
· **Updated by:** the A5/D2 live-watch session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE: A5 (SSE push layer) and
D2 (memo arrival via SSE) are both COMPLETE as of 2026-07-14 — live-watch
verified in a Playwright session on seo.erstaging.site (tracker Status log
2026-07-14 has the full method + evidence; A5 spec/plan already archived on
the 2026-07-12 ship). D3 page-count glance done (canary 24/24). D4 exercised
live (manual Beal robots check rendered + flagged "changed"). A6 closed as
absorbed into A8 — never build it. D3/D4/D5/D7 all [x].

NO UNGATED BUILD ITEM REMAINS on the roadmap. Everything left is either
Kevin-gated or campaign work:
  - D6 (RankMath redirect generator + dry-run + post-deploy verifier) needs
    Kevin's BUILD-OR-FREEZE decision ("decide, don't drift"). Build = full
    brainstorm->spec->Codex->plan->Codex->TDD pipeline; freeze = docs-only
    tracker close-out (mark [x]-as-frozen with a status-log line).
  - C6 hybrid-discovery Increment 2 + C12 Tier promotions stay [~] pending
    SF-parity campaign data / Kevin sign-offs.
  - The STANDING DIRECTION after Kevin's unblocks is the SF-parity campaign
    (Kevin, 2026-07-13: "I'll be unblocking the remaining, then we'll move
    onto the SF parity"). Load skill er-seo-tools-sf-retirement-campaign:
    measurement-first — pick a client with a fresh SF upload, run a seoOnly
    live scan on the same domain, compare findings/scores, record parity gaps
    in the campaign doc. The Manhattan SF crawl export memory is the reusable
    fixture.

KEVIN STEPS OUTSTANDING (small, non-blocking):
  (a) D6 build-or-freeze decision (the one real decision gating the queue).
  (b) D5 first natural sweep: after Monday 2026-07-20 ~06:30 UTC, glance that
      scheduled RobotsCheck rows appeared for all client domains, and if a
      real change happened that ONE alert email landed at NOTIFY_ADMIN_EMAIL
      (prod notify env is DARK by design → no email; in-app "changed" badge
      still shows — that's the real signal).
  (c) D3: optional glance of the page-count on the next real (non-canary)
      site audit (canary already sanity-checked at 24/24).

A5/D2 REFERENCE (shipped architecture, for when a memo/audit push misbehaves):
one shared EventSource per tab (lib/events/client.ts) — an INVALIDATION bus,
not a data-push stream. Server emits named frames: `connected` on open,
periodic `heartbeat`, `invalidate` with {topic} payload, `server-restart`.
The /api/events connection is param-less and receives ALL invalidate frames;
the CLIENT filters by topic locally (subscribeTopic). Topics seen live:
site-audit:<id>, queue, audit-batch:<id>, recents, client-audit-summary,
memo:<sessionId>. Memo cards use useMemoPoller -> subscribeTopic('memo:'+sid)
-> refetch on frame. To verify any push manually: in DevTools console open an
EventSource('/api/events'), addEventListener('invalidate', e=>console.log
(e.data)), then trigger the action.

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
  generated Prisma client from /home/seo/webapps/seo-tools.
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
prod-exercised (unit-covered; first natural exercise = a real change under a
weekly sweep). (3) D4 resolveListedDomain compares normalized-vs-RAW stored
Client.domains — API data is always normalized so likely zero rows; one-line
parity fix available. (4) misc carried minors: 'unrecognized' probe
double-counts one error in totals; fetch.test.ts toMatchObject tightening;
kst latestSessionRef vestigial; jose-version-coupled token-test assertions.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy. Load skill
er-seo-tools-change-control FIRST. Gate policy rules 1 & 4: merge gate-green
PRs (re-run gates in-session) + deploy with post-deploy verify autonomously;
destructive server ops Kevin-gated; brainstorm->spec->plan ungated. Docs
ritual in the same commit as any ship. Then: if Kevin has decided D6, follow
that (build = full pipeline; freeze = docs-only tracker close-out);
otherwise begin the SF-parity campaign via
er-seo-tools-sf-retirement-campaign (measurement-first, per the paste above).
```

---

## Current state (one paragraph)

Roadmap spine complete: A1 job queue, A2 findings layer, A3 route kit, A4
logging/observability, A5 SSE push layer, A7 (auth/testing hardening),
A8 app-shell, B-series, C-series through C20, D0, D1 (handoff engine),
D2 (memo-via-SSE), D3 (seo-fetch), D4 (client robots checks), D5 (scheduled
robots monitoring), D7 (scan emails) are all [x]. A6 absorbed into A8. The
only open items are D6 (awaiting a build-or-freeze decision) and the
campaign-gated work — C6 hybrid-discovery Increment 2 and C12 tier promotions
(SF-parity evidence + Kevin sign-offs). No ungated build item remains; the
next substantive work is the SF-retirement parity campaign.
