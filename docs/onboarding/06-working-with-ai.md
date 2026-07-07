# 06 — Working with AI

**Re-orientation.** If it's been a while: `00-orientation.md` promised you
this doc would explain how work actually happens here, and specifically what
it meant when it said "AI-assisted development is a first-class, expected
part of how this repo gets built, not a shortcut around learning the
codebase." This is that explanation. It applies from Stage 0 of
`05-milestones.md` onward — even before you've written a line of code, you
should already be forming the habit of reading AI output critically rather
than trusting it by default.

This repo is built with Claude Code (an AI coding assistant) as the daily
tool, for Kevin and for you. That is not going away, and it is not something
you "graduate out of" as you gain seniority — Kevin uses it constantly and
still owns every gate below. What changes as you move through the stages is
not *whether* you use AI assistance, but how much judgment you're expected to
supply around it. This doc's job is to make sure that judgment develops
alongside your comfort with the tool, instead of getting outsourced to it.

## The artifacts

Three things carry the actual rules and history of this codebase. AI
sessions read all three; you should learn to read them the same way.

### `CLAUDE.md`

`CLAUDE.md`, in the project root, is the living contract for how this
codebase is built. `00-orientation.md` already told you it's the single most
information-dense file in the repo and the first place to check when you're
unsure how something works. What this doc adds: instructions in `CLAUDE.md`
are **binding on AI sessions** — when you or an AI assistant work in this
repo, the stack constraints, the key-files list, the architecture patterns,
and the "Do not" list at the bottom are not suggestions, they're the rules
the session is expected to follow. Most of the "Do not" entries exist because
something broke in production first; each one names the file or the incident
behind it.

That said, `CLAUDE.md` is a description of the code, not the code itself. The
rule that resolves every conflict: **when `CLAUDE.md` and the code disagree,
the code is the truth, and the doc gets fixed.** Documentation drifts;
running code doesn't. If you ever read a `CLAUDE.md` sentence that doesn't
match what you see in a file, that's not you misunderstanding something —
say so, and expect the doc to get corrected in the same change.

### The `er-seo-tools-*` skills in `.claude/skills/`

Sixteen files under the `.claude/skills/` folder, each one a domain playbook for a
specific kind of question — "why is this transaction array-form", "why did
this route 401", "how do I test a job handler", and so on. You don't invoke
these by name; they **auto-trigger**: an AI assistant working in this repo
reads the situation (an error message, a question, a file being touched) and
loads the matching skill's guidance automatically, the way you'd reach for a
specific reference book because the question in front of you matches its
title. A handful, to give you a feel for the range:

- **`er-seo-tools-build-and-env`** — fixing a broken local setup: `npm
  install` hangs, the dev server won't start, an unexpected login wall
  appears in dev, ADA audits can't launch Chrome on macOS. This is the one
  you'll lean on most during Stage 0.
- **`er-seo-tools-debugging-playbook`** — something is failing and you need
  the cause: audits stuck in `queued`/`running`, works-in-dev-but-not-prod
  bugs, a route returning 401 it shouldn't.
- **`er-seo-tools-architecture-contract`** — *why* the code is shaped the way
  it is: job-queue claim/fencing, findings dual-write, canonical run
  selection, browser-pool design. This is the one worth reaching for
  yourself when an AI's explanation of unfamiliar code leaves you with a
  "but why did they do it *that* way" question.
- **`er-seo-tools-extension-recipes`** — adding anything new: an API route, a
  durable job type, a Screaming Frog parser, a schema migration, an env var.
  You'll meet this one around Stage 3, when you start building features.
- **`er-seo-tools-docs-and-writing`** — writing or updating any doc of record
  here: specs, plans, trackers, `CLAUDE.md` itself, commit messages. It's the
  authority behind the taxonomy in the next section.

Knowing these exist matters even before you can name all sixteen: it means
when an AI assistant gives you an answer, that answer is very often coming
from a specific, checkable document, not from a general impression of how
software usually works. You can always ask "which skill is this coming
from?" and go read the source yourself.

