# SEO-Scan Intent Toggles + Labeling (C11 PR 2a) — Design

Status: **draft** (brainstormed with Kevin; three scoping decisions
Codex-adjudicated 2026-07-08 — see §3). Author: Claude. Roadmap item: **C11 PR 2**,
sub-PR **2a** (tracker `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md:452`).

## 1. Goal

After C11 PR 1, an operator can trigger a cheap render-only **`seoOnly`** scan only
from the new URL form on `/seo-parser`. The main scan-trigger surfaces — the manual
`SiteAuditForm`, the quick-site-audit widget, and per-client scheduled scans — remain
ADA-only in the UI, and queue/history views don't distinguish an SEO scan from an
accessibility audit. A `seoOnly` scan that fails also shows "SEO scan running…"
forever (a PR 1 carry-over bug).

PR 2a makes scan **intent** a first-class, visible choice everywhere a scan is
triggered or listed, with **no schema migration**:

- **(a)** ADA-vs-SEO intent toggle on `SiteAuditForm` + the quick-site-audit widget.
- **(b)** ADA-vs-SEO intent toggle on `ScheduledScansCard`; an SEO schedule enqueues
  `seoOnly:true` (render-only) — wiring the 2nd `// FUTURE` breadcrumb in
  `scheduled-site-audit.ts`.
- **(c)** A full intent-labeling pass across queue + history views (an "SEO" vs
  "Accessibility" chip on every scan/queue row).
- **(error)** `SeoScanForm` gains a terminal error phase: `status ∈ {error, cancelled}`
  stops polling, clears sessionStorage, and shows a failure message.

**Out of scope (PR 2b, separate spec):** SEO-phase *visibility* (probing the
post-terminal `broken-link-verify` job) and the fine-grained SEO-phase progress bar
(the `Job.progress` migration). Also out: the `/seo-parser` → `/seo-audits` rename and
section maturation (PR 3), and fixing the "Archived — rebuilt from findings data"
banner that live-scan runs show (PR 3 — noted here only so the labeling pass doesn't
worsen it).

## 2. Background (verified code facts this builds on)

- **Enqueue contract already supports the flag.** `queueSiteAuditRequest`
  (`lib/ada-audit/queue-request.ts`) accepts `seoOnly?: boolean` and enforces
  `seoOnly ⇒ seoIntent` (`seoIntent: (input.seoIntent ?? false) || seoOnly`), passing
  both to `enqueueAudit`. `seoOnly` is a persisted `SiteAudit` column (PR 1).
- **The schedule route already coexists ADA + SEO schedules.**
  `POST /api/clients/[id]/schedules` (route.ts) already reads `body.seoIntent`,
  keys best-effort uniqueness on `(client, domain, seoIntent)` (L91-106), and writes
  `seoIntent` into the Schedule payload (L113). It does **not** yet read/write
  `seoOnly`. Cadence is restricted to literal `weekly:`/`monthly:` (L77-86).
- **The scheduled handler is deliberately full-pipeline.**
  `lib/jobs/handlers/scheduled-site-audit.ts` parses `seoIntent` (L35) and forwards it
  to `queueSiteAuditRequest` (L116) but never sets `seoOnly`. The `// FUTURE` breadcrumb
  (L102-105) marks this as the intended flip site.
- **A `seoOnly` audit is redirected away from the ADA results page.**
  `app/(app)/ada-audit/site/[id]/page.tsx` calls `seoOnlyRedirectTarget(audit)` →
  `/seo-parser` (dropping the id). So a SEO-intent submit must **not** route to
  `/ada-audit/site/[id]`; it must land on the SEO surface and hand off the scan id.
- **`SeoScanForm`** (`components/seo-parser/SeoScanForm.tsx`) polls
  `/api/site-audit/[id]`; its `poll()` only treats `status === 'complete'` as terminal
  (`ready` when `liveScanRunId` present, else `building`); every other status →
  `running`. `error`/`cancelled` therefore stick on "SEO scan running…" forever. It
  resumes a pending scan from `sessionStorage['seo-scan-id']` on mount.
- **`SiteAuditForm`** POSTs `{domain, clientId, wcagLevel, urls}` in two paths
  (`handleStartAudit`, `handleStartManualAudit`), both routing to
  `/ada-audit/site/${data.id}`. It has a discover→confirm→start flow and a manual-URL
  mode. The WCAG selector is meaningless for SEO scans.
