# Viewbook v2 PR1 — Stage Engine Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the v2 schema (all new columns/tables + backfill), the code-owned stage catalog, stage-aware public-page lineup resolution, and the fenced stage-move route — with zero email side effects and zero new public routes.

**Architecture:** Additive migration + a client-safe `stages.ts` catalog. The public loader resolves the viewbook's stage into `{primary, carried}` section lists; the page renders carried sections in a collapsed "Earlier steps" band. Stage moves use the repo's compound-where update fence (P2025 rolls back the whole array transaction — the milestone-promote precedent at `lib/viewbook/service.ts:280-287`).

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest.

## Global Constraints (from spec + repo rules)

- Array-form `$transaction([...])` ONLY — never interactive. Raw SQL sets `updatedAt` manually (integer-ms storage).
- New viewbooks keep creation stage `building` in this PR (spec Codex fix 2 — the flip to `post-contract` is PR5).
- NO email side effects, NO public matchers, NO syncVersion bumps in this PR (PR3/PR5, PR2).
- The six new section keys join `SECTION_KEYS` but do NOT enter any stage lineup yet — each key enters lineups in the PR that ships its component. PR1 lineups contain only the seven v1 keys.
- Existing `themeJson` values stay valid (recognized-key superset).
- Gates before merge: `npx tsc --noEmit`, `npm run lint`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`.
- Work in a worktree branch `feat/viewbook-v2-pr1`; commits per task.

---

### Task 1: Schema migration + backfill

**Files:**
- Modify: `prisma/schema.prisma` (Viewbook ~line 862, ViewbookSection ~line 887; new models after ViewbookActivity ~line 1020)
- Create: `prisma/migrations/<timestamp>_viewbook_v2_stages/migration.sql` (generated, then edited)

**Interfaces:**
- Produces: `Viewbook.stage/syncVersion/csmName/clientNotifyJson/pcCompletedAt`, `ViewbookSection.acknowledgedAt`, models `ViewbookTeamMember`, `ViewbookStageLog`, `ViewbookEmailDelivery`, `ViewbookDoc` — exactly as spec §5.

- [ ] **Step 1: Add columns + models to `prisma/schema.prisma`**

To the `Viewbook` model add (after `digestSentAt`):

```prisma
  stage            String    @default("post-contract")
  syncVersion      Int       @default(0)
  csmName          String?
  clientNotifyJson String    @default("[]")
  pcCompletedAt    DateTime?
```

and the new relation fields:

```prisma
  teamMembers     ViewbookTeamMember[]
  stageLogs       ViewbookStageLog[]
  emailDeliveries ViewbookEmailDelivery[]
  docs            ViewbookDoc[]
```

To `ViewbookSection` add (after `narrative`):

```prisma
  acknowledgedAt DateTime?
```

New models (after `ViewbookActivity`) — copy the spec §5 blocks verbatim:

```prisma
model ViewbookTeamMember {
  id               Int      @id @default(autoincrement())
  viewbookId       Int
  viewbook         Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  memberKey        String   @unique
  name             String
  email            String
  addedBy          String
  clientMutationId String?  @unique
  createdAt        DateTime @default(now())
  @@unique([viewbookId, email])
  @@index([viewbookId, id])
}

model ViewbookStageLog {
  id         Int      @id @default(autoincrement())
  viewbookId Int
  viewbook   Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  eventKey   String   @unique
  stage      String
  direction  String
  actor      String
  createdAt  DateTime @default(now())
  @@index([viewbookId, id])
}

model ViewbookEmailDelivery {
  id           Int       @id @default(autoincrement())
  viewbookId   Int
  viewbook     Viewbook  @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  kind         String
  recipient    String
  dedupKey     String    @unique
  memberId     Int?
  stageLogId   Int?
  sentAt       DateTime?
  suppressedAt DateTime?
  createdAt    DateTime  @default(now())
  @@index([viewbookId, id])
  @@index([memberId])
}

