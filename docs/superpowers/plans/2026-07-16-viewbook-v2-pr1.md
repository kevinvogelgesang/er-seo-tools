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

- [ ] **Step 2: Generate the migration WITHOUT applying**

Run: `npx prisma migrate dev --create-only --name viewbook_v2_stages`
Expected: new folder under `prisma/migrations/`, SQL contains `ALTER TABLE "Viewbook" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'post-contract'` etc. plus the four `CREATE TABLE`s.

- [ ] **Step 3: Append backfill statements to the generated `migration.sql`**

```sql
-- v2 backfill: existing viewbooks land in 'building' (spec §2 migration row)
UPDATE "Viewbook" SET "stage" = 'building';

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

- [ ] **Step 4: Populated-DB migration check (spec fix 11), then apply**

With the CURRENT local dev DB (which has at least one v1 viewbook — create one via the admin UI or `npx tsx -e` with `createViewbook` if empty), run:
`npx prisma migrate dev`
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

```ts
it('seeds all 13 section rows and creation stage building (PR1)', async () => {
  const clientId = await makeClient() // existing suite helper
  const { id } = await createViewbook(clientId, 'upgrade', 'op@er.com')
  const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id }, include: { sections: true } })
  expect(vb.stage).toBe('building')
  expect(vb.sections).toHaveLength(13)
  expect(vb.sections.map((s) => s.sectionKey)).toContain('pc-thanks')
})

