# ADA Audit — Common Issue Callout — Design Spec

**Date:** 2026-05-20
**Status:** Approved for implementation planning
**PR:** 5 of the ADA Audit UX Overhaul series

## Goal

When a site audit completes, detect violation rules that appear on a large fraction of scanned pages and surface them in a dedicated callout at the top of the Pages with Issues section. Each card tells the operator: which rule fired, how many pages it affects, and — when detectable from the stored CSS selector data — which shared template region (header, footer, nav, etc.) is the likely source. The message is: "this is a one-time template fix, not N separate page edits."

## Why now

Site audits on typical 20–60-page client sites routinely surface the same footer color-contrast or header link-name violation on every page. The existing by-violation tab already groups these correctly but buries the signal in an unsorted list with no "template smell" call-out. Operators interpret the count as N separate problems rather than one shared component. The callout makes the fix path obvious before the operator opens a single page result.

## Non-goals

- Not modifying axe-core or the runner — purely post-processing on already-stored results.
- No machine learning, no LLM call — deterministic counting against a threshold.
- No automatic fix suggestion — the callout names the rule, the likely ancestor, and links to the axe rule docs.
- Not shown on the per-page `/ada-audit/[id]` view — "appears on every page" only exists in a site audit context.
- No UI setting for the threshold — the constant lives in one place in the detection module; an operator who needs a different value edits and re-deploys.

## Detection algorithm

### Threshold constants

```ts
// lib/ada-audit/common-issues.ts
export const COMMON_ISSUE_THRESHOLD    = 0.8  // ≥ 80% of successfully scanned pages
export const COMMON_ISSUE_MIN_PAGES    = 5    // callout disabled below this floor
export const COMMON_ISSUE_MAX_CALLOUTS = 5    // max cards before "+ N more" expander
```

### Page floor: 5 pages, justified

Below 5 successfully scanned pages the 80% threshold loses diagnostic meaning. On a 3-page site, ≥80% means ≥3 (100%) — every shared violation trivially qualifies. On a 4-page site, ≥80% means ≥4 (100% only) — same problem. At 5 pages, ≥80% means ≥4 of 5: a genuine repetition pattern. The floor also silences callouts on smoke-test runs and stub sites.

### Use ceiling arithmetic to avoid floating-point ambiguity

The qualifying check is implemented as `affectedPagesCount >= Math.ceil(totalPagesScanned * COMMON_ISSUE_THRESHOLD)`. This avoids subtle off-by-one cases at exact rational boundaries (e.g. 0.8 × 5 = 4.0, but 0.8 × 25 = 20.0 stored as 19.9999… in IEEE 754).

### Counting logic

```
N = count of children where status === 'complete'   // errored pages excluded
if N < COMMON_ISSUE_MIN_PAGES: return []
minHits = Math.ceil(N * COMMON_ISSUE_THRESHOLD)

pagesByRule:        Map<ruleId, Set<adaAuditId>>
ruleMetadata:       Map<ruleId, { impact, help, description, helpUrl }>
ruleAncestorByPage: Map<ruleId, Map<adaAuditId, LandmarkTag>>   // one landmark per page

for each complete child:
  result = tryParse(child.result)                     // null on parse failure → skip child
  if !result || !Array.isArray(result.violations): continue
  for each violation v in result.violations:
    if typeof v.id !== 'string': continue
    if !LANDMARK_IMPACTS.includes(v.impact): continue   // null/invalid impact skipped
    nodes = Array.isArray(v.nodes) ? v.nodes : []
    pagesByRule[v.id].add(child.id)
    ruleMetadata[v.id] = { impact, help, description, helpUrl }
    pageLandmark = computeModalLandmarkForPage(nodes)   // pick one landmark per page
    if (pageLandmark) ruleAncestorByPage[v.id].set(child.id, pageLandmark)

commonIssues = []
for each ruleId where pagesByRule[ruleId].size >= minHits:
  { sharedAncestor, confidence } = voteAcrossPages(ruleAncestorByPage[ruleId], pagesByRule[ruleId].size)
  push CommonIssue record

sort by impact severity desc (critical → minor), then affectedPagesCount desc
return commonIssues              // caller slices to MAX_CALLOUTS for display
```

**Errored pages excluded from N and counts.** A rule on 23 of 25 complete pages (2 errored) → 23/25 with minHits = `ceil(25 × 0.8)` = 20, qualifies.

