# Client Viewbook — Bugfix + UX Pass — Design

**Date:** 2026-07-17
**Status:** Codex-reviewed (accept-with-fixes — 11 named fixes applied 2026-07-17); brainstorming-approved shape
**Base:** viewbook v1 + v2 shipped (see `archive/specs/2026-07-15-client-viewbook-design.md`)
**Approach:** 4 file-disjoint lanes in 2 tandem waves (Claude ∥ Codex), quick wins front-loaded per lane. Version control is deferred to its own follow-up spec.

## 1. What this is

A bugfix + existing-feature-update pass on the shipped viewbook feature. It fixes
two interaction bugs (a rapid-flicker/blink loop and a jarring "close-as-you-scroll"
behaviour), reworks the operator (ER-employee) editing UX to update live with no
save buttons, and adjusts a batch of stage-specific content behaviours. It does
**not** add version control — that is a separate, larger spec written immediately
after this set (§14).

Scope is organized as **four lanes** (§5–§8) with an exact file-ownership map (§10)
so Claude and Codex can build concurrently without collisions.

## 2. Decisions locked (brainstorming + Kevin answers)

| # | Decision | Choice |
|---|---|---|
| D1 | Scroll behaviour | **Sticky section headers.** Kill the scroll-driven auto-collapse observer entirely. A section's header bar is `position: sticky` under the top nav; the next section pushes it up as you arrive. Bodies never auto-collapse on scroll. |
| D2 | Expand/collapse control | The **sticky header IS the toggle** (click to open/close a section). The separate "Show/hide details" button is removed. |
| D3 | Initial open/closed state | Stage-driven, not scroll-driven. In **Now Building** only *Milestones* and *Materials* start expanded; other sections render as collapsed sticky bars. Done/acked sections start collapsed. |
| D4 | Data Source greying | A field that **existed at `dataLockedAt`** (the Getting Started → Kickoff data-lock **baseline**) renders greyed/read-only + the **propose-a-change** form (the existing `lockedBaseline` rule). Fields created *after* the lock stay directly editable — they were never part of the frozen baseline. Greying is tied to the lock, not the exact stage. (Codex fix 4: baseline-only, NOT every field.) |
| D5 | Milestone feedback | **Kickoff:** feedback blocks hidden; the section is a milestone-**date** overview. **Now Building:** the review/feedback block is made visually distinct. (Milestones is `primary` only in these two stages.) |
| D6 | Operator saves | **No save buttons on inline *value* editors** (welcome note, section copy/intro/narrative, theme colours/fonts, milestone title/blurb/date, field answers) — they persist on a **trailing debounce / blur** with: one serialized request per editor, stale-response suppression, a queued latest draft, and version-conflict handling; the editor stays registered as active while dirty/saving so `router.refresh()` never clobbers input (Codex fix 3). Explicit buttons remain ONLY for structural/irreversible actions: add/delete field, add/delete milestone, upload PDF/image, delete doc, advance/roll-back stage. |
| D7 | Live theme | Operator theme edits drive the `--vb-*` CSS variables **live** (draft-driven), before persistence; the contrast checker reads the **live draft**. |
| D8 | Contrast bands | **AA only** — remove the AAA bands from the brand contrast checker. |
| D9 | Fonts | Searchable picker over a **checked-in Google Fonts manifest** of stable **keys** → code-owned `{family, supportedWeights, gfQuery}` metadata (the existing 12 keys preserved as aliases). Themes store only **keys**; the font URL is built from code-owned metadata (client input never reaches the URL). Per-family weights come from the manifest — never assume `400;600;700` (Codex fix 9). |
| D10 | Assessment notes | Two new operator-authored (CSM) note blocks on Current-Site Assessment: **General notes** and **User Behaviour**; both rich-text (reusable WYSIWYG). User Behaviour also supports **ER image upload** via the existing operator asset pipeline. |
| D11 | Rich-text editor | One **reusable** WYSIWYG editor + renderer (headings, bold/italic/underline, lists). Adopted only on the two Assessment blocks now; reusable elsewhere later. |
| D12 | Performance decimals | Assessment performance numbers render to **2 decimal places** (CLS is currently uncontrolled). |
| D13 | Version control | **Deferred** to its own spec (per-recipient named links + cookie identity + change history). Not in this set. |

## 3. Non-goals (this pass)

