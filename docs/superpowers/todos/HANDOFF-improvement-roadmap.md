# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (**C12 Increment D1 — `cat_` content-audit handoff
bridge — SHIPPED + DEPLOYED + PROD-VERIFIED** — PR #154 / merge `7c2d37a`.
Measurement-first, zero-billing skill-handoff (Option C). C12 stays `[~]`. Next:
**roadmap menu**.) · **Updated by:** the C12-D1 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C12 Increment D1
— the cat_ content-audit handoff bridge — SHIPPED + DEPLOYED + PROD-VERIFIED
(PR #154, merge 7c2d37a). C12 stays [~]. Scope was locked with Kevin to the
BRIDGE CORE (D1) ONLY: the recall-first claim-sentence filter (D2, needs a
labeled recall eval) + incremental sha256-diff exports (D3) are deferred; Tier-2
AI data-correctness remains future scope + OFF per the no-AI-API gate. Option C
= the zero-billing skill-handoff stand-in for Tier-2; it PROVES the exact finding
schema Option A (a future Anthropic job) would reuse. Built brainstorm → spec
(Codex ACCEPT-WITH-FIXES ×5) → plan (Codex ACCEPT-WITH-FIXES ×5) →
subagent-driven 11-task TDD → gates → opus whole-branch review (READY-TO-MERGE,
0 Crit; I1 fixed, I2 deferred) → merge → deploy → prod-verify.

WHAT SHIPPED (PR #154):
- lib/content-audit-token.ts — stateless cat_ JWT, audience 'content-audit-client'
  (the isolation wall), shares KEYWORD_MEMO_TOKEN_SECRET (NO new prod env var),
  sub=siteAuditId, 1h. Cross-family isolation tested both directions.
- Retention reversal (KEVIN SIGN-OFF — reverses the C6-P5 "contentText transient
  by design" rule): the live-scan builder (broken-link-verify.ts) stamps
  SiteAudit.contentAuditRetainUntil = now+2h BEFORE writeFindingsRun (crash-safe)
  and NO LONGER deletes HarvestedPageSeo (HarvestedLink delete kept — still the
  recovery strand signal). sweepExpiredContentAudit (lib/findings/retention.ts,
  in runCleanup + stale-audit-reset) DELETEs rows past expiry with an INTEGER-MS
  bind (${now.getTime()}, NOT a bare Date) AND an EXISTS-guard on the seo-parser
  run (a crash-window stranded audit — stamp but no run — is never swept early;
  it waits for the 7-d pruneHarvestedPageSeo backstop). Mint extends monotonically
  via a conditional raise-only $executeRaw. recoverBrokenLinkVerifies scan bounded
  to crawlRuns:{none:{tool:'seo-parser'}}. Migration 20260713000000
  (contentAuditRetainUntil + contentAuditJson + index).
- lib/content-audit/: ingest-schema.ts (pure validateContentAuditFindings — typed
  {data_inconsistency|stale_claim|quality_issue}+severity+evidence[{url,snippet}]
  +recommendation; enum + per-field caps + AGGREGATE 256KB byte cap + every
  evidence url MUST be in the audit's eligible page set; rejects, never truncates),
  route-auth.ts (requireContentAuditToken — the ONE fail-closed helper for all 3
  public routes; every failure → controlled 401, never a raw throw → 500),
  manifest.ts (loadContentAuditManifest/loadContentAuditPageText/
  contentAuditEligibleUrls; single isIndexable filter ≡ the builder aggregation
  set; READ-TIME retainUntil<=now expiry independent of the sweep; 410=in-set
  expired vs 404=not-in-set), read-bounded-json.ts (streamed byte cap → 413
  regardless of Content-Length).
- Routes: cookie-gated POST mint + GET poll under /api/site-audit/[id]/content-audit
  (mint guards complete+live-scan-run+not-archived, honest textAvailable; poll
  {minted,contentAuditJson}); PUBLIC GET /api/content-audit/[id]/manifest·/page +
  PATCH /findings (3 anchored single-segment middleware matchers — NEVER a
  /api/content-audit/ prefix; positive+negative tests). PATCH is body-before-auth,
  last-writer-wins onto CrawlRun.contentAuditJson (measurement-first, NOT a
  Finding, NO score change).
- components/site-audit/ContentAuditCard.tsx on the results SEO tab (mint → cat_
  clipboard prompt via lib/content-audit-prompt.ts → bounded poll of the
  cookie-gated route → findings grouped by type; full dark mode). SHARE VIEW
  UNCHANGED.
- er-handoff-memo skill v2.3.0 (release prereq, landed WITH the branch): BUNDLED
  (Kevin sign-off) the pending kst_ (KS-5) routing that was authored-but-never-
  committed + the NEW cat_ routing (§9 manifest→page→findings; handoff.py cat_
  route + `page`/`findings` subcommands, `post` errors for cat_;
  references/content-audit.md contract).

CONTROLLER-CAUGHT FIX (5a95240): Task 10's clipboard prompt emitted
'Webapp: er-seo-tools' + a bogus 'Base URL:' line — but the skill uses the
Webapp: line as handoff.py --webapp (the API base), so the handoff would have
failed. Fixed to the canonical shape (Webapp: <NEXT_PUBLIC_APP_URL>). Lesson:
cross-check any new clipboard-prompt builder against the skill parser + an
existing composeXxxPayload.

NEXT ITEM: roadmap menu — pick one (or take Kevin's steer):
- SF-retirement parity cycles (er-seo-tools-sf-retirement-campaign skill).
- Track A infra: A5 shared status hook/SSE (replace polling with push); A7 auth
  hardening + per-worker test DBs + Playwright smoke.
- Track D remaining (observability/ops-adjacent — check the tracker).
- C12 D2 (recall-first claim-sentence filter + a MEASURED recall eval on labeled
  real client pages) — the deferred optimization on the cat_ bridge; or C12
  Tier-2 AI data-correctness (GATED OFF — Kevin decision to reopen).
All start: brainstorm → spec → Codex → plan → Codex → build, rule 4 ungated.

C12 D1 FOLLOW-UPS (non-blocking):
- I2 (deferred, Low): a manual `npx tsx scripts/findings-rebuild.ts <id>` on an
  already-audited run would wipe an ingested contentAuditJson (the builder never
  sets it; writeFindingsRun delete-and-recreates the run). Unreachable in normal
  flow (recovery skips run-bearing audits; a PATCH can only land after the run
  exists). Flag if any D-series work adds AUTOMATED rebuilds of run-bearing audits.
- Retention canary: on a busy 2-hour window, observe retained-HarvestedPageSeo
  row count + DB-size delta + sweepExpiredContentAudit duration. Bounded by the
  2h TTL × 10-min sweep; the promotion/tuning gate for CONTENT_AUDIT_BASE_TTL_MS,
  not a ship blocker.

KEVIN STEPS + EYEBALLS (still open): canonical checklist =
docs/superpowers/todos/2026-07-11-kevin-manual-checks-tracker.md — now includes
§6: the C12 TopicOverlapSection eyeball (6.1), the NEW ContentAuditCard mint +
cat_ clipboard eyeball (6.2), and the cat_ END-TO-END handoff run (6.3: paste the
minted prompt into a fresh chat, the skill fetches manifest→pages→PATCHes
findings, the card's poll surfaces them). Plus the still-open KS-5 items (end-to-
end run · optional DataForSEO creds) and the C14-C19/A8 eyeballs. When Kevin
reports an item done, tick it THERE + date the completed log.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate (in-build tsc/eslint disabled since the
  2026-07-11 OOM fix). npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm
  test + npm run build, all green, before EVERY merge — no exceptions.
- DateTime columns are stored INTEGER ms in this SQLite setup. Any raw-SQL
  DateTime comparison MUST bind ${x.getTime()} (integer ms), NEVER a bare Date —
  a Date bind risks a silent never-match (sweep never fires). Codex asserted the
  bare Date was fine; the codebase convention won (and the sweep test proves it).
- cat_ retention invariant: retainUntil is stamped BEFORE writeFindingsRun, so a
  non-null retainUntil does NOT by itself prove the run exists. The sweep's
  EXISTS-guard on the seo-parser run is what makes "safe to delete" true — do not
  drop it. Stranded (crash-window) rows fall to the 7-d backstop.
- cat_ token shares KEYWORD_MEMO_TOKEN_SECRET; AUDIENCE 'content-audit-client' is
  the ONLY isolation. Every public cat_ route goes through requireContentAuditToken
  (fail-closed). 3 anchored single-segment middleware matchers — never a prefix.
- Ingest is measurement-first: contentAuditJson is metadata, NOT a Finding, NO
  score. Evidence URLs are validated against the audit's eligible set. PATCH is
  body-before-auth behind a bounded body reader (413 regardless of Content-Length).
- New clipboard-prompt builders: the `Webapp:` line MUST be the dashboard URL
  (NEXT_PUBLIC_APP_URL) — the skill uses it as handoff.py --webapp. Mirror an
  existing composeXxxPayload and cross-check the skill parser (this bit us in T10).
- er-handoff-memo skill lives INSIDE this repo (skills/er-handoff-memo, symlinked
  to ~/.claude/skills). Skill changes commit on the branch. Watch for PRE-EXISTING
  uncommitted skill changes in the working tree (this session bundled a pending
  kst_ set on Kevin's sign-off) — never git add -A/-u at repo root
  (pentest-results/ + .playwright-mcp/ deletions are untracked/pre-existing).
- Component tests: NO jest-dom → // @vitest-environment jsdom + afterEach(cleanup)
  + getByRole/getAllByText + .toBeTruthy()/.getAttribute() (NOT toBeInTheDocument).
- Migrations: hand-author SQL (migrate dev is interactive-only), apply with
  DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate;
  SQLite has no ALTER COLUMN nullability.
- sqlite3 is NOT on the server — verify prod schema via a read-only Prisma probe
  (node - <<EOF over ssh).
- COMMIT MESSAGES: no backticks in -m strings via the Bash tool — they trigger
  shell command substitution (bit this session; use plain words or amend after).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow. (DataForSEO is a DATA API — does not touch this gate. The LOCAL
MiniLM embedding model is not an AI API either — on-box, zero network.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4):
standing authorization to merge gate-green roadmap PRs (re-run gates in-session)
+ deploy with post-deploy verify; destructive server ops Kevin-gated; spec→plan
ungated (Codex each artifact, notify Kevin one line + path, don't wait). Docs
ritual in the same commit as any ship.
```

---

## Current state (2026-07-11, post-C12-D1)

- **Main** @ `7c2d37a` (PR #154 merge) + this finalize commit. **Prod on
  `7c2d37a`**, deployed via a plain `~/deploy.sh` (app resident); BUILD_ID
  `0Nm2FqohmrJ6m3-8Wja0B`, health ok, migration `20260713000000` applied,
  `SiteAudit.contentAuditRetainUntil` + `CrawlRun.contentAuditJson` + the index
  readable (read-only Prisma probe), the public cat_ manifest route →
  `401 {"error":"auth_required"}` (deployed + fail-closed), mint route 401-gated,
  0 unstable restarts.
- **C12 → `[~]`:** Tier-0 (A+B) + Tier-1 Increment C (MiniLM topic-overlap) +
  Increment D1 (the `cat_` bridge) shipped. Only **Tier-2 AI data-correctness**
  remains future scope (own spec; OFF per the no-AI-API gate — the `cat_` bridge
  is its zero-billing stand-in). D2 (claim filter + recall eval) + D3 (incremental
  exports) are deferred optimizations on the bridge.
- **C20 `[x]` — MVP COMPLETE** (KS-1..5). Volume endpoint dark until DataForSEO
  creds land in the prod .env (Kevin). The pending kst_ skill routing that had
  never been committed is now committed (bundled into PR #154's skill commit,
  v2.3.0).
- **Kevin manual checks:** canonical tracker =
  `todos/2026-07-11-kevin-manual-checks-tracker.md` (now incl. §6: TopicOverlap +
  ContentAuditCard + cat_ end-to-end run). Sessions tick + log there.

## The single next item

**Roadmap menu** — nothing is pre-committed after C12 D1. Candidates: SF-retirement
parity cycles, Track A infra (A5 status hook/SSE, A7 auth hardening + test DBs +
Playwright smoke), Track D remaining, C12 D2 (claim filter + recall eval), or
Kevin's steer. Each starts brainstorm → spec → Codex → plan → Codex → build (rule
4 ungated).

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — it is the authoritative list this
cycle (local-gates-only; integer-ms DateTime raw binds; cat_ retention EXISTS-guard
invariant; shared-secret + audience isolation + fail-closed route-auth + anchored
matchers; measurement-first ingest + evidence-URL binding + bounded body reader;
clipboard `Webapp:`=dashboard-URL; in-repo skill + pre-existing uncommitted skill
changes; no-jest-dom component convention; hand-authored migrations; no backticks
in Bash `-m` commit messages).
