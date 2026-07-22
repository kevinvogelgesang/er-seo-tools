# Onboarding Viewbook Roadmap (2026-07-22)

**Status:** ACTIVE roadmap — brainstormed + decision-pinned with Kevin 2026-07-22; implementation starts in follow-on sessions.
**Tracker:** `docs/superpowers/todos/2026-07-22-onboarding-viewbook-tracker.md`
**Sibling (parked, NYI):** `2026-07-22-audit-actionability-roadmap.md` (SEO/ADA results-page actionability — deliberately split out of this roadmap).

## 1. Vision

The Viewbook becomes the **"Onboarding Viewbook"** — one client-facing onboarding surface that adapts to any combination of ER's onboarding offerings (**website builds, Virtual Adviser form builds, PPC management**). A client doing all three gets ONE viewbook whose sections compose the relevant subsections for each offering — never multiple viewbooks. Access is invitation-only (magic links). Content is template-driven and fully operator-editable, structured so a future ER-facing AI editing surface needs no big refactor.

Only **website** template content is built in this roadmap. VA + PPC section/subsection content is the NEXT roadmap — this one builds the machinery so those become content-entry work, not engineering.

## 2. Pinned decisions (Kevin, 2026-07-22)

These were resolved one-by-one in the brainstorm; do not re-litigate in build sessions.

| # | Decision |
|---|----------|
| D1 | **Assignment emails = global-quiescence debounce with per-person digests.** Clock resets on ANY assignment in the viewbook; after X minutes of no assignment activity, each member with un-notified assignments gets ONE digest listing all of them. Nobody is emailed mid-session; nobody gets a stale digest missing later assignments. |
| D2 | **Magic-link auth applies to non-ER participants only.** ER staff keep cookie auth (operator/admin) and can view any viewbook. |
| D3 | **Magic link sets a long-lived per-person session cookie (~60 d).** Link itself has a 7-day first-click validity, BUT an invited member can always re-request a fresh link from the viewbook landing page by entering their email — expiry never strands an invited person. No more anonymous/incognito viewers. |
| D4 | **All existing viewbooks are test-only.** Wipe/reseed is acceptable; no back-compat migration burden. Flip the auth + section model in one release. |
| D5 | **Multi-offering model:** viewbook carries offering flags (website/VA/PPC, any combination). Template sections contain offering-tagged template subsections; a viewbook pulls each template section that has ≥1 relevant subsection, containing only the matching subsections. |
| D6 | **A subsection is a content unit INSIDE a section** (copy + fields + asks with its own heading) — not a section variant. Sections stay the unit of navigation and acknowledgment. |
| D7 | **Completion/ack stays per-section.** Subsections carry their own completion state, surfaced as score-ring-style percent indicators per section — potentially one ring per offering when a section spans offerings. |
| D8 | **Template copy + company-wide global content merge into ONE template entity**, editable ONLY in its own admin panel (evolves `/viewbooks/settings`). **Copy-on-create:** a new viewbook snapshots the template content at creation and stays frozen to it by default; per-section "update to current global version" is an explicit pull. Inspector edits write the viewbook-local copy (per-viewbook divergence), never the template. |
| D9 | **Locks die; last write wins.** Unified append-only per-field revision history (client + ER entries in one timeline, each with name + timestamp; ER entries badged with an ER logo against name collisions). Accordion of prior versions per field; **restore-as-new-revision** action. Clients can edit field VALUES only — structure/copy/theme/milestones/separators stay ER-only. |
| D10 | **Stage machinery removed entirely:** admin Advance/Roll-back, `ViewbookStageLog`, stage-change emails (redundant — clients are on a CSM call at stage changes anyway). Milestones keep their own upcoming/current/done flow, decoupled. Separators take over visual grouping: ER-only, optional text label, no completion state, rendered in the ToC as non-clickable group labels. (b)/(c) may be iterated later. |
| D11 | **Rename is user-facing copy only.** Routes (`/viewbooks`, `/viewbook/[token]`), Prisma models, file names all keep `viewbook`. |
| D12 | **Confetti = `canvas-confetti`** (burst on milestone checkoff, `disableForReducedMotion`). confetti-js rejected (ambient falling effect, unmaintained). |
| D13 | **Generate Roadmap visibility toggle** (webapp settings lever) — captured in the sibling audit roadmap, not here. |
| D14 | **Promote-to-template:** any user-created (per-viewbook) section can be migrated into the template library. |
| D15 | **AI-editing readiness is conventions-only** (§6): no AI/LLM API integration is being built or unblocked (CLAUDE.md "Do not" stands); we shape the mutation surface so a future scoped editing agent is cheap. |

