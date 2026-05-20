# ADA Audit Results Layout + PDF UX Implementation Plan (PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the "Pages with Issues" table directly under the scorecard by moving the PDF section to the bottom of `SiteAuditResultsView`, and tame unbounded PDF lists by paginating `PdfIssuesSection` at 5 cards per page. Update the PDF section heading copy to include the domain when known. No runner, schema, or API changes.

**Architecture:** Pure presentational refactor across three components. `SiteAuditResultsView.tsx` reorders two existing JSX nodes and passes a new `domain` prop down. `PdfIssuesSection.tsx` gains an optional `domain` prop, a `pdfPage` state, slicing, and a footer that visually matches the existing Pages-with-Issues pagination footer. `AuditResultsView.tsx` is touched only as a verification that the optional prop falls back gracefully.

**Tech Stack:** Next.js 15 App Router · TypeScript · React 19 · Tailwind CSS

**Companion spec:** `docs/superpowers/specs/2026-05-20-ada-results-layout-and-pdf-ux-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `components/ada-audit/SiteAuditResultsView.tsx` | Modify | Move `<PdfIssuesSection>` render from above "Pages with Issues" to after `<CleanPagesSection>`. Pass `domain` prop. |
| `components/ada-audit/PdfIssuesSection.tsx` | Modify | Add optional `domain?: string`. Update heading + `copyAll` HTML preamble. Add `pdfPage` state + 5-per-page slicing + footer (only when `pdfs.length > 5`). Scope expand/collapse-all and `allExpanded` derivation to current slice. Reset `expanded` on page change. Clamp `pdfPage` to 1 via `useEffect` when length shrinks. |
| `components/ada-audit/AuditResultsView.tsx` | Modify (verify) | Confirm `<PdfIssuesSection>` is rendered without `domain`. Heading falls back gracefully. No real change expected. |

---

### Task 1: Branch + working tree

**Files:** none.

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/ada-results-layout-pdf-ux
```

---

### Task 2: Reorder sections in `SiteAuditResultsView.tsx`

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`

**Why first:** the reorder is the simplest, lowest-risk diff in the PR. Landing it independently keeps blame readable and lets the next task land a single-purpose PDF refactor.

- [ ] **Step 1: Locate both render sites**

```bash
grep -n "PdfIssuesSection\|CleanPagesSection" components/ada-audit/SiteAuditResultsView.tsx
```

You should see two occurrences worth changing:
- around line 226: `<PdfIssuesSection pdfs={pdfs} />` rendered early (above the "Pages with Issues" block)
- around line 345: `<CleanPagesSection pages={cleanPages} />` near the bottom of the return tree

- [ ] **Step 2: Remove the early PDF render**

Open `SiteAuditResultsView.tsx`. Find the block (near line 226):

```tsx
      <PdfIssuesSection pdfs={pdfs} />
```

Delete that line entirely (along with any trailing blank line directly below it that exists only because of the section break).

- [ ] **Step 3: Add the PDF render after `<CleanPagesSection>`**

Find the block near line 345:

```tsx
      {/* Clean pages */}
      <CleanPagesSection pages={cleanPages} />
    </div>
  )
}
```

Change to:

```tsx
      {/* Clean pages */}
      <CleanPagesSection pages={cleanPages} />

      {/* PDF accessibility issues — moved to bottom; supplementary artifact list */}
      <PdfIssuesSection pdfs={pdfs} />
    </div>
  )
}
```

The `domain` prop is added to this call in Task 3 (after `PdfIssuesSection` is updated to accept it). Task 2 is render-order-only.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: PASS — pure render reorder, no prop signature changes yet.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx
git commit -m "$(cat <<'EOF'
refactor(ada-audit): move PDF section below clean pages in SiteAuditResultsView

Pages with Issues now renders immediately below the scorecard. The PDF
artifact list moves to the bottom as a supplementary section, matching
operator triage order.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add `domain` prop + heading copy to `PdfIssuesSection.tsx`

**Files:**
- Modify: `components/ada-audit/PdfIssuesSection.tsx`

- [ ] **Step 1: Locate the Props interface and heading**

```bash
grep -n "interface Props\|PDFs Found\|PDF accessibility issues" components/ada-audit/PdfIssuesSection.tsx
```

You should see:
- ~line 82: `interface Props { pdfs: PdfRow[] }`
- ~line 86: `export default function PdfIssuesSection({ pdfs }: Props)`
- ~line 95: `<p style="margin:0 0 12px 0"><strong>PDF accessibility issues</strong> (${pdfs.length} files)</p>` (inside `copyAll`)
- ~line 128: visible heading `PDFs Found …`

- [ ] **Step 2: Extend the Props interface and signature**

Find:

```tsx
interface Props {
  pdfs: PdfRow[]
}

