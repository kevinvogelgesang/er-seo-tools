# Viewbook UX Pass — Lane 3 (Stage Flow & Content) — Codex Brief

**You are Codex, implementing Lane 3 of the viewbook UX pass (Wave 2).** Self-contained.
Spec: `docs/superpowers/specs/2026-07-17-viewbook-ux-pass-design.md` §7, §9, §10. Interfaces
below were cut from MERGED code (main @ post-Wave-1). Wave 1 (Lane 1 sticky/reading + Lane 2
operator-editing) is already merged to `main` and deployed.

## Setup
```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
git worktree list                      # pre-flight — confirm no viewbook-l3 lane open
git worktree add .claude/worktrees/viewbook-l3 -b feat/viewbook-l3   # off merged main
cd .claude/worktrees/viewbook-l3
```
Work ONLY in this worktree. **Do NOT git commit/push** (Claude commits after cross-review) —
leave changes in the working tree and write a handoff to `.superpowers/sdd/viewbook-l3-codex-handoff.md`
(tasks done, files changed, exact gate outputs) as you go. Claude Lane 4 runs concurrently in
its own worktree on a DISJOINT file set.

## What Lane 3 delivers (spec §7)
Data Source greyed+propose-a-change for baseline-locked fields; milestone kickoff-vs-building
behavior; an ack-completion correctness fix; reset-ack verification; honest thank-you gating.

## Ownership (modify ONLY these + their tests)
`components/viewbook/public/DataSourceSection.tsx`, `MilestonesSection.tsx`,
`components/viewbook/public/OperatorLayer/SectionQuickControls.tsx`,
`components/viewbook/public/PcThanksSection.tsx`, `lib/viewbook/ack.ts`,
`lib/viewbook/service.ts` (**you are the SOLE owner of `service.ts` this wave — Codex fix 6**).
**Touch nothing else** — NOT `section-display.ts`/`SectionShell`/`SectionReveal`/any sticky file
(Lane 1's, frozen), NOT any Lane-4 file (`AssessmentSection`, `assessment*.ts`, `prisma/schema.prisma`,
`components/richtext/*`, `retention.ts`, `app/api/clients/[id]/route.ts`, the public assets route),
NOT `middleware.ts`. `AmendmentForm.tsx`/`FeedbackThread.tsx`/`FieldEditor.tsx`/`stages.ts` are
FROZEN (reuse as-is).

## The exact edits (verified against merged code)

### 1. Ack-completion fix — `lib/viewbook/ack.ts` (Codex spec fix 7 + plan-review fix 1)
In `buildPcCompletion`'s completion gate (≈ack.ts:82-87), **prove all THREE `ACKABLE_SECTION_KEYS`
(`pc-setup`, `pc-invite`, `data-source`) rows EXIST and are acknowledged, regardless of visibility.**
Merely dropping `AND spc."state" <> 'hidden'` is NOT enough — the current `NOT EXISTS (…unacked…)` form
still completes if a required section row is entirely MISSING (vacuously true). Replace it with a
**positive** gate: either a count gate (`(SELECT COUNT(*) … sectionKey IN (…three…) AND acknowledgedAt
IS NOT NULL) = 3`) OR three positive `EXISTS(… acknowledgedAt IS NOT NULL)` joined by AND — no
`state`/visibility predicate on these. Do NOT touch `ackPredicate`'s own `state <> 'hidden'` (ack.ts:124)
— that's the legitimate write-eligibility fence for a section's OWN ack, unrelated. Preserve the
load-bearing statement order (delivery INSERT before the `pcCompletedAt` UPDATE). `resetSectionAck` must
keep never touching `pcCompletedAt`.
**Tests (plan-review fix 2):** `ack.test.ts` currently asserts the OPPOSITE (hidden excluded; hide
completes) — REPLACE with: (a) hidden+unacked BLOCKS completion; (b) hidden+already-acked still counts;
(c) a MISSING required row blocks completion; (d) hiding never creates a completion delivery. Update the
now-stale `ack.ts` comments describing "non-hidden" completion / hide-path reuse.

### 2. Remove hide-triggered completion — `lib/viewbook/service.ts` (spec §7)
In `setSectionState` (≈service.ts:198-239), **delete the `isAckableHide`/`completion` block
(≈211-223), the `completion ? […]` arm of `statements` (≈226-230), and the
`if (completion) await completion.enqueueIfCompleted(...)` (≈232).** Hiding an unacked section must
NOT stamp `pcCompletedAt`. Prune the now-unused `ACKABLE_SECTION_KEYS, buildPcCompletion` import
(service.ts:40) if nothing else in the file uses them (grep first). `moveViewbookStage`'s
force-advance completion path is UNTOUCHED (it stays the escape hatch). Do NOT auto-reverse existing
false completions (no backfill).

