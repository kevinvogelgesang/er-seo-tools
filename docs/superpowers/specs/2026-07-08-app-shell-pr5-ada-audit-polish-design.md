# A8 PR 5 — ada-audit Visual Polish (ScoreRing + StatusPill adoption) — Design

**Status:** spec
**Date:** 2026-07-08
**Roadmap item:** A8, spec §8 "PR 4+ — Per-tool polish passes" (see
`docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md` §5, §8). Second
per-tool polish pass (PR 4 = seo-parser, `docs/superpowers/archive/specs/2026-07-07-app-shell-pr4-seo-parser-polish-design.md`).
**Class:** UI change, small–medium size (visual/primitive-adoption only).

## 1. Goal

Adopt the two existing "Navy Command Deck" `components/ui/` primitives —
`ScoreRing` (the 0–100 score dial) and `StatusPill` (the lifecycle status pill) —
across the ada-audit tool's **score displays** and **lifecycle/compliance/diff
status pills**, unifying them with the rest of the app (seo-parser results, Home
widgets). This is the second per-tool polish pass of A8 PR 4+.

This is a **visual/primitive-adoption pass only.** It changes no tool behavior,
no data, no API, no route, no audit logic, no scoring. It is independently
shippable and does not depend on any other per-tool PR.

**Why this differs from PR 4 (seo-parser):** the ada-audit surface is *already*
clean on the two mechanical axes PR 4 spent most of its effort on —
- **No page-root wrapper reconciliation needed.** Every ada-audit page root is
  already a transparent centered container (`max-w-5xl mx-auto px-6 py-10`) with
  **no `min-h-screen` and no duplicated shell background.** (Verified across
  `app/(app)/ada-audit/*/page.tsx`, both share pages, and the two top result
  components `AuditResultsView.tsx:83` / `SiteAuditResultsView.tsx:124`.)
- **No raw brand-hex → token swap needed.** ada-audit components already use the
  `navy`/`orange` tokens throughout; the only hexes in the tree (`#555`,
  `#6b7280`, `#b00` in `PdfIssuesSection.tsx:53-58`) are inside an HTML
  **export/print string**, not rendered UI.

So PR 5 is **purely primitive adoption**, not cleanup.

## 2. Non-goals (and why)

- **No behavior/data/API/route/audit/scoring change of any kind.**
- **No impact-severity badge unification.** The impact-severity indicators
  (Critical / Serious / Moderate / Minor and the diff/tab count chips) are **out
  of scope**, for two independent reasons:
  1. **Interactivity.** `AuditScorecard`'s impact tiles (`:82-114`) and
     `SiteAuditToolbar`'s impact filter chips (`:40-135`) are **interactive
     toggle buttons** (`onImpactClick`/`activeImpact`, `onFilterImpactChange`/
     `active`). Converting them to the display-only `StatusPill` would remove
     their click/active behavior — a **behavior change**, which the visual-only
     contract forbids. (This is why they were listed loosely under the earlier
     scoping options but are excluded here on inspection.)
  2. **Palette mismatch.** Impact severity is a **4-level** palette
     (red/orange/yellow/blue) rendered with a leading dot + border
     (`AuditIssueCard.tsx:39`, `GroupedViolationsView.tsx:26`,
     `CommonIssueCallout.tsx` tiers, `AuditIssueTabs.tsx:112`). `StatusPill` models
     a **5-tone lifecycle** set (neutral/running/success/error/warning) with no
     dot and no border. Forcing severity into it would misuse the primitive and
     drop the dot/severity semantics. Unifying these is a **future `SeverityBadge`
     primitive extraction** (analogous to PR 4 deferring `KpiTile`), not this PR.
  3. **Taxonomy, not lifecycle.** `CommonIssueCallout`'s tier chips
     (`CommonIssueCallout.tsx:44-54,94-99`) are *taxonomy/tier* tags (a
     classification of a common issue), not lifecycle status — a separate reason
     they are not a `StatusPill` fit, independent of the severity-palette point.
- **No score conversion of `LighthouseSection`.** `LighthouseSection.tsx:9-12`
  colors its Lighthouse accessibility score with the **Lighthouse** bands
  (green `≥90` / amber `≥50`), which are *not* `ScoreRing`'s bands (green `≥80`).
  Swapping to `ScoreRing` would silently change the color meaning of an 80–89
  Lighthouse score — a **semantic** change, which the visual-only contract
  forbids. (Excluded on Codex review; the earlier "identical bands" read was wrong
  for this one component. `AuditScorecard` and `ClientsAuditSummary`'s `ScoreBadge`
  genuinely use `≥80/≥50`, so they stay in scope.)
