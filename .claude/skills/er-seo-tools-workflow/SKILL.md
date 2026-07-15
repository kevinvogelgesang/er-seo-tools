---
name: er-seo-tools-workflow
description: "Use at the START of any non-trivial er-seo-tools work in a harness that does NOT already provide the superpowers process skills (e.g. Codex) — it is the self-contained equivalent of Claude's brainstorm→spec→plan→TDD→verify loop. Also use when unsure which er-seo-tools-* skill governs a situation (it carries the skills index), or when tempted to write implementation code before a design + plan exist. Claude already gets this loop from the superpowers plugin; this skill exists so Codex works to the SAME discipline from the same repo-owned file."
metadata:
  short-description: The er-seo-tools engineering loop + skills index (harness-agnostic)
---

# er-seo-tools Workflow (harness-agnostic engineering loop)

## Why this exists

Claude works this repo with the **superpowers** process skills (brainstorming,
writing-plans, test-driven-development, verification-before-completion,
systematic-debugging, executing-plans). Those live in Claude's plugin cache —
Codex cannot read them. This skill is the **single repo-owned home of the same
discipline**, so Codex (or any harness) executes changes to the identical loop.
It defers to the project skills for all gate/deploy specifics; it does not
restate them.

**Golden rule:** no implementation code before a design and a plan exist for
anything larger than a one-file bugfix. "This is too simple to design" is the
thought that precedes the most wasted work. The design can be three sentences —
but it must be written and agreed before code.

## The skills index — which skill governs what

Consult the matching skill BEFORE acting. Descriptions are the trigger; this is
the fast map:

| Situation | Skill |
|-----------|-------|
| **Landing ANY change** — classes, gates, "can I just…", merge/deploy authority | `er-seo-tools-change-control` (the gate policy is canonical here) |
| Why the code is shaped this way — jobs, findings, schema, auth, recovery | `er-seo-tools-architecture-contract` |
| Something is failing — stuck audits, timeouts, prod-only bugs, 401s | `er-seo-tools-debugging-playbook` |
| Adding a route / job type / parser / migration / schedule / share page | `er-seo-tools-extension-recipes` |
| Running tests, defining "done", pre-PR gates, test conventions | `er-seo-tools-validation-and-qa` |
| Deploy, prod server, PM2, post-deploy verification | `er-seo-tools-run-and-operate` |
| Env vars, flags, concurrency, cadence strings, retention windows | `er-seo-tools-config-and-flags` |
| Specs/plans/trackers/HANDOFF/CLAUDE.md, folder taxonomy, "the handoff prompt" | `er-seo-tools-docs-and-writing` |
| Fresh clone / broken local env / test DB errors / Chrome on macOS | `er-seo-tools-build-and-env` |
| Getting a claim ACCEPTED — root-cause / fix-verified / new-idea placement | `er-seo-tools-research-methodology` |
| Current-state numbers — queue depth, staleness, findings coverage | `er-seo-tools-diagnostics-and-tooling` |
| First-principles proof — prod-vs-dev, scoring, $transaction, idempotency | `er-seo-tools-proof-and-analysis-toolkit` |
| "Has this bug/error happened before" | `er-seo-tools-failure-archaeology` |
| SEO/ADA domain semantics — score formulas, WCAG, CSVs, handoff tokens | `er-seo-tools-domain-reference` |
| "What should we build next", scaling, agency-in-a-box goal | `er-seo-tools-research-frontier` |
| Retiring Screaming Frog, live-scan source, SF-vs-live parity | `er-seo-tools-sf-retirement-campaign` |
| **Two agents on the repo at once** — worktrees, lanes, avoiding clobber | `er-seo-tools-multi-agent-coordination` |

If a skill applies, open it. Do not reconstruct its content from memory —
these skills carry incident-specific detail you will not have.

## The loop

Scale each phase to the change (a one-file bugfix collapses 1–2 into a sentence).
Phase gates and merge/deploy authority are owned by `er-seo-tools-change-control`
— this is the *shape*, that skill is the *policy*.

### 0. Orient
Read `AGENTS.md` (this repo's slim invariants) and, for anything touching
`lib/jobs`, `lib/findings`, `prisma/schema.prisma`, auth, or recovery, the
relevant `CLAUDE.md` section. `CLAUDE.md` is the canonical deep doc; `AGENTS.md`
is the always-read slim layer. If two agents may be active, run the
coordination pre-flight (`er-seo-tools-multi-agent-coordination`) first.

### 1. Brainstorm → design (before code)
- Understand purpose, constraints, success criteria before proposing anything.
- Ask questions **one at a time**; prefer multiple-choice.
- Propose 2–3 approaches with trade-offs and a recommendation.
- Present the design in sections; get agreement. Write it to
  `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md`.
- Route the spec to review (Codex, via the consulting/ask-codex flow) and apply
  named fixes in place. Do not gate on Kevin between spec→plan→build — notify,
  route, proceed (see change-control rule 4).

### 2. Plan
- Turn the spec into `docs/superpowers/plans/YYYY-MM-DD-<name>.md`: ordered,
  independently-verifiable tasks, each with the exact test-first steps and gate
  commands. Route the plan to review; apply fixes.
- Decompose so each unit has one clear purpose and a testable interface. A file
  growing large is a signal it does too much.

### 3. Build — test-driven, one task at a time
- **RED:** write a failing test that specifies the behavior. Run it; confirm it
  fails for the right reason. Never write implementation first.
- **GREEN:** minimum code to pass.
- **REFACTOR:** clean up with the test green.
- Match surrounding code — comment density, naming, idiom. Follow existing
  patterns before inventing new ones.
- Test conventions (DB env, mocking, fixtures) live in
  `er-seo-tools-validation-and-qa`.

### 4. Debug systematically (when something breaks)
- Reproduce first. Find the **root cause** before proposing any fix — no
  fix-by-guessing, no "try this and see."
- Read the actual error and the actual code path. A diagnosis that explains only
  some symptoms is not yet the root cause.
- This repo's signature failure mode is **dev-green / prod-broken**
  (minification, PM2 memory, reverse proxy, build heap). `CLAUDE.md` "Do not"
  and `er-seo-tools-failure-archaeology` hold the specific traps.

### 5. Verify before claiming done
- **Evidence before assertions, always.** Never say "fixed" / "passing" /
  "complete" without running the command and reading the output.
- Gate-green = `npm run lint` + `npm test` + `npm run build` all pass
  (exact commands and their traps: `er-seo-tools-validation-and-qa`).
- Green gates are necessary, not sufficient — every major incident here passed
  local tests. Prod verification after deploy is part of the change.

### 6. Land it
- Feature branch → push → PR (`gh`) → merge when gate-green → deploy when needed
  → prod-verify → tracker + handoff ritual. The authority model (what's
  autonomous, what stays Kevin-gated) and the ritual are owned by
  `er-seo-tools-change-control` (rules 1–4). Follow it exactly; do not
  re-derive it here.

## Red flags (stop and use the loop)

| Thought | Reality |
|---------|---------|
| "Too simple to design" | Simple work is where unexamined assumptions cost most. Three-sentence design still counts. |
| "I'll write the code, then a test" | Test first, or it is not TDD. RED before GREEN. |
| "Green build, so it's done" | Prod-only bugs pass every local gate here. Verify in prod. |
| "I'll just SSH-fix prod" | The server pulls from GitHub; SSH edits are forbidden and overwritten. |
| "I remember what that skill says" | Skills carry incident detail you don't have memorized. Open it. |
| "No other agent could be on this" | Run the coordination pre-flight anyway. Worktrees are cheap; clobbered work is not. |
