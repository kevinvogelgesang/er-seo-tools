# SEO Audit Overhaul — Phase 4 Implementation Plan (Structured recommendations + Teamwork push)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the flat recommendation strings with structured `Recommendation` objects, carry them (+ a Teamwork target) into the roadmap payload, and have the `seo-audit-roadmap` skill push **one Teamwork subtask per issue type** under the **"Audit Optimizations"** parent task — matching that parent's assignee, no time estimates, no priority flags.

**Architecture:** Push is **skill-driven via the Teamwork MCP** (the MCP only exists in Claude Desktop, not the deployed app — and this keeps Teamwork creds out of the app, consistent with the "external work stays out of the app" decision). The in-repo work: build structured `Recommendation[]` in the aggregator, add a configurable `Client.teamworkTasklistId`, and extend the roadmap GET payload with the structured recs + a `teamwork` directive block. The skill (out of repo) does the MCP push, human-confirmed in chat. **Auto-resolve-on-recrawl is deferred** (a later sub-phase); Phase 4 only creates, with a stable `affectedSetHash` per recommendation so re-pushes don't duplicate.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest. Reuses `priority.service.calculateEffort`, `lib/services/url-registry.rehydrate`, the `seo-roadmap` routes (Phase 2), the page index (Phase 3).

**Spec:** `docs/superpowers/specs/2026-06-01-seo-audit-overhaul-design.md` (Phase 4 + D7). Stacked on `feat/seo-audit-phase-3`.

**Verify:** `npx tsc --noEmit` · `npx vitest run <path>` · `npm run build` · `npx prisma migrate dev --name <name>` (local-dev DATABASE_URL override as in prior phases).

---

## Design decisions (locked)

