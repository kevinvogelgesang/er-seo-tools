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
Additive column **plus** a data backfill so no shipped state is lost:
```sql
ALTER TABLE "ViewbookSection" ADD COLUMN "collapsedShared" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ViewbookSection" SET "collapsedShared" = true, "state" = 'active' WHERE "state" = 'collapsed';
```
After this, `state` only ever holds `hidden | active | done`. The
`'collapsed'` value is retired from the enum everywhere (§5).

## 4. Two-layer collapse semantics

**Effective collapse for a viewer** = `personalOverride ?? collapsedShared`,
where `personalOverride ∈ {'collapsed','expanded', absent}` in localStorage.

| Actor            | Collapse action                                   | Expand action                                        |
|------------------|---------------------------------------------------|------------------------------------------------------|
| Anonymous client | server write `collapsedShared=true` + **clear** local override | set local override `='expanded'` (no server write)   |
| Operator         | server write `collapsedShared=true` + clear local override      | server write `collapsedShared=false` + clear local override |

Rationale for the operator asymmetry (**Kevin-approved 2026-07-19**): Kevin's rule
("expand is personal") gives clients no path to un-collapse a section for everyone,
so the shared default could get stuck collapsed permanently. Rather than add a
separate operator button (Kevin wants the buttons *removed*), the **operator's hero
chevron is the shared-reset path** — it writes `collapsedShared` in both directions.
Clients remain collapse-shared / expand-personal.

- localStorage key: `vb:collapse:<viewbookId>:<sectionKey>` → `'collapsed' | 'expanded'`.
  Mirrors the existing `vb-presentation-mode` localStorage pattern
  (`PresentationToggle.tsx`).
- **Clear-on-collapse** matters: if a client had `override='expanded'` and then clicks
  collapse, we must clear their override, else `override ?? shared` would keep showing
  expanded and the click would appear to do nothing.
- When a refetch delivers a new `collapsedShared`, viewers **with** an override keep it;
  viewers **without** one follow the new shared value.

## 5. Server: retire `'collapsed'` state + shared-collapse write

### Retire the enum value
Remove `'collapsed'` from: `setSectionState` union + validation
(`lib/viewbook/service.ts`), `OperatorSectionData.state` / `PublicSection.state`
unions, `operator-data.ts` + `public-data.ts` mappings, `section-display.ts`
(`hero-collapsed` mode deleted), `SectionOutline` STATE_PILLS. `PublicSection` and
`OperatorSectionData` gain `collapsedShared: boolean`.

### New public route: `POST /api/viewbook/[token]/collapse`
Body `{ sectionKey: string, collapsed: boolean }`. Preflight chain identical to the
ack route (load-bearing order): `requireSameSite` → `requireJsonContentType` →
`requireViewbookToken` → `checkWriteThrottle` → `readBoundedJson` (small cap) → core.

Core (`setSectionCollapsedShared(viewbook, token, { sectionKey, collapsed, isOperator })`
in a new `lib/viewbook/collapse.ts`):
- Validate `sectionKey` is a real key and `sectionSupportsCollapse(sectionKey)` (still
  excludes `pc-intro`/`pc-thanks`); else `400 invalid_section`.
- **Authorization:** `collapsed === false` (shared-expand) requires a verified
  operator. The route resolves operator status via `getOperatorEmailForPublicPage()`
  and passes `isOperator`; the core throws `403 operator_required` when
  `!collapsed && !isOperator`. `collapsed === true` is allowed for any token-holder.
- Idempotent set: array-form `$transaction` — an `UPDATE ... SET collapsedShared=?,
  updatedAt=? WHERE viewbookId=? AND sectionKey=?` plus a **fence-shared**
  `syncVersionBumpWhere` predicated on the row actually changing value (so a no-op
  set bumps nothing, matching the ack replay contract). Raw SQL sets `updatedAt`
  manually (`Date.now()`), per the array-form-only rule.
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
  reads localStorage; if an override exists it wins. Viewers *with* an override may
  see one paint before the flip — acceptable, cosmetic; an anti-FOUC inline script is
  explicitly out of scope.
- Always renders the hero band (image + overlay + title + **done check**, §7/§8) and
  the body; collapse only toggles visibility, so there is no server/client structural
  mismatch.
