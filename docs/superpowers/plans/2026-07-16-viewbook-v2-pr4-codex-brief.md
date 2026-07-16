# Viewbook v2 PR4 — Kickoff + Strategy Docs — Codex Brief

Self-contained brief for the Codex lane (v1 tandem model). Everything you need
is in this file + the repo at your worktree HEAD. Claude runs gates and
commits; leave your work uncommitted in the worktree.

**Branch/worktree:** `feat/viewbook-v2-pr4` at `.claude/worktrees/viewbook-v2-pr4`
**Spec:** `docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md` §7 (kickoff-next, strategy), §9 (PDF docs), §11 (routes)
**Program:** `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` (wave 2; PR2 merges first — see "Integration duty" below)

## Repo rules that bind every change

- Array-form `$transaction([...])` only; raw SQL sets `updatedAt` manually (integer ms).
- No new env vars; no middleware.ts changes (ALL new routes here are cookie-gated by default — none are public matchers).
- Plain text everywhere on the public surface; escape at render; no `dangerouslySetInnerHTML`.
- Operator identity = `requireOperatorEmail(request)` (`lib/viewbook/operator.ts`); admin route shells mirror `app/api/viewbooks/[id]/lock/route.ts` (withRoute + parseId + requireJsonObject + force-dynamic).
- Tests: vitest, `DATABASE_URL="file:./local-dev.db"` from the worktree root; follow each suite's existing fixture conventions (read before writing).
- TDD: failing test → implement → green, per unit below.

## Scope (exactly this, nothing more)

### 1. PDF doc store (`lib/viewbook/assets.ts` extension + `lib/viewbook/docs.ts`)

