# Explainer Hover-Card Redesign — Design

**Date:** 2026-07-15
**Status:** Approved by Kevin (chat); Codex-reviewed 2026-07-15 (accept with named fixes — applied)
**Supersedes:** the inline-disclosure behavior of `2026-07-14-explainer-disclosure-component-design.md` (archived). The export API, the four subcomponents, and the methodology-vs-operational-truth rule are RETAINED; only the container's presentation/interaction change from an inline dropdown to a floating hover card.

## Problem

The current `Explainer` (`components/ui/Explainer.tsx`) is an inline disclosure: a text-link trigger that expands a panel of prose below it. Kevin wants the explanation UX to feel like the "Social Style" popover mock — a **floating card that appears on mouseover**, and to be visually rich (summary paragraph, tag chips, ✓ Do / ✗ Don't columns, flagged footer note) rather than a dropdown of raw text. It should become a first-class, app-wide feature, not just the ~15 sites that adopted the inline version.

## Goals

- Rewrite `Explainer` as a **floating hover-card** triggered by a circled-ⓘ icon, using `@floating-ui/react` for collision-aware positioning, portal rendering, and composable interaction.
- Reachable everywhere: **hover + keyboard-focus + tap** (the public prospect sales report at `/sales/[token]` is frequently opened on phones).
- Keep the existing export names (`Explainer`, `ExplainerSummary`, `ExplainerTags`, `ExplainerColumns`, `ExplainerNote`) so adoption is mostly content authoring, not rewiring.
- Enrich content per section ("full mock, per-section fit") — use whichever of the four content blocks fit each surface.
- Extend to high-value spots that have no explainer today (Phase 3), from an approved candidate list.

## Non-goals

- No CMS/registry for copy. Copy stays colocated with each surface (the `lib/sales/copy.ts` precedent).
- No new heavy UI framework (no Radix). `@floating-ui/react` (tree-shakeable, ~10kb) is the only new dependency.
- The methodology-vs-operational-truth rule is unchanged and NOT relaxed — hover cards hold static prose only.
- **The card is strictly NON-INTERACTIVE** (Codex fix 1). No links, buttons, inputs, or focusable controls inside — only prose, chips, ✓/✗ lists, notes, and static score-factor tables. This keeps `role="tooltip"` semantically valid (WAI: tooltips must not contain focusable content) and makes hover-dismiss safe. If a future card needs interactive content, it uses a SEPARATE non-modal-dialog popover primitive with focus management — not this component.

## Design

### Dependency

Add `@floating-ui/react` (React 19 compatible). It is the de-facto positioning engine (used under the hood by most tooltip/popover libraries) and gives us `flip`/`shift`/`offset`/`arrow`, `autoUpdate`, `FloatingPortal`, and the interaction hooks below without hand-rolling collision detection or the "don't close when the cursor moves toward the card" behavior.

### Component: `components/ui/Explainer.tsx` (client component)

```tsx
<Explainer title="SEO Health Score" label="How this score is calculated">
  <ExplainerSummary>One-paragraph plain-English summary.</ExplainerSummary>
  <ExplainerTags tags={['Indexability', 'Errors', 'Thin content']} />
  <ExplainerColumns
    good={{ label: 'Do', items: ['…'] }}
    bad={{ label: "Don't", items: ['…'] }}
  />
  <ExplainerNote>Flagged footer callout (the mock's "At the close" row).</ExplainerNote>
</Explainer>
```

**Props:**
- **`label`** (existing, required) — the accessible name of the ⓘ trigger (`aria-label`). No longer rendered as visible text.
- **`title`** (new, optional) — bold heading at the top of the floating card. Defaults to `label` when omitted.
- **`children`** (existing) — the four subcomponents (or arbitrary **non-interactive** content, e.g. existing static score-factor tables — no links/buttons/inputs).
- **`variant`** — **REMOVED** (it only distinguished inline-container chrome; the floating card always has its own chrome). Adopters passing it are cleaned up.
- **`defaultOpen`** — **REMOVED** (meaningless for a hover card). Adopters passing it are cleaned up.
- **`className`** — retained, applied to the trigger wrapper (for placement next to a heading).

**Trigger:** an inline circled-ⓘ button. The icon is 16px visual (`w-4 h-4`) but the button **hit area is ≥28px** (padding to `min-h-7 min-w-7` / `p-1.5`) — a 16px tap target is too small for the mobile-heavy public sales report (Codex fix 4). `text-navy/40 dark:text-white/40`, hover/focus → full opacity, `focus-visible` ring. It is a real `<button type="button">` carrying the `aria-label` and the floating-ui reference props.

**Floating card:** `FloatingPortal` → panel `bg-white dark:bg-navy-card`, `border border-gray-200 dark:border-navy-border`, `rounded-xl`, `shadow-lg`, `p-4`, plus a directional `FloatingArrow` (requires the `arrow({ element: arrowRef })` middleware — Codex fix 4). Content: optional bold `title` row, then children in a `space-y-3` stack. `z-50`.

**Positioning is on a separate element from the animation** (Codex fix 5): the outer portal element carries floating-ui's positioning transform; an inner element carries the entrance transform/opacity. Never combine them on one node (floating-ui documents this — a combined transform fights positioning).

**Interaction (composed on one `useFloating`):**
- `useHover(ctx, { mouseOnly: true, move: false, delay: { open: 120, close: 80 }, handleClose: safePolygon() })` — `mouseOnly` stops touch/pen from also firing hover (Codex fix 2); `move: false` stops a deliberately-closed card reopening on the next mouse move; `safePolygon()` lets the cursor cross the gap into the card without closing.
- `useFocus(ctx, { visibleOnly: true })` — open on keyboard focus only (not programmatic/mouse focus).
- `useClick(ctx, { stickIfOpen: true })` — the touch/tap path; `stickIfOpen` keeps a hover-opened card open on the first click (pin), so a mouse user's first click doesn't toggle it shut.
- `useDismiss(ctx)` — Esc + outside-press close.
- `useRole(ctx, { role: 'tooltip' })` — `role="tooltip"` on the panel + `aria-describedby` from trigger; valid ONLY because the card is non-interactive (see Non-goals). The ⓘ's own `aria-label` names the trigger.
- Middleware: `offset(8)` + `flip()` + `shift({ padding: 8 })` + `size(...)` + `arrow({ element: arrowRef })`, with `autoUpdate`. The **`size` middleware is required** (Codex fix 4): flip/shift reposition but do NOT shrink an oversized card — `size` caps `max-width`/`max-height` to the available viewport space and the panel body gets `overflow-y: auto` so a long score-factor table scrolls instead of overflowing the screen.

**Mount/animation (Codex fix 5):** `useTransitionStyles().isMounted` stays true *during* the exit animation, so "closed = immediately absent from the DOM" is NOT accurate. Approach: entrance-only animation (fade/scale-in on open) with **immediate unmount on close** (no exit transition) — so a closed card is genuinely absent and there is no hidden-focus concern (moot anyway since the card is non-interactive). Animation wrapped in `motion-safe:`; reduced-motion users get an instant show.

**Purity:** `'use client'`, no fetches, no context, no cookies — safe on public token-gated pages and as a client leaf inside server-component trees (children are server-rendered and passed through).

### Subcomponents

`ExplainerSummary`, `ExplainerTags`, `ExplainerColumns` (✓ green / ✗ red markers, configurable labels), `ExplainerNote` (flag-icon footer callout) keep their current markup essentially verbatim — they now render inside the floating panel instead of an inline grid. Minor spacing tweaks only.

### The methodology-vs-operational-truth rule (RETAINED, TIGHTENED per Codex fix 3)

Only **invariant methodology limitations** — the same for every run (what this measures, where data comes from, how a score is computed, "this formula excludes crawl-depth") — may live inside the card. **Anything run-specific stays visible at all times, OUTSIDE the card:** status lines, errors, freshness/"as of" lines, coverage/truncation warnings (`…AtLimit`, content caps, `harvestTruncated`), honesty qualifiers tied to THIS result ("not observed ≠ not ranking", "no FAQ detected — verify"), archived-evidence banners, and action guidance (ContentAuditCard's expiry/wait/error states). `ScoreExplanation`'s visible legacy-breakdown fallback stays outside the card.

This is the fix for the earlier draft's contradiction: an `ExplainerNote` may carry a *permanent* honesty caveat (e.g. "performance is lab data, not field") but must NOT carry a run-specific coverage/truncation line. When in doubt, it stays visible.

### Content mapping ("full mock, per-section fit")

Note the Do/Don't and Note columns hold only static, invariant guidance (no links — non-interactive rule):

| Surface | Summary | Tags | Do/Don't | Note |
|---|---|---|---|---|
| Score methods (SEO health, ADA, sales scores) | how the number is derived | the weighted factors | — | invariant caveat (e.g. "lab data, not field") |
| On-page SEO / Broken links / Content sections | what the check finds | signals inspected | ✓ fix / ✗ avoid (generic guidance) | invariant scope caveat (not the run's `harvestTruncated`) |
| Client dashboard cards (GSC, keyword, robots) | what the card shows | data source / window | ✓/✗ how to act | invariant honesty line (e.g. GSC "absence = not observed"); the run's `…AtLimit` stays outside |
| Standalone pages (reports, robots-validator) | what the tool does | — | — | — |

Content reuses existing copy sources where they exist (`lib/sales/copy.ts` `SCORE_METHOD`, scoring `lib/scoring/weights.ts`, the `ISSUE_WHY` map) rather than inventing parallel prose.

## Phasing

**Phase 1 — Foundation.** Install `@floating-ui/react`. Rewrite `Explainer.tsx` (container + interaction + a11y + dark mode + portal/arrow/size). Update subcomponents. Rewrite `Explainer.test.tsx`.

There are **17 production adoption files** (Codex fix 6 — not "~15"): the 9 site-audit sections, `ScoreExplanation`, `AdaScoreExplanation`, 5 client cards, and the `/reports` + `/robots-validator` pages. `variant` is passed by `components/sales/sections.tsx` and `app/(app)/robots-validator/page.tsx`; `defaultOpen` is test-only. Preserved export names keep the tree **compiling**, but do NOT preserve **layout** — several explainers currently sit on their own standalone row, so after the rewrite they would render a detached, orphaned ⓘ icon unless moved beside their heading. Phase 1 therefore must:
- Remove `variant`/`defaultOpen` from the type AND fix both call sites, so the build stays green.
- **Visually audit every one of the 17 placements** — move each ⓘ next to the heading/label it explains; no orphaned icons.
- Replace generic trigger labels ("What is this?") with contextual accessible names ("What is the SEO health score?").
- Update ALL affected tests, not only the four named below.
- Run `npm run build` (this changes an RSC/client-boundary dependency, so a passing `tsc` + vitest is not sufficient proof — Codex fix 6).

**Phase 2 — Convert + enrich existing adopters** (grouped PRs):
- 2a. Site-audit SEO/score sections (9) + `ScoreExplanation`/`AdaScoreExplanation`.
- 2b. Client dashboard cards (5).
- 2c. Public prospect sales report (`components/sales/sections.tsx`) — mobile + server-component children care.
- 2d. Standalone pages (`/reports`, `/robots-validator`).
Each adds `title`, removes dropped props, and fills tags/columns/note per the mapping.

**Phase 3 — Extend app-wide.** Add ⓘ cards to spots with no explainer today, from a candidate list presented for approval first (e.g. nav tool descriptions, form fields like WCAG level / scan type, queue/status terms) — no open-ended sweep.

## Error handling

None meaningful — pure presentational component. The only rule: adopting surfaces must not change what data they load or when.

## Testing

- `components/ui/Explainer.test.tsx` (rewritten): opens on hover, on focus, and on click; closes on Esc and outside-press; **pin behavior** (Codex fix 2): hover-open → click → pointer leaves → still open; second click → closed; can hover-open again after leaving. `aria-label` on the trigger and `role="tooltip"`/`aria-describedby` wiring; **closed = not in the DOM**; subcomponents render their structure (tags, two columns with markers, note). Query the portal via `screen`, snapshot-free.
- **jsdom limitations (Codex fix 7):** jsdom cannot measure floating position — assert presence/roles/mount/dismiss, NOT coordinates. Flush floating-ui positioning microtasks inside `act`; stub `ResizeObserver` and `IntersectionObserver` (the `autoUpdate` + `size` middleware need them) in the test setup; use controlled timers for the open/close delays.
- Adoption updates: `ScoreExplanation.test.tsx` / `AdaScoreExplanation.test.tsx` / `KeywordProfileCard.test.tsx` / `BrokenLinksSection.test.tsx` updated to the ⓘ trigger; one section test (e.g. `OnPageSeoSection`) proves intro copy sits in the card. Update ALL tests that reference the old inline trigger, not just these.
- **One Playwright smoke** (Codex fix 7, `.playwright-mcp` or the repo's e2e path): pointer travel across the trigger/card gap without closing; flip/shift near a viewport edge; mobile tap open + tap-away close; keyboard focus + Esc; hydration on `/sales/[token]`.
- Gates: `tsc --noEmit` + vitest + **`npm run build`** (RSC/client-boundary dependency change).

## Migration / compatibility notes

- Removing `variant` and `defaultOpen` is a breaking prop change; every current call site is updated in the same phase that removes them (Phase 1 for the type change + call-site cleanup, so the tree always compiles).
- `KeywordProfileCard.test.tsx`, `BrokenLinksSection.test.tsx`, `ScoreExplanation.test.tsx`, `AdaScoreExplanation.test.tsx` reference the Explainer and must be updated.