- **Collapsed:** shrunken hero (§8) + the chosen affordance; header strip + body
  hidden (reuse `SectionReveal`'s inert/`aria-hidden`/grid-rows clipping so clipped
  content leaves the tab order + a11y tree).
- **Expanded:** full hero + `TickDivider` strip + `SectionReveal` body + a "Collapse"
  control in the strip.
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
- Validated + clamped server-side in `PATCH /api/viewbooks/[id]`
  (`app/api/viewbooks/[id]/route.ts`): affordance ∈ the literal set (else 400);
  overlay clamped to `[0,100]`.
- Flowed into `ViewbookPublicData` and `OperatorViewbookData` (loaders), then into
  `SectionShell` props.
- **Overlay consumption:** `SectionShell` sets a CSS var (e.g.
  `--vb-hero-overlay: <0..1>`) and the hero gradient interpolates its stops from it,
  so low = image reads through, high = brand color dominates. The same var drives the
  collapsed hero (satisfying "gradient adjusted so imagery isn't just hard color").
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
root-cause repair and covers Reset-ack too.

## 10. Operator control cleanup

Per Kevin: **remove** the operator-only Collapse/Expand buttons from
`SectionQuickControls` (and the `state === 'collapsed'` branch / Expand button). The
in-hero chevron now serves everyone, including the operator (with §4 shared-both
semantics). `SectionOutline`'s STATE_PILLS drops the "Collapsed" state pill; a
lightweight "collapsed (shared)" hint may be derived from `collapsedShared` if useful,
but is optional.

## 11. PR decomposition

1. **Schema + retire enum value.** Migration + backfill; `collapsedShared` on the
   models; remove `'collapsed'` from every state union / mapping / display path;
   `PublicSection`/`OperatorSectionData` gain `collapsedShared`. Gates green.
2. **Shared-collapse write.** `lib/viewbook/collapse.ts` +
   `POST /api/viewbook/[token]/collapse` (operator-gated expand, sync bump,
   idempotent). Route + service tests.
3. **`CollapsibleSection` island + `SectionShell` restructure.** Three affordances,
   overlay var, done-check-on-hero, personal override, optimistic write, sync
   reconcile. Component tests.
4. **Options-page config.** `collapseAffordance` + `heroOverlayStrength` columns,
   `PATCH /api/viewbooks/[id]` validation/clamp, loader plumbing, editor UI.
5. **Inspector focus-pin bugfix** + operator button removal.

Each PR is independently shippable and passes `tsc --noEmit` + vitest +
`npm run build`. PRs 1→3 are ordered (3 depends on 1's props and 2's route); 4 and 5
are independent and can land in any order relative to 3.

## 12. Testing

- **Service (`collapse.ts`):** shared set true/false; operator-gate on expand
  (`403 operator_required` for anonymous `collapsed:false`); allowlist rejection for
  bookends; idempotent no-op does not bump syncVersion; value-change does.
- **Route:** preflight chain (same-site, content-type, throttle, bounded body),
  token validation, operator vs anonymous.
- **`CollapsibleSection`:** effective = override ?? shared; client collapse writes +
  clears override; client expand is local-only (no fetch); operator expand fetches
  `collapsed:false`; affordance variants render + are labeled/accessible; done check
  shows collapsed and expanded.
- **Migration/backfill:** a fixture row at `state='collapsed'` becomes
  `state='active', collapsedShared=true`.
- **Config route:** affordance enum rejection; overlay clamp.
- **Inspector regression:** after a `SectionQuickControls` mutation that unmounts a
  focused button, `SelectionContext.select()` on a *different* section succeeds (the
  pin releases). This is the guard against re-introducing the wedge.

## 13. Risks & mitigations

- **Anonymous writes to a shared value.** Cosmetic only (collapse state); reuses the
  existing token + same-site + throttle guards; shared-expand is operator-gated. Abuse
  ceiling is "a section is collapsed for everyone," reversible by any operator.
- **Override flash** for viewers whose personal override differs from shared — one
  paint, cosmetic, accepted.
- **Theme validator regression** avoided by using columns, not `themeJson`.
- **Migration on prod** runs via `prisma migrate deploy`; the backfill `UPDATE` is
  idempotent and scoped to `state='collapsed'`.
