# Viewbook viewer polish — section info-tooltips + ToC hide toggle

**Date:** 2026-07-21
**Status:** Spec (design approved by Kevin; product decisions locked)
**Worktree/branch:** `feat/vb-viewer-polish` off `origin/main`
**Scope:** two independent, light-only, public-viewer features → **two PRs**. Feature B first (client-only, no schema, no content-write, not a P1 gate), then Feature A (content model + editing surfaces, P1 `/codex-review` before merge). Ordering is flexible; A does not block B.

Handoff source: `docs/superpowers/todos/2026-07-21-section-info-tooltips-handoff.md`.

---

## 0. Locked product decisions (Kevin)

- **A — tooltip copy:** all three fields become editable and are surfaced — `purpose` (chapter one-liner), `whatThis`, `whatWeNeed`.
- **A — ⓘ placement:** beside the hero H2 (continuous viewer). See §A3 for the collapse-viewer resolution of the button-nesting wrinkle.
- **B — persistence:** device-global localStorage (`vb:toc-hidden`), default = expanded.

Engineering choices (routed to Codex, not gated on Kevin): content-model table reuse (§A2) and whole-object-per-layer resolution (§A1).

---

## 1. Constraints (apply to both features)

- **Light-only** public viewer: no `dark:` classes; color via `--vb-*` CSS vars only.
- Tests: vitest + Testing Library, **`@vitest-environment jsdom` pragma on line 1**, **NO jest-dom** — DOM-native assertions only.
- Server components stay server components; `'use client'` islands take only serializable props (never a function prop across the RSC boundary).
- Array-form `$transaction([...])` only; raw-SQL writes set `updatedAt` manually where applicable (not needed here — Prisma `upsert`/`updateMany` handle it).
- Every content write bumps `syncVersion` (global write → `syncVersionBumpAllStatement`; per-viewbook override → `syncVersionBumpStatement(viewbookId)`), mirroring `global-content.ts`.
- Gate every step: `npx tsc --noEmit` + scoped `npx vitest run`; full `npx vitest run` + `npm run build` before each PR.

---

# FEATURE A — section info-tooltips

Retire the `SectionSummaryPanel` ("What this is / What we need" panel) and surface that copy via an ⓘ info-tooltip beside each section heading. Make the copy **editable company-wide** with **per-viewbook overrides**, layered over the existing code-owned defaults.

## A1. Content shape & resolution

Editable fields per section (keyed by `SectionKey`, the fixed 13-key catalog):

```ts
interface SectionCopyContent {
  purpose: string            // chapter one-liner (chapter header)
  whatThis: string           // "What this is"
  whatWeNeed: string | null  // "What we need from you" — null/"" = nothing needed
}
```

Not editable (stay code-owned in `section-copy.ts`): `cta` and `INPUT_EXPECTING_KEYS` (the latter drives `section-status.ts` and must remain deterministic).

**Resolution — whole-object per layer, in priority order:**

1. **Per-viewbook override** row (if present and valid) — wins entirely.
2. **Company-wide** row (if present and valid) — else…
3. **Code default** `SECTION_COPY[sectionKey]` (always present for all 13 keys).

Whole-object (not per-field-merge) because it matches the existing override semantics (each override is a full stored body) and keeps resolution trivially auditable. The editors **pre-fill the currently-resolved values**, so "I only want to tweak whatWeNeed" never means retyping the other fields.

**Normalization + fallthrough (Codex fix 1):**
- `whatWeNeed: ""` (empty/whitespace) normalizes to `null` on **both read and write** (= "nothing needed") — so a legacy or hand-corrupted `""` row can never conflict with the declared `string | null` invariant.
- An **invalid/corrupt layer behaves as ABSENT**, not as "reset to code default": an invalid per-viewbook override falls through to a **valid company-wide** row (if any), and only then to the code default. `resolveSectionCopy` therefore takes the already-`validateSectionCopy`-filtered (`null`-on-invalid) values for each layer and picks the highest present one. (The `guarded('section-copy', …)` fault-isolation in §A4 is refined to match — see there.)

