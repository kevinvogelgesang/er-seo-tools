# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-12 (**D3 COMPLETE — shared `lib/seo-fetch/` shipped +
deployed + prod-verified in one session**: PR #165, full pipeline
brainstorm → spec (Codex ×9 fixes) → plan (Codex ×7 fixes incl. an
empty-body browser-fallback blocker) → 8-task subagent TDD → opus final
review READY-TO-MERGE → gates 5148 tests/build/smoke → merge `3143fc3` →
deploy → prod-verify. The 3-robots-parsers/2-sitemap-parsers drift class is
closed; `SafeUrlError` now carries an additive typed `reason`. A5 unchanged:
code-complete, `[x]` flip still gated only on Kevin's live watches (D2 flips
with it). Next build item: **D4**.)
· **Updated by:** the D3 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE: D3 (shared
lib/seo-fetch/) is COMPLETE — PR #165 merged (main 3143fc3), deployed,
prod-verified 2026-07-12; tracker status log 2026-07-12 has the full entry;
spec+plan archived. A5 (SSE push layer) remains [~] CODE-COMPLETE, gated
ONLY on Kevin's live authenticated watches; when they pass, flip A5 to [x]
AND mark D2 (memo arrival via SSE — A5 PR4 is its substance) with a dated
status-log line + handoff rewrite in the same commit. A6 closed 2026-07-12
as absorbed into A8 — never build it.

KEVIN STEPS OUTSTANDING (one er_auth browser session on
https://seo.erstaging.site, Network tab on /api/events): (a) A5-PR2 — live
single-page ADA audit + site audit progress via ada-audit:<id>/
site-audit:<id>/recents frames; (b) A5-PR3 — report render / prospect scan /
content-audit ingest push-update without the old fast poll; (c) A5-PR4 — an
er-handoff-memo write-back (pat_/srt_/krt_/kst_) pushes the memo into its
card via memo:<sid>. Also new from D3: on the next site audit, discovery
runs through lib/seo-fetch for the first time in prod — glance at the page
count sanity of whichever scan runs next (locally pinned by the frozen
51-test characterization gate + smoke, so this is a glance, not a gate).

IMMEDIATE NEXT (build): D4 — client-attached robots/sitemap checks +
history (2-3 days): "validate against a client's domain" stores a
RobotsCheck snapshot (content hash, parsed result, issues) instead of
evaporating on refresh; only client-registered domains get rows (roadmap doc
05-small-tools.md steps 2-4). D3 built its hooks: lib/seo-fetch/fetch.ts
returns a discriminated-union SeoFetchResult with failure taxonomy
(http-error/not-xml/too-large/unsafe-url/dns/redirect/invalid-response/
timeout/network — SafeUrlError.reason backs it) and collectSitemapPageUrls
returns childrenTotal/childrenFailed diagnostics. After D4: D5 (scheduled
monitoring w/ change-only alerts — compare by content hash, alert only on
state CHANGES, needs A1 which is done). D6 (RankMath redirect generator)
needs a Kevin decision first: build or freeze as doc — "decide, don't
drift". C6/C12 stay [~] for campaign-data/gated reasons, not build work.
Full pipeline for D4: brainstorm -> spec -> Codex review -> plan -> Codex
review -> subagent-driven TDD.

D3 REFERENCE (shipped architecture): lib/seo-fetch/ = robots-parse.ts
(client-safe rich validator parser parseRobotsTxt/testUrlAgainstRobots/
KNOWN_AI_BOTS + shared comment-stripping extractSitemapUrls, agreement with
parseRobotsTxt test-pinned) + robots-match.ts (client-safe MINIMAL
crawl-frontier matcher, star-group-only/$-aware — intentionally distinct
from the validator matcher, NEVER unify) + sitemap-parse.ts (client-safe
parseSitemapXml validation + isSitemapIndex/extractPageLocs/
extractChildSitemapLocs) + fetch.ts (server-only, ALL I/O via safeFetch:
fetchRobotsTxt new URL('/robots.txt', base) contract; fetchSitemapXml gzip/
5MB-cap/HTML-reject with application/xhtml+xml ACCEPTED by design;
collectSitemapPageUrls ONE-level index expansion FROZEN, batch-of-5,
same-domain filter before fetch). sitemap-crawler.ts keeps discovery
orchestration behind ''/null-on-failure adapters — empty-200-body still
falls back to the browser fetch (test-pinned blocker); its 51 behavioral
tests are the FROZEN characterization gate: fix code, never those tests.
The ONLY D3 behavior change: Sitemap: extraction strips #-comments (D6
micro-delta, isolated commit 0ce7ea9). lib/validators/ and
lib/ada-audit/seo/robots-rules.ts are GONE.

