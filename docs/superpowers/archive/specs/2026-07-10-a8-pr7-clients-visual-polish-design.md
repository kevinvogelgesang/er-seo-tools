# A8 PR 7 — /clients visual polish (SeverityBadge + tokens + wrappers)

**Date:** 2026-07-10
**Status:** Reviewed — Codex ACCEPT-WITH-NAMED-FIXES ×4 (2026-07-10), all applied
in place: (1) `shrink-0` + padding canonicalization decision on the primitive;
(2) gray-tone canonicalization documented as a visible change (one primitive
can't preserve both grays); (3) chip inventory completed — ActivityTimeline /
ClientHeader / Scorecard / QuarterContextCard chips now explicitly adopted or
excluded; (4) token-count corrected (~81) + AppShell wrapper wording fixed.
**Parent:** A8 app-shell redesign umbrella spec
(`2026-07-07-app-shell-redesign-design.md` §8 PR 4+ — per-tool polish passes).
Precedents: PR 4 seo-parser (#120), PR 5 ada-audit (#130), PR 6 /reports (#134).

## 1. Goal

Fourth per-tool polish pass, target `/clients` (fleet list, client dashboard
`[id]`, manage page). Three workstreams, all **visual-only** — no behavior,
data, API, or scoring change:

1. Extract the twice-punted **`SeverityBadge`** primitive
   (`components/ui/SeverityBadge.tsx`) and adopt it color-preservingly on
   every hand-rolled severity/count/alert chip in `/clients`.
2. **Hex→token normalization** (~81 class-name occurrences across 10 files):
   `#1c2d4a`→`navy`, `#f5a623`→`orange`, `#0f1d30` + the `#0f1e30` typo →
   `navy-deep`, `#e09415`→`orange-dark` (see §4 decision).
3. **Wrapper reconciliation**: drop the redundant
   `min-h-screen bg-[#f4f6f9] dark:bg-navy-deep` page wrappers — AppShell's
   content-column wrapper (`components/shell/AppShell.tsx:91`, the flex column
   that contains `<main>`) already supplies the identical
   `bg-[#f4f6f9] dark:bg-navy-deep`, and the shell root is `min-h-screen`.

Scope verified 2026-07-10 by code scout: `components/clients/` is imported
**only** by the two authed `(app)/clients` pages — no `(public)`/share view
touches any of it.

## 2. Why SeverityBadge, and why now

PR 5 (ada-audit) and PR 6 (/reports) both excluded severity-flavored chips
with the note "→ future `SeverityBadge`" because `StatusPill` models a
5-tone *lifecycle* palette (neutral/running/success/error/warning=amber) and
severity chips need orange, purple, and blue in non-lifecycle roles, plus a
compact square-rounded shape. The umbrella spec's extraction rule is: *"a
primitive is extracted the first time the redesign needs it, not
speculatively."* `/clients` is that first time — its dominant chrome is
severity/count chips, and forcing them onto StatusPill would violate the
color-preserving rule (warning chips here are **orange**, StatusPill warning
is **amber**; `regression` is **purple**, which StatusPill cannot express).

### 2.1 SeverityBadge API

```tsx
// components/ui/SeverityBadge.tsx
export type BadgeTone = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'gray'

export function SeverityBadge({ label, tone, uppercase, title }: {
  label: string
  tone: BadgeTone
  uppercase?: boolean
  title?: string
})
```

- Shape: `inline-flex shrink-0 items-center rounded px-1.5 py-0.5
  text-[10px] font-body font-semibold` (+ `uppercase` when set) — the
  square-rounded compact shape the current sites use, deliberately distinct
  from StatusPill's `rounded-full text-[11px]` lifecycle pill. `shrink-0` is
  part of the contract (Codex #1): several adoption sites sit in flex rows
  (`FindingsPanel` badges are `shrink-0` today) and a badge must never
  compress at narrow widths. **Padding canonicalizes to `px-1.5`** — sites
  currently split px-1.5 / px-2 roughly evenly; the px-2 sites (SEV chip,
  alert pills, seoCounts chips) tighten by 2px each side.
- Tones are **color-named**, not semantic-named: severity vocabularies
  differ per tool (clients: critical/warning/notice; ada-audit's future
  adoption: critical/serious/moderate/minor; fleet alerts:
  error/drop/stale/regression). Semantics→tone mapping lives in the
  adopting component (same pattern as PR 5/6's `status-tone.ts` helpers),
  keeping the primitive a pure palette.
- Tone classes (canonicalized from the existing sites — light `*-50` bg,
  `*-700` text; dark `*-500/10` bg, `*-400` text; gray follows StatusPill
  neutral):

  | tone | light | dark |
  |---|---|---|
  | red | `bg-red-50 text-red-700` | `dark:bg-red-500/10 dark:text-red-400` |
  | orange | `bg-orange-50 text-orange-700` | `dark:bg-orange-500/10 dark:text-orange-400` |
  | amber | `bg-amber-50 text-amber-700` | `dark:bg-amber-500/10 dark:text-amber-400` |
  | blue | `bg-blue-50 text-blue-700` | `dark:bg-blue-500/10 dark:text-blue-400` |
  | purple | `bg-purple-50 text-purple-700` | `dark:bg-purple-500/10 dark:text-purple-400` |
  | gray | `bg-gray-100 text-gray-600` | `dark:bg-white/10 dark:text-white/60` |

  Canonicalization notes (each a small visible change, same precedent as
  PR 5's "pending canonicalized to the gray it already had"):
  - FleetTable's alert pills currently use the `*-100` bg / `*-500/20` dark
    strength (e.g. `bg-red-100`, `bg-purple-100`) while every other site
    uses `*-50` / `*-500/10`; the alert pills shift one bg shade lighter.
  - **Gray (Codex #2):** two gray strengths coexist today —
    `gray-600`/`white/60` (FleetTable stale alert, Scorecard sourceNote,
    StatusPill neutral) and `gray-500`/`white/50` (FindingsPanel sample/tool
    badges, FleetTable suffix badge, C/W zero-state). One primitive cannot
    preserve both; the canonical gray follows **StatusPill neutral**
    (`gray-600`/`white/60`), so the `gray-500` sites gain one step of text
    strength.

### 2.2 Adoption sites (all in `/clients`)

| Site | Current | Tone mapping |
|---|---|---|
| `FindingsPanel.tsx` `SEV_CHIP` (severity chip on each finding row) | hand-rolled record critical/warning/notice | red / orange / blue |
| `FindingsPanel.tsx` `sample` badge | gray chip | gray + `title` passthrough |
| `FindingsPanel.tsx` tool badge (`SEO`/`ADA`) | gray uppercase chip | gray, `uppercase` |
| `FleetTable.tsx` `ALERT_CLASSES` pills | record error/score-drop/stale/regression, uppercase | red / amber / gray / purple, `uppercase` (+ `title=detail`) |
| `FleetTable.tsx` `C`/`W` open-issue count pills | red / orange, gray when 0 | red / orange / gray |
| `FleetTable.tsx` pillar-version `suffix` badge | gray uppercase chip | gray, `uppercase` |
| `app/(app)/clients/[id]/page.tsx` seoCounts chips (N critical / N warnings / N notices) | red / orange / blue chips | red / orange / blue |
| `Scorecard.tsx` `sourceNote` badge (e.g. "page audits") | gray uppercase chip | gray, `uppercase` |

The FleetTable alert mapping lives in a small exported
`components/clients/alert-tone.ts` helper
(`alertTone(kind): BadgeTone` — error→red, score-drop→amber, stale→gray,
regression→purple) so the mapping is unit-testable, mirroring
`ada-audit/status-tone.ts` / `reports/status-tone.ts`.

### 2.3 StatusPill adoption (four sites — lifecycle states)

- `ScheduledScansCard.tsx` "Paused" chip → `StatusPill` `neutral` (gray→gray;
  shape/size canonicalize to the standard lifecycle pill — a visible change,
  same precedent as PR 5).
- `ActivityTimeline.tsx` status chip (Codex #3) — `statusClasses()` maps
  complete→green / error→red / cancelled→gray / in-flight→blue, which is
  exactly StatusPill's success/error/neutral/running. Adopt via a small
  `timelineStatusTone(status)` mapping in the component (dark bg opacity
  canonicalizes `/20`→`/15`).
- `ClientHeader.tsx` "Archived" badge → `StatusPill` `neutral` with
  `label="ARCHIVED"` (Codex plan-fix #2: caps move into the label so the
  visible text is preserved) — already `rounded-full px-2 py-0.5
  text-[11px]`; loses only `tracking-wide` and shifts
  `gray-200/gray-500` → `gray-100/gray-600` (visible change, flagged for
  Kevin's eyeball).
- `QuarterContextCard.tsx` "✓ Done" completed chip → `StatusPill` `success`
  — a lifecycle state at `text-[11px]` (exact size match; `green-50`→
  `green-100` bg step + rounded-full canonicalization). This removes the
  need for a `green` SeverityBadge tone (YAGNI).

## 3. Hex→token normalization

Counts verified by grep 2026-07-10:

| File | `#1c2d4a`→navy | `#f5a623`→orange | `#e09415`→orange-dark | navy-deep |
|---|---|---|---|---|
| `app/(app)/clients/manage/page.tsx` | 14 | 22 | 6 | 1 (`#0f1e30` **typo**) |
| `app/(app)/clients/page.tsx` | 2 | — | — | 1 |
| `app/(app)/clients/[id]/page.tsx` | 1 | — | — | — |
| `components/clients/FleetTable.tsx` | 3 | 5 | 1 | — |
| `components/clients/FindingsPanel.tsx` | 2 | 3 | 3 | — |
| `components/clients/ClientHeader.tsx` | 1 | 3 | 2 | — |
| `components/clients/ActivityTimeline.tsx` | 1 | 2 | — | — |
| `components/clients/IssueTrendCard.tsx` | 1 | 1 | 1 | — |
| `components/clients/QuarterContextCard.tsx` | 1 | 1 | 1 | — |
| `components/clients/Scorecard.tsx` | — | 1 | 1 | — |

- All are `className` occurrences (`text-[#1c2d4a]`, `bg-[#f5a623]`,
  `hover:text-[#e09415]`, …) → mechanical token swaps.
- The two page wrappers' `bg-[#f4f6f9]` occurrences disappear with the
  wrappers (§5), not via token swap.

**Excluded** (SVG/Recharts props, not class names — cannot take Tailwind
classes): `SeoHistoryChart.tsx` stroke/fill hex (`#ef4444`/`#f97316`/
`#3b82f6`/`#e5e7eb`), `Sparkline.tsx` `color = '#f5a623'` prop default.

## 4. The `#e09415` decision (the one value-shifting swap)

`hover:text-[#e09415]` / `hover:bg-[#e09415]` (15×) is the /clients-local
hover-darkening of orange. It is **not** the `orange-dark` token
(`#d4881a`). Options considered:

- **(chosen)** Normalize to `orange-dark` — aligns /clients with the
  app-wide hover convention (`hover:bg-orange-dark` in seo-parser upload,
  seo-audits results, eat-checklist); kills the magic hex. Visual shift is
  a slightly deeper hover orange, hover-state-only. Flagged for Kevin's
  eyeball (his stated A8 mode: "adjust per-section as I review").
- Keep the raw hex (value-preserving but leaves 15 magic hexes — defeats
  the workstream).
- Add an `orange-hover` token (proliferates near-identical tokens for a
  hover state nobody else uses).

## 5. Wrapper reconciliation

Drop the outer `<div className="min-h-screen bg-[#f4f6f9]
dark:bg-navy-deep">` from:

- `app/(app)/clients/page.tsx:13`
- `app/(app)/clients/[id]/page.tsx:42`

`components/shell/AppShell.tsx:91` supplies the identical background on
`<main>`. Keep the inner max-width containers. `manage/page.tsx` has no
such wrapper (verified). Same reconciliation as PR 4's seo-parser roots.

## 6. Exclusions (documented, deliberate)

| Excluded | Why |
|---|---|
| `Scorecard.tsx` big score number + `scoreColor()` (**≥90/≥70** bands, ≥8/≥5 for /10) | ScoreRing bands are ≥80/≥50 — a swap silently changes color thresholds, and Scorecard is a composite (number + delta + sparkline + chips), not a badge. Band reconciliation is a product decision → its own future item. |
| `FleetTable.tsx` `ScoreCell` | No banding today; adding a ScoreRing would *introduce* judgment coloring — product decision, not polish. |
| Delta chips (`DeltaChip`, `DeltaBadge`, ScheduledScansCard `▲/▼`) | Direction-signed semantics (green/red by sign, inverse for issue counts) — not a palette badge; keep custom. |
| `FindingsPanel.tsx` `NEW` badge | Intentionally louder solid `bg-red-600 text-white`; canonicalizing it to the pastel palette would demote it. |
| `ActivityTimeline.tsx` `TYPE_CLASSES` chips (Codex #3) | Categorical tool-type palette (blue/purple/teal/cyan/indigo/orange) — teal/cyan/indigo are used nowhere else; not severity or lifecycle. Adding three single-consumer tones to SeverityBadge would be speculative. Revisit if a categorical badge need recurs. |
| `ClientHeader.tsx` domain chips | Plain data chips (`text-xs`, informational value, not status/severity) — wrong scale for the 10px badge. |
| `QuarterContextCard.tsx` priority/status chips | Driven by the quarter-grid inline-hex theme (`PCOLORS`/`STATUS_COLORS` style props) — belongs to the deferred quarter-grid Tailwind-ization, not class-swappable here. |
| Recharts/Sparkline SVG hex | Props, not classes (§3). |
| `/quarter-grid` cross-link chrome, `manage` form inputs/buttons beyond token swaps | Out of per-tool-pass scope; buttons keep their exact classes with tokens swapped in place. |

## 7. Testing

- `components/ui/SeverityBadge.test.tsx` — renders label; each tone maps to
  its documented classes; `uppercase`/`title` passthrough.
- `components/clients/alert-tone.test.ts` — the 4 alert kinds → tones.
- Existing `FleetTable.test.tsx` / `FindingsPanel.test.tsx` /
  `Scorecard.test.tsx` / `ScheduledScansCard.test.tsx` /
  `ActivityTimeline.test.tsx` / `QuarterContextCard.test.tsx` stay green;
  add/adjust assertions where they pin chip markup (color-preservation
  asserted via tone classes).
- Dark-mode variants on every touched element (house rule).
- No purge risk: all tone classes are static string literals in
  `components/` (inside Tailwind's content globs; `./lib/**` already added
  post-PR 3 incident).

## 8. Rollout

Single PR (`feat/a8-pr7-clients-polish`): SeverityBadge + adoptions +
tokens + wrappers. Gates (tsc / vitest / build) → PR → merge per rule 1 →
deploy → prod verify (health, `/clients` auth gate, tone classes present in
shipped CSS bundle — PR 5's verification recipe; authed visual eyeball
flagged for Kevin). Docs ritual in the ship commit; spec+plan → archive.

## 9. Risks / notes

- Purely-additive primitive; no `StatusPill` runtime change this pass.
- Visible changes (all called out in the PR description for Kevin's
  eyeball, per his "adjust per-section as I review" A8 mode): the
  alert-pill bg-shade canonicalization + the gray canonicalization + the
  px-1.5 padding canonicalization (§2.1), the `#e09415` hover shift (§4),
  and the four StatusPill shape canonicalizations (§2.3 — Paused,
  timeline status, Archived, ✓ Done).
- Future consumers of SeverityBadge (ada-audit impact chips, reports
  source badges) are explicitly NOT migrated here — one tool per pass.
