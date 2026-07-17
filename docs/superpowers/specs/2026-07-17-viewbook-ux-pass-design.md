# Client Viewbook — Bugfix + UX Pass — Design

**Date:** 2026-07-17
**Status:** Draft (brainstorming approved by Kevin, shape locked); Codex review pending
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
| D4 | Data Source greying | A field is greyed/read-only + shows the **propose-a-change** form whenever the Data Source lock is set (`dataLockedAt`, stamped at the Getting Started → Kickoff data-lock) — i.e. **anything post-kickoff-ack is greyed**, independent of exact stage. This is the existing `lockedBaseline` path, tied to the lock and restyled. |
| D5 | Milestone feedback | **Kickoff:** feedback blocks hidden; the section is a milestone-**date** overview. **Now Building:** the review/feedback block is made visually distinct. (Milestones is `primary` only in these two stages.) |
| D6 | Operator saves | **No save buttons on inline text/theme editors** — debounced auto-save. Discrete actions (add field, upload PDF/image, delete, advance/roll-back stage) keep explicit buttons. |
| D7 | Live theme | Operator theme edits drive the `--vb-*` CSS variables **live** (draft-driven), before persistence; the contrast checker reads the **live draft**. |
| D8 | Contrast bands | **AA only** — remove the AAA bands from the brand contrast checker. |
| D9 | Fonts | Searchable font picker over the **full Google Fonts family list** (bundled manifest), server-validated against that allowlist before persist; the font URL is built from the validated family only (client input never reaches the URL unvalidated). |
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
3. The header bar is the **expand/collapse toggle** (`aria-expanded`, click/Enter/Space). It replaces the removed "Show/hide details" button. `always-open` sections (`pc-intro`) render no toggle.
4. **Body visibility is state-only, never scroll-driven.** Initial state comes from a pure `sectionInitiallyOpen(section, stage)` policy (in `section-display.ts`):
   - `always-open` keys → open, no toggle.
   - Done / acked sections → collapsed.
   - Stage policy: in `building`, only `milestones` + `materials` open; all other primary sections collapsed. Other stages keep every non-collapsed section open by default (current behaviour minus the auto-collapse).
5. **Navigation** (`viewbook-navigate.ts`, TOC clicks): force-open the target section, then `scrollIntoView`. No `manuallyToggledRef` latch needed — there is no auto-behaviour to suppress. `scroll-mt` accounts for `--vb-sticky-offset`.
6. **Reduced motion** and the collapse CSS animation are retained for the click toggle only (no layout thrash because nothing drives it from scroll).

This single change resolves: the blink (D1), the scroll feel (D1/D2), editor
truncation (bodies no longer clipped), the "Show/hide details buttons gone" ask
(D2), and is the leading fix for the footer-whitespace bug (the collapse-height
artifact + the post-footer `TocRail` island). Footer whitespace is verified with
systematic-debugging inside Lane 1; residual fix (if any) is a `ViewbookShell`
edit, which Lane 1 owns.

### Sticky-offset contract (cross-lane seam)

`ProgressNav` (top nav, `sticky top-0 z-40`) and, in operator mode, `OperatorBar`
(`sticky top-0 z-40`) stack above the section headers. Lane 1 introduces a single
CSS custom property **`--vb-sticky-offset`** = cumulative height of the pinned
chrome, set on the shell root and consumed by the sticky section headers and
`scroll-mt`. **Lane 1 owns this contract and the minimal `OperatorBar` top-offset
wiring; Lane 2 does not touch `OperatorBar` positioning.** In the anonymous
(non-operator) branch the offset is just the nav height; in operator mode it adds
the operator bar height (measured via a small mount effect or a CSS `sticky`
stack — plan decides).

## 5. Lane 1 — Reading experience (Claude, Wave 1)

**Satisfies:** blink bug, scroll redesign (D1/D2/D3), show/hide buttons removed,
per-stage initial expand, TOC reposition, green-circle verify, footer-whitespace
bug, open-viewbook-in-new-tab.

- **Sticky-header rewrite** (§4): gut `SectionReveal`'s observer; header-as-toggle; `section-display.ts` gains the pure `sectionInitiallyOpen(section, stage)` policy (replacing the `sectionStartsCollapsed`/`sectionLocksAutoReveal`/auto-reveal pair — `sectionLocksAutoReveal` is deleted with the observer). `SectionShell` renders the sticky header + toggle; `SectionAccents`/`viewbook-navigate` updated for the offset + force-open.
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

