# C9-B — ADA-Audit Frontend Consolidation (design)

**Date:** 2026-07-04 · **Status:** spec (Codex-reviewed) · **Track:** C9 (second half; C9-A ADA Scoring v2 shipped 2026-07-04, PR #97)
**Class:** UI refactor, near-zero-behavior-change · **Est:** 0.5–1 wk

## 1. Purpose & premise

C9-B is the "frontend consolidation" half of C9: remove the genuine, still-standing
duplication in the ADA-audit UI **without changing behavior**. Every existing test
must keep passing; the visible product is byte-identical.

**The original C9-B scope (handoff/tracker) is STALE.** A fresh code map (2026-07-04)
found most of the originally-listed work already done by earlier tracks:

| Original claim | Actual state in code | Verdict |
|---|---|---|
| Split `SiteAuditForm` — it embeds duplicate polling | Polling **already removed**; the queue poll now lives in `AuditIndexTabs` (`SiteAuditForm.tsx:78-79` comment; `AuditIndexTabs.tsx:50-51`). No `SiteAuditPoller` overlap remains. | **Out of scope** |
| Memoize grouped-violation derivations | Already extracted to `useGroupedViolations`; it is **effect-driven because it fan-out-fetches** `/api/ada-audit/[id]` per page — a `useMemo` is inapplicable, not missing. | **Out of scope** |
| Split `SiteAuditResultsView` into pieces shared with the share view | Share views (`app/ada-audit/share/[token]`, `app/ada-audit/site/share/[token]`) **already** reuse the main views as thin server wrappers (`readOnly` / `shareMode` props). Page bucketing/filter/sort already extracted + memoized in `useSiteAuditPages`. | **Largely done** |

What remains is three concrete, low-risk consolidations (below). This spec was
reviewed by Codex (verdict: *accept, with trimming discipline*), which trimmed
`AuditHeaderCard` out of the first pass and confirmed the `useAuditPoller` contract.

## 2. Scope

### In scope

1. **`useAuditPoller<T>` hook** — a generic interval-poll loop hook; both
   `AuditPoller` and `SiteAuditPoller` refactor onto it. Callback-only.
2. **Extract `PageRow`** — the ~172-LOC subcomponent currently inline inside
   `SiteAuditResultsView.tsx` (lines 48–219) moves to its own file `PageRow.tsx`.
3. **`useTriageMode(id, { enabled })` hook + `ArchivedAuditBanner` component** —
   the triage-mode localStorage read/write pair and the archived-audit amber
   banner, both currently hand-rolled in *both* `AuditResultsView` and
   `SiteAuditResultsView`, become one shared hook + one shared component.

### Explicitly out of scope (deferred, with reason)

- **`SiteAuditForm` (570 LOC) split** — cohesive form, no remaining duplication
  (polling already lifted out). Splitting is pure reorg across 3 POST flows +
  discovery confirmation + manual-URL mode = real behavior-regression surface,
  low clarity payoff. YAGNI.
- **`useGroupedViolations` memoization** — inapplicable (effectful fetch).
- **Shared `AuditHeaderCard`** — the two headers' actions/metadata differ
  materially (single: URL link/rescan/share/`readOnly`; site: domain/pages/errors/
  `shareMode`/scorecard-impact-click). A shared header risks becoming a prop-bag
  god-component. Deferred to an optional second pass; only pursue if a layout-only
  slot component provably stays small. Headers stay inline for now.
- **Normalizing `shareMode` vs `readOnly`** — they are NOT equivalent (see §6).
  Do not unify.

## 3. Unit 1 — `useAuditPoller<T>`

New file: `components/ada-audit/useAuditPoller.ts`.

### Contract

```ts
interface UseAuditPollerArgs<T> {
  url: string                          // endpoint to poll
  intervalMs: number                   // 1000 (single) / 3000 (site)
  initialStatus: string                // SSR status; if terminal, hook is inert
  enabled?: boolean                    // default true
  getStatus: (data: T) => string       // extract status from the poll response
  isTerminal: (status: string) => boolean  // caller-supplied terminal predicate
  onData: (data: T) => void            // called on every successful poll
  onTerminal?: (data: T) => void       // called once, on the terminal poll, before refresh
}
```

Returns `void`. The hook drives the loop; it does **not** own poller-specific UI
state and does **not** return the latest data (neither caller needs a return —
`SiteAuditPoller` fans data into many counters via `onData`; `AuditPoller` maps to
progress/message/status via `onData`).

### Behavior (must match current pollers exactly)

- **Terminal-on-mount:** if `isTerminal(initialStatus)` (or `enabled === false`),
  do nothing — no interval, no fetch, no `router.refresh()`. (Preserves current
  behavior: both pollers early-return when the initial status is terminal and never
  refresh in that case.)
- Poll `url` every `intervalMs` via `setInterval`.
- On a successful `res.ok` JSON response: call `onData(data)`.
- Compute `nextStatus = getStatus(data)`; if `isTerminal(nextStatus)`: clear the
  interval, call `onTerminal?.(data)`, then `router.refresh()`.
- On a non-`ok` response or a thrown fetch: swallow and keep polling (current
  "network blip" behavior).
- **`router.refresh()` fires exactly once** per hook instance — guarded by a ref
  (`refreshedRef`) so a StrictMode double-invoke or a late in-flight resolution
  can't double-fire.
- **Cleanup** clears the interval on unmount and ignores any stale in-flight work.
- The effect depends on `[url, intervalMs, status-tracking, router]` mirroring the
  current pollers' `[id, status, router]` dependency shape. Because the callers own
  `status` state and stop re-subscribing once terminal, the hook must observe the
  caller's current status (the caller passes `initialStatus` for the mount decision;
  the loop itself re-decides via `getStatus`+`isTerminal` on each tick and self-stops).