`assets.ts` gains (images untouched — the webp pipeline is PR7's, do not touch image handling):
- `MAX_DOC_BYTES = 20 * 1024 * 1024`
- `DOC_FILENAME_RE = /^[a-z0-9-]+\.pdf$/`
- PDF magic-byte sniff: buffer starts with `%PDF-` → `'pdf'`, else null (extend or sibling the existing `sniffImageType` — keep both strict)
- `saveViewbookDoc(scope: string, buf: Buffer)` mirroring `saveViewbookAsset` (server-generated `crypto.randomUUID() + '.pdf'`, atomic temp+rename, same `validateAssetScope`/`containedPath` guards) and `deleteViewbookAssets` reuse for deletion (it is filename-based already; verify it tolerates `.pdf` via the containment guard — if its regex is image-only, generalize the containment check to accept both regexes).

New `lib/viewbook/docs.ts` (service):
- `listViewbookDocs(viewbookId: number)` → `{ global: DocRow[]; own: DocRow[] }` — global = `viewbookId: null` ordered `[sortOrder, id]`, own = this viewbook ordered the same. `DocRow = { id, title, blurb, filename, sortOrder }`.
- `createViewbookDoc(input: { viewbookId: number | null; title: string; blurb?: string | null; buf: Buffer; createdBy: string })` — caps: title ≤160 B, blurb ≤512 B (byte caps, reject over); size checked against `MAX_DOC_BYTES` BEFORE any buffering by the ROUTE (see §3) and re-checked here; sniff `%PDF-`; scope = `'global'` when viewbookId null else `String(viewbookId)`; flow = write file → create row (sortOrder = max+1 within its scope) → on row-create failure delete the file (orphan guard). **Create/delete-only — there is NO replace/update.**
- `deleteViewbookDoc(docId: number, viewbookId: number | null)` — `deleteMany({ id: docId, viewbookId })` (null matches global only); count 0 → 404; then ENOENT-tolerant file delete.

### 2. Public asset-route allowlist extension

`app/api/viewbook/[token]/assets/[filename]/route.ts` currently authorizes: the token's own themeJson filenames + global team-roster photos. ADD: filenames from `ViewbookDoc` rows where `viewbookId IS NULL` OR `viewbookId = token's viewbook id`. PDFs are served `application/pdf` + `X-Content-Type-Options: nosniff` + `Content-Disposition: inline` (images keep their current headers). Keep the indistinguishable-404 contract (unknown filename, someone else's doc, traversal → same 404).

### 3. Routes (cookie-gated, NO middleware change)

- `GET /api/viewbook-docs` → `{ docs }` (global list); `POST` multipart (`file` + `title` + `blurb?`) → create global doc. **Pre-buffer size checks:** reject when `request.headers.get('content-length')` exceeds `MAX_DOC_BYTES + 4096` AND when `file.size > MAX_DOC_BYTES`, BEFORE `arrayBuffer()` (spec Codex fix 7 applied to PDFs).
- `DELETE /api/viewbook-docs/[docId]` → delete global doc.
- `GET/POST /api/viewbooks/[id]/docs` and `DELETE /api/viewbooks/[id]/docs/[docId]` — per-viewbook equivalents (POST validates the viewbook exists + client not archived, mirroring other admin writes).
- All wrapped `withRoute`, `requireOperatorEmail` on every method (including GET — these are operator lists), multipart via the existing `fileBufferFromForm` helper (`lib/viewbook/route-utils.ts`) EXTENDED with an optional max-size argument for the pre-buffer `file.size` check.

### 4. Strategy section rebuild (`components/viewbook/public/StrategySection.tsx`)

Doc cards first: merged render order = global docs `[sortOrder, id]` then own docs `[sortOrder, id]` (deterministic — spec fix 8). Each card: title, blurb, "Open PDF" link to the public asset URL (`publicAssetUrl` pattern used by other sections) with `target="_blank" rel="noopener noreferrer"`. Below the cards: the ENTIRE v1 strategy content (global base blocks + per-viewbook override blocks) moves into ONE collapsed `<details>` ("Read the full playbook") — zero data migration, existing content keeps rendering. Empty-docs state: cards region renders nothing (the details block alone).
Data: `loadViewbookPublicData` gains a fault-isolated `docs` block (`guarded('docs', …)`) returning the §1 list shape; add to `ViewbookPublicData` + `public-types.ts`.

### 5. Kickoff-next section (`components/viewbook/public/KickoffNextSection.tsx`) + session helper

New `lib/viewbook/public-session.ts`:
```ts
// v2 PR4: verified-operator detection for the PUBLIC page (spec §10, Codex
// spec fix 9): read the auth cookie VALUE via next/headers cookies() and pass
// it to getAuthSession — verified email or null. Break-glass password
// sessions return null (same bar as requireOperatorEmail).
export async function getOperatorEmailForPublicPage(): Promise<string | null>
```
Read `lib/viewbook/operator.ts` + `lib/auth.ts` first and reuse their exact cookie-name/session-validation calls (including the dev bypass `requireOperatorEmail` has, so dev behaves consistently).

`KickoffNextSection` (server component, receives `isOperator: boolean`, `stage`, `csmName: string | null`, viewbook id):
- Operator view: "Ready for the next step?" + a small client button component that `confirm()`s then `POST /api/viewbooks/[id]/stage` `{direction:'forward', expectedStage:'kickoff'}` and on success calls the PR2 refresh seam if present (see Integration duty) else `router.refresh()`.
- Non-operator view: short outro — questions go to your primary contact; render `csmName` when non-null ("Reach out to {csmName}") else neutral copy ("Reach out to your Enrollment Resources contact"). The full CSM card ships in PR3 — keep this copy-only and tolerant of missing data.
- The section renders ONLY in the kickoff stage (lineup-gated); no other ER controls appear anywhere (PR8 owns the inline layer).

Page wiring: `app/(public)/viewbook/[token]/page.tsx` resolves `getOperatorEmailForPublicPage()` and threads `isOperator` ONLY into this section's render.

### 6. Lineup + renderer activation

- `lib/viewbook/stages.ts`: add `'kickoff-next'` to `STAGE_LINEUPS.kickoff.primary` (last). Update `lib/viewbook/stages.test.ts`: the "PR1 lineups contain only v1 keys" pin becomes "lineups contain only keys with shipped renderers" — v1 seven + `kickoff-next` (deliberate unpin, note it in the test comment).
- `app/(public)/viewbook/[token]/page.tsx` `renderSection` switch: add the `kickoff-next` case AND a `default: return null` (final-review note — a lineup key without a renderer must fail silent-deliberate, not render `undefined`).

### 7. Admin docs UI

- Global docs: a "Strategy PDFs" card in `components/viewbook/admin/GlobalContentEditor.tsx` (list + upload form + delete with confirm; surface API errors with the editor's existing error affordances).
- Per-viewbook extras: a matching card in the editor's Content tab (`components/viewbook/admin/ContentTab.tsx`).
Follow the surrounding components' styling (dark-mode variants, button classes) — read them first.

## Tests (write with the code, per unit)

- `lib/viewbook/docs.test.ts` — caps (title/blurb/bytes), sniff rejects non-PDF buffer, global vs own scoping, delete cross-scope → 404 + file removed (fs assertions via the suite's temp `VIEWBOOK_ASSETS_DIR` pattern — see `assets.test.ts` for the env/temp-dir convention), orphan cleanup on forced row failure.
- Route tests (mirror `viewbook-pr4-routes.test.ts` harness style, real signed cookies): CRUD happy paths, 401 unauthenticated, pre-buffer 413-class rejection (oversized `content-length` header and oversized `file.size`), per-viewbook POST on archived client → 409.
- Public asset route: token serves own doc + global doc with `application/pdf`/`nosniff`/`inline`; other viewbook's doc filename → 404; image serving unchanged.
- `public-session.test.ts` — verified session → email; no cookie → null; (if `lib/auth` exposes a break-glass/password session shape) non-verified → null.
- Section tests: strategy doc-card render (order, links, escape a hostile title `<img src=x>` renders as text), kickoff-next operator vs non-operator vs csmName-null variants.
- Stages test unpin per §6.

## Integration duty (program doc, wave 2)

PR2 (live sync) merges FIRST inside this wave. After it lands, Claude will rebase this branch; YOUR code must then adopt: `syncVersionBumpStatement(viewbookId)` / `syncVersionBumpAllStatement()` from `lib/viewbook/sync.ts` inside the doc create/delete transactions (scoped for per-viewbook docs, unscoped for global docs — global docs render on every viewbook), plus bump/no-bump tests (success +1, cross-scope 404 +0). If `lib/viewbook/sync.ts` already exists at your HEAD, do this now; if not, leave a `// PR2-rebase: adopt syncVersionBumpStatement here` marker comment at each transaction and note it in your handoff summary.

## Out of scope (do NOT touch)

Image/webp pipeline (PR7) · CSM roster flag/email/card (PR3) · email anything (PR3) · ack/team-members/setup routes (PR5) · ER inline layer beyond the kickoff-next CTA (PR8) · middleware.ts · prisma schema (ViewbookDoc already exists from PR1).

## Definition of done

Every unit above implemented with tests; `npx tsc --noEmit` clean; `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook components/viewbook app/api/viewbook app/api/viewbooks` green; work left UNCOMMITTED in the worktree; a short handoff summary written to `.superpowers/sdd/pr4-codex-handoff.md` (what you built, deviations, test counts, any PR2-rebase markers left).