- **`QuickSiteAuditWidget`** POSTs to `/api/site-audit` and routes both 202 and 409 to
  `/ada-audit/site/${id}` (PR 1 confirmed).
- **`/api/site-audit` GET (list)** and `/api/site-audit/queue` — labeling depends on
  whether they expose `seoOnly`/`seoIntent` per row (confirmed in §4.4 against the
  Explore map).

## 3. Scope decisions (Codex-adjudicated 2026-07-08 — Kevin deferred these to Codex)

| Decision | Ruling | Why |
|---|---|---|
| **PR packaging** | **Split** PR 2 → **2a** (this spec: toggles + labels + error fix, migration-free) + **2b** (SEO-phase visibility + progress, owns the `Job.progress` migration). | Keeps a user-visible toggle rollout decoupled from a `Job`-schema migration whose blast radius is the whole worker; isolates prod verification. Do **not** defer the committed progress bar — isolate it in 2b. |
| **Schedule flip (b)** | An SEO schedule enqueues **`seoOnly:true`** (render-only), via explicit payload `{seoIntent:true, seoOnly:true}`. Do **not** blindly flip existing `seoIntent:true` schedules. Uniqueness stays `(client, domain, seoIntent)`. | After PR 1 "SEO scan" has a real execution model; an SEO-labeled schedule paying the ADA pipeline is wrong product semantics. Explicit new-schedule intent avoids mutating autonomous schedules. |
| **Progress channel (b→2b)** | (2b) generic nullable `Job.progress` + `progressMessage`, attempt-fenced. Not this PR. | Recorded here for continuity; not built in 2a. |

## 4. Architecture — units

### 4.1 Shared intent helper + chip (new)

Today the "SEO" marker is duplicated inline across ≥5 sites (`QueueMemberRow:69`,
`LiveNowWidget:44,66`, `DashboardQueueStatus:130`, `client-dashboard.ts:202`), and
ad-hoc `'SEO'`/`'ADA'` strings exist in findings panels — no shared source.

- `lib/ada-audit/scan-intent.ts` — a pure, client-safe module (no server imports):

  ```ts
  export type ScanIntent = 'ada' | 'seo'
  export function scanIntentOf(a: { seoOnly?: boolean | null }): ScanIntent  // seoOnly → 'seo' else 'ada'
  export const SCAN_INTENT_LABEL: Record<ScanIntent, string>  // { ada: 'Accessibility', seo: 'SEO' }
  ```
- `components/ada-audit/IntentChip.tsx` — a tiny presentational badge
  `<IntentChip seoOnly={boolean} />` (dark-mode-safe; orange for SEO, neutral/navy for
  ADA), consumed by every queue/history row in §4.4.

Rationale: a single source of truth for the label text + row→intent derivation prevents
drift and is unit-testable. Derive intent from **`seoOnly`** (the execution mode), not
`seoIntent` — a full-pipeline autonomous `seoIntent` audit is still an accessibility
audit that also emits SEO data; only `seoOnly` audits are SEO-purposed and skip ADA.
(This matches the results-page redirect, which keys on `seoOnly`.)

### 4.2 Intent toggle on `SiteAuditForm` (a)

- Add `const [intent, setIntent] = useState<ScanIntent>('ada')` and a two-button
  segmented control (mirroring the existing WCAG selector styling) at the top of the
  form: **Accessibility** / **SEO**.
- When `intent === 'seo'`: hide the WCAG-level selector (irrelevant; a default
  `wcag21aa` is still sent, harmless) and reword the helper/submit copy minimally
  ("Scan … for SEO"). Discover→confirm and manual-URL modes are unchanged (both are
  valid for SEO; page discovery is shared).
- Thread `seoOnly: intent === 'seo'` into **both** POST bodies (`handleStartAudit`,
  `handleStartManualAudit`).
- **Routing branch on success/409:**
  - `intent === 'ada'` → `router.push(/ada-audit/site/${data.id})` (unchanged).
  - `intent === 'seo'` → `router.push(/seo-parser?scan=${data.id})` (do NOT hit the ADA
    results page, which would redirect and drop the id).
- Dark-mode variants on every new element; no hydration concern (all state is
  client-side, no SSR value mismatch).

**`QuickSiteAuditWidget`** (a): the widget's **response routing is already
seoOnly-aware** (PR 1 — it branches 202/409 on `data.seoOnly` → `/seo-parser` vs
`/ada-audit/site/${id}`). PR 2a only adds the intent toggle to its request body
(`seoOnly: intent === 'seo'` in the POST at ~L22, a compact segmented control near the
WCAG `<select>` at L46-55). No routing change needed.