export default function PdfIssuesSection({ pdfs }: Props) {
```

Change to:

```tsx
interface Props {
  pdfs: PdfRow[]
  /** Optional. When provided, the section heading reads
   *  "PDF Accessibility Issues for {domain} (N files)". When omitted (e.g. in
   *  the single-page AuditResultsView), the heading falls back to
   *  "PDF Accessibility Issues (N files)". */
  domain?: string
}

export default function PdfIssuesSection({ pdfs, domain }: Props) {
```

- [ ] **Step 3: Update the `copyAll` HTML preamble**

Find (inside `copyAll`):

```tsx
    const html =
      `<div>` +
      `<p style="margin:0 0 12px 0"><strong>PDF accessibility issues</strong> (${pdfs.length} files)</p>` +
      pdfs.map(htmlForPdf).join('') +
      `</div>`
```

Change to:

```tsx
    const preambleLabel = domain
      ? `PDF accessibility issues for ${escapeHtml(domain)}`
      : `PDF accessibility issues`
    const html =
      `<div>` +
      `<p style="margin:0 0 12px 0"><strong>${preambleLabel}</strong> (${pdfs.length} files)</p>` +
      pdfs.map(htmlForPdf).join('') +
      `</div>`
```

Note: the plain-text branch of `copyAll` does not include a preamble line today. Leave it unchanged — the spec explicitly preserves that.

- [ ] **Step 4: Update the visible heading**

Find:

```tsx
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
          PDFs Found <span className="text-navy/40 dark:text-white/40 font-normal">({pdfs.length} files, {totalIssues} issues)</span>
        </h2>
```

Change to:

```tsx
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
          {domain
            ? `PDF Accessibility Issues for ${domain}`
            : 'PDF Accessibility Issues'}{' '}
          <span className="text-navy/40 dark:text-white/40 font-normal">({pdfs.length} files)</span>
        </h2>
```

The issue count is intentionally dropped from the visible heading per spec. Each card's badge still surfaces issue counts inline.

- [ ] **Step 5: Remove the now-unused `totalIssues` variable**

```bash
grep -n "totalIssues" components/ada-audit/PdfIssuesSection.tsx
```

If `totalIssues` is no longer referenced anywhere else in the file (which is the expected state after Step 4), delete the line:

```tsx
  const totalIssues = pdfs.reduce((n, p) => n + p.issues.length, 0)
```

If lint warns about unused variables, this prevents that.

- [ ] **Step 6: Pass `domain` from `SiteAuditResultsView` to `<PdfIssuesSection>`**

Now that the prop exists on the component, update the call site to actually pass the domain. In `components/ada-audit/SiteAuditResultsView.tsx`, find the `<PdfIssuesSection pdfs={pdfs} />` call (added in Task 2) and update it:

```tsx
<PdfIssuesSection pdfs={pdfs} domain={domain} />
```

`domain` is already in scope from the destructured component props.

- [ ] **Step 7: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/ada-audit/PdfIssuesSection.tsx components/ada-audit/SiteAuditResultsView.tsx
git commit -m "$(cat <<'EOF'
feat(ada-audit): PDF section heading shows the audited domain

PdfIssuesSection now accepts an optional `domain` prop. Site audits pass
the domain so the heading reads "PDF Accessibility Issues for {domain}
(N files)". Single-page audits omit the prop and fall back to "PDF
Accessibility Issues (N files)". The copyAll HTML preamble follows the
same pattern. Plain-text copyAll output is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add pagination state, slicing, and footer to `PdfIssuesSection.tsx`

**Files:**
- Modify: `components/ada-audit/PdfIssuesSection.tsx`

**Why now:** the heading change is in place; remaining work is the pagination overlay.

- [ ] **Step 1: Inspect the existing Pages-with-Issues footer for style reference**

```bash
sed -n '285,325p' components/ada-audit/SiteAuditResultsView.tsx
```

This is the visual + class-list contract for the new footer. Mirror it as closely as possible.

- [ ] **Step 2: Add page-size constant + state + slice + clamp**

Near the top of the file (just below the `Props` interface), add:

```tsx
const PDF_PAGE_SIZE = 5
```

Inside `PdfIssuesSection`, add `useEffect` to the existing imports at the top of the file (replace `import { useState } from 'react'`):

```tsx
import { useEffect, useState } from 'react'
```

Then, just below the existing state declarations (`copied`, `expanded`) and **before** the `if (pdfs.length === 0) return null` guard, add:

```tsx
  const [pdfPage, setPdfPage] = useState(1)

  // Defend against pdfs shrinking via prop change (parent re-fetch). If the
  // current page is now out of range, reset to 1 on the next render.
  useEffect(() => {
    if ((pdfPage - 1) * PDF_PAGE_SIZE >= pdfs.length && pdfPage !== 1) {
      setPdfPage(1)
    }
  }, [pdfs.length, pdfPage])
```

Then, immediately after the existing `if (pdfs.length === 0) return null` guard, derive the slice:

```tsx
  const totalPdfPages = Math.max(1, Math.ceil(pdfs.length / PDF_PAGE_SIZE))
  const pdfStart = (pdfPage - 1) * PDF_PAGE_SIZE
  const visiblePdfs = pdfs.slice(pdfStart, pdfStart + PDF_PAGE_SIZE)
```

- [ ] **Step 3: Scope `allExpanded` + `toggleAll` to the visible slice**

Find:

```tsx
  const allExpanded = expanded.size === pdfs.length
  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(pdfs.map((p) => p.url)))
  }
