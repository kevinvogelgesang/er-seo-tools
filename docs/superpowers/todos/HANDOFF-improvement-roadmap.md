# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (**Deploy build-OOM durable fix SHIPPED + DEPLOYED +
PROD-VERIFIED** — PR #151, `b6e4660`; Kevin chose option (b), plain `~/deploy.sh`
restored. Also: Kevin manual-checks tracker created. Next: **C12 content
auditing** — brainstorm → spec.) · **Updated by:** the post-KS-5 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: deploy build-OOM
durable fix (gated decision → [x]) — Kevin chose option (b): next.config.ts now
sets typescript.ignoreBuildErrors + eslint.ignoreDuringBuilds (both checks gate
every merge locally; their in-build worker repeats caused the 2026-06-22 and
2026-07-09 prod OOMs). PR #151 merged (b6e4660), deployed + prod-verified
2026-07-11 with a PLAIN ~/deploy.sh while the app stayed resident — no OOM,
fresh BUILD_ID, health ok, Ready in 652ms. DEPLOY RECIPE IS BACK TO:
git push && ssh seo@144.126.213.242 "~/deploy.sh" (the pm2-stop prefix is
retired). Consequence: local gates (tsc + vitest) are the ONLY type-check/lint
gate now — NEVER merge ungated.

