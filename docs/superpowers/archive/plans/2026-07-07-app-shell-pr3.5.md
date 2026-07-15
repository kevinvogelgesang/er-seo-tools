# A8 PR 3.5 — Aggregate Homepage Widgets (KPI strip + Needs attention) — Implementation Plan

**Date:** 2026-07-07 · **Spec:** `docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md` §3.3 (the two "3.5" table rows, lines 150–151) + §8
**Tracker item:** A8 (app-shell redesign), PR 3.5 of the phasing in spec §8
**Branch:** `feat/app-shell-pr3.5` (worktree, based on `origin/main` @ `e6a4387`)
**Class:** Feature + UI change (dark-mode variants + no-hydration-mismatch required) + two new cookie-gated API routes
**Codex review:** applied — ACCEPT-WITH-NAMED-FIXES, fixes 1–7 folded in below (verified: `DashboardGrid.test.tsx:43` hard-codes `WIDGETS.length===7`; `EMPTY_SERIES` exported at `scorecard-shared.ts:35`; `StatusPill` `error`=red / `warning`=amber). Verdict was accept, not rewrite.

## What ships

The two aggregate widgets deferred from PR 2 (spec §3.3, "verified data sources only",
Codex fixes 4+9), now that their data path is verified end to end (Task 0 below):

- **KPI strip** — four fleet-wide numbers: active scans, avg ADA, avg SEO, open criticals.
  Sizes `wide, xl`; default `xl` (full-width banner).
- **Needs attention** — the worst movers: clients ranked by score drop / open criticals.
  Sizes `sm, lg`; default `lg`. `sm` = top 3, `lg` = top 8 with score deltas (spec §3.3).

Both are registered in `lib/widgets/registry.tsx` exactly like the other 7 widgets and
participate in the PR 3 editor (resize / reorder / persistence) for free.

## Key architecture decision — client widgets + API routes, NOT server components (code > spec)

The spec (§3.3, §4, §6) describes these as "server-component loaders". **The shipped
code contradicts that** and code wins (explicit trust ranking):

- `lib/widgets/registry.tsx` imports every widget `Component` and is imported by
  `use-home-layout.ts` → `DashboardGrid` (`'use client'`). Every registered widget is
  therefore in the **client** bundle. `DashboardGrid` renders `<Body size={item.size}/>`
  with only a `size` prop — there is no seam to inject server-fetched data.
- All 7 existing widgets are `'use client'` and fetch their data from an `/api/*` route
  in an effect / shared poller (`RecentParsesWidget` → `/api/parse/history`, `LiveNowWidget`
  → `/api/site-audit/queue`). A server component cannot be placed in the registry without
  breaking the client graph.

**Therefore PR 3.5 = two `'use client'` widgets + two new GET routes + two thin server
loaders.** The "server-side loader" the spec's gate demands is real — it runs server-side
in the route handler and in the `lib/services/` loader — just reached over `fetch`, exactly
like the other 7 widgets. This is a documented deviation from the spec's *wording*, not
from any "Do not" rule or hard gate; recorded here for Codex + Kevin.

## Task 0 — Loader verification (GATE — already satisfied, no code)

Spec §3.3 + §8 hard gate: do not build widget UI until the B1/B2 loaders are proven to
exist and return the needed shape. **Done this session** (Explore sweep of `lib/services/`,
`lib/findings/`, `app/api/`, `docs/`). Findings:

**Exists — reuse directly (no new DB queries, no blob reads, no schema change):**

- **B1 fleet loader** `getClientFleet(now?: Date): Promise<FleetRow[]>` —
  `lib/services/client-fleet.ts:41`. One row per non-archived client. `FleetRow`
  (`client-fleet.ts:15-30`) carries everything both widgets need:
  ```ts
  interface FleetRow {
    id: number; name: string; firstDomain: string | null
    seo: ScoreSeries; ada: ScoreSeries      // ScoreSeries.latest / .previous / .delta
    adaSource: AdaSeriesSource
    pillarScore: number | null; pillarAt: string | null
    lastActivityAt: string | null
    alerts: ClientAlert[]                    // {kind:'score-drop'|'error'|'stale'|'regression', detail}
    openCritical: number | null             // distinct open critical issue TYPES, current runs
    openWarning: number | null
  }
  ```
  `ScoreSeries.delta` (`scorecard-shared.ts:21-33`) = `latest - previous`, **null** if <2
  points or the score formula changed across the pair — this is the worst-movers signal,
  already formula-boundary-safe.
