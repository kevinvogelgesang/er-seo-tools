# ADA Audit Results Layout and PDF UX — Design Spec (PR 1)

**Date:** 2026-05-20
**Status:** Approved for implementation planning
**Scope:** PR 1 of the ADA audit results UX overhaul. Section reordering in `SiteAuditResultsView` and PDF section header + pagination improvements. No runner, schema, or API changes.

---

## Goal

Improve the reading order and navigability of the site audit results page by promoting the per-page violations table to an immediately prominent position — just below the scorecard — and demoting the PDF section to the bottom where it belongs as a supplementary artifact list. Simultaneously, cap the PDF section to 5 visible cards per page so audits with dozens of PDFs do not produce an overwhelming scroll pit, while preserving the copy-all clipboard workflow operators already rely on.

## Why now

Operators triage site audits in a specific order: overall score → which pages have violations → PDF cleanup. The current layout interrupts that flow by inserting the full PDF list between the scorecard and the pages table. On a client with 30+ PDFs, operators scroll through hundreds of pixels of PDF cards before reaching the page violations they actually need to act on. Moving Pages with Issues immediately below the scorecard removes that friction without adding any new complexity. The PDF section is also the only major content section that can grow unboundedly without any size constraint — `PaginatedSection` and the issue-pages table both cap visible rows. Adding pagination here aligns the section with that pattern.

## Non-goals

- No change to how PDFs are detected, harvested, or scanned — `lib/ada-audit/pdf-discovery.ts`, `lib/ada-audit/pdf-runner.ts`, and the `PdfAudit` Prisma model are untouched.
- No change to what issues are shown per PDF or how they are rendered — the accordion card internals are unchanged.
- No change to the clean-pages section or any part of the violations table, toolbar, sitemap tree, or by-violation view.
- No change to the single-page audit results view (`AuditResultsView.tsx`) beyond the minimal prop signature update described below.
- No new API endpoints or schema migrations.
- No change to the copy-per-individual-PDF button behavior.

---

## Section ordering changes

### Before

```
ComplianceBanner
Site Audit header / scorecard card
KnownLimitationsNotice
PdfIssuesSection          ← PDF section here, before pages
Pages with Issues
CleanPagesSection
```

### After

```
ComplianceBanner
Site Audit header / scorecard card
KnownLimitationsNotice
Pages with Issues         ← moved up
CleanPagesSection         ← stays below Pages with Issues
PdfIssuesSection          ← moved to bottom
```

The move is a pure render-order change in `SiteAuditResultsView.tsx`. No component is created or deleted for this part of the work.

---

## PDF section changes

### Header copy

Current: `PDFs Found (N files, M issues)`

New (site audit, domain provided): `PDF Accessibility Issues for {domain} (N files)`

The issue count is dropped from the visible header — it is already surfaced inline on each PDF card's badge and adds noise to the heading. When `domain` is not provided (single-page audit context in `AuditResultsView`), the heading falls back to `PDF Accessibility Issues (N files)`.

The `copyAll` function's HTML preamble currently reads `PDF accessibility issues (N files)`. It becomes `PDF accessibility issues for {domain} (N files)` when domain is present. The plain-text `copyAll` output does not include a preamble line today and that remains unchanged.

### Pagination model

Page size: 5 PDF cards per page. Controlled by a `pdfPage` state variable (1-indexed) local to `PdfIssuesSection`. No URL state — PDF pagination position does not need to survive a hard refresh.

The existing `PaginatedSection` component is not used here. `PaginatedSection` wraps its children in a fixed-height scrolling container, which is incompatible with accordion-style cards whose expanded heights are variable and unknown at render time. Instead, `PdfIssuesSection` maintains its own `pdfPage` state and renders only the slice `pdfs.slice((pdfPage - 1) * 5, pdfPage * 5)` in the card list.

**Pagination footer style.** Match the existing Pages-with-Issues table footer (`SiteAuditResultsView.tsx` line ~286): `justify-between`, with "Showing X–Y of Z PDFs" on the left and `Prev` / `Next` buttons (no arrow glyphs) + numbered page buttons on the right. Use the same disabled-opacity treatment at the boundaries. Do NOT match the `PaginatedSection` centered-arrow style.

The pagination chrome (footer bar) renders only when `pdfs.length > 5`. When 5 or fewer PDFs are present, no footer is shown and the section renders exactly as it does today minus the header changes.

