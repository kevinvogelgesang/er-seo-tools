# Viewbook Process & Milestones Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes. Work in worktree `.claude/worktrees/viewbook-process-milestones` on branch `feat/viewbook-process-milestones`. Interfaces cut from MERGED code. Another session (`sweep-error-triage`) is live in this checkout — never edit on main; stay in this worktree.

**Goal:** Expand the Process & Milestones section — vertical (un-scrolled) milestone list, a customizable info area (new `process-milestones` global-content key: global default + per-viewbook override), and a per-milestone `description`.

**Architecture:** Reuse the existing global-content + per-viewbook-override system (add one key). Additive nullable schema column for milestone description. Public + operator + admin threading of that column. Layout swap in one component.

**Tech Stack:** Next.js 15 App Router (server + client components), Prisma + SQLite, Tailwind, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-17-viewbook-process-milestones-expansion-design.md` (Codex-reviewed, 8 fixes applied — read it).

## Global Constraints
- **Array-form `$transaction([...])` ONLY** (never interactive). Milestone writes ride the existing `syncVersion` bump.
- **`description` validation:** accept `string | null`; **2000-char cap**; over-cap → 400, NO bump.
- **Override semantics = APPEND** (global default blocks + per-viewbook override text appended), mirroring `StrategySection` EXACTLY. Welcome's `Blocks` is PRIVATE — replicate Strategy's rendering, don't import it.
- Repo has **NO jest-dom matchers**; tests run **serial against `DATABASE_URL="file:./local-dev.db"`**.
- Do NOT touch `WelcomeSection.tsx` (its `process` block) or the building-stage Review & feedback block.
- Client-visibility of the info block + descriptions on the public/share page is INTENDED.
- Gates before each commit: `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npx vitest run <paths>`.

---

### Task 1: Schema — `ViewbookMilestone.description` + migration

**Files:** Modify `prisma/schema.prisma` (`ViewbookMilestone` model); create migration dir.

**Interfaces:** Produces `ViewbookMilestone.description String?` (nullable) on the Prisma client.

- [ ] **Step 1:** Add `description String?` to `model ViewbookMilestone` in `prisma/schema.prisma` (alongside `blurb String?`).
- [ ] **Step 2:** Check `prisma/migrations/` for the latest timestamp (currently `20260717231842_viewbook_assessment_content`); run `npx prisma migrate dev --name viewbook_milestone_description`. Confirm the generated `migration.sql` is exactly `ALTER TABLE "ViewbookMilestone" ADD COLUMN "description" TEXT;`.
- [ ] **Step 3:** Verify it applied on the worktree DB; `npx tsc --noEmit` clean (new client type). Verify a fresh scratch DB applies the full chain: `TMPDB=/tmp/mig-$$.db DATABASE_URL="file:$TMPDB" npx prisma migrate deploy` → "All migrations…applied"; `rm $TMPDB*`.
- [ ] **Step 4: Commit** `feat(viewbook): ViewbookMilestone.description schema + migration`.

---

### Task 2: New global-content key `process-milestones`

**Files:** Modify `lib/viewbook/global-content-keys.ts`, `prisma/schema.prisma` (enumerated-key comment ~:987), `components/viewbook/admin/ContentTab.tsx` (generalize strategy-specific heading + stale "five rows" comment). Test: `lib/viewbook/global-content-keys.test.ts` (+ existing global-content tests).

**Interfaces:** Produces `'process-milestones'` in `GLOBAL_CONTENT_KEYS` → auto-eligible in `OVERRIDE_ELIGIBLE_KEYS`, loaded into `data.global.blocks['process-milestones']` + `data.overrides['process-milestones']`, validated as `ContentBlocks`.

- [ ] **Step 1: Failing tests** in `global-content-keys.test.ts`: `GLOBAL_CONTENT_KEYS` includes `'process-milestones'`; `OVERRIDE_ELIGIBLE_KEYS` includes it (not team/pc-intro). Run → FAIL.
- [ ] **Step 2: Implement.** Add `'process-milestones'` to the `GLOBAL_CONTENT_KEYS` tuple in `global-content-keys.ts`. (No change needed to `OVERRIDE_ELIGIBLE_KEYS`/`validateGlobalContent`/`public-data` — they derive from the tuple; confirm by reading.)
- [ ] **Step 3:** In `ContentTab.tsx`, generalize the override group `<h3>` from "Client-specific strategy adjustments ('your plan')" to "Client-specific content overrides" and fix the stale "all five override rows" comment (now six). In `prisma/schema.prisma`, update the enumerated-key comment near the global-content model (~:987) to list `process-milestones`.
- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit` + `npm run lint` clean. Run the existing global-content + ContentTab suites (`DATABASE_URL=… npx vitest run lib/viewbook/global-content components/viewbook/admin/ContentTab.test.tsx components/viewbook/admin/GlobalContentEditor.test.tsx`) — fix any enumeration count fixture that now expects the new key (update to include it, do not weaken).
- [ ] **Step 5: Commit** `feat(viewbook): process-milestones global-content key (default + per-viewbook override)`.

