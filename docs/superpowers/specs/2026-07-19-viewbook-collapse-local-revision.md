# Viewbook collapse — local-only revision (post-#215)

**Date:** 2026-07-19 · **Branch:** `feat/vb-collapse-local` (off merged `main` 86397e2)

Revises the viewer-collapse feature shipped in PR #215 per Kevin's feedback. The shared/server collapse model is retired in favor of a **purely local, per-machine** model with a **collapsed default**, plus a visual pass. Approved mockup: `scratchpad/collapse-mockup-v3.html` (chevron default, pill alt, bar dropped).

## Behavior changes

1. **Collapse is now purely local (localStorage), no server involvement.**
   - Effective state = localStorage value if present, else **default = collapsed**.
   - localStorage key unchanged: `vb:collapse:<viewbookId>:<sectionKey>`, now stores `'expanded'` OR `'collapsed'` (absent ⇒ collapsed default).
   - Toggling writes localStorage only. **No fetch, no shared state, no operator gate, no reconciliation latch, no `requestRefresh`.**
   - Every collapsible section (all except the bookends `pc-intro`/`pc-thanks`) starts collapsed on a fresh machine.

2. **Server layer goes DORMANT (kept, not deleted — Kevin's call, documented here).**
   - `ViewbookSection.collapsedShared` column: **retained, no longer read by any render path.** Left in the schema.
   - `POST /api/viewbook/[token]/collapse` route + `lib/viewbook/collapse.ts` + the middleware matcher `^/api/viewbook/[^/]+/collapse$`: **retained + functional but no longer called by the client.** Mark each with a `DORMANT (2026-07-19):` comment pointing at this doc. Their tests stay (they still verify a working-but-unused route).
   - Why kept: avoid a rebuild migration + route deletion so soon after shipping; a future "shared collapse" could reuse them. This doc is the breadcrumb so a future reader isn't confused.

3. **Click the hero band to collapse when expanded.** The whole expanded hero band is the collapse trigger (`role="button"`, keyboard-activable). The body below is NOT a collapse target (its links/content stay clickable). The collapsed row expands via its affordance (and the whole row is clickable to expand too).

## Visual pass (per approved v3 mockup)

4. **Collapsed = compact accordion rows** (~74px min-height, not 150px): brand horizontal wash over the section image so the stack reads cohesive; a 4px `--vb-secondary` left accent bar; `title` + small inline done-check (when done) + affordance, all **snug to the title** (left cluster); subtle hover lift; rounded, 8px gap between rows.

5. **Affordances: pill + chevron only (bar dropped). Default = chevron.**
   - Chevron: a soft rounded tap target (`~26px`, `rgba(255,255,255,.12)`, hover lightens) with a **crisp inline-SVG chevron** (down when collapsed) — NOT the unicode `⌄`.
   - Pill: refined translucent-white pill, hairline border, crisp SVG chevron, "Expand" label, tight rhythm.
   - `CollapseAffordance.tsx` renders these; the SVG chevron is inline (no external asset).

6. **Expanded hero cluster:** `title` + done-check + an **up-chevron collapse control** grouped together at the hero's bottom-left — nothing flung to the corners. Whole band clickable. Overlay gradient (concrete TS stops) + minimum scrim retained. Body "Completed {date}" badge retained.

## Config change

7. `lib/viewbook/presentation-config.ts`: `COLLAPSE_AFFORDANCES = ['chevron', 'pill']` (drop `'bar'`); `PRESENTATION_DEFAULTS.collapseAffordance = 'chevron'`. `readPresentationConfig` already degrades any non-member value (incl. legacy `'bar'`) to the default — so existing rows storing `'bar'` read as `'chevron'` with NO data migration. Update the `Viewbook.collapseAffordance` schema default to `"chevron"` (migration regenerates). The `PresentationEditor` dropdown now offers chevron/pill.

## Files

- `lib/viewbook/presentation-config.ts` — affordance set + default.
- `prisma/schema.prisma` (+ migration) — `collapseAffordance @default("chevron")`.
- `components/viewbook/public/useCollapseState.ts` — **rewrite**: local-only, default-collapsed, `'expanded'|'collapsed'` override, toggle → localStorage; drop pending/latch/awaiting/requestRefresh/prop-reconciliation.
- `components/viewbook/public/CollapseAffordance.tsx` — drop bar; refine chevron (SVG) + pill.
- `components/viewbook/public/CollapsibleSection.tsx` — local toggle only; whole-hero click-to-collapse when expanded; render compact collapsed row vs expanded hero; drop token/isOperator/server-write; keep a `previewMode` that suppresses localStorage writes in ThemePreview.
- `components/viewbook/public/SectionShell.tsx` — compact collapsed-row layout + expanded-hero cluster (title+check+chevron grouped) + whole-hero collapse target; default-collapsed via the hook (no `collapsedShared` read); overlay + min scrim + done-check retained.
- DORMANT comments on `lib/viewbook/collapse.ts`, `app/api/viewbook/[token]/collapse/route.ts`, the middleware matcher, and the `collapsedShared` schema field.
- Tests: rewrite the client-side collapse tests for local-only/default-collapsed/hero-click; keep the (now-dormant) route/service tests; ensure the affordance-set change + degrade-legacy-'bar' is covered.

## Gates
`npx tsc --noEmit` 0 · full vitest green · `npm run build` OK. Accessibility: collapsed row + expanded hero are keyboard-activable (`role="button"`/`tabindex`/Enter+Space) with correct `aria-expanded`/`aria-controls`; the always-rendered region stays `hidden`+`inert` when collapsed.
