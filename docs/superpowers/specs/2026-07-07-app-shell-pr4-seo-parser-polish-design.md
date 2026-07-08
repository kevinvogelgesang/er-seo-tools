# A8 PR 4 — seo-parser Visual Polish (upload page + results header) — Design

**Status:** spec
**Date:** 2026-07-07
**Roadmap item:** A8, spec §8 "PR 4+ — Per-tool polish passes" (see
`docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md` §5, §8).
**Class:** UI change, small size (visual/primitive-adoption only).

## 1. Goal

Adopt the "Navy Command Deck" visual language and the `components/ui/`
primitives (`ScoreRing`, deck card language) on the two highest-visibility
seo-parser surfaces — the `/seo-parser` upload page and the results-page
**header region** — as the first per-tool polish pass of A8 PR 4+.

This is a **visual/primitive-adoption pass only.** It changes no tool
behavior, no data, no API, no route, no parser. It is independently
shippable and does not depend on any later per-tool PR.

## 2. Non-goals

- No behavior/data/API/route/parser change of any kind.
- No restyle of results tables/panels/modals (IssueTabs, IssueList,
  PagesTable, RecommendationsPanel, RecommendationList, PageDetailModal,
  SuggestedPriorities, KeywordSignalsPanel, DuplicateContentSection,
  charts). Those are later PRs if Kevin wants them.
- No extraction of a shared `KpiTile`/`Card` primitive (spec §5 lists these
  as future extractions; MetricsBar stays as-is structurally). Deferred to
  avoid touching the shared public share view.
- No change to the seo-parser diff page.
- No change to any public share view (`app/(public)/share/[token]`), which
  composes MetricsBar/IssueTabs directly and keeps its own wrapper.
- No change to react-dropzone wiring or folder-upload behavior.
- **No restyle of the header child action components** rendered inside
  `ResultsView`'s header row (`ResultsView.tsx:98-120`): `CopyToClipboard`,
  `ExportButtons`, `PillarAnalysisButtonClient`, `GenerateRoadmapButton`,
  `ShareModal`. (Codex #3 — an easy scope-creep path; only the header row's
  own title + Share/New-Analysis buttons defined directly in ResultsView are
  in scope.)

## 3. Context (verified against code, 2026-07-07)

- **Shell provides the page background.** `components/shell/AppShell.tsx:91`
  wraps `<main>` in `bg-[#f4f6f9] dark:bg-navy-deep`. Every `(app)` page
  renders inside it (`app/(app)/layout.tsx` → `AppShell`).
- **Redundant wrappers.** Both `app/(app)/seo-parser/page.tsx:109` and
  `components/seo-parser/ResultsView.tsx:77` re-declare
  `min-h-screen bg-[#f4f6f9] dark:bg-navy-deep`, double-applying the shell
  background and forcing full height inside an already-full-height column.
- **seo-parser `ResultsView` is authed-only.** Imported solely by
  `app/(app)/seo-parser/results/[sessionId]/page.tsx` and
  `.../results/run/[runId]/page.tsx` — both inside the shell. The public
  seo-parser share page does **not** use it. So reconciling ResultsView's
  wrapper cannot affect a shell-less surface.
- **MetricsBar is shared** with the public share page
  (`app/(public)/share/[token]/page.tsx:3`). Only a pixel-identical
  hex→token swap is allowed on it; no structural change.
- **Health score renders as plain text** at `ResultsView.tsx:135-137`
  (`SEO health score: {healthScore}/100`) inside a card, above
  `<ScoreExplanation/>`. Prime `ScoreRing` adoption target.
- **Design tokens** (`tailwind.config.ts`): `navy` `#1c2d4a`, `navy.deep`
  `#0f1d30`, `navy.card` `#243556`, `navy.border` `#344d6e`; `orange`
  `#f5a623`, `orange.dark` `#d4881a`, `orange.light` `#f7b94d`. Fonts:
  `font-display` (Barlow) for headings.
- **No test asserts on hardcoded hex.** Existing seo-parser tests
  (`FileProcessingPanel.test.tsx`, `ResultsView.archived.test.tsx`,
  `UploadChecklist.test.tsx`, `result-json.test.ts`) assert
  behavior/content, not styling.
- **`ScoreRing`** (`components/ui/ScoreRing.tsx`): `{ score: number|null,
  size=44 }`, renders an inline SVG dial with the number centered,
  `role="img"`, `aria-label` = `score {pct}` / `no score`; color bands
  `≥80 green / ≥50 amber / else red` (identical to health bands). Null →
  dashed grey ring + em dash.

## 4. In-scope files (~7)

| File | Change |
|------|--------|
| `app/(app)/seo-parser/page.tsx` | Drop redundant `min-h-screen bg-*` wrapper (keep padding); hex→token; deck card language on the upload card + compare link + error block. |
| `components/seo-parser/FileDropzone.tsx` | hex→token on dashed border + drag/hover states (orange); deck card language on the uploaded-files list; **react-dropzone + folder upload untouched.** |
| `components/seo-parser/UploadChecklist.tsx` | hex→token; align to deck card/typography. |
| `components/seo-parser/HistoryList.tsx` | hex→token; deck card language on the history cards. |
| `components/seo-parser/ResultsView.tsx` | Drop redundant `min-h-screen bg-*` wrapper (keep `py-*/px-*`, keep `max-w-6xl mx-auto`); **health-score card adopts `ScoreRing`** beside the label + existing `ScoreExplanation`; hex→token in the header region only (title, share/new-analysis buttons). |
| `components/seo-parser/MetricsBar.tsx` | hex→token only (`#1c2d4a`→`navy` at line 26). No structural change (shared with share view). |
| `app/(app)/seo-parser/results/[sessionId]/page.tsx` | Error-fallback wrapper: `min-h-screen`→`min-h-[60vh]` so centering still works inside the shell; hex→token. |

