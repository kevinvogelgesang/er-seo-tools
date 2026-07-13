# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-13 (**D4 COMPLETE — client-attached robots/sitemap
checks + history shipped + deployed + prod-verified in one session**: PR #166,
full pipeline brainstorm → spec (Codex ×8 fixes) → plan (Codex ×6 fixes) →
6-task subagent TDD (Task 5 fix loop: 2 race-guard Importants fixed +
regression-tested) → opus final review READY-TO-MERGE → gates 5197 tests/build
→ merge `f56f045` → deploy → prod-verify. `RobotsCheck` snapshots now persist
per (client, domain) with read-time changed flags; D5's hooks are in place
(`source:'scheduled'` entry point, stored robots bodies for diffs, childrenHash
change evidence). A5 unchanged: code-complete, `[x]` flip still gated only on
Kevin's live watches (D2 flips with it). Next build item: **D5** (or D6 if
Kevin decides build-vs-freeze).)
· **Updated by:** the D4 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE: D4 (client-attached
robots/sitemap checks + history) is COMPLETE — PR #166 merged (main f56f045),
deployed, prod-verified 2026-07-13; tracker status log 2026-07-13 has the
full entry; spec+plan archived. A5 (SSE push layer) remains [~]
CODE-COMPLETE, gated ONLY on Kevin's live authenticated watches; when they
pass, flip A5 to [x] AND mark D2 (memo arrival via SSE — A5 PR4 is its
substance) with a dated status-log line + handoff rewrite in the same
commit. A6 closed as absorbed into A8 — never build it.

KEVIN STEPS OUTSTANDING (one er_auth browser session on
https://seo.erstaging.site): (a) A5 live watches (Network tab on
/api/events): PR2 audit-progress frames, PR3 report/prospect/content-audit
push updates, PR4 memo write-back into its card via memo:<sid>; (b) NEW from
D4 — open any client page, run one Robots & Sitemap check, glance that the
card populates and a history row lands (routes/table prod-verified, first
live authenticated run not yet exercised); (c) D4 flagged in PR #166: the
worst-case check POST is ~75s (60s budget + one 15s in-flight fetch) — if a
long check 502s at the RunCloud/NGINX proxy, lower
ROBOTS_CHECK_TIME_BUDGET_MS; (d) still pending from D3: glance page-count
sanity of the next site audit (first prod exercise of lib/seo-fetch
discovery).

