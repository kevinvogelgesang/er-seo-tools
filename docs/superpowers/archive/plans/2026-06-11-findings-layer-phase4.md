# Findings Layer Phase 4 — Retention (inert) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `pruneArchivedBlobs()` — the 90-day blob-archive pruning machinery — fully tested but INERT (both per-tool activation constants `false`), registered in `runCleanup()`; then close out A2 (CLAUDE.md docs, archive the spec + 4 plans, tracker flip).

**Architecture:** New `lib/findings/retention.ts` mirrors `lib/jobs/retention.ts` (a self-contained task added to `runCleanup()`'s `Promise.allSettled` list). For each tool whose `PRUNE_ACTIVATED` flag is `true`, it finds `CrawlRun`s with `completedAt < now − 90 d`, `archivePrunedAt IS NULL`, and a present origin row, then — per chunk of 100, in ONE array-form `$transaction` — nulls the origin blob column (`Session.result` / `SiteAudit.summary` / `AdaAudit.result`), keeps all scalar columns, and stamps `CrawlRun.archivePrunedAt`. In this PR both flags ship `false`, so production behavior is a no-op; each flag flips later in the same PR as that tool's last blob reader (spec § Retention).

**Tech Stack:** Prisma + SQLite (array-form `$transaction` only — house rule), Vitest DB-backed tests against `file:./local-dev.db`.

**Spec:** `docs/superpowers/specs/2026-06-10-findings-layer-design.md` § "Retention / archive demotion (gated)" + § Phasing item 4.

---

## Verified codebase facts (don't re-derive)

- `runCleanup()` is `lib/cleanup.ts:19` — a `Promise.allSettled` list of independent tasks; `cleanOldTerminalJobs()` (from `lib/jobs/retention.ts`) is the precedent for adding one.
- `lib/cleanup.test.ts` tests individual sweep functions with a mocked `@/lib/db`; it never calls `runCleanup()`, so registering a new task breaks nothing there. `lib/jobs/handlers/cleanup.test.ts` mocks `@/lib/cleanup` entirely.
- Schema (`prisma/schema.prisma`): `CrawlRun.archivePrunedAt DateTime?` already exists (line 347, shipped in Phase 1). Origin FKs are `@unique` + `onDelete: SetNull` — so `sessionId/siteAuditId/adaAuditId IS NOT NULL` ⇒ the origin row exists (FK integrity).
- Blob columns: `Session.result`, `SiteAudit.summary`, `AdaAudit.result`. `Session` and `SiteAudit` have `@updatedAt` (Prisma `updateMany` maintains it automatically — no raw SQL needed here, so no manual `updatedAt` dance); `AdaAudit` has **no** `updatedAt` column.
- Prisma `completedAt: { lt: cutoff }` excludes `NULL` `completedAt` — incomplete runs are never pruned, but we test it anyway.
- `updateMany({ where: { id: { in: [] } } })` is a safe no-op.
- DB-backed test pattern: `lib/findings/writer.test.ts` — unique test ids/domain per file, `clearTestState` in `beforeEach`+`afterEach` deleting by BOTH origin id and domain (SetNull orphans). Creating `SiteAudit` rows with terminal status `'complete'` does NOT trip the global one-active guard (it only watches transient statuses).
- Local dev: prefix prisma/vitest with `DATABASE_URL="file:./local-dev.db"` (`.env` points at a path that doesn't exist on the Mac).

## Scope notes (decisions, don't relitigate)

- **Origin blob only.** For a site-audit run, only `SiteAudit.summary` is pruned — child `AdaAudit.result` blobs are NOT touched by this machinery. The spec names exactly the origin row's blob. Extending pruning to site-audit children is a decision for the future PR that flips `'ada-audit'` activation (post-C3/C4, when those readers stop reading child blobs) — noted in the code comment.
- **Runs with a deleted origin** (FK already SetNull'd) simply never match the origin-present filter; they are rescanned each pass. Volume is trivial (daily job) — no special-casing.
- **No backfill, no TTL changes.** Pre-A2 rows (no `CrawlRun`) are untouched; sessions keep the 180-day TTL; audits keep no TTL.
- **Both activation constants ship `false`.** Flipping either is out of scope for A2.

## File structure

- Create: `lib/findings/retention.ts` — `ARCHIVE_WINDOW_MS`, `PRUNE_ACTIVATED`, `pruneArchivedBlobs()`
- Create: `lib/findings/retention.test.ts` — DB-backed tests
- Modify: `lib/cleanup.ts` — register the task (2 lines)
- Modify: `CLAUDE.md` — findings layer in Key files + Architecture patterns
- Move: spec + 4 phase plans → `docs/superpowers/archive/` (`git mv`)
- Modify: `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` + `HANDOFF-improvement-roadmap.md`

---

### Task 1: `pruneArchivedBlobs()` (TDD)

**Files:**
- Create: `lib/findings/retention.test.ts`
- Create: `lib/findings/retention.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/findings/retention.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { pruneArchivedBlobs, ARCHIVE_WINDOW_MS, PRUNE_ACTIVATED } from './retention'

const DOMAIN = 'retention-test.example'
const ID_PREFIX = 'test-findings-retention-'
const NOW = new Date('2026-06-11T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const OLD = new Date(NOW.getTime() - ARCHIVE_WINDOW_MS - DAY_MS) // 91 d before NOW
const RECENT = new Date(NOW.getTime() - DAY_MS) // 1 d before NOW

const SEO_ON = { 'seo-parser': true, 'ada-audit': false } as const
const ADA_ON = { 'seo-parser': false, 'ada-audit': true } as const

async function clearTestState() {
  // Delete runs by domain FIRST (SetNull origins make some unreachable via FK),
  // then origin rows by test-unique id prefix / domain / url.
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: { startsWith: ID_PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

async function makeSeoRun(opts: {
  completedAt?: Date | null
  archivePrunedAt?: Date
  result?: string | null
} = {}) {
  const session = await prisma.session.create({
    data: {
      id: ID_PREFIX + randomUUID(),
      status: 'complete',
      files: '[]',
      siteName: DOMAIN,
      totalUrls: 42,
      result: opts.result !== undefined ? opts.result : '{"blob":true}',
    },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN,
      sessionId: session.id, status: 'complete', score: 81, pagesTotal: 3,
      completedAt: opts.completedAt !== undefined ? opts.completedAt : OLD,
      archivePrunedAt: opts.archivePrunedAt ?? null,
    },
  })
  return { session, run }
}

async function makeSiteAuditRun(opts: { completedAt?: Date | null } = {}) {
  const siteAudit = await prisma.siteAudit.create({
    data: { domain: DOMAIN, status: 'complete', summary: '{"blob":true}', score: 90 },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', domain: DOMAIN,
      siteAuditId: siteAudit.id, status: 'complete', score: 90, pagesTotal: 5,
      completedAt: opts.completedAt !== undefined ? opts.completedAt : OLD,
    },
  })
  return { siteAudit, run }
}

async function makeStandaloneAdaRun(opts: { completedAt?: Date | null } = {}) {
  const adaAudit = await prisma.adaAudit.create({
    data: { url: `https://${DOMAIN}/`, status: 'complete', result: '{"blob":true}', score: 95 },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'page-audit', domain: DOMAIN,
      adaAuditId: adaAudit.id, status: 'complete', score: 95, pagesTotal: 1,
      completedAt: opts.completedAt !== undefined ? opts.completedAt : OLD,
    },
  })
  return { adaAudit, run }
}

