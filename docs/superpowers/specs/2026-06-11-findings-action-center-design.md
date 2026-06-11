# Findings / Action Center (B2) — Design

**Date:** 2026-06-11 · **Status:** Codex-reviewed (accept-with-fixes ×5, all applied)
**Roadmap:** Track B item B2 (`docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md` § Phase 1b)
**Builds on:** A2 findings layer (`../archive/specs/2026-06-10-findings-layer-design.md`) + B1 client dashboard (`../archive/specs/2026-06-11-client-dashboard-mvp-design.md`)

## Problem

The client dashboard (B1) shows *scores* but not *what's wrong*. Answering
"what should we fix for Client X this week?" still means opening the SEO
parser report and the ADA site-audit view separately. A2 built exactly the
table for this — `Finding` is "the single cross-tool query surface" — and B2
is its first dashboard consumer. The fleet table also can't say "something
got worse": score deltas exist, but a new critical issue that doesn't move
the score 10 points is invisible.

## Goals / non-goals

**Goals**

- **Open-findings panel** on `/clients/[id]`: one cross-tool list (SEO +
  ADA) of the client's current issues from their latest runs, sorted by
  severity, with counts, descriptions, and expandable affected-URL
  drill-downs linking to the source reports.
- **Run-over-run trend** per finding: `new` badge and count delta versus the
  previous comparable run, computed from the A2 `dedupKey`/type identity.
- **Regression alerts on the fleet table**: a new `regression` alert kind
  when a client's latest run introduces a critical issue type that the
  previous comparable run didn't have; plus an "Issues" column (open
  critical/warning issue-type counts).
- Pure read layer — **no schema changes, no write-path changes**.

**Non-goals**

- No scheduled scans or scan-triggered alerting — that's C2. B2's regression
  signal uses only the run-over-run history that already exists (handoff
  decision).
- No triage workflow (assign / snooze / mark-fixed). Findings are immutable
  run snapshots; a mutable triage overlay is a separate future item.
- No changes to the tool report views (no query-param deep-filter additions
  to `/seo-parser/results/[id]` or `/ada-audit/site/[id]`); drill-down
  happens in the dashboard panel, with a plain link to the full report.
- No pillar/keyword/PDF/Lighthouse findings — `Finding` rows exist only for
  SEO parses and ADA audits today, and that's what the panel shows.
- No backfill: clients whose only data predates A2 (no `CrawlRun`s) get an
  explanatory empty state.

## Definitions and selection rules

**"Open finding"** = a `Finding` row belonging to the client's **current
run** for a tool. Findings are immutable per-run snapshots; "open" is a
read-time interpretation, not a status column.

**Current-run selection (shared by dashboard and fleet, one pure helper):**

- **SEO:** candidate runs = `CrawlRun` rows with `tool='seo-parser'`,
  excluding runs whose `sessionId` belongs to a `workflow='keyword-research'`
  session (same exclusion as the B1 score series, same accepted
  keyword-orphan gap). Current = max by `completedAt ?? createdAt`.
