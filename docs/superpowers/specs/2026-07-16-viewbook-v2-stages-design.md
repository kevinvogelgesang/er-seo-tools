# Viewbook v2 — Stages, Live Sync & Presentation Overhaul — Design

**Date:** 2026-07-16
**Status:** Approved by Kevin (brainstorming session); pending Codex review
**Approach:** A — stage overlay on the v1 section engine (no rewrite of the
hardened public-write layer)
**Baseline:** v1 shipped 2026-07-16 (PRs #185/#187/#189/#191/#192, migration
`20260716101640_client_viewbook`); v1 spec at
`docs/superpowers/archive/specs/2026-07-15-client-viewbook-design.md`.

## 1. What this is

The viewbook becomes a **staged** client journey instead of a single static
page: `post-contract → kickoff → website-specifics → building`, manually moved
by ER (both directions). Plus: per-viewbook section acknowledgment that
collapses sections for everyone, near-real-time multi-user sync, a major
at-a-glance visual pass (auto-expand/collapse on scroll, floating TOC rail,
matured header, SVG accents), a designated CSM per viewbook, client team
invites, strategy-section PDF doc cards, webp image compression on upload, a
built-in WCAG contrast tester, and an ER-only inline editing layer on the
public page with a presentation toggle.

## 2. Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Stage model | Cumulative, stage-curated: each stage defines the primary section lineup; earlier stages' data stays reachable in a collapsed "Earlier steps" area. Nothing a client filled in ever becomes unreachable. |
| Stage movement | ER-only, both directions (rollback allowed). Client-facing stage-change emails fire on FORWARD moves only. |
| Live sync | Polling (~3.5 s while visible) against a cheap version endpoint; transport isolated behind one hook so SSE can replace it later without touching sections. |
| Acknowledgment | Anonymous (any token holder), remembered per-viewbook, logged to activity. ER can reset. |
| CSM | One global team roster; entries gain optional `isCsm` + `email`. Flagged people are EXCLUDED from the generic team block; each viewbook assigns one CSM who renders as a featured "your primary contact" card. |
| Team invites | Stored client-team list (name+email rows); fixed ER-authored invite template (no client-written body — the token can never be a spam relay); capped + throttled + activity-logged. |
| Strategy PDFs | Global playbook docs (uploaded once in settings) + per-viewbook extras. Doc cards replace the rendered copy blocks. |
| Brand editing | ER edits (inline layer), client watches via live sync. WCAG contrast tester visible to everyone. No new public theme-write surface. |
| The "gate" | The separate admin UI. Fix = ER inline editing layer on the public page calling the EXISTING cookie-gated admin routes; back-office editor remains for heavy ops. |
| Setup section | Org basics (mapped onto existing catalog fields — reuses the answers write path) + client notification emails (new, viewbook-level). |
| Client emails | ONLY on stage changes (+ team invites). No small-update client emails. The internal ER digest stays as-is. |
| Images | sharp → webp q90 on upload, input cap 10 MB, stored file always webp. Existing stored assets untouched. |
| Search | Client-side, over already-loaded viewbook data, `building` stage only. |
| Migration | Existing viewbooks → `building`; new viewbooks start at `post-contract`. |

## 3. Non-goals

- No client authentication/accounts (token stays the grant; acks are anonymous).
- No SSE/WebSocket transport in v2 (polling now; the hook is the seam).
- No public theme writes, no client file uploads.
- No section reordering UI; lineups are code-owned per stage.
- No backfill re-encoding of existing image assets.
- No AI/LLM API features (standing repo rule).
- No change to the v1 public-write fencing/caps model — v2 extends it.

## 4. Stage engine

`lib/viewbook/stages.ts` (client-safe, code-owned — the `SECTION_KEYS`
precedent):

```ts
type ViewbookStage = 'post-contract' | 'kickoff' | 'website-specifics' | 'building'
const STAGE_ORDER: ViewbookStage[] = [...]

type StageLineup = {
  primary: SectionKey[]   // main flow, in order
  carried: SectionKey[]   // rendered collapsed under "Earlier steps", in order
}
const STAGE_LINEUPS: Record<ViewbookStage, StageLineup>
```

New section keys (join the existing seven in `SECTION_KEYS`):
`pc-intro`, `pc-setup`, `pc-invite`, `pc-thanks`, `kickoff-next`, `ws-intro`.

Lineups:

