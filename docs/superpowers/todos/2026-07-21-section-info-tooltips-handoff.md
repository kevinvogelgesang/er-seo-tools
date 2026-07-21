# Viewbook viewer polish — TWO features — brainstorm/spec/plan/build handoff

**Date:** 2026-07-21. **Owner:** Kevin. **Status:** NOT STARTED — needs brainstorm → spec → plan → TDD → deploy. TWO NEW viewbook-viewer features (both light-only, public viewer). They can share one brainstorm/session but are independently shippable — sequence and PR-split are a brainstorming decision. Feature A is the larger (content model + editing surfaces); Feature B is a small local-only viewer toggle.

---

## FEATURE A — section info-tooltips (replace the "What this is" panels)

### The request (Kevin, verbatim intent)
> Remove (NOT hide) the "What this is" sections. Instead surface that data via the informational tooltips next to the H2 of each section (the "i in a circle" ⓘ icon). Ensure this copy is **editable company-wide** AND has **per-viewbook overrides**.

So: retire the `SectionSummaryPanel` ("What this is / What we need" panel), move its copy into a per-section ⓘ tooltip beside each section heading, and make that copy a company-wide-editable, per-viewbook-overridable content type.

## Where things stand (context — do NOT rebuild)
- The continuous-reading viewer is COMPLETE and live: Phase 1 (continuous default) + Phase 2 (`viewerMode` operator toggle). See memory `project_viewbook_reading_experience`. Kevin eyeballed both — happy.
- The public viewbook viewer is **LIGHT-ONLY** (no `dark:`; color via `--vb-*` vars). Tests: vitest + Testing Library, **jsdom pragma on line 1 of RTL tests**, **NO jest-dom** (DOM-native assertions only).

## The pieces this feature touches (all already exist — REUSE, don't reinvent)
- **`lib/viewbook/section-copy.ts`** — code-owned `SECTION_COPY: Record<SectionKey, {purpose, whatThis, whatWeNeed, cta?}>`. This is the copy to relocate. `purpose` = chapter-header one-liner; `whatThis`/`whatWeNeed` = what the panel shows today.
- **`components/viewbook/public/SectionSummaryPanel.tsx`** — the panel to REMOVE. Rendered in `SectionShell.tsx` at **two** call sites (grep `SectionSummaryPanel` — ~line 494 continuous branch, ~line 524 collapse branch). Also exports `StatusPill` (check whether StatusPill is used elsewhere before deleting).
- **`components/viewbook/public/Tooltip.tsx`** — EXISTING pure-CSS server-component tooltip: `<Tooltip label id children?>`; default trigger is `ⓘ` (focusable, `aria-describedby`-wired, hover+focus reveal, `w-64`). This is the ⓘ to place beside each H2.
- **`components/viewbook/public/SectionShell.tsx`** — renders the section title. In the CONTINUOUS branch the title is a real `<h2>`. In the COLLAPSE branch the title is a plain `<span>` INSIDE `CollapsibleSection`'s `<button>` (a `<button>` may not contain a heading, and **a focusable tooltip trigger nested inside a button is an a11y problem** — this is the main design wrinkle; see open questions).
- **Company-wide + per-viewbook content system (the exact pattern Kevin wants — already built for "your plan" blocks):**
  - Models `ViewbookGlobalContent` (company-wide, keyed) + `ViewbookContentOverride` (per-viewbook) in `prisma/schema.prisma` (~lines 1027/1034).
  - `lib/viewbook/global-content-keys.ts` — client-safe `GLOBAL_CONTENT_KEYS` catalog + `OVERRIDE_ELIGIBLE_KEYS` + body types.
  - `lib/viewbook/global-content.ts` — server store: `validateGlobalContent`/`putGlobalContent`/`getGlobalContent`/`getAllGlobalContent` + per-viewbook `putContentOverride`. Resolution today: global default ← per-viewbook override.
  - Company-wide editing UI: `app/(app)/viewbooks/settings/page.tsx` (+ ContentTab). Per-viewbook overrides: `app/api/viewbooks/[id]/overrides/[contentKey]/route.ts` + `ContentTab.tsx` in `ViewbookEditor`.
  - `lib/viewbook/public-data.ts` assembles resolved content into `ViewbookPublicData`.

