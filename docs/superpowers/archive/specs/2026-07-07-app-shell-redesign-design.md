# App-Shell + Homepage Redesign ("Navy Command Deck") — Design

**Date:** 2026-07-07 · **Tracker:** A8 (absorbs A6) · **Status:** spec
**Decided by Kevin:** Direction A of two mockups (navy sidebar command deck);
incremental per-section PRs; dark mode retained; Guides under a "Reference"
group; mobile-first stays a priority; **full macOS-style widget system** on
the homepage (sizes + drag-to-reorder + persisted layout).

## 1. Goal

Make the webapp function as an **app**, not a website:

- Replace the top nav + dropdowns with a persistent **left sidebar** —
  grouped, collapsible to an icon rail, ER-brand navy.
- Replace the brochure homepage with a **quick-start dashboard**: every tool
  startable inline, and starting one drops the user into that tool's live
  flow (site audit → the live queue view; SF CSV drop → the parsing session;
  report → generation status).
- Overall design polish derived from enrollmentresources.com (navy
  `#1c2d4a` + orange `#f5a623` + Barlow — already in `tailwind.config.ts`)
  with an SEO-product spin; less "toolbox".

Reference shells: PostHog home, VirtualAdviser 6, HubSpot. Approved visual
direction: mockup A ("Navy Command Deck", 2026-07-07): dark navy gradient
sidebar, white/canvas content, orange reserved for active-nav notch +
primary CTAs, KPI row, quick-start cards, live-activity rail.

## 2. Non-goals

- No auth/user accounts (single shared cookie stays; "per-user" = per-browser).
- No SSE/live push — widgets poll existing endpoints; A5 upgrades transport later.
- No global "UI size" slider (browser zoom covers it; decided against 2026-07-07).
- No rewrite of inner tool pages in this effort's core phases — they are
  restyled incrementally (Phase 4) and keep their existing behavior.
- No new drag-and-drop dependency — native HTML5 DnD like Quarter Grid.

## 3. Architecture overview

Three new subsystems, shipped as separate PRs (see §8 phasing):

1. **Tools registry** (`lib/tools-registry.ts`) — the single data source for
   nav, homepage tool cards, and (later) the home-page search. Absorbs A6's
   "data-driven nav".
2. **App shell** (`components/shell/`) — sidebar + topbar layout mounted in
   `app/layout.tsx`, replacing `components/nav.tsx`.
3. **Widget system** (`components/widgets/` + `lib/widgets/`) — registry of
   homepage widgets, a CSS-grid dashboard with size variants and
   drag-to-reorder edit mode, layout persisted per browser.

### 3.1 Tools registry

```ts
interface ToolDef {
  id: string                 // 'site-audit', 'seo-parser', …
  name: string
  href: string
  group: 'overview' | 'run' | 'plan' | 'reference' | 'footer'
  icon: ComponentType        // inline SVG components, no icon lib
  description: string        // used on tool cards / search
  children?: { name: string; href: string }[]  // sub-links (queue, recents…)
}
```

Nav groups (Kevin-approved):

- **Overview:** Home, Clients
- **Run:** Site Audits, SEO Parser, SEO Reports, Robots Validator
- **Plan:** Quarter Grid, E-E-A-T Checklists
- **Reference:** RankMath Redirects, Oxygen Guide
- **Footer:** Settings (+ Admin/Ops link; cookie-gated route already)

### 3.2 App shell

- **Route-group split (Codex fix 1):** the shell must NOT wrap public
  routes. Restructure `app/` into route groups: `(app)/` gets the sidebar
  shell layout; `(public)/` (login, about, privacy, `share/*`,
  `/ada-audit/share/*`, `/ada-audit/site/share/*` — everything in
  `middleware.ts` `PUBLIC_PATH_PREFIXES`) keeps a minimal chrome-less
  layout. Root `app/layout.tsx` keeps only html/body/theme providers. The
  route-group membership must be asserted against `isPublicPath` in a test
  so the two can't drift.
- **Footer (Codex fix 2):** the global `Footer` moves to the `(public)`
  layout only; the app shell has no footer (the sidebar foot carries
  settings/collapse/version).
- `SidebarNav` (client component): groups from the registry; active item =
  orange left notch + subtle orange-tinted background (mockup A treatment);
  sub-links render as a nested list under the active tool (desktop expanded
  mode only).
