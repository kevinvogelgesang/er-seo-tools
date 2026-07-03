---
name: er-seo-tools-proof-and-analysis-toolkit
description: "Use when a claim about er-seo-tools needs first-principles proof, not just a green test run: prod-vs-dev behavior doubts (minified names, injected code, .next artifacts), scoring/weight changes, $transaction or raw-SQL review, restart/kill recovery drills, idempotency claims, blob-vs-tables findings parity, post-deploy health checks, SSRF review of a new external-fetch feature, or before asserting a novel design is correct."
---

# Proof and Analysis Toolkit

## Overview

"Prove it, don't just install it." A claim is proven only when you stated a
specific, falsifiable prediction FIRST and then ran a repo-grounded experiment
that could have refuted it. All four major production incidents here (minified
parser keys, SQLite write-lock starvation, PM2 memory SIGKILLs, build-heap OOM)
passed local tests — green gates are necessary, never sufficient, for novel claims. Nine
recipes follow: when to invoke, exact steps, and a worked example from this
repo's actual history.

## When to use

- The change's correctness is invisible to the test suite (compilation
  artifacts, concurrency, restarts, prod-only environment).
- A score/weight changed and you must show exactly what moved and why.
- You are about to claim "this is safe / idempotent / recoverable / equivalent."

## When NOT to use

| Situation | Use instead |
|---|---|
| Running the routine gates (tsc, vitest, build) before a PR | `er-seo-tools-validation-and-qa` |
| Triaging a live bug from symptoms | `er-seo-tools-debugging-playbook` |
| Looking up what went wrong historically | `er-seo-tools-failure-archaeology` |
| Evidence bar / idea lifecycle for NEW research ideas | `er-seo-tools-research-methodology` |
| How changes are classified, gated, deployed | `er-seo-tools-change-control` |

## Recipe index

| # | Recipe | Proves |
|---|---|---|
| 1 | Compilation-artifact audit | prod build behaves like dev |
| 2 | Golden before/after scoring | a scoring change did exactly what you predicted |
| 3 | Transaction/lock review | no SQLite write-lock starvation |
| 4 | Kill/restart drill | work survives process death |
| 5 | Double-run test | an operation is idempotent |
| 6 | Findings parity check | blob and tables tell the same story |
| 7 | Post-deploy verification | the deployed app is healthy |
| 8 | SSRF checklist | an external-fetch feature is safe |
| 9 | Codex adversarial refutation | a design claim survives a hostile reviewer |

## Recipe 1 — Prove prod build ≡ dev behavior (compilation-artifact audit)

**When to invoke:** any code whose correctness depends on identifiers or source
text surviving compilation — `Class.name` / `Function.name` lookups, functions
injected into pages via `.toString()`, error-message string matching. Also after
adding a parser or touching `lib/ada-audit/seo/parse-seo-dom.ts`.

**Why:** SWC's production build minifies class names and emits module-scope
helpers (`typeof` → `_type_of`). Dev (turbopack, unminified) and vitest never
see this — the worst bugs in this repo's history were prod-only and silent.

**Steps:**

1. Enumerate the hazards in your diff:
   - `grep -rn '\.name' <changed files>` — any `SomethingClass.name` used as a key?
   - `grep -rn 'toString()' <changed files>` — any function stringified for injection?
   - Inside an injected function: `typeof`, `instanceof` on classes, spread of
     iterables, or references to module-scope consts/imports can all emit
     escaping SWC helpers or dangling references.
2. State the prediction ("grep for X in `.next/server` will return ≥1 chunk"),
   then build for production: `npm run build` (heap bump already baked in).
3. Grep the compiled output for your load-bearing string literals:
   `grep -rl 'yourLiteralKey' .next/server | head` — the literal must appear in
   the chunks. A key derived from `Class.name` will NOT: that is the failure.
4. For page-injected functions: extract the compiled function body and verify it
   references nothing outside itself (no `_type_of`, no `_object_spread`, no
   imported names). Commit `cc8d1c1` did exactly this — compiled with the
   Next.js SWC bindings (es2017, `externalHelpers:false`) and asserted zero
   escaping helper references inside the function body.

