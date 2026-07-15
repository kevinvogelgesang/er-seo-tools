# A8 PR 4 — seo-parser Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the "Navy Command Deck" visual language + the `ScoreRing` primitive on the seo-parser upload page and results-page header — visual-only, no behavior/data/API change, existing tests stay green.

**Architecture:** Restyle-in-place. Reconcile page wrappers with the shell (which already provides the background), swap hardcoded hex for Tailwind config tokens (pixel-identical), and replace the plain-text health score with the `ScoreRing` SVG dial. No component is swapped out; react-dropzone/folder-upload and all data flow are untouched.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind (class-based dark mode), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-07-app-shell-pr4-seo-parser-polish-design.md`

## Global Constraints

- **Visual-only.** No behavior, data, API, route, or parser change. No new prop, no new computation.
- **Existing tests stay green:** `FileProcessingPanel.test.tsx`, `ResultsView.archived.test.tsx`, `UploadChecklist.test.tsx`, `result-json.test.ts`.
- **Token map (hex → Tailwind config token), applied to `className` literals only:**
  - `#1c2d4a` → `navy` (`text-[#1c2d4a]`→`text-navy`, `bg-[#1c2d4a]`→`bg-navy`, `border-[#1c2d4a]`→`border-navy`, `hover:bg-[#1c2d4a]`→`hover:bg-navy`, `bg-[#1c2d4a]/8`→`bg-navy/[0.08]` (**`8` is NOT a valid Tailwind opacity step — use the arbitrary form `/[0.08]`**), `text-[#1c2d4a]/…`→`text-navy/…`)
  - `#0f1d30` → `navy-deep` (`hover:bg-[#0f1d30]`→`hover:bg-navy-deep`)
  - `#f5a623` → `orange` (`text-[#f5a623]`→`text-orange`, `bg-[#f5a623]`→`bg-orange`, `hover:text-[#f5a623]`→`hover:text-orange`, `focus:ring-[#f5a623]/40`→`focus:ring-orange/40`)
  - `#e8971a` → `orange-dark` (`hover:bg-[#e8971a]`→`hover:bg-orange-dark`)
  - `#f4f6f9` → **no token**; removed via wrapper reconciliation only (it was solely the shell-provided page background).
- **Wrapper reconciliation rule:** the shell `<main>` (`components/shell/AppShell.tsx:91`) already supplies `bg-[#f4f6f9] dark:bg-navy-deep`. Remove `min-h-screen bg-[#f4f6f9] dark:bg-navy-deep` from in-shell page/component roots; **keep** inner `py-*/px-*` padding and `max-w-*/mx-auto` centering. Centered error-fallback states use `min-h-[60vh]` (not `min-h-screen`) so vertical centering still works inside the shell's `flex-1` main.
- **Do NOT restyle** header child action components (`CopyToClipboard`, `ExportButtons`, `PillarAnalysisButtonClient`, `GenerateRoadmapButton`, `ShareModal`), results tables/panels/modals, the diff page, MetricsBar structure, or any public share view.
- **Purge safety:** every class is a static literal in a scanned `app/`/`components/` file using an existing config token — no dynamic class construction, none in `lib/`.
- **Dark mode:** every touched element keeps/gets its `dark:` variant. No new client-only state gating markup (no hydration mismatch).
- **Branch:** `feat/app-shell-pr4-seo-parser`. Commit after every task.

---

### Task 1: ScoreRing adoption in ResultsView health-score card (TDD)

**Files:**
- Modify: `components/seo-parser/ResultsView.tsx:133-140` (health-score card only)
- Test: `components/seo-parser/ResultsView.score.test.tsx` (create)

**Interfaces:**
- Consumes: `ScoreRing` from `@/components/ui/ScoreRing` — `ScoreRing({ score: number | null, size?: number })`, renders an SVG with `role="img"` and `aria-label` = `score {pct}` (or `no score` when null).
- Consumes: `ResultsView` prop `healthScore?: number | null` (already exists, line 52) and `scoreBreakdown?: string | null`.
- Produces: nothing consumed downstream (leaf visual change).

