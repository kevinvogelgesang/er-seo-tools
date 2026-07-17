# Viewbook UX Pass — Lane 4 (Rich-text + Assessment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Steps use `- [ ]` checkboxes. Work in worktree `.claude/worktrees/viewbook-l4` on
> branch `feat/viewbook-l4` (rebased on Wave-1-merged `main`). **Never edit on `main`**
> (Codex Lane 3 runs concurrently in its own worktree). Interfaces below were cut from
> MERGED code (main @ post-Wave-1), not memory.

**Goal (spec §8):** a reusable **sanitized-HTML** rich-text editor+renderer; two
operator-authored Assessment note blocks (**General notes** + **User Behaviour**, the
latter with ER-only image upload); performance **2-decimal** CLS; and the **schema
migration** (Lane 4 is the ONLY schema-touching lane).

**Serial split (Codex spec fix 5):** build (a) the rich-text core + schema first, then
(b) assessment persistence/integration. Reduces blast radius.

## Global Constraints
- **Array-form `$transaction([...])` only** — every write that mutates a rendered row rides a `syncVersion` bump in the SAME array-form txn (`lib/viewbook/sync.ts` `syncVersionBumpStatement`/`syncVersionBumpWhere`).
- **Sanitized HTML is the security boundary.** ONE server-side sanitizer (strict tag allowlist: `h2,h3,p,br,strong,em,u,ul,ol,li` ONLY; strip ALL attributes, inline styles, event handlers, links, embedded media). Sanitize on WRITE **and** on READ (defensive — legacy/tampered rows re-sanitized every render). This is the FIRST `dangerouslySetInnerHTML` in the repo — treat as a new risk surface.
- **Frozen contracts:** do NOT touch `PublicSection`, `SectionShell` props, `ViewbookPublicData`, or `renderSection`/`page.tsx`. New public types are SEPARATE interfaces (mirror how `AssessmentData` lives outside the frozen contract).
- **Off-limits files:** `lib/viewbook/service.ts` (Lane 3 sole owner this wave — Codex fix 6), `app/(public)/viewbook/[token]/page.tsx` (not in ownership; get operator identity via `getOperatorEmailForPublicPage()` INSIDE `AssessmentSection`), `InlineEditors.tsx`/any Lane-2/3 file, `middleware.ts` (mutations are cookie-gated under the existing `/api/viewbooks/[id]/**` space; public serving reuses the existing assets route).
- **Repo:** no jest-dom matchers; `DATABASE_URL="file:./local-dev.db"` for tests; images re-encoded to webp by `saveViewbookAsset` (magic-byte sniffed, atomic).
- Gates before every commit: `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test`. Lane 4 also runs `npx prisma migrate dev` locally (Task 1) + `npm run build` before merge.

---

### Task 1: Schema — `ViewbookAssessmentContent` (1:1) + `ViewbookAssessmentImage` (child) + migration

**Files:** `prisma/schema.prisma` (+ new migration dir), regenerate client.

**Interfaces (from merged schema conventions — `model Viewbook` @ schema.prisma:862):**
- 1:1-by-unique-FK-cascade precedent = `Viewbook.clientId Int @unique` + `client … onDelete: Cascade`. Mirror it:
  ```prisma
  model ViewbookAssessmentContent {
    id                Int      @id @default(autoincrement())
    viewbookId        Int      @unique
    viewbook          Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
    generalNotesHtml  String?  // sanitized HTML, plain-text-safe subset
    userBehaviourHtml String?  // sanitized HTML
    updatedAt         DateTime @updatedAt
    updatedBy         String?
    images            ViewbookAssessmentImage[]
  }
  model ViewbookAssessmentImage {
    id         Int      @id @default(autoincrement())
    contentId  Int
    content    ViewbookAssessmentContent @relation(fields: [contentId], references: [id], onDelete: Cascade)
    filename   String   // matches ASSET_FILENAME_RE
    sortOrder  Int      @default(0)
    createdBy  String?
    createdAt  DateTime @default(now())
    @@index([contentId, sortOrder])
  }
  ```
  Add the back-relation `assessmentContent ViewbookAssessmentContent?` to `model Viewbook`. (Image is scoped under the 1:1 content row via `contentId`, mirroring `ViewbookReviewLink.milestoneId` nested cascade — image rows cascade with the content row, which cascades with the viewbook.)

