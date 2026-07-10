# C19 PR3 — Levers + Score Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ADA scorer real operator-settable weights (DB singleton + /settings card), make the SEO `brokenLinks` weight persistable end-to-end, and ship the Score Lab — a hidden internal page where Kevin recomputes any run's score live in the browser under what-if weights — plus the PR1+PR2 follow-up minors.

**Architecture:** Mirror the C8 ScoringWeights pattern exactly: an `AdaScoringWeights` singleton row (id=1) resolved server-side once per scoring write (`resolveAdaScoringWeights()`), threaded into the three ADA mapper call sites (finalizer + both ada-write rebuild paths). The Score Lab is a cookie-gated `(app)` page: a new `GET /api/scoring/lab-inputs` returns a compact scoring-inputs payload (ADA any-run via the existing `loadAdaV4InputsForRun`; SEO post-C19 runs via the v2 breakdown's `inputsSnapshot`), and the browser recomputes score+breakdown through the pure client-safe scorers (`computeAdaScoreV4`, new `recomputeSeoScore`). Saving weights changes `weightsHash` → PR2's `comparabilityBreak: 'weights'` suppression works with zero new wiring.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Tailwind (class dark mode), vitest.

## Global Constraints

- **Defaults do NOT change**: ADA caps stay 40/30/15/5/10, advisoryDiscount 0.4, SEO knees stay — the archetype calibration suites (`ada-v4-calibration.test.ts`, `seo-calibration.test.ts`) must stay green untouched. Never widen a band.
- **`lib/scoring/` stays pure + client-safe** except `*.server.ts` and `weights-hash.ts` (node:crypto). The Score Lab never hashes weights client-side.
- **Array-form `$transaction([...])` only** (not needed here — all writes are single upserts).
- **Migrations are hand-authored SQL** (`migrate dev` is interactive-only in this env); apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`. SQLite: no ALTER COLUMN nullability.
- **New page + API route are cookie-gated by default** — NO `middleware.ts` change, do NOT add one.
- **New API routes** wrap handlers in `withRoute` and parse bodies with `parseJsonBody` (house A3 rule; the existing scoring-weights route predates it and is left as-is).
- **Dark-mode variants on every new UI element**; no hydration-mismatch patterns.
- **A findings/dual-write failure must never fail the legacy path** — the finalizer's weights resolve falls back to defaults on error, never throws outward.
- **ADA validation contract (spec Part 4 / Codex #2):** each cap 0..100, at least one cap > 0, `advisoryDiscount ∈ [0,1]`, `sum(caps) ≤ 100`.
- Test env: `DATABASE_URL="file:./local-dev.db" npx vitest run <file>`; component tests use `act()` not `waitFor` under fake timers; `getAllBy*` for repeated copy; route files export only handlers+config.
- Gates: `npx tsc --noEmit` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.
- Never `git add -A` (untracked `pentest-results/` etc. at repo root).

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20260710120000_ada_scoring_weights/migration.sql` | `AdaScoringWeights` singleton table + `ScoringWeights.brokenLinks` column |
| `lib/scoring/weights.ts` (modify) | `brokenLinks` joins `PERSISTABLE_WEIGHT_KEYS`; `validateWeights` accepts it |
| `lib/scoring/resolve-weights.ts` (modify) | reads the real `brokenLinks` column |
| `lib/scoring/ada-weights.ts` (new, client-safe) | `ADA_WEIGHT_LABELS`, `ADA_CAP_KEYS`, `validateAdaWeights` |
| `lib/scoring/resolve-ada-weights.ts` (new, server-only) | `resolveAdaScoringWeights()` |
| `lib/scoring/weights-hash.ts` (modify) | typed signature — kills the `as unknown as Record<string, number>` casts at 4 call sites |
| `lib/findings/ada-write.ts`, `lib/ada-audit/site-audit-finalizer.ts` (modify) | resolve + thread ADA weights into `mapAdaChildren`/`mapAdaSingle` |
| `lib/findings/parity.ts` (modify) | version-gate score comparisons (pre-C19 stored scores vs current-formula recompute = documented drift, not a diff) |
| `app/api/settings/ada-scoring-weights/route.ts` (new) | GET/PUT the ADA profile |
| `components/settings/AdaScoringWeightsCard.tsx` (new), `ScoringWeightsCard.tsx` (modify), `app/(app)/settings/page.tsx` (modify) | settings UI |
| `app/api/scoring/lab-inputs/route.ts` (new) | run list + per-run scoring-inputs payload |
| `lib/scoring/ada-v4-inputs.server.ts` (modify) | deterministic violation `orderBy` (PR1 minor) |
| `lib/scoring/seo-recompute.ts` (new, client-safe) | `recomputeSeoScore(snapshot, weights)` — SF mirror + live delegate |
| `app/(app)/score-lab/page.tsx` (new), `components/score-lab/ScoreLabClient.tsx` (new), `lib/tools-registry.ts` (modify) | the Score Lab |
| `scripts/score-replay.ts`, `lib/report/report-html.ts`, `lib/jobs/handlers/broken-link-verify.test.ts` (modify) | PR2 minors: catch-label granularity, sparkline weights-hash dash, broken-image-branch test |

Dependency order: Task 1 → 2 → 3 (threading needs the resolver); Task 4 needs 1+2; Task 5 standalone; Task 6 standalone; Task 7 needs 4+5+6; Task 8 standalone.

---

### Task 1: Schema migration + `brokenLinks` persistable end-to-end

**Files:**
- Modify: `prisma/schema.prisma` (after the `ScoringWeights` model, ~line 578)
- Create: `prisma/migrations/20260710120000_ada_scoring_weights/migration.sql`
- Modify: `lib/scoring/weights.ts`
- Modify: `lib/scoring/resolve-weights.ts:12`
- Modify: `components/settings/ScoringWeightsCard.tsx:11-12`
- Test: `lib/scoring/weights.test.ts`, `lib/scoring/resolve-weights.test.ts`, `app/api/settings/scoring-weights/route.test.ts`, `components/settings/ScoringWeightsCard.test.tsx`

**Interfaces:**
- Consumes: existing `ScoringWeights` interface (already has `brokenLinks`), `DEFAULT_WEIGHTS`.
- Produces: `AdaScoringWeights` Prisma model (Task 2's resolver reads it); `PERSISTABLE_WEIGHT_KEYS: readonly (keyof ScoringWeights)[]` now including `'brokenLinks'` (the PUT route's pick and the card's key list follow automatically); `validateWeights` accepting a submitted `brokenLinks`.

- [ ] **Step 1: Edit the schema — both changes, one migration**

In `prisma/schema.prisma`, add `brokenLinks` to `ScoringWeights` (after `schema Float @default(10)`) and the new model right below it:

```prisma
model ScoringWeights {
  id           Int      @id @default(1)   // singleton — all writes use upsert({ where: { id: 1 } })
  indexability Float    @default(20)
  errorRate    Float    @default(20)
  missingTitle Float    @default(10)
  missingMeta  Float    @default(8)
  missingH1    Float    @default(7)
  crawlDepth   Float    @default(15)      // health-score only; live SEO ignores it
  thinContent  Float    @default(10)
  schema       Float    @default(10)
  brokenLinks  Float    @default(10)      // live SEO only; SF health renormalizes it away (C19 PR3)
  updatedAt    DateTime @updatedAt
}

model AdaScoringWeights {
  id               Int      @id @default(1) // singleton — all writes use upsert({ where: { id: 1 } })
  critical         Float    @default(40)    // caps are ABSOLUTE deductions (sum ≤ 100 enforced app-side)
  serious          Float    @default(30)
  moderate         Float    @default(15)
  minor            Float    @default(5)
  needsReview      Float    @default(10)
  advisoryDiscount Float    @default(0.4)   // 0..1 multiplier for best-practice-only rules
  updatedAt        DateTime @updatedAt
}
```

- [ ] **Step 2: Hand-author the migration SQL**

Create `prisma/migrations/20260710120000_ada_scoring_weights/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "AdaScoringWeights" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "critical" REAL NOT NULL DEFAULT 40,
    "serious" REAL NOT NULL DEFAULT 30,
    "moderate" REAL NOT NULL DEFAULT 15,
    "minor" REAL NOT NULL DEFAULT 5,
    "needsReview" REAL NOT NULL DEFAULT 10,
    "advisoryDiscount" REAL NOT NULL DEFAULT 0.4,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
ALTER TABLE "ScoringWeights" ADD COLUMN "brokenLinks" REAL NOT NULL DEFAULT 10;
```

- [ ] **Step 3: Apply + regenerate**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: `1 migration found … applied` and client generation success.

- [ ] **Step 4: Write the failing tests (weights.ts semantics)**

In `lib/scoring/weights.test.ts` add:

```ts
it('PERSISTABLE_WEIGHT_KEYS includes brokenLinks (C19 PR3 — real column)', () => {
  expect(PERSISTABLE_WEIGHT_KEYS).toContain('brokenLinks')
})
it('validateWeights accepts a submitted brokenLinks value', () => {
  const v = validateWeights({ brokenLinks: 22 })
  expect('error' in v).toBe(false)
  expect((v as ScoringWeights).brokenLinks).toBe(22)
})
it('validateWeights rejects a negative brokenLinks', () => {
  expect(validateWeights({ brokenLinks: -1 })).toHaveProperty('error')
})
it('all-zero persistable weights still rejected (brokenLinks now counts toward the guard)', () => {
  const zeros = Object.fromEntries(PERSISTABLE_WEIGHT_KEYS.map((k) => [k, 0]))
  expect(validateWeights({ ...zeros, crawlDepth: 15 })).toHaveProperty('error')
})
it('brokenLinks alone > 0 satisfies the guard (it is user-settable now)', () => {
  const zeros = Object.fromEntries(PERSISTABLE_WEIGHT_KEYS.map((k) => [k, 0]))
  expect('error' in validateWeights({ ...zeros, brokenLinks: 5 })).toBe(false)
})
```

- [ ] **Step 5: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/weights.test.ts`
Expected: FAIL (brokenLinks not in PERSISTABLE_WEIGHT_KEYS; forced default overrides 22).

- [ ] **Step 6: Implement weights.ts**

Replace lines 14-22 and the `validateWeights` body in `lib/scoring/weights.ts`:

```ts
// The 9 columns on the ScoringWeights DB row (brokenLinks persistable since C19 PR3).
export const PERSISTABLE_WEIGHT_KEYS: readonly (keyof ScoringWeights)[] = [
  'indexability', 'errorRate', 'missingTitle', 'missingMeta', 'missingH1', 'crawlDepth', 'thinContent', 'schema', 'brokenLinks',
]
const ALL_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]
export const LIVE_ELIGIBLE_KEYS = ALL_KEYS.filter((k) => k !== 'crawlDepth')
```

(delete `PERSISTABLE_LIVE_ELIGIBLE_KEYS` — every key is persistable now) and in `validateWeights`, delete these two pieces:

```ts
  // brokenLinks has no DB column yet (PR3) — never accept a submitted value, always the code default.
  out.brokenLinks = DEFAULT_WEIGHTS.brokenLinks
```
and change the guard to:
```ts
  // At least one non-crawl-depth weight must be > 0 — a submission zeroing every
  // score-bearing factor would make both scorers vacuous.
  if (!LIVE_ELIGIBLE_KEYS.some((k) => out[k] > 0)) return { error: 'At least one non-crawl-depth weight must be greater than 0.' }
```

- [ ] **Step 7: Implement resolve-weights.ts**

Replace line 12 (`brokenLinks: DEFAULT_WEIGHTS.brokenLinks, // PR3: brokenLinks becomes a real column`) with:

```ts
    brokenLinks: row.brokenLinks,
```

Update `lib/scoring/resolve-weights.test.ts`: the `'returns brokenLinks: 10 unconditionally when a DB row is present'` test becomes:

```ts
it('returns the stored brokenLinks column (C19 PR3)', async () => {
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...persistedDefaults, brokenLinks: 22 }, update: { brokenLinks: 22 } })
  expect((await resolveScoringWeights()).brokenLinks).toBe(22)
})
```
Also refresh the stale header comment on `persistedDefaults` (it says brokenLinks has no column).

- [ ] **Step 8: Un-hide brokenLinks on the SEO card**

In `components/settings/ScoringWeightsCard.tsx`, delete the comment line `// PR3 will surface brokenLinks once it persists.` (line 11). `const keys = PERSISTABLE_WEIGHT_KEYS` now renders the 9th input automatically. In `ScoringWeightsCard.test.tsx`, add an assertion that a "Broken links" input renders (mirror how the existing inputs are queried in that file), and fix any test that asserted brokenLinks was hidden.

- [ ] **Step 9: Update the route test**

In `app/api/settings/scoring-weights/route.test.ts`, add: PUT `{ brokenLinks: 22 }` → 200, response `weights.brokenLinks === 22`, and a follow-up GET returns 22 (round-trips the column). Mirror the file's existing PUT test structure.

- [ ] **Step 10: Run all touched suites**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/weights.test.ts lib/scoring/resolve-weights.test.ts app/api/settings/scoring-weights/route.test.ts components/settings/ScoringWeightsCard.test.tsx`
Expected: PASS. Also run `npx tsc --noEmit` (the `Pick<>` in the PUT route and any `PERSISTABLE_LIVE_ELIGIBLE_KEYS` references must be clean).

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260710120000_ada_scoring_weights lib/scoring/weights.ts lib/scoring/weights.test.ts lib/scoring/resolve-weights.ts lib/scoring/resolve-weights.test.ts components/settings/ScoringWeightsCard.tsx components/settings/ScoringWeightsCard.test.tsx app/api/settings/scoring-weights/route.test.ts
git commit -m "feat(c19-pr3): AdaScoringWeights table + brokenLinks column; brokenLinks persistable end-to-end"
```

---

### Task 2: `validateAdaWeights` + `resolveAdaScoringWeights`

**Files:**
- Create: `lib/scoring/ada-weights.ts`
- Create: `lib/scoring/resolve-ada-weights.ts`
- Test: `lib/scoring/ada-weights.test.ts`, `lib/scoring/resolve-ada-weights.test.ts`

**Interfaces:**
- Consumes: `AdaV4Weights`, `DEFAULT_ADA_V4_WEIGHTS` from `lib/scoring/ada-v4`; `prisma.adaScoringWeights` (Task 1).
- Produces: `ADA_CAP_KEYS: readonly AdaCapKey[]` (`'critical' | 'serious' | 'moderate' | 'minor' | 'needsReview'`), `ADA_WEIGHT_LABELS: Record<keyof AdaV4Weights, string>`, `validateAdaWeights(input: Record<string, unknown>): AdaV4Weights | { error: string }`, `resolveAdaScoringWeights(): Promise<AdaV4Weights>`. Tasks 3, 4, 7 consume these exact names.

- [ ] **Step 1: Write the failing validation tests**

Create `lib/scoring/ada-weights.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_ADA_V4_WEIGHTS } from './ada-v4'
import { validateAdaWeights, ADA_CAP_KEYS } from './ada-weights'

describe('validateAdaWeights', () => {
  it('accepts the defaults (sum of caps is exactly 100)', () => {
    expect(validateAdaWeights({ ...DEFAULT_ADA_V4_WEIGHTS })).toEqual(DEFAULT_ADA_V4_WEIGHTS)
  })
  it('merges partial input over the defaults', () => {
    const v = validateAdaWeights({ critical: 50, serious: 20 })
    expect(v).toEqual({ ...DEFAULT_ADA_V4_WEIGHTS, critical: 50, serious: 20 })
  })
  it('rejects a cap above 100', () => {
    expect(validateAdaWeights({ critical: 101, serious: 0, moderate: 0, minor: 0, needsReview: 0 })).toHaveProperty('error')
  })
  it('rejects a negative cap', () => {
    expect(validateAdaWeights({ minor: -1 })).toHaveProperty('error')
  })
  it('rejects sum(caps) > 100', () => {
    expect(validateAdaWeights({ critical: 60, serious: 41 })).toHaveProperty('error') // 60+41+15+5+10 = 131
  })
  it('rejects all caps zero', () => {
    const zeros = Object.fromEntries(ADA_CAP_KEYS.map((k) => [k, 0]))
    expect(validateAdaWeights(zeros)).toHaveProperty('error')
  })
  it('rejects advisoryDiscount outside 0..1', () => {
    expect(validateAdaWeights({ advisoryDiscount: 1.5 })).toHaveProperty('error')
    expect(validateAdaWeights({ advisoryDiscount: -0.1 })).toHaveProperty('error')
  })
  it('accepts advisoryDiscount boundary values 0 and 1', () => {
    expect('error' in validateAdaWeights({ advisoryDiscount: 0 })).toBe(false)
    expect('error' in validateAdaWeights({ advisoryDiscount: 1 })).toBe(false)
  })
  it('rejects non-numeric values', () => {
    expect(validateAdaWeights({ critical: 'lots' })).toHaveProperty('error')
    expect(validateAdaWeights({ critical: NaN })).toHaveProperty('error')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/ada-weights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/scoring/ada-weights.ts`**

```ts
// lib/scoring/ada-weights.ts — pure, client-safe. Validation + labels for the
// ADA v4 weight profile (C19 PR3). Unlike the SEO weights (normalized shares),
// the five caps are ABSOLUTE deductions — an unconstrained total would silently
// rescale the whole grade, hence sum(caps) ≤ 100 (spec Part 4 / Codex #2).
import { DEFAULT_ADA_V4_WEIGHTS, type AdaV4Weights } from './ada-v4'

export type AdaCapKey = Exclude<keyof AdaV4Weights, 'advisoryDiscount'>
export const ADA_CAP_KEYS: readonly AdaCapKey[] = ['critical', 'serious', 'moderate', 'minor', 'needsReview']

export const ADA_WEIGHT_LABELS: Record<keyof AdaV4Weights, string> = {
  critical: 'Critical cap',
  serious: 'Serious cap',
  moderate: 'Moderate cap',
  minor: 'Minor cap',
  needsReview: 'Needs-review cap',
  advisoryDiscount: 'Advisory discount (0–1)',
}

export function validateAdaWeights(input: Record<string, unknown> | Partial<AdaV4Weights>): AdaV4Weights | { error: string } {
  const inp = input as Record<string, unknown> // Lab passes a typed AdaV4Weights; route passes parsed JSON
  const out: AdaV4Weights = { ...DEFAULT_ADA_V4_WEIGHTS }
  for (const key of ADA_CAP_KEYS) {
    const v = inp[key]
    if (v === undefined || v === null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      return { error: `Cap "${key}" must be a finite number between 0 and 100.` }
    }
    out[key] = v
  }
  const d = inp.advisoryDiscount
  if (d !== undefined && d !== null) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 1) {
      return { error: 'Advisory discount must be a number between 0 and 1.' }
    }
    out.advisoryDiscount = d
  }
  const sum = ADA_CAP_KEYS.reduce((s, k) => s + out[k], 0)
  if (sum > 100) return { error: `Caps sum to ${sum} — they are absolute deductions and must sum to at most 100.` }
  if (!ADA_CAP_KEYS.some((k) => out[k] > 0)) return { error: 'At least one cap must be greater than 0.' }
  return out
}
```

- [ ] **Step 4: Run validation tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/ada-weights.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing resolver tests**

Create `lib/scoring/resolve-ada-weights.test.ts` (mirror `resolve-weights.test.ts`):

```ts
import { it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { DEFAULT_ADA_V4_WEIGHTS } from './ada-v4'
import { resolveAdaScoringWeights } from './resolve-ada-weights'

afterEach(async () => { await prisma.adaScoringWeights.deleteMany({ where: { id: 1 } }) })

it('returns defaults when no row exists', async () => {
  await prisma.adaScoringWeights.deleteMany({ where: { id: 1 } })
  expect(await resolveAdaScoringWeights()).toEqual(DEFAULT_ADA_V4_WEIGHTS)
})
it('returns the stored row when present', async () => {
  await prisma.adaScoringWeights.upsert({
    where: { id: 1 },
    create: { id: 1, critical: 55, advisoryDiscount: 0.2 },
    update: { critical: 55, advisoryDiscount: 0.2 },
  })
  const w = await resolveAdaScoringWeights()
  expect(w.critical).toBe(55)
  expect(w.advisoryDiscount).toBe(0.2)
  expect(w.serious).toBe(30) // column default fills unspecified keys
})
```

- [ ] **Step 6: Run to verify failure, then implement `lib/scoring/resolve-ada-weights.ts`**

```ts
// lib/scoring/resolve-ada-weights.ts — server-only DB read for the ADA v4
// weight profile (C19 PR3; mirrors resolve-weights.ts).
import { prisma } from '@/lib/db'
import { DEFAULT_ADA_V4_WEIGHTS, type AdaV4Weights } from './ada-v4'

export async function resolveAdaScoringWeights(): Promise<AdaV4Weights> {
  const row = await prisma.adaScoringWeights.findUnique({ where: { id: 1 } })
  if (!row) return { ...DEFAULT_ADA_V4_WEIGHTS }
  return {
    critical: row.critical, serious: row.serious, moderate: row.moderate,
    minor: row.minor, needsReview: row.needsReview, advisoryDiscount: row.advisoryDiscount,
  }
}
```

- [ ] **Step 7: Run both suites**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/ada-weights.test.ts lib/scoring/resolve-ada-weights.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/scoring/ada-weights.ts lib/scoring/ada-weights.test.ts lib/scoring/resolve-ada-weights.ts lib/scoring/resolve-ada-weights.test.ts
git commit -m "feat(c19-pr3): validateAdaWeights (sum caps<=100, advisory 0..1) + resolveAdaScoringWeights"
```

---

### Task 3: Thread ADA weights into the write path + typed `hashWeights` + parity version-gate

**Files:**
- Modify: `lib/scoring/weights-hash.ts`
- Modify: `lib/findings/seo-mapper.ts:134`, `lib/findings/ada-mapper.ts:296,346`, `lib/jobs/handlers/broken-link-verify.ts:542` (drop casts)
- Modify: `lib/findings/ada-write.ts:41,69`
- Modify: `lib/ada-audit/site-audit-finalizer.ts:131`
- Modify: `lib/findings/parity.ts` (`diffAdaRun` + `StoredRun`, SEO score compare at line 58)
- Test: `lib/findings/ada-write.test.ts`, `lib/ada-audit/site-audit-finalizer.findings.test.ts`, `lib/findings/parity.test.ts`, `lib/scoring/weights-hash.test.ts`

**Interfaces:**
- Consumes: `resolveAdaScoringWeights` (Task 2), `mapAdaChildren(parent, children, weights?)` / `mapAdaSingle(audit, weights?)` (exist — both default to `DEFAULT_ADA_V4_WEIGHTS`).
- Produces: `hashWeights(weights: ScoringWeights | AdaV4Weights | Record<string, number>): string` (same behavior, wider type). Every NEW ADA scoring write now reflects the DB profile; parity stays quiet on pre-v4-stored runs.

- [ ] **Step 1: Typed `hashWeights` (kill the cast wart)**

Replace `lib/scoring/weights-hash.ts`:

```ts
// SERVER-ONLY (node:crypto). Never import from a client component; the Score Lab
// shows live unsaved weights without a hash.
import { createHash } from 'crypto'
import type { ScoringWeights } from './weights'
import type { AdaV4Weights } from './ada-v4'

export function hashWeights(weights: ScoringWeights | AdaV4Weights | Record<string, number>): string {
  const record = weights as unknown as Record<string, number> // single cast, here only
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))),
  )
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}
```

Then remove the `as unknown as Record<string, number>` at all four call sites (`seo-mapper.ts:134`, `ada-mapper.ts:296`, `ada-mapper.ts:346`, `broken-link-verify.ts:542`) — each becomes plain `hashWeights(weights)` / `hashWeights(ctx.weights)`. Run `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/weights-hash.test.ts` — existing hash-stability tests must still pass unchanged (behavior identical).

- [ ] **Step 2: Write the failing threading test (ada-write standalone path)**

In `lib/findings/ada-write.test.ts`, add (reuse the file's existing standalone-audit fixture helpers for creating a complete AdaAudit with a violation blob):

```ts
it('writeAdaSingleFindings scores with the DB AdaScoringWeights profile (C19 PR3)', async () => {
  await prisma.adaScoringWeights.upsert({
    where: { id: 1 }, create: { id: 1, critical: 80, serious: 10, moderate: 5, minor: 0, needsReview: 5 },
    update: { critical: 80, serious: 10, moderate: 5, minor: 0, needsReview: 5 },
  })
  // <use the file's existing helper to create a complete standalone audit whose
  //  blob contains one critical-impact violation>
  await writeAdaSingleFindings(audit.id)
  const run = await prisma.crawlRun.findUnique({ where: { adaAuditId: audit.id } })
  const breakdown = JSON.parse(run!.scoreBreakdown!) as { deductions: { category: string; cap: number }[] }
  expect(breakdown.deductions.find((d) => d.category === 'critical')!.cap).toBe(80)
  await prisma.adaScoringWeights.deleteMany({ where: { id: 1 } })
})
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-write.test.ts` — the new test FAILS (cap is 40, the default).

- [ ] **Step 3: Implement threading in `ada-write.ts`**

Add the import and thread both call sites:

```ts
import { resolveAdaScoringWeights } from '@/lib/scoring/resolve-ada-weights'
```
Line 41 becomes:
```ts
  const weights = await resolveAdaScoringWeights()
  await writeFindingsRun(mapAdaChildren(parent, children, weights))