- No version control / change history / per-recipient tokens (separate spec, §14).
- No new stage; the four code stages (`post-contract`, `kickoff`, `website-specifics`, `building`) are unchanged.
- No client-side (public, tokened) file uploads — image upload in D10 is **operator-only** (ER team), through the existing operator asset route.
- No section reordering, no new sections, no layout variants.
- No change to the token/access model, notifications, or the job/digest layer.

## 4. The interaction model (the crux — Lane 1)

Today `SectionReveal` owns an `IntersectionObserver` (`SectionReveal.tsx:59-87`,
threshold `0.35`) that toggles a per-section `expanded` state, animating the body
via `grid-template-rows: 1fr → 0fr`. Because the observer watches the **same
element whose height it mutates**, it self-oscillates (the blink), worst on the
tall Data Source section; scrolling collapses in-flow height above the reading
position (the "abduction" + the whole page/header vanishing past the shrunken
document end); and the `overflow:hidden` collapse clips editable content (the
truncation).

**New model:**

1. **Remove** the IntersectionObserver and all scroll-driven `expanded` state.
2. Each section renders a **sticky header bar** (`position: sticky; top: var(--vb-sticky-offset)`) that stays visible while the section is in view and is pushed up by the next section's header — standard CSS sticky stacking, no JS scroll handler.
3. The **compact sticky header bar** (NOT the large hero band) contains a native `<button>` with `aria-expanded` + `aria-controls` pointing at the body region — the expand/collapse toggle, replacing the removed "Show/hide details" button. `always-open` sections (`pc-intro`) render a non-interactive heading, no button. (Codex fix 8.)
4. **Body visibility is state-only, never scroll-driven.** Initial state comes from a pure `sectionInitiallyOpen(section, stage)` policy (in `section-display.ts`):
   - `always-open` keys → open, no toggle.
   - Done / acked sections → collapsed.
   - Stage policy: in `building`, only `milestones` + `materials` open; all other primary sections collapsed. Other stages keep every non-collapsed section open by default (current behaviour minus the auto-collapse).
5. **Navigation** (`viewbook-navigate.ts`, TOC clicks): preserve the existing `vb:navigate` event; **force-open the target section, THEN `scrollIntoView`**. No `manuallyToggledRef` latch needed — there is no auto-behaviour to suppress. Replace the fixed `scroll-mt-24` with `scroll-margin-top: calc(var(--vb-sticky-offset) + <gap>)`.
6. **Reduced motion** and the collapse CSS animation are retained for the click toggle only (no layout thrash because nothing drives it from scroll).

This single change resolves: the blink (D1), the scroll feel (D1/D2), editor
truncation (bodies no longer clipped), the "Show/hide details buttons gone" ask
(D2), and is the leading fix for the footer-whitespace bug (the collapse-height
artifact + the post-footer `TocRail` island). Footer whitespace is verified with
systematic-debugging inside Lane 1; residual fix (if any) is a `ViewbookShell`
edit, which Lane 1 owns.

### Sticky-offset contract (cross-lane seam — Codex fix 1)

`ProgressNav` (top nav, `sticky top-0`) and, in operator mode, `OperatorBar`
(`sticky top-0`) are **separate sticky siblings** stacked above the section
headers; both are responsive and can wrap, and `OperatorBar` lives *outside*
`ViewbookShell` (under `OperatorViewbookLayer`), so a shell-local CSS constant
CANNOT model their cumulative height. Lane 1 therefore:

- Adds a small **client measurement leaf** that `ResizeObserver`-measures both bars and publishes `--vb-progress-nav-height`, `--vb-operator-bar-height`, and their sum **`--vb-sticky-offset`** on a Lane-1-owned root element. Presentation mode (bar hidden) resets `--vb-operator-bar-height` to 0.
- Sticky section headers pin at `top: var(--vb-sticky-offset)`; sections use `scroll-margin-top: calc(var(--vb-sticky-offset) + gap)`.
- **Pinned z-index order** (explicit): `OperatorBar` > `ProgressNav` > section headers, with the TocRail above section headers. Lane 1 owns this ordering.

**Lane 1 owns the whole sticky-chrome contract** — it therefore owns
`ProgressNav.tsx`, `OperatorBar.tsx` (positioning only), `OperatorViewbookLayer.tsx`
(mount point for the measurement leaf), and the measurement leaf. **Lane 2 does
not touch any sticky positioning.**

## 5. Lane 1 — Reading experience (Claude, Wave 1)

