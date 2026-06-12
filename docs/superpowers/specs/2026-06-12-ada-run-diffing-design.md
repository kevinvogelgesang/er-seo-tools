# C3 — ADA run-over-run diffing + regression surfacing + blob-archive activation

**Date:** 2026-06-12 · **Status:** Codex-reviewed (accept-with-named-fixes ×6, all applied)
**Roadmap:** Track C item C3 (`docs/superpowers/nyi/improvement-roadmaps/02-ada-audit.md` Phase 3) · needs A2 ✓
**Tracker:** `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`

---

## 1. Scope reconciliation (what already exists vs what C3 adds)

The 02-doc's Phase 3 ("Relational violations, blob becomes archive") predates
A2/B2/C2. Verified current state:

**Already shipped:**
- **Relational violations (A2):** every completed audit dual-writes
  `CrawlRun → CrawlPage / Finding / Violation`. ADA page-scope `Finding` rows
  are unique per (page×rule) via `dedupKey = sha256({scope:'page', type, url})`
  (`lib/findings/keys.ts`), with a 1:1 `Violation` row carrying exact axe
  impact, wcagTags, help/helpUrl, nodeCount, and nodes capped 5×300 chars.
- **Type-level diffing + regression chips (B2):** `selectRuns()` /
  `diffTypes()` / `newCriticalTypes()` in `lib/services/findings-shared.ts`;
  dashboard trend header (+N new / M resolved types), NEW badges, fleet
  `regression` alert.
- **Score-level deltas (C2):** `ScheduledScansCard` shows last-run score + Δ
  from `CrawlRun.score`.
- **Retention machinery (A2 Phase 4):** `pruneArchivedBlobs()` (90-day origin
  blob archive) registered in `runCleanup()`, **INERT** —
  `PRUNE_ACTIVATED['ada-audit'] = false`. Scope today is origin blobs only
  (`SiteAudit.summary`, standalone `AdaAudit.result`); `retention.ts:14-17`
  explicitly defers the child-blob decision to the PR that flips the flag —
  this PR.

**What C3 adds (the gap):**
1. **Instance-level (URL×rule) run-over-run diffing** — new / resolved /
   unchanged violation instances, with page-set-aware classification.
2. **Regression surfacing beyond type-level chips** — a "changes since
   previous audit" panel on the site-audit results page, new/resolved chips
   on `ScheduledScansCard`, instance counts on the dashboard ADA source line.
3. **Blob-reader flips + `PRUNE_ACTIVATED['ada-audit'] = true`** — every
   surface that reads `SiteAudit.summary` or `AdaAudit.result` must tolerate a
   pruned blob by serving from the normalized tables; retention extended to
   child `AdaAudit.result` blobs + screenshot artifacts. The flip lands in
   this same PR (the A1/A2 "last blob reader" pattern).
4. **Daily-cadence decision (C2 gate)** — decided: **stays gated** (§ 8).

## 2. Goals / non-goals

**Goals**
- Honest instance-level diff semantics: distinguish "regressed" from
  "new page scanned", and "resolved" from "page not re-scanned".
- All ADA read surfaces survive a pruned blob with graceful degradation;
  >90-day-old audits remain viewable (scores, violations, per-page detail
  capped at 5 nodes) forever via the findings tables.
- DB growth becomes managed: origin + child blobs pruned at 90 days,
  screenshots cleaned with them. Violation rows are kept forever (trends).