- **No conversion of plain-text / dense-numeric columns.** `RecentsTable`
  (`:81-87` — a content-*type* tag `page`/`site`, plain status *text*, and a plain
  score column) and `QueueMemberRow`'s plain score column (`:89`) are left as-is:
  we adopt `StatusPill` where a hand-rolled *pill* already exists, and we neither
  introduce pills into plain-text columns nor replace dense table numerics with
  rings (density). The `RecentsTable` type tag is a content-type classifier, not
  lifecycle status.
- **No new `components/ui/` primitive.** We adopt `ScoreRing` and `StatusPill`
  exactly as they are; we do **not** modify `StatusPill`'s tone set or markup (it
  is shared with the Home widgets — changing a tone would ripple cross-tool). The
  **one** touch to `StatusPill.tsx` is a **type-only `export` of its `Tone` union**
  (§5) — no runtime/behavior/markup change, so widgets are unaffected.
- **No restyle of results tables/cards/trees/modals** beyond the specific pills
  and score displays named in §4. `PageRow`, `SitemapTreeView`, `AuditIssueTabs`,
  `AuditIssueCard`, `GroupedViolationsView`, `PdfIssuesSection`, `CommonIssueCallout`
  internals are untouched (their per-page inline "error" tags and type/runner
  badges stay as-is — not part of the status-pill surface; touching them would
  expand the diff into deep, complex results-tree components).
- **No change to progress bars / spinner circles** (`AuditPoller`,
  `SiteAuditPoller`, `SiteAuditForm`, `DashboardQueueStatus`) — not pills.
- **No change to any page-root wrapper** (none need it — §1).

## 3. Context (verified against code, 2026-07-08)

### 3.1 Shared vs authed-only ownership (the share-view guardrail)

ada-audit has authed pages **and** public share views that render **outside** the
shell (`app/(public)/ada-audit/share/[token]`, `.../site/share/[token]`). A
component shared between them must keep its own layout/wrapper. **This PR strips
no wrappers**, so the risk is moot — but ownership is recorded for correctness:

- **Shared (authed + public share):** `AuditScorecard`, `ScoreVersionBadge`
  (both reached via `AuditResultsView` **and** `SiteAuditResultsView`, each
  imported by both an authed page and a public share page). (`LighthouseSection`
  is also shared — but only through `AuditResultsView`, not `SiteAuditResultsView`
  — and is out of scope per §2, so it is not changed.)
- **Authed-only:** `QueueMemberRow`, `LiveAuditTable`, `ClientsAuditSummary`,
  `SiteAuditDiffPanel`.

Both `ScoreRing` and `StatusPill` are self-contained presentational elements
(an inline SVG / a single `<span>`) with dark-mode variants and **no wrapper**,
so they are safe to render on a shell-less public page.

### 3.2 The primitives (verified)

- **`ScoreRing`** (`components/ui/ScoreRing.tsx`): `{ score: number|null, size=44 }`,
  inline SVG dial, number centered, `role="img"`, `aria-label` = `score {pct}` /
  `no score`. Bands **`≥80 green / ≥50 amber / else red`**. Null → dashed grey
  ring + em dash.
- **`StatusPill`** (`components/ui/StatusPill.tsx`): `{ label: string, tone?:
  'neutral'|'running'|'success'|'error'|'warning' }`. Tones: `neutral` gray,
  `running` **blue**, `success` green, `error` red, `warning` **amber**. Renders
  `inline-flex rounded-full px-2 py-0.5 text-[11px] font-body font-semibold`,
  **not** uppercase.

### 3.3 Current score / status markup (verified)

- **`AuditScorecard.tsx`** (shared, used by both result views): headline score is
  a flat `text-5xl font-display font-bold` number colored by `scoreColor()`
  (`:38-42`, bands `≥80/≥50` — **identical to `ScoreRing`**), inside a
  `score != null` guard (`:53`). Beside it: "SCORE" label, `<ScoreVersionBadge>`,
  and a compliant/non-compliant badge (`:69-78`, `bg-green-50…border-green-200` /
  `bg-red-50…border-red-200`). Below: the 4 impact **tiles** (`:82-114`,
  interactive — out of scope) and the pass/incomplete/total text row (`:116-127`).
- **`ScoreVersionBadge.tsx`** (shared): a `v1`/`v2` tag pill (`bg-gray-100…`) +
  trailing "{n} passed" / "{n} needs review" text.