```
Line 69 becomes:
```ts
  const weights = await resolveAdaScoringWeights()
  await writeFindingsRun(mapAdaSingle(audit, weights))
```
(A resolve failure throws — both functions are already wrapped in try/catch by every caller: the standalone hook, `findings-rebuild.ts`, and tests.)

- [ ] **Step 4: Implement threading in the finalizer (fallback semantics, never throws outward)**

In `lib/ada-audit/site-audit-finalizer.ts`, add imports:

```ts
import { resolveAdaScoringWeights } from '@/lib/scoring/resolve-ada-weights'
import { DEFAULT_ADA_V4_WEIGHTS } from '@/lib/scoring/ada-v4'
```

Inside the existing `try` block that wraps `mapAdaChildren` (line ~131), resolve first with a defaults fallback — a weights-table hiccup must not cost the dual-write:

```ts
      // C19 PR3: score with the operator profile; fall back to defaults rather
      // than lose the findings run to a transient weights-read failure.
      const adaWeights = await resolveAdaScoringWeights().catch((e) => {
        console.warn('[findings] ADA weights resolve failed — scoring with defaults:', (e as Error).message)
        return { ...DEFAULT_ADA_V4_WEIGHTS }
      })
      const bundle = mapAdaChildren(
        { /* unchanged parent literal */ },
        pageAudits,
        adaWeights,
      )