### 3. Data Source greyed + propose affordance — `DataSourceSection.tsx` (D4, baseline-only)
Keep the existing `lockedBaseline` rule (`dataLockedAt !== null && field.createdAt <= dataLockedAt`,
≈:53). For a locked field: restyle `FieldValue`/`FieldRow` (≈:46-80) as visibly **greyed/disabled**
(muted bg/text, a lock affordance) instead of plain black text, and replace the UNCONDITIONAL inline
`AmendmentForm` render (≈:75-77) with a clear **"Propose a change"** affordance (plan-review fix 6:
use an accessible **`<details>/<summary>`** "Propose a change" wrapper around the existing
`AmendmentForm` — server-safe, no new client-state file needed; the form starts HIDDEN and reveals on
open). If you instead need a client leaf for the toggle, add it explicitly to Lane-3 ownership. `AmendmentForm`
needs no prop change. Post-lock **custom** fields (`createdAt > dataLockedAt`) stay directly editable
(the existing "Added after lock-in · still editable" path) — the lock is **baseline-only**, never every
field. No schema change. **Test:** form starts hidden; locked field renders greyed; post-lock custom
field stays editable.

### 4. Milestone kickoff-vs-building — `MilestonesSection.tsx` (D5)
Add a `data.stage` branch (none exists today). The `StageCard` date-overview row (≈:105-109) already
renders for every stage — keep it. In **`kickoff`**: HIDE the `withLinks`/`FeedbackThread` review
block (≈:111-154) entirely — including the "Reviews will appear…" empty-state placeholder (plan-review
fix 6: hide BOTH the review links AND the empty state in kickoff) — kickoff is a milestone-**date**
overview only. In **`building`**: keep
the review block but wrap it in a visually **distinct**, titled+bordered "Review & feedback" region so
the client action is obvious. **NO `website-specifics` special case** (OQ4 — milestones is `carried`
there, renders via the normal Earlier-Steps path; do not branch for it). Do not touch `stages.ts`.

### 5. Reset-ack + thank-you — `SectionQuickControls.tsx` + `PcThanksSection.tsx` (VERIFY, likely no change)
The reset-ack control (`SectionQuickControls.tsx` ≈:105-114) already gates uniformly on all three
ackable keys, and `PcThanksSection.tsx` already gates on `data.pcCompletedAt` (≈:24). The spec's
symptom (invite/data-source acks not visibly persisting; thank-you appearing early) is driven by the
ack.ts/service.ts bugs above — once #1+#2 land, verify end-to-end. **Test (plan-review fix 4): an actual
three-section integration test** — parameterize over `pc-setup`/`pc-invite`/`data-source`, acknowledge
each, and after EACH ack load public data to prove (a) the ack persists + the reset control shows, (b)
TOC `acked: true` propagates for that section, (c) `pc-thanks` is ABSENT until the third ack lands. Do
NOT rely only on the `PcThanksSection` unit test (which merely trusts `pcCompletedAt`).
**Plan-review fix 5 — TOC wording:** do NOT claim Lane 3 produces a "filled green circle." `TocRail`
(Lane-1-frozen) renders acknowledged as a **hollow secondary-colour** glyph (`data-vb-glyph="acked"`),
filled only for `done`. Lane 3 verifies ONLY that `acked: true` propagates; record the "acked should be
a filled green circle" visual want as a separate Wave-1 residual (do not touch `TocRail`).
**Only change code in these two files if a real defect surfaces** — do not make cosmetic edits without a
proven need, and do not skip the verification.

## Frozen contracts (consume, never change)
`SectionShell` props `{ section, title, heroUrl, summary?, stage, children }`; `PublicSection`
`{ sectionKey, state:'active'|'done', doneAt, acknowledgedAt, introNote, narrative }` (public two-state —
`'hidden'` lives only on the operator/DB tri-state). Key all stage/lock behavior off `data.stage` /
`data.dataLockedAt` INSIDE your leaf components — never edit `section-display.ts`.

## Repo invariants
Array-form `$transaction([...])` only (ack.ts/service.ts already use raw-SQL arrays — keep the
statement order + manual `updatedAt`). No jest-dom matchers. Per-worker test DB
(`DATABASE_URL="file:./local-dev.db"`). New/changed routes use `withRoute` + `parseJsonBody` (Lane 3
changes existing service/ack logic, not routes — no new route expected).

## TDD + gates
Test-first per unit. Key tests: `pcCompletedAt` is NOT stamped when an unacked ackable section is
hidden (regression for fix #2); completion fires ONLY when all three acks are non-null regardless of
visibility (fix #1); Data Source renders greyed+propose when `dataLockedAt` set / editable when not
(and post-lock custom fields stay editable); milestones hide the feedback block in `kickoff`, show the
distinct region in `building`; reset-ack present for all three; thank-you gated on all three acks.
Gates before you report done: `npx tsc --noEmit` · `npm run lint` ·
`DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.

## Budget / stop protocol
Full strength (`gpt-5.6-sol`, high). **If you hit a usage/limit wall, STOP immediately, write the
handoff with `Codex out of usage — reset to resume Lane 3` at the top, and exit.** Do not downgrade
the model or silently retry.