- **`SiteAuditDiffPanel.tsx`** (authed-only): `SEV_PILL` map
  (`critical`=red / `warning`=amber / `notice`=gray, `:13-17`, rendered `uppercase`
  `:25`) + headline count chips new/resolved/unchanged/not-rescanned (`:76-90`,
  conditional red/green/gray by count).
- **`QueueMemberRow.tsx`** (authed-only): `STATUS_LABEL` + `STATUS_COLOR` maps
  (`:8-27`) → pill at `:74` (`rounded`, not full).
- **`LiveAuditTable.tsx`** (authed-only): a **local** `StatusPill` function
  (`:10-24`) with its own `styles` map (`complete`/`error`/`running`/`pending`/
  `redirected`) — **not** the `ui/` primitive.
- **`ClientsAuditSummary.tsx`** (authed-only): `ScoreBadge` (`:32-40`, bands
  `≥80/≥50` — identical to `ScoreRing`) + `ChipForStatus` (`:42-54`,
  queued=gray / else amber) in the table's Score cell (`:313-314`).

### 3.4 Existing tests that touch these components (verified)

- `AuditScorecard.test.tsx` — asserts only on the pass/incomplete text row
  (`"12 rules passed"`, `"need review"`, `"— rules passed"`). Renders **without a
  `score` prop**, so the score block (and the ScoreRing swap) is not exercised.
  Stays green; a **new** test covers the ScoreRing/compliant path.
- `ScoreVersionBadge.test.tsx` — `getByText(/v2/i)`, `/v1/i`, `/40/`, `/3/`. Text
  content is preserved by the StatusPill swap (label `"v2"` etc.). Stays green.
- `SiteAuditDiffPanel.test.tsx` — `getByText('critical')`, `'1 resolved'`,
  `/5 unchanged/`, `/2 not re-scanned/`, `/0 new$/`, `/2 new \(1 regressed …\)/`.
  All are **text-content** assertions; StatusPill renders the same label strings
  as a single text node. Stays green.
- `AuditResultsView.test.tsx` / `SiteAuditResultsView.test.tsx` — assert on the
  **version badge** presence and scorecard **counts** (line 146 explicitly calls
  the impact tiles "count-first buttons"). No assertion on the flat score markup.
  Stay green (the score `90` still appears as text content inside `ScoreRing`'s
  `<text>` element).

## 4. In-scope changes

Two tiers. **Core** is the status/score unification of the results header +
operational lists. **Extended** adds the two remaining 0–100 score displays.
Extended is a clean trim point if Kevin wants to narrow on review.

### 4.1 Core

| File | Owner | Change |
|------|-------|--------|
| `components/ada-audit/AuditScorecard.tsx` | shared | Headline flat score number → `<ScoreRing score={score} size={72} />` (keep the `score != null` guard; do not render a null ring). Compliant/non-compliant badge → `<StatusPill label={<wcag-label>: Compliant ✓ / Non-compliant ✗} tone={compliant ? 'success' : 'error'} />`. Remove now-unused `scoreColor`. Impact tiles + pass/incomplete row **untouched**. |
| `components/ada-audit/ScoreVersionBadge.tsx` | shared | `v1`/`v2` tag → `<StatusPill label={label} tone="neutral" />` (keep the `title` tooltip on a wrapping element; keep the trailing "{n} passed" / "{n} needs review" text unchanged). |
| `components/ada-audit/SiteAuditDiffPanel.tsx` | authed | `SEV_PILL` severity pill → `<StatusPill label={severity} tone={sevTone(severity)} />` (`critical`→`error`, `warning`→`warning`, `notice`→`neutral`). Headline count chips → `StatusPill` (`new`→`error` when `>0` else `neutral`; `resolved`→`success` when `>0` else `neutral`; `unchanged`/`not-rescanned`→`neutral`). The solid-red **`NEW`** emphasis badge (`:26`) stays as-is (it is an emphasis flag, not a status tone). |
| `components/ada-audit/QueueMemberRow.tsx` | authed | `STATUS_COLOR` map + pill → `<StatusPill label={STATUS_LABEL[status]} tone={auditStatusTone(status)} />`. Keep `STATUS_LABEL`. Remove `STATUS_COLOR`. |
| `components/ada-audit/LiveAuditTable.tsx` | authed | Delete the local `StatusPill` function + its `styles` map; import and use `ui/StatusPill` via `auditStatusTone`. `ImpactCounts` (crit/ser/mod/min counts) **untouched** (not a status pill). |
| `components/ada-audit/ClientsAuditSummary.tsx` | authed | `ChipForStatus` → `<StatusPill label={label} tone={auditStatusTone(status)} />` (keep the human labels + `ml-2` spacing on a wrapper). |

