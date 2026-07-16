# Weekly Client Sweep + Current Issues — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with your harness's plan-execution loop — Claude: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans; Codex: er-seo-tools-workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Monday 01:00 UTC (Sunday 6pm Pacific) sweep all active client domains with full ADA+SEO site audits, freeze a Monday-14:00-UTC snapshot into a `WeeklySweep` campaign record, render it at cookie-gated `/issues`, and email a counts+delta digest to support@.

**Architecture:** D5-pattern system schedule → enqueue-only fan-out job with a frozen cohort (`membershipJson`) → normal site-audit queue drains → a second system schedule computes and race-safely publishes a complete render payload (`snapshotJson`) and sends the D7-marker-idempotent digest. The page renders only the frozen payload; issues are read-time aggregations of existing `Finding` rows — no issue table.

**Tech Stack:** Existing stack only — Next.js 15 App Router, Prisma/SQLite, the `lib/jobs` durable queue, `lib/notify` Mailgun transport, vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-weekly-client-sweep-current-issues-design.md` (Codex ×1, 17 fixes applied)

## Resolved decisions

- **D1** Surfacing = `/issues` page + digest email; full-list email rejected (Kevin 2026-07-15).
- **D2** Scope = all active clients × all registered domains; no opt-out in v1.
- **D3** Sweep `weekly:1@01:00`, digest `weekly:1@14:00` (server-local = UTC; DST drift accepted).
- **D4** Digest sends at a fixed time from a frozen snapshot; late completions count next week.
- **D5** Sweep replaces C2 client scan schedules (ops sequence in Task 14; POST route → 410).
- **D6** "1 hour" nudge is temporary copy — named constant `DIGEST_EFFORT_NUDGE`, one-line retirement.
- **D7** Stale rows inline (dimmed, excluded from counts); no assignment state in v1.
- **D8** Fleet scan profile locked: `{ wcagLevel: 'wcag21aa', seoIntent: true, seoOnly: false }`.

## Global Constraints (repo invariants, restated verbatim)

- Array-form `$transaction([...])` only — NEVER interactive `$transaction(async tx => ...)`.
- No SQLite `createMany({ skipDuplicates })`; chunk `createMany` at 50 where used.
- Schema changes: edit `prisma/schema.prisma` → `npx prisma migrate dev --name <name>` (local dev DB: `DATABASE_URL="file:./local-dev.db"`).
- Raw SQL sets `updatedAt` manually (`Date.now()` integer ms).
- Findings invariants: `Finding.dedupKey` unique per run only; live-scan run never displaces the sf-upload canonical score; a findings failure never fails a legacy path.
- New API routes wrap handlers in `withRoute` (`lib/api/with-route.ts`) and parse JSON bodies with `parseJsonBody`; auth stays in middleware.
- Email: dark gate `isNotifyEnabled()`; never log the Mailgun key; pure escaped content builders; at-least-once send with durable marker stamped after send.
- Gates before merge: `npx tsc --noEmit` + `npx vitest run` + `npm run build` (in-build type-check/lint stay disabled — never re-enable).
- No AI/LLM API features. Do not raise `BROWSER_POOL_SIZE`.
- tsconfig excludes `**/*.test.ts` — tsc never checks test files; keep fixtures type-clean anyway.

## File Structure

**Create**
- `prisma/migrations/<generated>_weekly_sweep/migration.sql` — `WeeklySweep` table (Task 1)
- `lib/sweep/types.ts` + `types.test.ts` — job-type consts, versioned JSON contracts, strict parsers, shared client-safe types (Task 2)
- `lib/sweep/cohort.ts` + `cohort.test.ts` — pure cohort builder (Task 4)
- `lib/jobs/handlers/client-sweep.ts` + `client-sweep.test.ts` — fan-out handler (Task 5)
- `lib/sweep/classify.ts` + `classify.test.ts` — pure coverage classifier (Task 6)
- `lib/sweep/issue-groups.ts` + `issue-groups.test.ts` — pure group/change-state builder (Task 7)
- `lib/sweep/snapshot.ts` + `snapshot.test.ts` — DB loader, snapshot compute, race-safe publish (Task 8)
- `lib/notify/sweep-digest-content.ts` + `sweep-digest-content.test.ts` — pure email builder (Task 9)
- `lib/jobs/handlers/sweep-digest.ts` + `sweep-digest.test.ts` — digest handler (Task 10)
- `lib/sweep/retention.ts` + `retention.test.ts` — WeeklySweep pruning (Task 11)
- `app/api/issues/route.ts` + `lib/sweep/read.ts` (+ test) — page payload (Task 12)
- `app/(app)/issues/page.tsx`, `components/issues/IssuesView.tsx`, `components/issues/chips.tsx` (Task 13)
- `scripts/retire-client-schedules.ts` — one-shot C2 ops script (Task 14)

**Modify**
- `prisma/schema.prisma` — `WeeklySweep` model (Task 1)
- `lib/ada-audit/scheduled-retention.ts` — jobType inclusion + per-(schedule, domain) keep-set (Task 3)
- `lib/jobs/system-schedules.ts` — two new system schedules (Tasks 5, 10)
- `lib/jobs/handlers/index.ts` (or wherever handlers register — follow `registerRobotsMonitorSweepHandler`'s call site) — register both handlers (Tasks 5, 10)
- `lib/notify/config.ts` — `supportNotifyEmail()` (Task 9)
- `lib/cleanup.ts` — add `pruneWeeklySweeps()` to `runCleanup` (Task 11)
- `lib/tools-registry.ts` — `/issues` entry (Task 13)
- `app/api/clients/[id]/schedules/route.ts` — POST → 410 `schedule_retired` (Task 14)
- `app/(app)/clients/[id]/page.tsx` — remove `ScheduledScansCard` (Task 14)
- `CLAUDE.md` — Key files + Architecture pattern entries (Task 15)

---

### Task 1: `WeeklySweep` schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via prisma CLI

**Interfaces:**
- Produces: `prisma.weeklySweep` client with fields `id Int`, `scheduledFor DateTime @unique`, `startedAt DateTime?`, `membershipJson String?`, `fanoutCompletedAt DateTime?`, `snapshotJson String?`, `snapshotAt DateTime?`, `digestSentAt DateTime?`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Add the model** to `prisma/schema.prisma` (after `Schedule`):

```prisma
// Weekly client sweep campaign record (2026-07-15 spec). One row per sweep
// SLOT (scheduledFor = the Schedule slot, Codex #1) — a manual re-fire can
// never mint a second row for the same week. membershipJson is the cohort
// frozen BEFORE fan-out; snapshotJson is the complete frozen render payload
// the digest email AND /issues both serve.
model WeeklySweep {
  id                Int       @id @default(autoincrement())
  scheduledFor      DateTime  @unique
  startedAt         DateTime?
  membershipJson    String?
  fanoutCompletedAt DateTime?
  snapshotJson      String?
  snapshotAt        DateTime?
  digestSentAt      DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}
```

- [ ] **Step 2: Hand-author the migration (Codex plan-fix #1 — house convention, no interactive generation)**

Create `prisma/migrations/20260716000000_weekly_sweep/migration.sql`:

```sql
CREATE TABLE "WeeklySweep" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scheduledFor" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "membershipJson" TEXT,
    "fanoutCompletedAt" DATETIME,
    "snapshotJson" TEXT,
    "snapshotAt" DATETIME,
    "digestSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "WeeklySweep_scheduledFor_key" ON "WeeklySweep"("scheduledFor");
```

Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && npx prisma generate`
Expected: migration applied, client regenerated.

- [ ] **Step 3: Gate + commit**

Run: `npx tsc --noEmit`
```bash
git add prisma && git commit -m "feat(schema): WeeklySweep campaign record"
```

### Task 2: JSON contracts + strict parsers (`lib/sweep/types.ts`)

**Files:**
- Create: `lib/sweep/types.ts`, `lib/sweep/types.test.ts`

**Interfaces (produces — later tasks import all of this):**

```ts
export const CLIENT_SWEEP_JOB_TYPE = 'client-sweep'
export const SWEEP_DIGEST_JOB_TYPE = 'sweep-digest'
export const SWEEP_SCAN_PROFILE = { wcagLevel: 'wcag21aa', seoIntent: true, seoOnly: false } as const // D8

export type MemberOutcome =
  | 'pending' | 'enqueued' | 'duplicate' | 'shared-domain'
  | 'skipped-archived' | 'skipped-delisted' | 'skipped-conflict'
  | 'invalid-domain' | 'error'
export interface SweepMember {
  clientId: number; clientName: string; domain: string
  siteAuditId: string | null; outcome: MemberOutcome; reason?: string
}
export interface SweepMembership { v: 1; expectedCount: number; members: SweepMember[] }
export function parseMembership(raw: string | null): SweepMembership | null

export type SweepTool = 'ada-audit' | 'seo-parser'
export type CoverageState = 'comparable' | 'first-baseline' | 'partial' | 'failed'
export type ChangeState = 'new' | 'worsened' | 'fewer' | 'detected' | 'stale'
export type IssueUnit = 'pages' | 'targets' | 'groups'
export interface SemanticKey {
  clientId: number; domain: string; tool: SweepTool; type: string
  severity: 'critical' | 'warning' | 'notice'; unit: IssueUnit
  affectedCount: number; approximate: boolean; streak: number
}
export interface IssueGroup extends Omit<SemanticKey, 'streak'> {
  clientName: string; title: string
  changeState: ChangeState; delta: number | null; streak: number
  severityChanged: 'escalated' | 'downgraded' | null
  coverageState: CoverageState
  lastObservedAt: string        // ISO; current sweep's snapshotAt for live rows, the PRIOR sweep's for stale rows (Codex plan-fix #2)
  siteAuditId: string | null; liveScanRunId: string | null
}
export interface ResolvedIssueGroup {   // full render payload for "no longer detected" (Codex plan-fix #2)
  clientId: number; clientName: string; domain: string; tool: SweepTool
  type: string; title: string; severity: 'critical' | 'warning' | 'notice'
  priorCount: number; unit: IssueUnit
  siteAuditId: string | null; liveScanRunId: string | null
}
export interface PairCoverage {
  clientId: number; domain: string; tool: SweepTool; state: CoverageState
  reason: string | null            // e.g. 'scan-failed' | 'timed-out' | 'crawl-capped' | 'run-missing' | 'attribution-incomplete'
  baselineAvailable: boolean       // pair observed in the immediate predecessor snapshot (Codex plan-fix #9)
  siteAuditId: string | null; runId: string | null   // selected run ids frozen per member/tool (spec Codex #4)
}
export interface SweepSnapshot {
  v: 1; snapshotAt: string
  totals: {
    actionable: number; delta: number | null; comparablePairs: number
    newCount: number; worsenedCount: number; resolvedCount: number
    scanned: number; expected: number; comparableDomains: number
    partialDomains: number; failedDomains: number
  }
  coverage: PairCoverage[]
  groups: IssueGroup[]           // actionable + notices, changeState != 'stale'
  staleGroups: IssueGroup[]      // from failed pairs' previous GROUPS (full render data, Codex plan-fix #10)
  resolvedGroups: ResolvedIssueGroup[]
  shortlist: IssueGroup[]        // top 3, deterministic tuple rank (Task 8, Codex plan-fix #16)
  semanticKeys: SemanticKey[]    // next week's baseline + streak store
}
export function parseSnapshot(raw: string | null): SweepSnapshot | null
```

Parsers are strict: `null`, unparseable JSON, `v !== 1`, or wrong-shaped members → `null` (callers treat as absent; Codex #15). No field-by-field salvage.

- [ ] **Step 1: Write failing tests** — `parseMembership` round-trips a valid doc; returns null on: null input, bad JSON, `v: 2`, member missing `outcome`; `parseSnapshot` same pattern incl. `totals` missing → null.
- [ ] **Step 2:** `npx vitest run lib/sweep/types.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement types + parsers (manual shape checks, no zod — house pattern).
- [ ] **Step 4:** `npx vitest run lib/sweep/types.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add lib/sweep && git commit -m "feat(sweep): versioned membership/snapshot contracts + strict parsers"`

### Task 3: Retention — include `client-sweep` schedules, keep-set per (schedule, domain)

**Files:**
- Modify: `lib/ada-audit/scheduled-retention.ts`
- Test: `lib/ada-audit/scheduled-retention.test.ts` (extend existing suite)

**Interfaces:**
- Consumes: `CLIENT_SWEEP_JOB_TYPE` from `lib/sweep/types.ts`.
- Produces: unchanged export `pruneScheduledSiteAudits(now?)` — behavior widened.

- [ ] **Step 1: Write failing tests:**

```ts
it('keeps latest 2 completed PER DOMAIN under one schedule', async () => {
  // one client-sweep schedule; domains a.com/b.com; 5 completed audits each,
  // staggered completedAt older than the weekly 90d window
  // → after prune: 2 survivors per domain (newest), 6 deleted
})
it('prunes audits of client-sweep-jobType schedules at the weekly window', async () => {
  // schedule jobType 'client-sweep', cadence weekly:1@01:00 → audits past 90d pruned
})
it('C2 single-domain schedules keep exactly the previous behavior', async () => { /* regression */ })
```

- [ ] **Step 2:** Run → FAIL (sweep-jobType schedules not loaded; keep-set is global-2).
- [ ] **Step 3: Implement:** schedule query `where: { jobType: { in: [SCHEDULED_SITE_AUDIT_JOB_TYPE, CLIENT_SWEEP_JOB_TYPE] }, siteAudits: { some: {} } }`; replace the single `keep` query with: load completed audits `select { id, domain }` ordered `[completedAt desc, id desc]`, group in JS, keep first `KEEP_LATEST_COMPLETED` per domain, union of survivors → `notIn`.
- [ ] **Step 4:** Run the whole file → PASS (all pre-existing cases too).
- [ ] **Step 5: Commit** `git add lib/ada-audit/scheduled-retention.* && git commit -m "fix(retention): per-(schedule,domain) keep-set + client-sweep schedule eligibility"`

### Task 4: Pure cohort builder (`lib/sweep/cohort.ts`)

**Files:**
- Create: `lib/sweep/cohort.ts`, `lib/sweep/cohort.test.ts`

**Interfaces:**
- Consumes: `normalizeClientDomain`, `InvalidDomainError` from `@/lib/security/domain-validation`; `SweepMember`, `SweepMembership` from `./types`.
- Produces: `buildCohort(clients: Array<{ id: number; name: string; domains: string }>): SweepMembership` — every member `outcome: 'pending'`, `siteAuditId: null`; per-client domain dedupe after normalization; malformed `domains` JSON or invalid entries skipped silently (D5-sweep precedent); deterministic order (clientId asc, domain asc). Cross-client duplicate domains BOTH get members (fan-out collapses them, Task 5). Also produces `registeredDomains(domainsJson: string): Set<string>` — the same parse+normalize loop as a reusable helper (Task 5's revalidation consumes it).

- [ ] **Step 1: Failing tests:** two clients/three domains ordering; malformed JSON → no members for that client; same domain twice on one client (www vs bare) → one member; same domain on two clients → two members; `expectedCount === members.length`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (mirror `runRobotsMonitorSweep`'s parse loop, pure). **Step 4:** PASS.
- [ ] **Step 5: Commit** `git add lib/sweep/cohort.* && git commit -m "feat(sweep): pure frozen-cohort builder"`

### Task 5: `client-sweep` fan-out handler + system schedule

**Files:**
- Create: `lib/jobs/handlers/client-sweep.ts`, `lib/jobs/handlers/client-sweep.test.ts`
- Modify: `lib/jobs/system-schedules.ts` (add entry), handler registration call site (same file/pattern as `registerRobotsMonitorSweepHandler` — find its caller and mirror)

**Interfaces:**
- Consumes: `buildCohort`, `parseMembership`, consts from `lib/sweep/types.ts`, `queueSiteAuditRequest` from `@/lib/ada-audit/queue-request`.
- Produces: `runClientSweep(slot: Date): Promise<void>`; `registerClientSweepHandler(): void`; system schedule `{ name: 'system-client-sweep', jobType: CLIENT_SWEEP_JOB_TYPE, cadence: 'weekly:1@01:00', immediate: false }`.

Handler flow (spec §4.2, verbatim contract):

```ts
export interface ClientSweepDeps {   // injectable seams (Codex plan-fix #6)
  queue: typeof queueSiteAuditRequest
  now: () => Date
}
const realDeps: ClientSweepDeps = { queue: queueSiteAuditRequest, now: () => new Date() }