| Stage | Primary | Carried |
|---|---|---|
| `post-contract` | pc-intro, pc-setup, pc-invite, data-source, pc-thanks | — |
| `kickoff` | welcome, milestones, strategy, kickoff-next | pc-setup, pc-invite, data-source |
| `website-specifics` | ws-intro, brand, assessment | welcome, milestones, strategy, pc-setup, pc-invite, data-source |
| `building` | welcome, milestones, data-source, brand, assessment, strategy, materials | pc-setup, pc-invite |

Stage-scoped sections (`pc-intro`, `pc-thanks`, `kickoff-next`, `ws-intro`)
appear only in their own stage — never carried. A section key absent from both
lists for the current stage does not render even if its DB row exists.
`state='hidden'` still suppresses a section everywhere (per-viewbook override,
unchanged). The v1 fault isolation per section is retained.

**Acknowledgment.** `ViewbookSection.acknowledgedAt DateTime?`. Ackable set =
`pc-setup`, `pc-invite`, `data-source` — and ack UI renders only while the
viewbook is in `post-contract`. Ack is a public write (fenced, idempotent —
re-ack of an acked section is a 200 no-op with no activity row); it collapses
the section for everyone and appends a `section-ack` activity row. `pc-intro`
never collapses. `pc-thanks` renders only when `pcCompletedAt` is set (below —
one-way, survives ack resets). ER can reset an ack (admin/inline, clears `acknowledgedAt`, activity
row). In later stages the three sections render in their normal
collapsed-carried form regardless of ack state.

**Post-contract completion.** The fenced ack transaction that acks the LAST
un-acked section also stamps `Viewbook.pcCompletedAt` (conditional on it being
null — first writer wins) and enqueues the CSM-completion email job after
commit. `pcCompletedAt` non-null is what reveals `pc-thanks`; an ER ack-reset
does NOT clear it (the thank-you state and email are one-way).

