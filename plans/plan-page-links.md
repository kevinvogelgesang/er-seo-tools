# Plan: Add "Open Page" Button in Pages with Issues

## Current Behavior

**File:** `components/ada-audit/SiteAuditResultsView.tsx`

Each page row shows the URL as a `<span>` (line 71):
```tsx
<span className="text-[12px] font-body text-navy/80 dark:text-white/80 truncate max-w-xs" title={page.url}>
  {urlDisplay}
</span>
```

The only link is "View full audit ↗" which goes to `/ada-audit/{page.adaAuditId}` — that's our internal audit page, not the actual site URL.

---

## Fix: Add External Link Button

### Option A: Make the URL itself clickable (minimal change)

Replace the `<span>` at line 71 with an `<a>` tag:

```tsx
<a
  href={page.url}
  target="_blank"
  rel="noopener noreferrer"
  className="text-[12px] font-body text-navy/80 dark:text-white/80 hover:text-orange truncate max-w-xs transition-colors"
  title={page.url}
  onClick={(e) => e.stopPropagation()}
>
  {urlDisplay}
</a>
```

`stopPropagation` prevents clicking the URL from also toggling the row expansion.

### Option B: Add a dedicated icon button (more visible)

Next to the URL, add a small external-link icon button:

```tsx
<div className="flex items-center gap-1.5 min-w-0">
  <span className="text-[12px] font-body text-navy/80 dark:text-white/80 truncate max-w-xs" title={page.url}>
    {urlDisplay}
  </span>
  <a
    href={page.url}
    target="_blank"
    rel="noopener noreferrer"
    className="flex-shrink-0 text-navy/40 dark:text-white/30 hover:text-orange dark:hover:text-orange transition-colors"
    title={`Open ${page.url}`}
    onClick={(e) => e.stopPropagation()}
  >
    {/* External link icon */}
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  </a>
</div>
```

**Recommendation:** Option B — the icon button is clearly distinct from the row-expand interaction, and is visually consistent with the existing "View full audit ↗" link pattern.

---

## Also: SitemapTreeView

The same URL display exists in `components/ada-audit/SitemapTreeView.tsx` line 69. Apply the same change there for consistency.

---

## Files to Change

| File | Change |
|------|--------|
| `components/ada-audit/SiteAuditResultsView.tsx` | Replace URL `<span>` with link + external icon (line 71) |
| `components/ada-audit/SitemapTreeView.tsx` | Same change to URL display (line 69) |

## Effort

Small — ~15 line change across two files.
