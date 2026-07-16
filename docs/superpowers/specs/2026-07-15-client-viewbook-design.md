# Client Viewbook Hub — Design

**Date:** 2026-07-15
**Status:** Approved by Kevin (brainstorming session); pending Codex review
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
viewbook subtree; `Client` delete cascades the viewbook).

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
  valueUpdatedBy String? // 'client' | operator email
  valueUpdatedAt DateTime?
  createdBy   String    // 'seed' | operator email (custom-field who/when requirement)
  createdAt   DateTime  @default(now())
  amendments  ViewbookFieldAmendment[]
  @@unique([viewbookId, defKey])   // one row per catalog question; custom rows have defKey null (SQLite: NULLs never collide)
}

model ViewbookFieldAmendment {
  id         Int      @id @default(autoincrement())
  fieldId    Int
  field      ViewbookField @relation(fields: [fieldId], references: [id], onDelete: Cascade)
  value      String
  author     String   // 'client' | operator email
  createdAt  DateTime @default(now())
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
  resolvedAt   DateTime?
  resolvedBy   String?   // operator email
  createdAt    DateTime  @default(now())
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
  url         String   // https-only, validated
  addedBy     String   // 'client' | operator email
  createdAt   DateTime @default(now())
}

model ViewbookActivity {
  id          Int      @id @default(autoincrement())
  viewbookId  Int
  viewbook    Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  kind        String   // 'answer' | 'amendment' | 'feedback' | 'material-link' | 'lock' | 'section-done' | ...
  actor       String   // 'client' | operator email
  summary     String   // pre-rendered one-line description (plain text)
  createdAt   DateTime @default(now())
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

- Colors validated `^#[0-9a-fA-F]{6}$` — values are injected into a `<style>`
  block as CSS custom properties; the regex is the injection guard.
  A derived on-primary text color (relative-luminance check) keeps headers
  legible on any brand color.
- Fonts are **keys into a code-owned catalog** (`FONT_CATALOG`: key → family
  name + Google Fonts URL params). The public page emits ONE
  `fonts.googleapis.com` `<link>` built from catalog values only — client input
  never reaches the URL. Missing/invalid key → app default stack.
- Defaults: parse failure or empty theme renders the ER-default theme; a broken
  theme can never blank the page.
- The public viewbook does NOT participate in the app's dark/light mode; the
  client theme is the only theme. Admin pages stay normal app-themed.

Assets: `VIEWBOOK_ASSETS_DIR` env (`${DATA_HOME}/viewbook-assets` in prod,
`<cwd>/data/viewbook-assets` default — HERO_SCREENSHOTS_DIR precedent). Operator
uploads (logo, section heroes) go through a cookie-gated upload route (size cap
2 MB; content-type allowlist png/jpg/webp only — SVG explicitly rejected, script
risk; atomic unique-temp+rename write). Files deleted on replacement and on viewbook
delete (ENOENT-tolerant).

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
`Viewbook` by token, rejects revoked, rejects archived client. Every failure →
controlled 401/404, never a raw throw.

Public writes additionally reject when the target section is `hidden`, when the
viewbook is revoked, and (answers only, pre-lock path) when field ids don't
belong to the token's viewbook. Bodies parsed with `parseJsonBody` +
`readBoundedJson`-style byte caps. All routes `withRoute`-wrapped.

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
  render beside the original with "changed on {date} by {who}".
- **Brand Guidelines** — palette swatches (theme colors + admin-added extended
  swatches later if needed — v1 = theme kit colors), live typography specimens
  in the actual heading/body fonts, `narrative` design-philosophy prose.
- **Current-Site Assessment** — server loader pulls the client's latest
  completed, non-seoOnly site audit with a `seo-parser` run (C14 reportable
  rule): ADA + SEO scores, top issue groups (counts only), CWV rollup, plus the
  operator `narrative`. Honest labels (lab data; no compliance claims — reuse
  C14 copy rules). No completed audit → "first scan coming soon" state. Hidden
  by default for `kind: 'new-build'`.
- **SEO/GEO/E-E-A-T Strategy** — global base blocks ("our playbook") + the
  viewbook's override blocks ("your plan"), visually distinguished.
- **Materials & Links** — client-added share links (label + URL + who/when),
  operator-added request placeholders ("Logo files — add a link"), plain list.

**Fault isolation.** Each section loads via a per-section try/catch
(`loadOpsSnapshot` precedent): a failing section degrades to a friendly
placeholder; the page never blanks.

## 9. Notifications & activity

- Every public write and notable operator action (lock, section done) appends a
  `ViewbookActivity` row with a pre-rendered plain-text `summary`.
- `system-viewbook-digest` schedule (`every:15m`, seeded in
  `system-schedules.ts`) fires a `viewbook-digest` job: find viewbooks with
  `ViewbookActivity.id > digestCursorId` AND client-actor activity AND
  (`digestSentAt` null OR older than 1 h) → for each, send ONE email via the D7
  transport (`buildViewbookDigestEmail` in `lib/notify/`) listing the new
  activity, then advance `digestCursorId` + stamp `digestSentAt` (marker-then-
  cursor ordering = at-least-once, duplicate-tolerant).
- Recipient: `Viewbook.notifyEmail` ?? `notifyAdminEmail()`. Dark env (Mailgun
  unset) = permanent suppression, cursor still advances (feed remains the source
  of truth; no catch-up flood when env lights up — matches sweep-digest rule).
- Operator-actor activity never triggers digests (it's in the feed only).

## 10. Internal admin UI

- **`/viewbooks`** — index: client, kind, stage summary, last client activity,
  unresolved feedback count; create button.
- **`/viewbooks/[id]`** — editor tabs: Theme (kit editor + live preview iframe
  of the public page), Content (welcome, section intros/narratives, overrides),
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
  rotation; archived client → public 404.
- Anchored single-segment middleware matchers only (5 new).
- Public writes: typed bodies, byte caps (answer 8 KB, feedback 4 KB, label
  256 B), count caps (feedback ≤ 200/link, materials ≤ 100/viewbook, amendments
  ≤ 20/field), plain-text storage, render-time escaping.
- URLs (`materials`, operator review links): `new URL` + https-only.
- Theme colors regex-validated; fonts catalog-keyed; assets served through an
  ownership + allowlist + traversal-guarded route; SVG uploads rejected.
- No client-supplied identity trusted for attribution beyond the free-text
  display name on feedback (clearly labeled "as reported").
- Array-form transactions only; lock-in is a fenced `updateMany`.

## 12. Testing

Vitest on the pure cores:

- catalog + milestone seeding (row shapes, idempotent sync-questions),
- answer-write state machine (pre-lock mutates + stamps; post-lock appends
  amendment; lock fence first-writer-wins),
- theme validation (hex/font/asset-filename acceptance + rejection + luminance
  derivation),
- digest batching (cursor math, 1-h window, dark-gate cursor advance,
  client-vs-operator actor filtering),
- public-write validators (caps, URL rules, cross-viewbook field id rejection),
- assessment loader (reportable-audit resolution, no-audit state).

Route-level tests for `requireViewbookToken` fail-closed behavior. Gates:
`tsc --noEmit` + vitest locally (the only gates, per repo rules).

## 13. Retention & lifecycle

- `runCleanup` prunes `ViewbookActivity` older than 180 d.
- Viewbook lives as long as the client; client archive hides the public page
  (validator rejects); client delete cascades.
- Asset files deleted on replacement/viewbook-delete (ENOENT-tolerant).
- No token TTL (project-length links); rotation is the operator remedy.

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

Each increment is independently gate-green and deployable.

## 15. Open questions / future (explicitly out of v1)

- File uploads (Drive API or direct) — revisit after v1 usage.
- Client-side identity ("who's viewing" name prompt) — only if attribution
  pain shows up.
- PDF/print export of the viewbook.
- Pulling GSC/GA4 snapshots into the assessment section.
- Retiring the Jotform intake entirely (v1 coexists).
