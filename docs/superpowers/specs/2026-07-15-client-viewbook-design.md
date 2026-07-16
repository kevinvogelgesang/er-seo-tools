# Client Viewbook Hub — Design

**Date:** 2026-07-15
**Status:** Approved by Kevin (brainstorming session); Codex review applied (accept-with-fixes, 9 fixes, 2026-07-16)
**Approach:** B — fixed purpose-built sections + per-client theme kit, shipped in 5 increments

## 1. What this is

A client-facing, token-linked "viewbook" hub — one per client — for two audiences:
new clients getting their website built, and existing clients being re-platformed
onto the new website stack. It is the single orientation + data + progress +
revision surface for the project: the kickoff presentation, the launch Q&A data
source, the brand guidelines, the milestone/review touchpoints, the current-site
assessment, and the SEO/GEO/E-E-A-T strategy — presented in a bold, full-viewport
"viewbook" style (reference: https://viewbook.adelphi.edu/), themed per client.

It replaces the planned one-off artifacts: kickoff presentation for new clients,
adaptation for existing clients, meet-the-team, timelines, behavioural assessment
of the current site, EEAT/SEO/GEO strategy docs, and "here is what we are doing
and WHY."

Teamwork remains the task tracker. The viewbook is the *client's* window, not an
internal PM tool.

## 2. Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Access | Stable non-guessable token link `/viewbook/[token]` (C14 sales-report pattern). No client logins. |
| Attachment | `Viewbook` belongs to a `Client` row (unique — one viewbook per client). New builds get a Client created at kickoff. |
| Client writes | Q&A answers (until lock-in; after lock-in, dated append-only amendments), revision feedback, self-pasted material links (Drive/Dropbox URLs). No file uploads in v1. |
| Milestones | Named stages (seeded default list, editable per client) with attachable review links + threaded client feedback. Not task-level tracking. |
| Shared content | Global admin-editable company content (team, process, base SEO/GEO/E-E-A-T strategy, "why") rendered live into every viewbook + per-client append-mode overrides. |
| Theming | Theme kit: 3 brand colors, heading/body font (curated list), logo, optional per-section hero images — CSS variables over ONE designed layout. |
| Q&A intake | Code-owned seeded question catalog modeled on the Jotform onboarding doc; operators pre-fill, clients edit until lock-in. |
| Assessment | Pulls the client's latest completed site audit (ADA + SEO scores, top issues, CWV) + operator narrative. |
| Notifications | Internal activity feed + batched Mailgun digest email (≤1/hour per viewbook), D7 dark-gate rules. |
| Custom fields | Created by operators (label + type + who/when stamps); answered by either side. |

"Visual Bible" = **Brand Guidelines** (the industry term; a.k.a. brand book /
style guide). That is the section name used throughout.

## 3. Non-goals (v1)

- No client authentication/accounts; the token is the access grant.
- No file uploads (clients paste share links they created themselves).
- No Teamwork integration (deliberate — Teamwork stays the internal tracker).
- No AI/LLM API features (standing repo rule).
- No per-client layout variants; one designed layout, theme-kit-skinned.
- No PDF export of the viewbook.
- No section reordering UI (fixed order; per-viewbook show/hide only).

## 4. Data model (Prisma, additive migration)

All new models. Origin FK deletes follow existing conventions (cascade within the
viewbook subtree; `Client` delete cascades the viewbook — and `Client` gains the
inverse optional `viewbook Viewbook?` relation). Creation seeding is ONE nested
`Viewbook.create` (`sections/fields/milestones` via nested `create`) — separate
child ops cannot consume the autoincremented parent id inside a preconstructed
array transaction (Codex fix 5).

```prisma
model Viewbook {
  id              Int       @id @default(autoincrement())
  clientId        Int       @unique
  client          Client    @relation(fields: [clientId], references: [id], onDelete: Cascade)
  kind            String    // 'new-build' | 'upgrade'
  token           String    @unique          // crypto.randomUUID; rotate = new value
  revokedAt       DateTime?                  // non-null = public page 404s
  themeJson       String    @default("{}")   // validated ViewbookTheme (see §6)
  welcomeNote     String?                    // per-client welcome line
  notifyEmail     String?                    // digest recipient; null → NOTIFY_ADMIN_EMAIL
  dataLockedAt    DateTime?                  // Data Source lock-in point
  dataLockedBy    String?                    // operator email
  digestCursorId  Int       @default(0)      // last ViewbookActivity.id included in a digest
  digestSentAt    DateTime?                  // last digest send time
  createdBy       String?                    // operator email
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  sections        ViewbookSection[]
  fields          ViewbookField[]
  milestones      ViewbookMilestone[]
  contentOverrides ViewbookContentOverride[]
  materialLinks   ViewbookMaterialLink[]
  activities      ViewbookActivity[]
}

model ViewbookSection {
  id          Int       @id @default(autoincrement())
  viewbookId  Int
  viewbook    Viewbook  @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  sectionKey  String    // 'welcome' | 'milestones' | 'data-source' | 'brand' | 'assessment' | 'strategy' | 'materials'
  state       String    @default("active") // 'hidden' | 'active' | 'done'
  doneAt      DateTime?
  introNote   String?   // optional operator-written per-client intro (plain text)
  narrative   String?   // assessment narrative / brand philosophy prose (plain text, operator-written)
  updatedAt   DateTime  @updatedAt
  @@unique([viewbookId, sectionKey])
}

model ViewbookField {
  id          Int       @id @default(autoincrement())
  viewbookId  Int
  viewbook    Viewbook  @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  defKey      String?   // references the code-owned catalog; null = custom field
  category    String    // catalog category key (custom fields pick one)
  label       String    // catalog label snapshot, or custom label
  fieldType   String    // 'text' | 'textarea' | 'list'
  sortOrder   Int
  value       String?   // canonical answer (list = JSON array of strings)
  version     Int       @default(0)  // optimistic concurrency: every value write bumps; autosave carries expectedVersion
  valueUpdatedBy String? // 'client' | operator email
  valueUpdatedAt DateTime?
  archivedAt  DateTime? // soft archive — fields with amendments or created pre-lock are NEVER hard-deleted (append-only record survives)
  createdBy   String    // 'seed' | operator email (custom-field who/when requirement)
  createdAt   DateTime  @default(now())
  amendments  ViewbookFieldAmendment[]
  @@unique([viewbookId, defKey])   // one row per catalog question; custom rows have defKey NULL — never '' (SQLite: NULLs never collide); custom fields are addressed by id, not this selector
}

model ViewbookFieldAmendment {
  id         Int      @id @default(autoincrement())
  fieldId    Int
  field      ViewbookField @relation(fields: [fieldId], references: [id], onDelete: Cascade)
  value      String
  author     String   // 'client' | operator email
  clientMutationId String? @unique // client-generated UUID — retry idempotency (replay returns the existing row)
  createdAt  DateTime @default(now())
  @@index([fieldId, id])
}

model ViewbookMilestone {
  id          Int       @id @default(autoincrement())
  viewbookId  Int
  viewbook    Viewbook  @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  title       String
  blurb       String?
  sortOrder   Int
  status      String    @default("upcoming") // 'upcoming' | 'current' | 'done'
  targetDate  DateTime?
  doneAt      DateTime?
  reviewLinks ViewbookReviewLink[]
  @@index([viewbookId, sortOrder])
  // migration adds a raw PARTIAL unique index: at most ONE 'current' milestone
  // per viewbook — CREATE UNIQUE INDEX ... ON ViewbookMilestone(viewbookId) WHERE status = 'current'
}

model ViewbookReviewLink {
  id          Int       @id @default(autoincrement())
  milestoneId Int
  milestone   ViewbookMilestone @relation(fields: [milestoneId], references: [id], onDelete: Cascade)
  label       String
  url         String    // https-only, validated
  kind        String    // 'mockup' | 'live'
  createdBy   String    // operator email
  createdAt   DateTime  @default(now())
  feedback    ViewbookFeedback[]
}

model ViewbookFeedback {
  id           Int       @id @default(autoincrement())
  reviewLinkId Int
  reviewLink   ViewbookReviewLink @relation(fields: [reviewLinkId], references: [id], onDelete: Cascade)
  body         String    // plain text, byte-capped
  authorName   String?   // client-claimed, optional (no auth)
  authorKind   String    // 'client' | 'operator'
  clientMutationId String? @unique // retry idempotency
  resolvedAt   DateTime?
  resolvedBy   String?   // operator email
  createdAt    DateTime  @default(now())
  @@index([reviewLinkId, id])
}

model ViewbookGlobalContent {
  key        String   @id  // 'team' | 'process' | 'why' | 'seo-base' | 'geo-base' | 'eeat-base'
  bodyJson   String   // typed per key: team = roster array; others = heading/paragraph blocks
  updatedBy  String
  updatedAt  DateTime @updatedAt
}

model ViewbookContentOverride {
  id          Int      @id @default(autoincrement())
  viewbookId  Int
  viewbook    Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  contentKey  String   // same key space as ViewbookGlobalContent
  body        String   // plain-text append block ("your plan" adjustments)
  updatedBy   String
  updatedAt   DateTime @updatedAt
  @@unique([viewbookId, contentKey])
}

model ViewbookMaterialLink {
  id          Int      @id @default(autoincrement())
  viewbookId  Int
  viewbook    Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  label       String
  status      String   @default("provided") // 'requested' (operator placeholder, url null) | 'provided'
  url         String?  // https-only, validated; null while 'requested'
  clientMutationId String? @unique // retry idempotency
  addedBy     String   // 'client' | operator email
  providedAt  DateTime?
  createdAt   DateTime @default(now())
  @@index([viewbookId, id])
}

model ViewbookActivity {
  id          Int      @id @default(autoincrement())
  viewbookId  Int
  viewbook    Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  kind        String   // 'answer' | 'amendment' | 'feedback' | 'material-link' | 'lock' | 'section-done' | ...
  actor       String   // 'client' | operator email
  summary     String   // pre-rendered one-line description (plain text)
  createdAt   DateTime @default(now())
  @@index([viewbookId, id]) // digest range scan (oldCursor, highWater]
}
```

Notes:

- `@@unique([viewbookId, defKey])` guards duplicate catalog seeding; SQLite
  treats NULL as distinct so unlimited custom fields coexist.
- Field values, feedback bodies, notes, narratives are ALL plain text, escaped at
  render. No rich text crosses the public boundary.
- `ViewbookSection.narrative` carries the operator prose for `assessment`
  (what-this-means narrative) and `brand` (design philosophy); other sections
  ignore it.

## 5. Question catalog + milestone seed (code-owned)

`lib/viewbook/catalog.ts` — the seeded Q&A schema, modeled on the Jotform
onboarding document (Pro Way Hair School reference). Categories and questions
(abridged; the module is the source of truth):

- **school** — school name, primary contact name/email, services subscribed,
  how they refer to the school in advertising, abbreviations.
- **programs** — per-program name + key features/highlights (list fields).
- **team-access** — staff who need accounts/lead notifications, website change
  approver (+ title/email), technical contact (+ title/email).
- **crm-leads** — lead delivery preference, notification emails, CRM in use,
  credential handoff method, current lead volume/sources, average enrollment time.
- **admissions** — admissions staff title, "next step" name (consultation etc.),
  tour format, accreditations (+ URLs).
- **positioning** — unique advantages, top-5 reasons students choose them,
  differentiators, demographic, ideal-student profile per program.
- **student-experience** — motivations, barriers, common feedback, culture notes.
- **brand-materials** — existing brand guidelines y/n, privacy policy status,
  testimonials availability, domain registrar.

Each entry: `{ defKey, category, label, fieldType, sortOrder }`. Seeding happens
at viewbook creation inside the create transaction (array-form): one
`ViewbookField` row per catalog entry (`createdBy: 'seed'`) + one
`ViewbookSection` row per section key + default milestones.

Default milestone seed (`lib/viewbook/milestones.ts`): Kickoff → Materials in →
Design → Build → First review (homepage + program page) → Full-site review →
Launch. Operators rename/add/remove per client.

Catalog changes over time: additive only. New catalog entries appear in
*new* viewbooks; an admin "sync questions" button backfills missing `defKey`
rows into an existing viewbook (never deletes, never overwrites values).

## 6. Theme kit

`lib/viewbook/theme.ts` — client-safe types + the ONE validator used by both the
admin write route and the public renderer (read exactly as strict as write —
KS-3 `checkEntryFields` precedent):

```ts
type ViewbookTheme = {
  primary: string   // '#RRGGBB' — strict regex, rejected otherwise
  secondary: string
  tertiary: string
  headingFont: string  // key into FONT_CATALOG (curated ~25 Google Fonts)
  bodyFont: string     // key into FONT_CATALOG
  logo: string | null            // filename under VIEWBOOK_ASSETS_DIR
  sectionHeroes: Partial<Record<SectionKey, string>> // filenames
}
```

- The validator is a **strict whole-object parse** (Codex fix 6): unknown keys
  rejected, JSON byte cap on `themeJson`, `sectionHeroes` keys must be
  recognized section keys, filenames must match the server-generated filename
  regex. Read is exactly as strict as write.
- Colors validated `^#[0-9a-fA-F]{6}$` — values are injected into a `<style>`
  block as CSS custom properties; the regex is the injection guard.
  A derived on-primary text color (relative-luminance check) keeps headers
  legible on any brand color.
- Fonts are **keys into a code-owned catalog** (`FONT_CATALOG`: key → family
  name + Google Fonts URL params). The public page emits ONE
  `fonts.googleapis.com` `<link>` built from catalog values only — client input
  never reaches the URL. Missing/invalid key → app default stack.
  **CSP (Codex fix 7):** the report-only CSP in `next.config.ts` must gain
  `fonts.googleapis.com` (style) + `fonts.gstatic.com` (font) origins in the
  same increment that ships the public page — runtime Google Fonts accepted
  (Kevin-side privacy call defaulted; self-hosting is the recorded fallback).
- Defaults: parse failure or empty theme renders the ER-default theme; a broken
  theme can never blank the page.
- The public viewbook does NOT participate in the app's dark/light mode; the
  client theme is the only theme. Admin pages stay normal app-themed.

Assets: `VIEWBOOK_ASSETS_DIR` env (`${DATA_HOME}/viewbook-assets` in prod,
`<cwd>/data/viewbook-assets` default — HERO_SCREENSHOTS_DIR precedent). Operator
uploads (logo, section heroes, **and global team photos** — same store, keyed
`global/` vs `<viewbookId>/` prefix; the asset route authorizes team photos via
the global-content roster's filename set, viewbook assets via the token's own
themeJson filename set — C14 curated-set precedent, path-containment guarded)
go through a cookie-gated upload route: size cap 2 MB; allowlist png/jpg/webp
verified by **magic-byte signature sniffing, never the upload Content-Type**
(SVG explicitly rejected — script risk); served with the allowlisted MIME +
`X-Content-Type-Options: nosniff`; filenames are server-generated (regex-safe),
written atomic unique-temp+rename. Write order: file write → DB stamp →
old-file delete; a failed stamp deletes the orphan file; deletes are
ENOENT-tolerant. Lifecycle (Codex fix 6): viewbook DELETE and **Client
cascade-delete** both snapshot the viewbook's filenames BEFORE the DB delete,
then best-effort-delete files (the Client DELETE route gains this snapshot —
cascade alone would leak files).

## 7. Routes & middleware

**Public (token-gated), exactly five anchored single-segment matchers — never a
prefix:**

| Route | Method | Purpose |
|---|---|---|
| `^/viewbook/[^/]+$` | GET (page) | The viewbook. `(public)` route group, `force-dynamic`, zero cookie-gated fetches. |
| `^/api/viewbook/[^/]+/answers$` | PATCH | Client answer write: `{fieldId, value}`. Pre-lock → mutate `value` (+stamps). Post-lock → create amendment. Byte-capped. |
| `^/api/viewbook/[^/]+/feedback$` | POST | Client feedback: `{reviewLinkId, body, authorName?}`. Count + byte caps. |
| `^/api/viewbook/[^/]+/materials$` | POST | Client material link: `{label, url}`. https-only URL validation, count cap. |
| `^/api/viewbook/[^/]+/assets/[^/]+$` | GET | Theme assets (logo/heroes). Token-ownership + filename allowlist (the viewbook's own themeJson filenames — curated-set precedent) + traversal guard. Indistinguishable 404s. |

Token validation: ONE fail-closed helper `requireViewbookToken(token)` in
`lib/viewbook/route-auth.ts` (cat_ `route-auth.ts` precedent) — resolves
`Viewbook` by token, rejects revoked, rejects archived client. Every token
failure (invalid, revoked, archived client) → ONE indistinguishable **404**
contract (never 401-vs-404 oracles), never a raw throw.

**Commit-time fencing (Codex fix 1):** `requireViewbookToken` is only a
preflight. EVERY public mutation re-verifies inside its own conditional
statement (array-form transaction, EXISTS predicates — the repo's
reservation/fencing pattern): token still current + `revokedAt IS NULL` +
client not archived + target section not `hidden` + target row belongs to the
token's viewbook (answers AND amendments AND feedback's `reviewLinkId` AND
materials). 0 rows affected → 404/409, never a blind write. Rotation/revocation
racing a request can therefore never land a write.

**Write semantics (Codex fixes 2–3):**
- Answers PATCH carries `expectedVersion`; pre-lock update is conditional on
  `version = expectedVersion AND dataLockedAt IS NULL` and bumps `version`.
  Stale tab → 409 `stale_version` with the current value. Lock won the race →
  409 `data_locked` with the current value (NEVER a silent amendment; the
  client UI re-renders the locked state and offers "propose a change").
  Operator answer writes obey the same version + lock rules.
- Amendments, feedback, and materials are append-only with a client-generated
  `clientMutationId` (UUID) — a retry replays the stored row (200), never
  duplicates. Count caps are enforced with guarded `INSERT … SELECT` (cap
  predicate in SQL), never count-then-create.
- The domain row and its `ViewbookActivity` row are created in the SAME
  array-form transaction. No-op answer saves (unchanged value) emit NO
  activity. A token-scoped in-process write throttle returns 429 on burst
  abuse (bounds the activity stream).
- Public write handlers additionally require a JSON content type and apply
  `isSameSiteRequest` INSIDE the handler (Codex fix 8 — middleware returns
  before the same-site guard for public paths). All mutation responses and the
  public page send `Cache-Control: no-store`.

Bodies parsed with `parseJsonBody` + `readBoundedJson`-style byte caps. All API
routes `withRoute`-wrapped (the page itself is not a `withRoute` handler).

**Internal (cookie-gated, no middleware changes needed — default-gated):**

- `GET/POST /api/viewbooks` — list; create (`{clientId, kind}` → seeds catalog +
  sections + milestones in one array-form transaction).
- `GET/PATCH/DELETE /api/viewbooks/[id]` — detail; theme/welcome/notify edits;
  delete (asset files cleaned up).
- `POST /api/viewbooks/[id]/token` — rotate; `DELETE` — revoke.
- `POST /api/viewbooks/[id]/lock` — Data Source lock-in (fenced
  `updateMany where dataLockedAt: null`; idempotent, first writer wins).
- `PATCH /api/viewbooks/[id]/sections/[sectionKey]` — state/intro/narrative.
- `POST/PATCH/DELETE` fields, milestones, review links, feedback-resolve,
  overrides, material links (operator side), asset upload.
- `GET/PUT /api/viewbook-content/[key]` — global content editor.
- `GET /api/viewbooks/[id]/activity` — feed (cursor-paginated).

Operator identity on writes = `getAuthSession().email` (server-resolved, D7
precedent — never client-supplied).

## 8. The public page

**Layout.** Full-viewport spreads in fixed order: Welcome & Team → Process &
Milestones → Data Source → Brand Guidelines → Current-Site Assessment →
SEO/GEO/E-E-A-T Strategy → Materials & Links. Slim sticky progress nav (client
logo + section dots). Bold oversized section headers (theme heading font,
brand-color band, optional hero image). Each section has a summary band
(CEO-skimmable: one line + a big number/status) above expandable detail
(dropdowns, tooltips, tables — marketing-exec depth). `hidden` sections don't
render; `done` sections collapse to a celebratory slim header (check + accent +
completion date), expandable — data always retained.

**Per-section behavior:**

- **Welcome & Team** — global team roster + process explainer + "why" content,
  per-client `welcomeNote`. Read-only.
- **Process & Milestones** — horizontal timeline, `current` stage spotlighted,
  target dates when set. Review-link cards per stage; each card opens the URL
  and offers a feedback thread (optional name). Resolved feedback renders
  checked. Empty state: "reviews will appear here at each touchpoint."
- **Data Source** — Q&A grouped by catalog category + custom fields inline.
  Pre-lock: inline client editing, autosave per field (PATCH per blur),
  "last updated by {who} on {date}" stamps. Post-lock: read-only values +
  locked banner + per-field "propose a change" → amendment form; amendments
  render beside the original with "changed on {date} by {who}". Operators MAY
  add custom fields post-lock: those sit outside the locked baseline, stay
  editable, and render marked "added after lock-in". A field that races the
  lock gets an honest 409 `data_locked` (never a silent amendment).
- **Brand Guidelines** — palette swatches (theme colors + admin-added extended
  swatches later if needed — v1 = theme kit colors), live typography specimens
  in the actual heading/body fonts, `narrative` design-philosophy prose.
- **Current-Site Assessment** — server loader pulls the client's latest
  completed, non-seoOnly site audit with a `seo-parser` run (C14 reportable
  rule), resolved CLIENT-WIDE across all registered domains (newest first, the
  audited domain displayed): ADA + SEO scores, top issue groups (counts only),
  CWV rollup, plus the operator `narrative`. Honest labels (lab data; no compliance claims — reuse
  C14 copy rules). No completed audit → "first scan coming soon" state. Hidden
  by default for `kind: 'new-build'`.
- **SEO/GEO/E-E-A-T Strategy** — global base blocks ("our playbook") + the
  viewbook's override blocks ("your plan"), visually distinguished.
- **Materials & Links** — client-added share links (label + URL + who/when),
  operator-added request placeholders ("Logo files — add a link"), plain list.

**Fault isolation.** Each section loads via a per-section try/catch
(`loadOpsSnapshot` precedent): a failing section degrades to a friendly
placeholder; the page never blanks.

All outbound links (review links, material links) render with
`rel="noopener noreferrer"`; the page is served `Cache-Control: no-store`.

## 9. Notifications & activity

- Every public write and notable operator action (lock, section done) appends a
  `ViewbookActivity` row with a pre-rendered plain-text `summary`.
- `system-viewbook-digest` schedule (`every:15m`, seeded in
  `system-schedules.ts`) fires a `viewbook-digest` job (registered concurrency
  1, 3 attempts, **no `site-audit:*` or other shared group** — D7 rules): find
  viewbooks with client-actor `ViewbookActivity.id > digestCursorId` AND
  (`digestSentAt` null OR older than 1 h).
- **High-water semantics (Codex fix 4):** per viewbook, capture
  `highWater = MAX(client-actor activity id)` ONCE up front; render ONLY rows
  `digestCursorId < id <= highWater`; send via the D7 transport
  (`buildViewbookDigestEmail` in `lib/notify/`); after a successful send,
  update `digestCursorId = highWater` AND stamp `digestSentAt` in the same
  statement (send-before-marker = D7's accepted narrow duplicate window).
  NEVER recompute `MAX(id)` after sending — concurrent writes land above the
  high-water mark and stay pending for the next run.
- Email content is capped (≤ 30 rows / byte cap); overflow renders one honest
  "+N more in the activity feed" line and the cursor STILL advances to
  `highWater` (no backlog carry — decided).
- Recipient: `Viewbook.notifyEmail` ?? `notifyAdminEmail()`. Dark env (Mailgun
  unset) = permanent suppression: cursor advances to `highWater` but
  `digestSentAt` is NOT stamped (feed remains the source of truth; no catch-up
  flood when env lights up — matches sweep-digest rule).
- Operator-actor activity never triggers digests (it's in the feed only), and
  no-op client autosaves emit no activity at all (§7).

## 10. Internal admin UI

- **`/viewbooks`** — index: client, kind, stage summary, last client activity,
  unresolved feedback count; create button.
- **`/viewbooks/[id]`** — editor tabs: Theme (kit editor + live preview via a
  SHARED preview renderer — the public page's server components rendered inline
  in the admin page, NEVER an iframe: the app ships `frame-ancestors 'none'` /
  `X-Frame-Options: DENY`, Codex fix 7), Content (welcome, section
  intros/narratives, overrides),
  Data Source (edit answers, add custom fields, **Lock in** with confirm,
  amendment review), Milestones (CRUD + status + review links), Feedback
  (threads + resolve), Activity (feed), Settings (token copy/rotate/revoke,
  notify email, kind, section show/hide).
- **`/viewbooks/settings`** — the global content editor (team roster with
  photos via the same asset store, process, why, seo/geo/eeat base blocks).
- **`/clients/[id]`** card — create viewbook / open editor / copy public link
  (via `NEXT_PUBLIC_APP_URL`, never request origin).

## 11. Security summary

- Non-guessable UUID token; single fail-closed validator; revocation +
  rotation; ALL token failures (invalid/revoked/archived) → one
  indistinguishable 404 contract.
- Anchored single-segment middleware matchers only (5 total), each added ONLY
  in the increment that ships its route, with positive + deeper-path-negative
  anchoring tests.
- Every public mutation is commit-time fenced (conditional SQL re-verifying
  token/revocation/client-active/section-visible/ownership — §7), idempotent
  via `clientMutationId`, cap-enforced via guarded `INSERT … SELECT`, version-
  guarded on answers, throttled per token (429), same-site-checked in-handler,
  JSON-content-type-required, `Cache-Control: no-store`.
- Public writes: typed bodies, byte caps (answer 8 KB, feedback 4 KB, label
  256 B), count caps (feedback ≤ 200/link, materials ≤ 100/viewbook, amendments
  ≤ 20/field), plain-text storage, render-time escaping.
- URLs (`materials`, operator review links): `new URL` + https-only; rendered
  with `rel="noopener noreferrer"`.
- Theme = strict whole-object validation (unknown-key reject, byte cap,
  filename regex); colors regex-validated; fonts catalog-keyed; uploads
  magic-byte-sniffed (SVG rejected); assets served through an ownership +
  allowlist + traversal-guarded route with `nosniff`.
- No client-supplied identity trusted for attribution beyond the free-text
  display name on feedback (clearly labeled "as reported").
- Array-form transactions only; lock-in is a fenced `updateMany`; post-lock
  fields are soft-archived, never hard-deleted (amendment record survives).

## 12. Testing

Vitest on the pure cores:

- catalog + milestone seeding (row shapes, idempotent sync-questions),
- answer-write state machine (pre-lock mutates + stamps; post-lock appends
  amendment; lock fence first-writer-wins; version bump rules),
- theme validation (strict-object/unknown-key/hex/font/asset-filename
  acceptance + rejection + luminance derivation),
- digest batching (high-water math, 1-h window, dark-gate cursor advance
  without `digestSentAt`, overflow "+N more" line, client-vs-operator actor
  filtering),
- public-write validators (caps, URL rules, cross-viewbook id rejection,
  `clientMutationId` replay),
- assessment loader (reportable-audit resolution client-wide, no-audit state).

DB-backed race tests (Codex fix 9): lock-vs-answer, revoke-vs-write, stale
`expectedVersion`, cross-viewbook ids, concurrent cap enforcement
(`INSERT … SELECT`), digest concurrent insertion above high-water, middleware
matcher anchoring (positive + deeper-path negative), asset-route curation.

Route-level tests for `requireViewbookToken` fail-closed behavior. Gates:
`npm run lint`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`,
plus `tsc --noEmit` (repo gate-green set).

## 13. Retention & lifecycle

- `runCleanup` prunes `ViewbookActivity` older than 180 d (safely far above the
  1-h digest cadence — no interaction with the cursor window).
- Viewbook lives as long as the client; client archive hides the public page
  (validator rejects); client delete cascades (with the filename snapshot →
  file cleanup in the Client DELETE route, §6).
- Asset files deleted on replacement/viewbook-delete (ENOENT-tolerant, orphan
  cleanup on failed stamps).
- No token TTL (project-length links); rotation is the operator remedy.
- Deploy checklist: `VIEWBOOK_ASSETS_DIR` on the persistent data volume
  (`${DATA_HOME}/viewbook-assets`), PM2-writable, added to backup expectations
  alongside uploads/reports.

## 14. Increments (5 PRs)

1. **Schema + admin shell** — migration, models, catalog/milestone seeds,
   create/list/detail admin, theme editor + validator, asset store, global
   content editor. No public page yet.
2. **Public themed page (read)** — token route + validator, middleware
   matchers, themed shell + all sections read-only (Welcome/Team, Brand,
   Strategy, Materials display, milestone timeline), fault isolation, assets
   route. *Usable as the kickoff presentation.*
3. **Data Source interactivity** — client answer writes, autosave, custom
   fields admin, lock-in, amendments, who/when stamps.
4. **Feedback + activity + digest** — review links, feedback threads +
   resolve, material-link client writes, `ViewbookActivity`,
   `system-viewbook-digest` + notify content builder.
5. **Assessment** — audit pull loader + narrative + new-build hiding; polish
   pass (done-state animations, tooltips, section hero images).

Each increment is independently gate-green and deployable. Middleware matchers
land only in the increment that ships their route (fix 9). Lane split (Kevin's
tandem test): PR1/PR2/PR5 = Claude; PR4 then PR3 = Codex (self-contained briefs
in the implementation plan); cross-review before every merge; Codex budget
exhaustion → pause the lane, Kevin triggers his usage reset.

## 15. Open questions / future (explicitly out of v1)

- File uploads (Drive API or direct) — revisit after v1 usage.
- Client-side identity ("who's viewing" name prompt) — only if attribution
  pain shows up.
- PDF/print export of the viewbook.
- Pulling GSC/GA4 snapshots into the assessment section.
- Retiring the Jotform intake entirely (v1 coexists).