**Stage moves.** Cookie-gated `POST /api/viewbooks/[id]/stage`
`{direction: 'forward' | 'back'}` — fenced conditional update (current stage
re-checked in SQL; concurrent moves can't double-step), appends a
`ViewbookStageLog` row + `stage-change` activity row, bumps `syncVersion`.
Forward moves enqueue the stage-change client email job. The inline ER layer
and the admin Settings tab both call this route.

## 5. Data model (additive migration)

```prisma
// Viewbook — new columns
stage            String   @default("post-contract")
syncVersion      Int      @default(0)
csmName          String?             // roster name of the assigned CSM
clientNotifyJson String   @default("[]") // validated: ≤5 emails, each ≤254 B
pcCompletedAt    DateTime?
pcEmailSentAt    DateTime?           // CSM completion email marker (D7 pattern)

// ViewbookSection — new column
acknowledgedAt   DateTime?

model ViewbookTeamMember {
  id               Int      @id @default(autoincrement())
  viewbookId       Int
  viewbook         Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  name             String   // ≤120 B
  email            String   // ≤254 B, validated shape
  addedBy          String   // 'client' | operator email
  clientMutationId String?  @unique
  inviteCount      Int      @default(0)   // sends attempted (cap 3)
  invitedAt        DateTime?              // last successful send
  createdAt        DateTime @default(now())
  @@unique([viewbookId, email])           // no duplicate invitees
  @@index([viewbookId, id])
}

model ViewbookStageLog {
  id          Int      @id @default(autoincrement())
  viewbookId  Int
  viewbook    Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  stage       String   // stage ENTERED
  direction   String   // 'forward' | 'back'
  actor       String   // operator email
  emailSentAt DateTime? // stage-change client email marker (forward rows only)
  createdAt   DateTime @default(now())
  @@index([viewbookId, id])
}

model ViewbookDoc {
  id         Int      @id @default(autoincrement())
  viewbookId Int?     // NULL = global playbook doc; set = per-client extra
  viewbook   Viewbook? @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  title      String   // ≤160 B
  blurb      String?  // ≤512 B
  filename   String   // server-generated, under VIEWBOOK_ASSETS_DIR
  sortOrder  Int
  createdBy  String   // operator email
  createdAt  DateTime @default(now())
  @@index([viewbookId, sortOrder])
}
```

Roster (`ViewbookGlobalContent` key `'team'`) entry shape gains optional
`isCsm?: boolean` and `email?: string` — the ONE validator (`global-content.ts`)
extends; read stays exactly as strict as write; entries without the new keys
stay valid (additive). The generic team block filters `isCsm` out.
`csmName` assignment (admin/inline) validates against the current flagged
roster set; at render time a dangling `csmName` (member renamed/removed) hides
the CSM card rather than erroring, and the featured card degrades gracefully
when the roster is unavailable.

**Migration** (one additive migration): new columns + tables; sets
`stage='building'` for existing rows (raw UPDATE); INSERTs the six new
`ViewbookSection` rows (`state='active'`) for every existing viewbook (raw
INSERT…SELECT). Creation seeding (`service.ts`) adds the six new keys for new
viewbooks. Since lineups already decide what renders per stage, pre-seeded
future-stage rows are inert.

## 6. Live sync

- `Viewbook.syncVersion` is bumped (`syncVersion = syncVersion + 1`, manual
  `updatedAt`) by ONE additional statement inside every EXISTING mutating
  array-form transaction that touches the viewbook subtree — public writes
  (answers, amendments, feedback, materials, acks, team members, setup),
  operator writes (sections, fields, milestones, review links, theme, docs,
  overrides, content, stage moves, lock), and global-content saves bump every
  viewbook (`UPDATE Viewbook SET syncVersion = syncVersion + 1` unscoped —
  global content renders into all of them).
- Public `GET /api/viewbook/[token]/sync` → `{ v }` — single-row select through
  `requireViewbookToken`, `Cache-Control: no-store`, 404 contract identical to
  the other token routes. No other data leaves.
- `useViewbookSync(currentVersion)` hook (`components/viewbook/public/`):
  polls every ~3.5 s while `document.visibilityState === 'visible'`; pauses
  when hidden; exponential backoff on errors (max ~30 s); on `v` change →
  `router.refresh()`. **Edit guard:** a module-level focus/dirty registry —
  every editing island (FieldEditor, AmendmentForm, feedback, materials, team,
  inline ER editors) marks itself active while focused/dirty; the hook skips
  refresh while any editor is active and applies the pending refresh on
  release. Transport (poll vs future SSE) is fully encapsulated in the hook.
- Admin editor + inline ER layer reuse the same hook against the cookie-gated
  `GET /api/viewbooks/[id]` (which now returns `syncVersion`).

## 7. Public page composition & design pass

**Composition.** `loadViewbookPublicData` resolves the stage lineup: primary
sections render in the main flow; carried sections render inside a slim
"Earlier steps" band after the primary flow — collapsed by default, fully
functional when expanded (Q&A editing still obeys the v1 lock rules).

**Two-layer sections.** `SectionShell` v2 gives every section a *summary face*
(headline, one-line status, key number/visual — legible while scrolling) and a
*detail body*. Bodies auto-expand (animated) when the section enters the
viewport and contract when it leaves — UNLESS the section is acknowledged/done
(stays collapsed until deliberately opened) or the user has manually toggled
it (manual wins for the rest of the pageview). `IntersectionObserver`;
CSS transitions; `prefers-reduced-motion: reduce` disables all of it (sections
render expanded, static). Nested data presentation: per-category dropdowns in
Data Source, tooltips for who/when stamps, hover cards for team members.
Code-owned decorative SVG accents tinted via the existing `--vb-*` CSS vars.
The concrete visual language is driven through the frontend-design skill at
implementation; this spec pins behaviors, not pixels.

**Header + TOC rail.** Sticky header matures: client logo, stage name + stage
progress, CSM chip (photo + name + mailto). Floating right-edge TOC rail:
collapsed to dots; expands on hover/focus/tap with section labels + ack/done
checkmarks; click scrolls. Keyboard accessible (focusable, arrow navigation);
collapses to a bottom-sheet toggle on small screens. In `building` the rail is
verbose (Q&A categories as sub-entries) and gains **search**: client-side
fuzzy filter over a server-serialized index (section titles, Q&A
labels/values, milestone titles, material labels, doc titles) — selecting a
hit scrolls + flash-highlights the target. No server round-trip; the index
contains only data already rendered on the page.

**Per-stage sections (new):**

- **pc-intro** — high-level welcome to the process (global-content editable
  copy, new key `pc-intro`), never collapses, no ack button.
- **pc-setup** — org basics fields (school display name, primary contact
  name/email, phone, website URL) mapped onto DESIGNATED catalog `defKey`s
  (a `PC_SETUP_DEF_KEYS` const in `stages.ts`; any org-basics question not yet
  in the catalog — phone, website URL — is ADDED to it, additive contract, and
  reaches existing viewbooks via the normal sync-questions path) and written
  through the EXISTING answers PATCH (no new write path; they also appear in
  Data Source, same rows) + client notification emails (≤5) via the
  new `setup` route writing `clientNotifyJson`. The header's display name
  derives from the school-name field value, falling back to `Client.name`.
- **pc-invite** — stored team list (name+email), add → invite email sent;
  per-member re-send (cap 3 sends/member); ≤15 members. Renders "your team"
  with invite status.
- **data-source** — the existing Q&A section, positioned in this stage's flow;
  intro copy asks them to fill what they can before the kickoff call.
- **pc-thanks** — revealed when `pcCompletedAt` is set: "Thank you! We've
  received your information — adjust anything or add users; we look forward to
  starting." Orients latecomers without exposing filled forms unprompted.
- **kickoff-next** — dual-audience: verified ER session sees a "Ready for the
  next step?" CTA (calls the stage-move route, confirm dialog); non-ER viewers
  see "questions? contact {CSM}" outro with the CSM card. If the kickoff
  meeting stays on track the CSM pushes the stage live on the call.
- **ws-intro** — slim hero for the website-specifics stage (consistency).
- **strategy** (rebuilt) — PDF doc cards (title, blurb, page-count-free —
  metadata only what we store) for global playbook docs + per-viewbook extras,
  opening via the token asset route in a new tab. The v1 text blocks
  (base + override) render as a secondary collapsible under the cards, so
  existing content keeps working with zero data migration.
- **brand** (extended) — v1 palette/typography specimens + the WCAG tester
  (§9) + (ER-only) the inline theme editor (§10).

**Fault isolation, escaping, `no-store`, noindex** — all v1 behaviors hold.

## 8. Emails (all through `lib/notify/` transport, D7 rules)

New durable job type `viewbook-email` (registered concurrency 1, 3 attempts,
dedupKeyed per send, **no shared groups**), fired post-commit; a send failure
never fails the triggering write. All three kinds are marker-fenced
(read-marker → send → conditional stamp; at-least-once with a narrow dup
window — the D7/notify-email pattern). Dark env (Mailgun unset) = permanent
suppression, no stamp, no catch-up flood. All bodies HTML-escaped, fixed
templates, no client-authored content beyond escaped names/labels.

| Kind | Trigger | Recipient | Marker | dedupKey |
|---|---|---|---|---|
| `team-invite` | member add / re-send (public, capped) | the member's email | `invitedAt` + `inviteCount` (count bumped in the guarded reserve, stamp on send) | `vb-invite:<memberId>:<n>` |
| `pc-complete` | last post-contract ack | assigned CSM's roster email ?? `notifyAdminEmail()` | `Viewbook.pcEmailSentAt` | `vb-pc-complete:<viewbookId>` |
| `stage-change` | forward stage move | every address in `clientNotifyJson` (skip if empty) | `ViewbookStageLog.emailSentAt` on the log row | `vb-stage:<stageLogId>` |

Invite reserve is a guarded `INSERT … SELECT`/conditional-UPDATE (member cap
15, send cap 3) — never count-then-create; the public write throttle (v1
per-token guard) applies. Roster-email resolution for `pc-complete` happens at
send time; a missing/unset CSM email falls back to `notifyAdminEmail()`.
Stage-change emails are per-stage templates ("Your project has moved to …")
linking the viewbook. Re-entering a stage after a rollback emails again (new
log row) — ER controls cadence by controlling moves. The internal ER activity
digest (15-min) is unchanged.

## 9. Images, PDFs & the WCAG tester

**Image pipeline.** Add `sharp`. Upload flow (both asset routes): magic-byte
sniff (png/jpg/webp allowlist, SVG still rejected) → decode → re-encode
**webp quality 90** (alpha preserved) → atomic unique-temp+rename write.
Input cap raised to 10 MB (`MAX_ASSET_BYTES`); the stored file is always
`.webp` (server-generated filename). A sharp decode failure → 400
`invalid_image` (never a crash). Existing stored png/jpg files keep serving
unchanged (the serve route already sniffs stored bytes); no backfill.
sharp runs at upload time only — request path, not build path; prebuilt
binaries via `npm install` on the prod box (verify in the PR's deploy notes).

**PDF docs.** `MAX_DOC_BYTES = 20 MB`; `%PDF-` magic-byte sniff; stored under
the existing scoped dirs (`global/` for global docs, `<viewbookId>/` for
extras) with server-generated `.pdf` filenames. Cookie-gated CRUD:
`GET/POST /api/viewbook-docs` + `DELETE /api/viewbook-docs/[docId]` (global) and
`GET/POST /api/viewbooks/[id]/docs` + `DELETE …/docs/[docId]` (per-client) —
upload multipart, write-file → DB row → old-file delete on replace, orphan
cleanup on failed stamp (v1 asset rules). Public serving extends the EXISTING
token asset route's allowlist: a token may fetch filenames referenced by its
own themeJson + the global roster photos + **its own `ViewbookDoc` rows +
global doc rows** — served `application/pdf` + `nosniff` +
`Content-Disposition: inline`. Deletion seams (viewbook DELETE, client
cascade snapshot) extend to doc files.

**WCAG contrast tester.** `lib/viewbook/contrast.ts` — client-safe pure
`contrastRatio(hexA, hexB)` (WCAG 2.x relative-luminance formula; reuses the
theme luminance math). Brand section renders a live matrix of the theme's real
pairings (body on background, heading on brand bands, link on background,
button text on primary) each scored vs AA (4.5 normal / 3.0 large) and AAA
with pass/fail chips, plus a free pair-picker (two color inputs, client-side
only, nothing persisted). Updates live as ER edits the theme (live sync
refresh). Visible to everyone.

## 10. ER inline editing layer

The public page (already `force-dynamic`) additionally resolves
`getAuthSession()`; a **verified-email** session renders the operator layer
(the same bar `requireOperatorEmail` sets — break-glass password sessions do
NOT see it):

- Stage controls: advance/rollback with confirm (the §4 route).
- Per-section quick controls: hide/show, mark done, reset ack.
- Inline editors: welcome note, section intro/narrative, milestone quick edit
  (status/title/date), theme editor on the brand section (colors/fonts/logo —
  the §7 brand-editing flow), doc management on strategy, custom-field +
  answer editing affordances in Data Source (operator mode of the existing
  editors).
- **Presentation mode** toggle (floating, keyboard-accessible): hides the
  entire ER layer for screen-shares; persisted in `localStorage` per browser;
  a small unobtrusive re-enable affordance remains.

All inline controls call the EXISTING cookie-gated `/api/viewbooks/[id]/*`
routes — the public token surface gains nothing. The back-office
`/viewbooks/[id]` editor remains for heavy ops (token rotate/revoke, delete,
activity feed, feedback triage, sync-questions) and stays the fallback for
everything else. Server-side rendering of the ER layer keeps zero operator
data in the client payload for non-ER viewers.

## 11. Routes & middleware

**New public matchers (anchored, single-segment token — total goes 5 → 9):**

| Route | Method | Purpose |
|---|---|---|
| `^/api/viewbook/[^/]+/sync$` | GET | `{v: syncVersion}`. |
| `^/api/viewbook/[^/]+/ack$` | POST | `{sectionKey}` — ackable set only, fenced, idempotent no-op on re-ack; last-ack stamps `pcCompletedAt` + enqueues `pc-complete`. |
| `^/api/viewbook/[^/]+/team-members$` | POST | body-dispatched `{mode:'create', name, email, clientMutationId}` or `{mode:'resend', memberId}` — caps in SQL, invite job post-commit. |
| `^/api/viewbook/[^/]+/setup$` | PATCH | `{notifyEmails: string[]}` → validated `clientNotifyJson`. |

All four: `requireViewbookToken` preflight + commit-time fencing (token
current, not revoked, client active, section not hidden, row ownership),
JSON-content-type, same-site check in-handler, byte caps, the v1 per-token
write throttle, `Cache-Control: no-store`, `withRoute`-wrapped. Org-basics
answers ride the EXISTING `answers` matcher.

**New cookie-gated routes (default-gated, no middleware change):**
`POST /api/viewbooks/[id]/stage`, ack-reset (`DELETE /api/viewbooks/[id]/ack/[sectionKey]`),
CSM assignment (PATCH on the existing `[id]` route), docs CRUD (§9),
`GET/POST/DELETE /api/viewbook-docs[/…]` (global docs).

## 12. Security summary (delta over v1)

- Public surface grows by exactly four anchored matchers; every mutation keeps
  the v1 fencing/caps/idempotency/throttle/same-site/no-store contract.
- Client-triggered email is template-fixed (no client-authored body), capped
  in SQL (≤15 members, ≤3 sends each), throttled, activity-logged — the token
  cannot be weaponized as a spam relay; recipient addresses are validated and
  byte-capped.
- Stage moves and ALL inline editing are cookie-gated (verified email);
  the token grants no new write power.
- sharp decodes untrusted bytes AFTER magic-byte allowlisting; decode errors
  are caught (400); SVG remains rejected; stored output is server-encoded webp
  (re-encoding also strips metadata/EXIF).
- PDFs: magic-byte sniffed, size-capped, served only through the
  ownership+allowlist asset route with `nosniff` (+ `inline` disposition);
  filenames server-generated.
- `clientNotifyJson`/roster-email/`csmName` are strictly validated
  (shape + caps + membership) with read-as-strict-as-write parsers.
- The sync endpoint leaks a bare integer only, behind the same 404 contract.
- The ER layer renders server-side on verified sessions only — no operator
  data ships to anonymous viewers; presentation mode is cosmetic (client-side)
  and guards nothing.

## 13. Testing

Pure cores (vitest): stage catalog/lineup resolution (every stage × carried
rules × stage-scoped keys), ack state machine (ackable set, idempotent re-ack,
last-ack completion stamp, reset rules), thanks-reveal predicate, invite caps
+ reserve math, all three email markers (exactly-once, dark-gate, fallback
recipients), `clientNotifyJson`/roster/`csmName` validators,
`contrastRatio` (known WCAG reference pairs), webp pipeline (tiny fixture
images: png+alpha, jpg, webp passthrough, corrupt → reject), search index
builder, header display-name derivation.

DB-backed race tests: concurrent last-ack (one `pcCompletedAt` winner, one
email job), ack vs stage-move, ack vs revoke, invite cap under concurrency,
stage-move double-fire (fenced single step), syncVersion bump coverage across
EVERY mutating path (public + operator + global-content fan-out), doc
allowlist (own docs yes, other viewbook's docs 404, global docs yes).

Matcher anchoring tests (positive + deeper-path negative) for the four new
public routes. Gates: `tsc --noEmit`, `npm run lint`,
`DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`.

## 14. Retention & lifecycle

- New child models cascade from `Viewbook`; doc files join the deletion
  snapshots (viewbook DELETE + Client cascade route).
- `ViewbookStageLog` and `ViewbookTeamMember` are kept for the viewbook's
  life (tiny). Activity retention (180 d) unchanged.
- Global docs live until deleted in settings; deleting one removes the file.
- Deploy notes: `sharp` added to prod `npm install`; no new env vars; asset
  dir + backup expectations unchanged.

## 15. Increments (7 PRs, tandem lanes at plan time)

1. **Stage engine core** — migration (columns/tables/backfill), stage catalog,
   lineup resolution in public-data, stage-move route + log, ack route +
   completion stamp, creation seeding. Public page renders lineups (plain).
2. **Live sync** — syncVersion bumps across all write transactions, sync
   endpoint, `useViewbookSync` + edit-guard registry, adoption on public +
   admin.
3. **Post-contract stage** — pc-intro/setup/invite/thanks sections,
   `ViewbookTeamMember` + invite flow, `viewbook-email` job + all three email
   kinds + templates, `clientNotifyJson` setup route.
4. **Kickoff + docs** — `ViewbookDoc` + PDF pipeline + docs CRUD + asset-route
   allowlist extension, strategy doc cards, kickoff-next dual CTA, CSM
   roster flag/email + assignment + featured card.
5. **Website-specifics** — ws-intro, brand-section WCAG tester +
   `contrast.ts`, assessment placement.
6. **Design pass** — SectionShell v2 (summary face + scroll expand/collapse),
   matured header, floating TOC rail, building-stage verbose TOC + search,
   SVG accents, sharp/webp upload pipeline.
7. **ER inline layer** — session detection on the public page, inline
   controls, presentation mode toggle.

Each increment gate-green and deployable; middleware matchers land only with
their route. Cross-review both directions (Claude ↔ Codex); Codex on Sol High
until budget exhaustion → pause, Kevin triggers reset.

## 16. Future (explicitly out of v2)

- SSE transport behind `useViewbookSync`.
- Client-side identity (named acks/edits) if attribution pain shows up.
- Client-proposed palettes ("propose this palette" sandbox).
- PDF/print export; GSC/GA4 pulls into assessment.