- **Queue** `getQueueStatus(): Promise<QueueStatusWithBatch>` — `lib/ada-audit/queue-manager.ts`.
  Returns `{ active: {…}|null, queued: {…}[], batch }`. One-active-slot model, so
  **active scans = `(active ? 1 : 0) + queued.length`**.
- Scores come from **`CrawlRun.score`** (canonical; `SiteAudit.score` is never persisted).
  `getClientFleet` already reads through `CrawlRun.score` via the `scorecard-shared`
  builders — no blob reads. Consistent with the documented rule.

**Does NOT exist — must build (Tasks 1–2, thin pure reductions over `getClientFleet()`):**

1. A fleet-wide KPI aggregator (`{ activeScans, avgAda, avgSeo, openCriticals }`).
2. A cross-client worst-movers ranker. (`getClientFindings` is per-`clientId` only; the
   `FleetTable` sort logic that proves the data ranks cleanly lives client-side and is not
   reusable.)

**Gate result: PASS — build proceeds; the missing pieces are pure functions over verified data.**

## Architecture

```
lib/services/fleet-aggregates.ts        NEW — pure helpers + thin async wrappers
  computeFleetKpi(fleet, queue) → FleetKpi                 (pure, unit-tested directly)
  rankNeedsAttention(fleet, limit) → NeedsAttentionRow[]   (pure, unit-tested directly)
  getFleetKpi(now?) → FleetKpi              (fetch getClientFleet + getQueueStatus, delegate)
  getNeedsAttention(now?) → NeedsAttentionRow[]  (fetch getClientFleet, delegate)

app/api/fleet/kpi/route.ts               NEW — GET, withRoute, force-dynamic
app/api/fleet/needs-attention/route.ts   NEW — GET, withRoute, force-dynamic

components/widgets/KpiStripWidget.tsx     NEW — 'use client', fetch /api/fleet/kpi
components/widgets/NeedsAttentionWidget.tsx NEW — 'use client', fetch /api/fleet/needs-attention

lib/widgets/registry.tsx                  EDIT — +2 WIDGETS entries, +2 DEFAULT_LAYOUT slots
lib/widgets/registry.test.tsx             EDIT — flip the "does NOT register" guard to positive
```

Both routes are cookie-gated automatically: `middleware.ts` default-denies every non-public
path (matcher `/api/:path*`), and `/api/fleet/*` is **not** in `isPublicPath`. No
`isPublicPath` entry and no `middleware.test.ts` case are required (those are only for new
public / token-authed routes). Task 3 adds a defensive assertion anyway.

### Types

```ts
// lib/services/fleet-aggregates.ts
export interface FleetKpi {
  activeScans: number | null   // null iff the queue sub-fetch failed (fault-isolated from fleet)
  avgAda: number | null        // mean of non-null FleetRow.ada.latest, rounded; null if none
  avgSeo: number | null        // mean of non-null FleetRow.seo.latest, rounded; null if none
  openCriticals: number        // Σ (FleetRow.openCritical ?? 0)
}

export interface NeedsAttentionRow {
  clientId: number
  name: string
  firstDomain: string | null
  score: number | null         // headline score for the ranked metric (see rules)
  delta: number | null         // the drop that ranks it (negative), or null
  metric: 'seo' | 'ada' | null // which score score/delta refer to
  openCritical: number         // FleetRow.openCritical ?? 0
  topAlert: string | null      // alerts[0]?.detail — one-line "why"
}
```

### `rankNeedsAttention` rules (deterministic — the spine of Task 2's tests)

For each `FleetRow`:
- `worstDelta` = the most-negative of `{seo.delta, ada.delta}` counting only non-null
  values; `null` if both are null.
- **Include** the row iff `(worstDelta != null && worstDelta < 0)` **OR** `openCritical > 0`
  **OR** `alerts.length > 0`. (A client with no scores, no criticals, no alerts is fine —
  excluded.)