- [ ] **Step 1:** Edit `prisma/schema.prisma` per above. Check `prisma/migrations/` for the latest `20260717HHMMSS_*` stamp and pick a greater `HHMMSS` (Codex Lane 3 has NO migration, so no collision — but verify).
- [ ] **Step 2:** `npx prisma migrate dev --name viewbook_assessment_content` (creates migration + regenerates client). Verify it applies clean on the worktree's `prisma/local-dev.db`.
- [ ] **Step 3:** Confirm reversibility notionally (down = drop the two tables; additive-only, no data loss on existing rows). `npx tsc --noEmit` green (new client types).
- [ ] **Step 4: Commit** `feat(viewbook-l4): ViewbookAssessmentContent + ViewbookAssessmentImage schema + migration`.

---

### Task 2: Server-side sanitizer core (`lib/richtext/sanitize.ts`)

**Files:** `package.json` (+ `sanitize-html` dep), `lib/richtext/sanitize.ts`, `lib/richtext/sanitize.test.ts`.

**Interface:** `sanitizeRichText(dirty: string): string` — the ONE sanitizer used on write AND read. Allowlist tags `['h2','h3','p','br','strong','em','u','ul','ol','li']`, `allowedAttributes: {}` (none), `allowedStyles: {}`, no `a`/`img`/`iframe`/`script`/`style`, `disallowedTagsMode: 'discard'`. Returns '' for empty/whitespace-only.

- [ ] **Step 1:** Add `sanitize-html` (pure-JS, no DOM dep) to `dependencies`. (No sanitizer exists in the repo; `jsdom` is test-only.) Run `npm install` then `npm run audit:ci`.
- [ ] **Step 2: Failing tests** (`sanitize.test.ts`): `<script>`/`<img>`/`<a href>`/`onclick=`/`style=`/`<iframe>` all stripped; nested lists + bold/italic/underline preserved; unknown tags discarded but inner text kept; empty→''.
- [ ] **Step 3:** Implement `sanitizeRichText` via `sanitize-html` with the strict config. Run tests → PASS. `tsc` green.
- [ ] **Step 4: Commit** `feat(viewbook-l4): strict rich-text sanitizer (sanitize-html allowlist)`.

---

### Task 3: Reusable editor + renderer (`components/richtext/`)

**Files:** `components/richtext/RichTextEditor.tsx` (client), `components/richtext/RichTextRenderer.tsx`, tests.

**Interfaces:**
- `RichTextEditor({ value, onChange, ariaLabel }: { value: string; onChange: (html: string) => void; ariaLabel: string })` — a minimal WYSIWYG (contentEditable + a toolbar: H2/H3, bold/italic/underline, bullet/ordered list) emitting HTML. Keep it dependency-light; no external editor lib (spec: self-contained). onChange fires the current HTML (sanitized at the persistence layer, not necessarily in the editor).
- `RichTextRenderer({ html }: { html: string })` — renders `dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}` (RE-sanitize on read — defensive) inside a `.vb-richtext` wrapper with light-only prose styles. LIGHT-ONLY (public viewbook; no `dark:`).

- [ ] **Step 1: Failing tests:** renderer re-sanitizes a malicious `html` prop (script stripped) even if a tampered value reaches it; renders allowed tags. Editor: typing/toolbar produces expected tags (jsdom-testable subset — assert `onChange` receives HTML with the formatting tag after a `document.execCommand`/toolbar action; keep assertions to what jsdom supports, else assert structure).
- [ ] **Step 2:** Implement both. Renderer ALWAYS routes through `sanitizeRichText`.
- [ ] **Step 3:** Tests PASS; `tsc`/`lint` green.
- [ ] **Step 4: Commit** `feat(viewbook-l4): reusable rich-text editor + sanitizing renderer`.

---

### Task 4: Assessment-notes service + public types (`lib/viewbook/assessment-notes.ts`)

**Files:** `lib/viewbook/assessment-notes.ts`, `lib/viewbook/public-types.ts` (NEW separate interfaces only), tests.