---

### Task 3: `description` data path — types, serializer, service validation, routes

**Files:** Modify `lib/viewbook/public-types.ts` (`PublicMilestone.description`), `lib/viewbook/public-data.ts` (`loadMilestones` :210), `lib/viewbook/operator-data.ts` (operator milestone description), `components/viewbook/admin/viewbook-admin-shared.ts` (`ViewbookDetail.milestones` type), `lib/viewbook/service.ts` (`updateMilestone` :488 + `createMilestone` :474), `app/api/viewbooks/[id]/milestones/route.ts` + `.../[milestoneId]/route.ts`. Test: `lib/viewbook/service.test.ts` (+ route tests).

**Interfaces:**
- Produces `PublicMilestone.description: string | null`; operator/admin milestone types gain `description: string | null`.
- `updateMilestone`/`createMilestone` accept an optional `description` (validated `string | null`, ≤2000 chars → else `HttpError(400, 'invalid_description')` with NO write/bump). Milestone routes thread `description` from the parsed body.

- [ ] **Step 1: Failing tests** in `service.test.ts`: `updateMilestone` persists a `description`; a 2001-char `description` throws 400 `invalid_description` and does NOT bump `syncVersion` (assert the version is unchanged); `createMilestone` accepts `description`. Run → FAIL.
- [ ] **Step 2: Implement service.** Add `description` to the `updateMilestone` + `createMilestone` input types + their array-form `$transaction` writes (validate: `if (description != null && (typeof description !== 'string' || description.length > 2000)) throw new HttpError(400, 'invalid_description')`). Define `const MILESTONE_DESCRIPTION_CAP = 2000` at the top of the milestone block. Persist `description: description ?? null`.
- [ ] **Step 3: Thread the reads.** `PublicMilestone.description` in `public-types.ts`; select + return it in `loadMilestones` (`public-data.ts:210`); add to the operator milestone shape in `operator-data.ts`; add to `ViewbookDetail.milestones` in `viewbook-admin-shared.ts`. Thread `description` from the request body in both milestone routes (POST create + PATCH update), passing to the service.
- [ ] **Step 4: Run — expect PASS.** tsc/lint clean. Run `service.test.ts` + the milestone route tests.
- [ ] **Step 5: Commit** `feat(viewbook): milestone description write path + validation (2000 cap, no-bump on reject)`.

---

### Task 4: Operator editors — inline + admin `description` field

**Files:** Modify `components/viewbook/public/OperatorLayer/InlineEditors.tsx` (`MilestoneQuickEditor`), `components/viewbook/admin/MilestonesEditor.tsx`. Tests: their existing test files.

**Interfaces:** Consumes the milestone update/create routes (Task 3). Both editors send `description` in their payloads.