model ViewbookDoc {
  id         Int       @id @default(autoincrement())
  viewbookId Int?
  viewbook   Viewbook? @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  title      String
  blurb      String?
  filename   String
  sortOrder  Int
  createdBy  String
  createdAt  DateTime  @default(now())
  @@index([viewbookId, sortOrder])
}
```

- [ ] **Step 2: Hand-author the migration (repo procedure — Codex plan fix 5)**

Create `prisma/migrations/<YYYYMMDDHHMMSS>_viewbook_v2_stages/migration.sql`
by hand (do NOT use `migrate dev --create-only`): the five `ALTER TABLE
"Viewbook" ADD COLUMN …` statements, `ALTER TABLE "ViewbookSection" ADD
COLUMN "acknowledgedAt" DATETIME`, the four `CREATE TABLE`s + their
`CREATE UNIQUE INDEX`/`CREATE INDEX` statements — mirror the SQL shapes in
`prisma/migrations/20260716101640_client_viewbook/migration.sql` (same
column-type conventions), with `eventKey`/`memberKey` unique indexes.

- [ ] **Step 3: Append backfill statements to `migration.sql`**

```sql
-- v2 backfill: existing viewbooks land in 'building' (spec §2 migration row);
-- updatedAt set manually — raw SQL bypasses @updatedAt
UPDATE "Viewbook" SET "stage" = 'building',
  "updatedAt" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER);

-- Seed the six new section rows for every existing viewbook (idempotent,
-- updatedAt populated explicitly — raw SQL bypasses @updatedAt)
INSERT INTO "ViewbookSection" ("viewbookId", "sectionKey", "state", "updatedAt")
SELECT v."id", k."key", 'active', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM "Viewbook" v
CROSS JOIN (
  SELECT 'pc-intro' AS "key" UNION ALL SELECT 'pc-setup' UNION ALL
  SELECT 'pc-invite' UNION ALL SELECT 'pc-thanks' UNION ALL
  SELECT 'kickoff-next' UNION ALL SELECT 'ws-intro'
) k
WHERE NOT EXISTS (
  SELECT 1 FROM "ViewbookSection" s
  WHERE s."viewbookId" = v."id" AND s."sectionKey" = k."key"
);
```

- [ ] **Step 4: Rehearse on BOTH database shapes (spec fix 11), then apply**

First a fresh DB: `DATABASE_URL="file:./v2-fresh-test.db" npx prisma migrate deploy` → applies cleanly from zero; delete the file after.
Then the populated dev DB (which has at least one v1 viewbook — create one via the admin UI or `npx tsx -e` with `createViewbook` if empty):
`DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && npx prisma generate`
Expected: applies cleanly. Then verify:
`npx tsx -e "import {prisma} from './lib/db'; prisma.viewbook.findFirst({include:{sections:true}}).then(v => { console.log(v?.stage, v?.sections.length); return prisma.\$disconnect() })"`
Expected: `building 13`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(viewbook): v2 stage-engine schema + backfill migration"
```

---

### Task 2: Stage catalog (`lib/viewbook/stages.ts`)

**Files:**
- Create: `lib/viewbook/stages.ts`
- Test: `lib/viewbook/stages.test.ts`
- Modify: `lib/viewbook/theme.ts:6-14` (SECTION_KEYS)

**Interfaces:**
- Produces: `VIEWBOOK_STAGES`, `type ViewbookStage`, `isViewbookStage(s: string): s is ViewbookStage`, `nextStage(s: ViewbookStage): ViewbookStage | null`, `prevStage(s: ViewbookStage): ViewbookStage | null`, `STAGE_LINEUPS: Record<ViewbookStage, {primary: SectionKey[]; carried: SectionKey[]}>`, `STAGE_LABELS: Record<ViewbookStage, string>`. Client-safe (no prisma/node imports) — same contract as `theme.ts`.
- Consumes: `SectionKey` from `./theme`.

- [ ] **Step 1: Extend `SECTION_KEYS` in `lib/viewbook/theme.ts`**

```ts
export const SECTION_KEYS = [
  'welcome',
  'milestones',
  'data-source',
  'brand',
  'assessment',
  'strategy',
  'materials',
  'pc-intro',
  'pc-setup',
  'pc-invite',
  'pc-thanks',
  'kickoff-next',
  'ws-intro',
] as const
```

- [ ] **Step 2: Write failing tests**

