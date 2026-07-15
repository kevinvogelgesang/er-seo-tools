# Dashboard Tiles v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove two low-value homepage tiles, make every remaining tile render well across its full sensible size range, and add a new sortable + paginated Clients tile.

**Architecture:** The A8 widget system is a localStorage-persisted registry (`lib/widgets/registry.tsx` → `WIDGETS` + `DEFAULT_LAYOUT`) of `'use client'` tiles that each take a `{ size }` prop and self-fetch. Removals self-heal via `normalizeLayout`'s unknown-id drop; the new tile appends via the additive contract; widening `sizes[]` never invalidates a stored size — so **no `LAYOUT_VERSION` bump**. The Clients tile reuses `getClientFleet()` behind a new thin authed `GET /api/fleet/clients`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind (class-based dark mode), Vitest (jsdom for components, no jest-dom), Prisma/SQLite (untouched — no migration).

**Spec:** `docs/superpowers/specs/2026-07-08-dashboard-tiles-v2-design.md` (Codex-reviewed, accept-with-fixes; fixes applied).

## Global Constraints

- **Keep `WidgetSize = 'sm' | 'wide' | 'lg' | 'xl'`** — no rename, no `LAYOUT_VERSION` bump (stays `1`).
- **No schema migration**; persistence stays `localStorage` key `er-home-layout`.
- **No new query shapes or scoring logic** — Clients tile calls `getClientFleet()` verbatim. (It DOES add a third fleet computation per dashboard render — measure in prod, §8 of spec.)
- **UI class rules:** `dark:` variant on every element; no JS viewport reads (hydration-safe); any new Tailwind class must be reachable by content globs (incl. `./lib/**`).
- **Tests:** this repo has **NO jest-dom** — use `.getAttribute()` / `.toBeTruthy()` / `queryByText(...) === null` / `container.querySelector(...)`; jsdom test files start with `// @vitest-environment jsdom`.
- **Gates (all three, green) before PR:** `npx tsc --noEmit` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.
- **Overflow / bounded-scroll contract (Codex #6, revised after plan review):** the grid rows are `auto-rows-[minmax(190px,auto)]` — the `auto` *maximum* means a tile **grows to fit its content at every breakpoint** (the pre-existing PR 3.5 behavior; nothing clips). So `h-full overflow-auto` alone does NOT create a definite max-height and does NOT force internal scrolling — the tile just gets taller. Two consequences: (a) multi-row bodies still use `min-h-0 flex-1 overflow-auto` inside a flex column so that IF a height bound applies they scroll and never clip; (b) **a class assertion cannot prove scrolling** — real internal-scroll verification is browser-only (`scrollHeight > clientHeight` at mobile/md/lg, spec §8). The correctness bar for these tasks is "content never clips and long lists are capped," not "the tile is a fixed height." (If Kevin later wants fixed-height compact tiles, that's a follow-up requiring bounded grid tracks — out of scope here.)

## File structure

| File | Responsibility | Task |
|---|---|---|
| `lib/widgets/layout.ts` | export `ALL_SIZES` | 1 |
| `lib/widgets/registry.tsx` | remove 2 tiles, add `clients`, widen `sizes[]` | 2,5,6,7,8,9 |
| `components/widgets/QuickRobotsWidget.tsx` + test | **delete** | 2 |
| `components/widgets/QuarterWeekWidget.tsx` + test | **delete** | 2 |
| `lib/services/fleet-clients.ts` (+ test) | `FleetClientRow`, `mapFleetClients` (pure), `getFleetClients` | 3 |
| `app/api/fleet/clients/route.ts` (+ test) | authed GET | 3 |
| `middleware.test.ts` | add `/api/fleet/clients` to protected table | 3 |
| `lib/widgets/clients-sort.ts` (+ test) | `ClientSortKey`, `sortClients` (pure) | 4 |
| `components/widgets/ClientsWidget.tsx` (+ test) | 4-size Clients tile | 5 |
| `lib/widgets/layout.test.ts` | registry-evolution test | 2 (removals), 5 (clients-last) |
| `lib/widgets/registry.test.tsx` | invariants + id/count | 1,2,5 |
| `components/widgets/{KpiStrip,LiveNow,NeedsAttention,RecentParses,QuickSiteAudit,QuickParser,QuickReport}Widget.tsx` (+ tests) | size expansion + bounded scroll | 6,7,8,9 |

---

### Task 1: Export `ALL_SIZES` + registry invariant test

**Files:**
- Modify: `lib/widgets/layout.ts:16`
- Modify/Create test: `lib/widgets/registry.test.tsx`

**Interfaces:**
- Produces: `export const ALL_SIZES: readonly WidgetSize[]` (used by the registry test + later size assertions).

> NOTE (Codex): `registry.test.tsx` ALREADY imports `WIDGETS`/`DEFAULT_LAYOUT` and already tests `defaultSize ∈ sizes` + unique ids. Do NOT duplicate those. This task only *exports* `ALL_SIZES` and adds the one missing invariant (`sizes[] ⊆ ALL_SIZES`) to the existing `describe('widget registry', …)` block.

- [ ] **Step 1: Write the failing test** — add ONE `it` inside the existing `describe('widget registry', …)` in `lib/widgets/registry.test.tsx`, and add `ALL_SIZES` to the existing top import if you import from layout (or import it fresh):

```ts
import { ALL_SIZES } from './layout'
// …inside describe('widget registry', …):
it('every declared size is a member of ALL_SIZES', () => {
  for (const w of WIDGETS) for (const s of w.sizes) expect(ALL_SIZES.includes(s)).toBe(true)
})
```

- [ ] **Step 2: Run it — expect FAIL** (`ALL_SIZES` not exported):

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/widgets/registry.test.tsx`
Expected: FAIL — `ALL_SIZES` is not exported from `layout.ts`.

- [ ] **Step 3: Export `ALL_SIZES`** — in `lib/widgets/layout.ts` change line 16:

```ts
export const ALL_SIZES: readonly WidgetSize[] = ['sm', 'wide', 'lg', 'xl']
```

- [ ] **Step 4: Run it — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/widgets/registry.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/widgets/layout.ts lib/widgets/registry.test.tsx
git commit -m "refactor(widgets): export ALL_SIZES + add registry invariant tests"
```

---

### Task 2: Remove robots + quarter-grid tiles

**Files:**
- Modify: `lib/widgets/registry.tsx` (remove 2 imports, 2 `WIDGETS` entries, 2 `DEFAULT_LAYOUT` entries)
- Delete: `components/widgets/QuickRobotsWidget.tsx`, `QuickRobotsWidget.test.tsx`, `QuarterWeekWidget.tsx`, `QuarterWeekWidget.test.tsx`
- Create: `lib/widgets/registry-evolution.test.tsx` (real-registry stored-layout evolution — kept OUT of `layout.test.ts`, which deliberately uses local fixtures named `WIDGETS`/`DEFAULT_LAYOUT` and must not import `registry.tsx`)
- Modify test: `components/widgets/DashboardGrid.test.tsx:43` (`WIDGETS.length).toBe(9)` → `7`); and any id assertions referencing the removed ids in `registry.test.tsx` / `use-home-layout.test.tsx` (grep first — likely none)

**Interfaces:**
- Consumes: `normalizeLayout`, `loadLayout` from Task 0 baseline.
- Produces: registry with 7 widgets (`kpi-strip`, `live-now`, `needs-attention`, `quick-site-audit`, `quick-parser`, `quick-report`, `recent-parses`).

- [ ] **Step 1: Confirm no other importers** before deleting:

Run: `grep -rn "QuickRobotsWidget\|QuarterWeekWidget" app components lib`
Expected: only `registry.tsx` + the two component/test files. If anything else references them, stop and reassess.

- [ ] **Step 2: Write the failing evolution test** — create `lib/widgets/registry-evolution.test.tsx` (NEW file — real registry + real layout fns):

```ts
// lib/widgets/registry-evolution.test.tsx
import { describe, it, expect } from 'vitest'
import { loadLayout, serializeLayout, LAYOUT_VERSION } from './layout'
import { WIDGETS, DEFAULT_LAYOUT } from './registry'

const meta = WIDGETS.map((w) => ({ id: w.id, sizes: w.sizes, defaultSize: w.defaultSize }))

describe('stored-layout evolution across the v2 removals', () => {
  it('drops removed ids and keeps surviving order + sizes (no version bump)', () => {
    const oldRaw = serializeLayout([
      { id: 'quick-robots', size: 'sm' },
      { id: 'recent-parses', size: 'sm' },   // survivor with a NON-default stored size
      { id: 'quarter-week', size: 'wide' },
      { id: 'live-now', size: 'sm' },         // survivor, non-default
    ])
    const result = loadLayout(oldRaw, meta, DEFAULT_LAYOUT)
    const ids = result.map((i) => i.id)
    expect(ids).not.toContain('quick-robots')
    expect(ids).not.toContain('quarter-week')
    expect(result.find((i) => i.id === 'recent-parses')?.size).toBe('sm')
    expect(result.find((i) => i.id === 'live-now')?.size).toBe('sm')
    expect(LAYOUT_VERSION).toBe(1)
  })
})
```

- [ ] **Step 3: Run it — expect FAIL** (removed ids still registered, so `quick-robots`/`quarter-week` survive):

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/widgets/registry-evolution.test.tsx`
Expected: FAIL — `ids` still contains the removed ids.

- [ ] **Step 4: Remove the two tiles from `registry.tsx`** — delete these lines:
  - imports: `import { QuarterWeekWidget } ...` and `import { QuickRobotsWidget } ...`
  - `WIDGETS` entries for `quarter-week` and `quick-robots`
  - `DEFAULT_LAYOUT` entries for `quarter-week` and `quick-robots`

- [ ] **Step 5: Delete the widget + test files**

```bash
git rm components/widgets/QuickRobotsWidget.tsx components/widgets/QuickRobotsWidget.test.tsx \
       components/widgets/QuarterWeekWidget.tsx components/widgets/QuarterWeekWidget.test.tsx
```

- [ ] **Step 6: Fix count/id assertions.** Confirmed target: `components/widgets/DashboardGrid.test.tsx:43` — change `expect(WIDGETS.length).toBe(9)` → `toBe(7)`. Then grep for any lingering references and fix them: `grep -rn "quick-robots\|quarter-week\|toBe(9)" lib components`. (`registry.test.tsx`'s exact-size assertions for `kpi-strip`/`needs-attention` are NOT touched by removals — they change in Tasks 6/7.)

- [ ] **Step 7: Run the full widget suite — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/widgets components/widgets`
Expected: PASS (evolution test green; no references to removed ids).

- [ ] **Step 8: Commit**

```bash
git add -A lib/widgets components/widgets
git commit -m "feat(dashboard): remove robots.txt + quarter-grid tiles (self-heal via unknown-id drop)"
```

---

### Task 3: Clients backend — mapper, service, route, middleware test

**Files:**
- Create: `lib/services/fleet-clients.ts`
- Create: `lib/services/fleet-clients.test.ts`
- Create: `app/api/fleet/clients/route.ts`
- Create: `app/api/fleet/clients/route.test.ts`
- Modify: `middleware.test.ts`

**Interfaces:**
- Consumes: `getClientFleet(now?): Promise<FleetRow[]>` from `lib/services/client-fleet.ts`; `FleetRow` fields `{ id, name, firstDomain, seo: {latest,delta,…}, ada: {latest,delta,…}, adaSource, pillarScore, openCritical, openWarning, lastActivityAt, alerts: {kind,detail}[] }`; `withRoute` from `lib/api/with-route.ts`.
- Produces: `FleetClientRow`, `mapFleetClients(fleet): FleetClientRow[]`, `getFleetClients(now?): Promise<FleetClientRow[]>`; `GET` at `/api/fleet/clients`.

- [ ] **Step 1: Write the failing mapper test** — `lib/services/fleet-clients.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapFleetClients } from './fleet-clients'
import type { FleetRow } from './client-fleet'

// ScoreSeries requires `formulaChanged: boolean` (scorecard-shared.ts) — include it (Codex).
const row = (over: Partial<FleetRow> = {}): FleetRow => ({
  id: 1, name: 'Acme', firstDomain: 'acme.edu',
  seo: { latest: 72, previous: 70, delta: 2, formulaChanged: false, latestAt: '2026-07-01', points: [] },
  ada: { latest: 88, previous: 90, delta: -2, formulaChanged: false, latestAt: '2026-07-01', points: [] },
  adaSource: 'page', pillarScore: 7, pillarAt: null, lastActivityAt: '2026-07-01',
  alerts: [{ kind: 'score-drop', detail: 'SEO −8' }], openCritical: 2, openWarning: 1,
  ...over,
})

describe('mapFleetClients', () => {
  it('narrows ScoreSeries to {latest,delta} and nests adaSource into ada.source', () => {
    const [m] = mapFleetClients([row()])
    expect(m.seo).toEqual({ latest: 72, delta: 2 })
    expect(m.ada).toEqual({ latest: 88, delta: -2, source: 'page' })
    // no leaked series fields
    expect((m.seo as Record<string, unknown>).points).toBeUndefined()
    expect((m as Record<string, unknown>).adaSource).toBeUndefined()
  })
  it('passes through id/name/domain/pillar/issues/alerts/activity', () => {
    const [m] = mapFleetClients([row()])
    expect(m).toMatchObject({
      id: 1, name: 'Acme', firstDomain: 'acme.edu', pillarScore: 7,
      openCritical: 2, openWarning: 1, lastActivityAt: '2026-07-01',
      alerts: [{ kind: 'score-drop', detail: 'SEO −8' }],
    })
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (module missing):

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/fleet-clients.test.ts`
Expected: FAIL — cannot find `./fleet-clients`.

- [ ] **Step 3: Implement `lib/services/fleet-clients.ts`**:

```ts
// lib/services/fleet-clients.ts
// Client-safe fleet roster for the homepage Clients tile. Pure mapper over the
// same getClientFleet() the /clients page + KPI/Needs-attention widgets use — no
// new query shapes, no scoring. This module DOES import server code
// (getClientFleet); the client widget only imports `FleetClientRow` via
// `import type` (erased at build), so no server code is bundled client-side —
// exactly how NeedsAttentionWidget consumes NeedsAttentionRow from fleet-aggregates.
import { getClientFleet, type FleetRow } from './client-fleet'

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

export function mapFleetClients(fleet: FleetRow[]): FleetClientRow[] {
  return fleet.map((r) => ({
    id: r.id,
    name: r.name,
    firstDomain: r.firstDomain,
    seo: { latest: r.seo.latest, delta: r.seo.delta },
    ada: { latest: r.ada.latest, delta: r.ada.delta, source: r.adaSource },
    pillarScore: r.pillarScore,
    openCritical: r.openCritical,
    openWarning: r.openWarning,
    lastActivityAt: r.lastActivityAt,
    alerts: r.alerts.map((a) => ({ kind: a.kind, detail: a.detail })),
  }))
}

export async function getFleetClients(now: Date = new Date()): Promise<FleetClientRow[]> {
  return mapFleetClients(await getClientFleet(now))
}
```

- [ ] **Step 4: Run mapper test — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/fleet-clients.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test** — `app/api/fleet/clients/route.test.ts` (mirror `app/api/fleet/kpi/route.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/services/fleet-clients', () => ({ getFleetClients: vi.fn() }))
import { getFleetClients } from '@/lib/services/fleet-clients'
import { GET } from './route'

const mockGet = vi.mocked(getFleetClients)
beforeEach(() => { mockGet.mockReset() })

describe('GET /api/fleet/clients', () => {
  it('200s with the loader payload', async () => {
    const rows = [{ id: 1, name: 'Acme', firstDomain: 'acme.edu', seo: { latest: 72, delta: 2 }, ada: { latest: 88, delta: -2, source: 'page' }, pillarScore: 7, openCritical: 2, openWarning: 1, lastActivityAt: '2026-07-01', alerts: [] }]
    mockGet.mockResolvedValue(rows as never)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(rows)
  })
  it('surfaces a loader throw as the withRoute 500 envelope (no leak)', async () => {
    mockGet.mockImplementation(async () => { throw new Error('db exploded') })
    const res = await GET()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toEqual({ error: 'internal_error' })
    expect(JSON.stringify(json)).not.toContain('db exploded')
  })
})
```

- [ ] **Step 6: Run it — expect FAIL** (route missing).

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/fleet/clients/route.test.ts`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 7: Implement `app/api/fleet/clients/route.ts`**:

```ts
// app/api/fleet/clients/route.ts
// Homepage Clients-tile roster. Cookie-gated by middleware omission (NOT in
// isPublicPath) — returns client PII (names/domains/scores/alerts).
import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { getFleetClients } from '@/lib/services/fleet-clients'

export const dynamic = 'force-dynamic'

export const GET = withRoute(async () => {
  return NextResponse.json(await getFleetClients())
})
```

- [ ] **Step 8: Add the middleware protected-path regression case (Codex #3)** — in `middleware.test.ts`, find the protected `/api/fleet/*` cases (near line 64) and add `/api/fleet/clients` to whatever list/loop asserts unauthenticated requests are redirected/401'd. Mirror the exact assertion style already used for `/api/fleet/kpi`.

- [ ] **Step 9: Run route + middleware tests — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/fleet/clients/route.test.ts middleware.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/services/fleet-clients.ts lib/services/fleet-clients.test.ts app/api/fleet/clients middleware.test.ts
git commit -m "feat(fleet): add authed GET /api/fleet/clients + FleetClientRow mapper"
```

---

### Task 4: Clients sort helper (pure)

**Files:**
- Create: `lib/widgets/clients-sort.ts`
- Create: `lib/widgets/clients-sort.test.ts`

**Interfaces:**
- Consumes: `FleetClientRow` (type-only) from Task 3.
- Produces: `type ClientSortKey = 'default'|'name'|'seo'|'ada'|'issues'`; `sortClients(rows, key, asc): FleetClientRow[]`.

- [ ] **Step 1: Write the failing test** — `lib/widgets/clients-sort.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sortClients } from './clients-sort'
import type { FleetClientRow } from '@/lib/services/fleet-clients'

const r = (over: Partial<FleetClientRow>): FleetClientRow => ({
  id: 0, name: 'x', firstDomain: null, seo: { latest: null, delta: null },
  ada: { latest: null, delta: null, source: null }, pillarScore: null,
  openCritical: 0, openWarning: 0, lastActivityAt: null, alerts: [], ...over,
})

describe('sortClients', () => {
  const rows = [
    r({ id: 1, name: 'Bravo', seo: { latest: 60, delta: 0 }, alerts: [] }),
    r({ id: 2, name: 'Alpha', seo: { latest: 90, delta: 0 }, alerts: [{ kind: 'error', detail: '' }] }),
    r({ id: 3, name: 'Cedar', seo: { latest: null, delta: null }, openCritical: 5 }),
  ]
  it('default: most alerts first, then name', () => {
    expect(sortClients(rows, 'default', false).map((x) => x.id)).toEqual([2, 1, 3])
  })
  it('seo desc by default, nulls last', () => {
    expect(sortClients(rows, 'seo', false).map((x) => x.id)).toEqual([2, 1, 3])
  })
  it('name sorts A→Z (localeCompare) regardless of the asc flag base', () => {
    expect(sortClients(rows, 'name', false).map((x) => x.id)).toEqual([2, 1, 3]) // Alpha,Bravo,Cedar
  })
  it('ada desc by default, nulls last', () => {
    const r2 = [
      r({ id: 1, ada: { latest: 40, delta: null, source: null } }),
      r({ id: 2, ada: { latest: 95, delta: null, source: null } }),
      r({ id: 3, ada: { latest: null, delta: null, source: null } }),
    ]
    expect(sortClients(r2, 'ada', false).map((x) => x.id)).toEqual([2, 1, 3])
  })
  it('issues sorts by openCritical then openWarning, desc', () => {
    const r2 = [
      r({ id: 1, openCritical: 1, openWarning: 9 }),
      r({ id: 2, openCritical: 5, openWarning: 0 }),
      r({ id: 3, openCritical: 1, openWarning: 2 }),
    ]
    expect(sortClients(r2, 'issues', false).map((x) => x.id)).toEqual([2, 1, 3])
  })
  it('asc flips a keyed sort', () => {
    expect(sortClients(rows, 'seo', true).map((x) => x.id)).toEqual([3, 1, 2])
  })
  it('does not mutate the input array', () => {
    const copy = [...rows]
    sortClients(rows, 'name', false)
    expect(rows).toEqual(copy)
  })
})

// NOTE (Codex): like FleetTable, the header ↑/↓ arrow is a toggle indicator
// (reflects the last click's asc flip), not an absolute-direction claim — name's
// base order is A→Z while numeric keys' base is descending. This matches the
// shipped /clients FleetTable UX intentionally; not a bug.
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/widgets/clients-sort.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/widgets/clients-sort.ts`** (mirrors `FleetTable` sort semantics):

```ts
// lib/widgets/clients-sort.ts
// Pure sort for the Clients tile's xl table. Mirrors FleetTable's sort switch so
// the tile and the /clients page rank identically. Returns a NEW array.
import type { FleetClientRow } from '@/lib/services/fleet-clients'

export type ClientSortKey = 'default' | 'name' | 'seo' | 'ada' | 'issues'

const num = (v: number | null) => (v === null ? -1 : v)

export function sortClients(rows: FleetClientRow[], key: ClientSortKey, asc: boolean): FleetClientRow[] {
  const copy = [...rows]
  switch (key) {
    case 'name': copy.sort((a, b) => a.name.localeCompare(b.name)); break
    case 'seo': copy.sort((a, b) => num(b.seo.latest) - num(a.seo.latest)); break
    case 'ada': copy.sort((a, b) => num(b.ada.latest) - num(a.ada.latest)); break
    case 'issues': copy.sort((a, b) => num(b.openCritical) - num(a.openCritical) || num(b.openWarning) - num(a.openWarning)); break
    default: copy.sort((a, b) => b.alerts.length - a.alerts.length || a.name.localeCompare(b.name))
  }
  if (asc && key !== 'default') copy.reverse()
  return copy
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/widgets/clients-sort.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/widgets/clients-sort.ts lib/widgets/clients-sort.test.ts
git commit -m "feat(widgets): pure sortClients helper for the Clients tile"
```

---

### Task 5: ClientsWidget component + registration + clients-last evolution test

**Files:**
- Create: `components/widgets/ClientsWidget.tsx`
- Create: `components/widgets/ClientsWidget.test.tsx`
- Modify: `lib/widgets/registry.tsx` (import + `WIDGETS` entry + `DEFAULT_LAYOUT` placement)
- Modify: `lib/widgets/layout.test.ts` (extend evolution test: `clients` appended last)
- Modify: `lib/widgets/registry.test.tsx` (widget count 7 → 8)

**Interfaces:**
- Consumes: `FleetClientRow` (type) from Task 3; `sortClients`, `ClientSortKey` from Task 4; `GET /api/fleet/clients`; `ScoreRing`, `StatusPill` from `components/ui/`; `WidgetSize`.
- Produces: `ClientsWidget({ size })`; registry id `clients`.

- [ ] **Step 1: Write the failing component test** — `components/widgets/ClientsWidget.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { ClientsWidget } from './ClientsWidget'

const rows = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1, name: `Client ${String.fromCharCode(65 + i)}`, firstDomain: `c${i}.edu`,
  seo: { latest: 50 + i, delta: 0 }, ada: { latest: 60 + i, delta: 0, source: 'site' as const },
  pillarScore: null, openCritical: i % 3, openWarning: 0, lastActivityAt: null, alerts: [],
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => rows })) as never)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const clientLinks = (c: HTMLElement) => c.querySelectorAll('a[href^="/clients/"]')

describe('ClientsWidget', () => {
  it('sm shows the client count as a number (not a ScoreRing)', async () => {
    const { container } = render(<ClientsWidget size="sm" />)
    await waitFor(() => expect(container.textContent).toContain('14'))
    // the sm headline is plain text, not an SVG ring
    expect(container.querySelector('svg')).toBeNull()
  })
  it('wide caps the list at 5 rows', async () => {
    const { container } = render(<ClientsWidget size="wide" />)
    await waitFor(() => expect(clientLinks(container).length).toBeGreaterThan(0))
    expect(clientLinks(container).length).toBe(5)
  })
  it('lg caps the list at exactly 10 rows (14 available)', async () => {
    const { container } = render(<ClientsWidget size="lg" />)
    await waitFor(() => expect(clientLinks(container).length).toBeGreaterThan(0))
    expect(clientLinks(container).length).toBe(10)
  })
  it('xl paginates: 8 rows on page 1, Next advances', async () => {
    const { container } = render(<ClientsWidget size="xl" />)
    await waitFor(() => expect(container.querySelector('table')).toBeTruthy())
    expect(container.querySelectorAll('tbody tr').length).toBe(8) // PAGE size
    expect(container.textContent).toContain('page 1 of 2')
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(container.textContent).toContain('page 2 of 2'))
    expect(container.querySelectorAll('tbody tr').length).toBe(6) // 14 - 8
  })
  it('xl sort header toggles order (Client A→Z then Z→A)', async () => {
    const { container } = render(<ClientsWidget size="xl" />)
    await waitFor(() => expect(container.querySelector('table')).toBeTruthy())
    const firstName = () => container.querySelector('tbody tr a')?.textContent
    const clientHeaderBtn = container.querySelectorAll('th button')[0] as HTMLElement
    fireEvent.click(clientHeaderBtn) // name asc (A…)
    const asc = firstName()
    fireEvent.click(clientHeaderBtn) // name desc (…)
    expect(firstName()).not.toBe(asc)
  })
  it('xl renders the Alerts column header', async () => {
    const { container } = render(<ClientsWidget size="xl" />)
    await waitFor(() => expect(container.querySelector('table')).toBeTruthy())
    expect(container.textContent).toContain('Alerts')
  })
  it('lists a scroll container (smoke check only — real scroll verified in-browser, §8)', async () => {
    const { container } = render(<ClientsWidget size="lg" />)
    await waitFor(() => expect(container.querySelector('.overflow-auto')).toBeTruthy())
  })
  it('fetch error shows the error copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as never)
    const { container } = render(<ClientsWidget size="lg" />)
    await waitFor(() => expect(container.textContent).toContain("Couldn't load clients"))
  })
  it('empty state links to add a client', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })) as never)
    const { container } = render(<ClientsWidget size="lg" />)
    await waitFor(() => expect(container.querySelector('a[href="/clients/manage"]')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/widgets/ClientsWidget.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `components/widgets/ClientsWidget.tsx`**:

```tsx
// components/widgets/ClientsWidget.tsx
// A8 dashboard tiles v2 — fleet roster with per-client health. Client widget,
// fetches /api/fleet/clients once. sm = count; wide = top 5; lg = scrollable list
// of ~10; xl = sortable + paginated compact table. Bounded scroll on every
// multi-row body (Codex #6): the tile collapses to one row below the lg breakpoint.
'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { StatusPill } from '@/components/ui/StatusPill'
import { sortClients, type ClientSortKey } from '@/lib/widgets/clients-sort'
import type { FleetClientRow } from '@/lib/services/fleet-clients'
import type { WidgetSize } from '@/lib/widgets/types'

const muted = 'text-[13px] font-body text-gray-400 dark:text-white/40'
const PAGE = 8

export function ClientsWidget({ size }: { size: WidgetSize }) {
  const [rows, setRows] = useState<FleetClientRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/fleet/clients')
      .then((r) => { if (!r.ok) throw new Error(`status ${r.status}`); return r.json() })
      .then((d: unknown) => { if (live) setRows(Array.isArray(d) ? (d as FleetClientRow[]) : []) })
      .catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [])

  if (error) return <p className={muted}>Couldn&apos;t load clients.</p>
  if (!rows) return <p className={muted}>Loading…</p>
  if (rows.length === 0) {
    return (
      <p className="flex h-full items-center text-[14px] font-body text-gray-500 dark:text-white/60">
        No clients yet —{' '}
        <Link href="/clients/manage" className="ml-1 font-semibold text-orange hover:underline">add one →</Link>
      </p>
    )
  }

  const needAttention = rows.filter((r) => r.alerts.length > 0 || (r.openCritical ?? 0) > 0).length

  if (size === 'sm') {
    return (
      <Link href="/clients" className="flex h-full flex-col justify-center">
        <span className="font-display text-[40px] font-extrabold leading-none text-navy dark:text-white tabular-nums">
          {rows.length}
        </span>
        <span className="mt-1 text-[12px] font-body text-gray-500 dark:text-white/50">
          clients · {needAttention} need attention
        </span>
      </Link>
    )
  }

  if (size === 'xl') return <ClientsTable rows={rows} />

  // wide + lg: alerts-first list (wide = 5, lg = 10). Shows SEO (ring) + ADA
  // (number) + crit/warn pills + an alert pill when the client has alerts.
  const limit = size === 'wide' ? 5 : 10
  const list = sortClients(rows, 'default', false).slice(0, limit)
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 min-h-0 space-y-2 overflow-auto">
        {list.map((r) => (
          <li key={r.id}>
            <Link href={`/clients/${r.id}`} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-gray-50 dark:hover:bg-white/5">
              <ScoreRing score={r.seo.latest} size={size === 'wide' ? 34 : 40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[13px] font-semibold text-navy dark:text-white">{r.name}</p>
                {r.firstDomain && <p className="truncate text-[11px] font-body text-gray-400 dark:text-white/40">{r.firstDomain}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-[11px] font-body tabular-nums text-gray-500 dark:text-white/50">
                  ADA {r.ada.latest ?? '—'}
                </span>
                {r.alerts.length > 0 && <StatusPill label={r.alerts[0].kind === 'score-drop' ? 'drop' : r.alerts[0].kind} tone={r.alerts[0].kind === 'error' ? 'error' : 'warning'} />}
                {(r.openCritical ?? 0) > 0 && <StatusPill label={`${r.openCritical} crit`} tone="error" />}
                {(r.openWarning ?? 0) > 0 && <StatusPill label={`${r.openWarning} warn`} tone="warning" />}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/clients" className="mt-2 shrink-0 text-[12px] font-body font-semibold text-orange hover:underline">
        View all {rows.length} clients →
      </Link>
    </div>
  )
}

function ClientsTable({ rows }: { rows: FleetClientRow[] }) {
  const [key, setKey] = useState<ClientSortKey>('default')
  const [asc, setAsc] = useState(false)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => sortClients(rows, key, asc), [rows, key, asc])
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE))
  const clamped = Math.min(page, pages - 1)
  const slice = sorted.slice(clamped * PAGE, clamped * PAGE + PAGE)

  function clickSort(k: ClientSortKey) {
    if (k === key) setAsc(!asc)
    else { setKey(k); setAsc(false) }
    setPage(0)
  }

  const th = (label: string, k: ClientSortKey, right = false) => (
    <th className={`px-2 py-1.5 ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => clickSort(k)}
        className={`text-[11px] uppercase tracking-wide ${key === k ? 'text-orange' : 'text-gray-400 dark:text-white/40'} hover:text-orange`}>
        {label}{key === k ? (asc ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )
  const cell = (v: number | null) => v === null ? <span className="text-gray-300 dark:text-white/20">—</span> : <span className="font-semibold text-navy dark:text-white tabular-nums">{v}</span>

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-white dark:bg-navy-card">
            <tr className="border-b border-gray-100 dark:border-navy-border">
              {th('Client', 'name')}{th('SEO', 'seo', true)}{th('ADA', 'ada', true)}{th('Issues', 'issues', true)}
              <th className="px-2 py-1.5 text-left text-[11px] uppercase tracking-wide text-gray-400 dark:text-white/40">Alerts</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id} className="border-b border-gray-50 dark:border-navy-border/50 last:border-0 hover:bg-gray-50 dark:hover:bg-navy-light/40">
                <td className="px-2 py-1.5">
                  <Link href={`/clients/${r.id}`} className="font-semibold text-navy dark:text-white hover:text-orange">{r.name}</Link>
                  {r.firstDomain && <div className="text-[10px] text-gray-400 dark:text-white/40">{r.firstDomain}</div>}
                </td>
                <td className="px-2 py-1.5 text-right">{cell(r.seo.latest)}</td>
                <td className="px-2 py-1.5 text-right">{cell(r.ada.latest)}</td>
                <td className="px-2 py-1.5 text-right">
                  <span className="inline-flex gap-1 tabular-nums text-[10px] font-semibold">
                    <span className={`rounded px-1 py-0.5 ${(r.openCritical ?? 0) > 0 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`}>{r.openCritical ?? 0}C</span>
                    <span className={`rounded px-1 py-0.5 ${(r.openWarning ?? 0) > 0 ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`}>{r.openWarning ?? 0}W</span>
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {r.alerts.map((a, i) => (
                      <span key={i} title={a.detail} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-gray-600 dark:bg-white/10 dark:text-white/60">
                        {a.kind === 'score-drop' ? 'drop' : a.kind}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex shrink-0 items-center justify-between text-[11px] font-body text-gray-500 dark:text-white/50">
        <span>{sorted.length} clients</span>
        <span className="flex items-center gap-2">
          <button type="button" onClick={() => setPage(Math.max(0, clamped - 1))} disabled={clamped === 0}
            className="rounded px-2 py-0.5 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/10">Prev</button>
          <span>page {clamped + 1} of {pages}</span>
          <button type="button" onClick={() => setPage(Math.min(pages - 1, clamped + 1))} disabled={clamped >= pages - 1}
            className="rounded px-2 py-0.5 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/10">Next</button>
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Register in `registry.tsx`** — add the import, the `WIDGETS` entry, and the `DEFAULT_LAYOUT` placement (after `needs-attention`):

```tsx
import { ClientsWidget } from '@/components/widgets/ClientsWidget'
// in WIDGETS:
{ id: 'clients', title: 'Clients', sizes: ['sm', 'wide', 'lg', 'xl'], defaultSize: 'lg', Component: ClientsWidget },
// in DEFAULT_LAYOUT, immediately after { id: 'needs-attention', size: 'lg' }:
{ id: 'clients', size: 'lg' },
```

- [ ] **Step 5: Extend the evolution test** in `lib/widgets/registry-evolution.test.tsx` (the file created in Task 2). Model a COMPLETE pre-Clients stored layout — every registered widget EXCEPT `clients`, in registry order — so `clients` is the ONLY id `normalizeLayout` appends, which proves it lands last (Codex: the earlier 3-item fixture didn't prove this, because normalizeLayout appends ALL missing widgets):

```ts
it('appends only the new clients tile, and it lands LAST, at defaultSize', () => {
  // complete pre-clients layout = all current widgets minus clients, registry order
  const preClients = WIDGETS.filter((w) => w.id !== 'clients').map((w) => ({ id: w.id, size: w.defaultSize }))
  const result = loadLayout(serializeLayout(preClients), meta, DEFAULT_LAYOUT)
  const ids = result.map((i) => i.id)
  expect(ids[ids.length - 1]).toBe('clients')          // clients is last
  expect(result.filter((i) => i.id === 'clients')).toHaveLength(1)
  expect(result.find((i) => i.id === 'clients')?.size).toBe('lg')  // defaultSize
})
```

- [ ] **Step 6: Bump the widget count** — `components/widgets/DashboardGrid.test.tsx:43` (`WIDGETS.length).toBe(7)` from Task 2 → `toBe(8)`. (`registry.test.tsx` has no numeric count assertion.)

- [ ] **Step 7: Run the suite — expect PASS**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/widgets/ClientsWidget.test.tsx components/widgets/DashboardGrid.test.tsx lib/widgets`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/widgets/ClientsWidget.tsx components/widgets/ClientsWidget.test.tsx lib/widgets/registry.tsx lib/widgets/registry-evolution.test.tsx components/widgets/DashboardGrid.test.tsx
git commit -m "feat(dashboard): add Clients tile (sm count / wide+lg list / xl sortable+paginated table)"
```

---

### Task 6: kpi-strip — add `lg` size

**Files:**
- Modify: `lib/widgets/registry.tsx` (kpi-strip `sizes`)
- Modify test: `components/widgets/KpiStripWidget.test.tsx`

Note: the body already renders correctly at `lg` — its non-`xl` branch uses `grid-cols-2` (a 2×2 metric grid), which fits a 2×2 tile. Only the registry declaration needs widening.

- [ ] **Step 1: Write the failing test** — add to `KpiStripWidget.test.tsx` (jsdom): render at `size="lg"`, mock `fetch` to resolve KPI data, assert all four metric labels appear and the grid container renders (`container.querySelector('.grid')` truthy). Also assert the registry allows `lg`:

```ts
import { WIDGETS } from '@/lib/widgets/registry'
it('kpi-strip registry allows lg', () => {
  expect(WIDGETS.find((w) => w.id === 'kpi-strip')?.sizes).toContain('lg')
})
```

- [ ] **Step 2: Run — expect FAIL** (`sizes` lacks `lg`).

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/widgets/KpiStripWidget.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Widen sizes** in `registry.tsx`:

```tsx
{ id: 'kpi-strip', title: 'Fleet at a glance', sizes: ['wide', 'lg', 'xl'], defaultSize: 'xl', Component: KpiStripWidget },
```

- [ ] **Step 4: Update the existing exact-size assertion** — `registry.test.tsx` has `expect(kpi!.sizes).toEqual(['wide', 'xl'])` (in the "PR 3.5 aggregate widgets" test). Change it to `toEqual(['wide', 'lg', 'xl'])`.

- [ ] **Step 5: Run — expect PASS.**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/widgets/KpiStripWidget.test.tsx lib/widgets/registry.test.tsx`

- [ ] **Step 6: Commit** `git commit -am "feat(dashboard): kpi-strip supports lg size"`

---

### Task 7: needs-attention + recent-parses — full range + bounded scroll

**Files:**
- Modify: `lib/widgets/registry.tsx` (both `sizes`)
- Modify: `components/widgets/NeedsAttentionWidget.tsx`, `components/widgets/RecentParsesWidget.tsx`
- Modify tests: `NeedsAttentionWidget.test.tsx`, `RecentParsesWidget.test.tsx`

Both are lists; give per-size limits and fix the bounded-scroll bug (the root `<ul>` is `overflow-auto` but lacks `h-full`, so it grows instead of scrolling below `lg`).

- [ ] **Step 1: Write failing tests** — for each widget, render at `wide`, `lg`, `xl` with a mocked long list and assert: (a) row count increases with size (`sm` ≤ `wide` ≤ `lg` ≤ `xl`), (b) the scroll container has bounded-scroll classes (`container.querySelector('.h-full.overflow-auto')` truthy). Example limit assertion for needs-attention:

```ts
// with 15 mocked rows:
// sm → 3, wide → 5, lg → 8, xl → 12 visible <a href^="/clients/"> rows
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Update `NeedsAttentionWidget.tsx`** — replace the limit + root list:

```tsx
const limit = size === 'sm' ? 3 : size === 'wide' ? 5 : size === 'xl' ? 12 : 8
const detailed = size !== 'sm'
// root list: h-full min-h-0 so it scrolls inside WidgetFrame's min-h-0 flex-1
// body when a height bound applies; xl → two columns. NOTE the gap-y-2 — a bare
// `grid` with only gap-x leaves rows vertically flush (Codex).
const cols = size === 'xl' ? 'grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-2' : 'space-y-2'
return (
  <ul className={`h-full min-h-0 overflow-auto ${cols}`}>
    {/* existing <li> map, using limit */}
  </ul>
)
```

- [ ] **Step 4: Update `RecentParsesWidget.tsx`** identically — `const limit = size === 'sm' ? 3 : size === 'wide' ? 5 : size === 'xl' ? 12 : 8`; root `<ul className={\`h-full min-h-0 overflow-auto ${size === 'xl' ? 'grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-2' : 'space-y-2'}\`}>`; `ScoreRing` size `size === 'sm' ? 34 : 40`.

- [ ] **Step 5: Widen registry sizes:**

```tsx
{ id: 'needs-attention', title: 'Needs attention', sizes: ['sm', 'wide', 'lg', 'xl'], defaultSize: 'lg', Component: NeedsAttentionWidget },
{ id: 'recent-parses', title: 'Recent parses', sizes: ['sm', 'wide', 'lg', 'xl'], defaultSize: 'lg', Component: RecentParsesWidget },
```

- [ ] **Step 6: Update the existing exact-size assertion** — `registry.test.tsx` has `expect(needs!.sizes).toEqual(['sm', 'lg'])`. Change it to `toEqual(['sm', 'wide', 'lg', 'xl'])`.

- [ ] **Step 7: Run — expect PASS.**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/widgets/NeedsAttentionWidget.test.tsx components/widgets/RecentParsesWidget.test.tsx lib/widgets/registry.test.tsx`

- [ ] **Step 8: Commit** `git commit -am "feat(dashboard): needs-attention + recent-parses full size range + bounded scroll"`

---

### Task 8: live-now — add `xl` + bounded scroll

**Files:**
- Modify: `lib/widgets/registry.tsx` (live-now `sizes`)
- Modify: `components/widgets/LiveNowWidget.tsx`
- Modify test: `components/widgets/LiveNowWidget.test.tsx`

- [ ] **Step 1: Write failing test** — render at `xl` with a mocked active audit + long queue; assert more queued rows show than at `lg` (e.g. up to 12), and the queued `<ul>` has bounded-scroll classes (`min-h-0 flex-1 overflow-auto` — it sits inside the widget's own `flex h-full flex-col`). Also assert registry allows `xl`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Update `LiveNowWidget.tsx`** — the queued list slice becomes size-aware and the `<ul>` gets bounded scroll:

```tsx
const queuedLimit = size === 'xl' ? 12 : 6
// ...
{detailed && queued.length > 0 && (
  <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
    {queued.slice(0, queuedLimit).map((q) => ( /* existing <li> */ ))}
  </ul>
)}
```

- [ ] **Step 4: Widen registry sizes:**

```tsx
{ id: 'live-now', title: 'Live now', sizes: ['sm', 'wide', 'lg', 'xl'], defaultSize: 'lg', Component: LiveNowWidget },
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit** `git commit -am "feat(dashboard): live-now supports xl + bounded queued scroll"`

---

### Task 9: quick-action forms — add `lg` (site-audit + report only)

**Files:**
- Modify: `lib/widgets/registry.tsx` (two `sizes`)
- Modify tests: `QuickSiteAuditWidget.test.tsx`, `QuickReportWidget.test.tsx`

`QuickSiteAuditWidget` and `QuickReportWidget` need NO body change — each branches `size !== 'sm'` (covers `lg`) and uses `flex h-full flex-col` with a `mt-auto` submit button, so a 2×2 tile just gives more vertical breathing room. **`QuickParser` is intentionally NOT given `lg`** (Codex #7): its `DropZone` (`components/ui/DropZone.tsx`) has fixed `px-4 py-6` padding and no flex growth, so at `lg` it would be a short top-aligned dropzone in a big empty tile. It stays `['sm','wide']`. This matches the spec's "expand pragmatically" principle (documented exclusion). (If Kevin wants `lg` here later, `DropZone` needs a fill/min-height variant — separate change to a shared component.)

- [ ] **Step 1: Write failing tests** — for site-audit + report: assert the registry entry includes `lg`, and render at `size="lg"` asserting the widget renders (no throw) and shows its non-sm extra control (QuickSiteAudit shows the WCAG `<select>` when `intent==='ada'`; QuickReport shows the comparison `<select>`). Also add a guard test that quick-parser does NOT include lg:

```ts
it('quick-site-audit registry allows lg', () => {
  expect(WIDGETS.find((w) => w.id === 'quick-site-audit')?.sizes).toContain('lg')
})
it('quick-parser stays sm/wide (DropZone is fixed-height)', () => {
  expect(WIDGETS.find((w) => w.id === 'quick-parser')?.sizes).toEqual(['sm', 'wide'])
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Widen registry sizes (site-audit + report only; quick-parser unchanged):**

```tsx
{ id: 'quick-site-audit', title: 'Start a site audit', sizes: ['sm', 'wide', 'lg'], defaultSize: 'wide', Component: QuickSiteAuditWidget },
{ id: 'quick-parser', title: 'Parse a Screaming Frog export', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuickParserWidget },
{ id: 'quick-report', title: 'Generate a performance report', sizes: ['sm', 'wide', 'lg'], defaultSize: 'wide', Component: QuickReportWidget },
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** `git commit -am "feat(dashboard): site-audit + report forms support lg size"`

---

### Task 10: Final gates + PR

- [ ] **Step 1: Full gate run**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all three green. If `npm run build` reports an unused Tailwind class purge risk, confirm every new class (e.g. `lg:grid-cols-2`, `min-h-0`, `sticky`) is present in the built CSS.

- [ ] **Step 2: Manual dev smoke** — `npm run dev`, open the dashboard, verify: the two removed tiles are gone; the Clients tile renders; cycle its size sm→wide→lg→xl via Customize and confirm each renders; xl table sorts + paginates; resize the browser narrow (<1024px) and confirm the lg/xl lists + table scroll *inside* the tile.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/dashboard-tiles-v2
gh pr create --title "Dashboard tiles v2: remove 2 tiles, full-range sizing, Clients tile" --body "…"
```

Post-merge: `~/deploy.sh` then the prod verification in spec §8 (Playwright layout + mobile-collapse + fleet-latency measures).

---

## Final DEFAULT_LAYOUT (reference)

```tsx
export const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: 'kpi-strip', size: 'xl' },
  { id: 'live-now', size: 'lg' },
  { id: 'needs-attention', size: 'lg' },
  { id: 'clients', size: 'lg' },
  { id: 'quick-site-audit', size: 'wide' },
  { id: 'quick-parser', size: 'wide' },
  { id: 'quick-report', size: 'wide' },
  { id: 'recent-parses', size: 'lg' },
]
```

## Self-review notes

- **Spec coverage:** removals (Task 2), full-range sizing per §5 table (Tasks 6–9), Clients tile sm/wide/lg/xl (Task 5), API route + mapper (Task 3), sort helper (Task 4), no-version-bump evolution test (Tasks 2+5), `ALL_SIZES` export (Task 1), middleware test (Task 3), bounded-scroll Codex #6 (Tasks 5,7,8 + global constraint), mapper reshape test (Task 3). Prod perf/mobile measurement → spec §8 (not a code task).
- **Type consistency:** `FleetClientRow` (Task 3) is the single source consumed by `sortClients` (Task 4) and `ClientsWidget` (Task 5); `ClientSortKey` defined once in Task 4.
- **Deferred (spec §6.4):** combined `/api/fleet/dashboard` endpoint / fleet-load cache — only if §8 measurement shows regression. Not in this plan.