> **Codex ruling:** whole-object-per-layer confirmed as the right call (avoids an inherit-vs-explicit-null sentinel; editors prefill the resolved object). Field-level fallthrough rejected for the sentinel + editor complexity.

## A2. Storage — reuse existing tables, no migration

Reuse `ViewbookGlobalContent` (company-wide, `key @id`) and `ViewbookContentOverride` (per-viewbook, `@@unique([viewbookId, contentKey])`, `onDelete: Cascade`) under a **reserved key namespace**:

```
section-copy:<sectionKey>      e.g. "section-copy:brand"
```

- Company-wide row: `bodyJson` = `JSON.stringify({ purpose, whatThis, whatWeNeed })`.
- Per-viewbook override row: `body` = the same JSON (the column is a plain `String`; storing JSON is fine — the existing "your plan" overrides just happen to store plain text).

**No schema migration.** Both key columns are free-form `String`.

**Isolation from the existing "your plan" content system:**
- The existing loaders (`loadGlobal`, `loadOverrides` in `public-data.ts`) iterate `GLOBAL_CONTENT_KEYS` and **ignore any key not in that list** — so `section-copy:*` rows are invisible to them.
- The existing writers (`putGlobalContent`, `putContentOverride`) **reject unknown keys** — they will never touch `section-copy:*`.
- A **new dedicated module** owns the section-copy path end to end (below). The two systems share tables but not code paths.

Rejected: new dedicated tables (`ViewbookSectionCopy` + `…Override`). Cleaner nominal isolation but requires a migration (documented macOS `prisma migrate dev` pain) for no behavioral gain over the namespace approach.

## A3. New server module — `lib/viewbook/section-copy-content.ts`

Server-only. Mirrors `global-content.ts` conventions (strict whole-doc validation; read exactly as strict as write; corrupt rows read `null`, never throw; sync bumps inside the write txn).

```ts
// Pure helpers (client-safe split if a client component ever needs the resolver;
// otherwise server-only alongside the store).
sectionCopyKey(sectionKey: SectionKey): string            // `section-copy:${sectionKey}`
validateSectionCopy(raw: unknown): SectionCopyContent | null
resolveSectionCopy(                                        // PURE — unit-testable
  sectionKey: SectionKey,
  companyWide: SectionCopyContent | null,
  override: SectionCopyContent | null,
): ResolvedSectionCopy   // { purpose, whatThis, whatWeNeed } always fully populated from code default

// Server store
getSectionCopyGlobal(sectionKey): Promise<SectionCopyContent | null>
getAllSectionCopyGlobal(): Promise<Partial<Record<SectionKey, SectionCopyContent>>>
putSectionCopyGlobal(sectionKey, raw, updatedBy): Promise<void>   // upsert + bumpAll, in ONE array-form txn
deleteSectionCopyGlobal(sectionKey): Promise<void>               // EXISTS-fenced deleteMany + bumpAll; 404 on 0 rows
getSectionCopyOverride(viewbookId, sectionKey): Promise<SectionCopyContent | null>
putSectionCopyOverride(viewbookId, sectionKey, raw, updatedBy): Promise<void>  // viewbook-exists check, then upsert + bump(viewbookId)
deleteSectionCopyOverride(viewbookId, sectionKey): Promise<void>              // EXISTS-fenced deleteMany + bump(viewbookId); 404 on 0 rows
```

**Query discipline (Codex fix 2):** the store queries the namespace by an **exact key set** — `where: { key: { in: SECTION_KEYS.map(sectionCopyKey) } }` — NEVER `startsWith('section-copy:')` (a prefix scan could match a future foreign key). `getAllSectionCopyGlobal` is **one `findMany`**, not 13 `findUnique`s. Every store + route entry point validates the `sectionKey` suffix against the `SectionKey` catalog (reject off-catalog).

