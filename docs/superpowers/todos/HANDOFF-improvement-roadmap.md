# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (**C12 Tier-0 content auditing (Increments A+B)
SHIPPED + DEPLOYED + PROD-VERIFIED** — PR #152, `16e56bb`; zero-AI,
measurement-first. C12 → `[~]` (Tier-1 remains future scope). Next: **roadmap
menu**.) · **Updated by:** the C12-Tier-0 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C12 Tier-0
content auditing (Increments A+B) — SHIPPED + DEPLOYED + PROD-VERIFIED, C12 →
[~] (Tier-1 = MiniLM topic-overlap + cat_ handoff family remains future scope,
own specs later). Zero-AI, zero-new-fetch, measurement-first (NOT Findings, NO
score change). Built subagent-driven from the pre-written spec (Codex ×6) + plan
(Codex ×5), 11 TDD tasks, one Task-6 fix loop, opus whole-branch review clean.
PR #152 merged (16e56bb), deployed via plain ~/deploy.sh (app resident) +
prod-verified 16e56bb (fresh BUILD_ID, health ok, CrawlRun.contentSignalsJson
readable via read-only Prisma probe).

WHAT SHIPPED:
- Increment A (GSC query×page cannibalization report): lib/keywords/types.ts
  CANNIBALIZATION_REPORT_CAP=200 + CannibalizationReport type; gsc-snapshot.ts
  extracted shared loadLatestValidSnapshot (behavior-preserving refactor of
  getLatestGscSnapshot) + getCannibalizationReport (re-derives the FULL uncapped
  list at read time from KS-1's stored GscSnapshot rows); GET
  /api/clients/[id]/gsc-cannibalization (cookie-gated, strict ^[1-9][0-9]*$ id,
  404 only on clientExists:false, NO middleware change); GscCannibalizationCard
  on /clients/[id] (dark-mode, ephemeral-error refresh, KS-1 honesty phrasing).
- Increment B (content signals): lib/ada-audit/seo/content-signals.ts pure
  computeContentSignals (stale-date copyright/term/deadline + Flesch FRE/FK
  readability, currentYear injected, PINNED algorithm — fixtures break if the
  regexes/constants change); nullable CrawlRun.contentSignalsJson (migration
  20260712000000) + CrawlRunInput field; computed in the live-scan builder
  (broken-link-verify.ts) from transient HarvestedPageSeo.contentText over the
  indexable∧¬login-like set, BEFORE the similarity block (reserve sums
  CONTENT_SIGNALS_RESERVE_MS 10s + CONTENT_SIM_RESERVE_MS 30s), fail-to-null,
  {v:1,...}-wrapped; read-time ContentSignalsSection on the results-page SEO tab
  (share view unchanged).

NEXT ITEM: roadmap menu — pick one (or take Kevin's steer):
- C12 Tier-1: MiniLM topic-overlap + cat_ handoff family (own spec→Codex→plan
  →Codex→build; scope was locked A+B-only 2026-07-11, Tier-1 deferred).
- SF-retirement parity cycles (see er-seo-tools-sf-retirement-campaign skill).
- Track A infra (A5/A7) or Track D remaining.
All start: brainstorm → spec → Codex → plan → Codex → build, rule 4 ungated.

KEVIN STEPS + EYEBALLS (unchanged, still open): canonical checklist with steps +
completed log = docs/superpowers/todos/2026-07-11-kevin-manual-checks-tracker.md
(KS-5 end-to-end run · 4 reference docs into ~/.claude/skills/er-handoff-memo/
references/ · optional DataForSEO creds · all outstanding authed-UI eyeballs
C14-C19/A8 · NEW: eyeball the C12 GscCannibalizationCard on a client dashboard +
ContentSignalsSection on a fresh live-scan SEO-tab result). When Kevin reports
an item done, tick it THERE + date the completed log.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate (in-build tsc/eslint disabled since
  the 2026-07-11 OOM fix). npx tsc --noEmit + DATABASE_URL="file:./local-dev.db"
  npm test + npm run build, all green, before EVERY merge — no exceptions.
- C12 content-signals.ts is an ordinary Node module (NOT .toString()-injected —
  no SWC/typeof contract). Its algorithm is PINNED to the spec/plan fixtures
  (word/sentence/syllable regexes, FRE/FK constants, url tie-breaks, per-page
  hit cap 5 in DOCUMENT order across rule kinds, per-list cap 50). Do NOT retune
  a constant without updating the fixtures — and the hit-cap must stay
  document-ordered (a prior build regressed to rule-class priority; fixed
  4c1c712 with a locking test).
- contentSignalsJson rides the writer's crawlRun.create spread (no new
  transaction). The content-signals block runs BEFORE the similarity block and
  its skip-reserve sums BOTH budgets. Aggregation set = indexable∧¬loginLike
  (SAME as the similarity/on-page/program-entity blocks). Fail-to-null: a throw
  must never fail the live-scan run write.
- Cannibalization: KS-1's derive.ts ALREADY computes the list (≥2 pages each
  ≥20% share of observed query×page impressions, ≥10 imp) — C12 Increment A
  only re-shapes it into a full report (getCannibalizationReport caps at 200 for
  payload but reports totalCannibalizedQueries uncapped). loadLatestValidSnapshot
  is now the shared newest-valid-snapshot resolver — getLatestGscSnapshot
  delegates to it (behavior-preserving; don't diverge the two).
- gsc-snapshot.test.ts is DB-backed (real prisma, mocked GSC provider) — never
  vi.mock prisma there. Component tests: NO jest-dom → // @vitest-environment
  jsdom + afterEach(cleanup) + getByText/getAllByText + .toBeTruthy() (NOT
  toBeInTheDocument). vitest globals:false. Route files export only handlers +
  config. broken-link-verify.test.ts uses vi.spyOn (no vi.mock in that file).
- Migrations: hand-author SQL (migrate dev is interactive-only here), apply with
  DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate;
  SQLite: no ALTER COLUMN nullability. Never git add -A (or -u at repo root —
  pentest-results/ + .playwright-mcp/ deletions untracked).
- sqlite3 is NOT on the server — verify schema via a read-only Prisma probe
  (node - < script.js over ssh).
- kst_/krt_ share KEYWORD_MEMO_TOKEN_SECRET on purpose (audience is the
  isolation wall). Volume endpoint DARK until DataForSEO creds land in prod .env.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/qct_ clipboard
flow. (DataForSEO is a DATA API — does not touch this gate.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4):
standing authorization to merge gate-green roadmap PRs (re-run gates in-session)
+ deploy with post-deploy verify; destructive server ops Kevin-gated; spec→plan
ungated (Codex each artifact, notify Kevin one line + path, don't wait). Docs
ritual in the same commit as any ship.
```

---

## Current state (2026-07-11, post-C12-Tier-0)

- **Main** @ `16e56bb` (PR #152 merge) + this ritual commit. **Prod on `16e56bb`**,
  deployed via a plain `~/deploy.sh` with the app resident (restored recipe);
  fresh BUILD_ID, health ok, migration `20260712000000` applied,
  `CrawlRun.contentSignalsJson` readable via a read-only Prisma probe.
- **C12 → `[~]`:** Tier-0 (Increments A+B) shipped; Tier-1 (MiniLM topic-overlap
  + cat_ handoff family) remains future scope, its own specs later.
- **C20 `[x]` — MVP COMPLETE** (KS-1..5, PRs #146–#150). Volume endpoint dark
  until DataForSEO creds land in the prod .env (Kevin).
- **Kevin manual checks:** canonical tracker =
  `todos/2026-07-11-kevin-manual-checks-tracker.md` (KS-5 end-to-end run,
  reference docs, DataForSEO creds, §5 default overrides, C14–C19/A8 authed-UI
  eyeballs, + new C12 card/section eyeballs). Sessions tick + log there.

## The single next item

**Roadmap menu** — no single item is pre-committed after C12 Tier-0. Candidates:
C12 Tier-1 (MiniLM topic-overlap + cat_ family, own spec), SF-retirement parity
cycles, Track A infra (A5/A7), or Kevin's steer. Each starts brainstorm → spec →
Codex → plan → Codex → build.

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — it is the authoritative list
this cycle (local-gates-only, content-signals pinned algorithm + document-order
hit cap, contentSignalsJson-via-spread + before-similarity reserve, DB-backed
gsc-snapshot tests, no-jest-dom component convention, hand-authored migrations).
