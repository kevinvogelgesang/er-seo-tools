---
name: er-seo-tools-docs-and-writing
description: Use when writing or updating any doc of record in er-seo-tools — specs, implementation plans, trackers, HANDOFF docs, CLAUDE.md, README — or when asked for "the handoff prompt"/"handoff", when deciding where a new doc goes in docs/superpowers/, when archiving docs after a ship, when ticking tracker checkboxes or adding status-log lines, when writing commit messages, or when two docs contradict each other and you must decide which to trust.
---

# er-seo-tools: Docs of record, templates, and house style

## Overview

This repo runs on documents: a strict `docs/superpowers/` taxonomy, a contractual
handoff ritual, and dense spec/plan templates that let any zero-context session pick
up the work. The core principle: **docs are load-bearing infrastructure with a known
trust ranking — code > plan/spec > tracker/handoff > CLAUDE.md > README** — and the
rituals that keep them current are mandatory, never skipped under time pressure.

## When to use

- Writing a new spec, plan, tracker entry, or handoff update.
- Completing or meaningfully advancing a roadmap item (triggers the handoff protocol).
- Kevin asks for "the handoff prompt" or "handoff".
- Shipping a feature (archive its docs; update CLAUDE.md).
- Two docs disagree and you need the truth ranking.
- Writing commit messages.

## When NOT to use

- Classifying/gating a code change or deciding whether it needs review →
  `er-seo-tools-change-control`.
- Deciding what evidence proves a feature works → `er-seo-tools-validation-and-qa`.
- The idea lifecycle (nyi → spec → Codex → plan → build) and evidence bar for new
  research directions → `er-seo-tools-research-methodology`.
- Adding code (routes, jobs, parsers) → `er-seo-tools-extension-recipes`.
- History of incidents behind the invariants → `er-seo-tools-failure-archaeology`.

## The docs/superpowers taxonomy

Defined in `docs/superpowers/README.md` (keep that file current when the taxonomy
changes). As of 2026-07-02 the archive holds 43 specs + 57 plans.

| Folder | What lives here |
|---|---|
| `specs/`, `plans/` | **Active / in-progress** work only |
| `archive/specs/`, `archive/plans/` | **Shipped** — moved here on ship, kept for history |
| `nyi/specs/`, `nyi/plans/` | Written-but-not-built, plus `FUTURE-*` idea docs |
| `nyi/improvement-roadmaps/` | The seven Codex-reviewed strategy docs (00–06); start at `00-overview.md` |
| `todos/` | Trackers + HANDOFF docs (lightweight status/next-action files) |

**Lifecycle:** write in `specs/`+`plans/` → on ship (merged + deployed), `git mv` both
to `archive/` (git mv preserves history — always use it for tracked files) → if
written but never built, park in `nyi/` instead. Point-in-time `HANDOFF-*.md` files at
the `docs/superpowers/` root are historical references; leave them.