describe('pruneArchivedBlobs', () => {
  beforeEach(clearTestState)
  afterEach(clearTestState)

  it('ships inert: every PRUNE_ACTIVATED flag is false', () => {
    expect(Object.values(PRUNE_ACTIVATED).every((v) => v === false)).toBe(true)
  })

  it('default (gated-off) prunes nothing, even eligible runs', async () => {
    const { session, run } = await makeSeoRun()
    await pruneArchivedBlobs(NOW)
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } })
    const r = await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(s.result).toBe('{"blob":true}')
    expect(r.archivePrunedAt).toBeNull()
  })

  it('activated seo-parser prunes a >90d run: blob nulled, scalars kept, archivePrunedAt = now', async () => {
    const { session, run } = await makeSeoRun()
    await pruneArchivedBlobs(NOW, SEO_ON)
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } })
    const r = await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(s.result).toBeNull()
    expect(s.siteName).toBe(DOMAIN) // scalars untouched
    expect(s.totalUrls).toBe(42)
    expect(s.status).toBe('complete')
    expect(r.archivePrunedAt?.getTime()).toBe(NOW.getTime())
    expect(r.score).toBe(81) // run scalars untouched
    expect(r.pagesTotal).toBe(3)
  })

  it('leaves runs younger than the window untouched', async () => {
    const { session, run } = await makeSeoRun({ completedAt: RECENT })
    await pruneArchivedBlobs(NOW, SEO_ON)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).result).toBe('{"blob":true}')
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })).archivePrunedAt).toBeNull()
  })

  it('never prunes a run with null completedAt', async () => {
    const { run } = await makeSeoRun({ completedAt: null })
    await pruneArchivedBlobs(NOW, SEO_ON)
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })).archivePrunedAt).toBeNull()
  })

  it('skips already-pruned runs (archivePrunedAt and blob left alone)', async () => {
    const stamped = new Date(NOW.getTime() - 10 * DAY_MS)
    // Sentinel blob proves the origin update is not re-applied.
    const { session, run } = await makeSeoRun({ archivePrunedAt: stamped, result: 'sentinel' })
    await pruneArchivedBlobs(NOW, SEO_ON)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).result).toBe('sentinel')
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })).archivePrunedAt?.getTime()).toBe(stamped.getTime())
  })

  it('skips runs whose origin row was deleted (SetNull FK)', async () => {
    const { session, run } = await makeSeoRun()
    await prisma.session.delete({ where: { id: session.id } }) // FK SetNull
    await pruneArchivedBlobs(NOW, SEO_ON)
    const r = await prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(r.sessionId).toBeNull()
    expect(r.archivePrunedAt).toBeNull()
  })

  it('activated ada-audit prunes SiteAudit.summary (site runs) and AdaAudit.result (standalone)', async () => {
    const site = await makeSiteAuditRun()
    const standalone = await makeStandaloneAdaRun()
    await pruneArchivedBlobs(NOW, ADA_ON)
    const sa = await prisma.siteAudit.findUniqueOrThrow({ where: { id: site.siteAudit.id } })
    const aa = await prisma.adaAudit.findUniqueOrThrow({ where: { id: standalone.adaAudit.id } })
    expect(sa.summary).toBeNull()
    expect(sa.score).toBe(90) // scalars untouched
    expect(sa.status).toBe('complete')
    expect(aa.result).toBeNull()
    expect(aa.score).toBe(95)
    for (const id of [site.run.id, standalone.run.id]) {
      expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id } })).archivePrunedAt?.getTime()).toBe(NOW.getTime())
    }
  })

  it('activation is per-tool: seo-parser on leaves ada runs untouched (and vice versa)', async () => {
    const seo = await makeSeoRun()
    const site = await makeSiteAuditRun()
    await pruneArchivedBlobs(NOW, SEO_ON)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: seo.session.id } })).result).toBeNull()
    expect((await prisma.siteAudit.findUniqueOrThrow({ where: { id: site.siteAudit.id } })).summary).toBe('{"blob":true}')
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: site.run.id } })).archivePrunedAt).toBeNull()
  })

  it('prunes more rows than one chunk (chunking does not drop or duplicate work)', async () => {
    const made = await Promise.all(Array.from({ length: 120 }, () => makeSeoRun()))
    await pruneArchivedBlobs(NOW, SEO_ON)
    const pruned = await prisma.crawlRun.count({
      where: { domain: DOMAIN, archivePrunedAt: { not: null } },
    })
    expect(pruned).toBe(120)
    const blobsLeft = await prisma.session.count({
      where: { id: { startsWith: ID_PREFIX }, result: { not: null } },
    })
    expect(blobsLeft).toBe(0)
    expect(made).toHaveLength(120)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (module doesn't exist)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts`
Expected: FAIL — cannot resolve `./retention`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/findings/retention.ts
//
// Blob-archive retention (A2 Phase 4, spec § "Retention / archive demotion").
// Once a tool's readers have flipped to the findings tables, its origin
// blobs become a 90-day archive: runs completed more than 90 days ago get
// their origin blob column nulled (Session.result / SiteAudit.summary /
// AdaAudit.result), all scalar columns kept, and archivePrunedAt stamped.
// Runs as a task inside runCleanup().
//
// SHIPPED INERT: pruning activates per tool via PRUNE_ACTIVATED below; each
// flag flips in the same PR as that tool's last blob reader (the A1 pattern
// of deleting the legacy path only after parity). Both are false in A2.
//
// Scope: origin row's blob ONLY. For a site-audit run that is
// SiteAudit.summary — child AdaAudit.result blobs are NOT pruned here; the
// site-audit results view still reads them. Extending pruning to children
// is a decision for the PR that flips 'ada-audit' (post-C3/C4).
//
// Rows with no CrawlRun (pre-A2) are untouched: sessions expire via the
// 180-day TTL; audits have no TTL (out of scope).

import { prisma } from '@/lib/db'

const DAY_MS = 24 * 60 * 60 * 1000
/** Origin blobs are kept 90 days after the run completes. */
export const ARCHIVE_WINDOW_MS = 90 * DAY_MS

type PrunableTool = 'seo-parser' | 'ada-audit'

/** Per-tool activation. Flip ONLY in the same PR as the tool's last blob reader. */
export const PRUNE_ACTIVATED: Readonly<Record<PrunableTool, boolean>> = {
  'seo-parser': false,
  'ada-audit': false,
}

/** Origin updates per array-form transaction (matches writer chunking style). */
const CHUNK_SIZE = 100

export async function pruneArchivedBlobs(
  now: Date = new Date(),
  activated: Readonly<Record<PrunableTool, boolean>> = PRUNE_ACTIVATED,
): Promise<void> {
  const cutoff = new Date(now.getTime() - ARCHIVE_WINDOW_MS)
  const tools = (Object.keys(activated) as PrunableTool[]).filter((t) => activated[t])

  for (const tool of tools) {
    // Origin FKs are SetNull, so a non-null FK guarantees the origin row
    // exists — "origin row present" is just the OR below.
    const runs = await prisma.crawlRun.findMany({
      where: {
        tool,
        completedAt: { lt: cutoff }, // lt excludes null completedAt
        archivePrunedAt: null,
        OR: [
          { sessionId: { not: null } },
          { siteAuditId: { not: null } },
          { adaAuditId: { not: null } },
        ],
      },
      select: { id: true, sessionId: true, siteAuditId: true, adaAuditId: true },
    })

    for (let i = 0; i < runs.length; i += CHUNK_SIZE) {
      const chunk = runs.slice(i, i + CHUNK_SIZE)
      const sessionIds = chunk.map((r) => r.sessionId).filter((x): x is string => x !== null)
      const siteAuditIds = chunk.map((r) => r.siteAuditId).filter((x): x is string => x !== null)
      const adaAuditIds = chunk.map((r) => r.adaAuditId).filter((x): x is string => x !== null)

      // Array-form transaction only (house rule). Empty `in: []` lists are
      // no-ops; Session/SiteAudit @updatedAt is maintained by updateMany.
      await prisma.$transaction([
        prisma.session.updateMany({ where: { id: { in: sessionIds } }, data: { result: null } }),
        prisma.siteAudit.updateMany({ where: { id: { in: siteAuditIds } }, data: { summary: null } }),
        prisma.adaAudit.updateMany({ where: { id: { in: adaAuditIds } }, data: { result: null } }),
        prisma.crawlRun.updateMany({
          where: { id: { in: chunk.map((r) => r.id) } },
          data: { archivePrunedAt: now },
        }),
      ])
    }

    if (runs.length > 0) {
      console.log(`[findings] pruned ${runs.length} archived ${tool} blob(s)`)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/findings/retention.ts lib/findings/retention.test.ts
git commit -m "feat(findings): pruneArchivedBlobs retention machinery, shipped inert"
```

### Task 2: Register in `runCleanup()`

**Files:**
- Modify: `lib/cleanup.ts` (import block + the `Promise.allSettled` list at line 20)

- [ ] **Step 1: Add the task**

In `lib/cleanup.ts`, add the import after the `cleanOldTerminalJobs` import:

```typescript
import { cleanOldTerminalJobs } from '@/lib/jobs/retention';
import { pruneArchivedBlobs } from '@/lib/findings/retention';
```

and add the call to the list in `runCleanup()`:

```typescript
    cleanOldTerminalJobs(),
    pruneArchivedBlobs(),
```

(No new test: `runCleanup()`'s task list has no direct test today — `lib/cleanup.test.ts` tests the individual sweeps with a mocked `@/lib/db` and never invokes `runCleanup`; the function itself is fully covered by Task 1. The existing cleanup tests must stay green.)

- [ ] **Step 2: Verify existing cleanup tests + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/cleanup.test.ts lib/jobs/handlers/cleanup.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors

- [ ] **Step 3: Commit**

```bash
git add lib/cleanup.ts
git commit -m "feat(findings): register pruneArchivedBlobs in runCleanup (inert)"
```

### Task 3: CLAUDE.md — document the findings layer

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Key files entries**

In the `## Key files` list, after the `lib/jobs/system-schedules.ts` line, add:

```markdown
- `lib/findings/` — normalized findings layer (A2): `seo-mapper.ts`/`ada-mapper.ts` (blob → `CrawlRun`/`CrawlPage`/`Finding`/`Violation` bundles), `writer.ts` (delete-and-recreate in one array-form txn, `createMany` chunked at 50), `seo-write.ts`/`ada-write.ts` (best-effort dual-write hooks — a findings failure must never fail the legacy path), `parity.ts` (blob-vs-tables comparator), `normalize-url.ts` (client-safe URL normalizer), `retention.ts` (`pruneArchivedBlobs()`, 90-d blob archive — INERT until a tool's `PRUNE_ACTIVATED` flag flips), `keys.ts` (sha256 dedup keys)
- `scripts/findings-rebuild.ts` / `scripts/findings-parity.ts` — rebuild findings rows from an origin blob / verify blob-vs-tables parity (`npx tsx`, id type auto-detected)
```

- [ ] **Step 2: Add an Architecture patterns bullet**

In `## Architecture patterns`, after the **Durable job queue** bullet, add:

```markdown
- **Findings layer (A2):** every completed parse, site audit, and standalone ADA audit dual-writes a normalized `CrawlRun` → `CrawlPage`/`Finding`/`Violation` subtree (origin FKs `SetNull`, subtree cascades from `CrawlRun` only; never backfill historical blobs). Hooks are fire-and-forget AFTER the legacy commit (`void write…().catch(log)` — the finalizer hook stays LAST in `finalizeSiteAudit`); a dual-write failure logs `[findings] dual-write failed` and the fix is `npx tsx scripts/findings-rebuild.ts <id>`. The seo-parser pages route reads `CrawlPage` + `Finding` join with a verbatim `SessionPage` fallback for pre-A2 sessions (`SessionPage` is no longer written; model drop ≥180 d after 2026-06-11). Blob retention: `pruneArchivedBlobs()` in `runCleanup()` nulls origin blobs 90 d after completion — per-tool `PRUNE_ACTIVATED` constants, both `false` (inert) until that tool's last blob reader flips. Spec: `docs/superpowers/archive/specs/2026-06-10-findings-layer-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: findings layer in CLAUDE.md key files + architecture patterns"
```

### Task 4: Archive the A2 docs

**Files:**
- Move: spec + 4 phase plans into `docs/superpowers/archive/`

- [ ] **Step 1: git mv (preserves history)**

```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
git mv docs/superpowers/specs/2026-06-10-findings-layer-design.md docs/superpowers/archive/specs/
git mv docs/superpowers/plans/2026-06-10-findings-layer-phase1.md docs/superpowers/archive/plans/
git mv docs/superpowers/plans/2026-06-10-findings-layer-phase2.md docs/superpowers/archive/plans/
git mv docs/superpowers/plans/2026-06-11-findings-layer-phase3.md docs/superpowers/archive/plans/
git mv docs/superpowers/plans/2026-06-11-findings-layer-phase4.md docs/superpowers/archive/plans/
```

(Phase 4's own plan moves too — by commit time it is shipped. Fix the spec's relative links in the tracker/handoff in Task 5, which point at `../specs/` → `../archive/specs/`.)

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: archive A2 findings-layer spec + phase plans (shipped)"
```

### Task 5: Tracker flip + handoff rewrite (handoff protocol)

**Files:**
- Modify: `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`
- Modify: `docs/superpowers/todos/HANDOFF-improvement-roadmap.md`

- [ ] **Step 1: Tracker**

Flip `- [~] **A2. Normalized findings layer**` → `- [x]`, update its body's spec/plan paths to `../archive/…`, append a Phase-4 line to the A2 entry, and add a dated status-log line (Phase 4 shipped inert: retention machinery + tests, runCleanup registration, CLAUDE.md docs, A2 → `[x]`; SessionPage model drop stays the ≥180 d post-A2 follow-up).

- [ ] **Step 2: Handoff doc**

Rewrite `HANDOFF-improvement-roadmap.md`: A2 DONE in Current state; **Next item: B1 — Client dashboard MVP** (`docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md`; the roadmap spine is job queue → findings layer → client command center, and B1 has no Track-A dependency — read that doc's B1 section before speccing; it needs the full brainstorm → spec → Codex → plan flow, unlike Phase 4). Carry forward the standing gotchas (array-form transactions, findings invariants, post-flip failure mode, local-dev DATABASE_URL, server access notes); add: retention is INERT — `PRUNE_ACTIVATED` flips only in the PR that removes that tool's last blob reader.

- [ ] **Step 3: Commit (tracker + handoff together, per protocol)**

```bash
git add docs/superpowers/todos/
git commit -m "docs: A2 complete (Phase 4 shipped) — tracker flip + handoff -> B1"
```

### Task 6: Full verification, PR, deploy, production check

- [ ] **Step 1: Full suite + typecheck + build**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run && npx tsc --noEmit && npm run build`
Expected: ~1,800 tests green (1,790 + 10 new), no type errors, build clean

- [ ] **Step 2: Branch + PR**

Work happens on `feat/findings-layer-phase4` (create before Task 1 if not already). Push and open the PR:

```bash
git push -u origin feat/findings-layer-phase4
gh pr create --title "feat(findings): Phase 4 — blob retention machinery, shipped inert (A2 complete)" --body "..."
```

- [ ] **Step 3: Merge + deploy**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
ssh seo@144.126.213.242 "~/deploy.sh"
```

- [ ] **Step 4: Production verification (inert = nothing changes)**

1. Boot log error-free; startup `runCleanup()` logs no `[cleanup] Cleanup task failed`.
2. Prune is provably inert: from `/home/seo/webapps/seo-tools`, node + Prisma →
   `crawlRun.count({ where: { archivePrunedAt: { not: null } } })` is `0`, and
   `session.count({ where: { result: null, status: 'complete' } })` unchanged vs pre-deploy.
3. No `[findings] pruned` log lines.