**Interfaces:**
- Public types (SEPARATE, not folded into `ViewbookPublicData`): `PublicAssessmentNotes { generalNotesHtml: string | null; userBehaviourHtml: string | null; userBehaviourImages: PublicAssessmentImage[] }`, `PublicAssessmentImage { id: number; filename: string; sortOrder: number }`.
- `loadAssessmentNotes(viewbookId: number): Promise<PublicAssessmentNotes | null>` — reads the content row + images (ordered), **re-sanitizes** both HTML bodies via `sanitizeRichText` before returning.
- `setAssessmentNote(viewbookId, field: 'general'|'userBehaviour', html: string, actor: string): Promise<void>` — sanitize→upsert content row→`syncVersionBumpStatement` in ONE array-form `$transaction`.
- `addAssessmentImage(viewbookId, buf: Buffer, actor): Promise<{filename}>` — `saveViewbookAsset(String(viewbookId), buf)` → `$transaction([create image row (ensure content row exists), syncVersionBumpStatement])` → on error `deleteViewbookAssets` orphan cleanup (mirror `docs.ts:81-108`).
- `deleteAssessmentImage(viewbookId, imageId, actor): Promise<void>` — snapshot filename → `$transaction([deleteMany predicated, bump])` → best-effort `deleteViewbookAssets` after commit (mirror `docs.ts:111-136`).
- `collectAssessmentImageSnapshot(clientId: number): Promise<{ viewbookId: number; filenames: string[] } | null>` — Lane-4-owned (can't touch `service.ts`'s `collectClientViewbookAssetSnapshot`), for the client-delete route (Task 9).

- [ ] **Step 1: Failing tests** (DB-backed): set/load round-trip re-sanitizes; add/delete image updates rows + bumps syncVersion; orphan cleanup on failed create; snapshot returns image filenames.
- [ ] **Step 2:** Implement. All writes array-form txn + bump.
- [ ] **Step 3:** Tests PASS; `tsc`/`lint`.
- [ ] **Step 4: Commit** `feat(viewbook-l4): assessment-notes service (sanitize+bump, image lifecycle, snapshot)`.

---

### Task 5: Operator routes (`app/api/viewbooks/[id]/assessment/**`)

**Files:** `app/api/viewbooks/[id]/assessment/notes/route.ts` (PATCH), `app/api/viewbooks/[id]/assessment/images/route.ts` (POST multipart), `app/api/viewbooks/[id]/assessment/images/[imageId]/route.ts` (DELETE), tests.

**Template (from `app/api/viewbooks/[id]/csm/route.ts` + `.../assets/route.ts`):** `withRoute` → `requireOperatorEmail(request)` → `parseId` → `requireJsonObject(parseJsonBody(...))` (notes) or `requireBoundedContentLength` + `fileBufferFromForm` (image) → service call. Cookie-gated; NO middleware change (under the already-gated `/api/viewbooks/[id]/**` space).

- [ ] **Step 1: Failing tests:** PATCH notes (general/userBehaviour) validates field enum + persists sanitized; POST image bounded-length + rejects non-image; DELETE image; all 401 without operator cookie.
- [ ] **Step 2:** Implement thin routes delegating to the service. Bump rides the service txn (not the route).
- [ ] **Step 3:** Tests PASS; `tsc`/`lint`.
- [ ] **Step 4: Commit** `feat(viewbook-l4): cookie-gated assessment note/image operator routes`.

---

### Task 6: Public assets route — assessment-image allowlist

**Files:** `app/api/viewbook/[token]/assets/[filename]/route.ts`, test.

**Interface:** add a 4th allowlist branch (alongside theme/doc/team): `prisma.viewbookAssessmentImage.findFirst({ where: { filename, content: { viewbookId: vb.id } } })` → serve from scope `String(vb.id)`. Same indistinguishable-404 on miss (no oracle). Assessment images are NEVER global-scoped.

- [ ] **Step 1: Failing test:** a valid assessment image filename for the token's viewbook is served; a filename not in the set (or another viewbook's) → 404 identical to bad-token.
- [ ] **Step 2:** Implement the branch.
- [ ] **Step 3:** Tests PASS.
- [ ] **Step 4: Commit** `feat(viewbook-l4): serve assessment images via curated allowlist on public assets route`.

---

### Task 7: `AssessmentSection` integration + 2-decimal CLS

**Files:** `components/viewbook/public/AssessmentSection.tsx`, new operator-note leaf component(s) (e.g. `components/viewbook/public/AssessmentNotesEditors.tsx`), tests.