**Defensive guards (codex flagged these):** the loop must tolerate malformed `result` JSON, missing `id`, null/invalid `impact`, and non-array `nodes`. The existing test fixtures in `lib/ada-audit/site-audit-helpers.test.ts` use minimal violation objects like `{ impact: 'critical' }` (no `id`, no `nodes`) — `detectCommonIssues` must skip these rather than throw or create an `undefined` rule key.

## Shared-ancestor detection

### What the stored data contains

`AxeNode.target` (`lib/ada-audit/types.ts:18`) is **optional** — typed `target?: string[]`. When present, for a non-iframe DOM node it is a single-element array containing the CSS path axe-core calculated to identify the element, e.g. `["footer > div.content > a"]`. For iframe elements the array has one entry per frame boundary. Existing code (`lib/ada-audit/screenshot-helpers.ts`) checks `node.target?.length` before using selectors — the new detector must do the same.

`AxeNode.html` is the outerHTML of the failing element itself, not its ancestors — useful only if the element IS the landmark tag. For ancestor detection, `target` is the correct field.

axe-core generates the shortest stable selector, not necessarily the full document ancestor chain. A deeply nested element may get `["#footer-widget a"]` where the tag `footer` is absent. Ancestor detection is best-effort and should be communicated as such.

### Extraction heuristic — selector-segment aware

A plain regex over the full selector string is unsafe: it can match `footer` inside `:not(footer)`, inside attribute selectors `[data-region="footer"]`, or inside string-content. Instead, split the selector into top-level simple-selector segments using combinators (`>`, `+`, `~`, whitespace), with awareness of bracket/paren depth.

```ts
const LANDMARK_TAGS = ['header', 'footer', 'nav', 'aside', 'main'] as const
type LandmarkTag = typeof LANDMARK_TAGS[number]

/**
 * Walks the selector and emits its top-level simple-selector segments,
 * skipping any content inside [], (), or strings. For each segment we strip
 * everything after the first :, #, ., [ — leaving only the (optional) tag name.
 */
function extractTagsFromSelector(selector: string): string[] {
  const tags: string[] = []
  let depth = 0          // tracks (...) and [...] nesting
  let stringChar: string | null = null   // tracks " or ' nesting
  let segment = ''
  const flush = () => {
    const trimmed = segment.trim()
    if (trimmed) {
      // a leading tag is alphanumeric+hyphen until the first ., #, [, :, *
      const m = trimmed.match(/^([a-z][a-z0-9-]*)/i)
      if (m) tags.push(m[1].toLowerCase())
    }
    segment = ''
  }
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (stringChar) { if (ch === stringChar) stringChar = null; continue }
    if (ch === '"' || ch === "'") { stringChar = ch; continue }
    if (ch === '(' || ch === '[') { depth++; segment += ch; continue }
    if (ch === ')' || ch === ']') { depth--; segment += ch; continue }
    if (depth === 0 && /[\s>+~,]/.test(ch)) { flush(); continue }
    segment += ch
  }
  flush()
  return tags
}

function extractLandmarkFromTarget(target: string[] | undefined): LandmarkTag | null {
  if (!target || target.length === 0) return null
  for (const sel of target) {
    for (const tag of extractTagsFromSelector(sel)) {
      if ((LANDMARK_TAGS as readonly string[]).includes(tag)) return tag as LandmarkTag
    }
  }
  return null
}
```

### Confidence levels — voted per page, not per node

**Codex flagged that voting across raw nodes overweights pages with many nodes.** A footer color-contrast rule might fire on 80 nodes on one page and 1 node each on 9 others — naive node-counting would falsely call that "footer". Instead:

1. For each affected page, compute a single **modal landmark** = the most common landmark among that page's stored nodes for the rule (ties → null).
2. Cross-page vote: count how many of the `affectedPagesCount` pages have each landmark.

