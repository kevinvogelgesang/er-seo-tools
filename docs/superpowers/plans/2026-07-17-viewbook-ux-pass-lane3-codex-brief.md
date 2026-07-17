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

### 1. Ack-completion fix — `lib/viewbook/ack.ts` (Codex spec fix 7)
In `buildPcCompletion`'s NOT-EXISTS `baseGate` (≈ack.ts:82-87), **drop the `AND spc."state" <> 'hidden'`
clause** so ALL three `ACKABLE_SECTION_KEYS` (`pc-setup`, `pc-invite`, `data-source`) must have
`acknowledgedAt IS NOT NULL` **regardless of visibility** before `pcCompletedAt` is stamped. Do NOT
touch `ackPredicate`'s own `state <> 'hidden'` (ack.ts:124) — that's the legitimate write-eligibility
fence for a section's OWN ack, unrelated. Preserve the load-bearing statement order (delivery INSERT
before the `pcCompletedAt` UPDATE). `resetSectionAck` must keep never touching `pcCompletedAt`.

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
`AmendmentForm` render (≈:75-77) with a clear **"Propose a change"** affordance (a toggle
link/button that reveals `AmendmentForm` on click). `AmendmentForm` needs no prop change. Post-lock
**custom** fields (`createdAt > dataLockedAt`) stay directly editable (the existing "Added after
lock-in · still editable" path) — the lock is **baseline-only**, never every field. No schema change.

### 4. Milestone kickoff-vs-building — `MilestonesSection.tsx` (D5)
Add a `data.stage` branch (none exists today). The `StageCard` date-overview row (≈:105-109) already
renders for every stage — keep it. In **`kickoff`**: HIDE the `withLinks`/`FeedbackThread` review
block (≈:111-154) entirely — kickoff is a milestone-**date** overview only. In **`building`**: keep
the review block but wrap it in a visually **distinct**, titled+bordered "Review & feedback" region so
the client action is obvious. **NO `website-specifics` special case** (OQ4 — milestones is `carried`
there, renders via the normal Earlier-Steps path; do not branch for it). Do not touch `stages.ts`.

### 5. Reset-ack + thank-you — `SectionQuickControls.tsx` + `PcThanksSection.tsx` (VERIFY, likely no change)
The reset-ack control (`SectionQuickControls.tsx` ≈:105-114) already gates uniformly on all three
ackable keys, and `PcThanksSection.tsx` already gates on `data.pcCompletedAt` (≈:24). The spec's
symptom (invite/data-source acks not visibly persisting; thank-you appearing early) is driven by the
ack.ts/service.ts bugs above — once #1+#2 land, verify end-to-end that: a client ack for each of the
three sections persists and shows the reset control + TOC green circle; thank-you appears ONLY when
all three acks land. **Add tests proving this; only change code here if a real defect surfaces** (do
not skip the verification, and do not make cosmetic edits without a proven need).

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