- **`alertPriority`** (Codex fix 4) = `max` over `alerts` of `{ error:3, regression:2,
  'score-drop':1, stale:0 }` (0 when no alerts). Ensures an `error`-alert client sorts above
  a `stale`-only client when neither has a negative delta or criticals — otherwise "Needs
  attention" would order two alert-only rows by name alone, which is surprising.
- **Sort** (total order → deterministic tests), each key breaking the previous tie:
  1. `worstDelta` ascending, treating `null`/≥0 as `0` (real drops first).
  2. `openCritical` **descending**.
  3. `alertPriority` **descending** (Codex fix 4).
  4. `name` ascending.
  5. `clientId` ascending — **final, guaranteed-unique** tie-break (Codex fix 2; client names
     are NOT unique and `getClientFleet` only orders by name, so without this duplicate-named
     clients rank nondeterministically).
- **Metric/score/delta:** if `worstDelta` came from `seo` → `metric:'seo'`, `score:seo.latest`,
  `delta:seo.delta`; if from `ada` → the ada trio; else (included only via criticals/alerts,
  no negative delta) → `score: seo.latest ?? ada.latest`, `delta:null`,
  `metric: seo.latest!=null ? 'seo' : ada.latest!=null ? 'ada' : null`.
  **Tie (Codex fix 3):** when `seo.delta === ada.delta` and both are the (negative) `worstDelta`,
  **SEO wins** — `metric:'seo'`, SEO score/delta. (Deterministic, and matches the SEO-first
  fallback used above.)
- Return the whole ranked array (routes cap at 12; widgets slice by size). Loader does NOT
  cap — keeps the pure function's contract simple and total-order-testable.

### `computeFleetKpi` rules

- `avgAda` = round(mean of `fleet.map(r => r.ada.latest).filter(non-null)`), `null` if empty.
  `avgSeo` likewise off `r.seo.latest`.
- `openCriticals` = `Σ (r.openCritical ?? 0)`.
- `activeScans` = `queue == null ? null : (queue.active ? 1 : 0) + queue.queued.length`.
  `getFleetKpi` wraps the `getQueueStatus()` call in try/catch → passes `null` on failure so a
  queue hiccup never blanks the (fleet-derived) scores.

## Tasks (TDD — failing test first, then implementation, per task)

Test-run prefix throughout: `DATABASE_URL="file:./local-dev.db"`.
The pure helpers (`computeFleetKpi`, `rankNeedsAttention`) are tested **directly with
hand-built `FleetRow[]` fixtures — no prisma, no mocking** (house pattern: `layout.ts`,
`scoreLiveSeo`). The async wrappers are trivial fetch+delegate and covered by the route tests.

**Fixture construction (Codex fix 5):** `FleetRow.seo`/`.ada` are full `ScoreSeries`
objects (`latest`, `previous`, `delta`, `formulaChanged`, `latestAt`, `points`). Build them
from the exported `EMPTY_SERIES` (`lib/services/scorecard-shared.ts:35`) —
`{ ...EMPTY_SERIES, latest: 80, delta: -12 }` — so fixtures stay concise and type-safe as
`ScoreSeries` evolves. A small local `fleetRow(partial)` helper in the test keeps the other
`FleetRow` fields (id/name/firstDomain/openCritical/alerts/…) filled with sane defaults.

### Task 1 — `computeFleetKpi` (pure) + `getFleetKpi` wrapper