## 3. Current-state anchors (verified 2026-07-22)

- **Sections are a fixed code-owned catalog**: 13 keys (`SECTION_KEYS` in `lib/viewbook/theme.ts`), titles `components/viewbook/public/section-titles.ts`, reading copy `lib/viewbook/section-copy.ts`, Q&A catalog `lib/viewbook/catalog.ts` (append-only defKeys), order/visibility gated by `STAGE_LINEUPS` in `lib/viewbook/stages.ts` (4 stages). `ViewbookSection` rows store only per-viewbook state/introNote/narrative/ack.
- **Viewer:** `ViewbookShell.tsx` branches `viewerMode` `'continuous'|'collapse'` (continuous default since PR #245; collapse dormant but toggleable per-viewbook since PR #250). Continuous mode = lead section + `StageOverview` + primaries + `PreviousStages` + `ReadingProgressController`. Collapse morph variants are pure CSS keyed off `data-vb-morph`. Section ⓘ tooltips (PR #257) read `section-copy` content keys (`section-copy:<key>` namespace on `ViewbookGlobalContent`/`ViewbookContentOverride`).
- **Auth:** one shared `Viewbook.token`; anyone with the URL sees the viewbook. Invite rails exist: `ViewbookTeamMember` (name/email, 15 cap, `@@unique([viewbookId,email])`), `team-invite` Mailgun kind, `ViewbookEmailDelivery` ledger, durable `viewbook-email` job.
- **Locks:** `Viewbook.dataLockedAt`; fields with `createdAt <= dataLockedAt` are read-only baselines; client edits become `ViewbookFieldAmendment` rows (append-only, `clientMutationId` idempotency). Post-lock fields stay editable with `version` optimistic concurrency.
- **Inspector (Context Lens):** `OperatorLayer/inspector/` — `SectionOutline` (the sections panel, to be removed), `useSectionSelection` (IntersectionObserver scroll-spy, 24 px hysteresis — has the "topmost section not selected at top of page" bug), `SelectionContext` (activity/manual-nav pins), `InspectorPanes` (permanently mounted panes), `InlineEditors.tsx` (1138 lines — the big one), fit-canvas = manual toggle setting `data-vb-canvas-fit` on `<html>`.
- **Admin:** `ViewbookEditor.tsx` tabs; Settings tab has per-section state dropdowns + stage advance. Section ORDER and section ADDING do not exist anywhere (fixed catalog).
- **Emails:** Mailgun via `lib/notify/transport.ts`; viewbook digest job every 15 m (`viewbook-digest`).
- **Dormant, do not resurrect casually:** `collapsedShared` column + 410 `collapse/` route + `lib/viewbook/collapse.ts`; the stale `feat/vb-reading-experience` branch (design reference only).

## 4. Tracks and PRs

Every PR follows house discipline: worktree lane off fresh `origin/main`, spec → Codex review → plan → Codex review → TDD build → gates (`tsc --noEmit` + vitest + build) → PR → Codex pre-merge review where warranted → deploy → prod-verify. Wipe-and-reseed migrations are allowed (D4) but must still be real migrations.

### Track 1 — Foundation: template library & section model (Claude-led)

**F1. Template library data layer + template admin — ADDITIVE (Codex fix #1).**
New Prisma models: `SectionTemplate` (renderer type, default title/copy, sort) + `SubsectionTemplate` (offering tags — website/VA/PPC multi-tag, copy, field defs) + stable-keyed field definitions (a `FieldTemplate` equivalent — field defs are never anonymous array entries, or pull-from-template can't preserve answers). Absorbs THREE current content homes into one entity: code-owned section copy (`section-copy.ts`, `section-titles.ts`), the Q&A catalog (`catalog.ts`), and `ViewbookGlobalContent` (team/process/why/pc-intro/… keys, incl. PR #257's `section-copy:<key>` namespace). Renderer TYPES stay code-owned (content, fields/Q&A, milestones, invite, materials, feedback, docs…); templates select a type and carry validated content/config only — this is the AI-readiness spine (§6) and the seam that makes VA/PPC a content problem later.

F1 is **additive**: the legacy readers (`public-data.ts` resolve chain, `ViewbookGlobalContent`/`ViewbookContentOverride` routes) stay fully functional until F2 cuts over. The initial production templates are created by a **real migration (or one-time boot seeder)** — never a manually-invoked seed script that `prisma migrate deploy` won't run. Existing global rows + referenced assets (team photos etc.) are TRANSFORMED into templates, not discarded — "viewbooks are test-only" does not make the company roster/content disposable. Template admin panel evolves `/viewbooks/settings` (`GlobalContentEditor` grows into the template editor). Includes the **"What we need from you"** rename of the Data Source section (template copy). Acceptance bar: seeded website templates render byte-parity with today's defaults. Split into **F1a (schema + renderer registry + migration seed)** and **F1b (template admin UI)** if the spec confirms it's two PRs of work.

**Template/instance identity contracts (Codex fix #4 — bind every F-track spec):**
- Durable section/subsection/field identities are SEPARATE from code-owned renderer types — `rendererType` is never section identity. (Today `SectionKey` drives rendering, theme heroes, anchors, ack routes, inspector selection, ToC, and local collapse keys — custom sections and repeated renderer types break that; instances get their own durable keys.)
- Instances snapshot renderer type, title, content, offering tags, AND **template version**; rendering never depends on the current template row.
- A generic content/fields renderer exists for user-created sections.
- Sections and separators share ONE unambiguous total order (single order sequence, not two).
- Offerings are explicit booleans (or another validated representation) — no Prisma/SQLite scalar-list assumptions.
- Template FKs on instances are `SetNull` on template deletion — frozen instances must survive.

**F2. Viewbook instances + copy-on-create — the CUTOVER (Codex fixes #1, #5).**
`Viewbook.offerings` flags (set at creation, ER-editable later). Creation snapshots matching templates → per-viewbook section + subsection instance rows (own copy of all content + assets, order column); `ViewbookField` becomes subsection-instance-owned. F2 performs the atomic read-model cutover (viewer/admin/inspector read instances), THEN retires the legacy global/override routes and stores. Test viewbooks wiped/reseeded in the migration. `syncCatalogQuestions` is replaced by the pull action; `ViewbookContentOverride` collapses into instance content (instances ARE the override layer now).

Semantics the F2 spec must pin (Codex fix #5):
- **Pull ("update to current global version") is a versioned MERGE, not a JSON copy:** preserve field values, revisions, assignments, and completion for matching stable field/subsection keys; add newly-introduced definitions; ARCHIVE removed definitions (never delete history); explicit policy for local copy edits (overwrite with confirmation vs selective merge).
- **Offering enable/disable after creation:** enabling adds the missing sections/subsections via the same snapshot path; disabling preserves completed/answered offering-exclusive subsections as archived data (exact behavior = spec-time Kevin call, see §9).
- **Assets are truly frozen:** copying a filename is NOT a snapshot — current global team photos are mutable shared files deleted on replace (`global-content.ts`). Copy assets into viewbook scope, use immutable content-addressed assets, or add reference-aware retention.

**F3. Viewer rebuild — stages removed (Codex fixes #2, #8).**
Scope: ordered viewer + stage retirement + completion transition + pc-setup relocation. (Separator CREATION/reorder UI moved to F5b — F3 only teaches the viewer/ToC to RENDER separator rows: labeled dividers + non-clickable ToC group labels, D10c.) Sections render in instance order, **full width**, all visible from day one (completed sections stay in place — users never hunt for what they finished). Completed/acknowledged sections **grey out** with a **loud checkmark label on both collapsed and expanded heroes**. Current reveal/morph animations retained, now animating straight down. Removes: `STAGE_LINEUPS`/`stages.ts`, admin Advance/Roll-back, `ViewbookStageLog` writes, stage-change emails, `StageOverview`, `PreviousStages`, `EarlierSteps`, carried/origin grouping. `pc-setup` org-basics fields move into ER-only viewbook options (admin), out of the client-facing flow (original item 5.2). Milestones section keeps its own status flow, decoupled from viewing stages (D10b).

Two contracts the F3 spec must pin (Codex fix #8):
- **Post-stage completion:** `pcCompletedAt` currently requires stage `post-contract` + acks of `pc-setup`/`pc-invite`/`data-source` (`lib/viewbook/ack.ts`) and gates `pc-thanks` visibility + the pc-complete email. F3 must either replace it with a stage-free completion gate or remove `pcCompletedAt` + the pc-complete delivery + the `pc-thanks` gate. (Which — Kevin call at spec time, §9.)
- **Canonical seed order:** there is no single current "original order" — `SECTION_KEYS` and the four `STAGE_LINEUPS` disagree. The F1-seed/F3 spec lists the exact initial 13-section order explicitly.

**F4. Subsection completion + rings.** *(well-bounded → Codex lane; after F3)*
Per-subsection completion/ack state; score-ring-style percent indicator (reuse the SEO/ADA ring pattern) per section fed by subsection completion; per-offering rings when a section contains subsections from multiple offerings (D7). Section-level ack remains the single gate. Whether a multi-tag subsection counts toward EVERY matching offering's ring = spec-time Kevin call (§9).

**F5a. Inspector navigation/layout pass (Codex fix #2 split; after F3, independent of U3/U4).**
- `SectionOutline` panel removed; **scroll-spy alone** decides what the edit pane shows, with the topmost-section-at-top bug fixed (item 8.1's reported issue).
- Compact **section dropdown** in the inspector header (select → scrolls to section) — included outright rather than waiting on scroll-spy testing (original 8.2).
- **Fit-canvas becomes the permanent layout**: inspector sits in its own panel beside the canvas, never hovering over the page; the fit-canvas button is deleted (8.3).
- Selecting a block in the inspector **scrolls the page to that block + brief flash** (8.4).

**F5b. Content + structural mutation pass (Codex fix #2 split — converges on the 1,138-line `InlineEditors.tsx` and the same field surfaces as U3/U4, hence LAST in the dependency graph).**
- **Every field on the page is editable** in the inspector (8.5): all viewbook-local copy (section/subsection titles, body copy, headings) — writes to the instance copy per D8.
- **Add section above/below the selected section** (5.4/8.6); add/remove/reorder sections AND separators (creation + text editing) via inspector AND the admin page (5.3.1, D10c).
- Admin `ViewbookEditor` parity: order manipulation, add/remove sections, separator management, offering flags.

**F6. Promote-to-template.**
"Promote this section to the template library" (D14): copies a user-created section instance (with its subsections) into `SectionTemplate`/`SubsectionTemplate`, prompting for offering tags. Plus the AI-readiness conventions doc + a mutation-surface audit (§6) as the closing checklist of the track.

### Track 2 — Users & fields (Codex-led, parallel)

**U1. Magic-link auth — DB-backed, per-viewbook revocable (Codex fix #6).**
`/viewbook/[token]` becomes the LANDING page: invited-with-session → viewbook; stranger/expired → email prompt; entered email ∈ `ViewbookTeamMember` → fresh link sent (always works — D3), else a non-oracle "if this address was invited, a link is on its way" response. ER cookie auth exempt (D2). Middleware stays anchored single-segment regexes (house rule — never a `/viewbook/` prefix). Client writes stop being anonymous: member identity flows into `author`/`valueUpdatedBy`.

Invariants the U1 spec must pin:
- **Hashed opaque magic-link grants** (DB rows: `expiresAt` 7-day first-click, `consumedAt`) and **hashed opaque member-session rows** (~60 d, FK → `ViewbookTeamMember`); member deletion cascades session revocation. NOT stateless signed cookies — immediate revocation is a requirement.
- **Per-viewbook cookie isolation** that still works for `/api/viewbook/[token]/*` routes — one global member cookie would clobber access for a person on multiple viewbooks. `HttpOnly`, `Secure`, `SameSite=Lax`, host-only, `Path=/`; logout; expiry cleanup (runCleanup); rotation/revocation behavior stated.
- **One central `ViewbookPrincipal` resolver** (member / operator / dev-bypass / break-glass) — and EVERY token route (assets, sync, feedback, materials, answers, ack, team-members, setup) requires a principal. Middleware remains only the anchored bypass; authorization lives in handlers (today those routes are deliberately open pre-U1).
- **Unauthorized landing requests never call `loadViewbookPublicData`** — the current page loads the full payload before branching; the email-prompt path must not build or serialize viewbook data.
- **Durable, SQL-enforced rate limiting** on the email-request endpoint (per-address AND per-viewbook cooldown + volume caps, same non-oracle response) — a process-memory throttle is not enough for an email-spam surface.
- **Member removal doesn't exist today** — U1 (or U2) adds the removal mutation that exercises revocation.

**U2. Invite grid.**
"Invite your team" converts to a grid-style entry: **3 blank person rows visible by default** (name/email), an **"Add another person"** button appending rows; roster + resend as today. 15-member cap stays unless it fights the grid UX.

**U3. Field assignment + digest emails (Codex fixes #3, #7 — depends on F3, NOT free-floating).**
Anyone (client or ER) can **assign a field to a member**. Assignment state lives on `ViewbookField` (assignee member id); assignment/unassignment logged to `ViewbookActivity`. `ViewbookField` becomes subsection-instance-owned in F2 and the field rows are re-shelled in F3, so U3 sequences AFTER F3 (if it must start earlier, split backend from field-row UI).

D1's global-quiescence guarantee must be **race-safe** (Codex fix #7) — a naive `assignee + notified marker` sweep lets an assignment race between the sweep's read and the send, producing exactly the stale digest D1 forbids. Required shape (fits the existing durable `ViewbookEmailDelivery` + `viewbook-email` machinery):
- Every assignment mutation advances a per-viewbook **assignment epoch/version** + `lastAssignmentAt`.
- Digest delivery CREATION is conditionally fenced on that epoch still being quiet (`lastAssignmentAt < now − X`; X env-configurable, default ~15 min; sweep piggybacks the 15-min viewbook digest job or a dedicated `every:5m` schedule).
- Each per-member delivery row carries an immutable payload/cutoff + unique dedup key; the email job RE-CHECKS the epoch before sending and suppresses stale deliveries.
- Sent/suppressed delivery state (not a loose boolean on the field) owns retry/idempotency.

**U4. Revision inversion (after F3).**
Remove the lock system: `dataLockedAt`/`dataLockedBy`, locked-baseline read-only behavior, `AmendmentForm`/propose-a-change UI, the admin lock route. Every field: always editable, last write wins (optimistic `version` concurrency retained for simultaneous-edit safety), every write appends a revision row (repurpose/extend `ViewbookFieldAmendment` as the unified history — it is already append-only with `clientMutationId` idempotency). Revision rows store **immutable `authorKind` + `authorNameSnapshot`** (+ optional member FK) — never just today's `'client' | operator-email` string (Codex fix #6 tail). Per-field **accordion of prior versions** (value, author name, timestamp; ER entries badged with the ER logo — D9a). **Restore** = re-submit an old value as a new revision (D9b). Clients edit field values only (D9c).

### Small riders

- **S1. Rename** — all user-facing copy → "Onboarding Viewbook" (nav label, page titles, email subjects, headings). First PR; trivial; no route/model/file renames (D11).
- **S2. Confetti** — `canvas-confetti` burst on milestone checkoff, `disableForReducedMotion: true` (D12). Anytime; independent.
- **S3. ADA contrast pass** — WCAG contrast sweep of the full viewbook UI (viewer + inspector + admin), including the new greyed-out-section state (grey-out must not push text below 4.5:1). LAST PR, after the UI stops moving.

## 5. Sequencing

```
S1 (rename) — first, trivial
U1 (auth) ──► U2 (grid)            [parallel with F1/F2]
F1 (templates, additive) ──► F2 (instances + cutover) ──► F3 (viewer)
F3 ──► F4 (rings)      [independent after F3]
F3 ──► F5a (inspector nav/layout)  [independent after F3]
F3 ──► U3 (assign) ──► U4 (revisions) ──► F5b (structural mutation) ──► F6 (promote) ──► S3 (contrast)
S2 (confetti) — anytime
```

**Hard guards (Codex fix #3 — U3/U4 are NOT F-track-independent):**
1. **U1 lands before F3 starts** — both touch the public page entry (`app/(public)/viewbook/[token]/page.tsx`); auth-first is the cheap rebase direction.
2. **F-track is strictly serial through F3** (F1 → F2 → F3; each builds on the last's schema/cutover).
3. **The field chain is `F2 → F3 → U3 → U4 → F5b`** — `ViewbookField` becomes instance-owned in F2, its rows are re-shelled in F3, U3 adds assignment state, U4 rewrites the same row/history path, and F5b converges on those surfaces last.
4. U1/U2 run parallel with F1/F2; F4 and F5a hang off F3 independently.
5. S3 is last, full stop.

**Wave/session cadence:** one session per wave (per the tandem-wave model that worked for viewbook v1/v2): each session boots from the tracker + handoff, runs its lane(s), updates the tracker, stages the next handoff.

## 6. AI-editing readiness (conventions, not features)

Goal (Kevin, item 6): a future ER-facing "prompt an AI to edit this viewbook" surface — edit welcome copy, swap hero images from uploaded assets, insert a section — scoped to one viewbook, WITHOUT a big refactor when it comes. We are NOT building it, NOT adding any AI/LLM API, and NOT changing the project-level no-AI-API decision (D15). We bake in these conventions as F1–F6 land:

1. **Single mutation surface.** Every viewbook edit — content, structure, order, theme, assignment — goes through the existing admin/public API routes backed by typed service functions in `lib/viewbook/`. No mutation logic in React components. (Largely true today via `operator-api.ts`; keep it true for every new mutation, especially section add/reorder/separators.)
2. **JSON-serializable operations.** Each mutation is expressible as `{operation, target, payload}` with plain-data payloads — no function/closure params in service signatures. A future agent's tool surface = these operations verbatim.
3. **Stable addressability.** Sections/subsections/fields/separators are addressed by durable ids (instance ids + template keys), never by array position or display title.
4. **Uniform validation + concurrency.** Every operation validates server-side and respects `syncVersion`/`version` optimistic concurrency, so an automated caller can't corrupt state any more than a human can — and gets machine-readable 4xx codes back.
5. **Introspection cheapness.** `operator-data.ts` (or a successor) can serve a complete, self-describing snapshot of one viewbook (structure + content + editability flags) — the future agent's read surface.

F6 closes the track with an audit: enumerate every mutation route, confirm 1–4 hold, document the operation inventory in a short reference doc.

## 7. Codex utilization plan (60/40)

Kevin has **3 usage resets** available; when Codex hits its limit, Kevin resets and the session re-queues Codex (established pattern).

- **Codex builds:** U1, U2, U3, U4, F4 — the well-bounded lanes with crisp specs. Codex also reviews EVERY spec + plan (standing workflow) and pre-merge-reviews the risky F-track PRs (F2 schema/cutover, F3 viewer, F5b mutation).
- **Claude (+ subagents) builds:** F1 (a/b), F2, F3, F5a, F5b, F6, S1–S3 — the entangled/schema-heavy/design-heavy work.
- **Reset checkpoints (plan around, adjust live):** budget one Codex window ≈ U1 + reviews; reset #1 → U2 + reviews (U3/U4 now sit after F3 — fix #3); reset #2 → U3 + F4 + reviews; reset #3 → U4 + pre-merge reviews for F5a/F5b + slack. If a window dies mid-PR, the session parks Codex's lane with a handoff note in the tracker and continues Claude-side work — never idle-wait on a reset.
- Per-PR specs for Codex lanes must be self-contained (Codex works from `er-seo-tools-workflow` discipline + the spec; it does not carry this chat's context).

## 8. Next roadmap seeds (explicitly out of scope here)

- **VA + PPC template content** — author the actual Virtual Adviser and PPC section/subsection templates (content-entry once F1/F2 exist), including any offering-specific renderer needs discovered while authoring.
- **ER-facing AI editing surface** — gated on Kevin reopening the no-AI-API decision (roadmap tracker "Gated decisions"); §6 is its prerequisite work.
- **Audit actionability** — sibling roadmap doc (SEO triage + in-place per-page rescan for SEO **and** ADA + Generate-Roadmap toggle).
- Iterations flagged "may iterate later": milestone timeline presentation (D10b), separator ToC treatment (D10c), per-offering ring styling (D7).

## 9. Open questions — Kevin calls, resolve at the owning PR's spec time

From Codex's roadmap review (2026-07-22). Each belongs to a specific spec; none blocks starting U1/F1.

1. **(F1)** Is ER roster/team display data intentionally FROZEN into each viewbook (photos included, later staff changes don't propagate) — or should team content stay live-shared? Copy-on-create (D8) implies frozen; confirm that's wanted for the team section specifically.
2. **(F1/F3)** The exact canonical initial 13-section order (SECTION_KEYS vs STAGE_LINEUPS disagree today).
3. **(F2)** Disabling an offering after creation: completed/answered offering-exclusive subsections are preserved as archived data (recommended) — or removed?
4. **(F3)** Does `pc-thanks` keep a completion gate (stage-free replacement for `pcCompletedAt`) or become an always-visible final section?
5. **(F4)** Does a multi-tag subsection count toward EVERY matching offering's ring?
6. **(U1)** Do break-glass ER sessions (no email identity) get full operator exemption?
