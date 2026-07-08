# SEO-Scan Intent Toggles + Labeling (C11 PR 2a) — Design

Status: **reviewed** (brainstormed with Kevin; three scoping decisions
Codex-adjudicated 2026-07-08 — see §3; spec reviewed by Codex "ACCEPT-WITH-NAMED-FIXES"
— all 8 fixes applied 2026-07-08). Author: Claude. Roadmap item: **C11 PR 2**, sub-PR
**2a** (tracker `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md:452`).

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

**`QuickSiteAuditWidget`** (a) — **needs routing work, not just the request body**
(Codex fix #1). The widget branches on `data.seoOnly`, but `POST /api/site-audit`
returns `data.seoOnly` **only on 409** (`{error, id, seoOnly}`); the **202** returns
`{id, status:'queued'}` with no `seoOnly`. So today a brand-new SEO scan (202) has
`data.seoOnly === undefined` → routes to `/ada-audit/site/:id` → bounces to
`/seo-parser` via the redirect, **losing the id** (no polling handoff). PR 2a:
- Add the intent toggle to the request body (`seoOnly: intent === 'seo'`, compact
  segmented control near the WCAG `<select>` at L46-55).
- Route by **local intent** (authoritative, since 202 omits `seoOnly`): SEO intent →
  `/seo-parser?scan=${data.id}` (both 202 and 409); ADA intent → `/ada-audit/site/${data.id}`.
  Keep `|| data.seoOnly` on the 409 branch as a belt-and-suspenders fallback.

### 4.3 Intent pickup on `SeoScanForm` (a, continued) + terminal error phase (error)

- **Query-param pickup (`?scan=<id>`)** — the handoff target for §4.2's SEO routes.
  On mount, read the param via **`new URLSearchParams(window.location.search).get('scan')`
  inside the existing mount effect** (Codex fix #2), **not** `useSearchParams()`: the
  `/seo-parser` page is a fully-client page with no `<Suspense>` boundary around
  `SeoScanForm`, and `useSearchParams()` there forces a client-render deopt + build
  warning. Reading `window.location.search` in a mount effect is client-only, needs no
  Suspense, and can't hydration-mismatch.
- **Precedence (Codex fix #2):** the query param **wins over** `sessionStorage['seo-scan-id']`.
  When `?scan=<id>` is present: adopt it as `auditId`, **overwrite** the sessionStorage
  key, clear any stale `runId`/`error`, set phase `running`, and start polling that id.
  Only fall back to the stored id when no `?scan=` is present. (Otherwise a stale stored
  id races and keeps polling the wrong scan.)
- **Submit 409-with-id → adopt, don't error (Codex fix #3):** on the form's own submit,
  a 409 currently sets `phase='error'`. Change it to adopt `data.id` and poll it
  (matching the `?scan=` handoff) — the in-flight scan is exactly what the user wants to
  watch.
- **Terminal error phase:** extend `poll()` — when `d.status === 'error' ||
  d.status === 'cancelled'`, set phase `error` with a message ("SEO scan failed — please
  try again."), clear `sessionStorage['seo-scan-id']`, and stop polling (the effect
  already stops on `phase === 'ready'`; extend the guard to also stop on `error`).
  A persistent non-OK fetch: **404 → terminal error immediately** (audit deleted); other
  non-OK → transient, keep polling.
- **Scope boundary (Codex fix #3):** 2a fixes only **parent-audit** terminal states. A
  permanently-stuck `building` state (audit `complete` but the post-terminal
  `broken-link-verify` never produces `liveScanRunId`) is **legitimately PR 2b** —
  2a does not add a `building`-timeout guard. Documented so it isn't mistaken for an
  omission.

### 4.4 Intent-labeling pass (c) — queue, active-batch member rows, and scan-trigger surfaces

*(Wording per Codex fix #7: this is **not** a "full labeling pass across all history
views." Batch detail is covered transitively through `QueueMemberRow`; batch-summary
aggregates stay unlabeled.)*

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
  Render `<IntentChip seoOnly={s.seoOnly} />` on each schedule row — **the chip is driven
  by `seoOnly`, not `seoIntent`** (Codex fix #5): a legacy full-pipeline `seoIntent:true,
  seoOnly:false` autonomous schedule is an accessibility schedule and must not read as
  "render-only SEO". Both fields exposed on `ClientScheduleRow` (additive).
- **`POST /api/clients/[id]/schedules`** (Codex fix #4): coerce **before** the uniqueness
  check —
  ```ts
  const seoOnly = body.seoOnly === true
  const seoIntent = body.seoIntent === true || seoOnly   // seoOnly ⇒ seoIntent
  ```
  then run the existing `(client, domain, seoIntent)` duplicate check against this
  coerced `seoIntent`, and write `seoOnly` into the payload
  (`{clientId, domain, wcagLevel, seoIntent, seoOnly}`). (If coercion happened only at
  write time, a `{seoOnly:true}`-without-`seoIntent` body would be duplicate-checked as
  an ADA schedule.) Uniqueness key unchanged `(client, domain, seoIntent)`.
- **`scheduled-site-audit.ts`**: add `seoOnly?: boolean` to `ScheduledSiteAuditPayload`
  + `parsePayload`; pass `seoOnly: p.seoOnly ?? false` to `queueSiteAuditRequest`
  (which forces `seoIntent`). Replace the `// FUTURE` breadcrumb with a comment noting
  the flip is now wired for `seoOnly` schedules; full-pipeline stays the default for
  ADA **and** legacy `seoIntent`-only autonomous schedules (never backfilled — additive
  payload field defaults false).
- **`getClientSchedules`** (`lib/services/client-schedules.ts`) — SEO last-run semantics
  (Codex fix #6): parse `seoOnly`/`seoIntent` onto each `ClientScheduleRow`. For a
  `seoOnly` schedule:
  - **Score**: source from the live-scan `seo-parser` `CrawlRun` (the finalizer never
    writes an ada-audit run for seoOnly), not `tool:'ada-audit'`.
  - **Link**: live run exists → `/seo-parser/results/run/${runId}`; audit exists but no
    live run yet → `/seo-parser?scan=${auditId}` (pending); never `/ada-audit/site/:id`.
  - **Delta**: `lastDelta` is the SEO score delta **or null** for 2a — do **not** invoke
    ADA instance-diff (`getRunPairInstanceDiff` rejects non-`ada-audit` runs) and do not
    compute an ADA-style delta from missing ADA runs.

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
- `SeoScanForm.test.tsx`: (1) `?scan=<id>` adopts the id and polls; (2) **`?scan=` wins
  over a stale `sessionStorage['seo-scan-id']`** (Codex fix #8) — different stored id,
  form polls the query-param id and overwrites storage; (3) `status:'error'` → error
  phase + sessionStorage cleared + polling stopped; (4) `status:'cancelled'` same;
  (5) 404 → error; (6) **submit 409-with-id → adopts+polls that id** (not error).
  (`window.location.search` stubbed, or the test navigates with a real search string.)
- `SiteAuditForm.test.tsx`: SEO intent → POST body carries `seoOnly:true` and success
  routes to `/seo-parser?scan=…`, not `/ada-audit/site/…`; ADA intent unchanged; WCAG
  hidden under SEO intent.
- `QuickSiteAuditWidget.test.tsx`: **new SEO 202 (`{id,status}`, no `seoOnly`) routes to
  `/seo-parser?scan=${id}` by local intent** (Codex fix #8); ADA intent → ADA page;
  409 SEO → `/seo-parser?scan=${id}`.
- `ScheduledScansCard.test.tsx`: SEO create → POST body carries `seoOnly:true` +
  `seoIntent:true`; SEO row renders the chip (driven by `seoOnly`); SEO row last-run link
  is `/seo-parser/results/run/…` or `/seo-parser?scan=…`, never the ADA page.
- `schedules/route` test: **`{seoOnly:true}` without `seoIntent` coerces to
  `seoIntent:true` before the uniqueness check** (Codex fix #8) and persists both into the
  payload; `(client, domain, seoIntent)` uniqueness still coexists an ADA + an SEO
  schedule for the same domain.
- `scheduled-site-audit.test.ts`: `seoOnly` payload → `queueSiteAuditRequest` called with
  `seoOnly:true`; absent → full pipeline (`seoOnly:false`).
- `client-schedules` test (Codex fix #8): a `seoOnly` schedule sources its last-run score
  from the live `seo-parser` run and does **not** invoke ADA instance-diff / ADA-style
  delta.
- Labeling components: `IntentChip` renders the correct label for a seoOnly vs ada row;
  each of the 4 §4.4 targets shows the chip.
- Gate: `tsc --noEmit` + `DATABASE_URL=… npm test` + `npm run build`. UI dark-mode +
  no-hydration review on every new element.