- **Push mechanism:** skill-driven via Teamwork MCP. App emits data; skill pushes; you approve in chat. No `TEAMWORK_API_KEY` in the app.
- **Teamwork task rules (Kevin's exact spec):** each issue → a **subtask of the task named "Audit Optimizations"** in the configured tasklist; **match the parent task's assignee**; **NO time estimates**; **NO priority flags**.
- **Tasklist:** configurable per client via `Client.teamworkTasklistId` (nullable). When set, it's carried in the payload; when null, the skill asks the user (it can search via MCP).
- **One task per issue type** (D7). Duplicate-group issues keep one task with grouped sub-sections in the body. Issues with a source+target (e.g. broken internal links) include both in the body.
- **Idempotency now (creation only):** each `Recommendation` carries a stable `affectedSetHash` (hash of issueType + sorted rehydrated affected URLs — URL-based so it's even cross-crawl stable). The skill embeds `seo-hash:<hash>` in each subtask and skips creating a subtask whose hash already exists under the parent. **Auto-resolve deferred.**
- **Keep `recommendations: string[]`** on the result for back-compat (share view / existing consumers); **add `structured_recommendations: Recommendation[]`** alongside.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `lib/constants/issue-recommendations.ts` (new) | extracted `ISSUE_RECOMMENDATIONS` map + `fillTemplate()` | 1 |
| `lib/types/index.ts` | `Recommendation` type; `AggregatedResult.structured_recommendations?` | 1 |
| `lib/services/recommendation-builder.ts` (+ test) | `buildStructuredRecommendations(result)` → `Recommendation[]` | 2 |
| `lib/services/aggregator.service.ts` | use the extracted map; set `structured_recommendations` | 3 |
| `prisma/schema.prisma` + migration; `app/api/clients/[id]/route.ts`; `app/clients/page.tsx` | `Client.teamworkTasklistId` + edit it | 4 |
| `lib/parsers/claude-export-builder.ts`; `app/api/seo-roadmap/[id]/route.ts` | carry structured recs + `teamwork` block in payload | 5 |
| `components/seo-parser/RecommendationsPanel.tsx` + `ResultsView.tsx` | render structured recs in-app | 6 |
| `~/.claude/skills/seo-audit-roadmap/` (out of repo) | MCP Teamwork push per the rules | 7 |

---

## Task 1: Extract recommendations map + add `Recommendation` type

**Files:** Create `lib/constants/issue-recommendations.ts`; modify `lib/types/index.ts` and `lib/services/aggregator.service.ts` (just the import; the structured build is Task 3).

- [ ] **Step 1: Move the map.** Cut the `ISSUE_RECOMMENDATIONS: Record<string,string>` object out of `aggregator.service.ts` (~line 60) into `lib/constants/issue-recommendations.ts`, exported. Add a helper:

```typescript
export const ISSUE_RECOMMENDATIONS: Record<string, string> = { /* …moved verbatim… */ };

/** Fill the {count} placeholder in a recommendation template. */
export function fillRecommendationTemplate(template: string, count: number): string {
  return template.replace(/\{count\}/g, String(count));
}
```
Update `aggregator.service.ts` to `import { ISSUE_RECOMMENDATIONS } from '@/lib/constants/issue-recommendations';` and keep its existing `buildRecommendations()` (string[]) working via the imported map (it currently inlines the `{count}` replace — leave that or switch it to `fillRecommendationTemplate`).

- [ ] **Step 2: Add the `Recommendation` type** to `lib/types/index.ts`:

```typescript
export interface Recommendation {
  issueType: string;
  severity: 'critical' | 'warning' | 'notice';
  count: number;
  effort: 'low' | 'medium' | 'high';
  fixGuidance: string;                 // {count} filled
  affectedUrlRefs: UrlRef[];           // compact; skill rehydrates via url_registry
  affectedUrlCount: number;
  affectedUrlComplete: boolean;        // from Issue.affectedUrlRefsComplete
  affectedUrlSource?: 'derived-page-index' | 'parser-complete' | 'parser-sample';
  affectedSetHash: string;             // stable, URL+source-based (idempotency marker; sample-based when not complete)
  // Detail the skill needs WITHOUT cross-referencing audit.issues (Codex fix #2):
  groups?: Issue['groups'];            // duplicate-group issues → grouped subsections in the task body
  sampleUrls?: string[];               // raw issue.urls (may encode "source -> target" strings for some parsers)
}
```
(`Issue` and `UrlRef` are already declared in this file — no new import.)
And add to `AggregatedResult`: `structured_recommendations?: Recommendation[];`

- [ ] **Step 3:** `npx tsc --noEmit` → PASS (map move is behavior-preserving; type additions are optional).

- [ ] **Step 4: Commit**

```bash
git add lib/constants/issue-recommendations.ts lib/types/index.ts lib/services/aggregator.service.ts
git commit -m "refactor(seo): extract ISSUE_RECOMMENDATIONS; add Recommendation type"
```
(End each commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: `recommendation-builder.ts` (pure builder + test)

**Files:** Create `lib/services/recommendation-builder.ts`, `lib/services/recommendation-builder.test.ts`. Pure (no Prisma). Reuses `calculateEffort` (priority.service), `rehydrate` (url-registry), the constants map.

- [ ] **Step 1: Failing test:**

```typescript
import { describe, it, expect } from 'vitest';
import { buildStructuredRecommendations } from './recommendation-builder';
import type { AggregatedResult } from '@/lib/types';

function makeResult(): AggregatedResult {
  return {
    crawl_summary: {} as AggregatedResult['crawl_summary'],
    issues: {
      critical: [{ type: 'missing_title', severity: 'critical', count: 2, description: '',
        affectedUrlRefs: [0, 1], affectedUrlRefsComplete: true, affectedUrlSource: 'derived-page-index' }],
      warnings: [{ type: 'thin_content', severity: 'warning', count: 1, description: '',
        affectedUrlRefs: [1], affectedUrlRefsComplete: true, affectedUrlSource: 'derived-page-index' }],
      notices: [],
    },
    site_structure: {} as AggregatedResult['site_structure'],
    resources: {} as AggregatedResult['resources'],
    technical_seo: {} as AggregatedResult['technical_seo'],
    performance: {} as AggregatedResult['performance'],
    recommendations: [],
    metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0 },
    url_registry: { sessionOrigin: { scheme: 'https', host: 'x.edu' }, hosts: ['x.edu'],
      urls: [ { id: 0, kind: 'page', scheme: 'https', hostId: 0, path: '/a' }, { id: 1, kind: 'page', scheme: 'https', hostId: 0, path: '/b' } ] },
  } as AggregatedResult;
}

describe('buildStructuredRecommendations', () => {
  it('produces one recommendation per issue with effort, guidance, counts and a stable hash', () => {
    const recs = buildStructuredRecommendations(makeResult());
    const mt = recs.find(r => r.issueType === 'missing_title')!;
    expect(mt.severity).toBe('critical');
    expect(mt.count).toBe(2);
    expect(mt.affectedUrlCount).toBe(2);
    expect(mt.effort).toBe('medium');             // missing_title isn't in LOW/HIGH sets → medium
    expect(mt.fixGuidance).toContain('2');        // {count} filled
    expect(mt.affectedUrlComplete).toBe(true);
    expect(typeof mt.affectedSetHash).toBe('string');
    expect(mt.affectedSetHash.length).toBeGreaterThan(0);
  });
  it('hash is stable across calls and differs by issue', () => {
    const a = buildStructuredRecommendations(makeResult());
    const b = buildStructuredRecommendations(makeResult());
    expect(a[0].affectedSetHash).toBe(b[0].affectedSetHash);
    expect(a[0].affectedSetHash).not.toBe(a[1].affectedSetHash);
  });
  it('orders critical before warning before notice', () => {
    const recs = buildStructuredRecommendations(makeResult());
    expect(recs[0].severity).toBe('critical');
  });
}
```

- [ ] **Step 2:** Run `npx vitest run lib/services/recommendation-builder.test.ts`; FAIL.

- [ ] **Step 3: Implement:**

```typescript
import type { AggregatedResult, Issue, Recommendation, UrlRef } from '@/lib/types';
import { calculateEffort } from './priority.service';
import { rehydrate } from './url-registry';
import { ISSUE_RECOMMENDATIONS, fillRecommendationTemplate } from '@/lib/constants/issue-recommendations';

const SEV_ORDER = { critical: 0, warning: 1, notice: 2 } as const;

// Small, dependency-free stable string hash (djb2 → base36). URL-based so it survives re-crawls.
function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function buildStructuredRecommendations(result: AggregatedResult): Recommendation[] {
  const reg = result.url_registry;
  const all: Array<{ issue: Issue; severity: 'critical' | 'warning' | 'notice' }> = [
    ...result.issues.critical.map((issue) => ({ issue, severity: 'critical' as const })),
    ...result.issues.warnings.map((issue) => ({ issue, severity: 'warning' as const })),
    ...result.issues.notices.map((issue) => ({ issue, severity: 'notice' as const })),
  ];

  const recs: Recommendation[] = all.map(({ issue, severity }) => {
    const refs: UrlRef[] = issue.affectedUrlRefs ?? [];
    // Fallback to issue.urls for old/partial results so the hash + count aren't empty-by-accident (Codex fix #1).
    const urls = reg && refs.length
      ? refs.map((r) => rehydrate(reg, r)).filter(Boolean)
      : (issue.urls ?? []);
    const sortedUrls = [...urls].sort();
    const template = ISSUE_RECOMMENDATIONS[issue.type];
    const source = issue.affectedUrlSource ?? 'unknown';
    return {
      issueType: issue.type,
      severity,
      count: issue.count,
      effort: calculateEffort(issue),
      fixGuidance: template ? fillRecommendationTemplate(template, issue.count) : `Address ${issue.count} ${issue.type} issue(s).`,
      affectedUrlRefs: refs,
      affectedUrlCount: refs.length || urls.length,
      affectedUrlComplete: issue.affectedUrlRefsComplete ?? false,
      affectedUrlSource: issue.affectedUrlSource,
      // Hash includes the source so a sample-hash never collides with/implies a complete-set hash (Codex fix #3).
      affectedSetHash: stableHash(`${issue.type}|${source}|${sortedUrls.join(',')}`),
      groups: issue.groups,
      sampleUrls: issue.urls,
    };
  });

  return recs.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}
```
Confirm on read: `calculateEffort(issue)` is exported from `priority.service` and returns `'low'|'medium'|'high'` (it is). Adjust the `medium` test expectation if `calculateEffort` maps `missing_title` differently — run the test and trust the real output (fix the test to match real effort, not the reverse).

- [ ] **Step 4:** Test PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/services/recommendation-builder.ts lib/services/recommendation-builder.test.ts
git commit -m "feat(seo): structured recommendation builder (effort + guidance + stable hash)"
```

---

## Task 3: Wire structured recs into the aggregator

**Files:** Modify `lib/services/aggregator.service.ts` (`aggregate()` — near where `result.recommendations` / `result.page_index` are set).

- [ ] **Step 1:** Import `buildStructuredRecommendations` and, in `aggregate()` **strictly AFTER the Phase 1 block that sets `result.url_registry`, `result.page_index`, and every `issue.affectedUrlRefs`/`affectedUrlSource`** (non-negotiable ordering — the builder reads all of those), add:

```typescript
result.structured_recommendations = buildStructuredRecommendations(result);
```

- [ ] **Step 2: Test** — extend an existing aggregator test (or add `aggregator.structured-recs.test.ts`): feed a minimal parser set that yields a `missing_title` issue + an internal `per_url_index`, call `aggregate()`, assert `result.structured_recommendations` has a `missing_title` entry with `affectedUrlCount > 0` and a non-empty `affectedSetHash`. (Mirror the Phase 1 `aggregator.keyword-gaps.test.ts` setup style.)

- [ ] **Step 3:** `npx vitest run lib/services/` and `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/services/aggregator.service.ts lib/services/aggregator.structured-recs.test.ts
git commit -m "feat(seo): aggregator emits structured_recommendations"
```

---

## Task 4: `Client.teamworkTasklistId` (schema + API + UI)

**Files:** `prisma/schema.prisma` + migration; `app/api/clients/[id]/route.ts`; `app/clients/page.tsx`.

- [ ] **Step 1: Schema** — add to `model Client`:

```prisma
  teamworkTasklistId String?   // Teamwork tasklist that holds this client's "Audit Optimizations" task
```
Migrate: `npx prisma migrate dev --name client_teamwork_tasklist` (local-dev DATABASE_URL override as before). Verify `ALTER TABLE "Client" ADD COLUMN "teamworkTasklistId" TEXT;`. `npx tsc --noEmit`.

- [ ] **Step 2: API** — in `app/api/clients/[id]/route.ts` `PATCH`, accept the field (mirror the existing `name`/`domains` handling): add to the `data` type and:

```typescript
if ('teamworkTasklistId' in body) {
  const v = body.teamworkTasklistId;
  data.teamworkTasklistId = typeof v === 'string' && v.trim() ? v.trim() : null;
}
```
Add `teamworkTasklistId: true` to the `select` and return it (parse not needed — it's a plain string). Also add it to the `select` in **both** `GET` and `POST` of `app/api/clients/route.ts` (the POST create path must return `teamworkTasklistId: null` for new clients), and update the `Client` TypeScript interface in `app/clients/page.tsx` to include `teamworkTasklistId: string | null` (Codex fix #5).

- [ ] **Step 3: UI** — on `app/clients/page.tsx`, add a small "Teamwork tasklist ID" text input per client (next to the existing domains/seed-url editing), saving via the existing PATCH flow. Match the page's existing edit pattern (read the file; keep it minimal — one input + the existing save mechanism). If the clients page edit UX is complex, add the input in the same row/section the seedUrls/domains use.

- [ ] **Step 4:** `npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations "app/api/clients/[id]/route.ts" app/api/clients/route.ts app/clients/page.tsx
git commit -m "feat(seo): configurable Client.teamworkTasklistId"
```

---

## Task 5: Carry structured recs + Teamwork directive into the roadmap payload

**Files:** `lib/parsers/claude-export-builder.ts`; `app/api/seo-roadmap/[id]/route.ts`.

- [ ] **Step 1: Export builder** — add `structured_recommendations?: Recommendation[]` to the `TechnicalAuditExport` interface and pass it through in `buildTechnicalAuditExport`: `structured_recommendations: result.structured_recommendations`. (Import `Recommendation` from `@/lib/types`. Keep the module browser-safe.) Add/extend the export test to assert it flows through.

- [ ] **Step 2: GET payload** — in `app/api/seo-roadmap/[id]/route.ts`, also load the client and attach a `teamwork` directive block. Change the `findUnique` include to `{ session: { include: { client: true } } }`, then:

```typescript
const client = roadmap.session.client;
return NextResponse.json({
  id: roadmap.id,
  sessionId: roadmap.sessionId,
  siteName: roadmap.session.siteName,
  status: roadmap.status,
  audit: buildTechnicalAuditExport(result),   // now includes structured_recommendations
  teamwork: {
    tasklistId: client?.teamworkTasklistId ?? null,
    parentTaskName: 'Audit Optimizations',
    taskType: 'subtask',
    rules: { matchParentAssignee: true, addTimeEstimates: false, usePriorityFlags: false },
  },
});
```

- [ ] **Step 3: Test** — extend `app/api/seo-roadmap/[id]/route.test.ts`: mock the roadmap with `session.client = { teamworkTasklistId: 'tl_123' }`, assert the 200 response has `teamwork.tasklistId === 'tl_123'`, `teamwork.parentTaskName === 'Audit Optimizations'`, `teamwork.rules.addTimeEstimates === false`, and `audit.structured_recommendations` is present. Also a case where `client` is null → `teamwork.tasklistId === null`.

- [ ] **Step 4:** `npx vitest run lib/parsers "app/api/seo-roadmap"` + `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/claude-export-builder.ts lib/parsers/claude-export-builder.test.ts "app/api/seo-roadmap/[id]/route.ts" "app/api/seo-roadmap/[id]/route.test.ts"
git commit -m "feat(seo): roadmap payload carries structured recs + Teamwork directive"
```

---

## Task 6: Render structured recommendations in-app

**Files:** Create `components/seo-parser/RecommendationsPanel.tsx`; modify `components/seo-parser/ResultsView.tsx`.

- [ ] **Step 1: Component** — `RecommendationsPanel({ recommendations }: { recommendations: Recommendation[] })`. Render a list (severity-ordered, already sorted) where each row shows: severity dot/badge, `issueType` (humanized), an **effort badge** (low/med/high), affected-URL count (with a "sample" note when `affectedUrlSource !== 'derived-page-index'` and not complete), and the `fixGuidance`. Match the styling of `SuggestedPriorities.tsx`/`RecommendationList.tsx` (read them).

- [ ] **Step 2: Wire into `ResultsView.tsx`** — where `<RecommendationList recommendations={result.recommendations} />` is rendered, render `<RecommendationsPanel recommendations={result.structured_recommendations} />` instead when `result.structured_recommendations?.length`, else fall back to the existing `<RecommendationList>` (back-compat for old sessions). Don't remove `RecommendationList` (the share view may still use it).

- [ ] **Step 3:** `npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/RecommendationsPanel.tsx components/seo-parser/ResultsView.tsx
git commit -m "feat(seo): in-app structured recommendations panel (effort + affected counts)"
```

---

## Task 7: Update the `seo-audit-roadmap` skill for Teamwork push (out of repo)

**Files:** `~/.claude/skills/seo-audit-roadmap/SKILL.md` (+ templates/scripts). NOT in the repo PR.

- [ ] **Step 1:** Read the current `~/.claude/skills/seo-audit-roadmap/SKILL.md`. Add a **Teamwork push** stage AFTER the roadmap PATCH-back:
  - Read `payload.teamwork` (from the GET response) and `payload.audit.structured_recommendations`.
  - **Only when the user approves** (the skill offers: "Push N issues to Teamwork as subtasks of 'Audit Optimizations'?"). Never auto-push.
  - Resolve the tasklist: use `teamwork.tasklistId` if present; else ask the user / search via `mcp__claude_ai_Teamwork__twprojects-list_tasklists`.
  - Find the parent task named **`teamwork.parentTaskName` ("Audit Optimizations")** in that tasklist (`twprojects-list_tasks` / `twprojects-get_tasklist`). **If multiple tasks share that name, ask the user which one.** Read its **assignee(s)**.
  - **Idempotency (Codex fix #7):** list ALL existing subtasks of that parent, **handling MCP pagination** (loop until no more pages). Skip creating any subtask whose description contains the **plain-text** marker `seo-hash:<affectedSetHash>`. Use a plain-text marker line (NOT an HTML comment — Teamwork may strip/hide those). Match by hash as primary; also write `seo-issue-type:<issueType>` as a human/audit fallback.
  - For each `structured_recommendations` entry, create a subtask (`twprojects-create_task` with the parent task id):
    - Title: e.g. `[SEO] {humanized issueType} — {count}`.
    - Description (markdown): `fixGuidance`; then affected URLs (rehydrate `affectedUrlRefs` via `payload.audit.url_registry`; if `!affectedUrlComplete` or `affectedUrlSource !== 'derived-page-index'`, label "sample of N — see full audit"). Use `groups` to render grouped sub-sections for duplicate-title/H1/meta issues. **Only render a "source → target" split when the data actually encodes it** (e.g. `sampleUrls` entries containing `->`); otherwise just list affected URLs — do NOT fabricate source/target structure (most parsers only give targets). End with the two marker lines: `seo-hash:{affectedSetHash}` and `seo-issue-type:{issueType}`.
    - **Assignee (Codex fix #8):** match the parent task's assignee. If the parent has none → create unassigned. If it has multiple and Teamwork supports multiple assignees → copy all; otherwise ask the user. **Do NOT set a time/effort estimate. Do NOT set a priority flag.** (Effort is body text only.)
  - Reply with a summary (created N, skipped M duplicates) + the dashboard URL.
  - **Document the idempotency failure modes** in the skill (user edits/deletes the marker or subtasks; parent renamed/missing; duplicate parents; a changed affected set yields a new hash → a new subtask rather than an update — acceptable until the deferred auto-resolve phase).

- [ ] **Step 2:** Bump `~/.claude/skills/seo-audit-roadmap/version.txt`. Update its README. No repo tests — verified in the exit checklist against a real client. Note in the PR description that the skill changed (out of repo).

---

## Phase 4 Exit Verification

- [ ] `npx tsc --noEmit` clean; `npx vitest run lib app/api/seo-roadmap app/api/clients` green; `npm run build` succeeds; migration applies.
- [ ] A parsed session's roadmap GET payload includes `audit.structured_recommendations` (each with effort, fixGuidance, affectedUrlRefs, affectedSetHash) and a `teamwork` block (tasklistId from the client, parentTaskName "Audit Optimizations", rules: no estimates / no priority).
- [ ] Results page shows the structured recommendations panel (effort badges, affected counts, sample labels).
- [ ] A client's `teamworkTasklistId` can be set in the clients UI and appears in the payload.
- [ ] Manual skill run: roadmap generated → "Push to Teamwork?" → on approval, subtasks created under "Audit Optimizations" in the right tasklist, matching the parent's assignee, with NO estimates and NO priority; re-running skips duplicates by hash.

## Out of scope (later)
- Auto-resolve-on-recrawl (diff marks pushed tasks done) — needs the diff service; deferred sub-phase.
- P5 per-client history/trends (consumes the Phase 3 scalars). P6 keyword research route.

## Notes / risk
- **Effort source:** reuse `priority.service.calculateEffort` — single source of truth for effort across "Suggested Priorities" and recommendations. Don't fork a second effort map.
- **`affectedSetHash` is URL-based** (rehydrated, sorted) so it's stable across re-crawls — enabling the deferred auto-resolve phase to match the same issue's task later.
- **Skill is the only Teamwork integration** — no Teamwork creds, SDK, or REST in the repo. If a future requirement needs server-side push (e.g. scheduled), revisit then.
- **Back-compat:** `result.recommendations` (string[]) stays; `structured_recommendations` is additive and optional, so old sessions + the share view keep working.