Immediately before that, C20/KS-5 shipped (PR #150): kst_ token family +
KeywordStrategyCard on /clients/[id] + GET /api/keyword-strategy/[id] 5-block
export + PATCH memo write-back + billable POST volumes (reserve→call→
finally-settle ledger in lib/keywords/strategy-volume-ledger.ts, tiered
retention 7d/45d/keep, monthly ceiling on request-row createdAt). C20 = [x],
KS-1..5 all live (PRs #146-#150). Volume endpoint DARK until Kevin puts
DATAFORSEO_LOGIN/PASSWORD in the prod .env (honest 409 volume_disabled).

KEVIN STEPS + EYEBALLS: canonical checklist with steps + completed log =
docs/superpowers/todos/2026-07-11-kevin-manual-checks-tracker.md (KS-5
end-to-end run · 4 reference docs into ~/.claude/skills/er-handoff-memo/
references/ · optional DataForSEO creds · all outstanding authed-UI eyeballs
C14-C19/A8). When Kevin reports an item done, tick it THERE + date the
completed log.

NEXT ITEM: C12 content auditing (Kevin picked it 2026-07-11, after the OOM
fix). Scope constraint locked 2026-07-08: NO AI API — the data-correctness
half is OFF; only zero-AI Tier-0 increments are candidates (GSC query×page
cannibalization report; stale-date/readability signals). Problem map, tiers,
cost model: docs/superpowers/nyi/FUTURE-content-auditing.md. Tracker entry
says "No spec yet; do not start without the ritual" — so: brainstorm (KS-1
overlap question below) → spec → Codex → plan → Codex → build, rule 4 ungated.
Brainstorm must address: KS-1's GSC snapshot ALREADY ships cannibalization
detection (lib/keywords/derive.ts — ≥2 pages each ≥20% share of observed
query×page impressions, ≥10 imp) — C12's Tier-0 cannibalization report must
build ON that (deeper/report-shaped/historical?) not duplicate it. Also check
what contentText/content-similarity (C6 Phase 5) + KS-4 page inventory already
give the quality tier, and the approved-but-unbuilt 1-h contentText retention +
per-page content endpoint (shared with KS-6, umbrella §4 at
archive/specs/2026-07-10-keyword-strategy-capability-design.md).

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate now (in-build tsc/eslint disabled).
  npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run
  build, all green, before EVERY merge — no exceptions.
- kst_/krt_ share KEYWORD_MEMO_TOKEN_SECRET ON PURPOSE — never "fix" with a
  new env var; the AUDIENCE claim is the isolation wall, test-pinned both
  directions incl. prefix-swap attacks.
- The volume ledger's settle derives refunds from the STORED row keywordCount
  clamped in SQL — caller numbers never enter refund arithmetic. Reserve =
  INSERT..SELECT + EXISTS-fenced UPDATE with a (1,1) contract; mismatch
  throws. Array-form $transaction only; raw SQL sets updatedAt (int ms).
- KS retention is TIERED because the monthly ceiling sums request rows:
  memo-less sessions WITH request rows live 45 d. The 45-d proof leans on
  token TTL 3600s — if TTL grows, revisit lib/keywords/retention.ts.
- lib/findings/finding-type-sets.ts is the ONE home of on-page/broken type
  lists; mappers stay the write-side truth (drift-tripwire test pins ids).
- tsconfig excludes **/*.test.ts — tsc never flags test fixtures; sweep via
  grep + vitest. parse-seo-dom injection contract (no typeof; build = SWC
  gate). gsc-snapshot/volume-throttle derived-promise .catch patterns are
  crash guards — never simplify away.
- Migrations: hand-author SQL (migrate dev is interactive-only here), apply
  with DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && …
  generate; SQLite: no ALTER COLUMN nullability (PRAGMA rebuild). Never git
  add -A (or -u at repo root — pentest-results/ etc. untracked).
- Test gotchas: vitest globals:false → afterEach(cleanup) in component tests
  rendering repeated text; act() not waitFor under fake timers; getAllBy* for
  repeated copy; route files export only handlers+config; Prisma client is a
  proxy — vi.spyOn on model methods breaks on mockRestore (shadow-and-restore
  or mock the module).
- sqlite3 is NOT on the server — verify schema via a read-only Prisma probe
  (node - < script.js over ssh; PRAGMA rows return BigInt — Number() them).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/qct_ clipboard
flow. (DataForSEO is a DATA API — does not touch this gate.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4):
standing authorization to merge gate-green roadmap PRs (re-run gates
in-session) + deploy with post-deploy verify; destructive server ops
Kevin-gated; spec→plan ungated (Codex each artifact, notify Kevin one line +
path, don't wait). Docs ritual in the same commit as any ship.
```

---

## Current state (2026-07-11, post-OOM-fix)

- **Main** @ `b6e4660` (PR #151 merge) + this ritual commit. **Prod on
  `b6e4660`**, deployed + verified via a plain `~/deploy.sh` with the app
  resident — the deploy itself was the fix's production verification (no OOM,
  fresh BUILD_ID 18:23 UTC, health ok, Ready in 652ms, migrations no-op).
- **Deploy recipe restored:** `git push && ssh seo@144.126.213.242
  "~/deploy.sh"`. The 2026-07-09 interim pm2-stop prefix is retired.
- **C20 `[x]` — MVP COMPLETE** (KS-1..5, PRs #146–#150). Volume endpoint dark
  until DataForSEO creds land in the prod .env (Kevin).
- **Kevin manual checks:** canonical tracker =
  `todos/2026-07-11-kevin-manual-checks-tracker.md` (15 items: KS-5
  end-to-end run, reference docs, DataForSEO creds, §5 default overrides,
  C14–C19/A8 authed-UI eyeballs). Sessions tick + log there as he reports.

## The single next item

**C12 content auditing** (Kevin's pick, 2026-07-11) — brainstorm → spec →
Codex → plan → Codex → build. Zero-AI Tier-0 only (2026-07-08 no-AI-API
ruling): GSC query×page cannibalization report + stale-date/readability
signals. Problem map: `docs/superpowers/nyi/FUTURE-content-auditing.md`.
Key brainstorm inputs: KS-1's existing cannibalization detection
(`lib/keywords/derive.ts`), C6 Phase 5 content similarity, KS-4 page
inventory, and the approved-unbuilt 1-h contentText retention + per-page
content endpoint (shared with KS-6).

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — it is the authoritative list
this cycle (local-gates-only consequence of the OOM fix, kst_ secret sharing,
ledger SQL contracts, tiered-retention month proof, finding-type-sets
ownership).