RECORDED FOLLOW-UPS (non-blocking): (1) some fetch.test.ts failure branches
use toMatchObject not toEqual — cheap tightening. (2) report-render.ts also
emits report-list — one-line cleanup if Kevin prefers. (3) kst
latestSessionRef vestigial write-only cache. (4) jose-version-coupled
substring assertions in token tests — check on any jose upgrade. (5)
memo:<sessionId> shared across 3 memo families = cross-TAB extra idempotent
refetch only, plan-level design.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test +
  npm run build before EVERY merge. npm run smoke mandatory if the PR
  touches auth/SF-upload/ADA-pipeline or a component on a smoke-walked page
  (export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/
  Google Chrome" first on macOS).
- D4 is a schema change (RobotsCheck model) — hand-author migration SQL
  (migrate dev is interactive-only here), apply with
  DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy; array-form
  $transaction ONLY; DateTime columns are INTEGER ms — raw SQL binds
  ${x.getTime()}.
- New cookie-gated client routes need NO middleware change; anything public
  needs anchored middleware matchers + middleware.test.ts cases.
- Never weaken safeFetch/SSRF guards; SafeUrlError.reason additions must
  stay additive; audit-ci stays green. Only scan client sites already in
  the system.
- Tests self-provision per-worker SQLite DBs, run PARALLEL. Component
  tests: // @vitest-environment jsdom + afterEach(cleanup), no jest-dom.
- Never git add -A/-u at repo root (pentest-results/ etc untracked) — stage
  explicit paths. No backticks in Bash -m commit messages.
- .superpowers/sdd/task-N-*.md files are REUSED across PR series — a stale
  same-numbered brief/report may exist; overwrite, don't trust.
- UI: dark: variants on every element + the ThemeToggle mounted-guard
  hydration pattern.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy. Load skill
er-seo-tools-change-control FIRST. Gate policy rules 1 & 4: merge gate-green
PRs (re-run gates in-session) + deploy with post-deploy verify autonomously;
destructive server ops Kevin-gated; brainstorm->spec->plan ungated. Docs
ritual in the same commit as any ship. Then: if Kevin reports the live
watches passed, do the A5 [x] + D2 flip ritual; otherwise start D4 with
superpowers:brainstorming.
```

---

## Current state (2026-07-12, D3 complete)

- **Main** @ `3143fc3` (D3 PR #165 merge) + this docs commit. Prod deployed,
  healthy (health ok, error log quiet, scheduled jobs settling post-boot).
- **D3 `[x]`** — see the tracker's 2026-07-12 status-log entry for the full
  record (Codex passes, frozen-gate evidence, gates, prod verification).
- **A5 `[~]` code-complete** — Kevin's live watches are the only gate; D2
  flips with it.
- **A6 `[x]`** closed as absorbed into A8 (2026-07-12).
- SDD ledger: `.superpowers/sdd/progress.md` (gitignored recovery map — the
  D3 section holds per-task commits + review outcomes).
- **Kevin manual checks:** `todos/2026-07-11-kevin-manual-checks-tracker.md`.

## The single next item

**D4 — client-attached robots/sitemap checks + history (2–3 days).**
"Validate against a client's domain" stores a `RobotsCheck` snapshot
(content hash, parsed result, issues) instead of evaporating on refresh;
only client-registered domains get rows (roadmap `05-small-tools.md` step
2; step 3's scheduling is D5). Build on D3's hooks: the `SeoFetchResult`
failure taxonomy distinguishes "robots.txt is 404" from "timed out" from
"SSRF-blocked", and `collectSitemapPageUrls` surfaces
`childrenTotal`/`childrenFailed`. Schema change → feature-class pipeline +
migration procedure.

**D6 needs a Kevin decision** (build the RankMath redirect generator or
freeze it as a doc) before any session picks it up — "decide, don't drift".

## Loose ends (small, non-blocking)

- Tighten the `toMatchObject` fetch.test.ts failure branches to `toEqual`
  (opus final-review Minor, accepted).
- C12 D1 follow-ups (retention canary, findings-rebuild wipe edge) — see the
  C12 tracker entry.