**Non-goals**
- Standalone page-audit diffing (B2's rule stands: different-URL page audits
  aren't comparable; same-URL standalone diffing is a possible follow-up).
- Fleet-wide instance-level diffing on `/clients` (cost: full finding-key
  loads for 2 runs × every client on one server render; type-level alert
  already catches new critical types). Fleet stays type-level — documented.
- Notifications/email alerts (B2 left these "later"; unchanged).
- Score formula changes (C9), reporting/PDF/CSV (C4), nightly fleet scans (C6).
- Backfilling findings for pre-A2 audits (A2 invariant: never backfill).

## 3. Decisions (with alternatives considered)

### D1 — Diff key: `Finding.dedupKey` set-difference, page-set aware
The dedupKey already hashes (scope, type, normalized URL) and is unique per
run — two runs of the same domain produce directly comparable key sets.
Classification for ADA page-scope findings of current run C vs previous run P
(complete-page URL sets `pagesC`, `pagesP` from `CrawlPage.status='complete'`):

| Instance | Condition | Class |
|---|---|---|
| in C, not in P, url ∈ pagesP | page was scanned clean before | **regressed** (new) |
| in C, not in P, url ∉ pagesP | page wasn't scanned before | **new-page** (new) |
| in P, not in C, url ∈ pagesC | page re-scanned, violation gone | **resolved** |
| in P, not in C, url ∉ pagesC | page absent from current crawl | **not-rescanned** |
| in both | | **unchanged** |

*Alternatives rejected:* raw (type,url) join (re-implements what dedupKey
already encodes); node-level diffing (nodes are capped at 5 and DOM-content
volatile — false churn).

### D2 — Summary strategy: keep finalize-time write, add read-time fallback
`buildSiteAuditSummary()` keeps running at finalization on fresh child blobs
(full fidelity: passes/incomplete, commonIssues ancestor/selector hints).
Readers go **blob-first, findings-fallback**: when a complete audit's
`summary` is null and its `CrawlRun` exists, a new
`buildSummaryFromFindings(siteAuditId)` reconstructs a degraded
`SiteAuditSummary` from `CrawlPage`/`Violation` rows + unpruned scalars
(child `lighthouseSummary`, `PdfAudit` rows).

*Alternative rejected:* always compute summary at read time and stop
persisting the blob ("cheap aggregate query" per the 02-doc). That would
degrade **all** pre-C3 audits immediately (no passCount columns), make the
view dependent on the best-effort dual-write for fresh audits, and touch the
finalizer. Pruning achieves the 02-doc's actual motivation (DB growth) with
blob-first fidelity for 90 days.

### D3 — Extend pruning to child blobs + screenshots
The real DB weight is child `AdaAudit.result` rows (~150 × 200–500 KB per
site audit), not the one summary blob. The ada-audit pass of
`pruneArchivedBlobs()` additionally nulls `result` on child rows
(`siteAuditId IN (pruned site audits)`) in the same array-form transaction
chunk, and best-effort deletes screenshot artifacts
(`deleteAuditArtifacts(childId)` / standalone id) after the transaction
commits. Per-page expansion and standalone views fall back to a degraded
axe-results shape built from `Violation` rows (§ 5.3).

### D4 — Daily cadence stays gated (C2 gate, decided here)
Pruning at 90 days does not reduce **within-window** volume: daily scans of a
150-page site under C2's 14-day scheduled retention hold ~14 full-blob audits
≈ 0.5–1 GB per client — 2–3× today's entire DB for one client. Enabling daily
safely needs supersede-based blob trimming (keep blobs only on the latest
N audits per schedule), which is C6's design space (nightly Live-SEO
substrate). The CRUD route's `cadence_not_allowed` gate stays; this spec
updates its rationale comment.

### D5 — Surfacing scope
- **Site-audit results page** (`/ada-audit/site/[id]`, complete view): a
  "Changes since previous audit" panel — headline counts (new = regressed +
  new-page, resolved, unchanged, not-rescanned) + per-rule breakdown with
  severity, NEW-rule badge, capped URL samples (reuse `URLS_PER_FINDING=25`).
- **ScheduledScansCard**: `+N new / −M resolved` instance chips next to the
  existing score Δ (computed between the last two completed scheduled runs).
- **Dashboard FindingsPanel ADA source line**: one added clause —
  "+N / −M violations vs previous" (instance-level) alongside the existing
  type-level "+x new / y resolved" types.
- Fleet table/alerts: unchanged (type-level, § 2 non-goal).

## 4. Diff engine

