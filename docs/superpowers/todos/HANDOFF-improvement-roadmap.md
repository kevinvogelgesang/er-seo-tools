# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-16 (**verifier memory/loop fix SHIPPED (PR #186) and
C21 weekly sweep DEPLOYED — the 2026-07-16 crash-loop incident class is
closed. First sweep fires Mon 2026-07-20 01:00 UTC, digest 14:00 UTC. The
standing direction resumes: the SF-parity campaign.**) · **Updated by:** the
verifier-fix + C21-deploy session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE (2026-07-16): the
verifier memory/loop fix is SHIPPED (PR #186, main 89ebda6) and C21 (weekly
client sweep + /issues + Monday support digest) is DEPLOYED. C2 client
schedules are retired on the server. Both system-* sweep schedules are
seeded: first sweep fires Mon 2026-07-20 01:00 UTC (~25 full audits), digest
Mon 14:00 UTC to SUPPORT_NOTIFY_EMAIL (default support@enrollmentresources.com).

THE STANDING DIRECTION RESUMES — the SF-parity campaign
(er-seo-tools-sf-retirement-campaign skill) + the two campaign-gated [~]
items (C6 hybrid-discovery Increment 2; C12 tier promotions). Load that
skill and pick up where it points.

MONDAY 2026-07-20 VERIFICATION DUTY (whoever is in a session after Mon):
  1. After the sweep drains: record drain wall-clock + snapshot coverage
     >=90% in the tracker (C21 spec section 11) — the spec/plan were archived
     to docs/superpowers/archive/ this session.
  2. Watch pm2 memory through the ~25 verifier runs (the REAL prod exercise
     of the new streamed builder; local evidence: 263MB marginal vs the old
     ~2.7GB). Restarts must stay frozen at 180.
  3. D5's first robots sweep fires the same morning 06:30 UTC (in-app
     "changed" badge; notify env dark).

VERIFIER-FIX FACTS THE NEXT SESSION NEEDS:
- Exhausted verifiers now write a terminal placeholder CrawlRun
  (source 'live-scan-placeholder', lib/findings/exhausted-placeholder.ts);
  recovery NEVER re-enqueues one (errored-job fence). Read surfaces gate on
  isPlaceholderRun -> "SEO analysis unavailable". A placeholder is
  self-heal-REPLACED by any later successful build (writeFindingsRun
  delete-and-recreate).
- PROD BEHAVIOR CHANGE (Codex ruling): VERIFIER_TOPIC_OVERLAP_ENABLED is
  DEFAULT OFF — topic-overlap cards render "not analyzed" until the switch
  is enabled after the ONNX follow-up. Profiling proved MiniLM/ONNX
  intra-chunk overshoot is unboundable by RSS gates (crossed the 1600MB
  guard, peaked 2409MB; PM2 cap 2400M). Re-enabling requires the recorded
  ONNX follow-up: child-process embed worker OR dispose fencing + chunk-size
  benchmark (4/8/16/32, per-chunk RSS) + a 5-10 sequential-audit
  accumulation check. Kevin flips the env only after that lands.
- New env vars, all optional-with-defaults (no server .env changes needed):
  VERIFIER_RSS_GUARD_MB (1600), CONTENT_TEXT_TOTAL_BYTE_BUDGET (24MB),
  VERIFIER_TOPIC_OVERLAP_ENABLED (unset=off).
- The characterization suite (broken-link-verify.characterization.test.ts)
  is a FROZEN byte-identical gate on the builder's happy path — any
  legitimate behavior change there must update the pins deliberately.
- Dev profiling tool: DATABASE_URL="file:./local-dev.db" npx tsx
  scripts/profile-verifier-memory.ts [--pages N --links-per-page M
  --warm-embedder] — never deployed, never imported by app code.

RECORDED FOLLOW-UPS (non-blocking, tracker status log 2026-07-16 has the
full list): ONNX bounding (gates topic-overlap re-enable); sweep digest
labels a placeholder pair 'timed-out' (label-only); direct run-page nav to
a placeholder cuid renders the degraded empty view; Capped-component
triplication; sales MethodExplainer beside the unavailable note (Kevin copy
call); C21 log-only edges from the previous session.

KEVIN STEPS OUTSTANDING (small): (a) D5 robots sweep glance after Mon
~06:30 UTC; (b) D3 optional page-count glance on the next real site audit;
(c) the ~7 incident audits have empty live-scan SEO results until next scan
(placeholder-era data cost, self-heals on rescan); (d) optional UI smoke
audit post-deploy (checklist item 6 — everything else verified; the Monday
sweep is the real exercise).

PROD ACCESS: source .claude/ops-secrets.local.sh (gitignored — PROD_SSH/
APP_HOME/DATA_HOME/LOG_HOME/PROD_DB + the verbatim deploy.sh body). Live
paths /home/seo/... NO sqlite3 CLI on the server — prod DB probes go
through node + the app's PrismaClient from $APP_HOME. Gate policy
unchanged: read-only inspection + gate-green deploy + pm2 restart
autonomous; destructive ops Kevin-gated per conversation.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test +
  npm run build before EVERY merge. npm run smoke mandatory if the PR
  touches auth/SF-upload/ADA-pipeline (export CHROME_EXECUTABLE=
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" on macOS).
- Schema changes are hand-authored migration SQL (migrate dev is
  interactive-only), applied with DATABASE_URL="file:./local-dev.db" npx
  prisma migrate deploy; array-form $transaction ONLY; DateTime columns are
  INTEGER ms in raw SQL.
- New cookie-gated client routes need NO middleware change; anything public
  needs anchored middleware matchers + middleware.test.ts cases.
- Never weaken safeFetch/SSRF guards. Only scan client sites already in the
  system. lib/seo-fetch is FROZEN — consume, never modify.
- Tests self-provision per-worker SQLite DBs, run PARALLEL; save/restore
  any env var a suite sets (worker-shared env). WeeklySweep suites use
  far-future scheduledFor anchors (+10y/+60y/+70y taken).
- Never git add -A/-u at repo root (pentest-results/ etc untracked). No
  backticks in Bash -m commit messages. No raw NUL bytes in source.
- UI: dark: variants on every element + the mounted-guard hydration pattern.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy (source the ops secrets
file; pm2 status restarts should still be 180; queue empty). If it is on
or after Mon 2026-07-20, do the MONDAY VERIFICATION DUTY above FIRST. Then
load er-seo-tools-sf-retirement-campaign and resume the campaign.
```

---

## Current state (one paragraph)

Roadmap spine complete: A1-A8, B-series, C-series through **C21 (weekly
client sweep + /issues + digest — DEPLOYED 2026-07-16)**, D0-D5, D7 all
[x]; D6 FROZEN [x]. The 2026-07-16 verifier crash-loop incident is closed
by PR #186 (terminal placeholder + recovery fence + memory-bounded builder;
topic-overlap embedding OFF by default pending the ONNX follow-up). The
first weekly sweep fires Mon 2026-07-20 01:00 UTC and needs its spec-§11
numbers recorded. Remaining build work: the two campaign-gated [~] items
(C6 hybrid-discovery Increment 2, C12 tier promotions) via the
SF-retirement parity campaign — the standing direction.