- **Tie-breaker (Codex fix #5):** all "latest"/"most recent earlier"
  selections order by `(completedAt ?? createdAt)` desc, then `id` desc —
  deterministic under same-timestamp runs and in tests.
- **Multi-domain limitation (Codex fix #1, documented v1 gap):** current
  selection is *latest run per tool/class across the whole client*. A client
  with two active domains shows only the most recently run domain's findings
  in the panel (the other domain's findings are reachable via its own report
  from the timeline). Per-`(tool, domain)` grouped sources are deferred until
  multi-domain clients need single-dashboard review; the source-meta lines
  display the current run's `domain` so the scope is always visible.
- **ADA:** if the client has any `source='site-audit'` run, the ADA class is
  **site** and current = the latest site-audit run; otherwise class is
  **page** and current = the latest page-audit run. (B1's series rule keys
  off *scored* site points; mapper-computed scores are always non-null in
  practice, so the two rules only diverge in a theoretical
  all-site-runs-scoreless case — accepted.)

**Previous-run selection (the diff baseline):**

- Previous = the most recent *earlier* candidate run of the same tool and
  source class **with the same `domain`** as the current run. Domain
  matching matters because one client can have multiple domains, and a
  cross-domain dedupKey diff is garbage. If the current run's `domain` is
  null, previous = none.
- **Page-class ADA runs get no previous** (standalone audits of different
  URLs aren't comparable; not worth special-casing same-URL detection in
  v1). Panel shows current findings without trend badges.

**Trend granularity:** diffs are computed at the **issue-type level**
(`Finding.type`), not the per-URL dedupKey level. Rationale: SEO page-scope
URL sets are samples when `affectedComplete=false` (A2 spec: "diff consumers
must treat the run-scope row as the authoritative count"), so URL-level
new/resolved would lie for sampled types. Type-level presence + count delta
is always honest. Per-URL diffing arrives with C3 (relational ADA diffing).

## Architecture

Three layers, mirroring B1 exactly:

```
lib/services/findings-shared.ts     pure helpers (no prisma) — run selection,
                                    type aggregation, diffing, row building
lib/services/client-findings.ts     dashboard read service (DB)
lib/services/client-fleet.ts        extended: issues counts + regression alerts
components/clients/FindingsPanel.tsx  dashboard panel (client component)
components/clients/FleetTable.tsx     extended: Issues column + regression badge
lib/services/scorecard-shared.ts      computeAlerts gains the regression input
```

All reads are against normalized A2 tables (`CrawlRun`/`Finding`/
`Violation`) — **zero blob readers added**, so the A2 `PRUNE_ACTIVATED`
plan is unaffected. (The scalar-only invariant forbids *blob* reads;
findings tables are the blessed read surface — reading them is the point
of A2.)

### `lib/services/findings-shared.ts` (pure)

```ts
export const URLS_PER_FINDING = 25

export interface RunRef {
  id: string; tool: string; source: string; domain: string | null
  completedAt: Date | null; createdAt: Date
  sessionId: string | null; siteAuditId: string | null; adaAuditId: string | null
}

// Current + previous per the selection rules above. keywordSessionIds
// excludes keyword-research runs from the SEO candidates.
export function selectRuns(runs: RunRef[], keywordSessionIds: Set<string>): {
  seo: { current: RunRef | null; previous: RunRef | null }
  ada: { current: RunRef | null; previous: RunRef | null; sourceClass: 'site' | 'page' | null }
}

export interface TypeAggregate {
  type: string
  severity: 'critical' | 'warning' | 'notice' // max across rows for ADA groups
  count: number          // SEO: run-scope Finding.count; ADA: distinct URL rows
}

// SEO: run-scope rows pass through. ADA: group page-scope rows by type,
// severity = max, count = row count (rows are unique per (type,url)).
export function aggregateSeoTypes(
  runScopeRows: { type: string; severity: string; count: number }[],
): TypeAggregate[]
export function aggregateAdaTypes(
  pageScopeRows: { type: string; severity: string }[],
): TypeAggregate[]

export interface TypeDiff { newTypes: Set<string>; resolvedCount: number; countDelta: Map<string, number> }
// null previous → no badges (all isNew false, deltas null), resolvedCount 0.
export function diffTypes(current: TypeAggregate[], previous: TypeAggregate[] | null): TypeDiff

export type Severity = 'critical' | 'warning' | 'notice'
export const SEVERITY_RANK: Record<Severity, number>
```

### `lib/services/client-findings.ts` (dashboard read service)

`getClientFindings(clientId: number): Promise<ClientFindings>`

Queries (all batched, scalar/normalized only):

1. `session.findMany({ where: { clientId }, select: { id, workflow } })` —
   keyword exclusion set.
2. `crawlRun.findMany({ where: { clientId }, select: { id, tool, source,
   domain, completedAt, createdAt, sessionId, siteAuditId, adaAuditId } })`.
3. → `selectRuns`. Then for the up-to-4 selected run ids:
   - run-scope SEO findings for current+previous SEO runs
     (`scope: 'run'`, select `runId, type, severity, count, detail,
     affectedComplete`),
   - page-scope rows for the **current** runs only (`scope: 'page'`, select
     `runId, type, severity, url`) — drives ADA aggregation + URL
     drill-downs for both tools,
   - for diffing the previous ADA run: `finding.groupBy({ by: ['type'],
     where: { runId: prevAdaRunId }, _count })` (type presence + counts;
     no URLs loaded for previous runs). **Severity is intentionally absent
     from the previous-run shape (Codex fix #4)** — diffs compare type
     presence and counts only; severity always comes from the current run,
   - `violation.findMany({ where: { runId: currentAdaRunId }, select:
     { ruleId, help, helpUrl }, distinct: ['ruleId'] })` — ADA row
     descriptions (axe `help` text; `detail` is null on ADA findings).

Output:

```ts
export interface OpenFindingRow {
  tool: 'seo' | 'ada'
  type: string                  // seo issue id | axe ruleId
  severity: Severity
  count: number
  countDelta: number | null     // vs previous comparable run; null when no previous
  isNew: boolean                // type absent in previous run (false when no previous)
  description: string | null    // SEO: detail.description; ADA: Violation.help
  helpUrl: string | null        // ADA only
  urls: string[]                // affected URLs, capped at URLS_PER_FINDING
  totalUrls: number             // uncapped page-scope row count
  isSample: boolean             // SEO: affectedComplete !== true (see completeness rule)
  href: string | null           // deep link to the source report (null if origin expired)
}

export interface SourceRunMeta {
  runAt: string                 // ISO, completedAt ?? createdAt
  href: string | null           // /seo-parser/results/:id | /ada-audit/site/:id | /ada-audit/:id
  domain: string | null
  hasPrevious: boolean
  newTypeCount: number
  resolvedTypeCount: number
}

export interface ClientFindings {
  rows: OpenFindingRow[]        // both tools, sorted severity rank → count desc → type
  seo: SourceRunMeta | null     // null when no current run
  ada: (SourceRunMeta & { sourceClass: 'site' | 'page' }) | null
}
```

Notes:

- SEO rows come from **run-scope** findings (count is authoritative); their
  `urls` come from the current run's page-scope rows of the same type.
  `totalUrls` = page-scope row count, which for sampled types is less than
  `count` — the UI shows `count` as the number and marks the URL list
  "(sample)" when `isSample`.
- **Completeness is three-state (Codex fix #2):** `affectedComplete` is
  nullable in the schema and the mapper writes `affectedUrlRefsComplete ??
  null`. The rule is `isSample = affectedComplete !== true` — `false` AND
  `null`/unknown both mark the URL list "sample/partial"; only an explicit
  `true` may present the list as complete. (Display nuance: when
  `affectedComplete !== true` but `totalUrls === count`, the list happens to
  be full — the label still says "sample/partial" because completeness was
  never asserted.)
- ADA rows come from grouping page-scope rows; `count === totalUrls`.
- `href` per row = the tool report (`/seo-parser/results/[sessionId]`,
  `/ada-audit/site/[siteAuditId]`, `/ada-audit/[adaAuditId]`) — null when
  the origin row expired (SetNull); the row still renders.
- Expected volume: ~50–72 run-scope + ~280 page-scope rows for a typical
  parse, ~120 page-scope for a typical site audit; worst case a few
  thousand small rows. Single-request server render is fine.

### Fleet integration (`client-fleet.ts` + `scorecard-shared.ts`)

- `crawlRun.findMany` select gains `id` and `domain`.
- After the existing per-client loop inputs are loaded, compute
  current+previous run ids for **all** clients via `selectRuns`, then two
  batched queries across all selected run ids:
  - `finding.findMany({ where: { runId: { in: seoRunIds }, scope: 'run' },
    select: { runId, type, severity, count } })`
  - `finding.groupBy({ by: ['runId', 'type', 'severity'], where: { runId:
    { in: adaRunIds } }, _count })`
- **ADA collapse rule (Codex fix #3):** the groupBy result is then collapsed
  in JS to ONE aggregate per `(runId, type)` taking the **max severity**
  before any type counting — a rule whose violations map to mixed severities
  must not be double-counted in `openCriticalTypes`/`openWarningTypes` or
  produce duplicate entries in `newCriticalTypes`. (Same collapse the
  dashboard's `aggregateAdaTypes` performs.)
- Per client, derive:
  - `openCriticalTypes` / `openWarningTypes` — distinct issue-type counts
    across both tools' current runs (new `FleetRow` fields, rendered as an
    "Issues" column: `3C 7W` chips, sortable by critical count).
  - `newCriticalTypes: string[]` — critical types present in a current run
    but absent from that tool's previous comparable run (requires a
    previous; otherwise empty).
- `computeAlerts` gains `newCriticalTypes: string[]` in its args and pushes
  `{ kind: 'regression', detail: 'N new critical issue type(s)' }` when
  non-empty. `AlertKind` union gains `'regression'`; `FleetTable`'s
  `ALERT_CLASSES` gains a style for it (purple family — distinct from
  score-drop amber and error red). Count *increases* of an existing
  critical type do NOT alert in v1 (noise control; revisit with C2/C3).
- Query count grows from 6 to 8 batched queries; type-level aggregates
  only, no URL loading on the fleet path.

### `components/clients/FindingsPanel.tsx`

Client component, **local prop interfaces** (repo convention — no imports
from server-only services). Rendered on `/clients/[id]` between the
scorecard grid and `IssueTrendCard`, full width, card-styled like the rest
of the dashboard (`bg-white dark:bg-navy-card rounded-xl border …`).

- Header: "Open Findings" + per-source context lines ("SEO · example.com ·
  2d ago · +2 new / 1 resolved" with the report link) when `seo`/`ada`
  meta is present.
- Rows: severity chip (reuse the existing red/orange/blue severity styling
  from `RecommendationsPanel`/B1 chips), tool badge (`SEO`/`ADA`),
  humanized type (`replace(/_/g,' ')` capitalize — same `humanize` shape as
  `RecommendationsPanel`; axe ruleIds humanize fine: `color-contrast` →
  "Color contrast"), count ("N pages"/"N URLs"), `NEW` badge when `isNew`,
  delta chip (`▲ +3` red / `▼ −2` green — *worse is red*: count going UP is
  bad, the inverse of score deltas), description line.
- Expansion: chevron toggles an affected-URL list (`urls`, capped at 25;
  footer "Showing 25 of N — view full report →" when `totalUrls > 25` and
  `href` exists; "(sample)" annotation when `isSample`).
- Empty states:
  - No `CrawlRun`s at all → "No findings data yet — findings populate from
    runs after 2026-06-10. Run a parse or audit to see issues here."
  - Current runs exist but zero findings → positive "No open findings"
    state.

No new API routes; everything server-rendered through the page's existing
force-dynamic data flow (`/clients/[id]/page.tsx` adds a third parallel
`getClientFindings(clientId)` call).

## Error handling

- Read-only feature: a service failure fails the page render (same posture
  as B1's services — no special degradation path).
- `detail` JSON parse wrapped in try/catch (returns null description).
- Origin-expired runs (`sessionId`/`siteAuditId`/`adaAuditId` null) render
  rows without links — never a dangling href (B1 invariant).

## Testing

- **findings-shared (pure, no DB):** run selection — keyword exclusion,
  domain-matched previous, cross-domain non-match, ADA site-class
  precedence, page-class no-previous, same-timestamp tie-breaker (`id`
  desc); aggregation — ADA max-severity grouping (incl. mixed-severity
  collapse to one aggregate per type), count semantics; diffing — new
  types, resolved count, count deltas, null previous; `isSample` three-state
  (`true`→complete, `false`→sample, `null`→sample).
- **client-findings (DB-backed, unique domain prefix, clean `CrawlRun` by
  domain BEFORE origin rows):** end-to-end shape on seeded runs — SEO
  run-scope + URL attachment + sample flag, ADA grouping + Violation help
  join, URL cap, expired-origin null href, sort order, both empty states.
- **client-fleet (DB-backed):** Issues counts, regression alert presence/
  absence (no previous run → no alert), select-shape regression guard.
- **computeAlerts:** regression kind emitted/suppressed.
- **FindingsPanel:** render tests — severity/tool/NEW/delta badges, sample
  annotation, expansion, both empty states, no-href row.
- Full suite + `tsc --noEmit` + build green before merge.

## Alternatives considered

- **Fetch-on-expand API route** for affected URLs (lighter initial
  payload): rejected — adds an API route + client fetch state for a payload
  that's already bounded (caps at 25 URLs × ~70 types worst case); the
  panel renders from one server pass like the rest of the dashboard.
- **Materialized open-findings summary table** maintained by the dual-write
  hooks: rejected — precomputation isn't needed at 30 clients, and it would
  push B2 complexity into A2's carefully-bounded write path.
- **URL-level (dedupKey) diffing in the panel:** rejected for v1 — lies for
  `parser-sample` types; type-level presence + count delta is always
  honest. dedupKey-level diffing is C3's job with proper ADA semantics.
- **Reusing the B1 ADA *scored-points* rule for findings-class selection:**
  rejected — findings don't need scores; "any site-audit run exists" is
  simpler and diverges only in a theoretical scoreless case.

## Invariants respected (load-bearing — do not relitigate)

- No blob readers added anywhere (`PRUNE_ACTIVATED` plan unaffected); reads
  are `CrawlRun`/`Finding`/`Violation` + scalar session columns only.
- No write paths touched; no schema changes; no migrations.
- Keyword-research runs excluded from SEO selection via the session-workflow
  join (keyword-orphan gap accepted, same as B1).
- Client components define local prop interfaces.
- Deep links never dangle (origin-expired rows render link-less).
- Array-form-transaction rule untouched (read-only feature).
