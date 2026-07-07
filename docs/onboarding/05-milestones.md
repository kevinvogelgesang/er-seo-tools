# 05 — Milestones: The Staged Path to Ownership

**Re-orientation.** If it's been a while: this doc is the spine of the whole
guide. It's not a curriculum (that's `01-fundamentals-path.md`) and it's not
a map (that's `03-codebase-tour.md` and `04-how-it-runs.md`) — it's the
progression of trust that ties all of those together. Five stages, each one
gated by what you can *do*, never by how long you've been at it. It is
completely normal to sit in one stage for a long stretch, come back after a
gap, and pick up exactly where you left off — every stage below is written
so that's possible.

## How this doc works

Five stages, numbered 0 through 4. Each one has the same four parts:

- **Goal** — what this stage is actually for, in one or two sentences.
- **Prerequisites** — which units of `01-fundamentals-path.md` and which
  earlier gates you need before starting. You can start the *exercises* for
  a stage before you've finished every listed prerequisite unit if a
  specific exercise sends you back for one — see Unit list in
  `01-fundamentals-path.md`'s "How to study this path" section — but the
  **gate** at the end of a stage assumes the prerequisites are actually met.
- **Exercises** — concrete things to do. Every exercise is **optional but
  recommended**: the point is the capability the gate checks for, not
  ticking off a list. If you already have the capability another way, skip
  straight to the gate.
- **Gate** — "you own this stage when…" — a concrete, Kevin-verifiable
  action. Not a feeling, not a self-assessment: something you can demo, show,
  or point Kevin at.

There are no dates, durations, or pacing targets anywhere below, on purpose.
Move to the next stage when you clear the gate — not before, and not on a
schedule.

---

## Stage 0 — Run it

**Goal.** Get comfortable with the app as a *user* before you touch a line
of its code. You already know what these tools are for from an SEO
practitioner's side (`00-orientation.md`'s tool table) — this stage connects
that knowledge to the running app on your own machine.

**Prerequisites.** Units 1–2 of `01-fundamentals-path.md` (command line +
git basics, the PR workflow) and `02-local-setup.md`'s capability gate: the
dev server runs, one ADA audit has completed locally, and the test suite
runs.

**Safety rails — read before running any exercise in this stage:**

> - Run every exercise against your **local dev environment first.**
> - Scans and audits only ever target the **designated test-domain list.**
>   **Kevin fills in:** the designated test-domain list.
> - **No client scans without Kevin's explicit go-ahead** — ever.
> - **No production queue operations of any kind** before Stage 4 of this
>   doc.

**Exercises (optional but recommended).**

- With `00-orientation.md`'s tool table open in another tab, click through
  every tool in the app — `/seo-parser`, `/ada-audit`, `/robots-validator`,
  `/quarter-grid`, `/rankmath-redirects`, `/clients`, `/reports`,
  `/settings` — and, for each one, connect what you see on screen to that
  tool's one-sentence SEO-practitioner description in `00`.
- Run one audit of each type, locally, against a target from the designated
  test-domain list only: a single-page ADA audit on `/ada-audit`, a
  whole-site ADA audit on the same page (site-wide mode), and a Screaming
  Frog CSV upload on `/seo-parser` (any CSV export you already have from a
  test-domain crawl, or a fresh one you run yourself against a test-domain
  target).

**Gate.** You own Stage 0 when you can demo the app running locally — dev
server up, no login wall — and, for each tool in the app, describe its
purpose in one sentence without reading from `00-orientation.md`.

---

## Stage 1 — Read it

**Goal.** Before you change anything, learn to *trace* what the running app
is actually doing — read-only. This is the stage where the codebase tour and
the "how it runs" doc stop being reference material you skimmed once and
start being maps you actually use.

**Prerequisites.** Units 3–6 of `01-fundamentals-path.md` (JavaScript,
TypeScript, Node basics, HTTP/APIs/JSON/DevTools) and Stage 0's gate.

**Exercises (optional but recommended).**

Three read-only traces. For each one, write up what you found in your own
words — Kevin reads and checks the write-up, not the code you traced (though
he may ask you to walk through it live):