Page changes reset the expanded state — cards on the new page start collapsed. This avoids carry-over of an opened card from a URL that is no longer visible.

**Out-of-range clamp.** Although `pdfs` is normally static after audit completion, defend against a shorter `pdfs` array arriving via prop change (re-fetch, parent state update). Inside `PdfIssuesSection`, add a `useEffect` that watches `pdfs.length` and resets `pdfPage` to 1 if `(pdfPage - 1) * 5 >= pdfs.length`. This matches how `PaginatedSection` (line ~31) handles the same case.

### Expand all / Collapse all

The "Expand all / Collapse all" toggle in the section header targets only the currently visible page's PDF cards. `allExpanded` is derived from whether every URL in the current page slice is present in the `expanded` Set, not whether every URL in the full `pdfs` array is. This ensures the button behavior remains predictable regardless of which page the user is on.

### Copy-all unchanged behavior

The `copyAll` function iterates over the full `pdfs` prop array — not over the visible slice. This is the existing behavior; no change is required. The "Copy all" button copies every PDF and its issues regardless of which pagination page is currently displayed. Clicking "Copy all" while on page 2 of 4 copies all PDFs from all pages without scrolling or changing the displayed page.

---

## File structure

| File | Status | Role |
|------|--------|------|
| `components/ada-audit/SiteAuditResultsView.tsx` | Modify | Move `<PdfIssuesSection>` render to after `<CleanPagesSection>`. Pass `domain` prop to `<PdfIssuesSection>`. |
| `components/ada-audit/PdfIssuesSection.tsx` | Modify | Add optional `domain?: string` prop. Update section heading copy. Update `copyAll` HTML preamble. Add `pdfPage` state and 5-per-page slicing. Add pagination footer (renders only when `pdfs.length > 5`). Scope "Expand all / Collapse all" and `allExpanded` derivation to current page slice. Reset expanded set on page change. |
| `components/ada-audit/AuditResultsView.tsx` | Modify | Pass no `domain` to `<PdfIssuesSection>` (omit prop — heading falls back gracefully). No other changes. |

---

## Edge cases

**5 or fewer PDFs.** No pagination footer is rendered. The section appears exactly as it does today (after the header copy change). The `pdfPage` state is initialized to 1 and never changes.

**0 PDFs.** `PdfIssuesSection` returns `null` when `pdfs.length === 0`. No change to this behavior. The section does not appear in the DOM.

**Single-page audit.** `AuditResultsView` renders `PdfIssuesSection` without a `domain` prop. The heading reads "PDF Accessibility Issues (N files)". Pagination applies the same as in the site audit context. The section is hidden when 0 PDFs exist, which is the common case for single-page audits.

**Copy-all while on page 2 of N.** `copyAll` iterates `pdfs` (the full array passed as a prop), not the `visiblePdfs` slice derived from `pdfPage`. The button copies all N PDFs. The visible page does not change. No scroll occurs.

**PDF page out of range after a data refresh.** Defended via the `pdfPage` clamp `useEffect` (described above). If `pdfs.length` shrinks below the current visible page, `pdfPage` resets to 1 on the next render.

---

## Tests

This codebase does not have a React testing stack; the following are manual verification steps for the implementation PR.

| Verification | Pass condition |
|---|---|
| Site audit with 0 PDFs | PDF section is absent from DOM |
| Site audit with 1–5 PDFs | Section renders with new heading, no pagination footer |
| Site audit with 6+ PDFs | Section renders with heading, first 5 cards visible, "Page 1 of N" footer with Prev disabled |
| Navigate to page 2, click "Copy all" | Clipboard contains all PDFs (count matches `pdfs.length`), visible page stays on 2 |
| Page change | Cards from previous page collapse; new page starts collapsed |
| "Expand all" on page 2 of 3 | Only the 5 cards on page 2 expand; does not expand cards on pages 1 or 3 |
| Section order on a complete site audit | "Pages with Issues" appears above "Clean Pages", PDF section appears below "Clean Pages" |
| Single-page audit with PDFs | Heading reads "PDF Accessibility Issues (N files)" (no domain), pagination works |
| Dark mode | Pagination footer buttons use existing dark-mode border/text classes consistent with Pages table pagination |