### The `docs/superpowers/` taxonomy

Bigger changes get written down before they're built. `docs/superpowers/`
holds those documents, organized by status — `00-orientation.md` gave you
the two-sentence version; here's the folder map, from
`docs/superpowers/README.md`:

| Folder | What lives here |
|---|---|
| `specs/`, `plans/` | Active, in-progress work — a spec says *what* and *why*, a plan says the concrete build steps |
| `archive/specs/`, `archive/plans/` | Shipped work, moved here once it's merged and deployed |
| `nyi/` | Written and reviewed, but not yet built |
| `todos/` | Trackers and handoff docs that point at the specs/plans above |

The archive is more than a filing cabinet — it's **archaeology**. When you
hit a piece of behavior that seems odd, or an AI assistant tells you "this is
shaped this way because of an incident on such-and-such date," the archived
spec for that feature is where the real reasoning lives: what was tried,
what Kevin decided, what trade-off got accepted. Reading an old spec before
asking "why does this work this way?" is often faster than asking, and it's
a habit worth building early.

## The lifecycle

The house workflow for anything bigger than a one-line fix runs in this
order: **brainstorm → spec → Codex review → plan → implementation →
verification gates → tracker/handoff.** You'll see every one of these stages
happen around you well before you're the one driving them.

- **Brainstorm.** Open-ended back-and-forth to nail down what's actually
  being built and why, before anything is written down formally.
- **Spec.** A dated design doc in `docs/superpowers/specs/`, ending
  `-design.md` — what's being built, the background facts it's built on, and
  the specific decisions that got locked in along the way.
- **Codex review.** Every spec (and every plan) gets an adversarial pass from
  a second AI reviewer (Codex, via the `consulting-codex` skill) before
  anything is built from it. This is not optional and not skipped for time
  pressure — it's one of the reasons a spec that's "obviously fine" still
  gets pushback before it becomes code.
- **Plan.** The concrete, task-by-task build steps in
  `docs/superpowers/plans/` — also Codex-reviewed before implementation
  starts.
- **Implementation.** Test-first, one task at a time, following the plan.
- **Verification gates.** `npm run lint` (the TypeScript compiler), `npm
  test`, and `npm run build` all have to pass, green, before anything moves
  toward a PR. Gate-green is necessary, not sufficient — more on that below.
- **Tracker/handoff.** For work tracked against the improvement roadmap, the
  tracker checkbox and the handoff doc get updated in the same commit as the
  change, so the next session (human or AI) can pick up the actual state
  without re-deriving it.

**Where you fit, stage by stage.** You don't drive this whole pipeline from
the start, and you're not expected to:

- **Stages 0–1** (`05-milestones.md`): you're mostly watching this lifecycle
  happen, and reading its output. An archived spec is one of the best
  "why is this shaped this way" resources you have, and it costs you nothing
  to read one cold.
- **Stage 2:** your changes are UI-scoped and small enough that they usually
  skip the spec/plan step entirely — you go straight to a branch and a PR —
  but the verification gates and Kevin's review still apply in full.
- **Stage 3:** you start running the full pipeline yourself for real feature
  work — writing the spec, sending it through Codex review, writing the
  plan, building test-first, clearing the gates. A one-file bugfix with a
  clear repro still skips the spec (failing test, then the fix, then
  gate-green) unless it turns out to reveal a bigger design problem.
- **Stage 4:** you also own the tracker/handoff ritual and prod verification
  for anything that touches a roadmap item, as part of owning production
  itself.

## The trust model, bluntly

This is the part that matters most, so it's stated as a flat list, not
softened:

1. **AI output is a draft.** Every line an AI assistant writes — code, a
   commit message, an explanation of how something works — is a starting
   point you evaluate, not a finished answer you accept.
2. **The gates are the authority, not the model.** `npm run lint`, `npm
   test`, `npm run build`, and a human reading the diff are what decide
   whether a change is good. An AI assistant saying "this looks correct" is
   not one of the gates.