### 4.2 Extended (remaining band-matched 0–100 score display)

| File | Owner | Change |
|------|-------|--------|
| `components/ada-audit/ClientsAuditSummary.tsx` | authed | `ScoreBadge` colored number → `<ScoreRing score={score} size={32} />` (bands already identical `≥80/≥50`; `null` → ScoreRing's dashed em-dash ring, replacing the current `—`). |

(`LighthouseSection` is **not** included — its bands differ from `ScoreRing`; see
§2. This tier is a clean trim point: dropping it leaves only Core.)

## 5. The tone-mapping decision (defining choice of this PR)

`StatusPill`'s tone set is a fixed 5-color palette shared with the Home widgets.
ada-audit's status colors are: gray (queued/pending), **amber** (running family),
green (complete), red (error), slate (cancelled), blue (redirected).

**Chosen approach — color-preserving mapping onto the existing tones** (do NOT
modify `StatusPill`): map each status to the tone whose *color* matches today's
pill, via a tiny shared helper:

**Type note (Codex fix):** `StatusPill`'s `Tone` union is currently **private**
in `components/ui/StatusPill.tsx`. Add a **type-only `export`** to it (`export type
Tone = …`) so the helper can return it — this is a compile-time-only change, no
runtime/markup/behavior change, so the Home widgets are unaffected. (Alternative
if we prefer zero touches to the primitive: `type Tone = ComponentProps<typeof
StatusPill>['tone']` in the helper. The explicit export is cleaner and is the
chosen approach.)

```ts
// components/ada-audit/status-tone.ts  (new, ~12 lines, pure)
// StatusPill tone is a COLOR selector; names are mapped by color, not by word,
// so operational surfaces stay pixel-stable (running audits keep their amber).
// Centralizing the mapping here (Codex fix) keeps the "running → warning" oddity
// documented in one place rather than scattered across call sites.
import type { Tone } from '@/components/ui/StatusPill'
export function auditStatusTone(status: string): Tone {
  switch (status) {
    case 'complete': return 'success'                       // green
    case 'error':    return 'error'                          // red
    case 'running':
    case 'pdfs-running':
    case 'lighthouse-running': return 'warning'              // amber (preserved)
    case 'redirected': return 'running'                      // blue (preserved)
    default: return 'neutral'                                // queued/pending/cancelled → gray
  }
}
```

Rationale:
- **Pixel-stable on the heavily-used operational surfaces** (queue, live table,
  clients). Running audits stay amber; the light/dark shade deltas between the
  current classes and the matched `StatusPill` tones are negligible (e.g.
  `dark:text-amber-400`→`amber-300`). Matches PR 4's pixel-safe ethos and avoids a
  jarring color flip in daily-driver tooling.
- The **shape/typography does unify** to the `StatusPill` standard — `rounded`→
  `rounded-full`, `text-[10px]`→`text-[11px]`, `uppercase`→sentence case. This is
  the intended, deliberate (minor) visual change of the pass.
- `StatusPill` is left untouched, so the Home widgets are unaffected.

**Two deliberate, documented shifts (Codex plan-review fix):** the single global
helper cannot preserve every status's color where the current surfaces already
*disagree*, so two statuses are canonicalized to `neutral`:
- **`pending` → `neutral` (gray).** It is *already* gray in the two authoritative
  operational tables (`QueueMemberRow`'s `STATUS_COLOR`, `LiveAuditTable`); only
  `ClientsAuditSummary` rendered it amber, via a coarse "everything-but-`queued`
  is amber" shortcut (`ChipForStatus`). Mapping `pending`→`neutral`
  **canonicalizes** it to the queue's existing gray and removes that
  inconsistency — a net consistency gain, not a regression.
- **`cancelled` → `neutral` (gray).** Currently slate in `QueueMemberRow`; slate
  and gray are near-identical, so this is a negligible shift (accepted rather than
  re-fragmenting the unified pill with a slate special-case). If Kevin wants the
  slate preserved exactly, keep `cancelled` hand-rolled in `QueueMemberRow` — a
  one-line exception — but the default is `neutral`.

**Alternative Kevin may prefer (flag for spec review):** *semantic/deck-standard*
mapping — running→`running` (blue), to match how the Home widgets already color a
running item. This would flip running-audit pills from amber to blue across the
ada-audit operational surfaces. Not chosen (surprising color flip on daily
tooling), but a one-line change to the helper if Kevin wants cross-widget color
parity instead.

## 6. Dark mode

Every touched element keeps or gains its `dark:` variant. `ScoreRing` and
`StatusPill` already ship full dark variants; no new dark gaps are introduced. No
hydration-mismatch patterns (no new client-only state gating markup — the pills
and rings render identically on server and client).

## 7. Purge safety (PR3 regression guard)

Every class involved is either (a) already present in `components/ui/`
primitives (built once, reachable by the content globs) or (b) a static literal
in a scanned `components/` file. The new `status-tone.ts` helper returns **tone
string literals** consumed by `StatusPill` (whose classes already exist) — it
constructs **no class names**. This is categorically unlike the PR3 purge bug
(dynamically-built span classes in `lib/`). `npm run build` + the post-deploy
real-browser measure confirm no purge.

## 8. Testing

- **Existing tests stay green** (§3.4) — verified by inspection; re-confirmed by
  running the suite. No existing assertion targets the changed markup.
- **New tests:**
  - `AuditScorecard.test.tsx` — add: `score=87` + `compliant=true` → assert a
    `ScoreRing` is present (`role="img"`, `aria-label` contains `score 87`) AND a
    compliant `StatusPill` renders (text contains `Compliant`); `score=null` (prop
    omitted) → assert **no** score ring (`queryByRole('img')` for the score is
    null) — the existing `score != null` guard holds. Use the house conventions
    (`// @vitest-environment jsdom`, `.getAttribute()`/`.toBeTruthy()`/
    `queryBy…===null`; no jest-dom).
  - `status-tone.test.ts` — pure unit test of `auditStatusTone`: each status →
    expected tone (the color-preserving map), default → `neutral`.
- **Gates:** `npm run lint` (`tsc --noEmit`) + `DATABASE_URL="file:./local-dev.db" npm test`
  (`vitest run`) + `npm run build`, all green.
- **Post-deploy prod verification (UI class — mandatory real-browser measure):**
  drive the **authed** ada-audit surfaces via Playwright and MEASURE layout —
  server health is insufficient (PR 2 shipped a purged-CSS size bug caught only by
  a width measure). Targets:
  - A **single-page audit result** (`/ada-audit/[id]`, complete) — confirm the
    `AuditScorecard` `ScoreRing` SVG is present and sized (`getBoundingClientRect`
    ≈ 72), the compliant `StatusPill` renders, and no CSS collapse.
  - A **site audit result** (`/ada-audit/site/[id]`) — same scorecard + (if a
    baseline exists) the `SiteAuditDiffPanel` StatusPills.
  - The **clients audit summary** tab (`/ada-audit`) — the compact `ScoreRing`
    (size 32) renders in the table Score cell without breaking row height/density.
  - If the Playwright MCP session is **not** authed (Google-OAuth-only login is
    not headlessly automatable), verify the **public share** surfaces
    (`/ada-audit/site/share/[token]` if one exists) + HTTP/redirect health
    yourself, and flag the authed spot-checks for Kevin.

## 9. Risks / notes

- **Shared components** (`AuditScorecard`, `ScoreVersionBadge`, `LighthouseSection`)
  render on public share pages too — but the change only swaps inner presentational
  elements (ring/pill), never a wrapper, so share views are safe.
- **Compliant badge shape shift** — `StatusPill` drops the current border and uses
  `bg-*-100` (vs `bg-*-50`); a minor, intended unification. Verify the long WCAG
  label reads well inside a `rounded-full` pill.
- **ClientsAuditSummary table density** — a size-32 `ScoreRing` is taller than the
  current text badge; the widgets already use compact rings in lists, but confirm
  the Score cell / row height still reads well in the real-browser check
  (Extended-tier item; trimmable). Note the `ScoreBadge`→ring change makes the
  clients table's score a ring while `RecentsTable`/`QueueMemberRow` keep plain
  score numbers (§2) — an intentional split (scorecard surface vs. activity log),
  not an oversight.
- **Long compliant label in a `rounded-full` pill** (Codex verify) — spot-check
  `WCAG 2.1 AA + Best Practices: Compliant ✓` inside `StatusPill` on mobile widths
  and on the public share page; if it wraps awkwardly, keep the label but confirm
  the pill grows gracefully (it is `inline-flex`, so it should).
- **`SiteAuditDiffPanel` severity case** — `StatusPill` renders sentence-case, so
  the severity pill changes from `CRITICAL` to `critical` (text content already
  `critical`, so the test is unaffected). Acceptable polish shift.
- **`running` tone parity** — confirm the amber `warning` tone resolves identically
  in light + dark to the prior hand-rolled amber (it does by inspection; the
  real-browser check is the backstop).