`lib/viewbook/stages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SECTION_KEYS } from './theme'
import {
  VIEWBOOK_STAGES, isViewbookStage, nextStage, prevStage, STAGE_LINEUPS,
} from './stages'

describe('stage catalog', () => {
  it('orders the four stages', () => {
    expect(VIEWBOOK_STAGES).toEqual(['post-contract', 'kickoff', 'website-specifics', 'building'])
  })
  it('validates stage strings', () => {
    expect(isViewbookStage('kickoff')).toBe(true)
    expect(isViewbookStage('nope')).toBe(false)
  })
  it('steps forward and back with null at the ends', () => {
    expect(nextStage('post-contract')).toBe('kickoff')
    expect(nextStage('building')).toBeNull()
    expect(prevStage('post-contract')).toBeNull()
    expect(prevStage('building')).toBe('website-specifics')
  })
  it('every lineup key is a registered SectionKey and lists are disjoint', () => {
    for (const stage of VIEWBOOK_STAGES) {
      const { primary, carried } = STAGE_LINEUPS[stage]
      for (const k of [...primary, ...carried]) {
        expect(SECTION_KEYS).toContain(k)
      }
      expect(primary.filter((k) => carried.includes(k))).toEqual([])
    }
  })
  it('PR1 lineups contain only v1 keys (new sections enter with their PRs)', () => {
    const v1 = ['welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials']
    for (const stage of VIEWBOOK_STAGES) {
      const { primary, carried } = STAGE_LINEUPS[stage]
      for (const k of [...primary, ...carried]) expect(v1).toContain(k)
    }
  })
  it('building primary preserves the v1 order', () => {
    expect(STAGE_LINEUPS.building.primary).toEqual([
      'welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials',
    ])
  })
})
```

- [ ] **Step 3: Run tests, verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/stages.test.ts`
Expected: FAIL — `Cannot find module './stages'`.

- [ ] **Step 4: Implement `lib/viewbook/stages.ts`**

```ts
// Client-safe code-owned stage catalog (v2 spec §4). Lineups decide what the
// public page renders per stage; a key absent from both lists does not render
// even when its DB row exists. New section keys enter lineups ONLY in the PR
// that ships their component (spec Codex fix 2 — producers before consumers).

import type { SectionKey } from './theme'

export const VIEWBOOK_STAGES = ['post-contract', 'kickoff', 'website-specifics', 'building'] as const
export type ViewbookStage = (typeof VIEWBOOK_STAGES)[number]

export function isViewbookStage(s: string): s is ViewbookStage {
  return (VIEWBOOK_STAGES as readonly string[]).includes(s)
}

export function nextStage(s: ViewbookStage): ViewbookStage | null {
  const i = VIEWBOOK_STAGES.indexOf(s)
  return VIEWBOOK_STAGES[i + 1] ?? null
}

export function prevStage(s: ViewbookStage): ViewbookStage | null {
  const i = VIEWBOOK_STAGES.indexOf(s)
  return i > 0 ? VIEWBOOK_STAGES[i - 1] : null
}

export const STAGE_LABELS: Record<ViewbookStage, string> = {
  'post-contract': 'Getting Started',
  kickoff: 'Kickoff',
  'website-specifics': 'Website Specifics',
  building: 'Now Building',
}

export interface StageLineup {
  primary: SectionKey[]
  carried: SectionKey[]
}

export const STAGE_LINEUPS: Record<ViewbookStage, StageLineup> = {
  'post-contract': { primary: ['data-source'], carried: [] },
  kickoff: { primary: ['welcome', 'milestones', 'strategy'], carried: ['data-source'] },
  'website-specifics': {
    primary: ['brand', 'assessment'],
    carried: ['welcome', 'milestones', 'strategy', 'data-source'],
  },
  building: {
    primary: ['welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials'],
    carried: [],
  },
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/stages.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Theme compat check — run the existing theme suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/theme.test.ts`
Expected: PASS unchanged (SECTION_KEYS growth is a recognized-key superset; if a test pins the exact key list, update that assertion to the 13-key list — that is the ONLY permitted edit).

- [ ] **Step 7: Commit**

```bash
git add lib/viewbook/stages.ts lib/viewbook/stages.test.ts lib/viewbook/theme.ts lib/viewbook/theme.test.ts
git commit -m "feat(viewbook): stage catalog + section-key registry extension"
```

---

### Task 3: Creation seeding + admin list stage

**Files:**
- Modify: `lib/viewbook/service.ts:36-107` (`createViewbook`, `listViewbooks`)
- Test: `lib/viewbook/service.test.ts` (extend existing suite)

**Interfaces:**
- Produces: `createViewbook` seeds 13 section rows and sets `stage: 'building'` explicitly (PR5 flips this to omit the override so the schema default `post-contract` applies); `listViewbooks()` rows gain `stage: string`.

- [ ] **Step 1: Write failing tests** (extend `lib/viewbook/service.test.ts`, following its existing client-fixture helpers)

Use the suite's REAL helper `mkClient()` (returns a client row — Codex plan
fix 8), and filter `listViewbooks()` by the created id, never `rows[0]`:

```ts
it('seeds all 13 section rows and creation stage building (PR1)', async () => {
  const client = await mkClient()
  const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
  const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id }, include: { sections: true } })
  expect(vb.stage).toBe('building')
  expect(vb.sections).toHaveLength(13)
  expect(vb.sections.map((s) => s.sectionKey)).toContain('pc-thanks')
})