**Known drift (as of 2026-07-02):** the active folders are not perfectly reliable.
`specs/2026-06-04-seo-roadmap-render-dedup-upload-checklist-design.md` + its plan
shipped long ago (PR #49, merge commit `e767c9b` on main) but were never archived.
The tracker + handoff are the real status source, and even those drift (see truth
ranking below). If you're doing an archive pass, sweep for other shipped strays.

## Naming and pairing

- Files are dated: `YYYY-MM-DD-<kebab-name>.md` (date = when writing started).
- **Specs end `-design.md`**; the paired plan is the same date + name minus
  `-design`. Example: `2026-06-30-autonomous-live-seo-source-design.md` (spec) ↔
  `2026-06-30-autonomous-live-seo-source.md` (plan).
- Trackers: `YYYY-MM-DD-<topic>-tracker.md` in `todos/`.
- Living handoffs: `HANDOFF-<topic>.md` (no date — they are continuously rewritten).

## The improvement-roadmap handoff protocol (hard ritual — verbatim)

Triggered when a session completes (or meaningfully advances) an item in
`docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`, **or** whenever
Kevin asks for "the handoff prompt" / "handoff". Do all three, in order:

1. **Update the tracker:** checkbox status + a dated status-log line.
2. **Rewrite `docs/superpowers/todos/HANDOFF-improvement-roadmap.md`** — current
   state, the single next item with key context, gotchas. **Commit it together with
   the tracker change** (same commit, not a follow-up).
3. **End your final reply with the handoff doc's "Paste this into a new chat" prompt
   in a code block**, so Kevin can copy it straight into the next chat.

This is contractual — never skipped, even under time pressure (owner ruling,
2026-07-02). The handoff doc's structure (see the file itself): `Last updated` +
`Updated by` header → the rule restated → `## Paste this into a new chat to continue`
(a fenced code block naming the branch, the docs to read, and the numbered next
actions) → `## Current state` → next item → gotchas. When rewriting it, update the
paste-in prompt too — it must always reflect the *new* next action.

## Tracker conventions

Model: `todos/2026-06-10-improvement-roadmap-tracker.md`.

- **Checkboxes:** `[ ]` not started · `[~]` in progress · `[x]` shipped. A
  multi-phase item stays `[~]` until every phase ships (C6 is `[~]` with Phases 1–3
  shipped and Phase 4 pending merge, as of 2026-07-02).
- **Item annotations accrete in place:** spec/plan links (with Codex pass counts,
  e.g. "Codex ×9"), PR numbers, deploy + production-verification dates, and ⚠ notes.
  The strongest status claim is "merged (PR #N), deployed, production-verified
  <date>" — don't write it unless all three happened.
- **`## Gated decisions`** section: items blocked on a human decision, each with what
  it gates; check off with the verdict inline when decided.
- **`## Status log`:** append-only, dated lines, **newest first**. Each entry is a
  dense narrative of what shipped, the Codex fixes folded in, test counts, deploy
  outcome, and the explicit "Next:" pointer. Never edit or delete old entries.
- Plan checkboxes are **not** the completion record — see Common mistakes.

## Roadmap-code decoder

Letter codes used across trackers, commits, and this skill library are tracker item ids. Track meanings below use the trackers' own headings; **exact item meanings live in `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`** (S codes: `todos/2026-06-29-pentest-remediation-tracker.md`).

| Codes | Track (tracker's own heading) |
|---|---|
| A1–A7 | Track A — Platform foundations (durable job queue, findings layer, observability) → `06-platform.md` |
| B1–B5 | Track B — Client command center → `04-clients-and-quarter-grid.md` |
| C1–C10 | Track C — Continuous monitoring (needs A1; diffing needs A2) → `02-ada-audit.md`, `01-seo-parser.md` |
| D1–D6 | Track D — Workflow polish (mostly independent) → `03-ai-memo-tools.md`, `05-small-tools.md` |
| S1–S4 | 2026-06-29 pentest remediation phases: S1 quick wins, S2 dependency upgrade, S3 input validation, S4 defense-in-depth |

Do not confuse tracker D-items with **per-spec decision codes**: specs lock scope decisions labeled D1–D4 (see "Resolved decisions" in the plan house style below) — those are local to each spec, not tracker items.

## Plan house style

Model: `docs/superpowers/plans/2026-06-30-autonomous-live-seo-source.md`.

1. **Title** then the required banner, verbatim:
   > **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with your harness's plan-execution loop — Claude: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans; Codex: er-seo-tools-workflow. Steps use checkbox (`- [ ]`) syntax for tracking.
2. **Goal / Architecture / Tech Stack** — one bold paragraph each.
3. **Resolved decisions** — the spec's D1–D4 restated with Kevin's ruling and date.
4. **Global Constraints** — the repo invariants restated verbatim (array-form
   `$transaction` only; no SQLite `createMany`/`skipDuplicates`; hand-authored
   migration SQL applied with `DATABASE_URL="file:./local-dev.db" npx prisma migrate
   deploy`; findings-layer invariants; test-cleanup ordering). Restating them in
   every plan is deliberate — any single doc must be able to bootstrap a session.
5. **File Structure** — every file to create/modify, grouped by concern.
6. **Per-task TDD structure** (each `## Task N:` block):
   - **Files:** (Create/Modify lists) and **Interfaces:** (what the task produces).
   - `- [ ] **Step 1: Write the failing test**` — named test file + exact assertions.
   - Steps to run the test and see it fail, implement, run again and see it pass.
   - Final step: **Commit** with the exact command, e.g.
     `git add lib/ada-audit/seo/link-graph.ts lib/ada-audit/seo/link-graph.test.ts && git commit -m "feat(seo): pure link-graph computation"`.
     Implementation commits map 1:1 to plan tasks (verifiable in `git log`).
7. **Codex review records inline:** fixes are tagged where they apply — "(Codex #2)",
   "(Codex delta-fix #5)" — and the tracker records the total pass count.

Every spec and plan routes through Codex review (the `consulting-codex` skill)
**before** implementation; apply named fixes in place as `docs(plan):`/`docs(spec):`
commits. This is an owner-mandated gate, not optional.

## Spec house style

Model: `docs/superpowers/specs/2026-06-30-autonomous-live-seo-source-design.md`.
Numbered sections, in roughly this order:

1. **Goal** · 2. **Background (verified code facts this builds on)** — cite files and
   behavior actually read, not assumed · 3. **Scope decisions (locked with Kevin)** —
   the D1–D4 decision-record pattern: each lettered decision states the question,
   Kevin's ruling, and its scope consequences; the plan restates them verbatim ·
   4. **Architecture** (subsections per unit) · 5. **Data flow** · then any explicit
   single-decision section (e.g. Phase 4's §6 "The 'depth in score' decision") ·
   affected-surfaces inventory · **Retention** · **Schema change** · **Out of scope /
   future work (breadcrumbed)** — future hooks get code comments pointing back at the
   spec section · **Error handling & invariants** · **Testing** · **Acceptance criteria**.

**"Reverses prior invariant" callouts are mandatory** when a spec overturns something
earlier docs state as law. The Phase 4 spec does this twice: in the preamble ("…the
'live score never canonical' posture of the C6 Phase 3 invariant (see §7)") and in §7
("This change deliberately reverses the C6 Phase 3 invariant…"). Without the callout,
the old invariant keeps getting quoted from CLAUDE.md/old specs and reviewers will
"fix" the new behavior back.

## CLAUDE.md stewardship

The root `CLAUDE.md` is the dense architecture manifest. It accretes on every ship:

- **When you ship a phase:** add/extend the relevant `## Key files` bullets (one line
  per file, behavior-first, with the gotcha inline) and the `## Architecture patterns`
  entry (bold-titled paragraph naming the spec/plan archive paths). Incidents become
  `## Do not` rules with the incident date and mechanism (e.g. the 2026-06-10
  interactive-transaction production incident).
- **Style:** dense, file-keyed, invariant-first. Write the invariant and the reason
  in one breath ("group `report:<siteAuditId>` — NEVER `site-audit:<id>`, that group
  means audit liveness"). No aspirational content — only shipped behavior.
- **Known staleness modes (as of 2026-07-02):**
  - **CLAUDE.md describes main, not feature branches.** Example: canonical-run
    selection is merge-state-sensitive (branch vs main) — CLAUDE.md's "never
    displaces the sf-upload canonical score" text describes main; see
    er-seo-tools-architecture-contract §6; verify: `git branch --show-current &&
    grep -n pickCanonicalSeo lib/services/findings-shared.ts`. When quoting a
    CLAUDE.md invariant, say which merge state you're describing.
  - **README.md's deploy/prod section is stale:** it gives `$APP_HOME`,
    `$DATA_HOME/*`, and says the process is "kept alive via
    `nohup`". CLAUDE.md is authoritative: `$APP_HOME`,
    `$DATA_HOME/db.sqlite`, PM2. (The ssh deploy command itself is
    consistent everywhere.) If you touch README, fix this; until then, never copy
    prod paths from README.

## Doc-truth ranking (when docs conflict)

**code > plan/spec > tracker/handoff status prose > CLAUDE.md summaries > README.**
The further a doc is from the diff, the more it drifts. Always spot-check a
load-bearing claim against the code before repeating it.

**Worked example — the Phase-4 fabrication (verified 2026-07-02):**
`HANDOFF-improvement-roadmap.md` and the tracker's C6 entry claim three unbuilt
C6 Phase 4 features (self-healing seoIntent schedules, a `lib/seo/providers/`
layer, live srt_/krt_ memos) — all false against plan + code; the full
claim-vs-truth table is er-seo-tools-failure-archaeology entry 16. Treat those
handoff/tracker sentences as not-yet-built aspiration until code says otherwise. Second example of the same failure class: the pentest tracker
(`todos/2026-06-29-pentest-remediation-tracker.md`) header says "Status: not started"
while every phase S1–S4 is `[x]` and merged to main via PR #82 — headers and
per-phase "not pushed" notes are stale snapshots; `git log main` is the truth.

## Commit message conventions

Verified from `git log` (dominant house style; a few legacy plain-sentence commits
exist — follow the convention, don't imitate the strays):

- Format: `type(scope): imperative lower-case summary`, usually subject-only.
- Types seen: `feat`, `fix`, `test`, `docs`, `security`.
- Scopes are subsystem or initiative codes: `seo`, `schema`, `oauth`, `reports`,
  `plan`, `spec`, `c3`/`c6`/`b5` (roadmap item), `s1`–`s4` (pentest phase).
- Docs commits use the doc kind as scope: `docs(spec): apply Codex review fixes…`,
  `docs(plan): …`, `docs(seo): breadcrumbs + tracker/handoff for …`.
- Plans pre-write the exact commit command per task — use it verbatim.
- Recent merges arrive as GitHub `Merge pull request #NN` merge commits; early-era PRs (the #2 era) were SQUASH-merged, which is why some branch commits never appear in `git log main` — see er-seo-tools-failure-archaeology entry 14 before concluding work is unmerged.
- Any harness-mandated trailers (Co-Authored-By etc. from your current session
  instructions) go after the subject/body as usual; historical commits don't have them.

## Common mistakes

- **Trusting plan checkboxes as status.** They are never ticked: the Phase 4 plan has
  75 unticked boxes and 0 ticked despite 14/15 tasks being complete. Completion lives
  in `git log` (commits map 1:1 to tasks) + the tracker status log.
- **Updating the tracker without rewriting the handoff in the same commit** (or vice
  versa). The protocol is atomic; a split commit leaves the next session with a
  contradictory pickup doc.
- **Forgetting the paste-in prompt** at the end of the final reply, or pasting the
  *old* prompt after rewriting the handoff.
- **Quoting a CLAUDE.md invariant on a branch that changed it** without a merge-state
  caveat (see the live-score canonicality example above).
- **Copying prod paths from README** — its deploy section is stale.
- **Archiving with `mv` instead of `git mv`**, losing file history.
- **Writing "deployed" or "production-verified" in the tracker when it isn't.** Those
  words are the strongest claim in the system; merged-not-deployed is a distinct
  state and must be labeled as such. Under the 2026-07-03 ruling sessions merge
  and deploy autonomously when gate-green (`er-seo-tools-change-control` rule 1),
  which makes truthful state labels MORE important, not less — write exactly
  what happened and what was verified.
- **Skipping Codex review on a spec/plan** because it "looks small". The gate is
  unconditional; the tracker records the pass count as part of the item's record.
- **New spec overturning an old invariant without a "deliberately reverses" callout.**

## Provenance and maintenance

Authored 2026-07-02 against branch `feat/autonomous-live-seo-source` (23 commits
ahead of main; main tip `6679993`, PR #84). Everything above was verified by reading
the repo at that state. Re-verify volatile facts:

- Branch/merge state: `git branch --show-current && git log main..HEAD --oneline | wc -l && git log main -1 --oneline` — once Phase 4 merges, the `2026-06-30-*` spec/plan should move to `archive/`, and the live-score-canonicality example flips from "branch" to "main".
- Taxonomy + folder contents: `cat docs/superpowers/README.md && ls docs/superpowers/specs docs/superpowers/plans docs/superpowers/todos`
- Archive counts (43/57): `ls docs/superpowers/archive/specs | wc -l && ls docs/superpowers/archive/plans | wc -l`
- Handoff protocol wording: `grep -n -A9 "Improvement-roadmap handoff protocol" CLAUDE.md`
- Current next action + paste-in prompt: `head -30 docs/superpowers/todos/HANDOFF-improvement-roadmap.md`
- Phase-4 fabrication still uncorrected: `grep -n "self-healing\|lib/seo/providers" docs/superpowers/todos/HANDOFF-improvement-roadmap.md docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md; ls lib/seo/providers 2>&1`
- Canonical-selector merge state: `grep -n pickCanonicalSeo lib/services/findings-shared.ts`
- README deploy staleness: `grep -n "seotools\|nohup" README.md`
- Commit conventions: `git log --oneline -25`
- Render-dedup archive drift: `ls docs/superpowers/specs/ | grep 2026-06-04`
