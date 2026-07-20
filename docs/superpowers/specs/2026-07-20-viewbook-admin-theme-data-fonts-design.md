# Viewbook admin theme, data-source, and font-catalog design

## 1. Goal

Make the Theme tab easier to scan, align Data Source category organization with the public viewbook, and support real search and rendering across the full Google Fonts snapshot without adding that snapshot to the public client bundle.

## 2. Background (verified code facts)

- `ThemeEditor` currently uses a responsive two-column grid with a sticky preview; `PresentationEditor` is rendered by the parent immediately after it in the same full-width stack.
- `DataSourceTab` currently preserves category insertion order from the sorted field rows, while `public-data.ts` explicitly applies `CATALOG_CATEGORIES` followed by alphabetized unknown categories.
- `ThemeStyle.tsx` is client-safe and is imported by the public operator client layer, so it must retain static imports limited to the curated `FONT_MANIFEST`.
- `validateViewbookTheme` lives in client-safe `theme.ts`; server service functions call it internally, and `lib/viewbook/service.ts` is owned by the parallel lane and cannot be edited.

## 3. Scope decisions

- D1: Theme controls remain in their current order, followed by one full-width, non-sticky preview as the final `ThemeEditor` block.
- D2: Data Source categories use the public catalog order, mapped labels, and `ViewbookEditorPanel` disclosures, all collapsed initially. A value counts as answered exactly when it is non-null and non-empty; whitespace-only stored strings are answered because the task does not redefine their content.
- D3: The full catalog lives behind `font-catalog.ts`; the admin picker dynamically imports it on first interaction and public rendering resolves it in a server-only seam.
- D4: The client-safe validator stays free of catalog data. A server validator supplies the catalog predicate directly; an explicit, process-wide, idempotent registration seam permanently lets the existing off-limits service functions use the same predicate. There is no request-scoped unregister/reset path, which would race across concurrent requests, and a conflicting second registration throws.

## 4. Architecture

### 4.1 Admin layout and overflow

Replace the two-column Theme layout with a single `space-y-*` stack. Apply conservative `min-w-0`, `max-w-full`, wrapping, and overflow containment only where flex/grid children, file inputs, long values, or the bounded preview can exceed the editor width.

### 4.2 Data Source category panels

Build a category map, then materialize groups from `CATALOG_CATEGORIES` followed by alphabetized unknown keys. Use `CATEGORY_LABELS[category] ?? readableCategory(category)` and place untouched `AdminFieldCard` instances inside default-collapsed `ViewbookEditorPanel` bodies.

### 4.3 Catalog and picker

`font-catalog.ts` statically owns the JSON and exports exact lookup, membership, and capped search. The admin picker references the module only through `await import(...)`, renders recommended manifest fonts before search, and uses an ARIA combobox/listbox with a 50-result render ceiling, keyboard selection, and on-demand deduplicated stylesheet links.

### 4.4 Validation and public rendering

`theme.ts` accepts an optional font predicate and exposes a small permanent registration hook without importing catalog data. `theme-server.ts` begins with `import 'server-only'`, imports the catalog, exports wide parse/validate functions, resolves public font metadata, and registers the catalog predicate for existing service calls. Direct predicate injection remains available for isolated tests.

The wide parser/registration inventory is explicit: `public-data.ts`, `operator-data.ts`, `retention.ts`, and the token asset-serving route use the wide parser; the admin viewbook route (GET/PATCH/DELETE), admin theme-assets route, and client DELETE route import the server registration before entering service functions. This prevents a catalog-only font from invalidating the entire stored theme and hiding its logo/hero references from attachment, authorization, deletion, or retention code.

`ThemeStyle.tsx` continues importing only `FONT_MANIFEST`, but accepts optional resolved font metadata. The public server page resolves the stored theme once and passes serializable metadata to `ViewbookShell`, `BrandSection`, and the public operator layer. `ThemeDraftWriter` uses that metadata for the current catalog-only selection instead of overwriting the server-resolved variables/link with the curated fallback; the operator picker preserves and labels a catalog-only current value without importing the full catalog. The admin preview dynamically resolves catalog-only choices.

The combobox contract includes `role="combobox"`, `aria-controls`, `aria-expanded`, `aria-autocomplete="list"`, stable option IDs/`aria-activedescendant`, `role="option"`, `aria-selected`, ArrowUp/ArrowDown, Home/End, Enter, Escape, blur containment, and announced loading, error, no-results, and capped-results states.

## 5. Error handling and invariants

- Unknown/injection font keys remain invalid and never enter Google Fonts URLs.
- CSS2 queries always include weight `400` and at most three additional supported weights selected in the requested preference order, then numerically sorted for a valid CSS2 tuple.
- Missing catalog metadata defensively falls back to the default curated font.
- No forbidden file is edited; especially, the service compatibility seam is external to `lib/viewbook/service.ts`.
- Public viewbook client modules have no static or transitive import of `font-catalog.ts` or `font-catalog.json`.
- The server registration is permanent for the process lifetime and rejects a different predicate after initialization; it is never toggled per request.

## 6. Testing and acceptance

- Component tests cover full-width preview placement, preview height/overflow, picker search/select/keyboard behavior, catalog-only initial values, stylesheet deduplication and announced states, Data Source order/labels/collapse, answered counts for null/empty/whitespace/nonblank values, alphabetized unknown categories, and overflow guards where structural.
- Catalog tests cover the manifest superset invariant, capped query policy, exact lookup, search, and JSON size under 200 KiB.
- Server theme tests accept a catalog-only key and reject junk; regression coverage exercises public/operator/admin reads, PATCH/attachment entry points, token asset authorization, deletion snapshots, and retention behavior with a catalog-only stored theme. Public rendering tests verify resolved href, CSS family variables, operator draft write/restore, and displayed family names.
- Finish with targeted Vitest, `npx tsc --noEmit`, and `npm run build`; inspect emitted public initial chunks/manifests for a catalog-only sentinel while confirming it appears only in the lazy admin catalog chunk.
