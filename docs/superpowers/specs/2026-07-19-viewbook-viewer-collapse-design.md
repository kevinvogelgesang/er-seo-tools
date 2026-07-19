# Viewbook viewer-facing section collapse, hero done markers & overlay control — design

**Date:** 2026-07-19
**Status:** Draft (pre-plan)
**Branch:** `feat/vb-viewer-collapse`
**Author:** Claude (Opus 4.8) with Kevin

## 1. Problem & goals

The section-collapse feature that shipped in PRs #213/#214 is **operator-only** (a
button in the inline edit controls) and models collapse as one of four
mutually-exclusive `ViewbookSection.state` values (`active | done | collapsed |
hidden`). Kevin wants to evolve it into a viewer-facing feature:

1. **Anyone** (not just the operator) can collapse/expand a section, via a control
   **in the hero band** — no edit mode required.
2. A **two-layer** state: a *shared* default everyone sees, plus a *personal*
   per-viewer override.
   - Collapsing sets the shared default **for everyone**.
   - Re-opening (expanding) is **personal** to that viewer only.
3. Collapsed sections must **obviously read as expandable** — nobody should look at
   a collapsed hero and wonder what it is. This is a hard requirement.
4. **Done markers on every hero**: the existing green check, larger, shown on the
   hero band (visible whether the section is collapsed or expanded).
5. Collapsed heroes **shrink**, and the gradient/overlay is reworked so the section
   imagery reads through it instead of a hard color fade.
6. A **global (per-viewbook) header-overlay opacity** control, and a dropdown to pick
   which of three expand affordances is used — both on the **admin options page**
   (`/viewbooks/[id]`), not the inline live editor.
7. **Bug fix (bundled):** changing a section's state in the inline edit menu wedges
   the Context-Lens inspector so other sections can't be selected until a full page
   reload.

Non-goals: no change to the digest/email layer, stage model, or any section's
content schema. No new AI/API usage.

## 2. Background — current architecture (verified)

- `ViewbookSection.state` is a free `String` column (`prisma/schema.prisma`),
  default `"active"`. The collapse feature stored `"collapsed"` there without a
  migration.
- **Public page** (`app/(public)/viewbook/[token]/page.tsx`, `force-dynamic`) has two
  branches: an anonymous branch (token only) and an operator branch (verified email
  via `getOperatorEmailForPublicPage()`, which layers `OperatorViewbookLayer`).
  Public viewers are anonymous; they already perform **token-scoped writes** (ack,
  feedback, materials) through `/api/viewbook/[token]/*`.
- `SectionShell` (server component, `components/viewbook/public/SectionShell.tsx`)
  computes a display mode via `sectionDisplayMode()` and, for `state==='collapsed'`,
  renders **hero band only** (`heroOnly`) — suppressing the header strip
  (`TickDivider`) and the `SectionReveal` body.
- Hero gradient today is a fixed inline `linear-gradient(to top, var(--vb-primary)
  15%, transparent 70%)` over an `object-cover opacity-40` image.
- The done/ack green check (`✓`, `h-7 w-7`) lives in the **body summary face**
  (`SectionReveal`), which is *suppressed* when collapsed — so a collapsed done
  section currently shows no check at all.
- **Sync**: every domain write bumps `Viewbook.syncVersion` via
  `lib/viewbook/sync.ts` helpers inside array-form transactions; the public client
  polls `/api/viewbook/[token]/sync` and refetches when it advances.
- **Theme** (`lib/viewbook/theme.ts`) is a `themeJson` blob with a **strict
  whole-object validator**: `keys.length !== THEME_KEYS.length` → reject → degrade to
  `DEFAULT_THEME`. Adding keys to the theme would silently reset every existing
  stored theme. (This forces the config to live in columns — see §7.)
- **Inspector** (`OperatorLayer/inspector/`): `SectionActivityProvider` aggregates
  per-section `{dirty,busy,conflict,focused}` snapshots; `SelectionContext.select()`
  **fails closed** — a hard "activity" pin on section A makes selecting section B
  return `false`. `SectionQuickControls` reports `focused: focus.focused` to this
  registry (its "Fix #10"). See §9.

## 3. State model change

Collapse becomes **orthogonal** to the state enum so it can coexist with `done`.

