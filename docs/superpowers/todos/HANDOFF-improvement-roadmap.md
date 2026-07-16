# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-16 evening (**first sweep TEST RUN complete — 29/29,
zero failures, 4h40m drain, 100% snapshot coverage, digest emailed. Both
2026-07-16 incident defenses held end-to-end, including through an unplanned
mid-sweep deploy. NEXT ITEM: sweep error triage (Kevin request), then the
SF-parity campaign.**) · **Updated by:** the verifier-fix + C21-deploy +
sweep-test session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE (2026-07-16 evening):
verifier memory/loop fix SHIPPED (PR #186), C21 weekly sweep DEPLOYED, and a
manually-fired FULL TEST SWEEP ran same day: 29/29 audits complete in 4h40m,
zero failures/placeholders/guard-trips, snapshot coverage 100%, digest
emailed to support@ attempt-1, /issues live. Spec-§11 recorded. A parallel
viewbook-lane deploy bounced the app mid-sweep and the durable queue resumed
with zero losses. Full report: docs/superpowers/todos/2026-07-16-first-sweep-report.md
(READ IT FIRST — it is the source for the next item). The real weekly
cadence is untouched: next sweep fires automatically Mon 2026-07-20 01:00
UTC, digest 14:00 UTC.

THE NEXT ITEM (Kevin request): SWEEP ERROR TRIAGE — ~116 page-level errors
across 21 domains from the test run, four buckets in the report:
  1. Client sitemap hygiene (~85 real 404s; healthcarecareercollege.edu 35,
     cw.edu ~13, innovatesalonacademy.com 11, rest 1-4 each) — CLIENT work,
     surfaced for the support workflow; decide whether page-level 404s
     should surface as /issues groups (today they are audit errors, not
     findings).
  2. /cdn-cgi/l/email-protection pseudo-pages in the audited set (~8
     domains) — TOOL fix: exclude /cdn-cgi/ paths at discovery/harvest
     (one-line filter + test in the discovery/link-harvest layer).
  3. Transient Chrome "Protocol error (Target.createTarget)" (6 pages) —
     TOOL fix: one page-level retry before settling the child as error
     (respect the architecture contract's domain-vs-infrastructure error
     split and the deliberately-narrow retry layers).
  4. HTTP 301 "puppeteer did not auto-follow" (~8 pages) — INVESTIGATE:
     odd http/https flip-flop chains suggest a runner redirect-
     normalization quirk; some are legit client redirect findings.
  5. Sweep unit-map gap (found post-digest): 35 sweep_unmapped_issue_unit
     logError events at snapshot compute — validation finding types
     (redirect_chain x26, canonical_broken x7, canonical_redirect,
     canonical_external_unverified) missing from snapshot.ts's unit map,
     falling back to "groups" units. TOOL fix: add them to the unit map +
     test.
  PLUS the real-data finding: coverage reason label says "timed-out" for
  ALL partial pairs (23/29 domains) when the true cause was pagesError>0 —
  fix the reason vocabulary in lib/sweep/classify.ts+snapshot.ts (the C21
  final-review "label-only" follow-up, now priority-bumped: the digest
  tells support "timed out" 23 times falsely).
  Buckets 2-4 + the label fix are one small feature-class pipeline
  (brainstorm -> spec -> Codex -> plan -> Codex -> TDD; they are small —
  consider one combined spec). Bucket 1 is a Kevin/support workflow
  decision, not code.

AFTER THE TRIAGE: the SF-parity campaign resumes
(er-seo-tools-sf-retirement-campaign skill) + the two campaign-gated [~]
items (C6 hybrid-discovery Increment 2; C12 tier promotions).

MONDAY 2026-07-20: the automatic sweep needs NO babysitting (test proved
it). Optional glance: digest email lands ~14:00 UTC; D5's first robots
sweep fires 06:30 UTC same morning (in-app "changed" badge; notify dark
for robots alerts).

VERIFIER-FIX FACTS (shipped 2026-07-16, PR #186):
- Exhausted verifiers write a terminal placeholder run
  (lib/findings/exhausted-placeholder.ts); recovery never re-enqueues one;
  read surfaces gate on isPlaceholderRun -> "SEO analysis unavailable";
  a later successful build self-heal-replaces the placeholder.
- VERIFIER_TOPIC_OVERLAP_ENABLED DEFAULT OFF (Codex ONNX ruling) —
  topic-overlap cards read "not analyzed" until the ONNX follow-up lands
  (child-process embed worker / dispose fencing / chunk benchmark) and
  Kevin flips the env. Test run confirmed: null on all 29 runs.
- Env vars all optional-with-defaults: VERIFIER_RSS_GUARD_MB (1600),
  CONTENT_TEXT_TOTAL_BYTE_BUDGET (24MB), VERIFIER_TOPIC_OVERLAP_ENABLED.
- broken-link-verify.characterization.test.ts is a FROZEN byte-identical
  gate on the builder happy path — re-pin deliberately on any behavior
  change. Dev profiler: scripts/profile-verifier-memory.ts.

KEVIN QUESTIONS OUTSTANDING: (a) proway.erstaging.site (staging) is in the
weekly sweep cohort as client 31 — intentional? (b) sales MethodExplainer
renders beside the SEO-unavailable note (copy call). (c) D3 optional
page-count glance on the next real site audit. (d) the ~7 incident audits'
empty live-scan results were REPAIRED by the test sweep (fresh runs for
all cohort domains).

PARALLEL-LANE AWARENESS: the client-viewbook lane (Codex) merged PRs
#187-#194 and deployed mid-sweep on 2026-07-16. Run the
er-seo-tools-multi-agent-coordination pre-flight before feature work; pull
main first — it moves fast.

PROD ACCESS: source .claude/ops-secrets.local.sh (gitignored). Live paths
/home/seo/... NO sqlite3 CLI on the server — prod DB probes via node + the
app's PrismaClient from $APP_HOME. Gate policy: read-only inspection +
gate-green deploy + pm2 restart autonomous; destructive ops Kevin-gated
per conversation.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test +
  npm run build before EVERY merge. npm run smoke mandatory if the PR
  touches auth/SF-upload/ADA-pipeline (export CHROME_EXECUTABLE=
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" on macOS).
- Schema changes are hand-authored migration SQL; array-form $transaction
  ONLY; DateTime columns are INTEGER ms in raw SQL.
- New cookie-gated client routes need NO middleware change; anything public
  needs anchored matchers + middleware.test.ts cases.
- Never weaken safeFetch/SSRF guards. Only scan client sites already in
  the system. lib/seo-fetch is FROZEN — consume, never modify.
- Tests self-provision per-worker SQLite DBs, run PARALLEL; save/restore
  env vars a suite sets. WeeklySweep suites use far-future scheduledFor
  anchors (+10y/+60y/+70y taken).
- Never git add -A/-u at repo root. No backticks in Bash -m commit
  messages. No raw NUL bytes in source.
- UI: dark: variants on every element + the mounted-guard hydration pattern.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy (source the ops secrets
file; queue should be empty; note the pm2 restart counter baseline is ~0
since the 2026-07-16 parallel-lane redeploy, NOT 180). Read
docs/superpowers/todos/2026-07-16-first-sweep-report.md, then load
er-seo-tools-change-control and start the sweep error triage brainstorm.
```

---

## Current state (one paragraph)

Roadmap spine complete: A1-A8, B-series, C-series through **C21 (weekly
client sweep — DEPLOYED and TEST-PROVEN 2026-07-16: 29/29, 4h40m, 100%
coverage, digest emailed)**, D0-D5, D7 all [x]; D6 FROZEN [x]. The
2026-07-16 verifier crash-loop class is closed by PR #186 and held under
the exact incident load shape same day. Next: the sweep error triage
(4 buckets + the "timed-out" label fix — Kevin request from the test run),
then the two campaign-gated [~] items (C6 hybrid-discovery Increment 2,
C12 tier promotions) via the SF-retirement parity campaign.