1. **A single-page ADA audit, end to end.** Start at the route that creates
   the audit record, follow it into the durable job queue, into the axe-core
   runner, into where the score gets computed, and out to the poller that
   shows you the result. `03-codebase-tour.md`'s "Request flow" section and
   `lib/` inventory, plus `04-how-it-runs.md` section 1 ("What happens when
   you click 'Start Audit'") and section 2 ("The job queue"), are your map —
   this trace is the single-page version of that story, so where the story
   says "site audit," you're tracing the single-page cousin of the same
   pieces.
2. **A Screaming Frog CSV upload, through the parsers, to the results
   page.** Start at the upload on `/seo-parser`, follow it through
   `lib/parsers/` (03's `lib/` inventory names `base.parser.ts` and the
   `headerMap` pattern), and out to wherever the aggregated report and
   health score end up on screen.
3. **A site audit through the queue.** Follow `04-how-it-runs.md` section
   1's narrative ("What happens when you click 'Start Audit'") against the
   *real code* it names — the queue-manager promoter, the discover job's
   claim, the page-job fan-out, the finalizer — rather than just re-reading
   the prose. Confirm each sentence in that section against an actual file
   and line.

**Scavenger hunts.** Answer these by finding the actual code, not by asking
Kevin or an AI assistant for the answer:

- Where is an audit's accessibility score actually computed?
- What's the exact mechanism that stops a second site audit from starting
  while one is already running?
- Where does the dark-mode class get set on `<html>`, and why does it
  happen before React ever hydrates?

**Gate.** You own Stage 1 when your three write-ups are accepted by Kevin,
and you can answer "where would you look for X?" for three cold questions he
picks on the spot — not because you've memorized the answers, but because
you know which doc or directory to open first.

---

## Stage 2 — Change the surface

**Goal.** Ship your first real, reviewed changes through the actual
workflow — branch, PR, review, deploy — scoped tightly enough (UI only, no
new server-side logic) that a mistake is cheap and the workflow itself is
what you're learning.

**Prerequisites.** Units 1–8 of `01-fundamentals-path.md` (through Next.js
App Router) and Stage 1's gate.

**Exercises (optional but recommended).** Each one is a real PR through the
real flow: branch → PR description → Kevin's review → Kevin deploys.

- **A dark-mode fix.** Find a component that's missing a `dark:` variant —
  `03-codebase-tour.md` section 5's mapping table (`bg-white` →
  `dark:bg-navy-card`, etc.) tells you what to look for — and fix it.
- **A copy change.** Fix a piece of UI text that's unclear, stale, or
  wrong.
- **A new column in an existing results table.** Add a column to a table
  that already exists in the app (a results page, a client list) using data
  that's already available — the point is touching a real component with
  real data, not designing new data flow.
- **A small component cloned from an existing pattern.** Find a small,
  self-contained component similar to what you need, and build your version
  following its shape rather than inventing a new one.

**Gate.** You own Stage 2 when two UI PRs have merged, each with at most one
review round, and both PR descriptions follow Unit 2 of
`01-fundamentals-path.md`'s pre-review checklist (self-reviewed diff, clean
`npm run lint`, relevant tests run, a description that says *why*).

---

## Stage 3 — Ship features and fixes

**Goal.** Take on real feature and bugfix work end to end, under the same
house workflow Kevin follows — specs for anything non-trivial, tests, the
full gate ladder, AI-assisted review — while Kevin still owns deploys and
still reviews everything you ship.

**Prerequisites.** All nine units of `01-fundamentals-path.md` and Stage 2's
gate.

**The house workflow, per `.claude/skills/er-seo-tools-change-control/SKILL.md`.**
This is the authoritative source — read it, don't just take the summary
below as the whole story:

- **Classify the change first.** A one-file bugfix with a clear repro is a
  small class (failing test first, then the fix, then gate-green — no spec
  needed unless the fix reveals a bigger design problem). Anything bigger —
  a new tool surface, a new job type, a refactor — is a feature-class
  change: spec → review → plan → review → build (test-first, per task) →
  gate-green → PR.
- **Tests, and what "tested" means here.** Per
  `.claude/skills/er-seo-tools-validation-and-qa/SKILL.md`: new behavior
  gets a test, a fixed bug gets a *guard* test that names the bug it
  guards against, and "tests pass" is never asserted without pasted command
  output. `DATABASE_URL="file:./local-dev.db" npm test` is the working
  invocation for the full suite — the inline `DATABASE_URL` isn't optional.