3. **"The model said so" is never a justification.** Not in a PR
   description, not in a conversation with Kevin, not in your own head when
   you're deciding whether to ship something. If you can't explain *why* a
   change is correct in your own words, you don't have a justification yet —
   you have an unverified claim.
4. **Verify against the running app.** A test passing and code compiling are
   necessary; they are not the same as watching the actual behavior happen
   in the dev server, the way you did at Stage 0. This repo's worst bugs
   have historically passed every automated gate and only showed up when
   someone looked at the running thing — see `07-senior-brief.md` once
   you're reading that doc.
5. **Keep changes small enough that you can read the whole diff.** If you
   can't explain what a specific line does and why it's there, don't ship
   it — go back and ask, either the AI assistant or Kevin, until you can.
   This is the single habit most likely to keep you from quietly becoming a
   rubber stamp for someone else's (an AI's) code.
6. **AI never touches production on your behalf before Stage 4.** Before
   then, an AI assistant does not run deploy commands, SSH into the server,
   or make any change that reaches production, full stop — that mirrors the
   safety rails already stated in `05-milestones.md`'s Stage 0 and Stage 4
   sections. After Stage 4, once you have prod access, an AI assistant may
   help you diagnose or operate — but only with you watching every command
   before it runs, the same way your first supervised deploy in Stage 4
   works with Kevin watching and narrating.

## Practical patterns for a junior

**Use it to explain unfamiliar code — this is your biggest learning
accelerator.** When you hit a file you don't understand, asking an AI
assistant to walk you through it, in place, against the actual code, is
often faster than reading documentation about it in the abstract. Some
concrete prompts you can try against real files in this repo, once you're
set up locally:

- *"Explain what `withRoute()` in `lib/api/with-route.ts` does, and why
  authentication isn't checked inside it."* — a good first question because
  the answer forces you to learn where auth actually lives (`middleware.ts`)
  instead of assuming it's local to the route.
- *"Walk me through `claimNext()` in `lib/jobs/worker.ts` — what does
  'claiming' a job mean here, and what stops two workers from grabbing the
  same one?"* — this is the kind of question Stage 1's scavenger hunts are
  built around: don't just accept the explanation, go confirm it against
  the actual function.
- *"What does `isPublicPath()` in `middleware.ts` do, and what happens if a
  new route isn't added to it?"* — this one has a real incident behind it
  (a new route 401'ing in production because it was missed), which is a
  good early lesson in why a seemingly small oversight in this file matters.

Notice the shape of all three: they ask the AI assistant to explain code
that already exists, in a file you can immediately go open and check. That's
the pattern to repeat — it's a much better use of the tool, early on, than
asking it to write code you don't yet have the judgment to evaluate.

**Ask "why," not just "do."** When you ask an AI assistant to make a change,
also ask it to explain the reasoning — why this approach, why this file, why
not the other three ways it could have been written. If the explanation
doesn't make sense to you, that's a sign to keep asking, not a sign you're
not smart enough to follow it. The goal is that you could, in principle,
have written the explanation yourself.

**Let AI write the first draft of tests — then read every line.** Asking an
AI assistant to draft a test is a legitimate, common use of the tool here.
What makes it safe is what you do next: read every assertion and ask
yourself whether it's actually testing the thing you think it's testing, or
just asserting whatever the current code happens to do. A test that merely
mirrors the implementation catches nothing when the implementation is wrong.

**When AI output contradicts `CLAUDE.md` or a skill: stop, ask Kevin, don't
pick a side silently.** This will happen — an AI assistant will sometimes
suggest something that conflicts with a documented rule, or two different
answers you got will disagree with each other. Do not decide on your own
that the doc is stale, and do not decide on your own that the AI must be
wrong. Both are live possibilities (the doc really can be out of date; the
model really can be mistaken), and picking one silently is how a real
contradiction turns into a shipped bug. Surface it to Kevin and let it get
resolved on purpose — the same instinct as "the code is the truth and the
doc gets fixed," except here you don't yet have enough context to be the one
who declares which is which.