**Satisfies:** blink bug, scroll redesign (D1/D2/D3), show/hide buttons removed,
per-stage initial expand, TOC reposition, green-circle verify, footer-whitespace
bug, open-viewbook-in-new-tab.

- **Sticky-header rewrite** (§4): gut `SectionReveal`'s observer; header-as-toggle; `section-display.ts` gains the pure `sectionInitiallyOpen(section, stage)` policy (replacing the `sectionStartsCollapsed`/`sectionLocksAutoReveal`/auto-reveal pair — `sectionLocksAutoReveal` is deleted with the observer). `SectionShell` renders the sticky header + toggle; `SectionAccents`/`viewbook-navigate` updated for the offset + force-open. Also adds the **`data-vb-theme-root` marker** (Lane 2's live-theme store target) and the **`ResizeObserver` measurement leaf** publishing `--vb-sticky-offset` (§4 contract).
- **TOC rail** (`TocRail.tsx`): default **expanded** (was `useState(false)`), moved to the **left** edge (was `fixed right-3`), the ☰ hamburger is the collapse toggle. Green completion circles already derive from `done`/`acked` (`toc-index.ts` → `Glyph`) — **verify** they fill on ack (D3 of Lane 3 makes acks reliable); no data change here.
- **Now Building initial expand** (D3): the `building`-stage branch of `sectionInitiallyOpen` opens only `milestones` + `materials`.
- **Footer whitespace bug:** systematic-debugging; expected resolved by removing the collapse-height artifact and by the sticky-model `ViewbookShell` restructure; the post-footer `TocRail` island and `min-h-[30/38vh]` hero bands are the prime suspects (agent map §8). Residual fix in `ViewbookShell`.
- **Open in new tab** (admin): the viewbook name becomes an `<a target="_blank" rel="noopener">` to the public `/viewbook/[token]` page in the admin index/card and the editor header.

**Interface frozen during the wave:** the `renderSection` → `SectionShell`
prop contract and `PublicSection` shape (leaf sections in L3/L4 render *inside*
`SectionShell` as children and must not need its internals to change).

## 6. Lane 2 — Operator editing UX (Codex, Wave 1)

**Satisfies:** no save buttons / live auto-save (D6), live theme (D7), live
contrast (D7), AA-only (D8), Google-Fonts search (D9), operator edit-panels fully
visible.

- **Auto-save (D6):** the inline **value** editors drop their Save buttons and PATCH on a **trailing debounce / blur**. Reuse `operatorRequest` + `useBaselineSync` draft/commit + the `useViewbookSync` editor-activity registry, and add (Codex fix 3): **one serialized in-flight request per editor**, **stale-response suppression** (ignore a resolved PATCH once a newer draft exists), a **queued latest draft**, and keep the editor **registered active while dirty OR saving** so `router.refresh()` never lands mid-edit. Field-answer writes keep the `version` optimistic-CAS and surface `stale_version` conflicts. Structural/irreversible actions keep explicit buttons.
- **Live theme (D7) — cross-lane seam (Codex fix 2):** driving `--vb-*` live needs a state channel between the Lane-2 operator editor and the public shell, but Lane 2 does NOT own `ViewbookShell`/`ThemeStyle`. Seam: **Lane 2 owns a client theme store** (`useSyncExternalStore`) that, on draft change, writes the `--vb-*` variables + the font `<link>` onto a **Lane-1-owned `data-vb-theme-root` marker element** (Lane 1 adds the marker and guarantees the server-rendered inline vars can be overridden by the store). Persistence still PATCHes; the live vars are the pre-persist preview.
- **Live contrast (D7):** `ContrastTester` reads the **live draft** theme from the same Lane-2 store (not only the persisted `data.theme` prop), so ratios update as the operator drags a colour.
- **AA-only (D8):** remove `aaaNormal`/`aaaLarge` from `BAND_ORDER`/`BAND_LABELS`/`BandChips` and the "AA/AAA" subheading in `ContrastTester.tsx`. The `contrast.ts` `aaa*` bands may remain defined (unused) or be trimmed — plan decides; no other consumer.
- **Fonts (D9, Codex fix 9):** replace the fixed 12-key gate with a **searchable picker over a checked-in manifest** (`lib/viewbook/font-manifest.ts`, code-owned: key → `{family, supportedWeights, gfQuery}`; the 12 existing keys preserved as **aliases**; generated from the Google Fonts API at commit time — no runtime third-party call). Themes still store **keys only**; `theme.ts` validates the key against the manifest; `fontsHref` builds the URL from the manifest's `gfQuery`/`supportedWeights` (NEVER from a submitted family string; never assume `400;600;700`). CSP fonts origins unchanged (`fonts.googleapis.com`/`fonts.gstatic.com`).
- **Operator panels visible:** the `<details>`-accordion "Edit …" panels open by default (or become always-visible inline editors) so operator content is fully visible, not hidden behind a summary.