- **Auto-save (D6):** the inline text/theme editors (`InlineEditors.tsx`) drop their Save buttons and PATCH on a debounced change (reuse `operatorRequest` + the `useBaselineSync` draft/commit + the `useViewbookSync` editor-activity registry so a save never clobbers a live keystroke). Discrete actions keep buttons. Optimistic-concurrency writes (field `version`) keep their conflict handling.
- **Live theme (D7):** the operator theme draft drives the `--vb-*` variables **before** persistence — the draft is lifted so `ViewbookShell`/`ThemeStyle`'s consumed vars reflect the in-progress edit (no wait for `router.refresh()`). Font `<link>` for a newly-picked family loads from the draft too.
- **Live contrast (D7):** `ContrastTester` reads the **live draft** theme (not only the persisted `data.theme` prop), so ratios update as the operator drags a colour.
- **AA-only (D8):** remove `aaaNormal`/`aaaLarge` from `BAND_ORDER`/`BAND_LABELS`/`BandChips` and the "AA/AAA" subheading in `ContrastTester.tsx`. The `contrast.ts` `aaa*` bands may remain defined (unused) or be trimmed — plan decides; no other consumer.
- **Fonts (D9):** replace the fixed 12-key `FONT_CATALOG` gate with a **searchable picker** over a bundled Google Fonts **family manifest** (a code-owned list of valid family names, e.g. generated from the Google Fonts API at build/commit time and checked in — no runtime third-party dependency). `theme.ts` validation accepts a curated key **or** an allowlisted family; `fontsHref` builds `family=<encoded family>:wght@...` only from the validated family. CSP fonts origins already permit `fonts.googleapis.com`/`fonts.gstatic.com` (unchanged). New module `lib/viewbook/font-manifest.ts` (+ test) holds the manifest + `isAllowedFont`.
- **Operator panels visible:** the `<details>`-accordion "Edit …" panels open by default (or become always-visible inline editors) so operator content is fully visible, not hidden behind a summary.