- [ ] **Step 1: Write the failing test**

Create `components/seo-parser/ResultsView.score.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { ResultsView } from './ResultsView'
import type { AggregatedResult } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({
  default: () => function DynamicStub() { return <div data-testid="chart" /> },
}))

const baseResult: AggregatedResult = {
  crawl_summary: { total_urls: 5, indexable_urls: 4, non_indexable_urls: 1 },
  issues: {
    critical: [{ type: 'missing_title', severity: 'critical', count: 1, description: 'Missing titles', urls: ['https://x.test/a'] }],
    warnings: [],
    notices: [],
  },
  site_structure: { crawl_depth_distribution: { 1: 5 } },
  resources: {},
  technical_seo: {},
  performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0, site_name: 'x.test' },
}

// ScoreExplanation ONLY parses JSON (components/scoring/ScoreExplanation.tsx:9); a
// plain string renders "unavailable". Use a real PersistedBreakdown JSON string.
const BREAKDOWN = JSON.stringify({
  version: 1,
  scorer: 'health',
  score: 87,
  factors: [{ key: 'indexability', label: 'Indexability', weight: 20, earned: 20, possible: 20 }],
})

const SID = '00000000-0000-4000-8000-000000000000'
afterEach(cleanup)

describe('ResultsView health-score card', () => {
  it('renders a ScoreRing with the value and keeps the score explanation when healthScore is set', () => {
    render(
      <ResultsView
        result={baseResult}
        sessionId={SID}
        healthScore={87}
        scoreBreakdown={BREAKDOWN}
      />
    )
    // ScoreRing renders role="img" with aria-label "score 87"
    expect(screen.getByRole('img', { name: /score 87/i })).toBeTruthy()
    // The existing label + explanation (parsed from JSON) still render inside the card
    expect(screen.getByText(/SEO health score/i)).toBeTruthy()
    expect(screen.getByText(/How this score was calculated/i)).toBeTruthy()
    expect(screen.getByText('Indexability')).toBeTruthy()
  })

  it('renders no ScoreRing and no health-score card when healthScore is null/omitted', () => {
    render(<ResultsView result={baseResult} sessionId={SID} />)
    expect(screen.queryByRole('img', { name: /score/i })).toBeNull()
    expect(screen.queryByText(/SEO health score/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/ResultsView.score.test.tsx`
Expected: FAIL on the first test — no element with role `img` / name `score 87` (the score is currently plain text).

- [ ] **Step 3: Implement the ScoreRing adoption**

In `components/seo-parser/ResultsView.tsx`, add the import near the other component imports at the top of the file:

```tsx
import { ScoreRing } from '@/components/ui/ScoreRing'
```

Replace the health-score card block (currently lines 133-140):

```tsx
        {/* Score explanation (C8) — reads only the persisted breakdown, never recomputes */}
        {healthScore != null && (
          <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-4">
            <p className="text-sm font-semibold text-[#1c2d4a] dark:text-white">
              SEO health score: {healthScore}/100
            </p>
            <ScoreExplanation breakdown={scoreBreakdown ?? null} />
          </div>
        )}
```

with (keep the `!= null` guard; lay out ring + details responsively):