### Deliberately NOT added (behavior-preserving stance)

- **No `inFlight` overlap guard.** Codex suggested one; the current pollers use naive
  `setInterval` with no overlap protection, so adding a guard is a (small, slow-network-only)
  behavior change. C9-B preserves current semantics. `inFlight` is recorded as a
  deferred optional improvement, not part of this refactor.

### Caller wiring

- **`AuditPoller`** (`intervalMs: 1000`): `isTerminal = s => s==='complete'||s==='error'||s==='redirected'`;
  `getStatus = d => d.status`; `onData` sets progress/message/status. The elapsed
  timer + ETA `useMemo` **stay local to `AuditPoller`** (only it needs them). The
  compact progress-card JSX is unchanged.
- **`SiteAuditPoller`** (`intervalMs: 3000`): `isTerminal = s => s==='complete'||s==='error'||s==='cancelled'`;
  `getStatus = d => d.status`; `onData` sets all pages/pdfs/lighthouse counters +
  queuePosition + activeAudit + liveChildren. Queued/running/pdfs/lighthouse
  multi-state JSX + `LiveAuditTable` are unchanged.

## 4. Unit 2 — extract `PageRow`

New file: `components/ada-audit/PageRow.tsx`. Move the inline `PageRow` subcomponent
(`SiteAuditResultsView.tsx:48-219`) verbatim, plus the tiny `ImpactCount` helper
(lines 43–46) it uses. `SiteAuditResultsView` imports and renders it exactly as
today.

**Invariant to preserve:** `PageRow`'s **"no fetch in shareMode"** contract — in
`shareMode` the row does not compute triage keys (`shareMode` short-circuits the
key `useEffect`), `handleExpand` short-circuits (no `/api/ada-audit/[adaAuditId]`
fetch), rows are non-clickable, and the expand chevron is suppressed. This is pinned
by `SiteAuditResultsView.test.tsx`'s "shareMode → zero cookie-gated fetches" assertions,
which must keep passing unchanged.

Props are exactly the current closure inputs made explicit (page, shareMode, triage
state/handlers, selected-violation state, key helpers). No behavior change — pure
move + prop-threading.

## 5. Unit 3 — `useTriageMode` + `ArchivedAuditBanner`

Both `AuditResultsView` and `SiteAuditResultsView` duplicate:

- **Triage-mode localStorage pair** — read on mount + write on toggle, keyed
  `er-triage-mode:${id}` (`AuditResultsView.tsx:61-75`, `SiteAuditResultsView.tsx:246-260`).
- **Archived-audit amber banner** — the "results reconstructed from the findings
  tables; some detail unavailable" notice (`AuditResultsView.tsx:100-108`,
  `SiteAuditResultsView.tsx:319-326`).

### `useTriageMode(id, { enabled })` → `components/ada-audit/useTriageMode.ts`