**Must not touch:** `OperatorBar` positioning (Lane 1's sticky-offset), any Lane 1
/ L3 / L4 file.

## 7. Lane 3 — Stage flow & content (Codex, Wave 2)

**Satisfies:** Data Source greyed+propose (D4), milestone Kickoff-vs-Now-Building
behaviour (D5), reset-ack for all three sections, thank-you gating fix.

- **Data Source (D4)** (`DataSourceSection.tsx`): tie the read-only + `AmendmentForm` (propose-a-change) path to `dataLockedAt` being set (already the `lockedBaseline` condition) and restyle locked fields as visibly **greyed/disabled** with a clear "propose a change" affordance. The amendment mechanism already exists (`ViewbookFieldAmendment`, non-overwriting) — no schema change.
- **Milestones (D5)** (`MilestonesSection.tsx`): branch on `data.stage`. In `kickoff`, hide the `withLinks`/`FeedbackThread` review block and present a milestone-**date** overview (clean list/timeline of milestones + target dates; dates are still edited admin-side via `MilestonesEditor`). In `building`, keep the review/feedback block but make it visually **distinct** (its own titled, bordered "Review & feedback" region so the client action is obvious).
- **Reset-ack + acks:** the operator "Reset ack" control (`SectionQuickControls.tsx`) is present/behaves consistently for all three ackable sections (`pc-setup`, `pc-invite`, `data-source`); ensure the client ack for invite/data-source persists so the control (and green circle) appear. `ack.ts`: fix the "hiding a section fakes completion" caveat so `pcCompletedAt` (and thus the thank-you) is stamped only when the required sections are genuinely acked, not merely hidden.
- **Thank-you (`PcThanksSection`):** confirm it only appears once each required section is acknowledged (already gated on `pcCompletedAt`); the fix above makes that honest.

**Owns:** `DataSourceSection`, `MilestonesSection`, `ack.ts`,
`SectionQuickControls`, `PcThanksSection`. No schema change.

## 8. Lane 4 — Rich-text + Assessment (Claude, Wave 2)

**Satisfies:** reusable rich-text editor (D11), two Assessment note blocks with ER
image upload (D10), performance 2-decimals (D12). **Owns the schema migration.**

- **Reusable rich-text editor** (D11): new `components/richtext/` — a WYSIWYG editor (headings H2/H3, bold/italic/underline, bullet/ordered lists) producing **sanitized HTML** (or a constrained markdown subset — plan decides; sanitize on read+write), plus a renderer. Self-contained, no external CDN (repo/CSP rule). Reused later; adopted now only on Assessment.
- **Assessment notes** (D10): two operator-authored blocks after the narrative, before the "Scanned" footer, in `AssessmentSection.tsx`:
  - **General notes** — rich text.
  - **User Behaviour** — rich text + **ER image upload** (operator-only) via the existing operator asset pipeline (`publicAssetUrl(token, …)` / the viewbook assets route); images render inline/attached to the block.
- **Schema (additive migration):** new nullable columns for the two note bodies (e.g. on `ViewbookSection` for the `assessment` section, or a small `ViewbookAssessmentNote` structure — plan decides) + storage for User-Behaviour image filenames (reusing the asset filename convention). `assessment.ts` loads them into the payload; `public-types.ts` carries them. Operator editing UI for these blocks mounts **inside `AssessmentSection`** (operator-gated), as new leaf components — **not** via `InlineEditors` (keeps `InlineEditors` a Lane-2-only file).
- **Performance decimals (D12):** in `AssessmentSection.tsx`, render CLS (and any other float) to 2 decimals; keep integer scores `/100` and the 1-decimal LCP seconds as-is unless they read wrong — target is the uncontrolled CLS float.

**Owns:** `prisma/schema.prisma` + migration (the ONLY schema-touching lane),
`AssessmentSection`, `assessment.ts`, new `components/richtext/*`, the
Assessment operator-note leaf components, and their tests.

## 9. Cross-lane seams (the only coupling)

1. **`--vb-sticky-offset`** — defined/owned by Lane 1; Lane 2 leaves `OperatorBar` positioning to Lane 1. The only shared CSS concern.
2. **`renderSection`/`SectionShell` prop contract + `PublicSection` shape** — frozen for the duration; L3/L4 leaf sections render as children and never require internal changes.
3. **`section-display.ts`** — Lane 1 only. L3's milestone/data-source behaviour keys off `data.stage`/`dataLockedAt` inside the leaf components, not off `section-display`.
4. **Green circles** — Lane 1 verifies rendering; Lane 3 makes ack state reliable. Data-only dependency (`acknowledgedAt`), no shared file.

No file appears in two lanes (§10). The two waves are ordered so W2 rebases on a
merged W1 (sticky model + operator UX already in `main`).

## 10. File ownership map (exact; C=create, M=modify, D=delete)

**Lane 1 (Claude, W1)** — M: `components/viewbook/public/SectionReveal.tsx`,
`SectionShell.tsx`, `ViewbookShell.tsx`, `TocRail.tsx`, `SectionAccents.tsx`,
`viewbook-navigate.ts`, `lib/viewbook/section-display.ts`,
`components/viewbook/public/OperatorLayer/OperatorBar.tsx` (sticky-offset wiring
ONLY), `components/viewbook/admin/ViewbookIndex.tsx`, `ViewbookCard.tsx`,
`ViewbookEditor.tsx` (open-in-new-tab link) + all their `.test.*`.

**Lane 2 (Codex, W1)** — C: `lib/viewbook/font-manifest.ts` + test. M:
`components/viewbook/public/OperatorLayer/InlineEditors.tsx`, `operator-api.ts`,
`components/viewbook/public/useViewbookSync.ts`,
`components/viewbook/public/ThemeStyle.tsx`, `ContrastTester.tsx`,
`lib/viewbook/theme.ts`, `lib/viewbook/contrast.ts` (AAA trim, optional),
`components/viewbook/admin/ThemeEditor.tsx` (font picker parity) + tests.

**Lane 3 (Codex, W2)** — M: `components/viewbook/public/DataSourceSection.tsx`,
`MilestonesSection.tsx`, `components/viewbook/public/OperatorLayer/SectionQuickControls.tsx`,
`components/viewbook/public/PcThanksSection.tsx`, `lib/viewbook/ack.ts` + tests.

**Lane 4 (Claude, W2)** — C: `components/richtext/*` (editor + renderer + tests),
Assessment operator-note leaf component(s). M: `prisma/schema.prisma` + migration,
`components/viewbook/public/AssessmentSection.tsx`, `lib/viewbook/assessment.ts`,
`lib/viewbook/public-types.ts` (assessment note fields), the assessment asset-upload
wiring + tests.

*(`ThemeEditor.tsx` is Lane 2's for font parity; `ViewbookEditor.tsx` is Lane 1's
for the new-tab link — no other lane touches either. If the plan finds a conflict,
resolve by moving the whole file to one lane, never splitting it.)*

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
- **Lane 4:** rich-text editor round-trips + sanitizes (no script/style injection); Assessment renders both note blocks + User-Behaviour images; operator image upload persists via the asset route; CLS renders to 2 decimals; migration applies + is reversible.

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

## 15. Open questions / flagged for Codex review

- **OQ1:** Rich-text storage format — sanitized HTML vs constrained markdown subset. Recommendation: sanitized HTML with an allowlist (DOMPurify-style, self-contained), rendered by the reusable renderer. Codex to confirm the sanitization boundary.
- **OQ2:** Assessment note storage shape — nullable columns on `ViewbookSection` vs a dedicated `ViewbookAssessmentNote` table (cleaner if we expect the reusable rich-text to spread). Plan decides; Codex to sanity-check the migration.
- **OQ3:** `--vb-sticky-offset` measurement — pure CSS sticky-stack vs a measured mount effect for the operator-bar height. Lane 1 plan decides; verify no layout shift on operator-mode toggle.
- **OQ4:** Website-Specifics milestones — milestones is `carried` (Earlier Steps) there, so D5's kickoff/building split doesn't apply prominently; confirm no special handling needed.