```tsx
        {/* Score explanation (C8) — reads only the persisted breakdown, never recomputes */}
        {healthScore != null && (
          <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-4">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <ScoreRing score={healthScore} size={80} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy dark:text-white">
                  SEO health score
                </p>
                <ScoreExplanation breakdown={scoreBreakdown ?? null} />
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 4: Run the new test + the existing ResultsView test**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/ResultsView.score.test.tsx components/seo-parser/ResultsView.archived.test.tsx`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add components/seo-parser/ResultsView.tsx components/seo-parser/ResultsView.score.test.tsx
git commit -m "feat(seo-parser): adopt ScoreRing in results health-score card"
```

---

### Task 2: ResultsView wrapper reconciliation + full token swap

**Files:**
- Modify: `components/seo-parser/ResultsView.tsx` — root wrapper (`:77`), header title (`:83`), Share button (`:105`), and ResultsView's own remaining section-header hex at `:46` and `:194`. (Line `:135` was already swapped to `text-navy` in Task 1.) Swapping all of ResultsView's own hex is a pixel-safe normalization and is what makes the residual-hex grep (Step 4) accurate — it is NOT a restyle of the out-of-scope child components (`CopyToClipboard`/`ExportButtons`/etc., which live in their own files and are untouched).

**Interfaces:**
- Consumes: shell `<main>` background (external; already provided).
- Produces: nothing downstream.

- [ ] **Step 1: Reconcile the root wrapper**

Change line 77 from:

```tsx
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep py-12 px-6">
```

to (drop `min-h-screen bg-[#f4f6f9] dark:bg-navy-deep`; keep padding):

```tsx
    <div className="py-12 px-6">
```

- [ ] **Step 2: Token-swap the header title (line 83)**

```tsx
            <h1 className="font-bold text-2xl text-navy dark:text-white">{siteName} — SEO Audit</h1>
```

- [ ] **Step 3: Token-swap the Share Report button (line 105)**

From:

```tsx
                  className="px-4 py-2 border border-[#1c2d4a] dark:border-navy-border rounded-lg text-sm text-[#1c2d4a] dark:text-white font-medium hover:bg-[#1c2d4a] hover:text-white transition-colors"
```

to:

```tsx
                  className="px-4 py-2 border border-navy dark:border-navy-border rounded-lg text-sm text-navy dark:text-white font-medium hover:bg-navy hover:text-white transition-colors"
```

- [ ] **Step 3b: Token-swap ResultsView's own section-header hex (lines 46, 194)**

Line 46 (the `Section` helper `<h3>` title):

```tsx
      <h3 className="text-sm font-semibold text-navy dark:text-white uppercase tracking-wide mb-4">{title}</h3>
```

Line 194 (section label `<span>`):

```tsx
            <span className="text-sm font-semibold text-navy dark:text-white uppercase tracking-wide">
```

- [ ] **Step 4: Confirm no residual hex in ResultsView**

Run: `grep -n '#1c2d4a\|#f5a623\|#f4f6f9\|#e8971a\|#0f1d30' components/seo-parser/ResultsView.tsx`
Expected: **no matches** (Task 1 swapped line 135; this task swapped 46, 77, 83, 105, 194).

- [ ] **Step 5: Run tests + commit**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/`
Expected: PASS.

```bash
git add components/seo-parser/ResultsView.tsx
git commit -m "refactor(seo-parser): reconcile ResultsView wrapper with shell + token-swap header"
```

---

### Task 3: Upload page — wrapper reconciliation, deck card, token swap

**Files:**
- Modify: `app/(app)/seo-parser/page.tsx`

**Interfaces:**
- Consumes: shell background (external).
- Produces: nothing downstream.

- [ ] **Step 1: Reconcile the root wrapper (line 109)**

From:

```tsx
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep py-12 px-6">
```

to:

```tsx
    <div className="py-12 px-6">
```

- [ ] **Step 2: Token-swap the header (line 113)**

```tsx
          <h1 className="font-display font-extrabold text-3xl text-navy dark:text-white mb-2">SEO Parser</h1>
```

- [ ] **Step 3: Deck card + token-swap the upload card (lines 121-124)**

Card container (line 121) — align radius to `rounded-xl` (already) and keep deck surface; heading (line 122) token-swap:

```tsx
        <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 mb-6">
          <h2 className="font-semibold text-navy dark:text-white text-sm mb-4 uppercase tracking-wide">
            Upload CSV Files
          </h2>
```

- [ ] **Step 4: Token-swap the Analyze button (line 148)**

From:

```tsx
                  className="flex-1 bg-[#f5a623] text-[#1c2d4a] font-display font-bold text-sm px-6 py-3 rounded-lg hover:bg-[#e8971a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
```

to:

```tsx
                  className="flex-1 bg-orange text-navy font-display font-bold text-sm px-6 py-3 rounded-lg hover:bg-orange-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
```

- [ ] **Step 5: Token-swap the Compare link (lines 180)**

From:

```tsx
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-white/50 hover:text-[#1c2d4a] dark:hover:text-white transition-colors"
```

to:

```tsx
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-white/50 hover:text-navy dark:hover:text-white transition-colors"
```

- [ ] **Step 6: Verify no residual hex + typecheck**

Run: `grep -n '#1c2d4a\|#f5a623\|#f4f6f9\|#e8971a\|#0f1d30' app/\(app\)/seo-parser/page.tsx`
Expected: no matches.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/seo-parser/page.tsx"
git commit -m "refactor(seo-parser): reconcile upload-page wrapper + deck card + token-swap"
```

---

### Task 4: FileDropzone restyle (token + deck)

**Files:**
- Modify: `components/seo-parser/FileDropzone.tsx`

**Interfaces:**
- Consumes: `onDrop`, `files`, `isUploading`, `uploadProgress` props (unchanged).
- Produces: nothing downstream. **react-dropzone wiring + folder-upload untouched.**

- [ ] **Step 1: Token-swap the dropzone border/drag states (lines 53-54)**

From:

```tsx
          ${isDragActive ? 'border-[#f5a623] bg-orange-50' : 'border-gray-300 dark:border-navy-border hover:border-[#f5a623]'}
```

to (use the config orange token + its subtle tint for dark parity):

```tsx
          ${isDragActive ? 'border-orange bg-orange/5 dark:bg-orange/10' : 'border-gray-300 dark:border-navy-border hover:border-orange'}
```

- [ ] **Step 2: Token-swap the drag-active label (line 79)**

```tsx
            <p className="text-orange font-medium">Drop CSV or TXT files here</p>
```

- [ ] **Step 3: Token-swap the Upload Folder button hover (lines 113)**

From:

```tsx
            hover:border-[#f5a623] hover:text-[#f5a623] dark:hover:text-[#f5a623]
```

to:

```tsx
            hover:border-orange hover:text-orange dark:hover:text-orange
```

- [ ] **Step 4: Deck-align the uploaded-files list container (line 131)**

From:

```tsx
        <div className="bg-gray-50 dark:bg-navy-deep rounded-lg p-4">
```

to (consistent deck radius; keep the subtle inset surface):

```tsx
        <div className="bg-gray-50 dark:bg-navy-deep rounded-xl border border-gray-100 dark:border-navy-border p-4">
```

- [ ] **Step 5: Verify no residual hex + typecheck**

Run: `grep -n '#1c2d4a\|#f5a623\|#f4f6f9\|#e8971a\|#0f1d30' components/seo-parser/FileDropzone.tsx`
Expected: no matches.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/seo-parser/FileDropzone.tsx
git commit -m "refactor(seo-parser): token-swap + deck-align FileDropzone (behavior unchanged)"
```

---

### Task 5: HistoryList + UploadChecklist token swap

**Files:**
- Modify: `components/seo-parser/HistoryList.tsx` (lines 171, 197, 212, 273, 295)
- Modify: `components/seo-parser/UploadChecklist.tsx` (lines 40, 50)

**Interfaces:**
- Consumes: existing props/fetches (unchanged). `HealthDot` band thresholds (≥70/≥40) are **left as-is** — not in scope.
- Produces: nothing downstream.

- [ ] **Step 1: HistoryList — heading (line 171)**

```tsx
      <h2 className="text-xl font-bold text-navy dark:text-white mb-4">Recent Analyses</h2>
```

- [ ] **Step 2: HistoryList — search + select focus rings (lines 197, 212)**

Replace `focus:ring-[#f5a623]/40` with `focus:ring-orange/40` in both the search `<input>` (line 197) and the client `<select>` (line 212).

- [ ] **Step 3: HistoryList — client badge (line 273)**

From:

```tsx
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#1c2d4a]/8 dark:bg-white/10 text-[#1c2d4a] dark:text-white font-medium">
```

to:

```tsx
                    <span className="text-xs px-2 py-0.5 rounded-full bg-navy/[0.08] dark:bg-white/10 text-navy dark:text-white font-medium">
```

- [ ] **Step 4: HistoryList — "View Results" affordance (line 295)**

```tsx
                <div className="mt-2 text-orange text-xs font-semibold group-hover:underline">
```

- [ ] **Step 5: UploadChecklist — token-swap (lines 40, 50)**

Line 40 (`<summary>`):

```tsx
        <summary className="cursor-pointer font-medium text-navy dark:text-white">
```

Line 50 (label span):

```tsx
                <span className="text-navy dark:text-white">{c.export.label}</span>{' '}
```

- [ ] **Step 6: Verify + tests**

Run: `grep -n '#1c2d4a\|#f5a623\|#f4f6f9\|#e8971a\|#0f1d30' components/seo-parser/HistoryList.tsx components/seo-parser/UploadChecklist.tsx`
Expected: no matches.
Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/UploadChecklist.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/seo-parser/HistoryList.tsx components/seo-parser/UploadChecklist.tsx
git commit -m "refactor(seo-parser): token-swap HistoryList + UploadChecklist"
```

---

### Task 6: MetricsBar token swap + results error-fallback wrapper

**Files:**
- Modify: `components/seo-parser/MetricsBar.tsx:26` (token swap only — shared with public share view)
- Modify: `app/(app)/seo-parser/results/[sessionId]/page.tsx` — **all** fallback-state hex: the "Results Unavailable" block (`:19,22,28`) AND the "Parsing Failed"/other fallback block (`:58,63,67,75,85`). Both `min-h-screen bg-*` wrappers (`:19`, `:58`) get the `min-h-[60vh]` reconciliation.

**Interfaces:**
- Consumes: nothing new. MetricsBar structure unchanged (shared component).
- Produces: nothing downstream.

- [ ] **Step 1: MetricsBar — Total URLs value color (line 26)**

From:

```tsx
        <span className="font-bold text-2xl text-[#1c2d4a] dark:text-white">{totalUrls.toLocaleString()}</span>
```

to:

```tsx
        <span className="font-bold text-2xl text-navy dark:text-white">{totalUrls.toLocaleString()}</span>
```

- [ ] **Step 2: Results error-fallback wrapper (line 19)**

From:

```tsx
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep flex items-center justify-center px-6">
```

to (centered inside the shell; drop the redundant bg, bound the height so centering works):

```tsx
    <div className="min-h-[60vh] flex items-center justify-center px-6">
```

- [ ] **Step 3: Results error-fallback heading + button (lines 22, 28)**

Line 22:

```tsx
        <h2 className="font-display font-bold text-xl text-navy dark:text-white mb-2">Results Unavailable</h2>
```

Line 28 (from `bg-[#1c2d4a] … hover:bg-[#0f1d30]`):

```tsx
          className="inline-block px-6 py-3 bg-navy text-white font-display font-bold text-sm rounded-lg hover:bg-navy-deep transition-colors"
```

- [ ] **Step 3b: "Parsing Failed"/other fallback block (lines 58, 63, 67, 75, 85)**

Line 58 (second `min-h-screen bg-*` wrapper → reconcile like Step 2):

```tsx
      <div className="min-h-[60vh] flex items-center justify-center px-6">
```

Line 63 ("Parsing Failed" heading):

```tsx
              <h2 className="font-display font-bold text-xl text-navy dark:text-white mb-2">Parsing Failed</h2>
```

Line 67 (orange retry/CTA button — from `bg-[#f5a623] text-[#1c2d4a] … hover:bg-[#e8971a]`):

```tsx
                className="inline-block px-6 py-3 bg-orange text-navy font-display font-bold text-sm rounded-lg hover:bg-orange-dark transition-colors"
```

Line 75 (other heading — keep the surrounding text/expression, swap the color token only):

```tsx
              <h2 className="font-display font-bold text-xl text-navy dark:text-white mb-2">
```

Line 85 (navy CTA button — from `bg-[#1c2d4a] … hover:bg-[#0f1d30]`):

```tsx
                className="inline-block px-6 py-3 bg-navy text-white font-display font-bold text-sm rounded-lg hover:bg-navy-deep transition-colors"
```

- [ ] **Step 4: Verify no residual hex + typecheck**

Run: `grep -n '#1c2d4a\|#f5a623\|#f4f6f9\|#e8971a\|#0f1d30' components/seo-parser/MetricsBar.tsx "app/(app)/seo-parser/results/[sessionId]/page.tsx"`
Expected: **no matches** (both fallback blocks now token-only).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/seo-parser/MetricsBar.tsx "app/(app)/seo-parser/results/[sessionId]/page.tsx"
git commit -m "refactor(seo-parser): token-swap MetricsBar + reconcile results error-fallback wrapper"
```

---

### Task 7: Full gate run + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Lint (typecheck)**

Run: `npm run lint`
Expected: `tsc --noEmit` exits clean.

- [ ] **Step 2: Test**

Run: `DATABASE_URL="file:./local-dev.db" npm test`
Expected: full suite green (the 4 existing seo-parser tests + the new `ResultsView.score.test.tsx`).

- [ ] **Step 3: Build (with the baked heap flag)**

Run: `npm run build`
Expected: build succeeds; no purge warning; the new `orange-dark`/`navy`/`orange` utility classes are emitted (static literals in scanned files).

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin feat/app-shell-pr4-seo-parser
gh pr create --title "A8 PR 4 — seo-parser visual polish (upload + results header)" \
  --body "Visual/primitive-adoption pass per spec §8 PR4. ScoreRing on the health-score card, hex→token normalization, wrapper reconciliation with the shell, deck card language. No behavior/data change. Adds ResultsView.score.test.tsx; existing tests green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 5: Merge, deploy, and post-deploy verify (UI class — mandatory real-browser measure)**

After gate-green merge and `ssh $PROD_SSH "~/deploy.sh"`: drive the **authed** production `/seo-parser` and a results page via Playwright; use `getComputedStyle`/`getBoundingClientRect` to confirm the upload card renders at expected width, the `ScoreRing` SVG is present and sized, and there is no purged-CSS collapse (the PR2 failure mode). Record the measured values. (Handled by the executing session per change-control rule 1 + the roadmap prompt.)

---

## Self-Review

**Spec coverage:**
- §5.1 ScoreRing adoption → Task 1 (with the `!= null` guard, responsive `flex-col sm:flex-row` + `min-w-0 flex-1`, and the null/no-card + ScoreExplanation-still-renders tests — Codex #2/#4/#5). ✓
- §5.2 token normalization → Tasks 2-6 (token map in Global Constraints). ✓
- §5.3 wrapper reconciliation → Task 2 (ResultsView root), Task 3 (upload page root), Task 6 (error-fallback `min-h-[60vh]`). ✓
- §5.4 deck card language → Task 3 (upload card), Task 4 (FileDropzone), Task 5 (HistoryList already deck; token only). ✓
- §5.5 dark mode → preserved in every task (each swapped class keeps its `dark:` sibling). ✓
- §6 purge safety → Task 7 Step 3 build + Step 5 real-browser measure. ✓
- §7 testing → Task 1 (new test), each task runs the relevant existing tests, Task 7 full gates. ✓
- Non-goals (header child components, MetricsBar structure, share view, diff page, react-dropzone) → enforced by scoping each task to named lines; MetricsBar restricted to one line (Task 6 Step 1). ✓

**Placeholder scan:** no TBD/TODO; every code step shows the before/after. ✓

**Type consistency:** `ScoreRing({ score, size })` used exactly as defined; `healthScore` prop name matches `ResultsView` signature; no renamed identifiers. ✓