**Owns (added):** `BrandSection.tsx` (consumes `FONT_CATALOG`).
**Must not touch:** any sticky positioning (Lane 1's contract), any Lane 1 / L3 / L4 file.

## 7. Lane 3 — Stage flow & content (Codex, Wave 2)

**Satisfies:** Data Source greyed+propose (D4), milestone Kickoff-vs-Now-Building
behaviour (D5), reset-ack for all three sections, thank-you gating fix.

- **Data Source (D4, baseline-only)** (`DataSourceSection.tsx`): keep the existing `lockedBaseline` rule — a field whose `createdAt <= dataLockedAt` renders greyed/read-only + `AmendmentForm` (propose-a-change; the non-overwriting `ViewbookFieldAmendment` mechanism is already built); fields created after the lock stay directly editable. Restyle locked fields as visibly **greyed/disabled** with a clear "propose a change" affordance. No schema change.
- **Milestones (D5)** (`MilestonesSection.tsx`): branch on `data.stage`. In `kickoff`, hide the `withLinks`/`FeedbackThread` review block and present a milestone-**date** overview (clean list/timeline of milestones + target dates; dates are still edited admin-side via `MilestonesEditor`). In `building`, keep the review/feedback block but make it visually **distinct** (its own titled, bordered "Review & feedback" region so the client action is obvious). **No `website-specifics` special case** — milestones is `carried` there and renders through the normal Earlier-Steps path (Codex OQ4).
- **Ack correction (Codex fix 7):** `buildPcCompletion` in `ack.ts` currently excludes **hidden** ackable rows from the unacked predicate, and `setSectionState` (in `service.ts`) invokes completion when a section is hidden — so hiding an unacked section can falsely stamp `pcCompletedAt`. Fix: require ALL three ackable sections (`pc-setup`, `pc-invite`, `data-source`) to have non-null `acknowledgedAt` **regardless of visibility**, and **remove the hide-triggered completion call from `setSectionState`**. Existing false completions are NOT auto-reversed; operator force-advance stays the escape hatch.
- **Reset-ack control:** `SectionQuickControls.tsx` shows the operator ack/reset control consistently for all three ackable sections; ensure the client ack for invite/data-source persists so the control (and the TOC green circle) appear.
- **Thank-you (`PcThanksSection`):** appears only once all three acks land (gated on `pcCompletedAt`); the correction above makes that honest.

**Owns:** `DataSourceSection`, `MilestonesSection`, `ack.ts`, `service.ts`
(sole owner of `setSectionState` this wave — Codex fix 6), `SectionQuickControls`,
`PcThanksSection`. No schema change.

## 8. Lane 4 — Rich-text + Assessment (Claude, Wave 2)

**Satisfies:** reusable rich-text editor (D11), two Assessment note blocks with ER
image upload (D10), performance 2-decimals (D12). **Owns the schema migration.**

**Serial split within the lane (Codex fix 5)** — build (a) the rich-text core, then (b) assessment persistence/integration. One concurrent lane, reduced blast radius.

- **Reusable rich-text editor** (D11, Codex fix 10): new `components/richtext/` — a WYSIWYG editor (headings H2/H3, bold/italic/underline, bullet/ordered lists) that stores **tightly sanitized HTML**. Server-side allowlist of ONLY the required structural tags; **strip all attributes, inline styles, event handlers, links, and embedded media**; render only sanitized output and **defensively sanitize legacy reads**. Self-contained server-side sanitizer (npm dep, no CDN). Reused later; adopted now only on Assessment. (OQ1 resolved: sanitized HTML.)
- **Assessment notes** (D10): two operator-authored blocks after the narrative, before the "Scanned" footer, in `AssessmentSection.tsx`: **General notes** (rich text) and **User Behaviour** (rich text + **ER-only image upload**; images are separate assets, rendered inline/attached — never embedded in the HTML).
- **Schema (additive migration — Codex OQ2):** a dedicated **1:1 `ViewbookAssessmentContent`** model keyed by `viewbookId` (cascade from `Viewbook`) holding the two sanitized HTML bodies, plus a child **`ViewbookAssessmentImage`** table (filename matching `ASSET_FILENAME_RE`, `sortOrder`). NOT nullable columns on the generic `ViewbookSection`. `assessment.ts` loads them; `public-types.ts` carries them.
- **Routes + auth (Codex fix 5):** cookie-gated operator note/image mutation routes under `app/api/viewbooks/[id]/assessment/**`, wrapped in `withRoute` + operator-authorized; each write **bumps `syncVersion`** (existing `sync.ts` factory). Public reads flow through the payload only.
- **Asset lifecycle (Codex fix 5):** image upload reuses the operator asset pipeline (`ASSET_FILENAME_RE`, `VIEWBOOK_ASSETS_DIR`); the public assets route **allowlists** the assessment image filenames (curated-set gate like theme/hero assets); **failed-write orphan cleanup + image deletion** on remove; **viewbook/client delete removes the image files**. This cleanup is wired via `lib/viewbook/retention.ts` + the client-delete asset-snapshot route (`app/api/clients/[id]/route.ts`) — **NOT `service.ts`** (Lane 3 owns that this wave — Codex fix 6).
- **Operator plumbing (Codex fix 5):** `AssessmentSection` currently receives no operator identity/editor data — Lane 4 threads operator identity + assessment content into it; the operator-gated note/image editors mount **inside `AssessmentSection`** as new leaf components (NOT via `InlineEditors`, keeping that a Lane-2-only file).
- **Performance decimals (D12):** in `AssessmentSection.tsx`, render CLS (and any other float) to 2 decimals; integer scores `/100` and 1-decimal LCP seconds stay — target is the uncontrolled CLS float.

**Owns:** `prisma/schema.prisma` + migration (the ONLY schema-touching lane),
`AssessmentSection.tsx`, `lib/viewbook/assessment.ts`,
`lib/viewbook/public-types.ts` (assessment fields), new `components/richtext/*`,
the assessment operator-note leaf components, new `app/api/viewbooks/[id]/assessment/**`
routes, a new `lib/viewbook/assessment-notes.ts` service, `lib/viewbook/retention.ts`
(assessment-image pruning), `app/api/clients/[id]/route.ts` (assessment-image
delete in the snapshot), the public assets route (assessment allowlist), + all
tests. **Does NOT touch `service.ts`.**

## 9. Cross-lane seams (the only coupling)

1. **Sticky chrome + `--vb-sticky-offset`** (Wave 1) — Lane 1 owns it ENTIRELY: `ProgressNav`, `OperatorBar` positioning, the `OperatorViewbookLayer` measurement-leaf mount, the `ResizeObserver` leaf, and the z-index order. Lane 2 touches no sticky positioning.
2. **Live-theme store seam** (Wave 1 — Codex fix 2) — Lane 2 owns the client theme store (`useSyncExternalStore`) and writes `--vb-*` + the font `<link>` onto a **Lane-1-owned `data-vb-theme-root` marker**. Lane 1's only obligation: add the marker element and ensure the server-rendered inline vars are overridable by the store. **This seam is agreed in both plans before Wave 1 opens.**
3. **`renderSection`/`SectionShell` prop contract + `PublicSection` shape** — frozen for the duration; L3/L4 leaf sections render as children and never require internal changes.
4. **`section-display.ts`** — Lane 1 only. L3's milestone/data-source behaviour keys off `data.stage`/`dataLockedAt` inside the leaf components, not off `section-display`.
5. **`service.ts`** (Wave 2 — Codex fix 6) — Lane 3 is the SOLE owner (`setSectionState` ack fix). Lane 4 routes all its cleanup through `retention.ts` + the client-delete route, never `service.ts`.
6. **Green circles** — Lane 1 renders; Lane 3 makes ack state reliable. Data-only dependency (`acknowledgedAt`), no shared file.

No file appears in two concurrently-running lanes (§10). The two waves are ordered
so W2 rebases on a merged W1 (sticky model + live-theme store already in `main`).

## 10. File ownership map (exact; C=create, M=modify, D=delete)

**Lane 1 (Claude, W1)** — C: sticky-offset `ResizeObserver` measurement leaf
(`components/viewbook/public/StickyOffsetProbe.tsx` or similar). M:
`components/viewbook/public/SectionReveal.tsx`, `SectionShell.tsx`,
`ViewbookShell.tsx` (+ the `data-vb-theme-root` marker for Lane 2's store),
`TocRail.tsx`, `SectionAccents.tsx`, `viewbook-navigate.ts`, `ProgressNav.tsx`,
`lib/viewbook/section-display.ts`,
`components/viewbook/public/OperatorLayer/OperatorBar.tsx` (positioning only),
`OperatorViewbookLayer.tsx` (measurement-leaf mount),
`components/viewbook/admin/ViewbookIndex.tsx`, `ViewbookCard.tsx`,
`ViewbookEditor.tsx` (open-in-new-tab link) + all their `.test.*`.

**Lane 2 (Codex, W1)** — C: `lib/viewbook/font-manifest.ts` (+ test) and a
client theme store (`components/viewbook/public/OperatorLayer/theme-store.ts` +
its live-writer island). M:
`components/viewbook/public/OperatorLayer/InlineEditors.tsx`, `operator-api.ts`,
`components/viewbook/public/useViewbookSync.ts`,
`components/viewbook/public/ThemeStyle.tsx`, `ContrastTester.tsx`,
`BrandSection.tsx`, `lib/viewbook/theme.ts`, `lib/viewbook/contrast.ts` (AAA trim),
`components/viewbook/admin/ThemeEditor.tsx` (font-picker parity) + tests.

**Lane 3 (Codex, W2)** — M: `components/viewbook/public/DataSourceSection.tsx`,
`MilestonesSection.tsx`, `components/viewbook/public/OperatorLayer/SectionQuickControls.tsx`,
`components/viewbook/public/PcThanksSection.tsx`, `lib/viewbook/ack.ts`,
`lib/viewbook/service.ts` (sole owner — `setSectionState` ack fix) + tests.

**Lane 4 (Claude, W2)** — C: `components/richtext/*` (editor + renderer + tests),
assessment operator-note leaf component(s), `app/api/viewbooks/[id]/assessment/**`
routes, `lib/viewbook/assessment-notes.ts` service. M: `prisma/schema.prisma` +
migration (`ViewbookAssessmentContent` + `ViewbookAssessmentImage`),
`components/viewbook/public/AssessmentSection.tsx`, `lib/viewbook/assessment.ts`,
`lib/viewbook/public-types.ts` (assessment fields), `lib/viewbook/retention.ts`
(image pruning), `app/api/clients/[id]/route.ts` (assessment-image delete snapshot),
`app/api/viewbook/[token]/assets/[filename]/route.ts` (extend the curated allowlist
to serve assessment images — reuse the existing public assets route, NO new
`middleware.ts` matcher) + tests. Mutation routes live under the already-cookie-gated
`app/api/viewbooks/[id]/**` space — no public matcher needed.

*(Splitting rule: if any plan finds two lanes needing the same file, move the WHOLE
file to one lane, never split it. `service.ts` → Lane 3; `retention.ts` /
client-delete route / public assets route → Lane 4; `ThemeEditor.tsx` → Lane 2;
`ViewbookEditor.tsx` → Lane 1. `middleware.ts` is NOT touched by any lane —
mutations are cookie-gated, public serving reuses an existing matched route.)*

## 11. Waves, coordination, gates

- **Wave 1:** Lane 1 (Claude) ∥ Lane 2 (Codex). Merge both.
- **Wave 2:** Lane 4 (Claude) ∥ Lane 3 (Codex), rebased on W1. Merge both.
- **Worktrees:** one per lane under `.claude/worktrees/` (`viewbook-l1` … `viewbook-l4`) on branches `feat/viewbook-l1` … `l4`. `git worktree list` pre-flight before opening any lane. **Note:** a second Claude session is live in this checkout — lanes MUST be isolated worktrees; never edit feature files on `main`.
- **Cross-review before every merge:** Codex branch → Claude reviews the diff; Claude branch → `/codex-review` (P1). Advisory; merge stays gate-green-only.
- **Gates per lane (inside its worktree):** `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`. Lane 4 additionally runs `prisma migrate` locally; Lane 2 runs `npm run audit:ci` if it touches the font-manifest generation/dependencies.

## 12. Codex budget posture (this push)

- Codex runs at **full strength** (`sol`, high) for **all** work this push — spec review, plan review, and Lane 2/Lane 3 implementation — overriding the usual budget-gated downgrade, **until usage is exhausted**. Kevin holds a reset (expires ~tonight) and will reset on exhaustion; Codex then continues on the same lane.
- **Out-of-usage check (required):** every Codex invocation (reviews and lane work) must detect the usage-exhausted/limit error and, on hit, **immediately pause that lane and notify Kevin in one line** ("Codex out of usage — reset to resume Lane N") rather than silently retrying or downgrading the model. The goal is minimal dead time: Kevin resets, we re-fire the same lane brief. This is wired into the handoff prompt and each Codex brief.

## 13. Testing

- **Lane 1:** unit tests that the sticky header toggles body state on click and that **no scroll event mutates body state** (regression guard for the blink); `sectionInitiallyOpen` policy table (Now Building → only milestones+materials open; done/acked → collapsed; always-open → open); TocRail default-expanded + left + hamburger; navigate force-opens target; footer-whitespace regression (no empty block below footer across stage transitions).
- **Lane 2:** auto-save debounce fires a single PATCH and never clobbers an active edit; live `--vb-*` vars reflect the draft pre-persist; contrast reads the live draft; AA-only (no AAA chips); font-manifest `isAllowedFont` accepts a known family, rejects an unlisted/injection string; `fontsHref` encodes the family.
- **Lane 3:** Data Source greyed+propose when `dataLockedAt` set / editable when not; milestones hide feedback in kickoff, distinct block in building; reset-ack present for all three; `pcCompletedAt` NOT stamped by hiding an unacked section; thank-you appears only when all required acks land.
- **Lane 4:** rich-text editor round-trips + sanitizes (no script/style/link/media injection; legacy reads re-sanitized); Assessment renders both note blocks + User-Behaviour images; operator image upload persists + is allowlisted on the public route; migration applies + is reversible.
- **Cross-cutting (Codex fix 11):** autosave out-of-order response suppression (a stale PATCH resolving after a newer draft must not revert); presentation-mode sticky-offset (operator bar hidden → offset excludes it, no layout jump); navigation force-open (target opens before scroll); assessment asset authorization + allowlist + orphan/delete cleanup; post-lock **custom** fields remain directly editable (baseline-only lock); hiding an unacked section does NOT stamp `pcCompletedAt`; a browser-level footer/document-height assertion (no empty block below the footer after stage round-trips).

## 14. Deferred — Version Control (separate spec, next)

Written immediately after this set as its own spec+plan+PR program. Scope
(captured now so nothing is lost): per-recipient **named share links** (each email
recipient gets a link that designates that user; cookie retains identity), a
**session/actor identity** on the public side (today the client is anonymous —
one opaque token, no cookie), and **change history** (today only post-lock field
amendments + a lossy activity feed exist; no snapshot/version table). The natural
anchor for per-recipient tokens is `ViewbookTeamMember` (already name/email per
person, no token column yet). Additive migration; every fenced public write would
also accept a recipient token. Full identity + history model designed in that
spec.

## 15. Open questions — RESOLVED (Codex review 2026-07-17)

- **OQ1 → sanitized HTML.** Strict server-side tag allowlist; strip attributes/styles/handlers/links/media; images are separate assets; re-sanitize legacy reads (§8, D11).
- **OQ2 → dedicated model.** 1:1 `ViewbookAssessmentContent` (by `viewbookId`) + child `ViewbookAssessmentImage`; NOT nullable columns on `ViewbookSection` (§8).
- **OQ3 → measured offset.** `ResizeObserver` measurement leaf publishing `--vb-*-height` + `--vb-sticky-offset`, with a conservative CSS fallback; verify no layout jump on presentation-mode toggle (§4).
- **OQ4 → no special case.** Milestones is `carried` in `website-specifics`; it renders through the normal Earlier-Steps path; only `kickoff`/`building` get the primary-stage treatment (§7).

### Things Kevin should verify (Codex)

- Data Source lock is **baseline-only** (fields at/before `dataLockedAt` freeze; post-lock custom fields stay editable) — confirm this matches "the data saved when Getting Started advanced to Kickoff." (I read it as yes.)
- Previously false-stamped `pcCompletedAt` rows are left as-is (not auto-reversed); operator force-advance is the escape hatch.
- Cross-tab / multi-operator theme edits remain last-writer-wins until the version-control spec lands.
- Font manifest scope: full Google Fonts family list vs a curated weight-compatible subset (plan picks; both are safe since only keys are stored).