**Write/bump discipline (Codex fix 3) — mirror `putContentOverride`/`deleteContentOverride` exactly:**
- Global `put`: `viewbookGlobalContent.upsert` + `syncVersionBumpAllStatement()` in one `$transaction([...])`.
- Global `delete`: `EXISTS`-fenced `syncVersionBumpAllWhere(fence)` + `deleteMany` in one txn; **404 on 0 rows** (never bump when nothing was deleted).
- Override `put`: `viewbook.findUnique` existence check first (404 if gone), then `viewbookContentOverride.upsert` + `syncVersionBumpStatement(viewbookId)` in one txn.
- Override `delete`: `EXISTS`-fenced `syncVersionBumpWhere(viewbookId, fence)` + `deleteMany`; **404 on 0 rows**.

Validation caps: `purpose` ≤ 240, `whatThis` ≤ 600, `whatWeNeed` ≤ 600 (empty→`null`), unknown-key reject, exactly the three fields.

## A4. Data flow into the viewer

Today `SectionShell` imports `SECTION_COPY` directly and reads `copy.whatThis/whatWeNeed/purpose/cta`. After A:

- `public-data.ts` resolves section copy for **every rendered section** and threads the resolved map into `ViewbookPublicData` (new field, e.g. `sectionCopy: Record<SectionKey, ResolvedSectionCopy>`), assembled through a **fault-isolated `guarded('section-copy', …)` block** so the whole block can never blank the page. Per-layer degradation is finer-grained than "reset to code default" (Codex fix 1): because each layer is `validateSectionCopy`-filtered to `null`-on-invalid before `resolveSectionCopy`, a corrupt **override** still falls through to a valid **company-wide** row, and only a corrupt company-wide row (with no override) falls to the code default. The `guarded` fallback (whole-block failure → all code defaults) is the outer net, not the per-section rule.
  - Load company-wide once (`getAllSectionCopyGlobal`) + per-viewbook overrides once (a single `findMany` on `ViewbookContentOverride` filtered to `section-copy:*`), then `resolveSectionCopy` per visible section key. No N+1.
- `SectionShell` (and its callers, e.g. `ViewbookShell`/section renderers) receive the resolved copy as a **prop**; it stops reading `whatThis/whatWeNeed/purpose` from `SECTION_COPY` directly. `cta` continues to come from `SECTION_COPY` (code-owned).

## A5. ⓘ placement & tooltip

- **`Tooltip.tsx`:** widen `label: string` → `label: ReactNode` so the tooltip can render the labelled multi-line body (What this is / What we need). Keep the always-focusable, `aria-describedby`-wired trigger. Add an optional trigger-tone prop (default dark `text-black/40`; **on-primary/white** variant for use over the hero).
- **Continuous viewer (`buildContinuousHero`, active/default):** ⓘ renders as a **sibling of** the real `<h2>` inside the hero band (in the same flex cluster, NOT nested inside the `<h2>`), using the on-primary tone. **Never inside the `<h2>`** — nesting the trigger in the heading would fold the ⓘ glyph into the heading's accessible name (name-from-content). The `<h2>` is not inside a button here → a sibling focusable trigger is valid.
- **Collapse viewer (`buildCompactRow`/`buildExpandedHero`, dormant):** the title is a `<span>` inside `CollapsibleSection`'s `<h2><button>…</button></h2>` — a focusable trigger may **never** nest inside that `<button>` (invalid) or that `<h2>` (accessible-name pollution). The ⓘ therefore renders in the **`headerStrip`** (the strip below the hero, above the body — a sibling of the whole `<h2><button>` heading, not inside it). `headerStrip` is correctly inert when the collapsed body is inaccessible. Resolves the flagged a11y wrinkle with no accordion restructuring.
- **Tooltip body content:** "What this is" blurb always; "What we need" block only when `whatWeNeed != null`. `purpose` is NOT repeated in the tooltip (it already shows in the chapter header) — but it IS editable (A1) and the chapter header renders the resolved `purpose`.

