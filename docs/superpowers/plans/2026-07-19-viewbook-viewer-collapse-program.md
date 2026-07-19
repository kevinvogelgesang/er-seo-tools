# Viewbook viewer-collapse — implementation program (overview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each PR plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn operator-only section collapse into a viewer-facing, two-layer (shared default + personal override) feature with hero done-markers, a configurable hero overlay, three selectable expand affordances, and a bundled inspector focus-pin bugfix.

**Spec:** `docs/superpowers/specs/2026-07-19-viewbook-viewer-collapse-design.md` (read it first — this program assumes it).

**Branch/worktree:** `feat/vb-viewer-collapse` at `.claude/worktrees/vb-viewer-collapse`.

## PR map (each is an independent, shippable deliverable)

| PR | File | Deliverable | Depends on |
|----|------|-------------|------------|
| 1 | `…-pr1.md` | Schema + migration/backfill + `'collapsed'`-enum retirement + **transitional server renderer** (hero-only when `collapsedShared`) | — |
| 2 | `…-pr2.md` | `lib/viewbook/collapse.ts` + `POST /api/viewbook/[token]/collapse` (dedicated throttle, request-scoped operator gate, token-in-predicate commit fence) | PR1 |
| 4 | `…-pr4.md` | **Owns `presentation-config.ts` in full** (types+consts+defaults+reader+sanitizer) + `collapseAffordance`/`heroOverlayStrength` columns + atomic `PATCH /api/viewbooks/[id]` + `PresentationEditor` UI | PR1 |
| 3 | `…-pr3.md` | `CollapsibleSection` client island + `SectionShell` restructure (3 affordances, concrete overlay stops + min scrim, done-on-hero + body badge, personal override, reconciliation, `vb:navigate`, disable-while-pending) | PR1, PR2, **PR4** |
| 5 | `…-pr5.md` | Inspector focus-pin bugfix (busy-only) + operator Collapse/Expand button removal | — (independent) |

**Ordering (Codex FIX-PR3-PR4-CONFIG-OWNERSHIP): `PR1 → (PR2 + PR4) → PR3`, PR5 independent.** PR4 owns `lib/viewbook/presentation-config.ts` entirely (type + `COLLAPSE_AFFORDANCES` + `PRESENTATION_DEFAULTS` + `parsePresentationPatch` + `readPresentationConfig`); PR3 imports the type + consts from it and consumes PR4's `SectionShell`-config plumbing, so PR3 lands LAST. (This reverses the earlier PR3-creates-the-type-file plan — PR3 no longer creates `presentation-config.ts`.)

## Global Constraints

- **Node 24 / SQLite only / no serverless.** Do not change the core stack.
- **Array-form `$transaction([...])` ONLY** — never interactive `$transaction(async tx => …)`. Express conditional logic as SQL `EXISTS` predicates.
- **Raw SQL sets `updatedAt` manually** with `Date.now()` (integer ms — raw SQL bypasses `@updatedAt`).
- **In-build type-check/lint are DISABLED.** The ONLY gates are local: `npx tsc --noEmit` + `npx vitest run` (+ `npm run build` before merge). Never merge without them.
- **Public token routes** live under `/api/viewbook/[token]/*` (already public in middleware) and use the load-bearing preflight order: `requireSameSite` → `requireJsonContentType` → `requireViewbookToken` → `checkWriteThrottle` → `readBoundedJson` → core. Every public mutation ALSO re-verifies token/client/section conditions inside its own conditional write (commit-time fencing).
- **`syncVersion` bumps** ride INSIDE the array-form transaction via `lib/viewbook/sync.ts` helpers; a predicated bump (`syncVersionBumpWhere(id, predicate)`) carries the SAME self-contained predicate as the domain write and is placed BEFORE it.
- **Personal override is one-valued:** localStorage holds `'expanded'` or the key is absent. There is no `'collapsed'` value. Effective: `effectiveCollapsed = (override === 'expanded') ? false : collapsedShared`.
- **`heroOverlayStrength`** is an integer in `[0,100]`; a non-configurable minimum title scrim is always applied so text over photos stays legible.
- **Tailwind class-based dark mode** — every new surface uses `dark:` variants (repo convention).
- **Commit message trailer** on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QjQ4gmMazysLuzSGWe7Bd6
  ```

## Test/dev commands (repo)

- Type gate: `npx tsc --noEmit`
- Test one file: `npx vitest run <path>`
- Test viewbook suite: `npx vitest run lib/viewbook components/viewbook app/api/viewbook app/api/viewbooks`
- Migration (local): `npx prisma migrate dev --name <name>`
- Build: `npm run build`