```

Replace with:

```tsx
  // Scope expand/collapse-all to the *currently visible* page slice. Avoids
  // a counter-intuitive UX where "Expand all" silently expands invisible
  // cards on other pages.
  const allExpanded =
    visiblePdfs.length > 0 && visiblePdfs.every((p) => expanded.has(p.url))
  const toggleAll = () => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (allExpanded) {
        // Collapse only the visible slice — leave other-page expansions alone.
        for (const p of visiblePdfs) next.delete(p.url)
      } else {
        for (const p of visiblePdfs) next.add(p.url)
      }
      return next
    })
  }
```

- [ ] **Step 4: Reset `expanded` on page change**

Below the existing `pdfPage` `useEffect`, add a second effect that collapses everything when the page changes:

```tsx
  // When the user navigates to a different page, start every visible card
  // collapsed. Avoids a card opened on a previous page bleeding through.
  useEffect(() => {
    setExpanded(new Set())
  }, [pdfPage])
```

- [ ] **Step 5: Iterate over `visiblePdfs` instead of `pdfs` in the card list**

Find the card-list render:

```tsx
      <div className="divide-y divide-gray-100 dark:divide-navy-border">
        {pdfs.map((pdf) => {
```

Change to:

```tsx
      <div className="divide-y divide-gray-100 dark:divide-navy-border">
        {visiblePdfs.map((pdf) => {
```

(Leave the `copyAll` implementation iterating over `pdfs` — that's spec-mandated existing behavior.)

- [ ] **Step 6: Add the pagination footer**

Immediately after the closing `</div>` of the card-list `<div className="divide-y …">` block (i.e. just before the outer `</div>` that wraps the entire section), add:

```tsx
      {pdfs.length > PDF_PAGE_SIZE && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 dark:border-navy-border bg-gray-50/50 dark:bg-navy-deep/50">
          <span className="text-[12px] font-body text-navy/40 dark:text-white/40">
            Showing {pdfStart + 1}–{Math.min(pdfStart + PDF_PAGE_SIZE, pdfs.length)} of {pdfs.length} PDFs
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
              disabled={pdfPage === 1}
              className="px-2.5 py-1 text-[12px] font-body rounded border border-gray-300 dark:border-navy-border text-navy dark:text-white hover:bg-gray-100 dark:hover:bg-navy-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            {Array.from({ length: totalPdfPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPdfPage(p)}
                className={`px-2.5 py-1 text-[12px] font-body rounded border transition-colors ${
                  p === pdfPage
                    ? 'border-orange bg-orange/10 text-orange font-semibold'
                    : 'border-gray-300 dark:border-navy-border text-navy dark:text-white hover:bg-gray-100 dark:hover:bg-navy-light'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPdfPage((p) => Math.min(totalPdfPages, p + 1))}
              disabled={pdfPage === totalPdfPages}
              className="px-2.5 py-1 text-[12px] font-body rounded border border-gray-300 dark:border-navy-border text-navy dark:text-white hover:bg-gray-100 dark:hover:bg-navy-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
```

Note: the existing Pages-with-Issues footer uses `paginationRange()` with ellipses because page counts can be large. PDF pagination tops out around `Math.ceil(1000/5) = 200` in the absolute worst case but realistically 1–10. A flat numbered list is acceptable and visually matches the spec. If a future audit ever produces >20 PDF pages, revisit and adopt `paginationRange()` from `SiteAuditResultsView.tsx`.

- [ ] **Step 7: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/ada-audit/PdfIssuesSection.tsx
git commit -m "$(cat <<'EOF'
feat(ada-audit): paginate PdfIssuesSection at 5 cards per page

Caps the PDF section to a 5-card slice with a numbered Prev/Next footer
that visually matches the Pages-with-Issues table footer. The footer
renders only when more than 5 PDFs exist. Expand all / collapse all is
now scoped to the visible slice. Cards collapse when navigating between
pages. The copyAll button still copies every PDF regardless of the
visible page, preserving existing operator workflow. Defends against
pdfs prop length shrinking via a clamp effect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verify `AuditResultsView.tsx` falls back gracefully

**Files:**
- Modify (verify only): `components/ada-audit/AuditResultsView.tsx`

**Why:** single-page audits don't have a meaningful "domain" — the spec calls for the heading to fall back to `PDF Accessibility Issues (N files)`. This task confirms no code change is needed in the file.

- [ ] **Step 1: Locate the PdfIssuesSection render**

```bash
grep -n "PdfIssuesSection" components/ada-audit/AuditResultsView.tsx
```

Expected: a single occurrence like `<PdfIssuesSection pdfs={pdfs} />` near line 141 — with no `domain` prop. That's correct as-is.

- [ ] **Step 2: Type-check**

```bash
npm run lint
```

Expected: PASS. The optional `domain?: string` prop signature added in Task 3 means the existing call site continues to compile without modification, and the heading falls back to the no-domain branch as designed.

- [ ] **Step 3: No commit**

Nothing changed in this file. Skip the commit step.

---

### Task 6: Lint + full test suite + production build

**Files:** none.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS. No tests were added or modified in this PR — the changes are presentational and there's no React testing stack wired up. If the suite is red, the regression is unrelated and should be diagnosed before continuing.

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean build.

---

### Task 7: Manual verification

**Files:** none — runtime check.

The components in this PR are presentational and the project does not have a React testing stack. Verify with the dev server.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open a completed site audit with 0 PDFs**

Navigate to a site audit detail page where `pdfs.length === 0`. Verify:
- The PDF section is absent from the DOM.
- Section order: scorecard → KnownLimitationsNotice → "Pages with Issues" → CleanPagesSection. No empty PDF heading appears at the bottom.

- [ ] **Step 3: Open a completed site audit with 1–5 PDFs**

Find or trigger an audit with a small number of PDFs. Verify:
- Heading reads `PDF Accessibility Issues for {domain} (N files)`.
- No pagination footer is rendered.
- The card list matches today's behavior modulo the heading change.

- [ ] **Step 4: Open a completed site audit with 6+ PDFs**

Find or trigger an audit with more than 5 PDFs (e.g. a college site with course catalogs). Verify:
- Heading reads `PDF Accessibility Issues for {domain} (N files)`.
- Exactly 5 cards visible.
- Footer present: left text reads "Showing 1–5 of N PDFs", right side shows `Prev` (disabled) + numbered buttons + `Next` (enabled).
- Click `Next` → second page renders with the next 5 cards. Footer text updates. `Prev` becomes enabled.
- Click a numbered button → jumps to that page.
- Active page button uses the orange-tinted style.

- [ ] **Step 5: Verify expand/collapse-all scoping**

On a multi-page PDF section:
- Click "Expand all" on page 1 → all 5 cards on page 1 expand. Button toggles to "Collapse all".
- Navigate to page 2 → cards on page 2 are collapsed (page change reset).
- Click "Expand all" on page 2 → only the 5 cards on page 2 expand.
- Navigate back to page 1 → cards collapsed again (page change reset).

- [ ] **Step 6: Verify Copy-all spans all pages**

While on page 2 of a 4-page PDF section:
- Click "Copy all".
- Paste into a plain-text editor → confirm the count of "----" or filename separators corresponds to the full `pdfs.length`, not 5.
- Paste into a rich-text target (e.g. a Google Doc) → confirm the HTML preamble reads `PDF accessibility issues for {domain} (N files)` where N is the full count.
- Confirm the visible PDF section stays on page 2 — no scroll or jump.

- [ ] **Step 7: Verify single-page audit fallback**

Navigate to a single-page audit (`/ada-audit/[id]`) where PDFs were discovered:
- Heading reads `PDF Accessibility Issues (N files)` (no "for {domain}").
- Pagination works the same way if N > 5.
- HTML copy preamble reads `PDF accessibility issues (N files)` without the domain phrase.

- [ ] **Step 8: Verify section ordering on the site audit results page**

Inspect a completed site audit DOM. Confirm in order:
1. ComplianceBanner
2. Site Audit header / scorecard card
3. KnownLimitationsNotice (if any)
4. "Pages with Issues" (the violations table + view toggle)
5. CleanPagesSection
6. PdfIssuesSection

- [ ] **Step 9: Dark mode**

Toggle to dark mode (ThemeToggle in the nav). Verify:
- Pagination footer background uses `dark:bg-navy-deep/50`, matching the Pages-with-Issues footer.
- Active page button still highlights in orange.
- Disabled `Prev` / `Next` use `disabled:opacity-30` — visually muted but legible.

---

### Task 8: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/ada-results-layout-pdf-ux
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(ada-audit): reorder site audit sections + paginate PDF list" --body "$(cat <<'EOF'
## Summary
- Move PDF section from above "Pages with Issues" to the bottom of the site audit results page. Operators now triage scorecard → page violations → clean pages → PDFs in that natural order.
- Paginate PdfIssuesSection at 5 cards per page with a numbered Prev/Next footer that matches the Pages-with-Issues table footer style. Renders only when more than 5 PDFs exist.
- Heading copy updated: site audits show "PDF Accessibility Issues for {domain} (N files)"; single-page audits fall back to "PDF Accessibility Issues (N files)". HTML copy preamble follows the same pattern. Plain-text copyAll output is unchanged.
- Expand all / Collapse all is now scoped to the currently visible page. Cards collapse when navigating pages. Copy all still copies every PDF regardless of the visible page (existing behavior preserved).

## Files touched
- `components/ada-audit/SiteAuditResultsView.tsx` — render-order swap; passes `domain` prop.
- `components/ada-audit/PdfIssuesSection.tsx` — `domain?` prop, heading copy, pagination state + footer, slice-scoped expand/collapse-all, clamp `useEffect`.
- `components/ada-audit/AuditResultsView.tsx` — no change (verified the optional prop falls back).

## Test plan
- [x] `npm run lint`
- [x] `DATABASE_URL='file:./local-dev.db' npx vitest run`
- [x] `rm -rf .next && npm run build`
- [x] Manual: site audit with 0 PDFs — section absent
- [x] Manual: site audit with 1–5 PDFs — no footer
- [x] Manual: site audit with 6+ PDFs — footer renders, Prev/Next + numbered buttons work, "Showing X–Y of Z PDFs" updates
- [x] Manual: expand-all on page 2 of 3 expands only page-2 cards; page change resets expanded
- [x] Manual: Copy all on page 2 of N copies all PDFs; visible page does not change
- [x] Manual: single-page audit heading falls back to "PDF Accessibility Issues (N files)"
- [x] Manual: section order on a completed site audit (Pages with Issues → Clean Pages → PDFs)
- [x] Manual: dark mode pagination chrome matches Pages-with-Issues footer

## Out of scope
- Issue-grouped view, per-violation drill-down, or scorecard CTAs (those land in later PRs of the UX overhaul series).
- PDF runner, discovery, or schema changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL**

---

## Self-review checklist

- [x] **Spec coverage:** section reorder → Task 2; heading copy + `domain` prop → Task 3; pagination state, slicing, footer, expand-all scoping, clamp effect → Task 4; `AuditResultsView` fallback → Task 5.
- [x] **No new files:** every task modifies an existing file (or verifies one without changes).
- [x] **No schema, no API, no runner changes:** all three modified files are in `components/ada-audit/`.
- [x] **Pagination footer matches existing pattern:** Task 4 references the Pages-with-Issues footer at `SiteAuditResultsView.tsx` lines 287–325 and reuses the same class lists, layout (`justify-between`), button styling, and disabled-opacity treatment. No arrow glyphs; `Prev` / `Next` text labels.
- [x] **Copy-all unchanged:** Task 4 Step 5 explicitly says "Leave the `copyAll` implementation iterating over `pdfs`". Verified in Task 7 Step 6.
- [x] **Clamp guard:** Task 4 Step 2 adds the `useEffect` that resets `pdfPage` to 1 when `(pdfPage - 1) * 5 >= pdfs.length`, matching `PaginatedSection`'s pattern.
- [x] **Expanded-set reset:** Task 4 Step 4 adds the second `useEffect` keyed on `pdfPage`.
- [x] **Commit conventions:** all commits use short conventional prefixes (`refactor(ada-audit)`, `feat(ada-audit)`).
- [x] **No unit tests added:** the project has no React testing stack; verification is manual via Task 7. The plan does not invent a testing harness.
