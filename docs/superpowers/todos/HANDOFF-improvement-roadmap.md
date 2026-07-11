# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (C20 **KS-5 SHIPPED + DEPLOYED + PROD-VERIFIED — C20
MVP COMPLETE `[x]`** — PR #150, `f490b4c`. KS-1..5 all live. Next: Kevin's
end-to-end run + eyeball list, then KS-6 (optional) or the main tracker queue.) ·
**Updated by:** the KS-5 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C20/KS-5 (client-scoped
keyword-strategy export + kst_ token + billable volume endpoint) SHIPPED — PR #150
merged (f490b4c), skill kst_ routing landed BEFORE deploy (release prerequisite),
deployed + prod-verified 2026-07-11 (migration 20260711120000_keyword_strategy_sessions
applied, KeywordStrategySession + KeywordStrategyVolumeRequest live via read-only
Prisma probe, export 401 / volumes 400-body-first / mint 401-gated, clean boot,
4469 tests / 501 files green). C20 = [x] — MVP KS-1..5 COMPLETE (KS-1 #146, KS-2
#147, KS-3 #148, KS-4 #149, KS-5 #150). All spec/plan pairs + the umbrella doc
archived. What KS-5 is: NEW kst_ token family (audience keyword-strategy-client,
scopes read/memo-write/volume-lookup, SAME KEYWORD_MEMO_TOKEN_SECRET — the AUDIENCE
is the wall); KeywordStrategyCard on /clients/[id] mints a "Strategy ID:" clipboard
prompt; GET /api/keyword-strategy/[id] assembles five independently-degradable
blocks (KS-3 profile/roster · KS-1 GSC summary · KS-4 buildPageInventory over the
newest live-scan run · run-scope findings via lib/findings/finding-type-sets.ts ·
optional semrush); PATCH …/memo renders back on the card; POST …/volumes is the
BILLABLE lookup (locale fixed server-side, idempotent reserve→call→finally-settle
ledger in lib/keywords/strategy-volume-ledger.ts, duplicate-settled replays stored
responseJson, monthly ceiling on request-row spend time, tiered retention
7d/45d/keep). Skill side: er-handoff-memo v2.2.0 has the kst_ row + handoff.py
volumes subcommand + templates/keyword_strategy_structure.md (8 sections, GSC
hedging, FAQ tri-state phrasing verbatim).

KEVIN STEPS OUTSTANDING (none block other work):
1. Run the 8-section workflow end-to-end once: /clients/[id] → Keyword Strategy
   card → Generate strategy prompt → paste into a chat with the er-handoff-memo
   skill → verify the doc posts back to the card. (Best on a client with GSC
   mapped + a live-scan run + a confirmed roster + locale set.)
2. Provide the 4 reference docs (program categories, BOFU patterns, intent
   definitions, compliance exclusions) → into
   ~/.claude/skills/er-handoff-memo/references/ (the template applies its
   When-to-Ask fallbacks until then).
3. Optional: set DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD in the prod .env to light
   up the volume endpoint (dark-honest 409 volume_disabled until then). Server
   .env is Kevin-only (change-control rule 1).
4. §5 defaults shipped as proposed (1,500 kw/session + 25,000 kw/month caps ·
   kst_ prefix — Codex reversed the krt_-v2 lean · refresh-on-mint · hedged FAQ
   phrasing) — override any by saying so.

NEXT ITEM (pick one):
- KS-6 (optional, later): SEMRush retirement via DataForSEO Labs
  (ranked-keywords/domain-intersection replacing the manual CSV uploads — ties
  into SF-retirement Phase 6) + the already-approved 1-h contentText retention +
  per-page content endpoint (shared with C12 Option C). Umbrella §4 KS-6, now at
  docs/superpowers/archive/specs/2026-07-10-keyword-strategy-capability-design.md.
- OR the main tracker queue: read the unchecked items at the top of
  docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (e.g. the
  scoring-spec successor items, C12 content auditing) and pick, or ask Kevin.

GOTCHAS FOR THE NEXT SESSION:
- kst_/krt_ share KEYWORD_MEMO_TOKEN_SECRET ON PURPOSE — never "fix" with a new
  env var; the AUDIENCE claim is the isolation wall, test-pinned both directions
  incl. prefix-swap attacks.
- The ledger's settle derives refunds from the STORED row keywordCount clamped
  in SQL — caller numbers never enter refund arithmetic. Reserve = INSERT..SELECT
  + EXISTS-fenced UPDATE with a (1,1) affected-count contract; mismatch throws,
  never success. Array-form $transaction only; raw SQL sets updatedAt (int ms).
- Retention is TIERED because the monthly ceiling sums request rows: memo-less
  sessions WITH request rows live 45 d (a 7-d prune would corrupt the month
  sum). The 45-d proof leans on token TTL 3600s — if TTL ever grows, revisit
  lib/keywords/retention.ts.
- KS-5 datetime columns store INTEGER unix-ms (probe-verified). prisma migrate
  diff --to-url needs an ABSOLUTE path locally (real dev DB = prisma/local-dev.db;
  a stray empty local-dev.db sits at repo root).
- lib/findings/finding-type-sets.ts is now the ONE home of on-page/broken type
  lists (export + both results-page sections import it); the mappers stay the
  write-side truth, drift-tripwire test pins the ids.
- OnPageSeoSection.tsx has NO test file (Task-3 refactor verified by diff-read).
- Rolled-up ship-as-is minors (future polish, none load-bearing): settle EXISTS
  fence could also bind strategySessionId; readBudget sits between provider call
  and outcome assignment in volumes/route.ts (throw there → unresolved hold —
  safe direction); regenerating flag persists if a poll expires with no
  write-back; reload-mid-regeneration shows the empty state until write-back.
- tsconfig excludes **/*.test.ts — tsc never flags test fixtures; sweep via
  grep + vitest. parse-seo-dom injection contract unchanged (no typeof; build =
  real SWC gate). gsc-snapshot/volume-throttle derived-promise .catch patterns
  are crash guards — never simplify away.

Kevin eyeballs outstanding (authed-UI): NEW — KeywordStrategyCard end-to-end run
(step 1 above) · KeywordProfileCard suggest (KS-3) · GscKeywordCard refresh (KS-1)
· C15 Mine-filter · C16 Audits page · C17 seoOnly auto-flip · C18 results tabs ·
C14 /sales + real /sales/[token] report · re-scan Bellus (v4 badge + invoice;
expect ≈68) · post-C19: /settings SEO+ADA cards + /score-lab · post-A8-PR7:
/clients fleet + client dashboard (weightsHash suppression on first real
ScoringWeights save — observe only).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/qct_ clipboard
flow. (DataForSEO is a DATA API — does not touch this gate.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) + deploy with
post-deploy verify; destructive server ops Kevin-gated; spec→plan ungated (Codex each
artifact, notify Kevin one line + path, don't wait). Docs ritual in the same commit
as any ship.

ENV NOTE: gates = npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm
run build. Migrations: hand-author SQL (migrate dev is interactive-only here), apply
with DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate;
SQLite: no ALTER COLUMN nullability (PRAGMA rebuild). Never git add -A (or -u at
repo root — pentest-results/ etc. untracked). Test gotchas: vitest globals:false →
afterEach(cleanup) in component tests rendering repeated text; act() not waitFor
under fake timers; getAllBy* for repeated copy; route files export only
handlers+config; Prisma client is a proxy — vi.spyOn on model methods breaks on
mockRestore (use shadow-and-restore or mock the module).
⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log. sqlite3 is NOT on the server — verify
schema via a read-only Prisma probe (node - < script.js over ssh; PRAGMA rows return
BigInt — Number() them before printing).
```

---

## Current state (2026-07-11, post-KS-5-ship)

- **Main** @ `f490b4c` (PR #150 merge) + this ritual commit. **Prod on `f490b4c`**,
  deployed + verified (fresh BUILD_ID, health ok, migration `20260711120000`
  applied, both tables + all columns probed read-only, route gates correct,
  Ready in 673ms, 0 unstable restarts).
- **C20 `[x]` — MVP COMPLETE** (KS-1..5 in 2 days). KS-5 Codex trail: spec ×6,
  plan ×7, 10 build tasks (2 fix loops: T5 non-discriminating tests, T10 a real
  Critical — regenerate-over-memo killed polling), final whole-branch review
  (Fable) READY-TO-MERGE, 0 Critical/Important, 19 minors triaged ship-as-is.
  109 new tests.
- **Skill:** er-handoff-memo v2.2.0 (kst_ routing + volumes subcommand +
  8-section template) — landed BEFORE deploy per the release-prerequisite rule.
- **Open Kevin steps:** end-to-end run · 4 reference docs · optional DataForSEO
  prod creds · §5 default overrides if any.

## The single next item

**Kevin's call:** KS-6 (optional SEMRush retirement + contentText export) or
back to the main tracker queue. Nothing is in-flight; the ledger and tracker
are consistent with code.

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — it is the authoritative list
this cycle (kst_ secret sharing, ledger SQL contracts, tiered-retention month
proof, absolute-path migrate diff, finding-type-sets ownership, rolled-up
minors).