- **The three gates, run in this order, all green before a PR:**
  `npm run lint` (the TypeScript compiler, not a style linter), `npm test`,
  and `npm run build`. Gate-green means all three pass locally — it does
  *not* mean merged, deployed, or verified in production; those are later,
  separate steps.
- **AI-assisted review norms.** This repo builds with Claude Code as a
  first-class daily tool, and every spec/plan gets an adversarial pass from
  Codex before anything is built from it. `06-working-with-ai.md` covers
  the trust model in full — the short version for this stage is that AI
  output is a draft, the gates are the authority, and "the model said so" is
  never a justification on its own.

**Exercises (optional but recommended).**

- **One real backlog bugfix.** Pick something small and real, not
  manufactured — reproduce it with a failing test, fix it, add the guard
  test.
- **One small feature touching an API route and a component.** Something
  that needs a new (or changed) `route.ts` handler under `app/api/` *and* a
  UI change that calls it — enough surface to exercise the request-flow
  pieces from `03-codebase-tour.md` section 2 (`withRoute`, the auth gate)
  for real.
- **A first Prisma schema migration, under supervision.** Walk
  `CLAUDE.md`'s schema-change steps yourself, with Kevin watching: edit
  `prisma/schema.prisma`, generate the migration, respect SQLite's
  constraints (no `ALTER COLUMN` nullability changes; no
  `createMany`+`skipDuplicates`), and understand that this migration will
  apply to production *automatically* on the next deploy — a bad migration
  is a production incident, not a local mistake you can quietly undo.

Kevin still deploys everything you ship in this stage.

**Gate.** You own Stage 3 when a feature PR has merged where Kevin's review
found no correctness issues, and your first schema migration has shipped to
production without incident.

---

## Stage 4 — Operate it

**Goal.** Take on production responsibility itself: deploying, diagnosing,
and keeping the app healthy — the last piece of ownership, and the one with
the least room for a cheap mistake.

**Prerequisites.** Stage 3's gate, *and* prod access granted by Kevin (SSH,
credentials — this is a deliberate, explicit hand-off, not something you
work toward on your own).

**Safety rails — restated from Stage 0, because the stakes here are
different:**

> - Run every exercise against your **local dev environment first**, where
>   that's still possible at this stage.
> - Scans and audits only ever target the **designated test-domain list.**
>   **Kevin fills in:** the designated test-domain list.
> - **No client scans without Kevin's explicit go-ahead** — ever.
> - **No production queue operations of any kind, and no server SSH
>   mutations, until this stage's gate is cleared.** Prod access being
>   granted is the *start* of this stage, not standing permission to act
>   unsupervised — the supervised drills below come first, every time.

**Exercises (optional but recommended).** Work through
`08-operations-runbook.md` — the deploy procedure, PM2 basics, reading
structured logs, `/admin/ops`, and the common diagnoses table — then:

- **A supervised deploy.** Push, then run the deploy command, with Kevin
  watching and narrating what he's checking at each step.
- **A supervised diagnosis of a stuck or failed audit.** Using
  `/admin/ops` and the logs, walk through *why* an audit is stuck before
  touching anything — the runbook's central discipline, "check evidence
  before restarting," means you look at heartbeats, job state, and logs
  first and only act once you know what you're looking at.
- **One unsupervised deploy, and one unsupervised diagnosis**, each
  narrated to Kevin afterward — what you checked, in what order, and why.

**Gate.** You own Stage 4 when both unsupervised drills (one deploy, one
diagnosis) are done and you've narrated each one afterward, and you can
answer "what would you check first?" for the runbook's common symptoms
(a stuck audit, a 502, a restart loop) without hesitating or guessing.

Until this gate is cleared: no production queue operations of any kind, and
no server SSH mutations — full stop, no exceptions, regardless of how
confident you feel about a specific fix.

---

## After Stage 4

There isn't a Stage 5. Once you've cleared Stage 4's gate, you're operating
this app the same way Kevin does — reviewing your own work against the same
gates, deploying when the work needs it, diagnosing production issues
yourself. `06-working-with-ai.md` and `07-senior-brief.md` don't stop
mattering at that point; they're the ongoing reference for the workflow and
the reasoning behind this codebase's shape, not just onboarding reading.
