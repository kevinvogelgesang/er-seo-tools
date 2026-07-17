# Viewbook UX Pass — Lane 2 (Operator Editing UX) — Codex Brief

**You are Codex, implementing Lane 2 of a 4-lane viewbook UX pass.** This brief is
self-contained. Spec: `docs/superpowers/specs/2026-07-17-viewbook-ux-pass-design.md`
(§6, §9, §10). Program: `docs/superpowers/plans/2026-07-17-viewbook-ux-pass-program.md`.

## Setup

```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
git worktree list                      # pre-flight — confirm no viewbook-l2 lane open
git worktree add .claude/worktrees/viewbook-l2 -b feat/viewbook-l2
cd .claude/worktrees/viewbook-l2
```

Work ONLY in this worktree. Commit per task, push the branch, **do not merge**
(Claude cross-reviews, Kevin merges gate-green). Never edit files outside your
ownership list.

## What Lane 2 delivers (spec §6)

Operator (ER-employee) inline editing becomes **live and save-less**:

1. **No save buttons on inline *value* editors** — welcome note, section copy (`introNote`/`narrative`), theme colours/fonts. They persist on a **trailing debounce (~600ms) / blur**, with: **one serialized in-flight request per editor**, **stale-response suppression** (ignore a resolved PATCH once a newer draft exists), a **queued latest draft** (coalesce), and the editor stays **registered active while dirty OR saving** (via the existing `useViewbookSync` editor-activity registry) so `router.refresh()` never lands mid-edit. **Field-answer writes keep the `version` optimistic-CAS** and surface `stale_version` conflicts to the operator. Structural/irreversible actions **keep explicit buttons**: add/delete field, add/delete milestone, upload PDF/image, delete doc, advance/roll-back stage.

2. **Live theme (cross-lane seam — see below).** Operator theme edits drive the `--vb-*` CSS variables + the font `<link>` **live, before persistence**, via a Lane-2-owned client store written onto Lane 1's `data-vb-theme-root` element. Persistence still PATCHes `PATCH /api/viewbooks/{id}` — the live vars are the pre-persist preview.

3. **Live contrast.** `ContrastTester` reads the **live draft** theme from the same store (not only the persisted `data.theme` prop) so ratios update as the operator drags a colour.

4. **AA only (no AAA).** Remove `aaaNormal`/`aaaLarge` from `BAND_ORDER`/`BAND_LABELS`/`BandChips` and the "AA/AAA" subheading in `ContrastTester.tsx`. `contrast.ts` `aaa*` bands may be trimmed (no other consumer).

5. **Searchable Google-Fonts picker.** Replace the fixed 12-key gate with a search over a **checked-in manifest** (`lib/viewbook/font-manifest.ts`): key → `{ family, supportedWeights, gfQuery }`. Preserve the existing 12 keys (Inter, Lora, Playfair Display, Montserrat, Oswald, Merriweather, Source Sans 3, Work Sans, Libre Baskerville, Poppins, Archivo, DM Serif Display) as **aliases**. Themes still store **keys only**; `theme.ts` validates the key against the manifest; `fontsHref` builds the URL from the manifest's `gfQuery`/`supportedWeights` — **NEVER from a submitted family string, never assume `400;600;700`**. CSP fonts origins are unchanged (`fonts.googleapis.com`/`fonts.gstatic.com`). Generate the manifest from the Google Fonts API at commit time and check the JSON in (no runtime third-party call). Picker UI: search input filtering the manifest, in BOTH the operator `ThemeInlineEditor` (`InlineEditors.tsx`) and admin `ThemeEditor.tsx`.

6. **Operator edit-panels fully visible.** The `<details>`-accordion "Edit …" panels open by default (or become always-visible inline editors) so operator content is not hidden behind a summary.

## Cross-lane seams — AGREED CONSTANTS (Lane 1 builds the other half concurrently; no merge-order dependency)