it('listViewbooks exposes stage', async () => {
  const rows = await listViewbooks()
  expect(rows[0]).toHaveProperty('stage')
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
- Produces: `moveViewbookStage(id: number, direction: 'forward' | 'back', actor: string): Promise<{ stage: ViewbookStage }>` — throws `HttpError(400,'invalid_direction')`, `HttpError(404,'not_found')`, `HttpError(409,'stage_conflict')` (concurrent move lost / at boundary). `POST /api/viewbooks/[id]/stage` body `{direction}` → `{stage}`. PR3 wires stage-change deliveries into this function; PR5 adds the `pcCompletedAt` fence + `force`.

- [ ] **Step 1: Write failing service tests**

```ts
describe('moveViewbookStage', () => {
  it('moves forward and logs', async () => {
    const clientId = await makeClient()
    const { id } = await createViewbook(clientId, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'post-contract' } })
    const res = await moveViewbookStage(id, 'forward', 'op@er.com')
    expect(res.stage).toBe('kickoff')
    const log = await prisma.viewbookStageLog.findFirstOrThrow({ where: { viewbookId: id } })
    expect(log).toMatchObject({ stage: 'kickoff', direction: 'forward', actor: 'op@er.com' })
    const act = await prisma.viewbookActivity.findFirstOrThrow({ where: { viewbookId: id, kind: 'stage-change' } })
    expect(act.actor).toBe('op@er.com')
  })
  it('409s at the boundary (building has no next)', async () => {
    const clientId = await makeClient()
    const { id } = await createViewbook(clientId, 'upgrade', 'op@er.com')
    await expect(moveViewbookStage(id, 'forward', 'op@er.com')).rejects.toMatchObject({ status: 409 })
  })
  it('moves back', async () => {
    const clientId = await makeClient()
    const { id } = await createViewbook(clientId, 'upgrade', 'op@er.com')
    const res = await moveViewbookStage(id, 'back', 'op@er.com')
    expect(res.stage).toBe('website-specifics')
  })
  it('double-fire loses the fence (single step, no duplicate log)', async () => {
    const clientId = await makeClient()
    const { id } = await createViewbook(clientId, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    const results = await Promise.allSettled([
      moveViewbookStage(id, 'forward', 'a@er.com'),
      moveViewbookStage(id, 'forward', 'b@er.com'),
    ])
    const wins = results.filter((r) => r.status === 'fulfilled')
    expect(wins.length).toBeGreaterThanOrEqual(1)
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.stage).toBe('website-specifics') // exactly ONE step
    const logs = await prisma.viewbookStageLog.count({ where: { viewbookId: id } })
    expect(logs).toBe(wins.length) // a losing move writes NO log
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/service.test.ts`
Expected: FAIL — `moveViewbookStage` not exported.

- [ ] **Step 3: Implement in `service.ts`**

```ts
import { isViewbookStage, nextStage, prevStage, type ViewbookStage } from './stages'

// Fenced stage move (v2 PR1). Compound-where update: a concurrent move that
// changed `stage` first makes this update throw P2025, rolling the log +
// activity statements back with it (milestone-promote precedent above).
// PR3 wires stage-change email deliveries here; PR5 adds the pcCompletedAt
// forward-fence + force. NO email side effects in PR1.
export async function moveViewbookStage(
  id: number,
  direction: 'forward' | 'back',
  actor: string,
): Promise<{ stage: ViewbookStage }> {
  if (direction !== 'forward' && direction !== 'back') throw new HttpError(400, 'invalid_direction')
  const vb = await prisma.viewbook.findUnique({ where: { id }, select: { stage: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  if (!isViewbookStage(vb.stage)) throw new HttpError(409, 'stage_conflict')
  const target = direction === 'forward' ? nextStage(vb.stage) : prevStage(vb.stage)
  if (!target) throw new HttpError(409, 'stage_conflict')
  try {
    await prisma.$transaction([
      prisma.viewbook.update({ where: { id, stage: vb.stage }, data: { stage: target } }),
      prisma.viewbookStageLog.create({ data: { viewbookId: id, stage: target, direction, actor } }),
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
  if (!direction) return NextResponse.json({ error: 'invalid_direction' }, { status: 400 })
  return NextResponse.json(await moveViewbookStage(id, direction, operatorEmail))
})
```

(This mirrors `app/api/viewbooks/[id]/lock/route.ts` exactly — same
`withRoute`/`requireOperatorEmail`/`parseId` shapes, plus `requireJsonObject`
for the primitive-body 400 guard.)

Route test `app/api/viewbooks/viewbook-v2-stage-route.test.ts` follows the existing `app/api/viewbooks/routes.test.ts` harness (mocked operator auth): asserts 200 forward move, 400 bad direction, 401 unauthenticated, 404 unknown id.

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

- [ ] **Step 1: Write failing public-data tests** (extend the existing suite's fixture helpers)

```ts
it('resolves the building lineup: v1 sections primary, nothing carried', async () => {
  const data = await loadViewbookPublicData(token) // fixture viewbook is stage 'building'
  expect(data?.stage).toBe('building')
  expect(data?.primarySections.map((s) => s.sectionKey)).toEqual(
    ['welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials'],
  )
  expect(data?.carriedSections).toEqual([])
})

it('kickoff stage: primary trio + data-source carried; hidden still suppresses', async () => {
  await prisma.viewbook.update({ where: { id: vbId }, data: { stage: 'kickoff' } })
  await prisma.viewbookSection.update({
    where: { viewbookId_sectionKey: { viewbookId: vbId, sectionKey: 'strategy' } },
    data: { state: 'hidden' },
  })
  const data = await loadViewbookPublicData(token)
  expect(data?.primarySections.map((s) => s.sectionKey)).toEqual(['welcome', 'milestones'])
  expect(data?.carriedSections.map((s) => s.sectionKey)).toEqual(['data-source'])
})

it('unknown stored stage degrades to building lineup (never blanks)', async () => {
  await prisma.viewbook.update({ where: { id: vbId }, data: { stage: 'bogus' } })
  const data = await loadViewbookPublicData(token)
  expect(data?.stage).toBe('building')
})
```

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

- [ ] **Step 4: Update the page + shell**

`app/(public)/viewbook/[token]/page.tsx`: the existing `bySection` switch stays; render `data.primarySections` through it in the main flow, then `<EarlierSteps sections={data.carriedSections} render={bySection} />`. `ViewbookShell` accepts the two lists (it currently maps one `sections` prop) and shows `stageLabel` next to the client name in `ProgressNav`. `EarlierSteps.tsx` (server component): renders nothing when empty; otherwise a slim band `<details>` per carried section — heading "Earlier steps" — each detail body rendering the SAME section component (full v1 functionality inside; PR7 restyles).

- [ ] **Step 5: Run the full viewbook suite + verify a build**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook components/viewbook app/api/viewbook app/api/viewbooks`
Expected: PASS — the sections-read tests may pin the old `sections` payload shape; update them to `primarySections`/`carriedSections` (shape rename only, assertions otherwise identical).
Run: `npx tsc --noEmit`
Expected: clean (the compiler surfaces every consumer of the renamed payload — fix each by renaming, no logic changes).

- [ ] **Step 6: Commit**

```bash
git add lib/viewbook/public-data.ts lib/viewbook/public-types.ts lib/viewbook/public-data.test.ts app/(public)/viewbook components/viewbook/public
git commit -m "feat(viewbook): stage-aware public lineup + Earlier-steps band"
```

---

### Task 6: Admin stage controls (Settings tab + index)

**Files:**
- Modify: `components/viewbook/admin/ViewbookEditor.tsx:163-297` (SettingsTab), `components/viewbook/admin/ViewbookIndex.tsx`
- Test: existing admin component tests (extend only if the suite already covers SettingsTab controls; otherwise route-level coverage from Task 4 suffices — do NOT add a new component-test harness in this PR)

**Interfaces:**
- Consumes: `POST /api/viewbooks/[id]/stage` (Task 4), `STAGE_LABELS`/`VIEWBOOK_STAGES` from `lib/viewbook/stages`.

- [ ] **Step 1: SettingsTab stage card**

Add a "Stage" card above the section-state controls: current `STAGE_LABELS[stage]`, a 4-dot progress strip, and two buttons — "← Back" / "Advance →" — each `window.confirm` ("Move this viewbook to {label}?") then `POST {direction}`, then the editor's existing reload callback. Buttons disable at the ends (`nextStage`/`prevStage` null) and while in flight; a 409 shows the editor's existing error affordance ("Stage changed elsewhere — reloaded").

- [ ] **Step 2: Index stage column**

`ViewbookIndex.tsx`: render `STAGE_LABELS` chip per row from the `stage` field added in Task 3.

- [ ] **Step 3: Manual verification**

Run: `npm run dev` → `/viewbooks/[id]` Settings tab: advance/back moves persist (public page lineup changes on refresh), boundary buttons disabled, index shows the chip.

- [ ] **Step 4: Commit**

```bash
git add components/viewbook/admin
git commit -m "feat(viewbook): admin stage controls + index stage chip"
```

---

### Task 7: Gates, cross-review, merge

- [ ] **Step 1: Full gates**

Run, all green: `npx tsc --noEmit` && `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` && `npm run build`

- [ ] **Step 2: Cross-review**

`/codex-review` on the branch diff (P1). Apply accepted findings; re-run gates if code changed.

- [ ] **Step 3: PR + merge**

Push branch `feat/viewbook-v2-pr1`, open PR titled "Viewbook v2 PR1 — stage engine core", merge on green. Tick Wave 1 in `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` and add the tracker status-log line.