## 5. The five changes

### 5.1 ScoreRing adoption (signature deck move)

In `ResultsView.tsx` health-score card (currently lines 133-140), lay out a
flex: `<ScoreRing score={healthScore} size={80} />` beside the "SEO health
score" label + `<ScoreExplanation/>`. This is a visual upgrade of existing
data — no new computation, no new prop.

**Preserve the existing `healthScore != null` guard** (Codex #2). The whole
card is only rendered when `healthScore != null` today; keep that guard so
behavior is unchanged. `ScoreRing` *accepts* `null`, but we never pass null
here — the card (and thus the ring) simply stays absent when the score is
null. Do not render a null ring.

**Layout (responsive — Codex #5):** the card body is `flex flex-col
sm:flex-row items-start gap-4`, with `min-w-0 flex-1` on the text/details
side. `ScoreExplanation` renders a full-width table
(`components/scoring/ScoreExplanation.tsx:28`) that overflows a forced
horizontal row on narrow screens without this — the `min-w-0` lets it shrink
and the `flex-col` fallback stacks the ring above the details on mobile.

**Color bands are close, not identical** (Codex #2 correction): `ScoreRing`
uses `≥80 green / ≥50 amber / else red`; the seo-parser history dots use
`≥70 / ≥40` (`HistoryList.tsx:38`). This is acceptable primitive adoption —
the ring is the deck-standard band set — but do **not** claim exact parity.

### 5.2 Token normalization (pixel-safe)

Mechanical hex→token swap on in-scope files:
`#1c2d4a`→`navy`, `#f5a623`→`orange`, `#0f1d30`→`navy-deep`,
`#e8971a`(hover)→`orange-dark`. All exact matches **except**
`#e8971a`→`orange-dark` (`#d4881a`) — a negligible hover-shade shift,
accepted for token consistency. `#f4f6f9` has no token and is removed via
§5.3 (it was only ever the shell-provided page background).

### 5.3 Wrapper reconciliation

Remove `min-h-screen bg-[#f4f6f9] dark:bg-navy-deep` from the upload page
root and the ResultsView root; keep the inner `py-*/px-*` padding and
`max-w-*/mx-auto` centering wrappers. Centered error-fallback states switch
`min-h-screen`→`min-h-[60vh]` (a child needs a bounded height to center
vertically inside the shell's `flex-1` main).

### 5.4 Deck card language

Normalize the upload card, FileDropzone container, uploaded-files list, and
HistoryList cards to the consistent surface: `rounded-xl border
border-gray-100 dark:border-navy-border shadow-sm` with `font-display`
headings. Keep all existing structure and copy.

### 5.5 Dark mode

Every touched element keeps or gains its `dark:` variant (mostly present
already; fill any gaps introduced by the restyle). No hydration-mismatch
patterns are introduced (no new client-only state gating markup).

## 6. Purge safety (PR3 regression guard)

Every class added is a **static literal** in a scanned `app/`/`components/`
file, built from existing `tailwind.config.ts` tokens (`navy*`, `orange*`).
No dynamically-constructed class names, no class strings in `lib/`. This is
categorically different from the PR3 purge bug (widget span classes built in
`lib/`, unreachable by the content globs). `npm run build` + the post-deploy
real-browser width measure confirm no purge.

## 7. Testing

- **Existing tests stay green** (the four listed in §3). The shell wraps,
  it does not alter, the page (spec §7).
- **New test** — `ResultsView` health-score render (Codex #4):
  - `healthScore=87` → assert a `ScoreRing` is present (query `role="img"`
    with `aria-label` containing `score 87`) inside the results header, AND
    the existing `ScoreExplanation` content still renders for a valid
    breakdown (it must remain inside the card).
  - `healthScore=null` (or omitted) → assert **no score ring and no
    health-score card** (unchanged behavior — the `!= null` guard holds).
- **Gates:** `npm run lint` (`tsc --noEmit`) + `DATABASE_URL="file:./local-dev.db" npm test`
  (`vitest run`) + `npm run build`, all green.
- **Post-deploy prod verification (UI class — mandatory real-browser
  measure):** drive the **authed** `/seo-parser` and a results page via
  Playwright; `getComputedStyle`/`getBoundingClientRect` to confirm the
  upload card renders at expected width, the ScoreRing SVG is present and
  sized, and there is no purged-CSS collapse (the PR2 failure mode). Server
  health alone is insufficient.

## 8. Risks / notes

- **MetricsBar is shared** — restrict its change to the invisible hex→token
  swap; never restructure it in this PR.
- **Error-fallback centering** — verify `min-h-[60vh]` centers acceptably
  inside the shell across viewport heights; adjust the value if needed.
- **FileDropzone** — its dashed border + drag state are the most visible
  restyle; verify drag-over (`isDragActive`) and uploading (progress bar)
  states still read correctly after the token swap.
- **`orange-dark` class first use** — confirm `hover:bg-orange-dark` (or
  equivalent) resolves post-build; it is a config token, generated because
  the literal appears in a scanned file.