### 4.1 Pure classifier — `diffInstances()` in `lib/services/findings-shared.ts`
```ts
interface InstanceRef { dedupKey: string; type: string; severity: string; url: string }
interface InstanceDiff {
  newCount: number; regressedCount: number; newPageCount: number
  resolvedCount: number; notRescannedCount: number; unchangedCount: number
  rules: RuleInstanceDiff[]   // per type, sorted severity rank then newCount desc
}
interface RuleInstanceDiff {
  type: string
  severity: Severity            // current run's severity; previous run's for resolved-only rules
  newUrls: string[]             // capped URLS_PER_FINDING, deduped+sorted; regressed first
  newTotal: number; regressedTotal: number
  resolvedUrls: string[]        // capped
  resolvedTotal: number
  unchangedTotal: number
}
function diffInstances(
  current: InstanceRef[], previous: InstanceRef[],
  currentPages: Set<string>, previousPages: Set<string>,
): InstanceDiff
```
No prisma, no I/O — same contract as the rest of `findings-shared.ts`.
Note: unlike B2's `diffTypes` (previous severity intentionally absent),
`previous` here carries severity so resolved-only rules can render with a
severity pill; current-run severity always wins when both exist.

### 4.2 DB service — `lib/services/site-audit-diff.ts`
`getSiteAuditInstanceDiff(siteAuditId)`:
1. Load the audit's `CrawlRun` (`siteAuditId` unique FK). No run (pre-A2 or
   dual-write failure) → `null` (panel hidden).
2. **Previous-run selection** — domain-scoped, client-agnostic (the results
   page has no client context; domain is the identity):
   most recent `CrawlRun` with `tool='ada-audit'`, `source='site-audit'`,
   same `domain`, same `wcagLevel`, strictly earlier than the current run by
   B2's ordering (`completedAt ?? createdAt` desc, id-desc tie-break —
   reuse `domainMatchedPrevious` semantics, anchored at this run rather than
   the latest). No previous → `null`.
   - `wcagLevel` must match: a wcag22aa run vs a wcag21aa baseline produces
     false "new" instances for rules only checked at 22aa. This is stricter
     than B2's type-level selection (which ignores wcagLevel) — intentional
     for instance honesty; documented divergence.
3. Query both runs' ADA page-scope `Finding` rows
   (`dedupKey,type,severity,url`) + both runs' complete `CrawlPage` URLs;
   classify via `diffInstances()`.
4. Return `{ diff, previous: { runId, siteAuditId, completedAt } }` so the
   panel can link to the baseline audit.