1. Write `lib/services/fleet-aggregates.test.ts` covering `computeFleetKpi`:
   - averages ignore null `latest`; rounding to nearest int; empty fleet → both avgs null,
     `openCriticals` 0.
   - `openCriticals` sums `openCritical ?? 0` (null rows contribute 0).
   - `activeScans`: `queue=null` → null; `active` present + N queued → `1+N`; no active,
     0 queued → 0.
   - Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/fleet-aggregates.test.ts` → RED.
2. Implement `computeFleetKpi(fleet, queue)` + `getFleetKpi(now?)` (imports `getClientFleet`,
   `getQueueStatus`; try/catch around the queue call). Types `FleetKpi` exported. → GREEN.

### Task 2 — `rankNeedsAttention` (pure) + `getNeedsAttention` wrapper

1. Extend `fleet-aggregates.test.ts` for `rankNeedsAttention`:
   - a clean client (no delta, no criticals, no alerts) is excluded.
   - clients with negative seo/ada delta sort most-negative-first; `worstDelta` picks the
     worse of the two metrics and drives `metric`/`score`/`delta`.
   - inclusion via `openCritical>0` with no negative delta → `delta:null`,
     `metric` from whichever `latest` is non-null, sorted after real droppers.
   - inclusion via `alerts.length>0` only → included, `topAlert` = `alerts[0].detail`.
   - **alert-priority ordering (Codex fix 4):** two alert-only rows (no negative delta, no
     criticals) — one with an `error` alert, one with `stale` — the `error` row sorts first.
   - **metric tie (Codex fix 3):** a row with `seo.delta === ada.delta < 0` → `metric:'seo'`,
     SEO score/delta.
   - **tie-break chain:** equal `worstDelta` → higher `openCritical` first → higher
     `alertPriority` → name asc → **`clientId` asc (Codex fix 2):** two rows identical on every
     prior key incl. an identical `name` rank in `clientId` order, deterministically.
   - `limit` arg slices (spot-check) — though routes pass the full list; keep `limit`
     optional defaulting to a large number so the loader returns all.
   - RED, then GREEN.
2. Implement `rankNeedsAttention(fleet, limit=Infinity)` + `getNeedsAttention(now?)`.

### Task 3 — API routes

1. `app/api/fleet/kpi/route.test.ts` + `app/api/fleet/needs-attention/route.test.ts`,
   mocking the loader (`vi.mock('@/lib/services/fleet-aggregates')`): assert `GET()` → 200
   with the exact JSON shape, and that a loader throw surfaces as the `withRoute` 500 envelope
   (`internal_error`, no message leak). needs-attention route caps at 12.
   - Also add one assertion in the existing `middleware.test.ts` (or a small new case) that
     `isPublicPath('/api/fleet/kpi') === false` and `isPublicPath('/api/fleet/needs-attention')
     === false` — defensive, proves the fleet data stays cookie-gated. RED.
2. Implement both routes: `export const dynamic = 'force-dynamic'`, `export const GET =
   withRoute(async () => NextResponse.json(await getFleetKpi()))` (and the needs-attention
   equivalent, `.slice(0,12)`). Confirm the `withRoute` GET-with-no-args signature matches
   `lib/api/with-route.ts` (adjust to the handler shape it expects). → GREEN.

### Task 4 — `KpiStripWidget`

1. `components/widgets/KpiStripWidget.test.tsx` (jsdom, mock `fetch` — mirror
   `RecentParsesWidget.test.tsx`): loading → error ("Couldn't load…") → data renders 4
   labelled numbers → null avg renders "—" not "0" → **queue-failure fault isolation
   (Codex fix 7):** API data with `activeScans:null` renders "—" for active scans while
   `avgAda`, `avgSeo`, and `openCriticals` still render their numbers (pins the
   fault-isolation contract in an automated test, not just Task 8's manual check). RED.
2. Implement `'use client'` widget: fetch `/api/fleet/kpi` once in an effect
   (`live` cleanup flag, `!r.ok` → throw → error state). Render 4 stat tiles:
   `grid grid-cols-2 gap-3` at `wide`, `md:grid-cols-4` at `xl` (widget reads `size`).
   Each tile: uppercase micro-label + big `font-display` number; `avgAda`/`avgSeo`/`activeScans`
   null → "—". **Dark-mode classes on every element** (`text-navy dark:text-white`,
   `bg-white dark:bg-navy-card` etc.). All Tailwind classes are literals in `components/**`
   (already in the content globs) — **no dynamic class strings in `lib/`; do not reintroduce
   the PR-2 purge**. → GREEN.

### Task 5 — `NeedsAttentionWidget`

1. `components/widgets/NeedsAttentionWidget.test.tsx`: loading / error / empty
   ("All clear — no clients need attention.") / data (rows render name + score + a **red**
   delta chip when `delta<0`); `sm` shows 3 rows, `lg` shows 8. RED.
2. Implement `'use client'` widget: fetch `/api/fleet/needs-attention` once; `limit = size==='sm'
   ? 3 : 8`; each row = `ScoreRing(score)` + name (+ firstDomain muted) + delta chip
   (**negative delta → `StatusPill tone="error"` (red) — Codex fix 6; `warning` is amber,
   which would misread as a mild state**) + `openCritical` count when >0, wrapped in
   `<Link href={`/clients/${clientId}`}>`. `topAlert` as the row's subtitle at `lg`.
   Dark-mode on every element. → GREEN.

### Task 6 — Registry wiring

1. Edit `lib/widgets/registry.test.tsx`: replace the `does NOT register deferred aggregate
   widgets (PR 3.5)` test with a positive one asserting `kpi-strip` and `needs-attention` ARE
   registered with the expected sizes; existing shape/uniqueness/default-layout tests stay
   (they now cover the new entries). RED (the delete-old assertion flips it).
   **Also update `components/widgets/DashboardGrid.test.tsx` (Codex fix 1):** it hard-codes
   `expect(WIDGETS.length).toBe(7)` at line ~43 — bump to `toBe(9)` (or, better, drop the exact
   count and assert the two new titles render). Its heading-order tests map over `DEFAULT_LAYOUT`
   dynamically, so they keep passing; only the literal count assertion breaks.
2. Edit `lib/widgets/registry.tsx`:
   - `import { KpiStripWidget } from '@/components/widgets/KpiStripWidget'` and the
     needs-attention import.
   - Append to `WIDGETS`:
     ```ts
     { id: 'kpi-strip', title: 'Fleet at a glance', sizes: ['wide','xl'], defaultSize: 'xl', Component: KpiStripWidget },
     { id: 'needs-attention', title: 'Needs attention', sizes: ['sm','lg'], defaultSize: 'lg', Component: NeedsAttentionWidget },
     ```
   - `DEFAULT_LAYOUT`: put `{ id:'kpi-strip', size:'xl' }` **first** (full-width banner), then
     keep `live-now`, insert `{ id:'needs-attention', size:'lg' }` after it, then the rest.
   - Update the header comment (drop "deliberately absent — loaders unverified"). → GREEN.

   **Existing-browser note (documented, acceptable v1):** a browser with a stored
   `er-home-layout` gets the two new ids **appended at the end** at default size
   (`normalizeLayout` appends registry-missing widgets) — the KPI strip won't be top-of-page
   for existing users until they hit "Reset layout". Fresh browsers get the new DEFAULT order.
   No version bump (a bump would wipe everyone's customizations for a purely additive change).

### Task 7 — Gates + PR

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
All green. Then push `feat/app-shell-pr3.5`, open the PR with `gh`.

### Task 8 — Merge + deploy + prod verification (rule 1)

- Merge once gates are re-confirmed green in this session.
- `ssh $PROD_SSH "~/deploy.sh"`.
- **Real authed-browser verification via Playwright** (Kevin logs the browser in — the PR 3
  session proved a size bug slips past server-side health checks):
  - homepage renders the KPI strip with four real numbers and Needs-attention with live
    client rows (or their correct empty/degraded states);
  - **0 console errors, 0 hydration warnings** (`useSyncExternalStore`/effect-fetch pattern
    means server + first-paint markup is the stable loading state — assert no mismatch);
  - **fault isolation:** confirm a degraded widget shows its "Couldn't load…" card and does
    **not** blank the grid (the KPI tile with `activeScans:null` shows "—", scores still render);
  - tile **sizes** are correct at desktop widths (KPI strip spans full width at `lg:` — measure
    `col-span-4`, don't eyeball; this is the exact class the PR-2 purge silently dropped).

### Task 9 — Docs ritual (hard gate 2, SAME commit as the ship)

- Tick the A8 PR 3.5 status in `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`
  + append a dated status-log line.
- Rewrite `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` — next item = **A8 PR 4+**
  (per-tool polish passes, spec §8 PR 4).
- `git mv` this plan → `docs/superpowers/archive/plans/`. The spec stays in `specs/` (still
  active through PR 4).
- End the final chat reply with the handoff's "Paste this into a new chat" prompt in a code block.

## Out of scope / deferred

- Polling: both widgets **fetch once** on mount (aggregate snapshots; `LiveNowWidget` already
  owns the live 5s queue view). No shared poller for these in v1.
- No caching: each dashboard load runs `getClientFleet()` up to twice (once per widget). At
  ~30 clients / fixed 6-query fleet load this is comfortably inside SQLite; a short TTL memo is
  a future optimization, not v1.
- No DB persistence of layout (A7), no mobile edit (desktop-only, unchanged from PR 3).