Confidence then becomes:
- **`'all'`** — every affected page that has any detectable landmark votes the same landmark, AND at least half of affected pages contributed a vote (i.e. landmark detection isn't relying on a tiny minority).
- **`'majority'`** — the top landmark has **strictly more than 50%** of affected pages voting for it, AND there is no tie at that top count. (Codex flagged `>= 50%` allows ties to be reported.)
- **`null`** — no landmark exceeds 50%, or there's a tie at the top, or fewer than half of affected pages contributed any landmark vote.

## Where the analysis runs

**Server-side, inside `buildSiteAuditSummary`, result stored in the `summary` JSON column. No schema migration required.**

`buildSiteAuditSummary` (`lib/ada-audit/site-audit-helpers.ts:115`) already receives every `ChildRow` with the full `result` JSON string and runs exactly once at finalization. Inserting `detectCommonIssues(children)` here costs zero extra DB queries. The output is stored in `SiteAudit.summary` alongside `aggregate` and `pages`, returned by `GET /api/site-audit/[id]` without any additional fetch.

The client-side alternative — computing from `useGroupedViolations` (`components/ada-audit/useGroupedViolations.ts:21`) — would require that hook to run in the default table-view mode (today it is lazy, firing only when the by-violation tab is active) and issue N separate `/api/ada-audit/[id]` fetches before the callout could render. That is worse latency, worse coupling, and makes the callout invisible until the user has already switched tabs.

`summary` is a `String?` column; the JSON payload grows in place. Older rows without `commonIssues` decode to `undefined`; consumers default to `[]`.

## Data shape

```ts
// lib/ada-audit/types.ts — additions

export type LandmarkTag = 'header' | 'footer' | 'nav' | 'aside' | 'main'
export type AncestorConfidence = 'all' | 'majority'

export interface CommonIssue {
  ruleId: string
  impact: ImpactLevel
  help: string                         // axe violation.help
  description: string                  // axe violation.description
  helpUrl: string
  affectedPagesCount: number
  totalPagesScanned: number            // N (complete pages only)
  sharedAncestor: LandmarkTag | null
  ancestorConfidence: AncestorConfidence | null  // null when sharedAncestor is null
}

// SiteAuditSummary extended:
export interface SiteAuditSummary {
  aggregate: AuditScorecard
  pdfsAggregate: SiteAuditPdfAggregate
  pages: SitePageResult[]
  commonIssues: CommonIssue[]          // empty array when below floor or no matches
}
```

## UI

### Location

Inside the "Pages with Issues" section card in `SiteAuditResultsView`, between the section header and `<SiteAuditToolbar>` (`components/ada-audit/SiteAuditResultsView.tsx:243`). Hidden entirely when `commonIssues` is empty.

### `<CommonIssueCallout>` component

A stack of cards, max `COMMON_ISSUE_MAX_CALLOUTS` visible. A "+ N more" button below the stack expands the remainder inline — no modal.

Each card:

- Left border accent (`border-l-4`) colored by impact, matching `IMPACT_STYLES` in `GroupedViolationsView.tsx:15`.
- Background: `bg-{color}-50 dark:bg-{color}-500/10`.
- Top row: impact badge + rule name (`violation.help`).
- Body sentence — three forms:
  - `'all'`: "Appears on all {N} scanned pages inside `<{ancestor}>` — likely a one-time fix in your {ancestor} template."
  - `'majority'`: "Appears on {count} of {N} scanned pages, most often inside `<{ancestor}>`."
  - No ancestor: "Appears on {count} of {N} scanned pages."
- Footer row: "View affected pages" button + "Learn more ↗" external link to `helpUrl`.

The "View affected pages" CTA must actually focus the rule, not just switch tabs. Wire it through `onViewByViolation(ruleId)` → `setViewMode('by-violation')` AND `setSelectedViolationId(ruleId)` in `SiteAuditResultsView`. `GroupedViolationsView` accepts a new optional `selectedViolationId` prop; when set, it auto-expands that rule's card on mount/change and scrolls it into view via `ref.scrollIntoView({ behavior: 'smooth', block: 'start' })`. Without this, the user lands on the by-violation tab and has to scroll/search for the rule manually — codex flagged this gap.

### Empty state

Section hidden entirely. No "no common issues found" message.

## File structure

| File | Status | Role |
|------|--------|------|
| `lib/ada-audit/common-issues.ts` | Create | Pure `detectCommonIssues(children: CommonIssueInputRow[])` + exported constants + internal `extractLandmark()`. `CommonIssueInputRow` is `{ id: string; status: string; result: string | null }` — structural subset of `ChildRow`, no cross-import needed. No DB access. |
| `lib/ada-audit/common-issues.test.ts` | Create | Unit tests for `detectCommonIssues` and ancestor detection. Pure-function, no DB. |
| `lib/ada-audit/types.ts` | Modify | Add `LandmarkTag`, `AncestorConfidence`, `CommonIssue`; extend `SiteAuditSummary` with `commonIssues: CommonIssue[]`. |
| `lib/ada-audit/site-audit-helpers.ts` | Modify | Import `detectCommonIssues`; call at end of `buildSiteAuditSummary`; include in returned object. |
| `components/ada-audit/CommonIssueCallout.tsx` | Create | Card-stack component. Props: `issues: CommonIssue[]`, `onViewAffectedPages: (ruleId: string) => void`. Renders max `COMMON_ISSUE_MAX_CALLOUTS` + expander. |
| `components/ada-audit/SiteAuditResultsView.tsx` | Modify | Add `selectedViolationId` state. Render `<CommonIssueCallout>` between section header and toolbar when `(summary.commonIssues ?? []).length > 0`. Pass `onViewAffectedPages={(id) => { setViewMode('by-violation'); setSelectedViolationId(id) }}`. Forward `selectedViolationId` to `<GroupedViolationsView>`. |
| `components/ada-audit/GroupedViolationsView.tsx` | Modify | Accept optional `selectedViolationId?: string` prop. When set, auto-expand that rule's card and scroll into view on mount/change. |

## Data flow

```
finalizeSiteAudit
  → buildSiteAuditSummary(children)
      → existing: parseScorecard per child, build pages[]
      → new: detectCommonIssues(children) → CommonIssue[]
      → returns { aggregate, pdfsAggregate, pages, commonIssues }
  → JSON.stringify → SiteAudit.summary column

GET /api/site-audit/[id]
  → parses SiteAudit.summary (no extra query)
  → commonIssues included in response

SiteAuditResultsView (client)
  → summary.commonIssues ?? []
  → <CommonIssueCallout> renders above toolbar when non-empty
  → "View affected pages" callback → setViewMode('by-violation')
```

## Edge cases

| Case | Behavior |
|------|----------|
| Site has < 5 complete pages | `detectCommonIssues` returns `[]`; callout hidden |
| Issue at exactly 80% | Included (`>=` comparison) |
| Errored pages | Excluded from N and from hit counts |
| `null` impact on a violation | Rule skipped |
| Older `summary` rows (no `commonIssues` key) | `summary.commonIssues ?? []` — callout hidden, no error |
| All pages clean | Returns `[]` without error |
| No detectable ancestor on any node | `sharedAncestor: null`, ancestor sentence omitted |
| Rule fires everywhere but from multiple regions | `ancestorConfidence: null` — callout shows, ancestor omitted |
| Selector `"#footer-widget > a"` — no bare `footer` tag | Regex boundary prevents false positive |

## Tests

All tests are pure-function unit tests; no DB, no React harness.

| Test | What it covers |
|------|----------------|
| Returns `[]` when complete-page count < `COMMON_ISSUE_MIN_PAGES` | Floor gate |
| Returns `[]` when best rule ratio < threshold | Below threshold |
| Returns a `CommonIssue` when rule hits exactly 80% | `>=` boundary |
| Errored-status pages excluded from N and counts | Error exclusion |
| `sharedAncestor: 'footer'`, `confidence: 'all'` when every node target has `footer` | All-confidence |
| `ancestorConfidence: 'majority'` when > 50% but not 100% of nodes agree | Majority branch |
| `sharedAncestor: null` when < 50% of landmark-bearing nodes agree | No-confidence |
| Selector `"#footer-widget > a"` — no bare `footer` tag → `null` | Regex false-positive safety |
| Output sorted: critical before serious; higher pageCount first within same impact | Sort order |
| `null` impact violations skipped entirely | Null impact guard |

## Known limitations

1. **axe-core uses the shortest stable selector, not the full ancestor chain.** `AxeNode.target[0]` might be `"#footer-logo img"` for an image inside the footer — the tag `footer` never appears. Ancestor detection returns `null` for that instance. On sites with BEM-style class naming or ID-heavy HTML, hit rate may be low even when the issue is genuinely template-scoped.

2. **`AxeNode.html` is not a fallback.** It contains only outerHTML of the violating element, not the parent chain. Only useful if the failing element IS the landmark.

3. **Nodes are truncated to 20 per violation** (runner.ts `nodes.slice(0, 20)`). Does not affect page-level counting but does reduce the within-page sample used to pick that page's modal landmark.

4. **Storage is denormalized inside `SiteAudit.summary`.** This is the right call for "render the callout when viewing an audit" but does not support cross-audit queries like "find every audit with a common color-contrast issue." If that becomes a product need, lift `commonIssues` into a normalized table — adding another `String?` column would not buy queryability.