**Interfaces (from merged `AssessmentSection.tsx`):**
- Get operator identity WITHOUT touching `page.tsx`: call `getOperatorEmailForPublicPage()` (`lib/viewbook/public-session.ts`) inside the async `AssessmentSection`. Load notes via `loadAssessmentNotes(viewbookId)` (resolve viewbookId from token — `assessment.ts` already does `requireViewbookToken`; expose the id or add a small lookup).
- Insert the two blocks **between the narrative (line ~132) and the Scanned footer (line ~134)**: **General notes** (`RichTextRenderer` public; operator sees the editor leaf) + **User Behaviour** (`RichTextRenderer` + image gallery; operator sees editor + image add/delete). Operator leaves mount INSIDE `AssessmentSection` (NOT `InlineEditors.tsx`), gated by the operator check; they register `useEditorActivity` + `requestRefresh` per the sync contract; note editors debounce-save via the Lane-2 autosave hook IF cleanly reusable, else an explicit Save is acceptable for rich-text (decide in-task; document).
- **CLS 2-decimals (D12):** at `AssessmentSection.tsx:105-107` (homepage) and `:115-119` (site-wide), wrap `assessment.homepage.cls` and `assessment.performance.p75Cls` in a `cls(x) => Number(x).toFixed(2)` formatter (sibling to `seconds()`). Leave scores `/100` and 1-decimal LCP seconds unchanged.

- [ ] **Step 1: Failing tests:** both blocks render (public: sanitized HTML; images shown for User Behaviour); operator identity path renders editors; CLS renders to exactly 2 decimals (e.g. `0.02`).
- [ ] **Step 2:** Implement. Public read re-sanitizes (via RichTextRenderer). Images rendered via the public assets URL (`publicAssetUrl(token, filename)`), never embedded in HTML.
- [ ] **Step 3:** Tests PASS; `tsc`/`lint`.
- [ ] **Step 4: Commit** `feat(viewbook-l4): assessment notes+images in AssessmentSection + 2-decimal CLS`.

---

### Task 8: Retention — assessment-image file cleanup (`lib/viewbook/retention.ts`)

**Files:** `lib/viewbook/retention.ts`, test.

**Interface:** DB rows cascade-delete with the viewbook, but ASSET FILES do not. Add a helper that removes orphaned assessment-image files (mirror `docs.ts` snapshot→delete order). Verify where `retention.ts` is invoked (grep `lib/jobs/` / scheduler) — if `pruneViewbookActivity` is wired into a sweep, wire the new cleanup there too; if not, document the wiring gap. (Primary file-removal path for delete is the service/route in Tasks 4-5 + client-delete in Task 9; retention is the backstop.)

- [ ] **Step 1: Failing test** for the cleanup helper. **Step 2:** Implement. **Step 3:** PASS. **Step 4: Commit** `feat(viewbook-l4): assessment-image file retention backstop`.

---

### Task 9: Client-delete asset snapshot merge (`app/api/clients/[id]/route.ts`)

**Files:** `app/api/clients/[id]/route.ts`, test.

**Interface:** the DELETE handler (lines 128-156) already snapshots viewbook assets via `collectClientViewbookAssetSnapshot` (in `service.ts` — OFF LIMITS). Lane 4 adds a SECOND call to its own `collectAssessmentImageSnapshot(clientId)` (Task 4) and merges the filenames into the existing `deleteViewbookAssets(String(viewbookId), [...])` call, all inside `route.ts` — NEVER editing `service.ts`.

- [ ] **Step 1: Failing test:** deleting a client with assessment images removes their files. **Step 2:** Implement the merge. **Step 3:** PASS. **Step 4: Commit** `feat(viewbook-l4): remove assessment image files on client delete`.

---

### Task 10: Full gates + migration verify + whole-branch review

- [ ] Full gates in worktree: `tsc --noEmit` · `lint` · full `npm test` · `npm run build`; migration applies clean on a fresh DB.
- [ ] Self-review greps: no `dangerouslySetInnerHTML` bypasses `sanitizeRichText`; no client input reaches an asset URL unvalidated; no touch of `service.ts`/`page.tsx`/`middleware.ts`.
- [ ] Whole-branch review (opus) + `/codex-review` (P1) before merge.

## Self-review checklist
- [ ] Every rendered-row mutation rides a `syncVersion` bump in an array-form txn.
- [ ] Sanitize on write AND read; strict allowlist; no `a`/`img`/`style`/handlers survive.
- [ ] Assessment images served only via the curated allowlist; indistinguishable 404 on miss.
- [ ] `PublicSection`/`SectionShell`/`ViewbookPublicData`/`page.tsx`/`service.ts` untouched.
- [ ] Migration additive + applies clean; no backfill of existing rows needed.