- **`data-vb-theme-root`**: Lane 1 puts this attribute on the themed root `<div>` in `ViewbookShell`. Your theme store writes live vars onto `document.querySelector('[data-vb-theme-root]')`. Build + test against a fixture element carrying that attribute.
- **CSS var names (canonical, do not rename):** `--vb-primary`, `--vb-secondary`, `--vb-tertiary`, `--vb-on-primary`, `--vb-on-secondary`, `--vb-on-tertiary`, `--vb-heading-font`, `--vb-body-font`. Compute `--vb-on-*` with the existing `onThemeColorText(hex)` (from `lib/viewbook/theme.ts`).
- **Do NOT touch any sticky positioning** (`ProgressNav`, `OperatorBar`, `ViewbookShell` layout, `--vb-sticky-offset`) — that is Lane 1's.
- **Frozen:** `renderSection`/`SectionShell` props, `PublicSection` shape.

## Theme store contract (you own it)

`components/viewbook/public/OperatorLayer/theme-store.ts` — a `useSyncExternalStore`
external store holding the live draft `ViewbookTheme`. API (suggested):
`getThemeDraft()`, `setThemeDraft(partial)`, `commitThemeDraft(theme)`,
`subscribe(cb)`. On `setThemeDraft`, a small `'use client'` writer island (mounted
under `OperatorViewbookLayer` — you own the island, Lane 1 owns the layer's sticky
bits, so mount your island as a leaf without touching Lane 1's positioning) writes
the `--vb-*` vars + rebuilds the font `<link>` on `[data-vb-theme-root]`.
`ContrastTester` and `ThemeInlineEditor` both read the store. On successful PATCH,
`commitThemeDraft` moves the baseline; on unmount/navigation the store resets to the
persisted `data.theme`.

## Ownership (exact — create/modify ONLY these)

- **Create:** `lib/viewbook/font-manifest.ts` (+ generator note + checked-in JSON), `components/viewbook/public/OperatorLayer/theme-store.ts` (+ its live-writer island), tests for both.
- **Modify:** `components/viewbook/public/OperatorLayer/InlineEditors.tsx`, `operator-api.ts`, `components/viewbook/public/useViewbookSync.ts`, `components/viewbook/public/ThemeStyle.tsx`, `ContrastTester.tsx`, `BrandSection.tsx`, `lib/viewbook/theme.ts`, `lib/viewbook/contrast.ts`, `components/viewbook/admin/ThemeEditor.tsx`, and their `.test.*`.
- **Touch nothing else.** In particular: no `ViewbookShell`, `SectionShell`, `SectionReveal`, `ProgressNav`, `OperatorBar`, `OperatorViewbookLayer` layout, `section-display.ts`, or any Lane 3/4 file.

## Repo invariants (must follow)

- Array-form `$transaction([...])` only — never interactive `$transaction(async tx => …)`.
- New/changed API paths use `withRoute` + `parseJsonBody`; but Lane 2 is mostly client + `theme.ts`/manifest — the theme PATCH route already exists, reuse it.
- Client input NEVER reaches the fonts URL unvalidated (keys-only storage; URL from code-owned manifest metadata).
- Per-worker test DBs; run `DATABASE_URL="file:./local-dev.db" npm test`.
- No new npm deps without need; if the font-manifest generator needs one, keep it dev-only and run `npm run audit:ci`.

## TDD + gates

Test-first per unit. Key tests: debounced autosave fires ONE PATCH and suppresses a
stale out-of-order response; editor stays registered while dirty/saving (no
`router.refresh()` mid-edit); live `--vb-*` reflect the draft on `[data-vb-theme-root]`;
contrast reads the live draft; no AAA chips; `font-manifest` `isAllowedFont` accepts a
known family key, rejects an unlisted/injection string; `fontsHref` encodes only
manifest metadata. Gates in the worktree before every commit: `npx tsc --noEmit` ·
`npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`
(+ `npm run audit:ci` if deps changed).

## Budget / stop protocol

You run at full strength (`gpt-5.6-sol`, high). **If you hit a usage/limit wall,
STOP immediately, commit + push what's green, and report "Codex out of usage —
reset to resume Lane 2" in one line.** Do not downgrade the model or silently retry.
Kevin resets and re-fires this brief; resume from the last green commit.
