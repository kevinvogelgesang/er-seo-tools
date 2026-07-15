# Dashboard Tiles v2 — design

**Date:** 2026-07-08
**Status:** draft (spec)
**Roadmap item:** A8 (app shell) — homepage widget follow-up
**Change class:** Feature / UI (multi-step). Migration-free. Adds one thin authed read API route.

## 1. Problem & goal

The A8 homepage widget system (PRs 1–3.5) shipped nine tiles with a working
size/edit/persist framework. Three follow-ups from Kevin (2026-07-08):

1. **Remove two low-value tiles** from the dashboard: *Check robots.txt*
   (`quick-robots`) and *Quarter Grid — this week* (`quarter-week`). Both are
   thin shortcuts to standalone tool pages that stay in the app.
2. **Develop every remaining tile to render well across its full *sensible*
   size range** (drawn from `sm / wide / lg / xl`). Today most widgets only
   *declare* one or two sizes and only branch content on `size === 'sm'` vs not.
   Users can already resize tiles, but many sizes are unavailable or render
   sparse/awkward. This is deliberately **not** "every tile offers all four" —
   each tile's supported set is chosen pragmatically and justified in §5 (e.g.
   KPI has no `sm`; the quick-action forms have no `xl`). (Decision: expand
   pragmatically, 2026-07-08.)
3. **Add a Clients tile** — a fleet roster with per-client health, sortable and
   paginated at large sizes, click-through to each client. This is the headline
   addition.

Goal: a denser, more useful, fully-resizable dashboard with a first-class
clients roster, with **zero behaviour change to any tool, no data/scoring change,
and no schema migration.**

## 2. Constraints & non-goals