- **Collapse:** button at the sidebar foot toggles a 248px ↔ 68px icon rail.
  **Anti-FOUC composition (Codex fix 3):** the existing prepaint script only
  sets `.dark` from `er-theme`; extend it into one combined pre-hydration
  script that also reads `localStorage('er-sidebar')`, validates the value
  (`'collapsed'` only; anything else → expanded), and stamps
  `data-sidebar="collapsed"` on `<html>`; the client component reads that
  attribute as its initial state so server/client markup agree (no
  hydration mismatch). Collapsed items get `title` tooltips.
- **Topbar:** page title (from route segment), quick-actions button (⌘K
  placeholder, wired later), "+ New scan" primary CTA, theme toggle,
  avatar. `ThemeToggle` moves here from the old nav. **Logout (Codex fix
  6):** the old nav's logout affordance is preserved — avatar menu with
  Logout, calling the existing logout route.
- **Mobile (<md):** sidebar becomes an off-canvas drawer (hamburger in a
  slim top bar), same registry data; body scroll locked while open;
  the drawer is the *same component* with a `variant` prop, not a fork.
- **Dark mode:** sidebar is navy in both themes (it already is the dark
  surface); canvas/cards follow the existing `dark:` token mapping.
- The old horizontal nav + dropdown code is deleted in the same PR that
  mounts the shell (no dual-nav period). **Sticky-offset audit (Codex fix
  7):** PR 1 includes a repo-wide scan for offsets keyed to the old nav
  height (`top-[60px]`, `top-[80px]`, sticky headers, `pt-*` on page
  roots) and fixes each against the new shell.

### 3.3 Widget system (homepage)

**Model.** A widget is a registered, self-contained card:

```ts
type WidgetSize = 'sm' | 'wide' | 'lg' | 'xl'
// sm = 1×1, wide = 2×1, lg = 2×2, xl = 4×2 (desktop grid units)

interface WidgetDef {
  id: string                        // 'live-now', 'quick-site-audit', …
  title: string
  sizes: WidgetSize[]               // which sizes this widget supports
  defaultSize: WidgetSize
  Component: ComponentType<{ size: WidgetSize }>
}
```

The **dashboard grid** is CSS grid, 4 columns on desktop (`lg:`), 2 on
tablet, 1 on mobile. Size → `grid-column/row span`. Widgets render more
data at larger sizes (the component receives `size` and decides: e.g.
"Needs attention" sm = top 3 clients, lg = 8 with score deltas; "Live now"
sm = count + one bar, wide/lg = full progress list).

**v1 widget set — verified data sources only (Codex fixes 4 + 9).** PR 2 is
deployable, so it ships ONLY widgets whose data source exists today and is
named exactly; aggregate widgets whose loaders don't exist yet are deferred
to PR 3.5 behind a loader-verification task:

| Widget | Sizes | Data source | PR |
|---|---|---|---|
| Quick start: Site Audit (domain + WCAG → Start) | sm, wide | POST `/api/site-audit` → `{id}` | 2 |
| Quick start: SEO Parser (CSV dropzone) | sm, wide | existing `/api/upload` session-create flow | 2 |
| Quick start: Performance Report (client + period) | sm, wide | POST `/api/reports` (all required fields incl. `comparisonMode` supplied by the widget) | 2 |
| Quick start: Robots Validator (URL) | sm | redirect to `/robots-validator?url=…` — **prefill/auto-run is NEW behavior** on that page (small param-read addition), not reuse | 2 |
| Live now (running/queued scans + progress) | sm, wide, lg | `/api/site-audit/queue` (5s poll, existing cadence) | 2 |
| Recent parses | sm, lg | `/api/parse/history` | 2 |
| Quarter Grid this week | sm, wide | `/api/quarter-plan` | 2 |
| KPI strip (active scans, avg ADA, avg SEO, open criticals) | wide, xl | server-component loader reusing the B1 client-fleet services — loader must be verified/built first | 3.5 |
| Needs attention (worst movers) | sm, lg | B2 findings/action-center services — same verification gate | 3.5 |

**Edit mode.** A "Customize" button toggles edit mode: widgets get a size
stepper (cycles supported sizes) and become draggable (native HTML5 DnD,
same pattern as Quarter Grid chips); drop reorders the layout array; grid
auto-flows. **Keyboard fallback (Codex fix 8):** edit mode also renders
move-up/move-down buttons on each widget so reordering never requires a
pointer (native DnD alone would regress keyboard accessibility). "Reset
layout" restores the default. No free-form x/y placement — **order + size
only**, grid auto-flow does the packing (this is what keeps mobile sane
and the editor simple).

**Persistence.** `localStorage('er-home-layout')`:
`{ version: 1, items: [{ id, size }] }` in display order. Per-browser is
per-person under the shared-cookie model. Unknown ids are dropped on load,
missing registered widgets are appended at default size (registry is
authoritative), malformed JSON → default layout. A `version` bump resets.
DB persistence is explicitly deferred until per-operator identity exists (A7).