## A6. Removal

- Delete `SectionSummaryPanel` (the panel) and its two `SectionShell` render sites (continuous body ~line 494; collapse `detailBody` ~line 523). Delete `SectionSummaryPanel.test.tsx`'s panel cases.
- **Relocate `StatusPill`** (co-exported from `SectionSummaryPanel.tsx`) to its own file — e.g. `components/viewbook/public/StatusPill.tsx` — and update the three importers (`SectionShell`, `StageOverview`, `PreviousStages`) + its test. `StatusPill` here is the viewbook-public status pill (`status: SectionStatus`), distinct from `components/ui/StatusPill`.
- `SECTION_COPY` stays (code default + `cta` + `INPUT_EXPECTING_KEYS`). `section-copy.test.ts` stays.

## A7. Editing surfaces

- **Company-wide** — new "Section copy" editor on `/viewbooks/settings` (a new `SectionCopyEditor` admin component beside `GlobalContentEditor`). Lists the 13 sections; each row shows 3 fields (purpose / whatThis / whatWeNeed) pre-filled with the resolved-or-default values; save-per-section (`PUT`), revert-to-default (`DELETE`). New routes: `PUT/DELETE /api/viewbooks/section-copy/[sectionKey]` (operator-gated, `withRoute`, `requireOperatorEmail`) — global scope, so **not** under `/api/viewbooks/[id]/…`.
- **Per-viewbook** — per-section override in the admin **`ContentTab`** (consistent with the existing "your plan" override precedent). New routes: `PUT/DELETE /api/viewbooks/[id]/section-copy/[sectionKey]` (operator-gated), mirroring the existing `overrides/[contentKey]` route.
  > **Sub-decision (flagged):** the handoff floated the Context Lens operator inspector for the per-viewbook surface. Recommending admin `ContentTab` for lower risk/consistency; Context Lens integration deferred to a future add. Kevin/Codex may redirect.
- Middleware: these are cookie-gated operator routes under `/api/viewbooks/*`, already covered by the existing operator gate — **no new public matcher** (contrast with public share routes). Confirm the existing matcher covers the new sub-paths.

## A8. Feature A testing

- `resolveSectionCopy` — 3-layer fallthrough (pure): code-only, +company-wide, +override; `whatWeNeed` null/empty normalization.
- `validateSectionCopy` — reject unknown keys, over-cap, non-string; accept null `whatWeNeed`.
- `section-copy-content` store — get/put/delete global + override round-trips; corrupt row reads null; sync bump present (assert via the same seam pattern other content tests use).
- `Tooltip` — `ReactNode` label renders; trigger focusable + `aria-describedby` wired; on-primary tone variant.
- `SectionShell` — ⓘ present beside the H2 (continuous) / in header strip (collapse); panel gone; resolved copy threaded from props (not `SECTION_COPY`).
- `StatusPill` relocation — importers still render it.

---

# FEATURE B — ToC hide toggle

Add a persistent floating circular hamburger (☰) that completely hides the desktop ToC rail while the hamburger stays visible to bring it back. Default = expanded.

## B1. Behavior (desktop rail)

- The rail is currently `fixed left-3 top-1/2 -translate-y-1/2` (left edge; the "right-edge" wording in comments/handoff is stale — **preserve the current left side**, do not move it).
- Add an **always-visible** circular hamburger button, `position: fixed`, positioned above the rail card's column (same side as the rail).
- **Expanded (default):** hamburger + full rail card both visible. Clicking the hamburger **removes the rail `<nav>` card from the DOM** (complete hide), leaving only the hamburger.
- **Hidden:** only the hamburger remains; clicking restores the card and moves focus into it (or to the first rail entry).
- This is a *complete hide*, distinct from the retired shrink-to-40px-dots path.