- **Keep the existing size vocabulary** `WidgetSize = 'sm' | 'wide' | 'lg' | 'xl'`
  (Kevin's "med" = the existing `wide`). No rename — renaming would force a
  `LAYOUT_VERSION` bump that resets every user's saved layout for a purely
  cosmetic gain. (Decision: 2026-07-08.)
- **No `LAYOUT_VERSION` bump.** Removals self-heal via `normalizeLayout`'s
  unknown-id drop; the new tile appends at `defaultSize` via the additive-append
  contract (same pattern PR 3.5 used for `kpi-strip`/`needs-attention`). Widening
  a widget's `sizes[]` never invalidates a stored size (we only *add* sizes), so
  no reset is needed.
- **No new query *shapes* or scoring logic.** The clients tile reuses
  `getClientFleet()` verbatim (already the source for `/clients`, KPI strip, and
  Needs-attention) — no new query shapes, no blob reads, no scoring math. It does
  *not* mean zero extra DB work: `getClientFleet()` fires 6 broad `findMany`s +
  up to 2 findings queries per call, and the dashboard already invokes it twice
  (`/api/fleet/kpi` + `/api/fleet/needs-attention`). Adding `/api/fleet/clients`
  makes **three** independent fleet computations (~18–24 DB ops) on one dashboard
  render. Acceptable at ~30 clients but **must be measured** (see §8). If it
  regresses, the mitigation is a single combined fleet endpoint or a short-TTL
  server cache (deferred — see §6.4). (Codex #4.)
- **No schema migration.** Persistence stays `localStorage` (`er-home-layout`).
- **Tool pages are untouched.** `/robots-validator` and `/quarter-grid` (and
  their `components/quarter-grid/*`, `lib/quarter-grid/*`, `/api/quarter-plan`)
  remain; only the two *dashboard tiles* are removed.
- **Non-goals:** no drag/drop or edit-mode changes; no server-persisted layouts;
  no new StatusPill tones; no changes to `spanClass`/grid container (they already
  support all four sizes); no nav changes (`/clients` is already in the sidebar).

## 3. Current architecture (verified)

- **Page:** `app/(app)/page.tsx` → `<DashboardGrid />` (client), wrapped by
  `AppShell` which supplies the `bg-[#f4f6f9] dark:bg-navy-deep` canvas.
- **Registry (authoritative):** `lib/widgets/registry.tsx` exports `WIDGETS:
  WidgetDef[]` and `DEFAULT_LAYOUT: LayoutItem[]`.
- **Types:** `lib/widgets/types.ts` — `WidgetSize`, `LayoutItem`, `WidgetDef`
  (`{ id, title, sizes: WidgetSize[], defaultSize, Component: ({size}) => JSX }`).
- **Sizing:** `lib/widgets/grid.ts` `spanClass(size)` maps size → grid-span
  classes; grid container is `grid-cols-1 md:grid-cols-2 lg:grid-cols-4
  auto-rows-[minmax(190px,auto)]`. All four sizes already render — the gap is
  purely per-widget declaration + body rendering.
- **Layout logic:** `lib/widgets/layout.ts` — `normalizeLayout` (drops unknown
  ids, dedups, clamps invalid sizes to `defaultSize`, appends missing registered
  widgets at `defaultSize`), `loadLayout`, `cycleSize`, reducer. `LAYOUT_VERSION
  = 1`, `LAYOUT_STORAGE_KEY = 'er-home-layout'`.
- **Data:** `getClientFleet()` (`lib/services/client-fleet.ts`) → `FleetRow[]`
  (`{ id, name, firstDomain, seo: ScoreSeries, ada: ScoreSeries, adaSource,
  pillarScore, pillarAt, lastActivityAt, alerts, openCritical, openWarning }`).
  Existing fleet routes: `/api/fleet/kpi`, `/api/fleet/needs-attention` (both
  cookie-gated by middleware omission; thin `withRoute` wrappers). **No
  fleet-list route exists yet.**
- **Closest widget template:** `NeedsAttentionWidget.tsx` (score rings,
  per-size limits, loading/error/empty states, links to `/clients/:id`).
- **Sortable table reference:** `components/clients/FleetTable.tsx` (client-side
  sort switch over the same fleet shape).

## 4. Change 1 — remove two tiles

Edit `lib/widgets/registry.tsx`:
- Remove the `import` of `QuickRobotsWidget` and `QuarterWeekWidget`.
- Remove their `WIDGETS` entries (`quick-robots`, `quarter-week`).
- Remove their `DEFAULT_LAYOUT` entries.

Delete files:
- `components/widgets/QuickRobotsWidget.tsx` + `QuickRobotsWidget.test.tsx`
- `components/widgets/QuarterWeekWidget.tsx` + `QuarterWeekWidget.test.tsx`

Update tests that assert on ids/counts: `lib/widgets/registry.test.tsx`,
`lib/widgets/layout.test.ts`, `lib/widgets/use-home-layout.test.tsx`,
`components/widgets/DashboardGrid.test.tsx` (any that reference the removed ids
or a widget count).

**Stored-layout behaviour:** existing users' saved layouts containing
`quick-robots`/`quarter-week` self-heal on next load (`normalizeLayout` drops
unknown ids). No version bump.

**Dependency check:** `QuarterWeekWidget` imports `lib/quarter-grid/*` and fetches
`/api/quarter-plan`; those stay for the `/quarter-grid` page. `QuickRobotsWidget`
only `router.push`es `/robots-validator`. Removing the tiles leaves no dead code
in the tool pages. (Verify no other importer of the two widget components before
deletion: `grep -rn "QuickRobotsWidget\|QuarterWeekWidget" app components lib`.)

## 5. Change 2 — full-range sizing per tile

**Approach: expand pragmatically.** Each widget supports a sensible *range* and
must render well at every size it declares. A widget skips a size only where the
content would look broken; each range is justified below.

Final `sizes[]` (registry) after removals + addition:

| Widget | Today | New `sizes` | `defaultSize` | Rationale / per-size behaviour |
|---|---|---|---|---|
| `kpi-strip` | wide, xl | **wide, lg, xl** | xl | 4 KPI metrics. `sm` too cramped. wide = 2-across row; lg = 2×2 metric grid; xl = 4-across banner. |
| `live-now` | sm, wide, lg | **sm, wide, lg, xl** | lg | Queue list. sm = count + active title; wide = active + count; lg = active w/ progress + queued list; xl = same, wider, more queued rows visible. |
| `needs-attention` | sm, lg | **sm, wide, lg, xl** | lg | Worst-mover list scales cleanly. sm = top 3 (names + pills); wide = top 5; lg = top 8 w/ subtitle; xl = top ~12 in a 2-column list. |
| `recent-parses` | sm, lg | **sm, wide, lg, xl** | lg | Recent-parse list. Same list-scaling pattern as needs-attention. |
| `quick-site-audit` | sm, wide | **sm, wide, lg** | wide | Start-audit form. sm = compact (domain + go); wide = domain + WCAG level; lg = same with helper copy / more breathing room. `xl` would be mostly empty. |
| `quick-parser` | sm, wide | **sm, wide** (no lg) | wide | Dropzone. `DropZone` is fixed-height (`px-4 py-6`, no flex growth), so `lg`/`xl` would leave a short target in a big empty tile — stays sm/wide (Codex plan-review #7). A future `lg` needs a fill variant of the shared `DropZone`. |
| `quick-report` | sm, wide | **sm, wide, lg** | wide | Client-select + comparison form. Same reasoning as quick-site-audit. |
| `clients` (NEW) | — | **sm, wide, lg, xl** | lg | See §6. |

**Per-widget rendering contract:** every widget's body must (a) render without
overflow at each declared size, (b) fill available height sensibly (lists use
`overflow-auto`; forms center or top-align), and (c) keep dark-mode variants on
every element. No widget may read the viewport in JS (hydration-safe). Widening
`sizes[]` alone is insufficient — the component must branch content for the new
sizes it gains (e.g. `kpi-strip` currently has no `lg` layout; the list widgets
need `wide`/`xl` limits).

**Responsive-height caveat (Codex #6 — the load-bearing one).** `spanClass`
(`grid.ts`) only grants the *second* grid row (`lg:row-span-2`) at the `lg`
breakpoint (≥1024px); the extra *columns* also only apply at `md`/`lg`. Below
1024px, an `lg`/`xl` tile collapses to a **single** `auto-rows-[minmax(190px,auto)]`
row and a single column. So a widget designed for a 2×2 / 4×2 desktop footprint
gets ~one 190px row on tablet and mobile. Therefore every multi-row widget body
MUST be a **bounded flex column with its own `overflow-auto`** so its content
scrolls *inside* the tile at small breakpoints instead of overflowing or forcing
the tile taller than its row. `WidgetFrame` already sets `min-h-0`; each list/table
body adds `flex-1 min-h-0 overflow-auto`. Concretely: the Clients `xl` table and
`lg` list, `needs-attention` `xl`, `recent-parses` `xl`, and `live-now` `lg`/`xl`
must all scroll internally — verified at mobile (`<768`), `md` (`768–1023`), and
`lg` (`≥1024`), not just desktop tile widths.

**No stored-size invalidation:** we only add sizes, so every previously-stored
size remains in the new `sizes[]` → `normalizeLayout` never re-clamps. No version
bump.

## 6. Change 3 — Clients tile

### 6.1 Component
`components/widgets/ClientsWidget.tsx` (`'use client'`, `{ size }: { size:
WidgetSize }`). Modeled on `NeedsAttentionWidget` for the fetch/loading/error/
empty scaffolding; modeled on `FleetTable` for the sort logic at `xl`.

**Data:** fetch a new `GET /api/fleet/clients` once on mount (see §6.2). States:
loading (`Loading…`), error (`Couldn't load clients.`), empty (`No clients yet —
add one →` linking `/clients/manage`).

**Default sort** everywhere: alerts-first then name (matches `FleetTable`'s
`default` sort), so the most-actionable clients surface without interaction.

**Per-size rendering:**
- **sm (1×1):** total active-client count as a headline number + a one-line
  summary (`N need attention`, derived from rows with alerts or `openCritical > 0`).
  Whole tile links to `/clients`.
- **wide (2×1):** top 5 rows — name + `firstDomain` + compact SEO/ADA numbers +
  an alert/crit pill. Footer link "View all clients →" → `/clients`.
- **lg (2×2):** scrollable list of ~10 rows with `ScoreRing` (SEO score) + name +
  subtitle (firstDomain) + alert/crit `StatusPill`s (NeedsAttention layout, but
  all clients in default-sort order). Footer link.
- **xl (4×2):** compact **sortable + paginated** table. Columns: Client (name +
  domain), SEO, ADA, Issues (`C`/`W` chips like FleetTable), Alerts. Clickable
  sort headers (name/seo/ada/issues) reusing FleetTable's sort semantics;
  client-side pagination at 8 rows/page with prev/next + "page X of Y". Each row
  links to `/clients/:id`. This is the "sortable and paginated" ask.

**Primitive reuse:** `ScoreRing` (from `components/ui/`) only where the value is
an actual 0–100 score — the `lg` per-client list rows. The `sm` headline is a
**plain client *count*** (not a score) → render it as a large tabular number, NOT
a ScoreRing (Codex #7). `StatusPill` for alert/crit pills (existing tones only —
`error` for criticals/drops, `warning` for warnings). The xl table reuses
FleetTable's chip styling (small `C`/`W` badges) for density.

**Sort/pagination isolation:** implement a small pure sort helper inside the
widget (or a shared `lib/widgets/clients-sort.ts` mirroring FleetTable's switch)
so it is unit-testable without the DOM. Pagination is local `useState` page index
over the sorted array.

### 6.2 API route
`app/api/fleet/clients/route.ts` — `GET`, cookie-gated by middleware omission
(authed; **not** added to `isPublicPath`). The route returns client PII (names,
domains, scores, alert details), so it must stay authenticated — and we add it to
the `middleware.test.ts` protected-path regression table alongside the other
`/api/fleet/*` routes (Codex #3). The route unit test alone bypasses middleware,
so the middleware test is what actually guards the gate. Thin `withRoute` wrapper
mirroring `/api/fleet/kpi`:

```ts
export const dynamic = 'force-dynamic'
export const GET = withRoute(async () =>
  NextResponse.json(await getFleetClients()))
```

Add `getFleetClients()` to `lib/services/fleet-aggregates.ts` (or a small new
`fleet-clients.ts`) that calls `getClientFleet()` and maps each `FleetRow` to a
**client-safe row** (repo convention: widgets don't import server-only service
types). Suggested shape:

```ts
export interface FleetClientRow {
  id: number
  name: string
  firstDomain: string | null
  seo: { latest: number | null; delta: number | null }
  ada: { latest: number | null; delta: number | null; source: 'site' | 'page' | null }
  pillarScore: number | null
  openCritical: number | null
  openWarning: number | null
  lastActivityAt: string | null
  alerts: { kind: 'score-drop' | 'error' | 'stale' | 'regression'; detail: string }[]
}
```

The mapper is a pure function over `FleetRow[]` → `FleetClientRow[]` (unit-tested
directly, like `computeFleetKpi`/`rankNeedsAttention`). Note the deliberate
reshape: `FleetRow.adaSource` (top-level) is nested into `ada.source`, and the
verbose `ScoreSeries` (`{latest,previous,delta,latestAt,points}`) is narrowed to
`{latest,delta}` — the mapper test must assert this reshape explicitly (Codex —
verify list). Route test (`app/api/fleet/clients/route.test.ts`) mirrors the kpi
route test pattern (200 with payload; loader throw → `withRoute` 500 envelope, no
leak).

### 6.3 Registration & default placement
Register in `lib/widgets/registry.tsx`:
```ts
{ id: 'clients', title: 'Clients', sizes: ['sm','wide','lg','xl'], defaultSize: 'lg', Component: ClientsWidget }
```
`DEFAULT_LAYOUT`: place `clients` at `lg` immediately after `needs-attention`
(both are fleet-health surfaces), before the quick-start cards. New users get it
prominently; existing users get it appended at the end (defaultSize `lg`) until
they Reset — the additive-append contract. **No version bump.**

> Open decision for Kevin (non-blocking): default `clients` size — `lg` (balanced
> 2×2 list, recommended) vs `xl` (full sortable table up front, but two full-width
> banners with `kpi-strip`). Spec assumes `lg`; trivial to change.

### 6.4 Deferred: fleet-load consolidation
Three separate `/api/fleet/*` routes each recompute the full fleet (§2). We keep
three separate routes for this PR (a combined endpoint would force rewriting the
KPI + Needs-attention widgets, widening scope). If §8's measurement shows the
triple load regresses dashboard latency at production scale, the follow-up is
**one** combined `GET /api/fleet/dashboard` returning `{ kpi, needsAttention,
clients }` from a single `getClientFleet()` call, or a short-TTL server cache on
`getClientFleet()` (invalidation semantics TBD). Explicitly out of scope here;
recorded so the next session doesn't re-derive it. (Codex alt.)

## 7. Testing

No jest-dom in this repo — component tests use `.getAttribute()` /
`.toBeTruthy()` / `queryByText(...) === null` / `container.querySelector(...)`;
jsdom files start with `// @vitest-environment jsdom`.

- **Removals:** update `registry.test.tsx`, `layout.test.ts`,
  `use-home-layout.test.tsx`, `DashboardGrid.test.tsx` to the new id set/count;
  delete the two widget test files.
- **Registry-evolution test (Codex verify):** a `layout.test.ts` case that feeds
  a *realistic old v1 stored payload* — items containing both removed ids
  (`quick-robots`, `quarter-week`) and NOT containing `clients`, with a couple of
  reordered/resized survivors — through `loadLayout`/`normalizeLayout` and asserts:
  removed ids gone, survivors keep their order + stored sizes, `clients` appended
  last at `defaultSize`, `version` still 1. This is the real regression guard for
  the "no bump" decision.
- **`ALL_SIZES` visibility (Codex verify):** `ALL_SIZES` is currently *private* to
  `layout.ts` (line 16). The registry test that asserts `sizes[] ⊆ ALL_SIZES`
  either uses a local `['sm','wide','lg','xl']` literal or we `export ALL_SIZES`
  from `layout.ts`. Prefer exporting it (single source of truth) — a one-line,
  side-effect-free change.
- **Sizing:** for each widget that gains sizes, add/extend a jsdom test asserting
  it renders (no throw) and shows the size-appropriate content at each new size
  (e.g. row-count differences). Add a registry assertion that every widget's
  `defaultSize ∈ sizes` and every `sizes[] ⊆ ALL_SIZES`.
- **Sub-`lg` containment (Codex #6):** the list/table widgets' bodies must carry
  the bounded-scroll classes (`flex-1 min-h-0 overflow-auto`) — assert their
  presence via `container.querySelector` so the mobile/tablet single-row collapse
  scrolls internally rather than overflowing. (jsdom can't measure real layout;
  the class assertion is the proxy, and §8 measures the real thing in-browser.)
- **Clients tile:** pure sort + mapper unit tests (mapper test asserts the
  `adaSource → ada.source` nesting + `ScoreSeries → {latest,delta}` narrowing);
  jsdom component test for the four size branches (count-as-number at sm, row
  limits at wide/lg, sortable headers + pagination controls at xl,
  loading/error/empty states); route test for `/api/fleet/clients`; **add
  `/api/fleet/clients` to `middleware.test.ts`** protected-path table (Codex #3).
- **Gates:** `npx tsc --noEmit` + `DATABASE_URL="file:./local-dev.db" npm test` +
  `npm run build`. Any new Tailwind class must be reachable by the content globs.

## 8. Rollout / prod verification

- Migration-free, localStorage-only, additive API route — low risk.
- Post-deploy: drive the authed dashboard via Playwright and **measure layout**
  (getComputedStyle / element widths) at each tile size — A8 PR 2 shipped a
  purged-CSS width bug caught only by a real-browser width measure. Confirm the
  two removed tiles are gone, the clients tile renders at all four sizes, the xl
  table sorts + paginates, and `/api/fleet/clients` returns rows.
- **Measure the mobile/tablet collapse (Codex #6):** at viewport widths <768,
  768–1023, and ≥1024, confirm the `lg`/`xl` list + table bodies scroll *inside*
  the tile and don't overflow or force the tile taller than its grid row.
- **Measure the fleet-load cost (Codex #4):** with realistic client volume, record
  dashboard wall-clock + DB query count for one render (three `/api/fleet/*`
  calls). If it regresses vs the current two-call dashboard, trigger §6.4's
  consolidation follow-up. Capture the number in the tracker status line.
- (If the Playwright session is unauthenticated — Google-OAuth-only login — verify
  the public surface + prod CSS bundle for the new classes, measure the mobile
  collapse on a public page that reuses the widget CSS if possible, and flag the
  authed visual + fleet-latency spot-check for Kevin.)

## 9. Phasing (for the plan)

Cohesive enough for one PR, but naturally splits into independently-shippable
phases if preferred:
1. **Removals** — registry + delete two widgets + fix tests. (Smallest, safe.)
2. **Multi-size expansion** — per-widget size ranges + body rendering + tests.
3. **Clients tile** — mapper + `/api/fleet/clients` + `ClientsWidget` +
   registration + tests.

Recommendation: land as **one PR** ("dashboard tiles v2") since the pieces share
the registry and default layout, but the plan sequences the tasks so a split is
trivial if a phase needs to ship alone.