## Open design questions to settle in BRAINSTORMING (do not pre-decide)
1. **Reuse the global-content keyspace or a dedicated one?** The existing `GLOBAL_CONTENT_KEYS` is a small fixed enum of heading/body blocks. Section tooltip copy is per-section (13 keys) with a `{whatThis, whatWeNeed}` (or single-blurb) shape. Decide: extend the existing machinery with a section-keyed content type, or a new sibling store modeled on it. Keep ONE resolution path (code default ← company-wide ← per-viewbook).
2. **Three-layer default vs migration seed.** Cleanest is likely: `SECTION_COPY` stays the code-owned DEFAULT; a company-wide `ViewbookGlobalContent` row overrides it; a per-viewbook override tops that (resolver falls through nulls to the code default — mirrors current behavior). Confirm no data backfill needed.
3. **What copy lands in the tooltip?** `whatThis` only, or `whatThis` + `whatWeNeed`? Tooltip is `w-64` (small). If both, consider layout/length. Does `purpose` (chapter-header line) stay as-is (it's separate from the panel)?
4. **Collapse-branch a11y (the wrinkle).** Where does the ⓘ go when the H2 is a `<span>` inside `CollapsibleSection`'s button? Options: render the ⓘ OUTSIDE the collapse button (sibling of the heading), or only in the continuous viewer, or restructure. A focusable tooltip trigger inside a button is invalid/hostile — must resolve.
5. **Editing UX.** Company-wide: a new section-copy editor on `/viewbooks/settings`. Per-viewbook: a per-section override in the Context Lens editor. Confirm both surfaces + that `OVERRIDE_ELIGIBLE_KEYS`-style filtering applies.
6. **Removal scope.** Confirm `SectionSummaryPanel` deletion + whether `StatusPill` (co-exported) survives, and that `INPUT_EXPECTING_KEYS`/`whatWeNeed` consumers are all accounted for.

---

## FEATURE B — ToC hide toggle (floating hamburger)

### The request (Kevin, verbatim intent)
> A toggle back above the table of contents — a little floating hamburger in a circle — that COMPLETELY hides the ToC, but the hamburger circle icon STAYS. Default should be **expanded**.

So: add an explicit show/hide control for the right-edge ToC rail. When hidden, the whole rail is gone EXCEPT a persistent floating hamburger-in-a-circle; clicking it brings the rail back. Default state = expanded (rail visible).

### Pieces this touches
- **`components/viewbook/public/TocRail.tsx`** — the `'use client'` right-edge rail (today: hover/focus collapses dots↔labeled card; mobile "Sections" pill via matchMedia). Kevin's toggle is a SEPARATE explicit hide, distinct from the existing hover-collapse. Mounted by `ViewbookShell.tsx` (~line 153, alongside `ProgressNav` ~line 115).
- **Local-only toggle pattern to mirror:** `components/viewbook/public/useCollapseState.ts` (localStorage-backed, SSR-safe default) — a `useTocVisible`-style hook, **default `true` (expanded)**, persisted per device. No DB, no server, no per-viewbook config (unless brainstorming decides otherwise — Kevin only asked for a viewer toggle with a default).

### Open design questions (brainstorm)
1. **Local-only vs configurable?** Kevin asked only for a viewer toggle with a default-expanded. Simplest = device-local (localStorage), like section collapse. Confirm no per-viewbook/company config is wanted (keep YAGNI).
2. **Hamburger placement + a11y.** "Above the ToC," floating, circle. `aria-expanded` + `aria-controls` on the button pointing at the rail region; the button is the ALWAYS-visible element; the rail is what shows/hides. Keyboard + focus-return on toggle. Reduced-motion friendly.
3. **Interaction with the existing hover-collapse + mobile pill.** Does the hamburger replace/subsume the hover behavior, or layer on top? On mobile (<768px) there's already a "Sections" pill — does the hamburger apply to desktop only, or unify? Resolve so there aren't two competing collapse concepts.
4. **CLS / sticky.** Hiding the rail must not shift the reading column (the rail is right-edge/floating already). Watch the documented sticky/overflow lessons (memory `project_viewbook_viewer_collapse`: `overflow:clip` sticky gotcha).

### Scope note
Feature B is small and self-contained — likely its own PR after (or before) Feature A. Brainstorming decides ordering; don't block A on B.

---

## Guardrails (same as every viewbook change — apply to BOTH features)
- **Pre-flight the coordination skill** (`er-seo-tools-multi-agent-coordination`): the root checkout is main-only + kept fast-forwarded; **cut a FRESH worktree off `origin/main`** (`git worktree add .claude/worktrees/<slug> -b feat/<slug> origin/main`), symlink `node_modules`, copy `.env` (NOT `.env.local`).
- Follow brainstorm → spec (Codex-review) → plan (Codex-review) → TDD. Per Kevin's global CLAUDE.md, route spec + plan to Codex and apply named fixes without waiting on Kevin.
- If a migration is added: local `prisma migrate dev` targets the `.env` prod-path and fails on macOS — run it against a scratch DB (`DATABASE_URL="file:./scratch.db" npx prisma migrate dev --name <n>`), then replace the generated `migration.sql` with the lean form if Prisma proposes a table-rebuild for an additive column. Prod applies via `prisma migrate deploy` on deploy.
- Gate every step: `npx tsc --noEmit` && scoped `npx vitest run`; full `npx vitest run` + `npm run build` before PR. Light-only; jsdom pragma; no jest-dom.
- Schema/content-write diffs are P1 → `/codex-review` before merge. Deploy: `git push` (merge) → `source .claude/ops-secrets.local.sh && ssh $PROD_SSH "~/deploy.sh"` → prod-verify (health 200, deployed HEAD, migration if any). No local/remote `/verify` for viewbook — browser-eyeball the ⓘ render + an override on a viewbook Kevin designates.
- On ship: update memory `project_viewbook_reading_experience`, move this handoff to done.

## Paste this into a new chat
```
Two new viewbook public-viewer features (light-only). Start with the superpowers brainstorming skill — do NOT write code before a spec + plan exist and Codex has reviewed them. They can share one brainstorm but are independently shippable; decide ordering + PR-split during brainstorming. Kevin routes spec+plan to Codex and applies named fixes without waiting (per global CLAUDE.md).

FEATURE A — section info-tooltips: REMOVE (not hide) the per-section "What this is / What we need" SectionSummaryPanel, and instead surface that copy via an ⓘ info-tooltip next to each section H2. The copy must be editable COMPANY-WIDE with PER-VIEWBOOK overrides.

FEATURE B — ToC hide toggle: add a floating hamburger-in-a-circle above the table-of-contents rail that COMPLETELY hides the ToC while the hamburger icon STAYS visible to bring it back. Default = expanded. Device-local (no server/config) unless brainstorming says otherwise.

READ FIRST:
- docs/superpowers/todos/2026-07-21-section-info-tooltips-handoff.md  ← full handoff: both requests, existing infra to reuse, open design questions per feature, guardrails
- memory project_viewbook_reading_experience (shipped viewer state), project_viewbook_viewer_collapse (sticky/overflow gotchas), reference_prod_ssh_access (deploy)

KEY REUSE (all exist — do not reinvent):
- Feature A: company-wide + per-viewbook content system is already built — ViewbookGlobalContent + ViewbookContentOverride models, lib/viewbook/global-content.ts + global-content-keys.ts, /viewbooks/settings editor + app/api/viewbooks/[id]/overrides/[contentKey]/route.ts. ⓘ tooltip = components/viewbook/public/Tooltip.tsx. Copy to relocate = lib/viewbook/section-copy.ts (SECTION_COPY whatThis/whatWeNeed). Panel to delete = components/viewbook/public/SectionSummaryPanel.tsx (two SectionShell.tsx call sites). Wrinkle: the collapse-viewer H2 is a <span> inside CollapsibleSection's <button> — a focusable tooltip trigger there is an a11y problem; resolve placement in brainstorming.
- Feature B: TocRail = components/viewbook/public/TocRail.tsx (mounted in ViewbookShell.tsx). Mirror the local-only default-state hook pattern in components/viewbook/public/useCollapseState.ts (default true = expanded). Reconcile with the existing hover-collapse + mobile "Sections" pill so there aren't two competing collapse concepts.

GUARDRAILS: coordination-skill pre-flight; FRESH worktree off origin/main (symlink node_modules, copy .env not .env.local); light-only public viewer; jsdom pragma + NO jest-dom on RTL tests; array-form $transaction only; gate every step (tsc --noEmit && vitest) + npm run build before PR; P1 /codex-review before any schema/content-write merge; deploy via ~/deploy.sh + prod-verify; browser-eyeball on a viewbook Kevin designates (no local /verify for viewbook). Update memory + move this handoff to done on ship.
```