**Mobile.** Single column, layout order preserved, every widget renders its
`sm` (or `wide` collapsed to full-width) presentation. Drag/edit mode is
desktop-only in v1; mobile gets the size/order chosen on desktop… of that
browser — acceptable for v1, noted limitation.

## 4. Quick-start → live-flow routing

The defining interaction: starting work from Home lands you *inside* the
running flow, never on a confirmation page.

Exact targets (Codex fix 5 — verified against `app/`):

- **Site audit:** POST `/api/site-audit` → `{ id }` → redirect to
  `/ada-audit/site/[id]` (the existing `SiteAuditPoller` progress/queue
  surface). Errors render inline in the widget (route error envelope).
- **SF parse:** hand the dropped files to the existing `/api/upload`
  session flow → redirect to `/seo-parser/results/[sessionId]`, which
  already shows parse state.
- **Report:** POST `/api/reports` with the full required body (client,
  period, `comparisonMode` — widget supplies sane defaults) → redirect to
  `/reports` with the new report highlighted (existing polling status row).
- **Robots:** client-side redirect to `/robots-validator?url=…`; the
  validator page gains a small param-read + auto-run on mount — the one
  piece of NEW page behavior in this section, scoped to that page.

Otherwise no new backend behavior; the widgets are thin clients of
existing routes.

## 5. Shared primitives (absorbs A6)

Extracted into `components/ui/` as they are needed by the shell/widgets,
then adopted opportunistically by tool pages in Phase 4: `StatusPill`,
`ScoreRing` (SVG, used by recents/fleet widgets), `Card`, `KpiTile`,
`DropZone`, `CopyButton`, `HistoryTable`. Rule: a primitive is extracted
the first time the redesign needs it, not speculatively.

## 6. Error handling & resilience

- Every widget is fault-isolated (same pattern as `loadOpsSnapshot`): a
  failed fetch renders a degraded card body, never blanks the dashboard.
- Layout load/save wrapped in try-catch (quota, malformed) → default layout.
- Quick-start POST failures surface the API error envelope message inline.
- Shell renders with zero data (nav is static registry data; topbar counts
  are best-effort).

## 7. Testing

- Registry: shape test (every tool has group/icon/href; hrefs resolve to
  real routes via a route-manifest check like the build already provides).
- Layout reducer (reorder, resize, reset, unknown-id drop, version bump):
  pure unit tests.
- Widget components: render tests per size incl. degraded/error state.
- Shell: collapse persistence, active-item detection, mobile drawer
  open/close, dark-mode class assertions.
- Quick-start widgets: mocked-fetch tests for POST → redirect target.
- Existing page tests must stay green (shell wraps, doesn't alter, pages).

## 8. Phasing (independent PRs, each gate-green + deployable)

1. **PR 1 — Registry + app shell:** route-group split (`(app)`/`(public)`),
   tools registry, sidebar (collapse, groups, mobile drawer), topbar with
   logout, footer moved to public layout, old nav deleted, sticky-offset
   audit. Homepage untouched (renders inside the shell).
2. **PR 2 — Dashboard v1 (fixed layout):** widget registry + grid + the
   verified-source widget set at default sizes; old homepage content
   deleted. No edit mode, no aggregate widgets.
3. **PR 3 — Widget editor:** sizes, drag-to-reorder + keyboard reorder,
   persistence, reset.
4. **PR 3.5 — Aggregate widgets:** KPI strip + Needs attention, each gated
   on verifying/building its server-side loader from the B1/B2 services.
5. **PR 4+ — Per-tool polish passes:** one PR per tool section (seo-parser,
   ada-audit, clients, reports, …) adopting `components/ui/` primitives and
   the deck visual language. Each independently shippable; adjust
   per-section as Kevin reviews (his stated preference).

Phases 1–3.5 ≈ the tracked 1.5–2 wks; Phase 4 is open-ended by design.

## 9. Risks / notes

- `app/layout.tsx` wraps every page: PR 1 must verify no page relies on the
  old nav's DOM (e.g. spacing against a fixed header) — audit `pt-*`
  offsets during implementation.
- Anti-FOUC: sidebar collapsed-state script must compose with the existing
  theme script (both mutate `<html>`/layout pre-hydration).
- Polling: multiple widgets polling the same endpoint should share one
  fetcher (simple module-level cache/interval) so Home doesn't multiply
  queue-poll load; cadence stays at existing rates.
- No new deps; icons are hand-inlined SVGs as in the mockup.