### 4.3 Intent pickup on `SeoScanForm` (a, continued) + terminal error phase (error)

- **Query-param pickup:** on mount, read `useSearchParams().get('scan')`; if present and
  no active scan, adopt it as `auditId`, set phase `running`, and persist it to
  `sessionStorage['seo-scan-id']` (so a refresh still resumes). This is the handoff
  target for §4.2's SEO route. Read in an effect (never during render) to avoid
  hydration mismatch — consistent with the existing sessionStorage-resume effect.
- **Terminal error phase:** extend `poll()` — when `d.status === 'error' ||
  d.status === 'cancelled'`, set phase `error`, set a message ("SEO scan failed — please
  try again."), clear `sessionStorage['seo-scan-id']`, and stop polling (the existing
  effect already stops when `phase === 'ready'`; extend the guard to also stop on
  `error`). Also: if `poll()`'s fetch returns a persistent non-OK (e.g. 404, audit
  deleted), treat as terminal error rather than silent no-op after a bounded number of
  misses (keep simple: 404 → error immediately; other non-OK → transient, keep polling).

### 4.4 Intent-labeling pass (c) — scoped to queue + scan-trigger surfaces

**Scope discipline:** the Explore map found ~15 components that touch a scan/audit/
findings label. Most are **client-command-center findings panels** (`FleetTable`,
`FindingsPanel`, `ClientsAuditSummary`, `RecentParsesWidget`) that label by *findings
tool* (which data a `CrawlRun` holds) — a **different axis** from scan intent, already
correct, and out of scope for 2a. (c) is scoped to the **queue + scan-trigger** surfaces
where an in-flight/queued scan's intent is genuinely ambiguous today. All required data
is already exposed — **no API or type change, no migration** (`QueueStatusWithBatch`,
`AuditBatchMember`, and `/api/site-audit` GET items all already carry `seoOnly`).

Target set (each renders `<IntentChip seoOnly={row.seoOnly} />`, dark-mode-safe):

1. `components/ada-audit/QueueMemberRow.tsx` (L66-71) — replace the PR-1 seoOnly-only
   marker with the shared chip (labels **both** intents). Covers `QueueActiveView` +
   `QueueBatchRow` transitively (both render this row).
2. `components/ada-audit/DashboardQueueStatus.tsx` — add the chip to the **queued-list**
   card (`QueueListContent`, L192-206, none today) and reconcile the current-scan
   `'· SEO'` string (L130) to the chip.
3. `components/ada-audit/SiteAuditForm.tsx` queue banner (L470-506) — chip each queued
   domain + the active row.
4. `components/widgets/LiveNowWidget.tsx` (L44,66) — reconcile its two inline seoOnly
   badges to the shared chip.

**Explicitly left as-is (documented, not overlooked):**
- `components/ada-audit/RecentsTable.tsx` — ADA recents already **excludes** seoOnly rows
  (`fetchAllRecents` filters `seoOnly:false`); SEO scans correctly live in the SEO
  history, not ADA recents. No change (changing the query would resurface SEO scans in
  the wrong list).
- `components/seo-parser/HistoryList.tsx` — every row here is already a SEO run; its
  `Live scan` / `SF upload` **source** badge conveys this. Leave structurally unchanged;
  no intent chip needed (would be redundant).
- The findings-tool panels above (client command center) — different axis; PR 3's
  maturation may revisit vocabulary, not 2a.
- `SiteAuditPoller` — a seoOnly audit never reaches it (redirected); skip.

### 4.5 Schedule intent toggle (b)

- **`ScheduledScansCard`**: add an intent `<select>` (Accessibility / SEO) to the create
  form. When SEO is chosen, hide the WCAG-level select (send default). Include
  `seoIntent: intent === 'seo'` and `seoOnly: intent === 'seo'` in the POST body.
  Render the intent chip on each schedule row (`s.seoOnly`/`s.seoIntent` must be exposed
  by `getClientSchedules` — additive field on `ClientScheduleRow`). For an SEO schedule
  row, the last-run link must **not** point at `/ada-audit/site/:id` (it redirects); link
  to `/seo-parser` (or omit the link) and prefer the live-scan `seo-parser` run for the
  score — see the ScheduledScansCard last-run note in §6.