- Returns `{ triageMode: boolean, toggleTriage: () => void }` (exact names TBD in plan).
- On mount, if `enabled`, reads `localStorage['er-triage-mode:'+id]` and seeds state
  (guarded for SSR / missing `localStorage` — the tests mount with no `localStorage`
  global and expect no throw).
- `toggleTriage` flips state and writes `localStorage`.
- When `enabled === false` (share/readOnly context), the read effect early-returns
  and no writes occur — matching current behavior in both views
  (`SiteAuditResultsView.tsx:249` `shareMode` early-return; `AuditResultsView` gates
  via `readOnly`).

**Note the asymmetry (do not normalize):** `SiteAuditResultsView` gates on `!shareMode`,
`AuditResultsView` gates on `!readOnly`. The hook takes a single `enabled` boolean;
each caller passes the correct expression (`!shareMode` / `!readOnly`). The hook does
not know about `shareMode`/`readOnly`.

### `ArchivedAuditBanner` → `components/ada-audit/ArchivedAuditBanner.tsx`

Pure presentational component rendering the existing amber banner markup (dark-mode
variants preserved). Both views render `{archived && <ArchivedAuditBanner />}` in
place of the inline block. If the two inline banners differ in copy, the shared
component takes an optional prop to preserve each exact string (plan verifies the
two are identical first; if identical, no prop).

## 6. Behavior-preservation invariants (the whole point)

1. **Cadences unchanged:** `AuditPoller` 1000 ms, `SiteAuditPoller` 3000 ms.
2. **Terminal-on-mount:** no `router.refresh()` when initial status is already terminal.
3. **`router.refresh()` fires once** per poller instance.
4. **`shareMode` ≠ `readOnly`:** `shareMode` (site view) suppresses cookie-gated
   fetches, row expansion, triage-key computation, grouped-violation fetching, and
   localStorage; `readOnly` (single view) shows loaded checks read-only without
   writes. Extraction must not merge or cross-wire these.
5. **`PageRow` no-fetch-in-shareMode** contract intact.
6. **Zero visual/DOM change** when props are held constant — dark-mode variants,
   copy, and layout identical.

## 7. Testing strategy

- **New:** `useAuditPoller.test.ts` (`renderHook`, node env, fetch mocked, fake
  timers) — pins: terminal-on-mount inert; polls on interval; `onData` per tick;
  terminal → `onTerminal` then single `router.refresh()`; refresh-once under a
  simulated double-invoke; cleanup clears interval; network-blip keeps polling.
  (Fills the current gap — no poller tests exist today.)
- **New:** `useTriageMode.test.ts` — read/seed from localStorage, toggle writes,
  `enabled:false` no-op, no-`localStorage` no-throw.
- **Preserve (must stay green unchanged):** `SiteAuditResultsView.test.tsx`
  (archived-render + shareMode zero-fetch contracts), `AuditResultsView.test.tsx`
  (archived-render contract), `useSiteAuditPages.test.ts`.
- Optional light `ArchivedAuditBanner` / `PageRow` render tests only if extraction
  needs a seam; the existing view tests already exercise both.

## 8. Risks

- **False abstraction in `useAuditPoller`.** Mitigation: callback-only, caller-supplied
  predicates, no shared UI state, elapsed/ETA kept local. If wiring the second poller
  forces awkward params, stop and reconsider rather than widening the hook.
- **Silent behavior drift in the extraction.** Mitigation: the existing view/contract
  tests are the guardrail; run them after each unit. Refactor is done unit-by-unit,
  gate-green between units.
- **StrictMode / double-fire.** Mitigation: ref-guarded single refresh + interval
  cleanup, explicitly tested.

## 9. Deliverables

- `components/ada-audit/useAuditPoller.ts` + `useAuditPoller.test.ts`
- `AuditPoller.tsx` + `SiteAuditPoller.tsx` refactored onto the hook
- `components/ada-audit/PageRow.tsx` (extracted) + `SiteAuditResultsView.tsx` importing it
- `components/ada-audit/useTriageMode.ts` + `useTriageMode.test.ts`
- `components/ada-audit/ArchivedAuditBanner.tsx`
- `AuditResultsView.tsx` + `SiteAuditResultsView.tsx` using the shared hook + banner
- Gates green (tsc · vitest · build); no migration; deploy is plain `~/deploy.sh`.
