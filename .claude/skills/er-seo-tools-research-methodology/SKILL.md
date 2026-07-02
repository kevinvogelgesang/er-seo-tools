---
name: er-seo-tools-research-methodology
description: "Use when a claim needs to get ACCEPTED in er-seo-tools — proposing a new feature idea, asserting a root cause ('I think the bug is…'), declaring a fix verified ('is this actually fixed?'), deciding if a hypothesis is proven, retiring or skipping planned work, or figuring out where an idea belongs (FUTURE doc, nyi spec, roadmap entry, tracker item). Also when planning prod verification after a deploy or when a diagnosis explains some symptoms but not all of them."
---

# Research methodology: how a hunch becomes an accepted result here

## Overview

In this repo, nothing is "true" because it sounds right, passes tests locally, or is written in a doc.
A claim is accepted when **one mechanism explains every observation (including the negatives), it
survives adversarial review, and it predicts the numbers of a verification run before that run
happens**. This skill is the discipline for getting from hunch to accepted result — and for
retiring ideas so they stay retired.

Jargon used below, defined once:

| Term | Meaning here |
|---|---|
| **Codex review** | Adversarial review of a spec, plan, or diff by Codex CLI via the `consulting-codex` skill. Mandatory for every spec and plan before implementation (Kevin's standing instruction). ~94 commits mention Codex fixes. |
| **Tracker** | `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` — checkbox status + append-only dated status log per roadmap item. |
| **Handoff** | `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` — living chat-to-chat pickup doc, rewritten in the same commit as any tracker change. |
| **nyi** | `docs/superpowers/nyi/` — finished-but-unbuilt specs/plans, `FUTURE-*` idea docs, and the `improvement-roadmaps/` strategy docs. |
| **Gate-green** | `npm run lint` (= `tsc --noEmit`) + `npm test` (= `vitest run`) + `npm run build` all pass. Necessary, never sufficient — every major incident in this repo passed local gates. |
| **Prod verification** | Post-deploy runbook with expected values stated in advance, results logged as a dated tracker status line. |

## When to use / When NOT to use

**Use** when the deliverable is an *accepted claim*: a diagnosis, a "this is fixed", a "we should
build X", a "we should stop doing Y", or a spec/plan that needs to survive review.

**Do NOT use** for:
- Executing an already-accepted plan → `superpowers:subagent-driven-development` / `superpowers:executing-plans`, and `er-seo-tools-docs-and-writing` for the doc rituals.
- Step-by-step bug triage (symptom → which log → which query) → `er-seo-tools-debugging-playbook`.
- The catalogue of past incidents and their root causes → `er-seo-tools-failure-archaeology`.
- Specific measurement instruments (scripts, DB queries, log greps) → `er-seo-tools-diagnostics-and-tooling`.
- Proof techniques with worked examples (parity comparators, restart drills) → `er-seo-tools-proof-and-analysis-toolkit`.
- What is still an open problem and what it would take to close it → `er-seo-tools-research-frontier`.
- How a change is classified/gated once accepted → `er-seo-tools-change-control`.

---

## 1. The evidence bar

A diagnosis or design claim is accepted only when it clears **both** hurdles:

### 1a. One mechanism must explain ALL observations — including the negatives

If your explanation covers three symptoms but leaves a fourth unexplained, you do not have the
root cause yet. The house-canonical worked example is the **parser-key minification bug**
(commit `480a637`, PR #45, 2026-06-02):

| Observation | Explained by "SWC prod build minifies class names, so aggregator keys derived from `ParserClass.name` became `'af'` etc. and all 46 hardcoded `parsedData.<key>` lookups missed"? |
|---|---|
| Every **prod** audit had `page_index = 0`, even healthy 24-page crawls | Yes — the internal-crawl data was parsed but keyed under a minified name nobody reads |
| Completeness verdict always "thin"/"internal crawl missing" even when `internal_all.csv` WAS uploaded | Yes — completeness reads the same missed keys |
| "Hollow" roadmaps with no on-page content issues | Yes — keyword/duplicate joins read the same missed keys |
| `parsers_used` showed **single-letter names** | Yes — those ARE the minified class names, leaking into output |
| **Negative:** dev and 800+ tests stayed green the whole time | Yes — nothing is minified in dev/vitest, so the derivation worked there |

Five tells, one mechanism, zero leftovers — including the negative ("why didn't tests catch it?").
That last row is not optional: **a root-cause claim that cannot explain why the bug was invisible
where it was invisible is incomplete.** Read the full commit message (`git show 480a637`) — it is
the template for how an accepted diagnosis is written up: ROOT CAUSE, the symptom list it explains,
FIX, why dev behavior is unchanged, and a regression guard.

### 1b. The claim must survive adversarial refutation — institutionalized as Codex review

This repo does not trust the author of a claim to be its only critic. Every spec and plan routes
through Codex review (`consulting-codex` skill) before implementation; large multi-PR efforts get a
final-diff pass too. This is not ceremony — the reviews find real bugs. The canonical citation is
the **2026-06-02 six-PR adversarial review**
(`docs/superpowers/todos/2026-06-02-seo-audit-codex-review-findings.md`), where Codex reviewed PRs
#35–#40 against their `base..head` diffs and found, among others:

- the `affectedSetHash` bug — empty-set hash collisions across grouped duplicate types breaking Teamwork dedupe (later fixed on main: `bcea72c fix(seo): make affectedSetHash set-based + fold group URLs (review P38)`);
- the sticky mint-token `processing` state (the same bug twice, in two PRs — every future page load auto-started a 15-minute poll cycle);
- exact-URL-only joins that left title/H1 blank on any trailing-slash mismatch between tools.

Two of Codex's claims were independently verified against the code before acceptance — that is the
protocol: **a reviewer's finding is itself a claim and gets the same treatment** (see
`superpowers:receiving-code-review`). Review outcomes are recorded in tracker status lines as
"Codex accept-with-fixes ×N" with the named fixes listed.

If Codex's verdict is "send back for rewrite" rather than "accept with named fixes", stop and wait
for Kevin — that is the standing exception to the auto-route flow.

---

## 2. Hypothesis predicts numbers BEFORE the run

The house pattern for verification: **write down the expected observations first, then run the
experiment, then compare.** A verification that decides what "success" looks like after seeing the
output is not a verification.

Verified examples of the pattern in the record:

| Claim under test | Predicted-in-advance observation | Where recorded |
|---|---|---|
| PM2 `max_memory_restart: 1200M` (not code) killed the fei.edu audit | "Queue the same fei.edu audit that failed at page 8; verify it completes the full 34-page run without a PM2 restart" — written as a post-deploy checklist item before deploying | `docs/superpowers/archive/plans/2026-05-14-audit-stability.md` (verification checklist near end of file) |
| Array-form transactions fix the SQLite write-lock starvation | Re-run the **identical** audit that wedged (nyinstituteofmassage.com, 23 pages, 11 PDFs): expect completion, 0 timeouts. Result: 59s, 0 timeouts, plus two restart-recovery drills | Tracker status log, A1 (durable job queue) Phase 2 entry (PR #52) |
| Durable page-loop makes `running` restart-survivable | `pm2 restart` at page 1/24 → expect startup-recovery log lines, audit resumes and completes 24/24 pages, 0 duplicate `(siteAuditId, url)` pairs | Tracker status log, A1 Phase 3 entry (PR #53) |
| Findings dual-write matches legacy blobs | `findings-parity` expected "PARITY OK" on named sites with known page/violation counts (146 pages / 433 findings / score 81, etc.) | Tracker status log, A2 (findings layer) Phase 1–2 entries |

Operational rules:

1. Before any prod verification, write the runbook: exact action, exact expected value or log line, and what a miss would mean. Put it in the plan or handoff before deploying.
2. Prefer **re-running the identical failing case** over a fresh synthetic case — it is the only run that directly refutes "the fix didn't address MY failure".
3. A prediction that comes true on the first try is evidence; a prediction adjusted after the fact is a narrative. Log misses honestly — the A2 Phase 1 prod parity run surfaced a real new bug (duplicate URL refs violating `@@unique([runId, url])`) and that became PR #56, not a footnote.
4. Local gates are a precondition, not evidence: the dominant failure mode across all four production incidents (minification, PM2 memory ceiling, reverse proxy, build heap) is **dev/prod divergence** — every one passed local tests. Claims about prod behavior are only settled in prod.

---

## 3. The idea lifecycle

Every stage below exists in the repo and is evidenced. An idea that skips stages does not get
accepted; an idea that completes them does not need re-litigating.

```
hunch
  → nyi/FUTURE-*.md  or  nyi/improvement-roadmaps/ entry     (parked, written down)
  → [optional] multi-agent consensus / brainstorm            (framing, not proof)
  → spec: docs/superpowers/specs/YYYY-MM-DD-<name>-design.md
  → Codex review (accept-with-fixes ×N, fixes applied in place)
  → plan: docs/superpowers/plans/YYYY-MM-DD-<name>.md
  → Codex review (again — the plan is a separate claim)
  → subagent-driven TDD build (plan header mandates the sub-skill)
  → gates: npm run lint && npm test && npm run build
  → PR
  → KEVIN's merge + deploy gate (never merge/deploy without his explicit go)
  → prod verification (predicted numbers, §2)
  → tracker checkbox + dated status line + handoff rewrite (same commit)
  → specs/plans move to docs/superpowers/archive/ on ship
```

Evidence per stage (spot-check any of these):

| Stage | Evidence |
|---|---|
| Parked hunch | `docs/superpowers/nyi/specs/FUTURE-keyword-research-tool-design.md` ("Do not implement until a full design spec has been written and approved"); `nyi/improvement-roadmaps/00-overview.md`–`06-platform.md` |
| Multi-agent consensus | `docs/superpowers/todos/2026-06-01-seo-audit-consensus.md` — 8 agents with distinct stances (risk-averse, contrarian, first-principles…), all reading the real code, under fixed owner constraints |
| Spec, `-design.md` suffix | `docs/superpowers/specs/2026-06-30-autonomous-live-seo-source-design.md`; 40+ shipped ones in `archive/specs/` |
| Codex spec/plan review | Commits `a8ec2db` (spec fixes), `e716ced`/`7dd2ae2` (plan fixes); tracker lines record "accept-with-fixes ×8/×9/×14" with fixes named |
| Subagent TDD build | Plan header: "**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development…" (`plans/2026-06-30-autonomous-live-seo-source.md` line 3) |
| Gates | `package.json`: `"lint": "tsc --noEmit"`, `"test": "vitest run"`, `"build": "NODE_OPTIONS='--max-old-space-size=3072' next build"` |
| Kevin's gate | Owner ruling 2026-07-02: AI sessions may push branches and open PRs but never run `~/deploy.sh`, never SSH-mutate the server, never merge to main without Kevin's explicit go in the current conversation |
| Prod verification + tracker/handoff | Every SHIPPED tracker entry ends with a prod-verification account; handoff rewritten in the same commit (protocol in project `CLAUDE.md`) |
| Archive on ship | `docs/superpowers/archive/specs/` + `archive/plans/` (lifecycle in `docs/superpowers/README.md`) |

Two important honesty notes about lifecycle bookkeeping:

- **Plan checkboxes are never ticked.** The active Phase-4 plan has 0 `[x]` against 76 `[ ]` despite 14/15 tasks being complete. Completion truth lives in `git log` + tracker status lines, never in the plan file.
- **The "active" folders drift.** A shipped spec/plan can linger in `specs/`/`plans/` un-archived (the 2026-06-04 render-dedup pair did). The tracker + handoff are the status source of record.

### The retirement path

Retired ideas get a **written one-line rationale at the place they were proposed**, so no future
session re-proposes them. Verified precedents:

- **Task 13 (retention carve-out), C6 (live SEO source) Phase 4:** intentionally skipped — the tracker entry says so in-line: "Task 13 (retention carve-out) intentionally skipped — redundant with existing pruning paths." No code, no revert, no ambiguity.
- **P3 (login throttling), pentest track:** superseded — the pentest tracker states "P3 (login throttling) is REMOVED from this track — Kevin is implementing full Google OAuth, which supersedes it," with the decision dated (2026-06-29) and ownership reassigned.

When you retire or skip something, copy this pattern: name the item, say *skipped/superseded/reverted*,
give the one-line reason, date it, and put it where the item was tracked — not in a chat reply.

---

## 4. Where accepted ideas have actually come from

When hunting for what to work on (or judging whether an idea is grounded), know the historical
sources. Every major accepted initiative traces to one of these:

| Source | Evidence |
|---|---|
| **Real client-audit pain** | The 2026-06-04 nuvani.edu test audit (`todos/HANDOFF-2026-06-04-seo-audit-test-findings.md`) — a deliberate skill-round-trip + parser-coverage exercise whose findings drove the June PR #42–#48 accuracy batch (parser-key fix, `sf_*` dedup, sitemap 2xx gating, completeness banner, unified skill) |
| **Incidents becoming architecture** | fei.edu OOM (2026-05-14) seeded the orphan-recovery design that became the durable job queue; the SQLite write-lock incident (2026-06-10) became the hard "array-form `$transaction` only" invariant in CLAUDE.md, cited by every later spec |
| **Security pressure** | The 2026-06-29 authenticated pentest → S1–S4 remediation (PR #82) → full Google OAuth (PRs #83/#84) in days |
| **Kevin's workflow friction** | The SEO-audit overhaul spec's core diagnosis (`archive/specs/2026-06-01-seo-audit-overhaul-design.md`): "the tool is not broken — it is *lopsided*… the missing piece is the **decision loop**" — Kevin used only upload + copy-JSON and did the real work outside the app; the entire overhaul spine followed from observing that |
| **Strategic docs** | `nyi/improvement-roadmaps/00-overview.md`–`06-platform.md` (2026-06-10, Codex-reviewed) — the spine (job queue, findings layer, client command center) that the tracker has been executing since |

Corollary: an idea with none of these anchors — no observed pain, no incident, no measured gap —
starts life as a `FUTURE-*.md` in `nyi/`, not as a spec.

---

## 5. The experiment-flag pattern for reversible bets

House style for "we think X is better but aren't sure": put it behind an env switch, measure in
prod, then **promote or retire — and delete the flag when promoted**.

Verified examples:

- **`JOB_QUEUE_PSI`** (A1, 2026-06-10): PSI migrated to the durable queue behind a flag, default off. Prod parity run 1 matched legacy exactly (19/19 lighthouse, 0 errors); run 2 survived a mid-flight PM2 restart. Flag flipped on → then the legacy in-memory pool **and the flag and all branching were deleted** in the Phase-1 close-out. A promoted experiment leaves no fork behind.
- **`LIGHTHOUSE_PROVIDER`** (`lib/ada-audit/lighthouse-provider.ts`): `pagespeed | local | off`, default `local` in code, `pagespeed` in the deployed `ecosystem.config.js`. This one stays a switch permanently because the trade-off is environmental (PSI's data-center IPs get WAF challenge pages on some client sites — see `nyi/specs/2026-05-29-psi-a11y-reframe-design.md`), not a settled question.

Decide up front which kind you are building: a **migration flag** (dies after promotion) or a
**provider switch** (lives forever because reality varies). Never let a migration flag linger —
double codepaths are where dev/prod divergence bugs breed.

---

## 6. Anti-patterns, with the incident that taught each

| Anti-pattern | The story | The rule |
|---|---|---|
| **Shipping on eyeball** | Pillar presence semantics (637ffed → revert `7a162cd`, 2026-04-29, the ONLY true revert in 800+ commits): presence was keyed off any-record availability, so sites with zero informational pages rendered the empty-input fallback `score=5` as a real "Moderate" score. It looked plausible on screen; nobody predicted what an empty-input site *should* show before looking | State the expected output for the degenerate input (empty set, zero rows, noindex site) before rendering it. A fallback value that can be mistaken for a measurement is a bug |
| **Trusting dev as evidence for prod** | Parser-key minification (§1a) — and the same class recurred one month later: `cc8d1c1`, a `typeof` in the `.toString()`-injected `parseSeoFromDocument` emits an escaping SWC `_type_of` helper that `ReferenceError`s inside the audited page. Green in dev both times | Any code whose runtime context differs from the test context (minified prod build, string-injected into a page, behind a reverse proxy, under PM2 memory limits) needs verification in THAT context. "Tests pass" is a statement about dev |
| **Trusting docs over code** | The tracker/handoff Phase-4 summaries (as of 2026-07-02) claim three unbuilt features (self-healing seoIntent schedules, a `lib/seo/providers/` layer, live srt_/krt_ memos) — none in the code; owner ruling: **plan + code are ground truth**. See er-seo-tools-failure-archaeology entry 16 | Before repeating a capability claim from a tracker/handoff/README, grep for the code. Status docs are written by sessions under time pressure and can describe aspirations as facts. (README.md's deploy paths are also stale — CLAUDE.md wins) |

## Common mistakes

- Declaring a root cause that explains the positive symptoms but not why tests/dev stayed green. Incomplete — see §1a.
- Treating gate-green as "verified". Gates are a precondition; verification is a predicted prod observation coming true (§2).
- Skipping Codex review on a spec or plan because it "is small". The review is mandatory per Kevin's standing instructions; small specs get small reviews, not no reviews.
- Accepting a Codex (or any reviewer) finding without independently verifying it against the code — reviewer claims meet the same evidence bar.
- Silently dropping a planned task. Skips get a written one-line rationale where the item is tracked (§3, retirement path).
- Marking work done in the plan file's checkboxes and nowhere else. Nobody reads those; the tracker + handoff commit is the record.
- Merging or deploying to "complete the experiment". Prod verification requires a deploy, and deploys are Kevin's gate — plan the verification, hand Kevin the runbook, wait.
- Re-proposing a retired idea because you only read the code. Check the tracker/pentest tracker for "intentionally skipped"/"superseded" lines first.

## Provenance and maintenance

Written 2026-07-02 against branch `feat/autonomous-live-seo-source` (C6 Phase 4, 23 commits ahead
of main tip `6679993`, gate-green, NOT merged, NOT deployed). The lifecycle, evidence bar, and
anti-pattern stories are historical (main); the Phase-4 doc-vs-code discrepancy in §6 describes the
branch state and should be re-checked after merge — once the handoff is corrected or the missing
pieces are built, that row needs updating. Canonical-run selection is merge-state-sensitive
(branch vs main) — see er-seo-tools-architecture-contract §6; verify: `git branch --show-current
&& grep -n pickCanonicalSeo lib/services/findings-shared.ts`.

Re-verification one-liners:

| Volatile fact | Re-verify with |
|---|---|
| Branch merged yet? | `git log origin/main..feat/autonomous-live-seo-source --oneline \| wc -l` (0 = merged) |
| Parser-key worked example | `git show 480a637 -s` |
| Codex 2026-06-02 review findings | `head -40 docs/superpowers/todos/2026-06-02-seo-audit-codex-review-findings.md` |
| SQLite-fix predicted-rerun story | `grep -n "59s" docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` |
| fei.edu predicted-rerun checklist | `grep -n "page 8" docs/superpowers/archive/plans/2026-05-14-audit-stability.md` |
| Task 13 skip rationale | `grep -n "Task 13" docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` |
| P3 superseded rationale | `grep -n "P3" docs/superpowers/todos/2026-06-29-pentest-remediation-tracker.md` |
| Pillar revert story | `git show 7a162cd -s` |
| Injected-code SWC recurrence | `git show cc8d1c1 -s` |
| Provider-switch flag | `grep -n LIGHTHOUSE_PROVIDER lib/ada-audit/lighthouse-provider.ts` |
| Canonical selector (branch-only) | `grep -n pickCanonicalSeo lib/services/seo-canonical.ts` |
| Gate commands | `grep -n '"lint"\|"test"\|"build"' package.json` |
| Doc taxonomy/lifecycle | `head -20 docs/superpowers/README.md` |
| Current next action | `head -30 docs/superpowers/todos/HANDOFF-improvement-roadmap.md` |