The same service exposes `getRunPairInstanceDiff(currentRunId, previousRunId)`
(steps 3–4 only) for callers that already selected the pair:
- **wcagLevel comparability is enforced here, for every caller** (Codex fix
  #1): if the two runs' `wcagLevel` differ, the function returns `null`
  (not comparable) — instance counts are simply omitted on that surface.
  B2's type-level chips stay level-agnostic as shipped; instance-level
  counts never render across a level mismatch.
- `client-findings.ts` (dashboard): B2's `selectRuns()` already picked
  current+previous ADA site runs — reuse that pair; the clause is omitted
  when the pair's levels differ or either run lacks findings.
- `client-schedules.ts` (card): the last two completed scheduled audits per
  schedule (the same pair the score Δ uses), via their CrawlRuns; either run
  missing findings or levels differing → chips omitted.

## 5. Blob-archive activation (reader flips)

### 5.1 Schema: pass/incomplete counts
`CrawlPage` gains `passCount Int?` and `incompleteCount Int?` (migration
`20260612100000_c3_pass_counts`). `ada-mapper.ts` populates them from the
fresh blob (`passes.length` / `incomplete.length`) for site-audit children
and standalone audits. Null = unknown (all pre-C3 runs); UI renders "—".
`scripts/findings-rebuild.ts` picks the new fields up automatically (it goes
through the same mapper) for any run whose origin blob still exists.

Full mapping surface (Codex fix #5): `prisma/schema.prisma`, the findings
bundle types (`lib/findings/types.ts`), **both** ADA mapper paths
(`mapAdaChildren` + `mapAdaSingle`), `lib/findings/writer.ts` (page create
data), and `lib/findings/parity.ts` (compare passCount/incompleteCount
against the blob when both sides are present; skip when null).

### 5.2 `buildSummaryFromFindings(siteAuditId)` — degraded `SiteAuditSummary`
New module `lib/ada-audit/findings-fallback.ts` (houses both § 5.2 and § 5.3
builders). Input: a complete
`SiteAudit` whose `summary` is null but whose `CrawlRun` exists. Builds:
- `pages[]`: one `SitePageResult` per `CrawlPage` (url, status mapped back,
  `adaAuditId` drill-through, scorecard from that page's `Violation` impact
  counts — the numeric `AuditScorecard` shape is untouched; unknown
  passed/incomplete are carried in a separate per-page (and aggregate)
  `archivedCounts: { passed: number | null; incomplete: number | null }`
  that drives "—" rendering, never coerced to a literal 0 (see § 5.3 render
  contract, Codex fix #4), `violationIds` from its Violations' ruleIds, lighthouse parsed
  from the child `AdaAudit.lighthouseSummary` (separate column, never
  pruned), pdf state recomputed from the child's `PdfAudit` rows — same
  logic as `buildSiteAuditSummary`, extracted/shared where cheap).
- `aggregate`: sum of page scorecards (passed/incomplete summed only over
  non-null pages).
- `commonIssues`: recomputed from `Violation` rows — affected-page counts and
  tiers are **exact** (groupBy ruleId over pages); `sharedAncestor` /
  `canonicalSelector` hints are best-effort from the capped `Violation.nodes`
  targets and may come back null (they are already "best-effort" by
  contract). Implemented as a thin adapter feeding the existing pure voting
  helpers in `common-issues.ts` — no second algorithm.
- The returned summary carries `archived: true` (new optional field on
  `SiteAuditSummary`); `SiteAuditResultsView` shows an "Archived audit —
  full detail pruned after 90 days" banner and renders passed/incomplete as
  "—" where unknown.

Redirected/error pages: reconstructed from `CrawlPage.status` the same way
the live builder emits minimal rows.

### 5.3 `buildArchivedAxeResults(adaAuditId)` — degraded `StoredAxeResults`
Second builder in `lib/ada-audit/findings-fallback.ts`:
find the `CrawlPage` with `adaAuditId` (covers both standalone single-page
runs and site-audit children — `mapAdaSingle`/`mapAdaChildren` both stamp
it), load its `Violation` rows, synthesize:
```
{ violations: [{ id: ruleId, impact, help, description: help, helpUrl,
                 tags: parsed wcagTags, nodes: parsed capped nodes }],
  passes: [], incomplete: [], archived: true,
  archivedCounts: { passed: passCount ?? null, incomplete: incompleteCount ?? null } }
```
**Render contract (Codex fixes #3/#4):** the shared `AuditScorecard` type
(`lib/ada-audit/types.ts`) and `addScorecards()` stay strictly numeric —
no half-widening. Archived builders emit the numeric scorecard with known
values (or 0) **plus** a separate nullable
`archivedCounts: { passed: number | null; incomplete: number | null }`
(on the synthesized result in § 5.3; per-page and aggregate on the § 5.2
summary). `StoredAxeResults` gains optional `archived` /`archivedCounts`
fields; `AuditResultsView.buildScorecard()` is bypassed (or short-circuited)
when `archived` is set so `archivedCounts` drives the display — `passes: []`
must never render as a literal `0`. Consumers branch on `archived`: banner,
no screenshots (degraded nodes carry no `screenshotPath`), passed/incomplete
render the archived count or "—" when null, no domElementCount reliability
warning. Triage-check rendering degrades
gracefully: check keys are content hashes of full node HTML, which capped
nodes won't reproduce — checks simply don't attach on archived audits
(documented; checks are an analyst workflow for fresh audits).

### 5.4 Per-surface flip table

| Surface | Today | After C3 |
|---|---|---|
| `GET /api/site-audit` (list score) | parses `summary.aggregate` | prefer `crawlRun.score` (same formula, mapper-computed); blob parse only when no run (pre-A2) |
| `GET /api/audit-batches/[id]` | same | same flip |
| `lib/ada-audit/recents-query.ts` (`siteScore`/`pageScore`) | parses blobs | prefer `crawlRun.score`; blob fallback pre-A2 |
| `GET /api/site-audit/[id]` | `summary` or null | complete + null summary + run exists → `buildSummaryFromFindings` |
| `/ada-audit/site/[id]` page | null summary → "Result data is unavailable" | fallback summary first; unavailable copy only when no run either |
| `GET /api/clients/audit-summary` | parses full summary | prefer `crawlRun.score` for the score; summary fields from blob-or-fallback |
| `GET /api/ada-audit` (list counts/score) | parses each `result` | prefer `crawlRun.score`; blob fallback pre-A2 |
| `GET /api/ada-audit/[id]` | returns parsed `result` | null result + complete + page row exists → `buildArchivedAxeResults` |
| `/ada-audit/[id]` page + `/ada-audit/share/[token]` | parse `result` directly | same fallback + archived banner |
| `/ada-audit/[id]` `?from=` previous-score lookup (page.tsx selects the baseline audit's `result` + `wcagLevel`) | parses previous blob for the comparison score | prefer the baseline's `crawlRun.score`; blob parse fallback pre-A2 (Codex fix #2) |
| Recents **consumers** — `/ada-audit` page, `/ada-audit/recents`, `GET /api/ada-audit/recents` | render `recents-query.ts` output | no code change beyond the query flip above; pinned by tests so a future consumer doesn't re-add a blob parse (Codex fix #2) |
| `SiteAuditResultsView` page-row expansion → `GET /api/ada-audit/[id]` | the main child-blob reader | covered by that route's fallback; pinned by an explicit pruned-child expansion test (Codex fix #2) |
| In-flight live-children, finalize-time `buildSiteAuditSummary`/`detectCommonIssues`, PDF dispatch | fresh blobs | **unchanged** — blobs are always present within 90 days; pruning never touches non-terminal or recent rows |
| `lib/findings/parity.ts` / rebuild script | read blobs | unchanged; pruned runs are no longer parity-checkable/rebuildable (inherent to archiving, accepted in A2 Phase 4) |

### 5.5 Retention extension + flip
In `pruneArchivedBlobs()`'s ada-audit pass, per chunk:
- existing: null `SiteAudit.summary` + origin `AdaAudit.result`, stamp
  `archivePrunedAt` (one array-form `$transaction`).
- **added to the same transaction:** `adaAudit.updateMany({ where:
  { siteAuditId: { in: siteAuditIds } }, data: { result: null } })`.
- **snapshot-based artifact deletion (Codex fix #6):** the affected child +
  standalone audit IDs are collected with a query **before** the
  transaction; after the transaction commits, `deleteAuditArtifacts()` runs
  best-effort (`Promise.allSettled`, failures logged, never thrown) over
  that snapshot only — never a directory sweep, so screenshots of recent /
  non-pruned / in-flight audits can't be touched (pinned by test).
  Screenshots are referenced only by `screenshotPath` strings inside the
  blobs being nulled; keeping them would orphan disk forever.
- flip `PRUNE_ACTIVATED['ada-audit'] = true` — same PR as all reader flips
  above, honoring the A1/A2 pattern. (`'seo-parser'` stays false; its last
  blob readers are C5's business.)

Activation is retroactive by design: the first cleanup tick after deploy
prunes every eligible run older than 90 days (today that is a small set —
findings rows only exist since 2026-06-10; runs become eligible from
~2026-09-08). No migration backfill, no behavior change for blob-bearing rows.

## 6. UI

- **`SiteAuditDiffPanel`** (new, `components/ada-audit/`): rendered by the
  results page server component (diff computed server-side, passed as prop).
  Headline chips: `N new` (red, split "x regressed · y on new pages"),
  `M resolved` (green), `K unchanged` (muted), `J not re-scanned` (muted,
  only when > 0). Per-rule rows reuse FindingsPanel visual language
  (severity pills, NEW badge when the rule itself is type-level-new,
  expandable URL lists with cap footer, link to baseline audit). Panel
  hidden when no previous run exists; an explanatory empty line when the
  previous run exists but both sets are empty ("No accessibility changes vs
  the audit of <date>").
- **`ScheduledScansCard`**: next to the score Δ chip, `+N` / `−M` instance
  chips (red/green, hidden when diff unavailable). Service shape:
  `lastRun.newCount` / `lastRun.resolvedCount` (nullable).
- **`FindingsPanel` ADA `SourceLine`**: appended clause
  `· +N / −M violations` (instance-level), only when previous exists.
- Archived banners per § 5.2/5.3.
- Dark mode: all new UI uses the established `dark:` variant mapping.

## 7. Testing

- **Pure:** `diffInstances` classification matrix (all five classes,
  cap/dedup/sort of URL samples, severity sourcing for resolved-only rules,
  empty/clean-run edges: previous clean run → all new-regressed; identical
  runs → all unchanged).
- **Service (DB-backed, house test rules: unique domain prefixes, tracked-id
  cleanup, CrawlRun cleaned by domain before origin rows):**
  previous-run selection (domain match, wcagLevel match, id-desc tie-break,
  no-previous, pre-A2 no-run), pair diff for schedules/dashboard reuse,
  **level-mismatched pair → null on every caller** (Codex fix #1).
- **Fallback builders:** summary-from-findings vs a real
  `buildSiteAuditSummary` output on the same seeded audit (scorecard counts,
  violationIds, pdf/lighthouse passthrough, commonIssues counts exact +
  hints nullable, archived flag); archived axe-results shape; passCount
  null → "—" contract.
- **Retention:** child blobs nulled with parents, scalars + lighthouse
  summaries kept, screenshots artifact call made per child (mocked fs),
  flip-on behavior, seo-parser still inert, recent rows untouched.
- **Routes:** each flipped surface — blob present (unchanged behavior), blob
  pruned (fallback served), pre-A2 (no run: legacy/unavailable copy);
  explicit cases for the `?from=` previous-score lookup, the recents
  consumers (pinning no-blob-parse), the pruned-child page-row expansion,
  and the archivedCounts render contract (empty `passes` never renders as
  literal 0),
  middleware untouched (no new public routes — all new data flows through
  existing cookie-gated surfaces and server components; pin with the
  existing middleware test conventions if any new route is added).
- **UI:** panel render states (no-previous hidden, clean diff, mixed diff),
  card chips, source-line clause.
- **Mapper:** passCount/incompleteCount populated; rebuild picks them up.

## 8. Invariants honored (do not relitigate)

- Array-form `$transaction` only; conditional logic in SQL; manual
  `updatedAt` in raw statements.
- Findings hook stays LAST in `finalizeSiteAudit`; hook order untouched.
- Dual-write stays best-effort; a findings failure never fails the legacy
  path; never backfill blobs.
- `pruneScheduledSiteAudits` (C2) semantics untouched — it deletes
  schedule-originated terminal rows; this spec's pruning only nulls blob
  columns on runs ≥90 days old, manual or scheduled alike, and never
  deletes rows.
- Scheduled-scan invariants (C2), standalone-ADA invariants (C1), job-queue
  invariants (A1) — untouched code paths.
- `SiteAudit.score` stays never-persisted; all score reads flip toward
  `CrawlRun.score`.
- Daily cadence stays gated (`cadence_not_allowed`) — § D4.

## 9. Risks / limitations

- **Sitemap churn noise:** pages entering/leaving the crawl shift counts
  between new-page/not-rescanned buckets rather than polluting
  regressed/resolved — that is the point of D1's page-set awareness.
- **wcagLevel divergence:** B2's *type-level* chips stay level-agnostic as
  shipped, but *instance-level* counts never render across a level mismatch
  on any surface — `getRunPairInstanceDiff` returns `null` for mismatched
  pairs (§ 4.2, Codex fix #1). A client who switches audit level simply sees
  no instance clause until two same-level runs exist.
- **Degraded archived views:** capped nodes (5), no screenshots, no triage
  checks, "—" pass counts for pre-C3 runs. Accepted: these are >90-day-old
  audits whose full-fidelity window has passed; violations data is exact.
- **`AdaAudit` rows have no TTL** (pre-A2 rows with blobs are untouched by
  pruning — they have no CrawlRun). Unchanged from A2; out of scope.
- **First prune after flip** is a no-op until ~2026-09-08 (oldest findings
  rows are 2026-06-10), so the flip carries no immediate production risk;
  the reader fallbacks are still fully testable via seeded pruned rows.

## 10. Out of scope / follow-ups

- Same-URL standalone-audit diffing; fleet instance-level diffing.
- Supersede-based blob trimming for daily/nightly cadences → C6.
- `seo-parser` PRUNE flip → C5 (source-agnostic ingestion).
- C4 reporting layer consumes `InstanceDiff` for trend sections — shapes
  here are its inputs; no C4 work in this PR.