- **`POST /api/clients/[id]/schedules`**: read `body.seoOnly === true`; write
  `seoOnly` into the Schedule payload alongside `seoIntent`; enforce `seoOnly ⇒ seoIntent`
  server-side (mirror `queueSiteAuditRequest`). Uniqueness key unchanged
  `(client, domain, seoIntent)`.
- **`scheduled-site-audit.ts`**: add `seoOnly?: boolean` to `ScheduledSiteAuditPayload`
  + `parsePayload`; pass `seoOnly: p.seoOnly ?? false` to `queueSiteAuditRequest`
  (which forces `seoIntent`). Replace the `// FUTURE` breadcrumb with a comment noting
  the flip is now wired for `seoOnly` schedules; full-pipeline stays the default for
  ADA (and legacy autonomous `seoIntent`-only) schedules.
- **`getClientSchedules`** (`lib/services/client-schedules.ts`): parse `seoOnly`/
  `seoIntent` from the payload onto each `ClientScheduleRow`; for `seoOnly` schedules,
  source the last-run score from the live-scan `seo-parser` `CrawlRun` (the finalizer
  never writes an ada-audit run for seoOnly) rather than `tool:'ada-audit'`.

## 5. Error handling

- Toggle default is **ADA** everywhere (preserves current behavior; SEO is opt-in).
- SEO submit that 409s (in-flight duplicate) routes to `/seo-parser?scan=<existingId>`
  so the operator sees the already-running scan, matching the ADA 409 behavior.
- `SeoScanForm` terminal error clears sessionStorage so a refresh doesn't resurrect a
  dead scan.
- Schedule route: `seoOnly` without `seoIntent` is coerced to `seoIntent:true` (never a
  400) — the UI always sends both, but the server is defensive.

## 6. Risks / open points

- **ScheduledScansCard last-run for SEO schedules** (Codex flag): today the card links
  last run to `/ada-audit/site/:id` and reads score from the ada-audit run. For a
  `seoOnly` schedule both are wrong (no ada run; the ADA page redirects). §4.5 routes
  the score through the live-scan run and the link to `/seo-parser`. If the live-scan
  run isn't built yet (verifier still running post-complete), the score shows as pending
  — full "SEO analysis running" surfacing is PR 2b; 2a shows `status` + a null-safe score.
- **Archived banner** (Codex flag, PR 3): live-scan runs render "Archived — rebuilt from
  findings data" (no `Session.result` blob by design). 2a must not reuse "archived"
  wording in any new SEO label; the banner fix itself is PR 3.
- **`SiteAuditForm` growth**: the form is already large. The intent toggle adds ~1 state
  + 1 control + a routing branch — no refactor needed; if it tips over, extract the WCAG
  + intent controls into a small presentational sub-component (only if it genuinely
  clarifies; not required).
- **No new middleware/isPublicPath** change (all routes already cookie-gated;
  `/seo-parser?scan=` is a query param on an existing authed page).

## 7. Testing

- `scan-intent.ts`: unit table (seoOnly → 'seo'; falsy/absent → 'ada'; label map).
- `SeoScanForm.test.tsx`: (1) `?scan=<id>` adopts the id and polls; (2) `status:'error'`
  → error phase + sessionStorage cleared + polling stopped; (3) `status:'cancelled'`
  same; (4) 404 → error.
- `SiteAuditForm.test.tsx`: SEO intent → POST body carries `seoOnly:true` and success
  routes to `/seo-parser?scan=…`, not `/ada-audit/site/…`; ADA intent unchanged; WCAG
  hidden under SEO intent.
- `QuickSiteAuditWidget.test.tsx`: SEO intent → seoOnly POST + SEO routing.
- `ScheduledScansCard.test.tsx`: SEO create → POST body carries `seoOnly:true` +
  `seoIntent:true`; row renders the SEO chip; SEO row last-run link is not the ADA page.
- `schedules/route` test: `seoOnly` persisted into payload; `seoOnly ⇒ seoIntent`
  coercion; `(client, domain, seoIntent)` uniqueness still coexists ADA + SEO.
- `scheduled-site-audit.test.ts`: `seoOnly` payload → `queueSiteAuditRequest` called with
  `seoOnly:true`; absent → full pipeline (`seoOnly:false`).
- Labeling components: each renders the correct chip for a seoOnly vs ada row.
- Gate: `tsc --noEmit` + `DATABASE_URL=… npm test` + `npm run build`. UI dark-mode +
  no-hydration review on every new element.