IMMEDIATE NEXT (build): D5 — scheduled robots/sitemap monitoring with
change-only alerts (3-4 days, roadmap 05-small-tools.md step 3): a weekly
job per client diffs robots.txt + sitemaps against the previous RobotsCheck
snapshot and raises alerts ONLY on state CHANGES (byte-identical fetch =
silence; re-observing a known issue = silence). A1 (job queue) done. D4
built its hooks: runAndStoreRobotsCheck(clientId, domain,
{source:'scheduled'}) is the entry point; read-time changed already compares
robotsStatus + robots contentHash + ordered sitemap
(url,contentHash,childrenHash) triples (childrenHash catches child-sitemap
churn under a byte-identical index); RobotsCheck.robotsContent stores the
raw body for "what changed" diff rendering (MUST be HTML-escaped when
rendered); retention keeps HISTORY_LIMIT+1 per (client,domain) so the
oldest visible changed flag never flips. Design questions D5 must settle:
alert channel (D7's Mailgun notify layer exists + is dark-gated), cadence
string (weekly: — Schedule rows precedent = C2 client scan schedules),
whether parser-upgrade issue-set changes (hashes unchanged) alert (Codex
flagged, deferred), and the two D4 accepted quirks if they matter to alert
counts: an 'unrecognized' convention probe double-counts one error in
totals; childrenExcluded is stored but not rendered. D6 (RankMath redirect
generator) still needs Kevin's build-or-freeze decision first — "decide,
don't drift". C6/C12 stay [~] for campaign-data/gated reasons, not build
work. Full pipeline for D5: brainstorm -> spec -> Codex review -> plan ->
Codex review -> subagent-driven TDD.

D4 REFERENCE (shipped architecture): lib/robots-check/ = types.ts
(client-safe; caps MAX_SITEMAPS 5 / MAX_CHILDREN 20 / HISTORY_LIMIT 20 /
TIME_BUDGET_MS 60s) + runner.ts (server-side, DI fetchers over FROZEN
lib/seo-fetch — zero new fetch paths; robots ok|missing(404/410)|unreachable;
declared-sitemap cap or convention probing where ONLY parseSitemapXml().valid
wins; budget-capped wrapper over the frozen collectSitemapPageUrls with
per-child (url,hash) observations + aggregate childrenHash + childrenExcluded
from the parent-final-host www-insensitive filter; honest flags
sitemapsSkipped/childrenSkipped/timeBudgetExhausted; returns {detail,
robotsContent}) + service.ts (single-flight per client:domain incl. the
derived-.finally() no-op-catch crash lesson; changed computed at READ time
only — never persisted, D5 can refine semantics without backfill; exact
total-order (createdAt,id) predecessor predicate at all three lookup sites +
per-domain out-of-window fallback; getRobotsCheck = the ONE {summary,detail}
shape) + retention.ts (keep LIMIT+1 per (client,domain), tagged $executeRaw,
in runCleanup). Routes GET/POST /api/clients/[id]/robots-checks +
GET .../[checkId] (cookie-gated, NO middleware change, strict ^[1-9][0-9]*$
ids, GET domain filter validates membership like POST).
components/clients/RobotsCheckCard.tsx on /clients/[id] (per-domain preload;
90s client deadline; POST-failure reconciliation refetches history AND
newest detail; genRef domain-switch token + expandedReqRef expand-race
guard; changed:null renders em dash NEVER "unchanged"). Migration
20260713100000. Sitemap XML is NEVER stored (hash+counts only) — D5 sitemap
alerts are hash/count/issue-diff based, by design.

RECORDED FOLLOW-UPS (non-blocking): (1) 'unrecognized' probe double-counts
one error in totals (measurement quirk). (2) childrenExcluded stored but
unrendered — D5 detail-view candidate. (3) route error-code drift
invalid_client vs invalid_id. (4) some fetch.test.ts failure branches use
toMatchObject not toEqual — cheap tightening. (5) kst latestSessionRef
vestigial write-only cache. (6) jose-version-coupled substring assertions in
token tests — check on any jose upgrade.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test +
  npm run build before EVERY merge. npm run smoke mandatory if the PR
  touches auth/SF-upload/ADA-pipeline or a component on a smoke-walked page
  (export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/
  Google Chrome" first on macOS).
- D5 likely needs a Schedule-row + job-handler pattern — follow C2's
  scheduled-site-audit precedent (lib/jobs/handlers/scheduled-site-audit.ts)
  and the extension-recipes skill for new job types; schema changes are
  hand-authored migration SQL (migrate dev is interactive-only), applied
  with DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy;
  array-form $transaction ONLY; DateTime columns are INTEGER ms — raw SQL
  binds ${x.getTime()}.
- New cookie-gated client routes need NO middleware change; anything public
  needs anchored middleware matchers + middleware.test.ts cases.
- Never weaken safeFetch/SSRF guards. Only scan client sites already in the
  system. lib/seo-fetch is FROZEN (51-test characterization gate) — consume,
  never modify.
- Tests self-provision per-worker SQLite DBs, run PARALLEL. Component
  tests: // @vitest-environment jsdom + afterEach(cleanup) +
  vi.unstubAllGlobals(), no jest-dom.
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
follow that; otherwise start D5 with superpowers:brainstorming.
```

---

## Current state (2026-07-13, D4 complete)

- **Main** @ `f56f045` (D4 PR #166 merge) + this docs commit. Prod deployed,
  healthy (health ok, migration `20260713100000` applied, `RobotsCheck`
  table live, new routes 401-gated, error log quiet).
- **D4 `[x]`** — see the tracker's 2026-07-13 status-log entry for the full
  record (Codex passes, review loop, gates, prod verification, Kevin steps).
- **A5 `[~]` code-complete** — Kevin's live watches are the only gate; D2
  flips with it.
- SDD ledger: `.superpowers/sdd/progress.md` (gitignored recovery map — the
  D4 section holds per-task commits + review outcomes).
- **Kevin manual checks:** `todos/2026-07-11-kevin-manual-checks-tracker.md`.

## The single next item

**D5 — scheduled robots/sitemap monitoring with change-only alerts
(3–4 days).** Weekly per-client job diffs the new `RobotsCheck` snapshots and
alerts ONLY on state changes (roadmap `05-small-tools.md` step 3; noise
controls are first-class: hash-identical = silence, re-observed known issue
= silence). Hooks already shipped in D4: `runAndStoreRobotsCheck(...,
{source:'scheduled'})`, read-time changed evidence incl. `childrenHash`,
raw `robotsContent` for diff rendering (escape it!), LIMIT+1 retention.
Design questions: alert channel (D7 Mailgun layer exists), cadence
mechanics (C2 Schedule-row precedent), parser-upgrade alert semantics.

**D6 needs a Kevin decision** (build the RankMath redirect generator or
freeze it as a doc) before any session picks it up — "decide, don't drift".

## Loose ends (small, non-blocking)

- D4 quirks accepted by the final review: `'unrecognized'` probe
  double-counts one error; `childrenExcluded` unrendered; route error-code
  drift (`invalid_client` vs `invalid_id`).
- Tighten the `toMatchObject` fetch.test.ts failure branches to `toEqual`
  (D3 accepted Minor).
- C12 D1 follow-ups (retention canary, findings-rebuild wipe edge) — see the
  C12 tracker entry.