```

- [ ] **Step 5: Finalizer test**

In `lib/ada-audit/site-audit-finalizer.findings.test.ts`, add a test mirroring the file's existing dual-write assertion: seed `adaScoringWeights` (id 1, `critical: 80`) before finalizing a fixture audit with a critical violation, then assert the written run's `scoreBreakdown` critical `cap === 80`; clean the row in `afterEach`/end of test.

- [ ] **Step 6: Parity version-gate (PR1 follow-up: "parity score-diff noise on pre-C19 audits")**

In `lib/findings/parity.ts`:

(a) Widen `StoredRun` with `scoreBreakdown: string | null` (the `findUnique … include` calls already return every scalar, so no query change).

(b) Import `parseScoreMeta` and gate the ADA score comparisons in `diffAdaRun` on version AND stored weights hash (Codex #1 — version-only gating still false-positives on same-version runs written under a custom `AdaScoringWeights` profile; PR2's `parseScoreMeta` + `hashWeights` give the exact contract):

```ts
import { parseScoreMeta } from '@/lib/scoring/breakdown-version'
import { ADA_SCORE_VERSION, DEFAULT_ADA_V4_WEIGHTS } from '@/lib/scoring/ada-v4'
import { hashWeights } from '@/lib/scoring/weights-hash'
```

```ts
function diffAdaRun(run: StoredRun, expected: FindingsBundle, diffs: string[]): void {
  // Score comparisons are only meaningful when the stored run was scored by the
  // CURRENT formula version AT DEFAULT weights — parity always recomputes at
  // DEFAULT_ADA_V4_WEIGHTS, so a pre-v4 stored score OR a custom-profile stored
  // score vs the recompute is expected drift, not a parity failure. Structural
  // parity below is authoritative regardless of version/weights.
  const meta = parseScoreMeta(run.scoreBreakdown)
  const scoreComparable =
    meta.version === ADA_SCORE_VERSION && meta.weightsHash === hashWeights(DEFAULT_ADA_V4_WEIGHTS)
  if (run.status !== expected.run.status) diffs.push(`run status: tables=${run.status} blob=${expected.run.status}`)
  if (scoreComparable && run.score !== expected.run.score) diffs.push(`score: tables=${run.score} blob=${expected.run.score}`)
```
and in the per-page field loop, skip `score` when not comparable:
```ts
    for (const field of ['status', 'error', 'finalUrl', 'score', 'passCount', 'incompleteCount', 'adaAuditId'] as const) {
      if (field === 'score' && !scoreComparable) continue
      if (stored[field] !== p[field]) {
        diffs.push(`CrawlPage ${p.url} ${field}: tables=${stored[field]} blob=${p[field]}`)
      }
    }
```

(c) Same gate for the SEO comparator (its stored-v1 scores vs the v2-curve recompute are the same class of noise, and same-version custom-profile scores the same false positive — Codex #1). At the `compareSeoParity` score diff (line ~58), using the literal `2` that `PersistedBreakdownV2` pins:

```ts
  const seoMeta = parseScoreMeta(run.scoreBreakdown)
  const seoScoreComparable = seoMeta.version === 2 // PersistedBreakdownV2.version
    && seoMeta.weightsHash === hashWeights(DEFAULT_WEIGHTS)
  if (seoScoreComparable && run.score !== expected.run.score) diffs.push(`score: tables=${run.score} blob=${expected.run.score}`)
```
(the existing DEFAULT_WEIGHTS doc comment can now say the hash gate enforces what it previously only documented). The SEO run must be selected/passed with `scoreBreakdown` available — widen its local type the same way if needed.

(d) In `lib/findings/parity.test.ts` add: a stored ada run whose `scoreBreakdown` is `null` and whose `score` disagrees with the recompute → report contains NO `score:` / `CrawlPage … score` diffs; a stored run with a version-4 breakdown stamped `weightsHash: hashWeights(DEFAULT_ADA_V4_WEIGHTS)` and a wrong score → `score:` diff present; a version-4 breakdown stamped with a NON-default hash and a "wrong" score → NO score diff (Codex #1). Mirror the file's existing fixture builders.

(e) Codex #6 — close the write-path test gaps: add a `writeAdaSiteFindings` custom-cap test (seed `adaScoringWeights` critical: 80 → rebuild a fixture site audit → run breakdown critical cap is 80, mirroring the Step 2 standalone test), and a finalizer test where `resolveAdaScoringWeights` REJECTS (mock `@/lib/scoring/resolve-ada-weights` with `vi.mock` to throw) → the findings run is still written and its breakdown carries the DEFAULT caps — the stated dual-write safety invariant, pinned.

- [ ] **Step 7: Run all touched suites**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/ada-write.test.ts lib/ada-audit/site-audit-finalizer.findings.test.ts lib/findings/parity.test.ts lib/scoring/weights-hash.test.ts lib/findings/ada-mapper.test.ts lib/findings/seo-mapper.test.ts`
Expected: PASS (mapper suites confirm the cast removal broke nothing).

- [ ] **Step 8: Commit**

```bash
git add lib/scoring/weights-hash.ts lib/findings/seo-mapper.ts lib/findings/ada-mapper.ts lib/jobs/handlers/broken-link-verify.ts lib/findings/ada-write.ts lib/findings/ada-write.test.ts lib/ada-audit/site-audit-finalizer.ts lib/ada-audit/site-audit-finalizer.findings.test.ts lib/findings/parity.ts lib/findings/parity.test.ts
git commit -m "feat(c19-pr3): resolve+thread AdaScoringWeights through all ADA scoring writes; typed hashWeights; parity score diffs version-gated"
```

---

### Task 4: ADA settings route + card + settings page

**Files:**
- Create: `app/api/settings/ada-scoring-weights/route.ts`
- Create: `app/api/settings/ada-scoring-weights/route.test.ts`
- Create: `components/settings/AdaScoringWeightsCard.tsx`
- Create: `components/settings/AdaScoringWeightsCard.test.tsx`
- Modify: `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `validateAdaWeights`, `ADA_CAP_KEYS`, `ADA_WEIGHT_LABELS` (Task 2), `resolveAdaScoringWeights` (Task 2), `withRoute`/`parseJsonBody`/`HttpError` from `lib/api/`.
- Produces: `GET/PUT /api/settings/ada-scoring-weights` (GET → `{ weights: AdaV4Weights }`; PUT body = partial weights → 200 `{ weights }` or 400 `{ error }`). Task 7's Lab saves through this endpoint.

- [ ] **Step 1: Write the failing route tests**

Create `app/api/settings/ada-scoring-weights/route.test.ts` (mirror the structure/setup of `app/api/settings/scoring-weights/route.test.ts` — same request-construction style; use `NextRequest` if that file does):

```ts
import { it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { DEFAULT_ADA_V4_WEIGHTS } from '@/lib/scoring/ada-v4'
import { GET, PUT } from './route'

afterEach(async () => { await prisma.adaScoringWeights.deleteMany({ where: { id: 1 } }) })

const put = (body: unknown) => PUT(new Request('http://x/api/settings/ada-scoring-weights', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as never)

it('GET returns defaults when no row exists', async () => {
  const res = await GET()
  expect((await res.json()).weights).toEqual(DEFAULT_ADA_V4_WEIGHTS)
})
it('PUT validates, persists, and round-trips', async () => {
  const res = await put({ critical: 50, advisoryDiscount: 0.5 })
  expect(res.status).toBe(200)
  expect((await res.json()).weights.critical).toBe(50)
  const again = await GET()
  expect((await again.json()).weights).toMatchObject({ critical: 50, advisoryDiscount: 0.5 })
})
it('PUT rejects sum(caps) > 100 with a 400', async () => {
  const res = await put({ critical: 90, serious: 30 })
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(/sum/i)
})
it('PUT rejects malformed JSON with 400 invalid_json', async () => {
  const res = await PUT(new Request('http://x/api/settings/ada-scoring-weights', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'nope',
  }) as never)
  expect(res.status).toBe(400)
})
```
(Adjust the request typing to exactly match the sibling test file's convention.)

- [ ] **Step 2: Run to verify failure, then implement the route**

Create `app/api/settings/ada-scoring-weights/route.ts` (house A3 rule — `withRoute` + `parseJsonBody`, unlike the pre-A3 SEO sibling):

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { validateAdaWeights } from '@/lib/scoring/ada-weights'
import { resolveAdaScoringWeights } from '@/lib/scoring/resolve-ada-weights'

export const GET = withRoute(async () => {
  return NextResponse.json({ weights: await resolveAdaScoringWeights() })
})

export const PUT = withRoute(async (request: NextRequest) => {
  const body = await parseJsonBody<Record<string, unknown>>(request)
  const v = validateAdaWeights(body ?? {})
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
  await prisma.adaScoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...v }, update: { ...v } })
  return NextResponse.json({ weights: v })
})
```
(`AdaScoringWeights` has exactly the six `AdaV4Weights` columns + id + updatedAt, so the spread is safe — no pick needed.)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/settings/ada-scoring-weights/route.test.ts` → PASS.

- [ ] **Step 3: Write the failing card test**

Create `components/settings/AdaScoringWeightsCard.test.tsx` mirroring `ScoringWeightsCard.test.tsx`'s fetch-mock setup:
- renders the six labeled inputs (`Critical cap` … `Advisory discount (0–1)`) after the GET resolves;
- Save PUTs the whole weights object to `/api/settings/ada-scoring-weights` and shows `Saved.`;
- a 400 response renders the server `error` string;
- `Reset to defaults` restores `DEFAULT_ADA_V4_WEIGHTS` in the inputs.

- [ ] **Step 4: Implement the card**

Create `components/settings/AdaScoringWeightsCard.tsx` — mirror `ScoringWeightsCard.tsx`'s exact classNames and state shape:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { DEFAULT_ADA_V4_WEIGHTS, type AdaV4Weights } from '@/lib/scoring/ada-v4'
import { ADA_WEIGHT_LABELS } from '@/lib/scoring/ada-weights'

const KEYS: readonly (keyof AdaV4Weights)[] = ['critical', 'serious', 'moderate', 'minor', 'needsReview', 'advisoryDiscount']

export function AdaScoringWeightsCard() {
  const [weights, setWeights] = useState<AdaV4Weights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { fetch('/api/settings/ada-scoring-weights').then(r => r.json()).then(d => setWeights(d.weights)).catch(() => {}) }, [])
  if (!weights) return null
  async function save() {
    setError(null); setSaved(false)
    const res = await fetch('/api/settings/ada-scoring-weights', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(weights) })
    if (res.ok) setSaved(true); else setError((await res.json()).error ?? 'Save failed.')
  }
  return (
    <section className="mt-6 bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">ADA scoring weights</h2>
      <p className="text-[12px] font-body text-gray-500 dark:text-white/50 mb-4">Caps are absolute deductions per severity category (they must sum to at most 100); the advisory discount (0–1) reduces best-practice-only rules. Weights apply to future scans only; existing audits keep their scored breakdown.</p>
      <div className="grid grid-cols-2 gap-4">
        {KEYS.map((k) => (
          <label key={k} className="text-[13px] font-body text-navy dark:text-white">{ADA_WEIGHT_LABELS[k]}
            <input type="number" min={0} max={k === 'advisoryDiscount' ? 1 : 100} step={k === 'advisoryDiscount' ? 0.05 : 1} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-navy dark:text-white" />
          </label>
        ))}
      </div>
      {error && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="mt-3 text-[13px] text-green-700 dark:text-green-400">Saved.</p>}
      <div className="mt-4 flex gap-3">
        <button onClick={save} className="rounded-lg bg-navy text-white dark:bg-white dark:text-navy px-4 py-2 text-[13px] font-heading font-semibold">Save</button>
        <button onClick={() => { setWeights(DEFAULT_ADA_V4_WEIGHTS); setSaved(false); setError(null) }} className="rounded-lg border border-gray-300 dark:border-navy-border px-4 py-2 text-[13px] font-body text-navy dark:text-white">Reset to defaults</button>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Wire the settings page**

In `app/(app)/settings/page.tsx`: import and render `<AdaScoringWeightsCard />` after `<ScoringWeightsCard />`; update the description sentence to `Google service-account connection status, monthly report schedule, and scoring weights.`; add the Score Lab link beside the ops link:

```tsx
          <p className="mt-2 text-sm font-body flex gap-4">
            <a href="/admin/ops" className="text-blue-600 dark:text-blue-400 hover:underline">Ops dashboard →</a>
            <a href="/score-lab" className="text-blue-600 dark:text-blue-400 hover:underline">Score Lab →</a>
          </p>
```
(The `/score-lab` page lands in Task 7 — a dead link for two tasks on a feature branch is fine.)

- [ ] **Step 6: Run suites + commit**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/settings/ada-scoring-weights/route.test.ts components/settings/AdaScoringWeightsCard.test.tsx`
Expected: PASS.

```bash
git add app/api/settings/ada-scoring-weights components/settings/AdaScoringWeightsCard.tsx components/settings/AdaScoringWeightsCard.test.tsx "app/(app)/settings/page.tsx"
git commit -m "feat(c19-pr3): /settings ADA weights card + ada-scoring-weights API"
```

---

### Task 5: `GET /api/scoring/lab-inputs` + ada-v4-inputs determinism minors

**Files:**
- Create: `app/api/scoring/lab-inputs/route.ts`
- Create: `app/api/scoring/lab-inputs/route.test.ts`
- Modify: `lib/scoring/ada-v4-inputs.server.ts:51-54` (violation `orderBy` — PR1 minor)
- Test: `lib/scoring/ada-v4-inputs.server.test.ts` (malformed-wcagTags case — PR1 minor)

**Interfaces:**
- Consumes: `loadAdaV4InputsForRun(runId): Promise<AdaV4Inputs | null>`, `parseScoreMeta`, `withRoute`, `HttpError`.
- Produces (Task 7 consumes these exact shapes):
  - `GET ?list=1` → `{ runs: { id, domain, tool, source, score, createdAt }[] }` (25 most recent complete CrawlRuns)
  - `GET ?runId=<id>` → one of:
    - `{ kind: 'ada', inputs: AdaV4Inputs, current }`
    - `{ kind: 'seo', scorer: 'health' | 'live-seo', snapshot: SeoInputsSnapshot, current }`
    - `{ kind: 'unavailable', reason: string, current }`
    where `current = { score, version, weightsHash, domain, tool, source }`
  - 400 `missing_run_id` without either param; 404 `not_found` for an unknown runId.

- [ ] **Step 1: PR1 determinism minor — mapper-order violation aggregation + malformed-wcagTags test (Codex #2)**

The first-seen impact/advisory aggregation in `lib/scoring/ada-v4-inputs.server.ts` depends on row order, and `Violation.id` is a mapper-generated `randomUUID` — `orderBy: { id: 'asc' }` would be deterministic but would NOT reproduce `mapAdaChildren`'s order (children walked `createdAt asc, id asc`), so replay/Lab could recompute a different score than the mapper stamped whenever a rule's impact or tags differ across pages. Reconstruct the source-child order instead (within a page each rule appears at most once, so only cross-page order matters):

```ts
  const pages = await prisma.crawlPage.findMany({
    where: { runId },
    select: { id: true, score: true, incompleteCount: true, adaAuditId: true },
  })
  // …existing scoredPages/meanIncomplete logic unchanged…

  const violations = await prisma.violation.findMany({
    where: { runId, finding: { scope: 'page' } },
    select: { pageId: true, ruleId: true, impact: true, wcagTags: true },
  })

  // Mirror mapAdaChildren's first-seen semantics: children are walked in
  // (createdAt asc, id asc) order, so rank each page by its source AdaAudit.
  // Pages whose child row is gone (SetNull after audit deletion) sort last,
  // deterministically by page id.
  const childIds = [...new Set(pages.map((p) => p.adaAuditId).filter((x): x is string => x !== null))]
  const children = childIds.length
    ? await prisma.adaAudit.findMany({
        where: { id: { in: childIds } },
        select: { id: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : []
  const childRank = new Map(children.map((c, i) => [c.id, i]))
  const pageRank = new Map(pages.map((p) => [
    p.id,
    p.adaAuditId !== null && childRank.has(p.adaAuditId) ? childRank.get(p.adaAuditId)! : Number.MAX_SAFE_INTEGER,
  ]))
  violations.sort((a, b) =>
    (pageRank.get(a.pageId) ?? Number.MAX_SAFE_INTEGER) - (pageRank.get(b.pageId) ?? Number.MAX_SAFE_INTEGER) ||
    a.pageId.localeCompare(b.pageId) || a.ruleId.localeCompare(b.ruleId))
```
(standalone `page-audit` runs have a single page — the sort is a no-op there).

In `lib/scoring/ada-v4-inputs.server.test.ts`, add (mirror the file's fixture builders):

```ts
it('resolves conflicting per-page impacts in source-child order, matching the mapper', async () => {
  // Two children: the one created FIRST carries the rule at impact 'moderate',
  // the one created SECOND at 'serious'. Insert the Violation rows in REVERSED
  // order so a naive row-order walk would land on 'serious'. The mapper's
  // first-seen-non-unknown across CHILD order must land on 'moderate'.
  const inputs = await loadAdaV4InputsForRun(runId)
  expect(inputs!.rules.find((r) => r.ruleId === 'conflicted-rule')!.impact).toBe('moderate')
})
```
plus the missing malformed-tags case:

```ts
it('treats malformed wcagTags JSON as no tags — never advisory', async () => {
  // build a run whose single violation row has wcagTags: 'not-json'
  const inputs = await loadAdaV4InputsForRun(runId)
  expect(inputs!.rules[0].advisory).toBe(false)
})
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/ada-v4-inputs.server.test.ts` → PASS.

- [ ] **Step 2: Write the failing route tests**

Create `app/api/scoring/lab-inputs/route.test.ts` (DB-backed; build minimal `crawlRun`/`crawlPage`/`finding`/`violation` fixtures the way `ada-v4-inputs.server.test.ts` does):

```ts
import { describe, it, expect } from 'vitest'
import { GET } from './route'

const get = (qs: string) => GET(new Request(`http://x/api/scoring/lab-inputs${qs}`) as never)

it('?list=1 returns recent complete runs, newest first, capped at 25', async () => {
  const res = await get('?list=1')
  expect(res.status).toBe(200)
  const { runs } = await res.json()
  expect(Array.isArray(runs)).toBe(true)
  expect(runs.length).toBeLessThanOrEqual(25)
})
it('400s without runId or list', async () => {
  expect((await get('')).status).toBe(400)
})
it('404s on an unknown runId', async () => {
  expect((await get('?runId=nope')).status).toBe(404)
})
it('returns kind ada with rebuilt inputs for an ada-audit run with scored pages', async () => {
  // fixture: ada-audit CrawlRun + one scored CrawlPage + one page-scope Finding+Violation
  const res = await get(`?runId=${adaRunId}`)
  const body = await res.json()
  expect(body.kind).toBe('ada')
  expect(body.inputs.pagesAudited).toBe(1)
  expect(body.current.tool).toBe('ada-audit')
})
it('returns kind unavailable for an ada run with zero scored pages', async () => {
  const res = await get(`?runId=${emptyAdaRunId}`)
  expect((await res.json()).kind).toBe('unavailable')
})
it('returns kind seo with the v2 inputsSnapshot for a post-C19 seo run', async () => {
  // fixture: seo-parser CrawlRun whose scoreBreakdown is a serialized PersistedBreakdownV2
  const res = await get(`?runId=${seoV2RunId}`)
  const body = await res.json()
  expect(body.kind).toBe('seo')
  expect(body.scorer).toBe('live-seo')
  expect(body.snapshot.source).toBe('live')
})
it('returns kind unavailable ("scored before C19") for a v1/blank-breakdown seo run', async () => {
  const res = await get(`?runId=${seoV1RunId}`)
  const body = await res.json()
  expect(body.kind).toBe('unavailable')
  expect(body.reason).toMatch(/before C19/)
})
it('returns kind unavailable for a non-complete run (Codex #4)', async () => {
  // fixture: CrawlRun with status 'partial'
  const res = await get(`?runId=${partialRunId}`)
  expect((await res.json()).kind).toBe('unavailable')
})
it('returns kind unavailable for a v2 breakdown whose snapshot is malformed (Codex #4)', async () => {
  // fixture: seo run whose scoreBreakdown is {"version":2,"scorer":"live-seo","inputsSnapshot":{"source":"live","attempted":"NaN-ish"}}
  const res = await get(`?runId=${malformedSnapshotRunId}`)
  expect((await res.json()).kind).toBe('unavailable')
})
```

Run to verify failure (module not found).

- [ ] **Step 3: Implement the route**

Create `app/api/scoring/lab-inputs/route.ts`:

```ts
// GET /api/scoring/lab-inputs — Score Lab data source (C19 PR3). Cookie-gated
// by default (no middleware entry). ?list=1 → recent complete runs to pick
// from; ?runId= → a compact scoring-inputs payload the browser can re-score
// with the pure scorers. ADA works for ANY run with findings tables (90-d
// archives included); SEO what-if needs the v2 breakdown's inputsSnapshot —
// pre-C19 runs surface as kind:'unavailable'. No blob reads here, ever.
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { loadAdaV4InputsForRun } from '@/lib/scoring/ada-v4-inputs.server'
import { parseScoreMeta } from '@/lib/scoring/breakdown-version'
import type { SeoInputsSnapshot } from '@/lib/scoring/seo-core'

export const GET = withRoute(async (request: NextRequest) => {
  const url = new URL(request.url)
  if (url.searchParams.get('list') === '1') {
    const runs = await prisma.crawlRun.findMany({
      where: { status: 'complete' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, domain: true, tool: true, source: true, score: true, createdAt: true },
    })
    return NextResponse.json({ runs })
  }

  const runId = url.searchParams.get('runId')
  if (!runId) throw new HttpError(400, 'missing_run_id')
  const run = await prisma.crawlRun.findUnique({
    where: { id: runId },
    select: { id: true, tool: true, source: true, status: true, score: true, scoreBreakdown: true, domain: true },
  })
  if (!run) throw new HttpError(404, 'not_found')

  const meta = parseScoreMeta(run.scoreBreakdown)
  const current = {
    score: run.score, version: meta.version, weightsHash: meta.weightsHash,
    domain: run.domain, tool: run.tool, source: run.source,
  }

  // Codex #4: the list only offers complete runs, but runId is user-supplied —
  // a partial run's inputs/snapshot describe an unfinished crawl.
  if (run.status !== 'complete') {
    return NextResponse.json({ kind: 'unavailable', reason: 'run is not complete', current })
  }

  if (run.tool === 'ada-audit') {
    const inputs = await loadAdaV4InputsForRun(runId)
    if (!inputs) return NextResponse.json({ kind: 'unavailable', reason: 'no scored pages on this run', current })
    return NextResponse.json({ kind: 'ada', inputs, current })
  }

  // seo-parser: only post-C19 v2 breakdowns carry the raw-inputs snapshot.
  if (run.scoreBreakdown) {
    try {
      const parsed = JSON.parse(run.scoreBreakdown) as {
        version?: unknown; scorer?: unknown; inputsSnapshot?: unknown
      }
      if (parsed.version === 2 && (parsed.scorer === 'health' || parsed.scorer === 'live-seo')
          && isValidSeoSnapshot(parsed.inputsSnapshot)) {
        return NextResponse.json({ kind: 'seo', scorer: parsed.scorer, snapshot: parsed.inputsSnapshot, current })
      }
    } catch { /* fall through to unavailable */ }
  }
  return NextResponse.json({ kind: 'unavailable', reason: 'what-if unavailable (scored before C19 — no inputs snapshot)', current })
})

// Codex #4: never ship a malformed/non-finite snapshot to the client recompute.
// Checks the discriminant + every REQUIRED numeric field of the matching variant
// (nullable/optional fields — avgCrawlDepth, thinCount, pagesWithSchema,
// linkVerification, the availability booleans — are shape-checked only if present).
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
function isValidSeoSnapshot(v: unknown): v is SeoInputsSnapshot {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  if (s.source === 'sf') {
    return (['totalUrls', 'indexableUrls', 'clientErrors', 'serverErrors', 'base', 'missingTitle', 'missingMeta', 'missingH1'] as const)
      .every((k) => finite(s[k]))
  }
  if (s.source === 'live') {
    return (['attempted', 'observed', 'indexableScored', 'pagesError', 'missingTitle', 'missingMeta', 'missingH1', 'thin', 'pagesWithSchema'] as const)
      .every((k) => finite(s[k]))
  }
  return false
}
```

- [ ] **Step 4: Run + commit**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/scoring/lab-inputs/route.test.ts lib/scoring/ada-v4-inputs.server.test.ts`
Expected: PASS.

```bash
git add app/api/scoring/lab-inputs lib/scoring/ada-v4-inputs.server.ts lib/scoring/ada-v4-inputs.server.test.ts
git commit -m "feat(c19-pr3): lab-inputs API (ADA any-run, SEO v2-snapshot runs) + deterministic v4-inputs orderBy"
```

---

### Task 6: `recomputeSeoScore` — client-safe what-if recompute from a v2 snapshot

**Files:**
- Modify: `lib/scoring/seo-core.ts` (`SfInputsSnapshot` gains optional availability booleans — Codex #3)
- Modify: `lib/services/scoring.service.ts` (snapshot construction sets them)
- Create: `lib/scoring/seo-recompute.ts`
- Create: `lib/scoring/seo-recompute.test.ts`
- Test (updates): `lib/services/scoring.service.test.ts` or wherever the snapshot shape is pinned — extend, don't weaken

**Interfaces:**
- Consumes: curve fns + snapshot types from `lib/scoring/seo-core`; `scoreLiveSeo` from `@/lib/findings/live-seo-score` (pure + client-safe — imports only lib/scoring modules; no dependency cycle: weights/seo-core never import this file).
- Produces: `recomputeSeoScore(snapshot: SeoInputsSnapshot, weights: ScoringWeights): ScoreResult` — Task 7's SEO what-if; `SfInputsSnapshot.indexableKnown?/errorsKnown?: boolean` (additive, optional — old persisted snapshots simply lack them).

- [ ] **Step 0: Availability booleans on the SF snapshot (Codex #3)**

`computeHealthScore` distinguishes ABSENT `indexable_urls`/`client_errors`/`server_errors` from literal 0 (absent → factor skipped), but PR2's snapshot stored them `?? 0` — collapsing the two cases, so a snapshot recompute cannot fully mirror availability. Fix forward, additively:

In `lib/scoring/seo-core.ts`, extend `SfInputsSnapshot`:

```ts
export interface SfInputsSnapshot {
  source: 'sf'
  totalUrls: number; indexableUrls: number; clientErrors: number; serverErrors: number
  base: number; missingTitle: number; missingMeta: number; missingH1: number
  avgCrawlDepth: number | null; thinCount: number | null; pagesWithSchema: number | null
  /** C19 PR3 (Codex #3): whether the blob actually carried indexable_urls /
   *  client+server error counts — absent fields are NOT a literal 0 for factor
   *  availability. Optional: pre-PR3 v2 snapshots lack them, and the recompute
   *  falls back to the documented lossy assumption (present ⇒ available). */
  indexableKnown?: boolean
  errorsKnown?: boolean
}
```

In `lib/services/scoring.service.ts`, set them in the `inputsSnapshot` literal:

```ts
    indexableKnown: summary.indexable_urls !== undefined,
    errorsKnown: summary.client_errors !== undefined && summary.server_errors !== undefined,
```

- [ ] **Step 1: Write the failing contract tests**

Create `lib/scoring/seo-recompute.test.ts`. The contract: recomputing from a snapshot must equal running the real adapter on the original inputs — for ANY weights profile (that's what makes the Lab honest).

```ts
import { describe, it, expect } from 'vitest'
import { computeHealthScore } from '@/lib/services/scoring.service'
import { scoreLiveSeo, type LiveScoreInputs } from '@/lib/findings/live-seo-score'
import { DEFAULT_WEIGHTS, type ScoringWeights } from './weights'
import { recomputeSeoScore } from './seo-recompute'
import type { AggregatedResult } from '@/lib/types'

// Minimal SF blob: 100 urls, 90 indexable, 4 client + 1 server errors,
// 12 missing titles / 6 metas / 3 h1s, depth 3.4, 8 thin, 40 with schema.
const sfBlob = {
  crawl_summary: { total_urls: 100, indexable_urls: 90, client_errors: 4, server_errors: 1, avg_crawl_depth: 3.4 },
  issues: {
    critical: [{ type: 'missing_title', count: 12 }],
    warnings: [{ type: 'missing_meta_description', count: 6 }, { type: 'thin_content', count: 8 }],
    notices: [{ type: 'missing_h1', count: 3 }],
  },
  technical_seo: { structured_data: { pages_with_schema: 40 } },
} as unknown as AggregatedResult

const liveInputs: LiveScoreInputs = {
  attempted: 60, observed: 55, indexableScored: 50, pagesError: 2,
  missingTitle: 4, missingMeta: 6, missingH1: 1, thin: 5, pagesWithSchema: 30,
  linkVerification: { internalChecked: 200, internalBroken: 4, imagesChecked: 40, imagesBroken: 1, passComplete: true },
}

const CUSTOM: ScoringWeights = { ...DEFAULT_WEIGHTS, indexability: 5, errorRate: 30, brokenLinks: 25, crawlDepth: 0 }

describe('sf snapshot recompute mirrors computeHealthScore', () => {
  for (const [name, w] of [['defaults', DEFAULT_WEIGHTS], ['custom profile', CUSTOM]] as const) {
    it(`score+factors identical under ${name}`, () => {
      const snapshot = computeHealthScore(sfBlob, DEFAULT_WEIGHTS).inputsSnapshot // snapshot is weights-independent
      const direct = computeHealthScore(sfBlob, w)
      const re = recomputeSeoScore(snapshot, w)
      expect(re.score).toBe(direct.score)
      expect(re.factors).toEqual(direct.factors)
    })
  }
  it('null-marked fields renormalize away (no crawlDepth/thin/schema factors)', () => {
    const snapshot = { ...computeHealthScore(sfBlob, DEFAULT_WEIGHTS).inputsSnapshot, avgCrawlDepth: null, thinCount: null, pagesWithSchema: null }
    const re = recomputeSeoScore(snapshot, DEFAULT_WEIGHTS)
    const keys = re.factors.map((f) => f.key)
    expect(keys).not.toContain('crawlDepth')
    expect(keys).not.toContain('thinContent')
    expect(keys).not.toContain('schema')
  })
  it('brokenLinks is never a factor for an sf snapshot', () => {
    const snapshot = computeHealthScore(sfBlob, DEFAULT_WEIGHTS).inputsSnapshot
    expect(recomputeSeoScore(snapshot, CUSTOM).factors.map((f) => f.key)).not.toContain('brokenLinks')
  })
  it('mirrors availability for blobs with UNDEFINED indexable/error fields (Codex #3)', () => {
    const sparseBlob = {
      crawl_summary: { total_urls: 100 }, // no indexable_urls, no client/server errors
      issues: { critical: [], warnings: [], notices: [] },
    } as unknown as AggregatedResult
    const direct = computeHealthScore(sparseBlob, DEFAULT_WEIGHTS)
    const re = recomputeSeoScore(direct.inputsSnapshot, DEFAULT_WEIGHTS)
    expect(direct.inputsSnapshot.indexableKnown).toBe(false)
    expect(direct.inputsSnapshot.errorsKnown).toBe(false)
    expect(re.score).toBe(direct.score)
    expect(re.factors).toEqual(direct.factors) // neither includes indexability/errorRate
  })
  it('pre-PR3 snapshots (no booleans) fall back to the lossy present-implies-available rule', () => {
    const snapshot = computeHealthScore(sfBlob, DEFAULT_WEIGHTS).inputsSnapshot
    const legacy = { ...snapshot }
    delete (legacy as Record<string, unknown>).indexableKnown
    delete (legacy as Record<string, unknown>).errorsKnown
    expect(recomputeSeoScore(legacy, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(sfBlob, DEFAULT_WEIGHTS).score)
  })
})

describe('live snapshot recompute mirrors scoreLiveSeo', () => {
  for (const [name, w] of [['defaults', DEFAULT_WEIGHTS], ['custom profile', CUSTOM]] as const) {
    it(`score+factors identical under ${name}`, () => {
      const snapshot = scoreLiveSeo(liveInputs, DEFAULT_WEIGHTS).inputsSnapshot
      const direct = scoreLiveSeo(liveInputs, w)
      const re = recomputeSeoScore(snapshot, w)
      expect(re.score).toBe(direct.score)
      expect(re.factors).toEqual(direct.factors)
    })
  }
  it('re-applies the live null gates (a null-scored run stays null under any weights)', () => {
    const gated = scoreLiveSeo({ ...liveInputs, indexableScored: 0 }, DEFAULT_WEIGHTS)
    expect(recomputeSeoScore(gated.inputsSnapshot, CUSTOM).score).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/seo-recompute.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/scoring/seo-recompute.ts`**

```ts
// lib/scoring/seo-recompute.ts — pure, client-safe (C19 PR3). Score Lab what-if:
// recompute a run's SEO score from its persisted v2 inputsSnapshot under
// arbitrary weights. Live snapshots delegate to the real adapter (scoreLiveSeo
// is pure and client-safe — the snapshot IS its input shape, so availability
// rules and null gates are literally the same code). SF snapshots get a local
// mirror of computeHealthScore's availability rules (that adapter takes the
// whole blob, which the Lab never loads).
//
// SF availability (Codex #3): post-PR3 snapshots carry indexableKnown/
// errorsKnown, making the availability mirror exact. Pre-PR3 v2 snapshots
// stored indexableUrls/clientErrors/serverErrors with a `?? 0` fallback and no
// booleans — for those, `?? true` retains the documented lossy assumption
// (treated as available whenever totalUrls > 0; SF crawl summaries in practice
// always carry these fields).
import type { ScoreBreakdownFactor, ScoreResult, ScoringWeights } from './weights'
import { WEIGHT_LABELS } from './weights'
import {
  indexabilityPoints, errorRatePoints, missingElementPoints, crawlDepthPoints,
  thinContentPoints, schemaPoints,
  type SeoInputsSnapshot, type SfInputsSnapshot,
} from './seo-core'
import { scoreLiveSeo } from '@/lib/findings/live-seo-score'

export function recomputeSeoScore(snapshot: SeoInputsSnapshot, weights: ScoringWeights): ScoreResult {
  if (snapshot.source === 'live') {
    const { score, factors } = scoreLiveSeo({
      attempted: snapshot.attempted, observed: snapshot.observed,
      indexableScored: snapshot.indexableScored, pagesError: snapshot.pagesError,
      missingTitle: snapshot.missingTitle, missingMeta: snapshot.missingMeta,
      missingH1: snapshot.missingH1, thin: snapshot.thin,
      pagesWithSchema: snapshot.pagesWithSchema, linkVerification: snapshot.linkVerification,
    }, weights)
    return { score, factors }
  }
  return recomputeSfScore(snapshot, weights)
}

function recomputeSfScore(s: SfInputsSnapshot, weights: ScoringWeights): ScoreResult {
  let earned = 0
  let possible = 0
  const factors: ScoreBreakdownFactor[] = []
  const addFactor = (key: keyof ScoringWeights, pts: number): void => {
    const weight = weights[key]
    const e = Math.min(weight, Math.max(0, pts))
    earned += e
    possible += weight
    factors.push({ key, label: WEIGHT_LABELS[key], weight, earned: e, possible: weight })
  }

  if (s.totalUrls > 0 && (s.indexableKnown ?? true) && weights.indexability > 0) {
    addFactor('indexability', indexabilityPoints(s.indexableUrls / s.totalUrls, weights.indexability))
  }
  if (s.totalUrls > 0 && (s.errorsKnown ?? true) && weights.errorRate > 0) {
    addFactor('errorRate', errorRatePoints((s.clientErrors + s.serverErrors) / s.totalUrls, weights.errorRate))
  }
  if (s.base > 0) {
    if (weights.missingTitle > 0) addFactor('missingTitle', missingElementPoints(s.missingTitle / s.base, weights.missingTitle))
    if (weights.missingMeta > 0) addFactor('missingMeta', missingElementPoints(s.missingMeta / s.base, weights.missingMeta))
    if (weights.missingH1 > 0) addFactor('missingH1', missingElementPoints(s.missingH1 / s.base, weights.missingH1))
  }
  if (s.avgCrawlDepth !== null && weights.crawlDepth > 0) {
    addFactor('crawlDepth', crawlDepthPoints(s.avgCrawlDepth, weights.crawlDepth))
  }
  if (s.thinCount !== null && s.indexableUrls > 0 && weights.thinContent > 0) {
    addFactor('thinContent', thinContentPoints(s.thinCount / s.indexableUrls, weights.thinContent))
  }
  if (s.pagesWithSchema !== null && s.totalUrls > 0 && weights.schema > 0) {
    addFactor('schema', schemaPoints(s.pagesWithSchema / s.totalUrls, weights.schema))
  }
  // brokenLinks: never available for SF runs — no verification pass exists there.

  const score = possible === 0 ? 0 : Math.min(100, Math.max(0, Math.round((earned / possible) * 100)))
  return { score, factors }
}
```

- [ ] **Step 4: Run tests + existing suites**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/scoring/seo-recompute.test.ts lib/scoring/seo-calibration.test.ts lib/findings/live-seo-score.test.ts`
Expected: PASS — calibration bands untouched.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/seo-recompute.ts lib/scoring/seo-recompute.test.ts
git commit -m "feat(c19-pr3): recomputeSeoScore — client-safe SEO what-if from v2 inputsSnapshot (contract-tested against both adapters)"
```

---

### Task 7: Score Lab page

**Files:**
- Create: `app/(app)/score-lab/page.tsx`
- Create: `components/score-lab/ScoreLabClient.tsx`
- Create: `components/score-lab/ScoreLabClient.test.tsx`
- Modify: `lib/tools-registry.ts` (hidden entry)

**Interfaces:**
- Consumes: `GET /api/scoring/lab-inputs` payloads (Task 5 shapes), `computeAdaScoreV4`/`DEFAULT_ADA_V4_WEIGHTS`/`AdaV4Inputs`/`AdaV4Weights` (client-safe), `ADA_WEIGHT_LABELS` (Task 2), `recomputeSeoScore` (Task 6), `serializeBreakdown` + `DEFAULT_WEIGHTS`/`WEIGHT_LABELS`/`PERSISTABLE_WEIGHT_KEYS` from `lib/scoring/weights`, `AdaScoreExplanation`/`ScoreExplanation` (both render from a serialized breakdown string — the Lab serializes its client-side recompute and feeds them verbatim), both settings endpoints for load/save.
- Produces: `/score-lab` (cookie-gated, hidden from nav, linked from /settings).

- [ ] **Step 1: Registry entry**

In `lib/tools-registry.ts`, append to the hidden block:

```ts
  { id: 'score-lab', name: 'Score Lab', href: '/score-lab', group: 'footer', icon: IconSettings, description: 'Scoring what-if sandbox', hidden: true },
```

- [ ] **Step 2: Write the failing component tests**

Create `components/score-lab/ScoreLabClient.test.tsx` (fetch-mocked like `ScoringWeightsCard.test.tsx`; `act()` not `waitFor` under fake timers). Cases:

- renders the run list from `?list=1` (mock returns one ada + one seo run; expect both domains listed);
- selecting an ada run renders the current score, a what-if score, and the six ADA sliders; dragging (fire `change` on) the `Critical cap` input updates the what-if score (recompute is client-side — mock only the lab-inputs fetch, compute is real);
- selecting a pre-C19 seo run (`kind: 'unavailable'`) renders the reason copy;
- "Save as ADA defaults" PUTs the current slider values to `/api/settings/ada-scoring-weights`;
- setting caps that sum past 100 (e.g. critical → 90) renders the validation error and DISABLES the ADA save button (Codex #5);
- the what-if caption ("not the weights the run was scored with") renders with each breakdown panel;
- the historical-scores banner copy is present (`getAllByText` if repeated).

Fixture for the ada payload — a real `AdaV4Inputs` value so the recompute is meaningful:

```ts
const adaPayload = {
  kind: 'ada',
  inputs: { pagesAudited: 10, pagesTotal: 10, meanIncomplete: 0, rules: [
    { ruleId: 'image-alt', impact: 'critical', advisory: false, pagesAffected: 5 },
    { ruleId: 'link-name', impact: 'serious', advisory: false, pagesAffected: 8 },
  ] },
  current: { score: 62, version: 4, weightsHash: 'abc123def456', domain: 'example.com', tool: 'ada-audit', source: 'site-audit' },
}
```

Run to verify failure (module not found).

- [ ] **Step 3: Implement the page shell**

Create `app/(app)/score-lab/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { ScoreLabClient } from '@/components/score-lab/ScoreLabClient'

export const metadata: Metadata = { title: 'Score Lab — ER SEO Tools' }

export default function ScoreLabPage() {
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display font-extrabold text-2xl text-navy dark:text-white mb-1">Score Lab</h1>
          <p className="text-sm font-body text-gray-500 dark:text-white/50">
            Pick a recent run, drag the weights, and watch the score recompute live — nothing is saved until you say so.
          </p>
        </div>
        <ScoreLabClient />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Implement `ScoreLabClient`**

Create `components/score-lab/ScoreLabClient.tsx`:

```tsx
'use client'
// C19 PR3 Score Lab. All recomputes happen IN THE BROWSER through the pure
// scorers — the API only ships compact input snapshots. Never hash weights
// client-side (weights-hash.ts is server-only); a what-if breakdown renders
// as "unhashed"/hash-free by design.
import { useEffect, useMemo, useState } from 'react'
import { computeAdaScoreV4, DEFAULT_ADA_V4_WEIGHTS, type AdaV4Inputs, type AdaV4Weights } from '@/lib/scoring/ada-v4'
import { ADA_WEIGHT_LABELS, validateAdaWeights } from '@/lib/scoring/ada-weights'
import { DEFAULT_WEIGHTS, WEIGHT_LABELS, PERSISTABLE_WEIGHT_KEYS, serializeBreakdown, type ScoringWeights } from '@/lib/scoring/weights'
import type { SeoInputsSnapshot } from '@/lib/scoring/seo-core'
import { recomputeSeoScore } from '@/lib/scoring/seo-recompute'
import { AdaScoreExplanation } from '@/components/scoring/AdaScoreExplanation'
import { ScoreExplanation } from '@/components/scoring/ScoreExplanation'

interface RunListItem { id: string; domain: string | null; tool: string; source: string; score: number | null; createdAt: string }
interface CurrentMeta { score: number | null; version: number; weightsHash: string | null; domain: string | null; tool: string; source: string }
type LabPayload =
  | { kind: 'ada'; inputs: AdaV4Inputs; current: CurrentMeta }
  | { kind: 'seo'; scorer: 'health' | 'live-seo'; snapshot: SeoInputsSnapshot; current: CurrentMeta }
  | { kind: 'unavailable'; reason: string; current: CurrentMeta }

const ADA_KEYS: readonly (keyof AdaV4Weights)[] = ['critical', 'serious', 'moderate', 'minor', 'needsReview', 'advisoryDiscount']

export function ScoreLabClient() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [payload, setPayload] = useState<LabPayload | null>(null)
  const [adaWeights, setAdaWeights] = useState<AdaV4Weights>(DEFAULT_ADA_V4_WEIGHTS)
  const [seoWeights, setSeoWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/scoring/lab-inputs?list=1').then(r => r.json()).then(d => setRuns(d.runs)).catch(() => setRuns([]))
    fetch('/api/settings/ada-scoring-weights').then(r => r.json()).then(d => { if (d.weights) setAdaWeights(d.weights) }).catch(() => {})
    fetch('/api/settings/scoring-weights').then(r => r.json()).then(d => { if (d.weights) setSeoWeights(d.weights) }).catch(() => {})
  }, [])

  async function selectRun(id: string) {
    setSelectedId(id); setPayload(null); setSaveMsg(null)
    try {
      const res = await fetch(`/api/scoring/lab-inputs?runId=${encodeURIComponent(id)}`)
      setPayload(await res.json())
    } catch { setPayload(null) }
  }

  const adaWhatIf = useMemo(() => {
    if (payload?.kind !== 'ada') return null
    try { return computeAdaScoreV4(payload.inputs, adaWeights) } catch { return null }
  }, [payload, adaWeights])

  // Codex #5: never offer a Save for a profile the settings endpoint would
  // reject — validate client-side with the same function the PUT route uses.
  const adaValidationError = useMemo(() => {
    const v = validateAdaWeights(adaWeights)
    return 'error' in v ? v.error : null
  }, [adaWeights])

  const seoWhatIf = useMemo(() => {
    if (payload?.kind !== 'seo') return null
    return recomputeSeoScore(payload.snapshot, seoWeights)
  }, [payload, seoWeights])

  async function save(url: string, body: unknown, label: string) {
    setSaveMsg(null)
    const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) setSaveMsg(`${label} saved — future scans use these weights.`)
    else setSaveMsg((await res.json()).error ?? 'Save failed.')
  }

  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-4">
        <h2 className="text-[13px] font-heading font-semibold text-navy dark:text-white mb-2">Recent runs</h2>
        {runs === null && <p className="text-[12px] font-body text-gray-500 dark:text-white/50">Loading…</p>}
        {runs?.length === 0 && <p className="text-[12px] font-body text-gray-500 dark:text-white/50">No completed runs yet.</p>}
        <ul className="space-y-1">
          {runs?.map((r) => (
            <li key={r.id}>
              <button onClick={() => selectRun(r.id)}
                className={`w-full text-left rounded-lg px-2 py-1.5 text-[12px] font-body ${selectedId === r.id ? 'bg-navy text-white dark:bg-white dark:text-navy' : 'text-navy dark:text-white hover:bg-gray-100 dark:hover:bg-navy-deep'}`}>
                <span className="block truncate font-semibold">{r.domain ?? '(no domain)'}</span>
                <span className="block opacity-70">{r.tool === 'ada-audit' ? 'ADA' : 'SEO'} · {r.source} · {r.score ?? '—'} · {r.createdAt.slice(0, 10)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
        <p className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-500/10 px-3 py-2 text-[12px] font-body text-blue-900 dark:text-blue-300">
          Historical scores keep the weights they were scored with — saving here only affects future scans, and trend deltas across a weights change are suppressed automatically.
        </p>
        {!payload && <p className="text-[13px] font-body text-gray-500 dark:text-white/50">Pick a run to start experimenting.</p>}

        {payload?.kind === 'unavailable' && (
          <p className="text-[13px] font-body text-navy/70 dark:text-white/70">
            {payload.reason} <span className="text-navy/45 dark:text-white/45">(current score: {payload.current.score ?? '—'})</span>
          </p>
        )}

        {payload?.kind === 'ada' && adaWhatIf && (
          <div>
            <ScorePair current={payload.current.score} whatIf={adaWhatIf.score} note={payload.current.version !== 4 ? 'stored score used an older formula — what-if recomputes under v4' : null} />
            <div className="mt-4 grid grid-cols-2 gap-4">
              {ADA_KEYS.map((k) => (
                <label key={k} className="text-[13px] font-body text-navy dark:text-white">{ADA_WEIGHT_LABELS[k]} — {adaWeights[k]}
                  <input type="range" min={0} max={k === 'advisoryDiscount' ? 1 : 100} step={k === 'advisoryDiscount' ? 0.05 : 1}
                    value={adaWeights[k]} onChange={(e) => setAdaWeights({ ...adaWeights, [k]: Number(e.target.value) })} className="mt-1 w-full" />
                </label>
              ))}
            </div>
            <p className="mt-3 text-[11px] font-body text-navy/50 dark:text-white/50">The breakdown below reflects the what-if sliders above, not the weights the run was scored with.</p>
            <AdaScoreExplanation breakdown={JSON.stringify(adaWhatIf.breakdown)} />
            {adaValidationError && <p className="mt-3 text-[13px] font-body text-amber-700 dark:text-amber-400">{adaValidationError}</p>}
            <div className="mt-4 flex items-center gap-3">
              <button onClick={() => save('/api/settings/ada-scoring-weights', adaWeights, 'ADA weights')} disabled={!!adaValidationError}
                className="rounded-lg bg-navy text-white dark:bg-white dark:text-navy px-4 py-2 text-[13px] font-heading font-semibold disabled:opacity-40 disabled:cursor-not-allowed">Save as ADA defaults</button>
              <button onClick={() => setAdaWeights(DEFAULT_ADA_V4_WEIGHTS)}
                className="rounded-lg border border-gray-300 dark:border-navy-border px-4 py-2 text-[13px] font-body text-navy dark:text-white">Reset</button>
            </div>
          </div>
        )}

        {payload?.kind === 'seo' && seoWhatIf && (
          <div>
            <ScorePair current={payload.current.score} whatIf={seoWhatIf.score} note={null} />
            <div className="mt-4 grid grid-cols-2 gap-4">
              {PERSISTABLE_WEIGHT_KEYS.map((k) => (
                <label key={k} className="text-[13px] font-body text-navy dark:text-white">{WEIGHT_LABELS[k]}
                  {/* Codex #5: number inputs, not a capped range — the settings API accepts any
                      non-negative value, and a saved value above an arbitrary slider max would
                      render misrepresented. Mirrors the settings card's input. */}
                  <input type="number" min={0} step={1}
                    value={seoWeights[k]} onChange={(e) => setSeoWeights({ ...seoWeights, [k]: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-navy dark:text-white" />
                </label>
              ))}
            </div>
            <p className="mt-3 text-[11px] font-body text-navy/50 dark:text-white/50">The breakdown below reflects the what-if weights above, not the weights the run was scored with.</p>
            <ScoreExplanation breakdown={serializeBreakdown(payload.scorer, seoWhatIf)} />
            <div className="mt-4 flex items-center gap-3">
              <button onClick={() => save('/api/settings/scoring-weights', seoWeights, 'SEO weights')}
                className="rounded-lg bg-navy text-white dark:bg-white dark:text-navy px-4 py-2 text-[13px] font-heading font-semibold">Save as SEO defaults</button>
              <button onClick={() => setSeoWeights(DEFAULT_WEIGHTS)}
                className="rounded-lg border border-gray-300 dark:border-navy-border px-4 py-2 text-[13px] font-body text-navy dark:text-white">Reset</button>
            </div>
          </div>
        )}

        {saveMsg && <p className="mt-3 text-[13px] font-body text-navy dark:text-white">{saveMsg}</p>}
      </section>
    </div>
  )
}

function ScorePair({ current, whatIf, note }: { current: number | null; whatIf: number | null; note: string | null }) {
  return (
    <div>
      <div className="flex items-baseline gap-6">
        <div>
          <div className="text-[11px] font-body uppercase tracking-wide text-gray-500 dark:text-white/50">Current</div>
          <div className="text-3xl font-display font-extrabold text-navy dark:text-white">{current ?? '—'}</div>
        </div>
        <div>
          <div className="text-[11px] font-body uppercase tracking-wide text-gray-500 dark:text-white/50">What-if</div>
          <div className="text-3xl font-display font-extrabold text-orange-600 dark:text-orange-400">{whatIf ?? '—'}</div>
        </div>
      </div>
      {note && <p className="mt-1 text-[11px] font-body text-navy/50 dark:text-white/50">{note}</p>}
    </div>
  )
}
```

Note: `scoreLiveSeo`'s null gates re-apply in the what-if (a null-scored live run shows `—` for every weights profile — honest by design). `serializeBreakdown` produces the v1 shape, which `ScoreExplanation` renders as the factor table (it only reads `factors`).

- [ ] **Step 5: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/score-lab/ScoreLabClient.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/score-lab" components/score-lab lib/tools-registry.ts
git commit -m "feat(c19-pr3): Score Lab — hidden cookie-gated what-if sandbox over the pure scorers"
```

---

### Task 8: Remaining PR2 minors — replay catch label, sparkline weights-dash, broken-image test

**Files:**
- Modify: `scripts/score-replay.ts:226-232`
- Modify: `lib/report/report-html.ts:80-105`
- Test: `lib/report/report-html.test.ts` (or the file's existing test home — locate with `ls lib/report/*.test.ts`), `lib/jobs/handlers/broken-link-verify.test.ts`

**Interfaces:**
- Consumes: `ScorePoint.weightsHash` (already threaded by `report-data.ts:203`).
- Produces: no new exports — behavior fixes only.

- [ ] **Step 1: Replay catch-label granularity**

In `scripts/score-replay.ts` (SEO section, ~line 226), split blob-parse failure from scorer failure:

```ts
    let newScore: number | null
    try {
      const parsed = JSON.parse(blob)
      try {
        newScore = computeHealthScore(parsed, DEFAULT_WEIGHTS).score
      } catch (err) {
        seoSkipped.push({ id: r.id, domain, reason: `scorer failed: ${(err as Error).message}`, source: 'sf-upload' })
        continue
      }
    } catch {
      seoSkipped.push({ id: r.id, domain, reason: 'blob unparseable', source: 'sf-upload' })
      continue
    }
```

Sanity-run (read-only, local DB): `DATABASE_URL="file:./local-dev.db?mode=ro" npx tsx scripts/score-replay.ts` → completes without error.

- [ ] **Step 2: Sparkline weights-hash awareness (report PDF trend)**

In `lib/report/report-html.ts`, the segment loop dashes only on version change; a same-version weights change is equally non-comparable (PR2 made every OTHER delta consumer hash-aware — this display was the one left version-only). Replace the loop body:

```ts
  for (let i = 1; i < points.length; i++) {
    const versionChanged = pointVersion(points[i]) !== pointVersion(points[i - 1])
    const weightsChanged = !versionChanged && (points[i].weightsHash ?? null) !== (points[i - 1].weightsHash ?? null)
    const changed = versionChanged || weightsChanged
    const dash = changed ? ' stroke-dasharray="4 3"' : ''
    segments += `<polyline fill="none" stroke="${BRAND.orange}" stroke-width="2"${dash} points="${coords[i - 1]} ${coords[i]}"/>`
    if (changed) {
      const mx = ((x(i - 1) + x(i)) / 2).toFixed(1)
      const label = versionChanged ? 'formula changed' : 'weights changed'
      markers += `<text x="${mx}" y="${TOP + 6}" font-size="7" fill="#dc2626" text-anchor="middle">${escapeHtml(label)}</text>`
    }
  }
```

Add a test beside the existing sparkline/version tests (same file that pins the `formula changed` marker — find it with `grep -rn "formula changed" lib/report/*.test.ts components`): two same-version points with differing `weightsHash` → output contains `stroke-dasharray` and `weights changed`; identical hashes → solid line, no marker. Match the existing test's call pattern for building the report HTML or exporting `sparklineSvg` if it is already exported for tests (if not, test through the public builder exactly as the existing version-marker test does).

- [ ] **Step 3: Broken-image-branch test (PR2 review minor)**

In `lib/jobs/handlers/broken-link-verify.test.ts`, the real-handler DB tests cover clean-with-targets and capped→partial, but no case drives the image branch of the snapshot counters (`else { imagesChecked++; imagesBroken++ }`). Add one, mirroring the file's existing real-handler fixture (harvested rows + mocked transport): harvest one same-domain `image` target whose mocked check resolves `broken` and one that resolves ok → after the run, the live-scan run's breakdown `inputsSnapshot.linkVerification` has `imagesChecked: 2, imagesBroken: 1`, and the `broken_images` finding exists while `internalChecked` stays 0.

- [ ] **Step 4: Run + commit**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts` plus the report test file touched in Step 2.
Expected: PASS.

```bash
git add scripts/score-replay.ts lib/report/report-html.ts lib/jobs/handlers/broken-link-verify.test.ts
# plus the report test file touched in Step 2
git commit -m "fix(c19-pr3): PR2 minors — replay catch granularity, weights-aware sparkline dash, broken-image branch test"
```

---

### Task 9: Full gates + dev e2e sanity

- [ ] **Step 1: Gates**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green (test count ≥ 4043 + this PR's additions).

- [ ] **Step 2: Dev e2e (controller session, not a subagent)**

```bash
DATABASE_URL="file:./local-dev.db" NEXT_PUBLIC_APP_URL="http://localhost:3000" APP_AUTH_PASSWORD="" CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run dev
```
Verify in the browser (Playwright MCP):
1. `/settings` — both weights cards render; SEO card shows the Broken links input; saving an ADA profile (e.g. critical 50) succeeds; invalid sum shows the server error.
2. `/score-lab` — run list loads; picking a recent ADA run shows current + what-if and the invoice panel; dragging Critical cap moves the score; picking a pre-C19 SEO run shows "what-if unavailable"; if a post-C19 SEO run exists (PR2 dev e2e created one), its sliders recompute.
3. Reset the ADA profile: on `/score-lab` or `/settings`, save the defaults back (critical 40 …) so the local DB profile is clean.
4. Optional full-path check: run a site audit of `https://example.com` — completed run's breakdown `weightsHash` reflects whatever profile was saved at scan time.

- [ ] **Step 3: Commit any fixes, then hand back to the controller for PR → merge → deploy → prod-verify → docs ritual**

Deploy recipe (controller): `git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"`, then verify `.next/BUILD_ID` fresh, `/api/health` ok, boot log clean, migration `20260710120000_ada_scoring_weights` applied (`prisma migrate status` via the deploy log or the `_prisma_migrations` table), schedules seeded. Prod verify: log in → `/settings` cards render → `/score-lab` recomputes a real run. Codex verify item: after any real weights save, confirm the NEXT scan's breakdown stamps a different `weightsHash` and the adjacent trend delta is suppressed with `comparabilityBreak: 'weights'` (PR2 wiring — observe, don't rebuild); then restore defaults unless Kevin wants the change kept. No new env vars.

---

## Self-Review

- **Spec coverage (Part 4):** schema+validation → Tasks 1-2; threading → Task 3; /settings cards + brokenLinks un-hide → Tasks 1, 4; Score Lab + lab-inputs + data-availability rules (Codex #5) → Tasks 5-7; weights-change honesty (Codex #6) already shipped in PR2 — the Lab only relies on it; degenerate-case archetype tests (Codex #2, spec Part 4) are covered by the validation tests (many-rule/concentration interactions were pinned in PR1's `ada-v4.test.ts` monotonicity/saturation suites — no default change in PR3 means no new band risk).
- **Follow-up minors folded in:** ada-v4-inputs orderBy + malformed-wcagTags test (Task 5), parity version-gate (Task 3), replay catch labels (Task 8), sparkline hash-awareness (Task 8), hashWeights cast wart (Task 3), broken-image-branch test (Task 8).
- **Type consistency check:** `AdaV4Weights` keys used in Tasks 2/4/7 match `ada-v4.ts`; `validateAdaWeights` return union matches `validateWeights` convention; lab payload `current` shape identical in Tasks 5 and 7; `recomputeSeoScore(snapshot, weights): ScoreResult` consistent across Tasks 6-7.
- **Known deviations, deliberate:** (a) the SEO parity score-gate (Task 3c) is a tiny scope add beyond the ADA-only follow-up — same noise class, one line, same test file; (b) the run picker is a recent-25 list, not the spec's "search over CrawlRuns" — **approved scope amendment** (Codex #7 concurs it fits the internal tool; recorded here and to be recorded in the tracker status line so the implementation isn't later judged incomplete).
- **Codex review (2026-07-10, accept with named fixes ×7, all applied):** #1 parity gates on version AND default-weights hash via `parseScoreMeta` (Task 3); #2 ada-v4-inputs violation aggregation reconstructs the mapper's source-child order — `Violation.id` is a randomUUID, id-order ≠ mapper order (Task 5); #3 `SfInputsSnapshot` gains optional `indexableKnown`/`errorsKnown` availability booleans, recompute falls back lossily for pre-PR3 snapshots (Task 6); #4 lab-inputs requires `status === 'complete'` and validates snapshot finiteness (Task 5); #5 Lab validates ADA profiles client-side with `validateAdaWeights` (error + disabled Save), SEO inputs are numeric not max-capped ranges, breakdowns carry a what-if caption (Task 7); #6 `writeAdaSiteFindings` custom-cap test + finalizer resolve-rejection→defaults test (Task 3); #7 picker deviation recorded (above).
