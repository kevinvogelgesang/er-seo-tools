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

- [ ] **Step 2: Generate the migration**

Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate dev --name weekly_sweep`
Expected: new `prisma/migrations/*_weekly_sweep/migration.sql` creating the table; client regenerated.

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
  siteAuditId: string | null; liveScanRunId: string | null
}
export interface PairCoverage { clientId: number; domain: string; tool: SweepTool; state: CoverageState }
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
  staleGroups: IssueGroup[]      // from failed pairs' previous keys
  resolvedGroups: Array<Pick<IssueGroup, 'clientId' | 'clientName' | 'domain' | 'tool' | 'type' | 'title' | 'affectedCount' | 'unit'>>
  shortlist: IssueGroup[]        // top 3, new/worsened actionable, severity×reach
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
export async function runClientSweep(slot: Date): Promise<void> {
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
        const res = await queueSiteAuditRequest({
          domain: m.domain, clientId: m.clientId, ...SWEEP_SCAN_PROFILE,
          requestedBy: 'sweep', scheduleId: sweepScheduleId, // resolved once: Schedule name 'system-client-sweep'
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

Registration: `concurrency: 1, maxAttempts: 3, timeoutMs: 120_000`; handler resolves `slot` from its own job row's `scheduledFor` (`prisma.job.findUnique({ where: { id: ctx.jobId } })`), falling back to the current UTC day at 01:00.

- [ ] **Step 1: Failing DB-backed tests:** (a) first run freezes cohort then enqueues (SiteAudit rows exist, membership outcomes `enqueued`, profile fields wcagLevel/seoIntent stamped, fanoutCompletedAt set); (b) client added AFTER freeze not admitted on retry; (c) `error` member reprocessed on second run, `enqueued` member untouched (same audit id); (d) two clients one domain → one SiteAudit, outcomes `enqueued` + `shared-domain`; (e) in-flight seoOnly duplicate → `skipped-conflict`; (f) archived-after-freeze → `skipped-archived`; (g) residual error → handler throws; (h) same slot re-fire upserts, never a second row.
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
  attributionComplete: boolean   // every group in this pair has affectedComplete !== false
}
export function classifyCoverage(current: PairObservation | null, previouslyObserved: boolean): CoverageState
// null current OR !runPresent            -> 'failed'
// capped / status 'partial' / !attributionComplete -> 'partial'
// runPresent && !previouslyObserved      -> 'first-baseline'
// else                                   -> 'comparable'
```

- [ ] **Steps 1–4:** Failing table-driven test over the four states + precedence (failed beats partial beats first-baseline; partial current with prior observation stays `partial`, never `comparable`), implement, PASS.
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
  previousKeys: SemanticKey[]          // [] when prior sweep absent/corrupt
  coverage: PairCoverage[]
}): {
  groups: IssueGroup[]; staleGroups: IssueGroup[]
  resolvedGroups: SweepSnapshot['resolvedGroups']; semanticKeys: SemanticKey[]
}
```

Rules (spec §4.3): key match on (clientId, domain, tool, type) ignoring severity. Pair coverage governs claims: `failed` pair → its previous keys become `staleGroups` (changeState `'stale'`, counts from the OLD key), raw absent claims impossible; `partial` pair → raw groups keep positive states (`new` allowed) but no `fewer`, and missing keys are NOT resolved; `comparable` → full vocabulary: no prior key → `new`; count up → `worsened` (delta +n); count down → `fewer` (delta −n); equal → `detected` with `streak = prev.streak + 1`; prior key with no raw group → `resolvedGroups`. Severity escalation with any count → `severityChanged: 'escalated'` and at-least-`worsened` (Codex #8); downgrade → `'downgraded'`. `first-baseline` pair → groups `new`, streak 1, nothing resolved. `semanticKeys` emitted for every observed group (streaks reset to 1 on non-`detected` states; `stale` keys carry forward unchanged so a one-week outage doesn't wipe streaks).

- [ ] **Step 1: Failing tests** (fixture-pinned): new/worsened/fewer/detected+streak/resolved; severity escalation same count → worsened+escalated; partial pair suppresses resolved + fewer but allows new; failed pair emits stale from old keys and never resolves; first sweep ever (previousKeys []) → all new, no resolved; unit passthrough (`targets` group renders unit intact); approximate carried; stale key carry-forward preserves streak.
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
export async function loadPreviousSnapshot(scheduledFor: Date): Promise<SweepSnapshot | null> // newest older sweep w/ valid snapshot
```

`computeSweepSnapshot`: for each membership member with `siteAuditId` (dedup shared-domain by audit id but emit per-client groups): load `SiteAudit` (`status`, `discoveryCapped`), both runs via `crawlRun.findFirst({ where: { siteAuditId, tool } })`, run-scope findings + severity + counts; RawGroup unit: `broken_*` types → `targets` (count = run finding count), duplicate types → `groups`, else `pages`; `approximate` from `affectedComplete === false` on the loaded aggregate. Assemble `PairObservation`s → `classifyCoverage` (previouslyObserved = pair present in `previous.semanticKeys` or `previous.coverage`), → `buildIssueGroups` → totals (actionable = non-notice groups excl. stale; delta only over comparable pairs, Codex #7) → shortlist = top 3 actionable `new|worsened` by `(severity === 'critical' ? 2 : 1) * affectedCount`.

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

- [ ] **Step 1: Failing DB-backed tests:** full pipeline fixture (two members, ada+seo runs with findings, prior snapshot) → snapshot totals/groups/shortlist match pinned fixture; late-completing audit (no live-scan run at compute) → SEO pair `failed`, ada still classified; deleted member audit → pair `failed`, no throw; publish twice → second call returns first's payload byte-identical; corrupt prior snapshot → everything `first-baseline`.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `git add lib/sweep/snapshot.* && git commit -m "feat(sweep): snapshot compute + race-safe publish"`

### Task 9: Digest email content + support recipient config

**Files:**
- Create: `lib/notify/sweep-digest-content.ts`, `lib/notify/sweep-digest-content.test.ts`
- Modify: `lib/notify/config.ts`

**Interfaces:**
- Produces: `supportNotifyEmail(): string` (config: `process.env.SUPPORT_NOTIFY_EMAIL || 'support@enrollmentresources.com'`); `DIGEST_EFFORT_NUDGE` string const (D6 — the ONLY place the 1-hour framing lives); `buildSweepDigestEmail(snapshot: SweepSnapshot, appUrl: string): { subject: string; text: string; html: string }`.

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

Flow (spec §4.4): sweep slot = `Date.UTC(y, m, d, 1, 0, 0)` of the digest slot's UTC day (Codex #1) → `weeklySweep.findUnique({ where: { scheduledFor: sweepSlot } })`; missing → `logError` + return (no send). Snapshot: `parseSnapshot` ?? (`computeSweepSnapshot(sweep, await loadPreviousSnapshot(sweepSlot), now)` → `publishSweepSnapshot`). Marker flow: `digestSentAt` set → return; `!isNotifyEnabled()` → return (no stamp — permanent suppression); build → `sendEmail({ to: supportNotifyEmail(), ... })` → `updateMany({ where: { id, digestSentAt: null }, data: { digestSentAt: now } })`. Transport/DB errors throw (worker retries, marker keeps at-least-once). Registration `concurrency: 1, maxAttempts: 3, timeoutMs: 120_000`.

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

- [ ] **Steps 1–4:** Failing tests (valid+newer-unsnapshotted → payload + inProgress; corrupt newest snapshot falls back to older valid one; empty table → nulls) → implement → PASS. Route smoke: 401 unauthenticated (middleware default), 200 shape when authed (follow the house route-test convention).
- [ ] **Step 5: Commit** `git add lib/sweep/read.* app/api/issues && git commit -m "feat(issues): read payload + GET /api/issues"`

### Task 13: `/issues` page, components, nav

**Files:**
- Create: `app/(app)/issues/page.tsx`, `components/issues/IssuesView.tsx`, `components/issues/chips.tsx`
- Modify: `lib/tools-registry.ts` (new entry → sidebar picks it up; follow an existing entry's shape exactly)

**Interfaces:**
- Consumes: `loadIssuesPayload()` (server component calls it directly — no client fetch; the payload is frozen, no polling).
- Produces: the approved mockup, in app idiom: server `page.tsx` loads payload → `IssuesView` (client) renders header/tiles/shortlist/filters/table/stale/not-comparable/resolved. Filters are client-state only (severity Actionable|Critical|Warning|Notices · tool · change · client select · search). Chips per mockup: `NEW` / `WORSENED +n <unit>` / `FEWER −n <unit>` / `DETECTED n SWEEPS` / `FIRST BASELINE` / `PARTIAL` / `STALE · LAST OBSERVED <date>`; severity stripes; dark-mode variants (`dark:bg-navy-card` idiom). Row links: ADA → `/ada-audit/site/[siteAuditId]?resultTab=accessibility`, SEO → `/seo-audits/results/run/[liveScanRunId]` (null link → plain text). Shortlist card copy: "Start here — highest-impact candidates" + "keep going as time allows" (D6). In-progress banner + first-run empty state.

- [ ] **Step 1:** Component test for `IssuesView` (vitest + testing-library, house convention): renders tiles from totals; Actionable default hides notice rows; tool filter narrows; stale row dimmed with chip; empty state on `sweep: null`.
- [ ] **Steps 2–4:** FAIL → implement page/components/registry entry → PASS.
- [ ] **Step 5: Commit** `git add app/\(app\)/issues components/issues lib/tools-registry.ts && git commit -m "feat(issues): /issues current-scan-issues page"`

### Task 14: C2 retirement (route 410, card removal, ops script)

**Files:**
- Modify: `app/api/clients/[id]/schedules/route.ts` (POST only), `app/(app)/clients/[id]/page.tsx` (remove `ScheduledScansCard` import + render)
- Create: `scripts/retire-client-schedules.ts`

**Interfaces:**
- POST returns `throw new HttpError(410, 'schedule_retired', 'Per-client scan schedules are replaced by the weekly sweep')` (Codex #11). GET/PATCH/DELETE untouched (stragglers manageable).
- Script (run once at deploy, `npx tsx scripts/retire-client-schedules.ts`): for each `Schedule` where `jobType: 'scheduled-site-audit'` and `clientId != null`: `await pruneScheduledSiteAudits()` once up front (not per schedule), then per schedule `cancelJobsByGroup(\`schedule:${id}\`)` → `prisma.schedule.delete` (existing C2 DELETE semantics SetNull historical audits). Prints a summary line per schedule; idempotent (second run finds nothing).

- [ ] **Step 1:** Failing route test: POST → 410 `schedule_retired`; GET still 200. Script test (DB-backed): seeds one client schedule + queued wrapper job + old audits → after run: schedule gone, job cancelled, prune executed, audits SetNull'd.
- [ ] **Steps 2–4:** FAIL → implement → PASS. Remove the card from the client page (grep for remaining `ScheduledScansCard` references — component file itself stays, out of scope §8).
- [ ] **Step 5: Commit** `git add app/api/clients scripts app/\(app\)/clients && git commit -m "feat(sweep): retire C2 client scan schedules (410 POST, card removed, ops script)"`

### Task 15: Full gates + docs

- [ ] **Step 1:** `npx tsc --noEmit` → clean. `npx vitest run` → all green (note pre-existing failures if any, verbatim). `npm run build` → succeeds (Codex #17).
- [ ] **Step 2:** CLAUDE.md: add `lib/sweep/` Key-files bullet (WeeklySweep slot identity, frozen cohort, snapshot immutability, coverage/change split) + "Weekly client sweep (2026-07-15)" Architecture-patterns paragraph + note in the C2 pattern that client scan schedules are retired (deliberate reversal, spec §3 D5). Env docs: `SUPPORT_NOTIFY_EMAIL` in the config reference.
- [ ] **Step 3: Commit** `git add CLAUDE.md && git commit -m "docs: weekly sweep key-files + architecture entries; C2 retirement note"`

## Execution notes

- Tasks 2→4→5 and 6→7→8 are the two dependency spines; 3, 9, 11 are parallel-safe once Task 2 lands. Task 13 needs 12; Task 14 is independent; Task 15 last.
- DB-backed tests follow the house convention (fresh SQLite per suite; see `lib/jobs/*.test.ts` for the harness pattern). Test-cleanup ordering: delete children before parents.
- Deploy sequence: merge → deploy (migration auto-applies) → run `scripts/retire-client-schedules.ts` on the server → set `SUPPORT_NOTIFY_EMAIL` in prod `.env` (or accept the default) → verify the two `system-*` schedules seeded (boot log) → first sweep fires next Monday 01:00 UTC; post-ship verification per spec §11.