export async function runClientSweep(slot: Date, deps: ClientSweepDeps = realDeps): Promise<void> {
  // 0. resolve the sweep Schedule row once; missing = misconfigured boot → throw (Codex plan-fix #3)
  const sweepSchedule = await prisma.schedule.findUnique({ where: { name: 'system-client-sweep' }, select: { id: true } })
  if (!sweepSchedule) throw new Error('[sweep] system-client-sweep schedule row missing')
  const sweepScheduleId = sweepSchedule.id
  // 1. upsert the slot row
  const sweep = await prisma.weeklySweep.upsert({
    where: { scheduledFor: slot },
    create: { scheduledFor: slot, startedAt: new Date() },
    update: {},
  })
  // 2. freeze cohort BEFORE any enqueue (Codex #2)
  let membership = parseMembership(sweep.membershipJson)
  if (!membership) {
    const clients = await prisma.client.findMany({
      where: { archivedAt: null }, select: { id: true, name: true, domains: true },
    })
    membership = buildCohort(clients)
    await prisma.weeklySweep.update({
      where: { id: sweep.id },
      data: { membershipJson: JSON.stringify(membership), startedAt: sweep.startedAt ?? new Date() },
    })
  }
  // 3. process pending/error members; persist after each outcome
  const byDomainAudit = new Map<string, string>() // normalized domain -> siteAuditId (collision collapse)
  for (const m of membership.members) {
    if (m.outcome === 'enqueued' || m.outcome === 'duplicate' || m.outcome === 'shared-domain' ||
        m.outcome.startsWith('skipped') || m.outcome === 'invalid-domain') {
      if (m.siteAuditId) byDomainAudit.set(m.domain, m.siteAuditId)
      continue
    }
    // revalidate (Codex #12)
    const client = await prisma.client.findUnique({ where: { id: m.clientId }, select: { archivedAt: true, domains: true } })
    if (!client || client.archivedAt) { m.outcome = 'skipped-archived' }
    else if (!registeredDomains(client.domains).has(m.domain)) { m.outcome = 'skipped-delisted' }
    else if (byDomainAudit.has(m.domain)) { m.outcome = 'shared-domain'; m.siteAuditId = byDomainAudit.get(m.domain)! }
    else {
      try {
        const res = await deps.queue({
          domain: m.domain, clientId: m.clientId, ...SWEEP_SCAN_PROFILE,
          requestedBy: 'sweep', scheduleId: sweepScheduleId,
        })
        if (res.kind === 'queued') { m.outcome = 'enqueued'; m.siteAuditId = res.id; byDomainAudit.set(m.domain, res.id) }
        else if (res.kind === 'duplicate') {
          const dup = await prisma.siteAudit.findUnique({ where: { id: res.existingId }, select: { seoOnly: true, clientId: true } })
          if (dup && !dup.seoOnly && (dup.clientId === null || dup.clientId === m.clientId)) { // Codex #13 fence
            m.outcome = 'duplicate'; m.siteAuditId = res.existingId; byDomainAudit.set(m.domain, res.existingId)
          } else { m.outcome = 'skipped-conflict'; m.reason = dup?.seoOnly ? 'seo-only-in-flight' : 'foreign-client-in-flight' }
        } else { m.outcome = 'invalid-domain'; m.reason = res.reason }
      } catch (err) { m.outcome = 'error'; m.reason = String(err); }
    }
    await prisma.weeklySweep.update({ where: { id: sweep.id }, data: { membershipJson: JSON.stringify(membership) } })
  }
  // 4. finish or throw-at-end (Codex #14)
  const errors = membership.members.filter((m) => m.outcome === 'error')
  if (errors.length === 0) {
    await prisma.weeklySweep.updateMany({ where: { id: sweep.id, fanoutCompletedAt: null }, data: { fanoutCompletedAt: new Date() } })
  } else {
    throw new Error(`[sweep] ${errors.length} member(s) failed to enqueue; retrying`)
  }
}
```

Registration: `concurrency: 1, maxAttempts: 3, timeoutMs: 120_000`; handler resolves `slot` from its own job row's `scheduledFor` (`prisma.job.findUnique({ where: { id: ctx.jobId } })`). **No fallback slot** (Codex plan-fix #4): a null `scheduledFor` throws `'[sweep] client-sweep job has no scheduledFor slot'` — manufacturing "today at 01:00" could attach a manual job to the wrong campaign; a manual re-fire must enqueue with the intended `scheduledFor` explicitly.

- [ ] **Step 1: Failing DB-backed tests:** (a) first run freezes cohort then enqueues (SiteAudit rows exist, membership outcomes `enqueued`, profile fields wcagLevel/seoIntent stamped, fanoutCompletedAt set); (b) client added AFTER freeze not admitted on retry; (c) `error` member reprocessed on second run (injected `deps.queue` throws once then succeeds — no module mocking, Codex plan-fix #6), `enqueued` member untouched (same audit id); (d) two clients one domain → one SiteAudit, outcomes `enqueued` + `shared-domain`; (e) in-flight seoOnly duplicate → `skipped-conflict`; (f) archived-after-freeze → `skipped-archived`; (g) residual error → handler throws; (h) same slot re-fire upserts, never a second row; (i) null job `scheduledFor` → throws, no WeeklySweep row. **Also update the central suites (Codex plan-fix #7):** add `client-sweep` to `lib/jobs/handlers/register.test.ts`'s registered-types assertion, and assert `system-client-sweep` name/cadence/`immediate:false` in `lib/jobs/system-schedules.test.ts`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement per sketch + system-schedule entry + registration. **Step 4:** PASS.
- [ ] **Step 5: Commit** `git add lib/jobs/handlers/client-sweep.* lib/jobs/system-schedules.ts <registration file> && git commit -m "feat(sweep): client-sweep fan-out job + system-client-sweep schedule"`

### Task 6: Pure coverage classifier (`lib/sweep/classify.ts`)

**Files:** Create `lib/sweep/classify.ts`, `lib/sweep/classify.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PairObservation {
  runPresent: boolean            // required tool run exists for this member's audit
  runStatus: string | null       // CrawlRun.status ('complete' | 'partial' | ...)
  discoveryCapped: boolean       // SiteAudit.discoveryCapped === true
  attributionComplete: boolean   // Codex plan-fix #8: SEO run-scope groups need affectedComplete === true
                                 // (null = legacy/sample = INCOMPLETE); ADA page-scope rows are
                                 // complete by construction (the loader sets true for ada pairs)
}
export function classifyCoverage(current: PairObservation | null, baselineAvailable: boolean): {
  state: CoverageState; baselineAvailable: boolean   // carried through (Codex plan-fix #9)
}
// null current OR !runPresent            -> 'failed'
// capped / status 'partial' / !attributionComplete -> 'partial'
// runPresent && !baselineAvailable       -> 'first-baseline'
// else                                   -> 'comparable'
// baselineAvailable is INDEPENDENT of state: a 'partial' pair with a baseline
// may still prove NEW; a 'partial' pair without one cannot (Task 7 consumes it).
```

- [ ] **Steps 1–4:** Failing table-driven test over the four states + precedence (failed beats partial beats first-baseline; partial current with prior observation stays `partial`, never `comparable`; baselineAvailable passthrough on every state; SEO `affectedComplete: null` classifies `partial`), implement, PASS.
- [ ] **Step 5: Commit** `git add lib/sweep/classify.* && git commit -m "feat(sweep): per-(domain,tool) coverage classifier"`

### Task 7: Pure issue-group builder (`lib/sweep/issue-groups.ts`)

**Files:** Create `lib/sweep/issue-groups.ts`, `lib/sweep/issue-groups.test.ts`

**Interfaces:**
- Consumes: types from `./types`.
- Produces:

```ts
export interface RawGroup {   // one current observation, loader-provided (Task 8)
  clientId: number; clientName: string; domain: string; tool: SweepTool
  type: string; title: string; severity: 'critical' | 'warning' | 'notice'
  affectedCount: number; unit: IssueUnit; approximate: boolean
  siteAuditId: string | null; liveScanRunId: string | null
}
export function buildIssueGroups(input: {
  raw: RawGroup[]
  previous: { keys: SemanticKey[]; groups: IssueGroup[] } | null  // FULL prior groups for stale/resolved
                                   // presentation; keys for identity/streaks (Codex plan-fix #10).
                                   // null when prior sweep absent/corrupt.
  coverage: PairCoverage[]         // current frozen cohort — pairs absent here are OUT-OF-COHORT
  snapshotAt: string               // stamps IssueGroup.lastObservedAt on live rows
}): {
  groups: IssueGroup[]; staleGroups: IssueGroup[]
  resolvedGroups: ResolvedIssueGroup[]; semanticKeys: SemanticKey[]
}
```

Rules (spec §4.3): key match on (clientId, domain, tool, type) ignoring severity. **Out-of-cohort first (Codex plan-fix #11):** previous pairs with no entry in `coverage` (domain removed/renamed, client archived) are dropped before diffing — neither stale nor resolved. Then pair coverage governs claims: `failed` pair → its previous GROUPS become `staleGroups` (changeState `'stale'`, full render data and `lastObservedAt` carried from the prior group), raw absent claims impossible; `partial` pair → raw groups keep positive states (`new` only when `baselineAvailable`, else the group presents as `first-baseline`-style `new` with no claim, Codex plan-fix #9) but no `fewer`, and missing keys are NOT resolved; `comparable` → full vocabulary: no prior key → `new`; count up → `worsened` (delta +n); count down → `fewer` (delta −n); equal → `detected` with `streak = prev.streak + 1`; prior key with no raw group → `resolvedGroups` (full `ResolvedIssueGroup` from the prior group). Severity escalation with any count → `severityChanged: 'escalated'` and at-least-`worsened`; downgrade → `'downgraded'`. `first-baseline` pair → groups `new`, streak 1, nothing resolved. `semanticKeys` emitted ONLY for currently observed groups — **stale keys do NOT carry forward: a failed or missing sweep breaks the consecutive-sweep streak** (spec's `DETECTED n SWEEPS` is consecutive; Codex plan-fix #10 reverses the earlier carry-forward idea).

- [ ] **Step 1: Failing tests** (fixture-pinned): new/worsened/fewer/detected+streak/resolved (resolved rows carry title/severity/priorCount from prior groups); severity escalation same count → worsened+escalated; partial+baseline allows `new` but suppresses resolved + fewer; partial WITHOUT baseline never claims `new`-vs-prior; failed pair emits stale groups (full render fields, old lastObservedAt) and never resolves; out-of-cohort prior pair (removed domain) → neither stale nor resolved; first sweep ever (`previous: null`) → all new, no resolved; unit passthrough; approximate carried; streak does NOT survive a failed week (stale then recovered → streak restarts at 1).
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `git add lib/sweep/issue-groups.* && git commit -m "feat(sweep): change-state issue group builder with streaks + severity transitions"`

### Task 8: Snapshot loader/compute/publish (`lib/sweep/snapshot.ts`)

**Files:** Create `lib/sweep/snapshot.ts`, `lib/sweep/snapshot.test.ts`

**Interfaces:**
- Consumes: Tasks 2/6/7 exports; `prisma`; `FINDING_TYPE_LABELS`-style titles — reuse the label source the results-page sections use (`lib/findings/finding-type-sets.ts` + local title map for axe rule ids: title = `Finding.message` first line fallback type).
- Produces:

```ts
export async function computeSweepSnapshot(sweep: WeeklySweep, previous: SweepSnapshot | null, now: Date): Promise<SweepSnapshot>
export async function publishSweepSnapshot(sweepId: number, snapshot: SweepSnapshot): Promise<SweepSnapshot> // race-safe
export async function loadPreviousSnapshot(scheduledFor: Date): Promise<SweepSnapshot | null>
// EXACT immediate predecessor ONLY: scheduledFor − 7 days (Codex plan-fix #14).
// A missed or corrupt week returns null → everything first-baseline, streaks
// reset — never bridge an evidence gap with an older snapshot.
```

`computeSweepSnapshot`: for each membership member with `siteAuditId` (dedup shared-domain by audit id — load each audit ONCE, then emit per-client groups for every member sharing it): load `SiteAudit` (`status`, `discoveryCapped`), both runs via the canonical C6 compound-unique selector `crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool } } })` (Codex plan-fix #13). **Findings loader (Codex plan-fix #12 — `Finding.message` does not exist):**
- **ADA pair:** page-scope findings grouped by `type`; `affectedCount` = distinct affected pages; severity = max over the group's rows; `title` from the associated `Violation.help` (fallback: the type id); `attributionComplete: true` by construction.
- **SEO pair:** run-scope findings are the authoritative aggregates (`count`, `severity`); `title`/description from `Finding.detail` JSON's `description` field (fallback: type id); `attributionComplete` = `affectedComplete === true` ONLY (null = legacy/sample = incomplete, Codex plan-fix #8).

**Unit map (exhaustive, Codex plan-fix #15):** `broken_internal_links` / `broken_images` / `broken_external_links` → `targets`; `duplicate_title` / `duplicate_meta_description` / `duplicate_h1` → `groups`; all ADA rule types and remaining on-page types (`missing_title`, `missing_h1`, `missing_meta_description`, `thin_content`, …) → `pages`. Unknown future type → `groups` + `logError('[sweep] unmapped issue unit', …)` — never a silent guess; re-consult Codex at execution time if an unmapped type appears in production data.

Assemble `PairObservation`s → `classifyCoverage` (baselineAvailable = pair present in the immediate predecessor's `coverage`/`semanticKeys`) → `buildIssueGroups` → totals (actionable = non-notice groups excl. stale; delta only over comparable pairs) → **shortlist rank (Codex plan-fix #16):** deterministic tuple sort — change priority (`new`=0, `worsened`=1) → severity rank (`critical` before `warning`) → affected reach desc → (clientId, domain, tool, type) tie-break; top 3. No multiplicative severity×count scoring (a big warning must not outrank a small critical; units aren't comparable).

`publishSweepSnapshot` (Codex #5):

```ts
const updated = await prisma.weeklySweep.updateMany({
  where: { id: sweepId, snapshotJson: null },
  data: { snapshotJson: JSON.stringify(snapshot), snapshotAt: new Date() },
})
if (updated === 0) {
  const row = await prisma.weeklySweep.findUnique({ where: { id: sweepId } })
  const winner = parseSnapshot(row?.snapshotJson ?? null)
  if (!winner) throw new Error('[sweep] snapshot publish raced but winner unreadable')
  return winner
}
return snapshot
```

- [ ] **Step 1: Failing DB-backed tests:** full pipeline fixture (two members, ada+seo runs with findings, prior snapshot) → snapshot totals/groups/shortlist match pinned fixture; late-completing audit (no live-scan run at compute) → SEO pair `failed`, ada still classified; deleted member audit → pair `failed`, no throw; publish twice → second call returns first's payload byte-identical; corrupt prior snapshot → everything `first-baseline`. **Plus (Codex plan-fix #17):** same aggregate count with changed page URLs → `detected` (never "unchanged" wording anywhere); missing immediate predecessor (gap week) → baseline reset even though an older snapshot exists; removed/renamed domain → neither stale nor resolved; partial pair with vs without baseline; warning→critical AND critical→warning transitions; shared audit emits both client-attributed groups while loading the audit once (assert via query-count spy or loader call count).
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `git add lib/sweep/snapshot.* && git commit -m "feat(sweep): snapshot compute + race-safe publish"`

### Task 9: Digest email content + support recipient config

**Files:**
- Create: `lib/notify/sweep-digest-content.ts`, `lib/notify/sweep-digest-content.test.ts`
- Modify: `lib/notify/config.ts`

**Interfaces:**
- Produces: `supportNotifyEmail(): string` (config: `process.env.SUPPORT_NOTIFY_EMAIL || 'support@enrollmentresources.com'`); `DIGEST_EFFORT_NUDGE` string const (D6 — the ONLY place the 1-hour framing lives); `buildSweepDigestEmail(snapshot: SweepSnapshot, appUrl: string | null): { subject: string; text: string; html: string }` — `appUrl` is trimmed `NEXT_PUBLIC_APP_URL` or null; when null, ALL links are omitted (plain text labels remain) rather than inventing an origin (Codex plan-fix #19).

Content rules (spec §4.4): subject `Weekly scan digest — <N> actionable issues (▼/▲ n)`; body = totals with "across N comparable domain/tool observations", coverage line `27/30 scanned · 24 comparable · 1 partial · 2 failed`, shortlist top-3 with absolute deep links `${appUrl}/issues` + per-item audit links, nudge line, footer honesty note. HTML-escape every dynamic string (reuse `lib/report/escape.ts` helpers); "no longer detected", never "fixed"; no causal copy.

- [ ] **Steps 1–4:** Failing fixture test (pinned subject/text; html contains escaped client name `A&B College` as `A&amp;B College`; delta-null renders "first baseline — no comparison"; empty shortlist renders "no new or worsened issues this week") → implement → PASS.
- [ ] **Step 5: Commit** `git add lib/notify/config.ts lib/notify/sweep-digest-content.* && git commit -m "feat(notify): sweep digest email builder + SUPPORT_NOTIFY_EMAIL"`

### Task 10: `sweep-digest` handler + system schedule

**Files:**
- Create: `lib/jobs/handlers/sweep-digest.ts`, `lib/jobs/handlers/sweep-digest.test.ts`
- Modify: `lib/jobs/system-schedules.ts` (`{ name: 'system-sweep-digest', jobType: SWEEP_DIGEST_JOB_TYPE, cadence: 'weekly:1@14:00', immediate: false }`), handler registration call site

**Interfaces:**
- Consumes: Tasks 8/9; `sendEmail` from `lib/notify/transport`, `isNotifyEnabled` from `lib/notify/config`.
- Produces: `runSweepDigest(digestSlot: Date, deps?): Promise<void>`; `registerSweepDigestHandler(): void`.

Flow (spec §4.4): sweep slot derivation is **server-local, matching scheduler semantics** (Codex plan-fix #18): `const sweepSlot = new Date(digestSlot); sweepSlot.setHours(1, 0, 0, 0)` — NOT `Date.UTC(...)`, which only coincidentally works on the UTC prod host and diverges in local dev/tests. Then `weeklySweep.findUnique({ where: { scheduledFor: sweepSlot } })`; missing → `logError` + return (no send). The digest job's own null `scheduledFor` → throw (same no-fallback rule as Task 5). Snapshot: `parseSnapshot` ?? (`computeSweepSnapshot(sweep, await loadPreviousSnapshot(sweepSlot), now)` → `publishSweepSnapshot`). Marker flow: `digestSentAt` set → return; `!isNotifyEnabled()` → return (no stamp — permanent suppression); build with `appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || null` → `sendEmail({ to: supportNotifyEmail(), content })` — the transport takes `{ to, content }`, NOT spread content fields (Codex plan-fix #19) → `updateMany({ where: { id, digestSentAt: null }, data: { digestSentAt: now } })`. Transport/DB errors throw (worker retries, marker keeps at-least-once). Registration `concurrency: 1, maxAttempts: 3, timeoutMs: 120_000`. **Central suites (Codex plan-fix #7):** add `sweep-digest` to `register.test.ts` and `system-sweep-digest` (cadence `weekly:1@14:00`, `immediate: false`) to `system-schedules.test.ts`.

- [ ] **Step 1: Failing tests:** exact-slot selection (two sweeps in table; digest for slot B never reads slot A — a manually re-fired older digest job still targets its own slot); missing sweep row → no send, no throw; computes+publishes when snapshot null; second run after sent → no second send; dark env → no send AND no stamp; send-throw → marker unstamped and error propagates. Inject transport via deps (house `NotifyDeps` pattern).
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `git add lib/jobs/handlers/sweep-digest.* lib/jobs/system-schedules.ts <registration file> && git commit -m "feat(sweep): digest job — exact-slot, race-safe snapshot, D7 marker send"`

### Task 11: `WeeklySweep` retention

**Files:** Create `lib/sweep/retention.ts`, `lib/sweep/retention.test.ts`; Modify `lib/cleanup.ts`

**Interfaces:**
- Produces: `pruneWeeklySweeps(now?: Date): Promise<void>` — keep newest 26 rows having `snapshotJson`; additionally delete rows older than 14 days with `snapshotJson: null AND digestSentAt: null` (dead sweeps). Added to the `Promise.allSettled` list in `runCleanup()`.

- [ ] **Steps 1–4:** Failing test (30 snapshotted rows → 26 survive, newest kept; 20-day-old dead sweep deleted; 20-day-old snapshotted row inside the 26 kept) → implement → PASS.
- [ ] **Step 5: Commit** `git add lib/sweep/retention.* lib/cleanup.ts && git commit -m "feat(sweep): WeeklySweep retention in runCleanup"`

### Task 12: Read path + `GET /api/issues`

**Files:** Create `lib/sweep/read.ts`, `lib/sweep/read.test.ts`, `app/api/issues/route.ts`

**Interfaces:**
- Produces: `loadIssuesPayload(): Promise<IssuesPayload>` where

```ts
export interface IssuesPayload {
  sweep: { scheduledFor: string; startedAt: string | null; snapshotAt: string; totals: SweepSnapshot['totals'] } | null
  inProgress: boolean            // a newer sweep exists without a snapshot
  shortlist: IssueGroup[]; groups: IssueGroup[]; staleGroups: IssueGroup[]
  resolvedGroups: SweepSnapshot['resolvedGroups']; notComparable: PairCoverage[]
}
```

Rule: newest sweep with a **valid** (`parseSnapshot` non-null) snapshot is served; `inProgress` true when a strictly newer row exists with `snapshotJson: null`; no valid snapshot anywhere → `sweep: null` (page renders an empty state: "first sweep runs Sunday"). Route: `withRoute(async () => Response.json(await loadIssuesPayload()))` — cookie-gated by default middleware (no middleware change).

- [ ] **Steps 1–4:** Failing tests (valid+newer-unsnapshotted → payload + inProgress; corrupt newest snapshot falls back to older valid one; empty table → nulls) → implement → PASS. Route test: 200 response shape by importing the handler directly — **no 401 case** (middleware doesn't run for directly-imported handlers in vitest, Codex plan-fix #20); instead assert `isPublicPath('/api/issues') === false` in the middleware helper's own suite if that helper is exported/testable.
- [ ] **Step 5: Commit** `git add lib/sweep/read.* app/api/issues && git commit -m "feat(issues): read payload + GET /api/issues"`

### Task 13: `/issues` page, components, nav

**Files:**
- Create: `app/(app)/issues/page.tsx`, `components/issues/IssuesView.tsx`, `components/issues/chips.tsx`
- Modify: `lib/tools-registry.ts` (new entry → sidebar picks it up; follow an existing entry's shape exactly)

**Interfaces:**
- Consumes: `loadIssuesPayload()` (server component calls it directly — no client fetch; the payload is frozen, no polling).
- Produces: the approved mockup, in app idiom: server `page.tsx` loads payload → `IssuesView` (client) renders header/tiles/shortlist/filters/table/stale/not-comparable/resolved. Filters are client-state only (severity Actionable|Critical|Warning|Notices · tool · change · client select · search). Chips per mockup: `NEW` / `WORSENED +n <unit>` / `FEWER −n <unit>` / `DETECTED n SWEEPS` / `FIRST BASELINE` / `PARTIAL` / `STALE · LAST OBSERVED <date>`; **chip precedence (Codex plan-fix #21): coverage badges SUPPLEMENT change badges — a partial pair's `NEW` group renders both `NEW` and `PARTIAL`, never silently hides the change chip**; severity stripes; dark-mode variants (`dark:bg-navy-card` idiom). Row links: ADA → `/ada-audit/site/[siteAuditId]?resultTab=accessibility`, SEO → `/seo-audits/results/run/[liveScanRunId]` (null link → plain text). Shortlist card copy: "Start here — highest-impact candidates" + "keep going as time allows" (D6). In-progress banner + first-run empty state. **Registry entry exact (Codex plan-fix #21):** add `IconIssues` to `components/shell/icons.tsx` (no issues icon exists; `ToolDef.icon` is required), then insert `{ id: 'issues', name: 'Issues', href: '/issues', group: 'overview', icon: IconIssues, description: 'Weekly sweep — current scan issues' }` immediately after the Clients entry in `lib/tools-registry.ts` (match the existing `ToolDef` shape field-for-field; adjust if the real shape differs).

- [ ] **Step 1:** Component test for `IssuesView` (vitest + testing-library, house convention): renders tiles from totals; Actionable default hides notice rows; tool filter narrows; stale row dimmed with chip; empty state on `sweep: null`.
- [ ] **Steps 2–4:** FAIL → implement page/components/registry entry → PASS.
- [ ] **Step 5: Commit** `git add app/\(app\)/issues components/issues lib/tools-registry.ts && git commit -m "feat(issues): /issues current-scan-issues page"`

### Task 14: C2 retirement (route 410, card removal, ops script)

**Files:**
- Modify: `app/api/clients/[id]/schedules/route.ts` (POST only), `app/(app)/clients/[id]/page.tsx` (remove `ScheduledScansCard` import + render)
- Create: `scripts/retire-client-schedules.ts`

**Interfaces:**
- POST returns the 410 **directly** — `HttpError` takes `(status, code)` only, no third message arg (Codex plan-fix #23): `throw new HttpError(410, 'schedule_retired')` (or `NextResponse.json({ error: 'schedule_retired' }, { status: 410 })` if the route needs a body message). GET/PATCH/DELETE untouched (stragglers manageable).
- Script exports a testable `retireClientSchedules(): Promise<{ retired: number }>` with a thin CLI wrapper calling it then `prisma.$disconnect()` in `finally` (Codex plan-fix #25 — direct DB/service execution, do NOT invoke the HTTP DELETE route): `await pruneScheduledSiteAudits()` once up front, then for each `Schedule` where `jobType: 'scheduled-site-audit'` and `clientId != null`: `cancelJobsByGroup(\`schedule:${id}\`)` → `prisma.schedule.delete` (existing C2 DELETE semantics SetNull historical audits). Prints a summary line per schedule; idempotent (second run finds nothing).

- [ ] **Step 1:** Failing route test: POST → 410 `schedule_retired`; GET still 200. **Rewrite the existing POST cases in the schedules route suite** — every current successful-create/validation POST expectation flips to the single 410 contract; GET and straggler PATCH/DELETE cases stay (Codex plan-fix #24). Script test (DB-backed, against exported `retireClientSchedules`): seeds one client schedule + queued wrapper job + old audits → after run: schedule gone, job cancelled, prune executed, audits SetNull'd.
- [ ] **Steps 2–4:** FAIL → implement → PASS. **Client-page removal is complete (Codex plan-fix #22):** remove the `ScheduledScansCard` render, the `getClientSchedules` import, its `Promise.all` entry and tuple variable from `app/(app)/clients/[id]/page.tsx`; update any "No scheduled scans" wording in `ClientHeader`/related copy to reflect automatic weekly-sweep coverage (or remove the line). Component file itself stays (out of scope §8).
- [ ] **Step 5: Commit** `git add app/api/clients scripts app/\(app\)/clients && git commit -m "feat(sweep): retire C2 client scan schedules (410 POST, card removed, ops script)"`

### Task 15: Full gates + docs

- [ ] **Step 1:** `npx tsc --noEmit` → clean. `npx vitest run` → all green (note pre-existing failures if any, verbatim). `npm run build` → succeeds (Codex #17).
- [ ] **Step 2:** CLAUDE.md: add `lib/sweep/` Key-files bullet (WeeklySweep slot identity, frozen cohort, snapshot immutability, coverage/change split) + "Weekly client sweep (2026-07-15)" Architecture-patterns paragraph + note in the C2 pattern that client scan schedules are retired (deliberate reversal, spec §3 D5). Env docs: `SUPPORT_NOTIFY_EMAIL` in the config reference.
- [ ] **Step 3: Commit** `git add CLAUDE.md && git commit -m "docs: weekly sweep key-files + architecture entries; C2 retirement note"`

## Execution notes

- Tasks 2→4→5 and 6→7→8 are the two dependency spines; 3, 9, 11 are parallel-safe once Task 2 lands. Task 13 needs 12; Task 14 is independent; Task 15 last.
- DB-backed tests follow the house convention (fresh SQLite per suite; see `lib/jobs/*.test.ts` for the harness pattern). Test-cleanup ordering: delete children before parents.
- Deploy sequence: merge → deploy (migration auto-applies) → run `scripts/retire-client-schedules.ts` on the server → verify the two `system-*` schedules seeded (boot log) → first sweep fires next Monday 01:00 UTC; post-ship verification per spec §11. `SUPPORT_NOTIFY_EMAIL` is optional — the `support@enrollmentresources.com` default is the approved recipient; overriding it is a Kevin-gated server `.env` edit requiring a PM2 restart, NOT an ordinary post-deploy step (Codex plan-fix #26).