it('listViewbooks exposes stage', async () => {
  const client = await mkClient()
  const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
  const rows = await listViewbooks()
  expect(rows.find((r) => r.id === id)?.stage).toBe('building')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/service.test.ts`
Expected: FAIL — sections length 13 vs 7 (seeding already covers all SECTION_KEYS via the map — if it passes because seeding is generic, keep the test as a pin) and missing `stage` property.

- [ ] **Step 3: Implement**

In `createViewbook` (service.ts:47-78) add `stage: 'building',` to the create `data` (comment: `// PR1: explicit until PR5 ships the post-contract UI (spec fix 2)`). The sections `create` map already iterates `SECTION_KEYS`, so the six new rows seed automatically — verify the `assessment`/`new-build` hidden rule is untouched. In `listViewbooks` add `stage: r.stage,` to the returned row shape.

- [ ] **Step 4: Run tests, verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/viewbook/service.ts lib/viewbook/service.test.ts
git commit -m "feat(viewbook): seed v2 section rows, explicit building creation stage"
```

---

### Task 4: Stage-move service + route

**Files:**
- Modify: `lib/viewbook/service.ts` (new function after `updateSectionText`)
- Create: `app/api/viewbooks/[id]/stage/route.ts`
- Test: `lib/viewbook/service.test.ts` (extend), `app/api/viewbooks/viewbook-v2-stage-route.test.ts`

**Interfaces:**
- Produces: `moveViewbookStage(id: number, direction: 'forward' | 'back', expectedStage: ViewbookStage, actor: string): Promise<{ stage: ViewbookStage }>` — throws `HttpError(400,'invalid_direction')`, `HttpError(404,'not_found')`, `HttpError(409,'stage_conflict')` (expectedStage mismatch / concurrent move lost / at boundary). The fence is the CALLER-supplied `expectedStage` (Codex plan fix 2 — a server pre-read can't stop two sequential requests double-stepping). `POST /api/viewbooks/[id]/stage` body `{direction, expectedStage}` → `{stage}`. PR3 wires stage-change deliveries into this function (via the log row's `eventKey`); PR5 adds the `pcCompletedAt` fence + `force`.

- [ ] **Step 1: Write failing service tests**

```ts
describe('moveViewbookStage', () => {
  it('moves forward and logs (with eventKey)', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'post-contract' } })
    const res = await moveViewbookStage(id, 'forward', 'post-contract', 'op@er.com')
    expect(res.stage).toBe('kickoff')
    const log = await prisma.viewbookStageLog.findFirstOrThrow({ where: { viewbookId: id } })
    expect(log).toMatchObject({ stage: 'kickoff', direction: 'forward', actor: 'op@er.com' })
    expect(log.eventKey).toMatch(/[0-9a-f-]{36}/)
    const act = await prisma.viewbookActivity.findFirstOrThrow({ where: { viewbookId: id, kind: 'stage-change' } })
    expect(act.actor).toBe('op@er.com')
  })
  it('409s at the boundary (building has no next)', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    await expect(moveViewbookStage(id, 'forward', 'building', 'op@er.com')).rejects.toMatchObject({ status: 409 })
  })
  it('409s on stale expectedStage without touching the row', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com') // stage: building
    await expect(moveViewbookStage(id, 'back', 'kickoff', 'op@er.com')).rejects.toMatchObject({ status: 409 })
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.stage).toBe('building')
  })
  it('moves back', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    const res = await moveViewbookStage(id, 'back', 'building', 'op@er.com')
    expect(res.stage).toBe('website-specifics')
  })
  it('same-expectedStage double-fire: exactly one wins, one step, one log', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    const results = await Promise.allSettled([
      moveViewbookStage(id, 'forward', 'kickoff', 'a@er.com'),
      moveViewbookStage(id, 'forward', 'kickoff', 'b@er.com'),
    ])
    const wins = results.filter((r) => r.status === 'fulfilled')
    expect(wins).toHaveLength(1) // the loser 409s on the expectedStage fence
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.stage).toBe('website-specifics') // exactly ONE step
    const logs = await prisma.viewbookStageLog.count({ where: { viewbookId: id } })
    expect(logs).toBe(1) // the losing move writes NO log
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/service.test.ts`
Expected: FAIL — `moveViewbookStage` not exported.

- [ ] **Step 3: Implement in `service.ts`**

```ts
import { isViewbookStage, nextStage, prevStage, type ViewbookStage } from './stages'

