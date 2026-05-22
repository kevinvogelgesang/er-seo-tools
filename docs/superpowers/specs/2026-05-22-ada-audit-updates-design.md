# ADA Audit Updates — Design Spec

Date: 2026-05-22
Scope: Six related changes to the ADA Audit feature.
Status: Draft (pending Codex re-review + user review)

## 1. Goals

Ship six user-requested ADA Audit improvements, batched under a single schema migration to keep migration churn low:

1. **Opt-in checkbox triage** — strike out individual rules/nodes (single-page) or pages/violations (site audit) as a team works through remediation.
2. **Redirect handling** — pages that 3xx-redirect to another URL during a site audit are recorded as a distinct outcome rather than erroring.
3. **Time-taken column** — show duration on queue + recents/history; hover reveals start/end times.
4. **Recents page** — a dedicated `/ada-audit/recents` route filtered to the current operator (`er-operator-name` cookie). Dashboard slims down to a single compact "My recents" card.
5. **Shared element identification** — site-wide pattern callouts surface a canonical CSS selector + an example page link to make recurring elements easier to fix.
6. **External link on violations view** — match the Pages view by adding a "open in new tab" icon next to each URL in "Pages with Issues".

## 2. Non-goals

- No real authentication system. Operator identity remains cookie-based.
- No multi-tenant isolation of checks (anyone viewing an audit sees the same triage state — that's intentional; `checkedBy` exists only as an audit trail).
- No retroactive backfill of `startedAt`/`completedAt` on historical audits.
- No change to scoring, axe rules, PSI pipeline, or queue semantics beyond what the redirect/duration columns require.
- No "highlight element on page" deep-linking — the example-page link just opens the page in a new tab.

## 3. Architecture

### 3.1 Single Prisma migration (lands first)

```prisma
model AdaAudit {
  // ...existing fields...
  startedAt     DateTime?
  completedAt   DateTime?
  finalUrl      String?    // set when redirected=true
  redirected    Boolean    @default(false)

  checks        AdaAuditCheck[]

  @@index([requestedBy, createdAt])
}

model SiteAudit {
  // ...existing fields...
  startedAt        DateTime?
  completedAt      DateTime?
  pagesRedirected  Int       @default(0)

  checks           SiteAuditCheck[]

  @@index([requestedBy, createdAt])
}

model AdaAuditCheck {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  adaAuditId  String
  adaAudit    AdaAudit @relation(fields: [adaAuditId], references: [id], onDelete: Cascade)
  scope       String   // 'node' only (rule-level state is derived, never persisted)
  key         String
  checkedBy   String?  // er-operator-name at time of check

  @@unique([adaAuditId, scope, key])
  @@index([adaAuditId])
}

model SiteAuditCheck {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  siteAuditId String
  siteAudit   SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  scope       String   // 'page' | 'page-violation'
  key         String
  checkedBy   String?

  @@unique([siteAuditId, scope, key])
  @@index([siteAuditId])
}
```

Two concrete tables, not one polymorphic one — partial uniqueness across nullable parents is not expressible cleanly in Prisma/SQLite, and the API surface splits naturally on this seam anyway. Migration name: `add-ada-checks-redirects-durations`.

### 3.2 Module boundaries

| Module | Responsibility |
|---|---|
| `lib/ada-audit/checks-keys.ts` *(new)* | Pure functions to build `scope+key` strings and to derive parent (rule/page) checked state from leaf (node/page-violation) checks. No I/O. |
| `lib/ada-audit/checks-store.ts` *(new)* | Prisma read/write for `AdaAuditCheck` + `SiteAuditCheck`. `getChecks(auditId)`, `setCheck({ auditId, scope, key, checked, operator })`. |
| `lib/ada-audit/redirect-detect.ts` *(new)* | Pure logic: given `requestedUrl`, `response.request().redirectChain()`, and `response.url()`, return `{ redirected: boolean, finalUrl: string, reason: 'server-3xx' | 'noise' }`. Includes a single canonical URL-normalization function for the redirect decision. |
| `lib/ada-audit/duration.ts` *(new)* | Pure `formatDuration(startedAt, completedAt)` + `formatHover(startedAt, completedAt)`. |
| `lib/ada-audit/runner.ts` *(touch)* | Call `redirect-detect` after the puppeteer navigation. Does NOT write to the DB. Returns a `RunAxeResult` discriminated union (see §3.3). All status / counter / timestamp writes happen in callers. |
| `app/api/ada-audit/route.ts` *(touch)* | Stamp standalone `AdaAudit.startedAt` on transition into `running`. On runner return: if `audited`, stamp `completedAt` on success/error; if `redirected`, set `status='redirected'`, `finalUrl`, `completedAt`, `progress=100`. |
| `lib/ada-audit/queue-manager.ts` *(touch)* | Stamp `SiteAudit.startedAt` on `queued → running`. Stamp child `AdaAudit.startedAt` on child `pending → running`. On runner return for a child: if `audited`, follow existing flow (axe-complete / complete depending on detached PSI); if `redirected`, set child `status='redirected'`, `finalUrl`, `completedAt`, increment `SiteAudit.pagesRedirected` (do NOT increment `pagesComplete` and do NOT enqueue PSI/PDFs). |
| `lib/ada-audit/lighthouse-queue.ts` *(touch)* | Stamp child `AdaAudit.completedAt` only on the final `axe-complete → complete` transition (after PSI). For the local/off provider's inline `axe-complete → complete` in `queue-manager.ts`, the stamp happens there. |
| `lib/ada-audit/site-audit-finalizer.ts` *(touch)* | Treat `pagesRedirected` as terminal, equal weight with `pagesComplete + pagesError`, in done-math. Stamp `SiteAudit.completedAt` when transitioning to `complete` / `error` / `cancelled`. |
| `lib/ada-audit/site-audit-helpers.ts` *(touch)* | When building summaries, exclude `redirected` rows from site-wide pattern aggregation. Add canonical-selector computation for common issues (see §5). |
| `app/api/ada-audit/[id]/checks/route.ts` *(new)* | `GET` returns checks for an AdaAudit; `PUT` accepts `{ scope, key, checked }` (idempotent state, not toggle). |
| `app/api/site-audit/[id]/checks/route.ts` *(new)* | Same for SiteAudit checks. |
| `app/ada-audit/recents/page.tsx` *(new)* | Server component reading current operator from cookie; queries union of `AdaAudit` + `SiteAudit` rows filtered by `requestedBy`. |
| `components/ada-audit/AuditResultsView.tsx` *(touch)* | Render checkboxes (gated by Triage Mode); apply strike-through styling for checked leaves and derived parents. |
| `components/ada-audit/SiteAuditResultsView.tsx` *(touch)* | Same, plus: external-link icon next to URL in "Pages with Issues", new "Redirects" collapsible section. |
| `lib/ada-audit/types.ts` *(touch)* | Add `finalUrl` + `redirected` to `AuditDetail`; widen status union with `'redirected'`. |
| `app/api/ada-audit/[id]/route.ts` *(touch)* | Serialize `finalUrl` + `redirected` to clients. |
| `components/ada-audit/AuditPoller.tsx` *(touch)* | Recognize `'redirected'` as terminal; stop polling and show the redirected state. |
| `app/ada-audit/[id]/page.tsx` *(touch)* | Render a "Redirected to <finalUrl>" panel when `redirected=true` instead of an empty results view. |
| `components/ada-audit/CommonIssueCallout.tsx` *(touch)* | Render canonical selector + "View on <example page>" link when common-tier and selector available. |
| `components/ada-audit/AuditHistory.tsx`, `SiteAuditHistory.tsx`, `QueueActiveView.tsx`, `QueueHistoryView.tsx` *(touch)* | Add Duration column. |
| `app/ada-audit/page.tsx` *(touch)* | Replace existing `AuditHistory`/`SiteAuditHistory` mounts with a single compact "My recents" component (5 rows max, operator-filtered) + link to `/ada-audit/recents`. |

### 3.3 Data flow

**Triage mode toggle:** local-only. Stored in `localStorage` keyed `er-triage-mode:<auditId>`. Default off. Toggle does NOT touch the DB.

**Check write (single-page audit):**
1. User clicks a leaf checkbox (node).
2. Client calls `PUT /api/ada-audit/[id]/checks` with `{ scope: 'node', key, checked: true|false }`.
3. Server validates audit exists; upserts (`checked: true`) or deletes (`checked: false`) the `AdaAuditCheck` row; returns the full updated check set for that audit.
4. Client recomputes derived rule state locally from the returned set + the violation tree.

**Check write (site audit):**
1. User clicks either a page-row checkbox OR a per-violation checkbox.
2. Client calls `PUT /api/site-audit/[id]/checks` with `{ scope: 'page' | 'page-violation', key, checked: true|false }`.
3. Server upserts/deletes the `SiteAuditCheck` row; returns the full updated check set.
4. Client recomputes derived page-row state (struck iff explicit page check OR every page-violation key for that URL is present).

**Rule-checkbox fan-out (single-page audit only):** clicking the rule checkbox issues N parallel idempotent `PUT` requests, one per node target under that rule (`checked: true` to strike all; `checked: false` to clear all). No batch endpoint is defined in v1; if profiling shows latency pain, add `PUT { checks: [...] }` later.

**Parent state derivation:**
- **Single-page audit:** rule rows are never persisted. A rule is rendered as struck iff every node target listed in `violation.nodes` has a `scope='node'` check row. Clicking the rule checkbox in the UI fans out to PUT-check every node beneath it.
- **Site audit page row:** struck iff a `scope='page'` row exists for that URL OR every violation on that page has a `scope='page-violation'` check. Page-level checks are explicitly persisted (see edge case below).

**Edge case: page-level explicit check.** Site audit pages can be marked done in one click even if you haven't drilled into per-violation checks. So `scope='page'` IS persisted; "page-violation" is also persisted. Rule for site audit page row: page row is struck if `scope='page'` exists for that URL OR every violation on that page has a `scope='page-violation'` check. Single-page rule rows: struck iff every node target has a `scope='node'` check (no separate `scope='rule'` row).

This asymmetry is deliberate: site audits give the user a "this whole page is handled" express-lane; single-page audits don't need one — rule level is the express-lane there.

**Redirect detection (lib/ada-audit/redirect-detect.ts):**

Pure function with no I/O:

```
input:  requestedUrl, response.request().redirectChain(), response.url()
output: { kind: 'audited' } | { kind: 'redirected', finalUrl: string }
```

Rules:
1. If `redirectChain().length === 0` → `audited` (regardless of `response.url()` — final URL changes without a server 3xx are JS/meta navigation, not redirects).
2. If chain exists, take `finalUrlRaw = response.url()`.
3. Normalize both `requestedUrl` and `finalUrlRaw` with `normalizeForRedirect()`:
   - lowercase host
   - strip default ports (`:80`/`:443`)
   - **Ignore protocol** (treat `http`/`https` as equivalent — `http→https` upgrades are noise, not user-meaningful redirects).
   - strip trailing slash on pathname (only the trailing one)
   - strip `#fragment`
   - leave query string intact (sort order preserved)
   - do NOT strip `www.` (treat `www.foo.edu ↔ foo.edu` as a real redirect)
4. If normalized URLs differ → `{ kind: 'redirected', finalUrl: finalUrlRaw }`. If they match → `{ kind: 'audited' }` (server 3xx resolving to same canonical resource; run axe normally).

**Scope of detection:** redirect-detect is only invoked on the puppeteer/axe navigation path in `runner.ts`. The local-Lighthouse provider owns its own navigation and is dev-only (production uses PSI). Local-LH does not report redirects in v1; if local-LH ever needs redirect detection, it gets its own pass.

**Callers handle the outcome (runner does NOT write to DB):**
- Standalone audit (`app/api/ada-audit/route.ts`): on `{ kind: 'redirected', finalUrl }`, set `status='redirected'`, `finalUrl`, `result=null`, `score=null`, `progress=100`, `completedAt=now`.
- Site audit child (`queue-manager.ts` page loop): same fields on the child row + atomic `SiteAudit.pagesRedirected++`. Do NOT enqueue PSI; do NOT scan PDFs for this URL.

**Counter updates (site audit):** `finalize-site-audit` done condition becomes:
```
pagesDone = pagesComplete + pagesError + pagesRedirected
pdfsDone  = pdfsComplete + pdfsError + pdfsSkipped     (unchanged)
lhDone    = lighthouseComplete + lighthouseError       (unchanged)
allDone   = pagesDone >= pagesTotal && pdfsDone == pdfsTotal && lhDone == lighthouseTotal
```

Redirected children do NOT enqueue a PSI job; do NOT contribute to `lighthouseTotal`.

**`startedAt` / `completedAt` stamping rules:**

| Row | startedAt set when | completedAt set when |
|---|---|---|
| Standalone `AdaAudit` | status → `running` | status → `complete` / `error` / `redirected` |
| Child `AdaAudit` (in site audit) | status → `running` | status → `complete` (after PSI) / `error` / `redirected`. NOT on `axe-complete` transition. |
| `SiteAudit` | status → `running` (in `queue-manager.processNext`) | status → `complete` / `error` / `cancelled` (in `finalize-site-audit`) |

Stale-recovery + cancellation paths (`recoverQueue`, `resetStaleAudits`) MUST also stamp `completedAt` when they force-fail rows.

### 3.4 Error handling

- Check API failures: surface inline error toast; do not optimistically update UI past confirmation. Refetch the full check set after a 5xx.
- Redirect detection on navigation error: existing error handling stands; redirects only apply when navigation succeeded with a chain present.
- Missing `startedAt` (legacy rows or recovery edge cases): UI renders `—`. `formatDuration(null, _)` returns `null`.
- Cookie unset on `/ada-audit/recents`: show empty state CTA pointing at the operator-name banner on the dashboard.

### 3.5 Testing

- **`redirect-detect.ts`**: unit tests for each normalization rule and each chain scenario (no chain, chain with same canonical, chain with different host, with different path, with `http→https`-only, with trailing-slash-only, with fragment, with `www` change).
- **`checks-keys.ts`**: unit tests for derived-parent logic (all-nodes-checked → rule struck; one node un-checked → rule not struck; explicit page check overrides per-violation incomplete).
- **`checks-store.ts`**: integration tests via Prisma test client — upsert/delete round-trip, cascade-delete when parent audit deleted, uniqueness enforcement.
- **`duration.ts`**: unit tests for `formatDuration` ranges (seconds, minutes, hours, null inputs).
- **`site-audit-finalizer.ts`**: extend existing tests with a fixture site where `pagesRedirected > 0`; assert done-condition only fires once all three counters cleared.
- **Manual smoke on staging-equivalent local DB**: `bidwelltraining.edu/academic-support-servives/` flow ends in `redirected`, shows in Redirects section, doesn't error.

## 4. Feature-by-feature notes

### 4.1 Checkboxes (largest piece)

UI behavior:

- **Triage Mode toggle** in `AuditResultsView` / `SiteAuditResultsView` toolbar. Off by default; persisted in localStorage per audit ID. When off, no checkboxes render and existing UI is unchanged. When on, checkbox column appears.
- **Strike-through style**: `line-through text-navy/40 dark:text-white/30` applied to the row's content (not the checkbox itself). No effect on counts, scores, or sort order.
- **Single-page audit** (`AuditResultsView` → `AuditIssueCard`):
  - Each axe rule card has a checkbox in its header. Derived state only.
  - Each node row inside has a checkbox. Persisted as `scope='node'` rows.
  - Clicking the rule checkbox PUT-checks every node under it in a single batch request (`PUT { scope: 'node', key, checked: true }` × N — keep it simple; could be batched later if needed).
- **Site audit** (`SiteAuditResultsView`):
  - "Pages with Issues" table: each page row has a checkbox (persisted as `scope='page'`).
  - Expanded page detail: each violation listed has a checkbox (persisted as `scope='page-violation'`).
  - The "page" check is independent of the per-violation checks — explicitly checking the page strikes it even if per-violation checks are empty.
- **Share view** (`/ada-audit/share/[token]`): renders checks as struck rows but no controls. Use the same `AuditResultsView` with a `readOnly` prop that hides toggle and checkboxes.

Server contracts:

```
GET  /api/ada-audit/[id]/checks         → { checks: AdaAuditCheck[] }
PUT  /api/ada-audit/[id]/checks         body: { scope, key, checked }    → { checks: AdaAuditCheck[] }

GET  /api/site-audit/[id]/checks        → { checks: SiteAuditCheck[] }
PUT  /api/site-audit/[id]/checks        body: { scope, key, checked }    → { checks: SiteAuditCheck[] }
```

PUT is idempotent; `checked: true` upserts, `checked: false` deletes. Always returns the full check set so the client doesn't have to maintain optimistic state past one round-trip. Race-safe by virtue of being state-based, not toggle.

Share-view check loading: `GET /api/ada-audit/share/[token]/checks` (read-only); no PUT. Endpoint must validate `shareToken` against `shareExpiresAt` before returning rows — expired tokens return 410 Gone like other share endpoints.

Key encoding — opaque hashed keys to avoid delimiter collisions (CSS selectors and URLs both can contain `|`, `/`, `:`, spaces). Computed by `lib/ada-audit/checks-keys.ts`:

```ts
// AdaAuditCheck (single-page node):
key = sha256(canonicalJson({ scope: 'node', ruleId, target }))   // target = axe nodes[i].target (full array, preserved)

// SiteAuditCheck (page row):
key = sha256(canonicalJson({ scope: 'page', pageUrl }))

// SiteAuditCheck (page-violation):
key = sha256(canonicalJson({ scope: 'page-violation', pageUrl, ruleId }))
```

`canonicalJson` is a stable stringifier (object keys sorted alphabetically). Hash is hex-encoded sha256. This makes keys delimiter-safe, content-addressed, and easy to compute identically on client (Web Crypto) and server (Node `crypto`). The UI maps node objects → keys at render time; checks-keys exports both `keyFor(scope, payload)` and `payloadFor` extraction is not needed because the server only stores the hash.

### 4.2 Redirect handling

- Pages-with-Issues table: redirected pages do not appear (they have no violations).
- Clean-Pages section: redirected pages do not appear.
- **New section** between those two: "Redirects (N)". Collapsible. Each row: `source URL → final URL` with external-link icon on the final URL.
- Excluded from site-wide-pattern aggregation (no `result`, so `addScorecards` skips them naturally — but explicitly filter on `redirected=false` in `buildSiteAuditSummary` to be safe).
- Per-page audit `pollers`: terminal status set adds `'redirected'`.

### 4.3 Duration column

- Cell content: `formatDuration(startedAt, completedAt)` →
  - `null` → `—`
  - <60s → `Ns`
  - <60m → `Xm Ys`
  - ≥60m → `Hh Mm`
- Native `title` attribute on the cell: `"Started ${start.toLocaleTimeString()} → Ended ${end.toLocaleTimeString()}"`. Locale-aware. No popover library.
- Column header: "Duration". Added to: `QueueActiveView`, `QueueHistoryView`, `AuditHistory`, `SiteAuditHistory`, `/ada-audit/recents` table.

### 4.4 Recents page

- Route: `app/ada-audit/recents/page.tsx` (server component).
- Operator resolution: `cookies().get('er-operator-name')?.value`.
- Query: union of `AdaAudit` (standalone, not children — `siteAuditId === null`) and `SiteAudit` rows where `requestedBy === operator`, ordered by `createdAt desc`, limited to e.g. 100.
- Empty state: when cookie unset → "Set your operator name on the dashboard to see your recents." When cookie set but no rows → "No recents yet."
- Each row chips type ("Page audit" / "Site audit"), shows URL/domain, status, score, duration, createdAt, client.
- Dashboard `/ada-audit/page.tsx`: replace `AuditHistory` + `SiteAuditHistory` blocks with a new `MyRecentsCard` (5 most-recent rows for current operator, mixed types, with "View all →" link). Other dashboard cards (forms, queue status) stay.

### 4.5 Shared element identification

In `lib/ada-audit/site-audit-helpers.ts` summary build, for any common-issue row whose tier is `template` or `common` (i.e. coverage ≥50%), compute a canonical selector via **page-based voting** — not raw node-based voting — so one noisy page can't dominate:

1. For each affected page, take the most-frequent `nodes[i].target.join(' ')` *within that page* as the page's vote.
2. The canonical selector is the mode of those page-votes.
3. `selectorConfidence = pagesVotingForCanonical / affectedPagesCount` (0..1).
4. `examplePageUrl` is one of the pages that voted for the canonical selector (use the first such page in audit order).
5. If no selector achieves majority across pages, `canonicalSelector = null` and the callout falls back to current copy.

New fields added to the common-issue summary JSON (already a JSON string column on `SiteAudit.summary`):

```ts
type CommonIssueExtras = {
  canonicalSelector: string | null    // mode of per-page selector votes; null if no majority
  selectorConfidence: number          // pages-voting-for-canonical / affectedPagesCount (0..1)
  examplePageUrl: string | null
}
```

`CommonIssueCallout.tsx` renders a secondary line under the existing summary text:

> CSS selector: `nav.site-header__menu > a`  ·  [View on `example.edu/programs`](https://example.edu/programs)

Falls back gracefully: if `canonicalSelector === null`, just render the existing copy unchanged.

### 4.6 External link in violations view

In `SiteAuditResultsView.tsx` at the "Pages with Issues" list, mirror the existing pattern used in the Pages view: render a small external-link SVG inside an `<a target="_blank" rel="noopener noreferrer">` next to the URL. Single small JSX change — slots in as PR #3 in the build order below.

## 5. Build order

Order chosen so each PR lands a complete, shippable slice and never depends on later PRs:

1. **Schema migration + duration plumbing** *(small)* — Adds all columns (`startedAt`/`completedAt`/`finalUrl`/`redirected`/`pagesRedirected`) and both new check tables. No UI for checks yet. Wires runner/queue/finalizer to stamp `startedAt`/`completedAt`. Updates `site-audit-finalizer.ts` done-math to include `pagesRedirected` in `pagesDone`, but the counter is never incremented yet (always 0). Adds Duration column UI everywhere. After this, history pages just gain a working Duration column; the redirect column is a no-op until PR #2.
2. **Redirect handling** *(medium)* — `redirect-detect.ts`, runner-return type, caller integration (standalone route + child page loop), `pagesRedirected` increment, `AdaAudit` poller/types/share-API support for `redirected`, standalone page UI for the redirected state, Redirects UI section in `SiteAuditResultsView`. Now `bidwelltraining.edu/academic-support-servives/` flows end clean.
3. **External link in violations view** *(tiny)* — single JSX addition. Can ship anytime; landed here because it's a quick win.
4. **Shared element identification** *(small)* — summary computation + callout rendering.
5. **Recents page + dashboard "My recents" card** *(medium)* — new route, query layer, dashboard slim-down.
6. **Checkboxes** *(largest)* — checks-keys, checks-store, two API routes, share-view read endpoint, Triage Mode toggle, single-page UI integration, site-audit UI integration, share-view read-only rendering, all tests.

Each PR ends with `tsc --noEmit` + tests passing. No PR is pushed/deployed until user has reviewed all six.

## 6. Codex review gates

- **Now (pre-spec)**: complete. Folded in two-table split, leaf-only persistence, idempotent PUT, redirect normalization, `pagesRedirected` counter, PSI-aware `completedAt`, recents indexes, selector confidence guidance.
- **Post-spec (this document)**: re-run Codex on this written doc before plan-writing.
- **Post-plan**: Codex reviews the implementation plan.
- **Per-PR**: Codex reviews each PR diff before user review.

## 7. Risks & verifications

- **Risk: stale-recovery and cancellation paths skip `completedAt`.** Mitigation: explicit audit of every terminal-status write across `lib/ada-audit/` and `app/api/`. Grep for `update` and `updateMany` and transactions where `data.status ∈ { 'complete', 'error', 'cancelled', 'redirected' }`. Confirmed call sites to update in PR #1 include at minimum `queue-manager.ts` (resetStaleAudits, recoverQueue, failOrphan*, processNext error path), `site-audit-finalizer.ts`, `lighthouse-queue.ts` complete path, `app/api/ada-audit/route.ts`, and the standalone retry helper in `runner-retry.ts`. Every such site must stamp `completedAt: new Date()` alongside the terminal status.
- **Risk: redirect normalization too strict (treats meaningful redirects as noise) or too loose (floods Redirects with `http→https` noise).** Verification: unit-test fixture URLs cover all defined cases; manual sanity check on real client domains before merging.
- **Risk: checkbox derived-parent logic is O(nodes × rules)** per render. Acceptable — pages typically have <50 nodes per violation. If profile shows hotspot, memoize per rule.
- **Risk: cookie-based recents filtering is trivially spoofable.** Acceptable — this is operator personalization for an internal tool, not access control. Documented in spec.
- **Risk: PSI worker may stamp `completedAt` from a different process than the one that started the audit.** Mitigation: stamp happens in `lib/ada-audit/lighthouse-queue.ts` worker loop, which is in-process. If we ever move PSI out-of-process, revisit.
- **Verification: re-scan does not rewrite `result`.** Confirmed: `ReScanButton` POSTs to `/api/ada-audit` creating a new row, navigates with `?from=<previousId>`. Checks tied to an audit row are valid for its lifetime; no `resultHash` versioning needed.