**Full retirement of the old desktop state (Codex fix 6):** remove `DESKTOP_RAIL_COLLAPSIBLE`, its 40px-width branch, the `onFocus`-forces-open focus-safety hook tied to that width, and the desktop `Escape`-collapse logic. The single `hidden` state is the ONLY desktop collapse concept after this change.

## B2. No competing concepts

- **Desktop-only.** The `isMobile` branch (FAB + bottom-sheet, `< 768px`) is unchanged — it is already a hide-until-tapped model; adding a second hamburger there would be the duplication Kevin flagged. The new hamburger renders only in the desktop branch.
- **Mobile first-paint guard (Codex fix 6):** `isMobile` settles *after* hydration (SSR/first paint renders the desktop branch). So the desktop hamburger also carries a CSS `max-md:hidden` safeguard — it cannot flash as a second visible hamburger on a phone during the pre-effect window.

## B3. Persistence

- New client hook `useTocHidden` (mirrors `useCollapseState`): single device-global localStorage key **`vb:toc-hidden`** (`'true'` = hidden), SSR-safe default **not hidden** (expanded), reconciled in a mount effect (no `window`/`localStorage` read during render). Not per-viewbook, not server-backed, no `syncVersion` involvement.

## B4. a11y / CLS

- Hamburger: `type="button"`, `aria-label` reflecting state ("Hide section navigation" when expanded / "Show section navigation" when hidden), `aria-expanded={!hidden}`, native keyboard-operable.
- **`aria-controls` reconciled with DOM removal (Codex fix 5, the one real a11y bug):** because *hidden* removes the rail `<nav>` from the DOM, the hamburger **omits `aria-controls` while hidden** and only sets it (pointing at the rail `<nav>`'s stable `id`) when the nav is actually mounted. `aria-controls` must never dangle to an unmounted id. `aria-expanded={false}` stays set while hidden.
- **Focus on restore:** showing the rail focuses the first rail entry after mount (or the `<nav>` itself via `tabIndex={-1}` when there are no entries); hiding leaves focus on the hamburger.
- Rail + hamburger are both `position: fixed` → toggling never reflows the reading column (no CLS). Respect `prefers-reduced-motion` for any show/hide transition (instant or fade; no motion under reduce). Watch the documented `overflow:clip` sticky gotcha — not expected to apply (these are fixed, not sticky), but verify no clipping of the hamburger.
- **Persisted-hidden flash (Codex fix 6):** a device with `vb:toc-hidden=true` renders the rail on first paint (SSR default = expanded) until the mount effect reconciles, so the rail can briefly flash before hiding. Fixed positioning means no reading-column CLS from this, but it IS an explicit **browser-eyeball regression check** at deploy.

## B5. Feature B testing

- `useTocHidden` — SSR default expanded; reconciles from localStorage on mount; persists on toggle; tolerates unavailable localStorage.
- `TocRail` — hamburger always rendered (desktop); toggling removes/restores the rail nav; `aria-expanded`/`aria-controls` correct; mobile branch unaffected (FAB still present, no second hamburger).

---

## 2. Non-goals / YAGNI

- No dark-mode styling (light-only viewer).
- No server/per-viewbook config for the ToC toggle (device-local only, per B3).
- No migration (Feature A reuses existing tables).
- No Context Lens operator-inline editor for section copy (admin surfaces only; deferred).
- `purpose` is editable but not duplicated into the tooltip body.

## 3. Rollout

- **PR 1 (Feature B):** client-only, no schema, no content-write. Gates + `npm run build`; `/codex-review` optional (not P1). Deploy + browser-eyeball on a viewbook Kevin designates.
- **PR 2 (Feature A):** content model + editing surfaces. **P1 → `/codex-review` before merge** (content-write path). Gates + `npm run build`. Deploy via `~/deploy.sh` + prod-verify (health 200, deployed HEAD; no migration to confirm). Browser-eyeball: ⓘ render beside the H2 + a company-wide edit + a per-viewbook override on a designated viewbook.
- On ship of both: update memory `project_viewbook_reading_experience`, move the handoff doc to done.