### Schema
```prisma
model ViewbookSection {
  // ...
  state          String  @default("active") // 'hidden' | 'active' | 'done'
  collapsedShared Boolean @default(false)    // NEW: the shared collapse default
  // ...
}
```

### Migration (`npx prisma migrate dev --name viewbook_collapsed_shared`)
Additive column **plus** a data backfill so no shipped state is lost. Production
stops the app before `prisma migrate deploy` runs, so there is **no old-process
write race** (Codex FIX-COLLAPSE-MIGRATION). The backfill must (a) set
`updatedAt` explicitly (raw SQL bypasses `@updatedAt`), and (b) bump
`syncVersion` + `updatedAt` on every affected **parent** `Viewbook` so browsers
already open at deploy time refetch and pick up the new render path:
```sql
ALTER TABLE "ViewbookSection" ADD COLUMN "collapsedShared" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ViewbookSection"
  SET "collapsedShared" = true, "state" = 'active', "updatedAt" = <now-ms>
  WHERE "state" = 'collapsed';
UPDATE "Viewbook"
  SET "syncVersion" = "syncVersion" + 1, "updatedAt" = <now-ms>
  WHERE "id" IN (SELECT DISTINCT "viewbookId" FROM "ViewbookSection" WHERE "collapsedShared" = true);
```
(Prisma migration SQL can't bind `Date.now()`; the migration writes a literal
epoch-ms constant stamped when the migration file is authored — acceptable for a
one-shot backfill.) After this, `state` only ever holds `hidden | active | done`.
The `'collapsed'` value is retired from the enum everywhere (§5). **No
expansion-regression window** — see the revised PR ordering (§11): the same PR
that runs this migration also teaches the renderer to honor `collapsedShared`.

## 4. Two-layer collapse semantics

**The personal override is one-valued: `'expanded'` or absent.** There is no
`'collapsed'` localStorage value (it would have no writer — Codex
FIX-COLLAPSE-RECONCILIATION). Effective collapse for a viewer:

```
effectiveCollapsed = (personalOverride === 'expanded') ? false : collapsedShared
```

| Actor            | Collapse action                                   | Expand action                                        |
|------------------|---------------------------------------------------|------------------------------------------------------|
| Anonymous client | server write `collapsedShared=true` + **clear** local override | set local override `='expanded'` (no server write)   |
| Operator         | server write `collapsedShared=true` + clear local override      | server write `collapsedShared=false` + clear local override |

**Definition of "everyone" (resolves the FIX-1 contradiction, simpler branch):**
`collapsedShared` is the collapse state seen by **every viewer who has not set a
personal `expanded` override**. A viewer's personal expand is sticky — it persists
across shared collapses. So "collapsing sets it for everyone" means *everyone
without their own expand override*; the override-holder is the deliberate
exception. This is Kevin's literal model. (An alternative — a per-section
`collapseRevision` that invalidates a stale personal expand whenever a **new**
shared collapse occurs, so a deliberate re-collapse re-tidies for everyone — is
noted here as a possible refinement Kevin can request at review; the default is the
simpler sticky-override model, no extra column.)

Rationale for the operator asymmetry (**Kevin-approved 2026-07-19**): Kevin's rule
("expand is personal") gives clients no path to un-collapse a section for everyone,
so the shared default could get stuck collapsed permanently. Rather than add a
separate operator button (Kevin wants the buttons *removed*), the **operator's hero
chevron is the shared-reset path** — it writes `collapsedShared` in both directions.
Clients remain collapse-shared / expand-personal.

- localStorage key: `vb:collapse:<viewbookId>:<sectionKey>` → `'expanded'` (present)
  or the key is **removed** (absent). Mirrors the existing `vb-presentation-mode`
  localStorage pattern (`PresentationToggle.tsx`).
- **Clear-on-collapse** matters: if a client had `override='expanded'` and then clicks
  collapse, we must remove the override, else the click would appear to do nothing.