- [ ] **Step 1: Failing tests:** in the inline `MilestoneQuickEditor` test + `MilestonesEditor` test, assert a `description` textarea renders per milestone and its value is included in the PATCH/save payload (spy/mock the request). Run → FAIL.
- [ ] **Step 2: Implement.** Add a `description` `<textarea>` to each milestone row in BOTH editors (label "Description", bounded via `maxLength={2000}`), wired into the existing save/PATCH payload alongside `blurb`. Follow each file's existing field pattern (activity registration / autosave where the file already uses it).
- [ ] **Step 3: Run — expect PASS.** tsc/lint clean.
- [ ] **Step 4: Commit** `feat(viewbook): description field in inline + admin milestone editors`.

---

### Task 5: `MilestonesSection` — vertical list + info block + description + search

**Files:** Modify `components/viewbook/public/MilestonesSection.tsx`, `lib/viewbook/toc-index.ts` (:93 milestone haystack). Tests: `components/viewbook/public/sections-data.test.tsx` (+ `toc-index.test.ts`).

**Interfaces:** Consumes `data.global.blocks['process-milestones']`, `data.overrides['process-milestones']`, `PublicMilestone.description`.

- [ ] **Step 1: Failing tests** in `sections-data.test.tsx` (MilestonesSection): (a) the milestone container is a VERTICAL stack — the milestones wrapper does NOT carry `overflow-x-auto`, and `StageCard`s do NOT carry `min-w-56`; (b) each milestone renders its `description` text; (c) info block: global-default-only renders the default blocks; override-only renders the override; both renders default THEN appended override; both-empty renders NO info heading. In `toc-index.test.ts`: a milestone `description` is matched by search. Run → FAIL.
- [ ] **Step 2: Implement layout.** Replace `<div className="flex gap-4 overflow-x-auto pb-2">` with a vertical stack (`<div className="flex flex-col gap-3">`); change `StageCard` from `min-w-56 flex-1` to full-width (`w-full`), and render `{m.description && <p className="mt-2 text-sm text-black/70 whitespace-pre-line">{m.description}</p>}` under the blurb.
- [ ] **Step 3: Implement info block.** Above the milestone list, resolve `const blocks = data.global.blocks['process-milestones']?.blocks ?? []` and `const override = data.overrides['process-milestones']`; render the default `blocks` (heading/body) AND, when `override` present, the override text appended below — replicating `StrategySection`'s block+override rendering inline (read `StrategySection.tsx` for the exact markup; do NOT import Welcome's private `Blocks`). Render nothing when both empty.
- [ ] **Step 4: Implement search.** In `toc-index.ts` (:93), add `m.description` to the milestone search haystack (alongside title + blurb).
- [ ] **Step 5: Run — expect PASS.** tsc/lint clean; run `sections-data.test.tsx` + `toc-index.test.ts` + the broader `components/viewbook/public` suite for fallout.
- [ ] **Step 6: Commit** `feat(viewbook): Process & Milestones vertical list + process-milestones info block + description render + search`.

---

### Task 6: Full gates + migration verify + whole-branch review

- [ ] Full gates in worktree: `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npx vitest run` · `npm run build`.
- [ ] Migration re-verify: fresh-DB full chain + upgraded copy of the current DB; recheck the migration timestamp is still strictly latest (no collision from a concurrent same-day migration).
- [ ] Self-review greps: no `overflow-x-auto`/`min-w-56` left in `MilestonesSection`; `WelcomeSection` untouched; no interactive `$transaction`.
- [ ] Whole-branch review (opus) + `/codex-review` (P1) before merge.

## Self-review checklist
- [ ] Every rendered-milestone mutation rides the `syncVersion` bump; over-cap description rejected with no bump.
- [ ] Info block appends override (matches StrategySection), both-empty → no heading leak.
- [ ] `process-milestones` enumerates in BLOCK_KEYS + OVERRIDE_ELIGIBLE_KEYS + public-data blocks/overrides (explicit tests).
- [ ] Migration additive, applies fresh + upgraded, timestamp latest.
- [ ] Welcome `process` block + Review & feedback block untouched.