**Worked example A — parser-key bug (PR #45, commit 480a637, 2026-06-02).**
The parse route derived aggregator keys via
`ParserClass.name.replace('Parser','').toLowerCase()`. SWC minified
`InternalParser` → `af`, so all 46 hardcoded `parsedData` lookups missed in
prod: `page_index=0` on healthy crawls, blank keyword joins, hollow roadmaps —
while dev and 800+ tests were green. Fix: every parser declares an explicit
`static parserKey` (`lib/parsers/base.parser.ts:18`); regression guard:
`lib/parsers/parser-key.test.ts`.

**Worked example B — `_type_of` in injected code (cc8d1c1, 2026-06-16).**
`parseSeoFromDocument` is injected into audited pages via
`(${parseSeoFromDocument.toString()})(document, window)`
(`lib/ada-audit/link-harvest.ts:86`). A `typeof o !== 'object'` guard compiled
to a module-scope `_type_of()` helper → `ReferenceError` inside the audited
page. Fix: duck-typing without `typeof`; the header of
`lib/ada-audit/seo/parse-seo-dom.ts` now states the self-containment contract
(no imports, no module consts, all helpers inside the body).

**Worked example C — pentest S1, the quick-wins phase (0222187, 2026-06-29).** Proving a secret was
gone from the shipped bundle used the same grep-the-artifact move:
`rg "144\.126|ssh seo|deploy\.sh|Hover to reveal" .next app components lib`
must return empty (`docs/superpowers/todos/2026-06-29-pentest-remediation-tracker.md`).

## Recipe 2 — Prove a scoring change (golden before/after)

**When to invoke:** any change to `computeHealthScore`
(`lib/services/scoring.service.ts`), `scoreLiveSeo` (`lib/findings/live-seo-score.ts`),
`computeScore` (`lib/ada-audit/scoring.ts`), or the pillar score functions.

**Steps:**

1. Freeze golden inputs — real-shaped fixtures spanning: a perfect site, a
   degenerate site (all factors failing), and 2–3 mid-range cases. All three
   scorers are pure functions, so this is a plain script or test.
2. **Write down predicted numbers BEFORE running anything.** "Removing factor X
   (weight 10) means the perfect site stays 100, the mid case moves from 81 to
   84±1 because…" A prediction made after seeing output is not a prediction.
3. Run the OLD scorer, then the NEW scorer, on the same goldens (old code via
   checkout or inlined in a scratchpad script — never in-repo).
4. Produce a per-factor delta table: factor, old earned/possible, new
   earned/possible, per-golden score delta. Compare against step 2. Any
   unpredicted movement = you don't understand your change yet; stop.
5. Pin the new behavior with a guard test, including a **negative-input guard**:
   prove excluded inputs cannot influence the score.

Run tests as
`DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/live-seo-score.test.ts`
(DB env by habit — the suite shares one SQLite dev DB).

**Worked example — live-score fork excludes crawl depth (969b3e3, 2026-06-30).**
`scoreLiveSeo` is a fork of `computeHealthScore` with crawl-depth and
broken-link factors deliberately NEVER in the denominator (live audits have no
crawl graph in v1). The guard test (`lib/findings/live-seo-score.test.ts:42-48`)
proves exclusion by injection: it passes `{ ...base, crawlDepth: 3 }` (under
`@ts-expect-error` — depth is intentionally not in `LiveScoreInputs`) and
asserts the score is byte-identical to `scoreLiveSeo(base)`. That is what a
proven "factor X is excluded" claim looks like: the excluded input is fed in
anyway and shown to be inert.

**Cautionary tale — pillar presence revert (7a162cd, 2026-04-29).** A prior
change (637ffed) keyed subscore "presence" off any-record availability, but the
score functions run on the informational subset. Sites with ZERO informational
pages got `presence=true` plus the function's empty-input fallback `score=5`,
which the dashboard rendered as a real "Moderate" score — the repo's only true
revert (not reachable from `git log main` — squash-merged via 1035b0b/PR #2;
use `git show 7a162cd`). Lesson: a fallback value that can masquerade as data IS a scoring bug;
goldens must include the empty-input case, and its predicted output is "renders
as absent," never a number.

## Recipe 3 — Prove concurrency/lock safety

**When to invoke:** any diff touching a Prisma transaction, raw SQL, a job
settle path, or counters — before review, and always before merge.

**Background (the 2026-06-10 incident, PR #52 / f246b7b):** interactive
`prisma.$transaction(async tx => ...)` holds SQLite's single write lock across
event-loop round-trips. Four concurrent pdfjs parses starved the loop; the lock
outlived `busy_timeout` (5s); every writer hit "Operations timed out"; the first
PDF-bearing audit failed 15/23 pages (reads kept working — WAL). Fix: all
interactive transactions → array-form, conditionals in SQL, `updatedAt` set
manually. Now a CLAUDE.md "Do not."

**The enumeration commands:**

```bash
# Every transaction call site (each must be array-form: $transaction([ ... ]))
grep -rn '\$transaction' --include='*.ts' lib app scripts | grep -v '\.test\.'

# Every raw write (each must set updatedAt manually and use EXISTS for conditionals)
grep -rn '\$executeRaw\|\$queryRaw' --include='*.ts' lib app | grep -v '\.test\.'
```

**Review checklist — every hit must pass all rows:**

| Check | Pass condition |
|---|---|
| Transaction form | `$transaction([...])` array-form only. `$transaction(async tx =>` at any CODE call site = automatic fail (4 comment-line mentions warning against the pattern exist today and are expected). |
| Conditional writes | Expressed in SQL (`EXISTS` predicate over pre-flip row state), never as JS read-then-write inside a transaction. Reference implementations: `lib/jobs/handlers/psi.ts:63-68`, `site-audit-page.ts:171-176`, `pdf-scan.ts:104-109`. |
| `updatedAt` on raw SQL | Set manually as integer ms (`"updatedAt" = ${Date.now()}` — see `site-audit-page.ts:174`). Raw SQL bypasses `@updatedAt`, and `updatedAt` is the stale-recovery heartbeat: forget it and recovery kills healthy audits. |
| PRAGMA statements | `$queryRawUnsafe`, never `$executeRawUnsafe` — several PRAGMAs return rows and `$executeRaw*` throws (`lib/db.ts:22-27`). |
| First-terminal-writer fencing | Status flips are conditional updates (`WHERE status = 'running'`-style), so a zombie attempt can't clobber a settled row. |

**Proof beyond review:** PR #52's verification re-ran the identical failing
audit (23 pages, 11 PDFs) → 59s, 0 timeouts, plus two restart drills (tracker:
`docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`). Reproduce
the load shape that failed, not a toy.

## Recipe 4 — Prove recovery correctness (kill/restart drills)

**When to invoke:** any change to `lib/jobs/` (worker, recovery, scheduler),
`lib/ada-audit/queue-manager.ts`, a job handler's claim/settle path, or a new
job type. "The code paths look right" is not evidence; a drill is.

**Local drill procedure:**

1. Start the dev server; enqueue real work (a site audit against a client site
   already in the system or a domain you control — never a third-party site).
2. Kill the process at the phase you claim is survivable: mid-`running`,
   mid-`pdfs-running`, mid-`lighthouse-running`.
3. Restart. Watch the boot log for the recovery lines:
   - `[jobs] startup recovery handled N orphaned running job(s)` (`lib/jobs/recovery.ts:38`)
   - `[queue] Startup recovery: resuming audit <id> (N durable job(s) outstanding)` (`lib/ada-audit/queue-manager.ts:326`)
   - `[queue] …: finalized drained audit <id>` (`queue-manager.ts:343`) — the drained-but-unfinalized case
4. Assert resume-or-fail-cleanly. **What to check, every drill:**

| Surface | Assertion |
|---|---|
| Job rows | orphaned `running` jobs re-queued (attempts bumped, `lastError` set) or settled; zero stuck `running` rows with a dead heartbeat |
| Parent status | transient parent resumed and eventually terminal (`complete` or failed via the shared destructive path) — never wedged transient forever |
| Children | no orphan `AdaAudit`/`PdfAudit` rows left polling; counters match child rows (e.g. 24/24 pages, 11/11 PDFs) |
| Duplicates | 0 duplicate `(siteAuditId, url)` child pairs after resume |
| Second restart | run the drill twice — recovery must be idempotent too |

**Worked example — A1 (durable job queue) Phase 3 prod verification (tracker, 2026-06-10).** Three
drills with stated expected outcomes: (1) clean PDF-bearing run with exact
counters (23 pages = 22 complete + 1 redirected, 11/11 PDFs, 22/22 lighthouse,
0 errors); (2) queue-order proof — a second audit stayed `queued`, then
auto-promoted on finalize; (3) `pm2 restart` at 1/24 pages → both recovery log
lines appeared → audit completed 24/24, all children `complete`, all jobs
settled, 0 duplicate pairs. Phase 2's drills (same tracker) proved the drained
case: a `pdfs-running` parent with zero jobs was finalized, not failed
("finalize-before-fail").

**Prod drills:** `pm2 restart` is autonomous under the 2026-07-03 ruling
(operational recovery), but a deliberate kill-mid-audit drill interrupts real
work — schedule it with Kevin, write the assertion list BEFORE restarting, and
report the results either way.

## Recipe 5 — Prove idempotency (double-run test)

**When to invoke:** any handler, hook, or recovery path that can legitimately
run twice — job retries (`maxAttempts > 1`), fire-and-forget + recovery
re-enqueue pairs, scheduler slots, webhook-shaped endpoints.

**Method:** run the identical operation twice; assert single effect by counting
rows, not by eyeballing. In a vitest DB test: call the handler, snapshot counts,
call it again with the same input, assert counts and key rows unchanged.

**Mechanism inventory — how idempotency is actually enforced here (all in
`prisma/schema.prisma` unless noted):**

| Mechanism | Where | Guarantees |
|---|---|---|
| `@@unique([scheduleId, scheduledFor])` on `Job` (:340) | scheduler tick | exactly one job per schedule slot (SQLite exempts NULLs, so ad-hoc jobs are unconstrained) |
| `dedupKey` partial unique index (active statuses only) | `lib/jobs/queue.ts` `enqueueJob` | one active job per `(type, dedupKey)`; re-enqueue while active is a no-op |
| `@@unique([siteAuditId, tool])` on `CrawlRun` (:374) | findings runs | one run per origin per tool; `findUnique`/`update` need `{ siteAuditId_tool: {...} }` |
| Delete-and-recreate writer | `lib/findings/writer.ts:38` | `writeFindingsRun` is safe to re-run: one array-form txn deletes the old run (cascade) and recreates |
| `@@unique([runId, dedupKey])` on `Finding` (:478) + sha256 keys (`lib/findings/keys.ts`) | findings rows | duplicate findings collapse deterministically |
| `@@unique([runId, url])` on `CrawlPage` (:457), `@@unique([siteAuditId, url])` on `AdaAudit` (:277) | page rows | P2002-tolerant child creation on discover retry |
| `@@unique([scheduleId, scheduledFor])` on `SeoReportBatch` (:579) + `@@unique([batchId, clientId])` on `SeoReport` (:610) | C10 reports | one batch per slot, one report per client per batch |
| Transient-table consumption order | `lib/jobs/handlers/broken-link-verify.ts` | write run FIRST, delete `HarvestedLink`/`HarvestedPageSeo` AFTER — a crash between leaves a retry that harmlessly delete-and-recreates |

**Worked example:** the broken-link verifier (`broken-link-verify`,
`maxAttempts: 2`) is idempotent by construction — a retry re-reads surviving
transient rows in deterministic order (so the 2000-check cap covers the same
subset) and `writeFindingsRun` replaces rather than appends. When adding a job
type, this is the bar: name the mechanism from the table that makes YOUR retry
single-effect, then double-run it in a test.

## Recipe 6 — Prove findings parity (blob vs tables)

**When to invoke:** after any change to a mapper (`lib/findings/seo-mapper.ts`,
`ada-mapper.ts`), the writer, or a dual-write hook; after a `[findings] …
dual-write failed` log line; before flipping any reader from blob to tables.

**Commands (id type is auto-detected — session, site audit, or standalone ADA):**

```bash
# Verify: blob-vs-tables comparison, exit 1 with diff lines on mismatch
DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-parity.ts <id>

# Fix: rebuild findings rows from the origin blob (delete-and-recreate, safe to re-run)
DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts <id>
```

On prod (read-only parity is fine to request; rebuild mutates — clear it with
Kevin): `cd /home/seo/webapps/seo-tools && npx tsx scripts/findings-parity.ts <id>`.

**Rules:**
- Parity REQUIRES the blob — a pruned (90-day archived) row fails by design.
- `findings-rebuild.ts` refuses pruned **Session** blobs (`scripts/findings-rebuild.ts:44-46`),
  but the ADA branches (`writeAdaSiteFindings`/`writeAdaSingleFindings`) have NO
  pruned-blob guard: on a 90-day-pruned SiteAudit/AdaAudit id, `parseAxe(null)`
  yields empty pages and the delete-and-recreate writer would silently REPLACE
  the canonical findings tables with an empty run. **Never run rebuild on a
  pruned ADA row** — after 90 days the tables ARE the canonical record.
- Rebuild is a dual-write-failure recovery tool for current-format runs, NEVER a
  historical backfill (pre-A2 — pre-findings-layer — blobs must not be
  backfilled; house rule).
- For a SiteAudit id, rebuild touches only the `ada-audit` run; the live-scan
  run is owned by the verifier job.
- Run parity on 3–5 representative real rows, not one synthetic one.

**Worked example — A2 Phase 1 prod parity (tracker, 2026-06-10).** The first
production parity run surfaced a real bug the tests missed: nuvani.edu's
`page_index` carried one URL under two refs, violating `@@unique([runId, url])`.
Fix: keep-first dedupe by normalized URL in the mapper (PR #56); subsequent runs
PARITY OK (nuvani.edu: 146 pages / 433 findings / score 81). Parity against
messy real data is the experiment; synthetic fixtures only prove you can pass
your own fixtures.

## Recipe 7 — Prove a deploy is healthy (post-deploy verification)

**When to invoke:** after every deploy — mandatory, not optional: under the
2026-07-03 ruling deploys are autonomous when gate-green, and this recipe is
the required second half of that autonomy (`er-seo-tools-change-control`
rule 1). The verification below is read-only SSH.

**Checklist, in order:**

1. **Boot survived the fail-fast gates.** `instrumentation.ts` calls
   `process.exit(1)` on: missing `PILLAR_TOKEN_SECRET`, unconfigured auth, or
   missing Chromium egress guard (`CHROME_PROXY_SERVER` /
   `CHROMIUM_NETWORK_ISOLATED=true`). A green build can still crash-loop PM2 on
   env alone.
   ```bash
   pm2 status                                   # status 'online', restarts not climbing
   pm2 logs seo-tools --lines 50 --nostream     # no [startup] errors, no exit loop
   ```
   Log files: `/home/seo/logs/seo-tools-out.log` + `seo-tools-error.log`.
2. **Recovery + schedules ran.** Boot log shows startup recovery (silent when
   nothing was orphaned; `[jobs] startup recovery handled N…` when something
   was) and no errors from `seedSystemSchedules` / `recoverQueue`.
3. **Migration applied.** If the deploy carried a migration, confirm
   `prisma migrate deploy` output listed it, and the boot log is error-free
   after (the deploy script stops the app before migrating — SQLite locks).
4. **Functional probe.** Exercise the changed surface with a small real
   operation on a controlled domain (client site already in the system or an
   `erstaging.site` property), asserting exact counters (pages = complete +
   redirected, PDFs n/n, lighthouse n/n, 0 errors) — the assertion style of
   every tracker prod-verification entry.
5. **Prod-only hazards pass.** If the diff had Recipe-1 hazards, verify on prod
   (the minified build) — this repo's worst bugs were invisible everywhere else.
6. **Log the verification** in the tracker status log (handoff protocol:
   CLAUDE.md / `er-seo-tools-docs-and-writing`).

## Recipe 8 — Prove an external-fetch feature is safe (SSRF checklist)

**When to invoke:** any new code that fetches a URL derived from user/client
input — link checkers, sitemap crawlers, PDF fetchers, audit targets, webhooks.

**Permission rule first (owner ruling):** never scan third-party sites casually.
Audits, live scans, and broken-link verification hit real external websites —
only client sites or sites you have permission to scan; dev test crawls use
client sites already in the system or domains you control.

**Checklist:**

| Check | Pass condition |
|---|---|
| Transport | ALL outbound fetches go through `safeFetch` (`lib/security/safe-url.ts`) — never bare `fetch`/`http.request` on derived URLs |
| Protocol | http/https only (enforced by safe-url) |
| Hostname | blocked names (`localhost`, ip6-*) and suffixes (`.local`, `.internal`, `.lan`, `.home`, `.corp`) rejected (`assertPublicHostname`) |
| IP literals | private/loopback/link-local/metadata literals rejected (`isPrivateOrInternalAddress`, safe-url.ts:101) |
| DNS rebinding | RESOLVED addresses are checked too — if ANY resolved address is private/internal, the request throws (safe-url.ts:217) |
| Redirects | capped (MAX_REDIRECTS = 5) and each hop re-validated |
| Stored input | domains validated server-side at write time via `lib/security/domain-validation.ts` (`normalizeClientDomain`): hostname-only, rejects schemes/paths/ports/credentials/IP literals/reserved suffixes |
| Legacy stored data | re-validate at USE time, not only at write time (see worked example) |
| Failure semantics | `SafeUrlError` → the target is `unconfirmed`, never `broken` (`lib/ada-audit/broken-link-check.ts`) — a blocked fetch must not fabricate a finding |
| Chromium egress | if the feature drives the browser, the prod egress guard applies (boot refuses without `CHROME_PROXY_SERVER` or `CHROMIUM_NETWORK_ISOLATED=true`) |
| Tests | reject/accept lists as unit tests, transport injected (`realDeps` pattern in broken-link-check.ts) |

**Worked example — pentest S3 fix, the input-validation phase (e786b2d, 2026-06-29).** The authenticated
pentest showed client domains were accepted unvalidated. The fix added
`lib/security/domain-validation.ts` and — the instructive part — re-validates
the submitted domain in `POST /api/clients/[id]/schedules` BEFORE the membership
check, so a malformed domain that predates validation cannot be scheduled.
Proof: 42 validator tests built from the pentest's reject/accept lists plus a
legacy-bad-stored-domain regression test. Validating only new writes would have
left every existing bad row exploitable.

## Recipe 9 — Adversarial refutation as institution (Codex review)

**When to invoke:** every spec and plan (mandatory house ritual — see the
`consulting-codex` skill and `er-seo-tools-change-control`), and any nontrivial
correctness claim ("this hash can't collide", "this poll always terminates").

**Method:**

1. Route the artifact through the `consulting-codex` skill with the claim stated
   falsifiably, plus the actual diff/spec — not a summary.
2. Treat findings as hypotheses: **independently verify each Codex claim against
   the code before accepting or rejecting it.**
3. Apply named fixes; a "send back for rewrite" verdict stops the flow.
4. A claim SURVIVES only when a hostile reviewer with code access tried to break
   it and the specific attack was checked against the source and failed.

**Worked example — the 2026-06-02 six-PR review**
(`docs/superpowers/todos/2026-06-02-seo-audit-codex-review-findings.md`, PRs
#35–#40). All six PRs came back "ship-with-fixes", zero critical, findings
ranked with cross-cutting themes extracted. Two Codex claims were independently
verified against the code before acceptance — both real: the `affectedSetHash`
empty-set collision (grouped duplicate types hashing identically, breaking
Teamwork dedupe; fixed in bcea72c) and a gating bug. The review caught
prod-shaped bugs no test had: mint-token "processing" states that never age out
(found twice, P36 + P40), offset pagination over non-unique sort columns, and an
exact-URL-only join that made a "fixed" claim hold only when two tools emit
byte-identical URLs. The pattern to copy: the reviewer's job is to name the
input that breaks you; your job is to check that input against the code.

## Common mistakes

- **Green tests as proof of a novel claim.** All four production incidents
  (parser-key, write-lock, PM2 SIGKILL, build OOM) had fully green local gates.
  Gates prove non-regression of what's already tested; recipes prove new claims.
- **Predicting after the fact.** Running the scorer, seeing 84, then explaining
  84. The prediction goes in writing before the run (Recipe 2).
- **Testing idempotency by reading the code.** Double-run it (Recipe 5). A
  compound-unique that "obviously" protects you may exempt NULLs (SQLite does).
- **Drilling only the happy restart.** Also drill drained-but-unfinalized and a
  second restart (Recipe 4).
- **Parity on synthetic fixtures only.** The nuvani.edu duplicate-URL bug was
  only findable against messy real data (Recipe 6).
- **Treating a blocked/failed fetch as a finding.** SSRF-blocked and timed-out
  targets are `unconfirmed`, excluded from broken (Recipe 8).
- **Accepting (or dismissing) Codex findings unverified.** Both accepted claims
  in the 2026-06-02 review were checked against source first (Recipe 9).
- **Scanning third-party sites to "test something quickly."** Owner rule:
  permissioned or controlled domains only.

## Provenance and maintenance

Authored 2026-07-02 against branch `feat/autonomous-live-seo-source` (23 commits
ahead of main; main tip = PR #84, 2026-06-29); all file:line references verified
on that branch. CLAUDE.md's "a live-scan run NEVER displaces the score"
describes MAIN; on this branch a `seoIntent=true` live-scan CAN become canonical
when the SF upload is stale >30d or absent (`lib/services/seo-canonical.ts`) —
say which merge state you mean when quoting score-selection invariants.

Re-verification one-liners for volatile facts:

| Fact | Re-verify |
|---|---|
| Branch/merge state | `git branch --show-current && git log origin/main..HEAD --oneline \| wc -l` |
| Transaction call sites (Recipe 3) | `grep -rn '\$transaction' --include='*.ts' lib app scripts \| grep -v '\.test\.'` |
| Raw-SQL call sites | `grep -rn '\$executeRaw\|\$queryRaw' --include='*.ts' lib app \| grep -v '\.test\.'` |
| Compound-unique catalog (Recipe 5) | `grep -n '@@unique' prisma/schema.prisma` |
| Live-score guard test still present | `grep -n 'excludes crawl depth' lib/findings/live-seo-score.test.ts` |
| scoreLiveSeo factors/weights | read `lib/findings/live-seo-score.ts` (weights 20/20/10/8/7/10/10 as of 2026-07-02) |
| Parity/rebuild script usage | `head -10 scripts/findings-parity.ts scripts/findings-rebuild.ts` |
| Recovery log strings (Recipe 4) | `grep -rn 'startup recovery\|resuming audit\|finalized drained' lib/jobs lib/ada-audit --include='*.ts' \| grep -v '\.test\.'` |
| safeFetch guard behavior (Recipe 8) | read `lib/security/safe-url.ts` (`assertPublicHostname`, `isPrivateOrInternalAddress`, MAX_REDIRECTS) |
| Injected-function contract | header comment of `lib/ada-audit/seo/parse-seo-dom.ts` + `lib/ada-audit/link-harvest.ts:86` |
| Boot fail-fast gates (Recipe 7) | read `instrumentation.ts` (exit-1 gates near the top) |
| PM2 log paths | `grep -n 'error_file\|out_file' ecosystem.config.js` |
| Incident commits cited | `git show 480a637 cc8d1c1 7a162cd f246b7b e786b2d --stat` |