- **Reconciliation effect (FIX-1):** `router.refresh()` / a sync-refetch preserves
  the client island's `useState`, so `useState(collapsedShared)` only covers first
  hydration. The island runs an effect that re-derives `effectiveCollapsed` whenever
  the `collapsedShared` prop changes — **guarded off while a write this island issued
  is still pending** (so a refetch mid-write doesn't clobber the optimistic state).
  Viewers **with** an `expanded` override keep it; viewers **without** follow the new
  shared value.
- **Concurrency (FIX-2):** concurrent operator-expand (`collapsedShared=false`) and
  anonymous-collapse (`collapsedShared=true`) are **last-commit-wins** at the DB; each
  viewer converges via the sync-refetch. Explicitly accepted; no locking.

## 5. Server: retire `'collapsed'` state + shared-collapse write

### Retire the enum value — full audit (FIX-COLLAPSE-MIGRATION)
Remove/adjust `'collapsed'` in **all** of:
- `lib/viewbook/service.ts` — `setSectionState` union + validation (drop
  `'collapsed'`, drop the `sectionSupportsCollapse` collapse branch).
- `lib/viewbook/operator-data.ts` — `OperatorSectionData.state` union + row mapping;
  add `collapsedShared: boolean`.
- `lib/viewbook/public-data.ts` — `toPublic` mapping (line ~72 `s.state === 'collapsed'`
  branch) + add `collapsedShared`.
- `lib/viewbook/public-types.ts` — `PublicSection.state` union + add `collapsedShared`.
- `lib/viewbook/section-display.ts` — delete the `hero-collapsed` mode.
- `components/viewbook/public/OperatorLayer/inspector/SectionOutline.tsx` — STATE_PILLS
  "Collapsed" pill.
- `components/viewbook/public/OperatorLayer/SectionQuickControls.tsx` — Collapse/Expand
  buttons + `state === 'collapsed'` branch (§10).
- `app/api/viewbooks/[id]/sections/[sectionKey]/route.ts` — operator PATCH validator.
- `components/viewbook/admin/ViewbookEditor.tsx` — any section-state dropdown/option.
- `lib/viewbook/toc-index.ts` — any `collapsed`-aware branch.
- All fixtures/tests + code comments referencing the `'collapsed'` state.

`PublicSection` and `OperatorSectionData` gain `collapsedShared: boolean`.

### New public route: `POST /api/viewbook/[token]/collapse`
Body `{ sectionKey: string, collapsed: boolean }`. Preflight chain in the ack-route
order: `requireSameSite` → `requireJsonContentType` → `requireViewbookToken` →
`checkWriteThrottle` → `readBoundedJson` (small cap) → core.

- **Dedicated throttle bucket (FIX-COLLAPSE-THROTTLE):** collapse uses its own keyed
  bucket, `checkWriteThrottle(\`collapse:${token}\`)`, so cosmetic collapse spam can't
  starve the shared ack/material/setup bucket. (Confirm `checkWriteThrottle` accepts a
  key arg during plan; if not, add one.)
- **Operator auth (FIX-COLLAPSE-AUTH-FENCE):** resolve operator status
  **request-scoped** inside the route (a `requireOperatorEmail`-style read of the auth
  cookie in the handler, not page-ambient state), pass `isOperator` to the core. The
  core throws `403 operator_required` when `collapsed === false && !isOperator`. An
  anonymous caller can therefore never set `collapsed:false` — pinned by route + core
  tests.

Core (`setSectionCollapsedShared(viewbook, token, { sectionKey, collapsed, isOperator })`
in a new `lib/viewbook/collapse.ts`):
- Validate `sectionKey` is real and `sectionSupportsCollapse(sectionKey)` (still
  excludes `pc-intro`/`pc-thanks`); else `400 invalid_section`.
- **Full self-contained commit predicate (FIX-COLLAPSE-AUTH-FENCE):** the array-form
  `$transaction` UPDATE's `WHERE` reasserts, in one self-contained predicate, that the
  token is current + not revoked, the client is not archived, the section is
  visible/collapse-allowed, **and** `collapsedShared` actually changes value. The
  `syncVersionBumpWhere` companion carries the **same** predicate and is placed before
  the UPDATE (the established fence-sharing pattern). Assert matching row counts; a
  no-op set bumps nothing (ack replay contract). Raw SQL stamps `updatedAt` with
  `Date.now()`.
- Response `200 { collapsedShared }`, `Cache-Control: no-store`.

Middleware: `/api/viewbook/[token]/*` is already public; no new matcher needed —
the new segment lives under the existing token prefix. (Confirm during plan.)

## 6. Client rendering — `CollapsibleSection` island

`SectionShell` stays a server component that computes props (title, heroUrl,
`collapsedShared`, `isDone`, `doneAt`, `affordance`, `overlayStrength`,
`isOperator`, `viewbookId`, `token`, `summaryFace`) and delegates the hero + body to
a new **`CollapsibleSection`** client island (`components/viewbook/public/`). Only
serializable props + server-rendered nodes cross the RSC boundary (never a function),
preserving the Wave-4 P1 invariant.

Island behavior:
- `collapsed` state seeds from the `collapsedShared` prop at mount (SSR and first
  client render agree → **no flash for the common no-override case**). A mount effect
  reads localStorage; if an `expanded` override exists it wins. Viewers *with* an
  override may see one paint before the flip — acceptable, cosmetic; an anti-FOUC
  inline script is explicitly out of scope.
- **Prop reconciliation effect (FIX-1):** a second effect re-derives
  `effectiveCollapsed` whenever the `collapsedShared` prop changes on refetch, guarded
  off while this island's own write is pending (see §4).
- Always renders the hero band (image + overlay + title + **done check**, §7/§8) and
  the body; collapse only toggles visibility, so there is no server/client structural
  mismatch.
- **Collapsed:** shrunken hero (§8) + the chosen affordance; header strip + body
  hidden. Reuse `SectionReveal`'s `inert` + `aria-hidden` + grid-rows clipping so
  clipped content leaves the tab order + a11y tree, **plus the repo's older-browser
  visibility fallback** (a `visibility:hidden`/`display` guard for engines that don't
  honor `inert`) so controls can never remain tabbable while collapsed
  (FIX-COLLAPSE-NAVIGATION-A11Y).
- **Expanded:** full hero + `TickDivider` strip + `SectionReveal` body + a "Collapse"
  control in the strip.
- **`vb:navigate` force-open (FIX-COLLAPSE-NAVIGATION-A11Y):** the server-built
  TOC/search cannot know a viewer's local override, so its nested anchors are **always
  emitted**. The island listens for the `vb:navigate` CustomEvent (and the initial
  `location.hash`) targeting its `sectionKey`; on match it force-expands **then**
  scrolls — otherwise a personally-collapsed section a viewer navigates to would stay
  hidden. (Same channel `SectionReveal` already honors.) A `vb:navigate` force-open is
  a local view change only; it does **not** write `collapsedShared`.
- **Actor-specific affordance copy (FIX-ACTOR-AFFORDANCE):** the expand affordance's
  accessible name reflects scope — operator: "Expand (visible to everyone)"; client:
  "Expand (just for you)". The collapse control is "Collapse for everyone" for both
  actors (collapse is always shared). Controls are **disabled/serialized while a POST
  is pending**.
- Click handlers implement the §4 table. Server writes go to `POST
  /api/viewbook/[token]/collapse` via the existing public fetch helper; on success the
  sync poll propagates `collapsedShared` to other tabs. Optimistic local flip with
  rollback on error (ack-control pattern).

### Three affordances (all implemented; picked by `collapseAffordance`)
- `bar` — full-width labeled bar across the bottom of the shrunken hero
  (`⌄ Expand this section`). Whole hero also clickable.
- `pill` — labeled corner pill (`Expand ⌄`). Whole hero clickable.
- `chevron` — chevron icon only.
All three carry an accessible name (`aria-expanded`, `aria-controls`) and a visible
label except `chevron` (which gets an `aria-label`).

## 7. Config on the admin options page

Two new **`Viewbook` columns** (NOT in `themeJson` — see §2 validator hazard):
```prisma
model Viewbook {
  // ...
  collapseAffordance String @default("bar")  // 'bar' | 'pill' | 'chevron'
  heroOverlayStrength Int   @default(55)      // 0..100
}
```
- **One shared sanitizer (FIX-PRESENTATION-CONFIG):** a single client-safe
  read/write helper (e.g. `parsePresentationConfig` next to the theme kit) owns the
  defaults + validation for both fields — `affordance ∈ {'bar','pill','chevron'}`
  (else default), `heroOverlayStrength` must be a **finite integer** before clamping
  to `[0,100]` (reject `NaN`/`Infinity`/non-number → 400, don't silently coerce). Read
  is exactly as strict as write (the repo convention). `PATCH /api/viewbooks/[id]`
  updates both settings **atomically** and bumps `syncVersion` **exactly once**.
- Flowed into `ViewbookPublicData` and `OperatorViewbookData` (loaders), then into
  `SectionShell` props.
- **Overlay consumption + minimum scrim (FIX-PRESENTATION-CONFIG):** `SectionShell`
  sets a CSS var (e.g. `--vb-hero-overlay: <0..1>`) and the hero gradient interpolates
  its stops from it, so low = image reads through, high = brand color dominates. The
  same var drives the collapsed hero. **A non-configurable minimum scrim floor** is
  applied under the title/done-check band so `heroOverlayStrength=0` can never render
  `--vb-on-primary` text illegibly over arbitrary photography — the slider varies the
  overlay *above* that floor, never below it.
- **UI:** a dropdown (affordance) + a range slider (overlay) in `ViewbookEditor`
  near `ThemeEditor`, saved via `PATCH /api/viewbooks/[id]`, existing `onSaved`
  reload. A tiny live preview swatch is nice-to-have, not required.

## 8. Done marker + collapsed hero visuals

- **Done check on the hero:** when `state==='done'`, render a large green check
  (`var(--vb-secondary)` / `var(--vb-on-secondary)`) in the hero corner, sized to fit
  (~`h-11 w-11`), with the existing `vb-pop` entrance animation (reduced-motion
  guarded). Visible in both collapsed and expanded states.
- **Body badge retained:** when expanded, the existing "Completed {date}" badge stays
  in the body summary face (Kevin's pick). So a done+expanded section shows the check
  twice — once on the hero, once with its date in the body — by design.
- **Collapsed hero shrinks:** reduced `min-h` versus the expanded hero; title steps
  down a size; the overlay uses the §7 strength so the image is visible.
- Ack-collapsed (`post-contract` acknowledged) styling is unaffected — it remains a
  body-face treatment; it is independent of `collapsedShared`.

## 9. Inspector bug fix

**Symptom:** after changing a section's state in the inline edit controls, the
inspector is stuck on that section — other sections can't be opened until reload.

**Root cause:** `SectionQuickControls` reports `focused: focus.focused` to the
per-section activity registry (`useReportSectionActivity`, its "Fix #10"). These are
discrete mutations whose buttons **unmount while focused** (Reset-ack unmounts its own
button; the old Collapse↔Expand swap unmounts the clicked button). When a focused
element unmounts, the container's `onBlur` never fires, so `focus.focused` sticks
`true` forever → the section keeps a hard "activity" pin → `SelectionContext.select()`
fails closed for every other section → only a reload (which resets the provider)
escapes. The same file already documents this exact hazard for the *sync* activity
registry and deliberately registers `busy` alone there.

**Fix:** report **busy-only** to the per-section activity registry too — drop
`focused` from the `useReportSectionActivity` snapshot in `SectionQuickControls`
(`{ dirty:false, busy, conflict:false, focused:false }`). Focus-pinning is
low-value for these draft-less discrete controls; content editors (which have real
drafts) keep their own dirty/focus reporting. Removing the operator Collapse/Expand
buttons (§5/§10) also eliminates one unmount trigger, but the busy-only fix is the
root-cause repair and covers Reset-ack too. Codex (FIX-INSPECTOR-DISCRETE-PIN)
confirms this is the correct root-cause repair, not masking.

**Regression test (must assert all three):** while `busy=true` the section IS
pinned; after the write settles the pin **releases even when the focused button
unmounts** (the Reset-ack / label-swap case); and a **different** section can then be
selected (`SelectionContext.select(other)` returns `true`).

## 10. Operator control cleanup

Per Kevin: **remove** the operator-only Collapse/Expand buttons from
`SectionQuickControls` (and the `state === 'collapsed'` branch / Expand button). The
in-hero chevron now serves everyone, including the operator (with §4 shared-both
semantics). `SectionOutline`'s STATE_PILLS drops the "Collapsed" state pill; a
lightweight "collapsed (shared)" hint may be derived from `collapsedShared` if useful,
but is optional.

## 11. PR decomposition

**Ordering constraint (FIX-COLLAPSE-MIGRATION):** the migration converts
`state='collapsed'` → `active`, so the SAME PR that runs the migration **must** teach
the renderer to honor `collapsedShared` — otherwise every previously-collapsed
section expands for the window between that deploy and a later render PR. PR1 below
therefore bundles the migration with a **transitional server-only renderer** (hero
band only when `collapsedShared`, preserving today's affordance-less look); PR3 then
layers the interactive viewer control + affordances on top.

1. **Schema + retire enum value + transitional renderer.** Migration + backfill
   (updatedAt + parent syncVersion bump); `collapsedShared` on the models + loaders;
   full `'collapsed'` retirement audit (§5 list); `SectionShell` renders hero-only
   when `collapsedShared` (server-only, no viewer control yet — no expansion
   regression). Gates green.
2. **Shared-collapse write.** `lib/viewbook/collapse.ts` +
   `POST /api/viewbook/[token]/collapse` (dedicated throttle bucket, request-scoped
   operator gate on shared-expand, full self-contained commit predicate shared by
   update + sync bump, idempotent). Route + service tests.
3. **`CollapsibleSection` island + `SectionShell` restructure.** Three affordances,
   actor-specific accessible names, overlay var + min-scrim floor, done-check-on-hero
   + retained body badge, personal `expanded` override, prop-reconciliation effect,
   `vb:navigate` force-open, optimistic write, disable-while-pending. Component tests.
4. **Options-page config.** `collapseAffordance` + `heroOverlayStrength` columns, one
   shared sanitizer, `PATCH /api/viewbooks/[id]` atomic dual-update + single
   syncVersion bump, loader plumbing, editor UI.
5. **Inspector focus-pin bugfix** (busy-only, with the three-assertion regression) +
   operator Collapse/Expand button removal (§10).

Each PR is independently shippable and passes `tsc --noEmit` + vitest +
`npm run build`. PRs 1→3 are ordered (3 depends on 1's props/renderer and 2's route);
4 and 5 are independent and can land in any order relative to 3.

## 12. Testing

- **Service (`collapse.ts`):** shared set true/false; operator-gate on expand
  (`403 operator_required` for anonymous `collapsed:false` — pinned test);
  allowlist rejection for bookends; idempotent no-op does not bump syncVersion;
  value-change does; commit predicate rejects a revoked-token / archived-client /
  hidden-section write (row count 0, no bump).
- **Route:** preflight chain (same-site, content-type, **dedicated `collapse:${token}`
  throttle bucket** — collapse spam does not consume the shared ack bucket), token
  validation, operator vs anonymous (anonymous `collapsed:false` → 403).
- **`CollapsibleSection`:** effective = (`override==='expanded'`) ? expanded : shared;
  client collapse writes + **clears** override; client expand is local-only (no
  fetch); operator expand fetches `collapsed:false`; **prop-reconciliation** — a new
  `collapsedShared` prop flips an override-less viewer but not an override-holder, and
  is suppressed while a write is pending; **`vb:navigate`** force-expands a
  personally-collapsed section; affordance variants render with actor-specific
  accessible names; controls disabled while pending; done check shows collapsed and
  expanded.
- **Migration/backfill:** a fixture row at `state='collapsed'` becomes
  `state='active', collapsedShared=true` with `updatedAt` set and the parent
  `Viewbook.syncVersion` bumped.
- **Config sanitizer/route:** affordance enum rejection; non-finite overlay rejected
  (not coerced); overlay clamp `[0,100]`; atomic dual-update bumps syncVersion once;
  `heroOverlayStrength=0` still renders the minimum scrim (title/done-check legible).
- **Inspector regression (three assertions, §9):** pinned while `busy=true`; pin
  releases after settlement even when the focused button unmounts; a *different*
  section is then selectable (`select(other)` returns `true`). The guard against
  re-introducing the wedge.

## 13. Risks & mitigations

- **Anonymous writes to a shared value.** Cosmetic only (collapse state); reuses the
  existing token + same-site + throttle guards; shared-expand is operator-gated. Abuse
  ceiling is "a section is collapsed for everyone," reversible by any operator.
- **Override flash** for viewers whose personal override differs from shared — one
  paint, cosmetic, accepted.
- **Theme validator regression** avoided by using columns, not `themeJson`.
- **Migration on prod** runs via `prisma migrate deploy`; the backfill `UPDATE` is
  idempotent and scoped to `state='collapsed'`.