// Fenced stage move (v2 PR1). The fence is the CALLER-supplied expectedStage
// (Codex plan fix 2 — a pre-read can't stop sequential double-steps): the
// compound-where update throws P2025 when the row's stage no longer matches,
// rolling the log + activity statements back with it (milestone-promote
// precedent above). eventKey is app-generated so PR3 can key stage-change
// deliveries in the SAME transaction (plan fix 1). PR5 adds the
// pcCompletedAt forward-fence + force. NO email side effects in PR1.
export async function moveViewbookStage(
  id: number,
  direction: 'forward' | 'back',
  expectedStage: ViewbookStage,
  actor: string,
): Promise<{ stage: ViewbookStage }> {
  if (direction !== 'forward' && direction !== 'back') throw new HttpError(400, 'invalid_direction')
  if (!isViewbookStage(expectedStage)) throw new HttpError(400, 'invalid_direction')
  const vb = await prisma.viewbook.findUnique({ where: { id }, select: { id: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  const target = direction === 'forward' ? nextStage(expectedStage) : prevStage(expectedStage)
  if (!target) throw new HttpError(409, 'stage_conflict')
  const eventKey = crypto.randomUUID()
  try {
    await prisma.$transaction([
      prisma.viewbook.update({ where: { id, stage: expectedStage }, data: { stage: target } }),
      prisma.viewbookStageLog.create({ data: { viewbookId: id, eventKey, stage: target, direction, actor } }),
      ...appendActivityStatements(id, 'stage-change', actor, `Moved to stage: ${target}`),
    ])
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new HttpError(409, 'stage_conflict')
    }
    throw err
  }
  return { stage: target }
}
```

- [ ] **Step 4: Run service tests, verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the route + failing route test**

`app/api/viewbooks/[id]/stage/route.ts` — mirror the shape of `app/api/viewbooks/[id]/lock/route.ts` (requireOperatorEmail → withRoute → parseJsonBody → service → json):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { moveViewbookStage } from '@/lib/viewbook/service'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operatorEmail = await requireOperatorEmail(request)
  const id = parseId((await params).id)
  const body = requireJsonObject(await parseJsonBody(request))
  const direction = body.direction === 'forward' || body.direction === 'back' ? body.direction : null
  const expectedStage = typeof body.expectedStage === 'string' && isViewbookStage(body.expectedStage)
    ? body.expectedStage : null
  if (!direction || !expectedStage) return NextResponse.json({ error: 'invalid_direction' }, { status: 400 })
  return NextResponse.json(await moveViewbookStage(id, direction, expectedStage, operatorEmail))
})
```

(This mirrors `app/api/viewbooks/[id]/lock/route.ts` exactly — same
`withRoute`/`requireOperatorEmail`/`parseId` shapes, plus `requireJsonObject`
for the primitive-body 400 guard; add the `isViewbookStage` import from
`@/lib/viewbook/stages`.)

Route test `app/api/viewbooks/viewbook-v2-stage-route.test.ts` follows the
existing `app/api/viewbooks/routes.test.ts` harness EXACTLY — it authenticates
with REAL signed session cookies, not mocked operator auth (Codex plan fix 8;
copy its cookie-building setup): asserts 200 forward move (body
`{direction:'forward', expectedStage:'building'}` → 409 at boundary — use a
row moved to `kickoff` first for the 200 case), 400 bad/missing direction or
expectedStage, 401 unauthenticated, 404 unknown id, 409 stale expectedStage.

- [ ] **Step 6: Run route tests, verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/viewbooks/viewbook-v2-stage-route.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/viewbook/service.ts lib/viewbook/service.test.ts app/api/viewbooks/[id]/stage app/api/viewbooks/viewbook-v2-stage-route.test.ts
git commit -m "feat(viewbook): fenced stage-move service + cookie-gated route"
```

---

### Task 5: Public lineup resolution + Earlier-steps band

**Files:**
- Modify: `lib/viewbook/public-data.ts:41-92`, `lib/viewbook/public-types.ts`
- Modify: `app/(public)/viewbook/[token]/page.tsx`, `components/viewbook/public/ViewbookShell.tsx`
- Create: `components/viewbook/public/EarlierSteps.tsx`
- Test: `lib/viewbook/public-data.test.ts` (extend)

**Interfaces:**
- Consumes: `STAGE_LINEUPS`, `STAGE_LABELS`, `isViewbookStage` from `lib/viewbook/stages`.
- Produces: `ViewbookPublicData` gains `stage: ViewbookStage`, `stageLabel: string`, and `sections` is REPLACED by `primarySections: PublicSection[]` + `carriedSections: PublicSection[]` (each `PublicSection` unchanged, plus new `acknowledgedAt: string | null`). PR2+ consume this exact shape.

- [ ] **Step 1: Write failing public-data tests**

`lib/viewbook/public-data.test.ts` has NO shared `token`/`vbId` fixtures
(Codex plan fix 8) — each test arranges its own viewbook inline with the
suite's existing creation pattern (read the file first and reuse its exact
arrangement helpers/imports):

```ts
it('resolves the building lineup: v1 sections primary, nothing carried', async () => {
  const { token } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
  const data = await loadViewbookPublicData(token) // creation stage is 'building' in PR1
  expect(data?.stage).toBe('building')
  expect(data?.primarySections.map((s) => s.sectionKey)).toEqual(
    ['welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials'],
  )
  expect(data?.carriedSections).toEqual([])
})

it('kickoff stage: primary trio + data-source carried; hidden still suppresses', async () => {
  const { id, token } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
  await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
  await prisma.viewbookSection.update({
    where: { viewbookId_sectionKey: { viewbookId: id, sectionKey: 'strategy' } },
    data: { state: 'hidden' },
  })
  const data = await loadViewbookPublicData(token)
  expect(data?.primarySections.map((s) => s.sectionKey)).toEqual(['welcome', 'milestones'])
  expect(data?.carriedSections.map((s) => s.sectionKey)).toEqual(['data-source'])
})

it('unknown stored stage degrades to building lineup (never blanks)', async () => {
  const { id, token } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
  await prisma.viewbook.update({ where: { id }, data: { stage: 'bogus' } })
  const data = await loadViewbookPublicData(token)
  expect(data?.stage).toBe('building')
})
```

(If `createViewbook` doesn't return `token` in the current signature, it does
— see `service.ts:79` `return { id: vb.id, token }`.)

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/public-data.test.ts`
Expected: FAIL — `primarySections` undefined.

- [ ] **Step 3: Implement lineup resolution in `public-data.ts`**

Replace the section mapping block (lines 59-69):

```ts
const stage: ViewbookStage = isViewbookStage(vb.stage) ? vb.stage : 'building'
const lineup = STAGE_LINEUPS[stage]
const visible = new Map(
  sectionRows.filter((s) => s.state !== 'hidden').map((s) => [s.sectionKey, s]),
)
const toPublic = (s: (typeof sectionRows)[number]): PublicSection => ({
  sectionKey: s.sectionKey as PublicSection['sectionKey'],
  state: s.state === 'done' ? 'done' : 'active',
  doneAt: iso(s.doneAt),
  acknowledgedAt: iso(s.acknowledgedAt),
  introNote: s.introNote,
  narrative: s.narrative,
})
const pick = (keys: readonly string[]) =>
  keys.flatMap((k) => (visible.has(k) ? [toPublic(visible.get(k)!)] : []))
const primarySections = pick(lineup.primary)
const carriedSections = pick(lineup.carried)
```

Return `stage`, `stageLabel: STAGE_LABELS[stage]`, `primarySections`, `carriedSections` in the payload (drop `sections`). Update `public-types.ts` accordingly (`PublicSection` gains `acknowledgedAt: string | null`).

- [ ] **Step 4: Update the page + shell (one rendering owner — Codex plan fix 7)**

The page's `bySection` map currently receives entries from `data.sections`
and will break when that field is removed — restate it as
`renderSection(s: PublicSection): ReactNode` (same switch body, takes the
section directly). **`ViewbookShell` becomes the single rendering owner:** it
takes `primarySections`, `carriedSections`, and `renderSection`, renders the
primary flow itself, then ONE outer collapsed "Earlier steps" band
(`EarlierSteps.tsx`, server component: renders nothing when empty; otherwise
a slim `<details>` per carried section whose body calls the SAME
`renderSection` — full v1 functionality inside; PR7 restyles). `ProgressNav`
is updated DELIBERATELY: it shows `stageLabel` next to the client name and
dots for PRIMARY sections only — carried sections do not get dots.

- [ ] **Step 5: Named type-fixture updates, then the full suite + build**

Update these known consumers of the payload/`PublicSection` shape by name
(Codex plan fix 10 — don't leave them to a generic tsc sweep):
- `components/viewbook/admin/ThemePreview.tsx` — constructs a `PublicSection`
  literal: add `acknowledgedAt: null`.
- `components/viewbook/public/sections-read.test.tsx` (and any sibling
  section tests constructing the old payload) — rename `sections` fixtures to
  `primarySections`/`carriedSections`; assertions otherwise identical.

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook components/viewbook app/api/viewbook app/api/viewbooks`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean (the compiler catches any consumer missed above — fix by renaming, no logic changes).

- [ ] **Step 6: Commit**

```bash
git add lib/viewbook/public-data.ts lib/viewbook/public-types.ts lib/viewbook/public-data.test.ts app/(public)/viewbook components/viewbook/public
git commit -m "feat(viewbook): stage-aware public lineup + Earlier-steps band"
```

---

### Task 6: Admin stage visibility (types + index chip — NO move buttons)

The stage-move BUTTONS are deferred to PR5 (Codex plan fix 6): PR1 must not
expose UI that moves a viewbook into stages whose components don't exist yet.
The route from Task 4 ships (tested, cookie-gated, nothing calls it yet).

**Files:**
- Modify: `components/viewbook/admin/viewbook-admin-shared.ts` (types), `components/viewbook/admin/ViewbookIndex.tsx`, `components/viewbook/admin/ViewbookEditor.tsx` (Settings tab read-only stage line)
- Test: extend the existing admin component test for the index (chip rendering)

**Interfaces:**
- Consumes: `STAGE_LABELS` from `lib/viewbook/stages`; the `stage` field from Task 3's `listViewbooks` and `getViewbookAdmin` (spread — already present).
- Produces: `ViewbookListRow.stage: string` and `ViewbookDetail.stage: string` in `viewbook-admin-shared.ts` (Codex plan fix 9) — PR5's buttons consume these.

- [ ] **Step 1: Add `stage` to the shared admin types**

`components/viewbook/admin/viewbook-admin-shared.ts`: add `stage: string` to `ViewbookListRow` AND `ViewbookDetail`.

- [ ] **Step 2: Index stage chip (distinct from the milestone column)**

`ViewbookIndex.tsx` currently labels `currentMilestone` "Current stage" — KEEP the milestone value but relabel that column "Current milestone", and add a separate project-stage chip rendering `STAGE_LABELS[row.stage]` (fallback: raw value). SettingsTab gets a read-only "Project stage: {label}" line (buttons arrive in PR5).

- [ ] **Step 3: Extend the index test**

In the existing admin index test file, assert a listed viewbook renders its stage chip label ("Now Building" for the fixture's `building` stage).

- [ ] **Step 4: Run, then commit**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook`
Expected: PASS.

```bash
git add components/viewbook/admin
git commit -m "feat(viewbook): admin stage types + index stage chip"
```

---

### Task 7: Gates, cross-review, merge

- [ ] **Step 1: Full gates**

Run, all green: `npx tsc --noEmit` && `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` && `npm run build`

- [ ] **Step 2: Cross-review**

`/codex-review` on the branch diff (P1). Apply accepted findings; re-run gates if code changed.

- [ ] **Step 3: PR + merge**

Push branch `feat/viewbook-v2-pr1`, open PR titled "Viewbook v2 PR1 — stage engine core", merge on green. Tick Wave 1 in `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` and add the tracker status-log line.
