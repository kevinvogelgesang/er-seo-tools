# C11 PR 3 — `/seo-parser` → `/seo-audits` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `/seo-parser` tool surface to `/seo-audits` (with permanent redirects), fix the live-scan results "archived" banner, and mature the SEO index to structurally mirror the ADA-audit index.

**Architecture:** A route-folder move + permanent 308 redirects in `next.config.ts` (which run before middleware, so old bookmarks/share links survive auth-gated). A literal `/seo-parser` → `/seo-audits` swap across nav/link/handoff sites (the `tool:'seo-parser'` DB value, `/api/*` routes, and `@/…/seo-parser` imports are NOT touched). A typed `archived` param on the findings-fallback builder plus an explicit live-scan branch in `ResultsView`. A `SeoAuditTabs` + `SeoUploadCard` refactor of the index page.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind (class dark mode), Vitest, Prisma+SQLite. Migration-free.

## Global Constraints

- **Working directory:** `/Users/kevin/enrollment-resources/Claude/er-seo-tools/.claude/worktrees/c11-pr3` (branch `feat/c11-pr3-seo-audits`, off `origin/main`). `.env` + `node_modules` + prisma client already set up.
- **Never rename** the persisted `tool: 'seo-parser'` `CrawlRun` discriminator, the API routes (`/api/parse/*`, `/api/seo-parser/*`) and `fetch()` calls to them, or the `@/components/seo-parser/*` / `@/lib/seo-parser/*` import paths and directories. Only the **URL path** `/seo-parser` and the user-visible **label** "SEO Parser" change.
- **UI:** `dark:` variant on every element; page roots use the A8 shell convention (no own `min-h-screen`/`bg-*` — the shell `<main>` supplies the background); no hydration-mismatch patterns.
- **Gate commands (all three green before PR):** `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- **Test env prefix:** DB-backed tests need `DATABASE_URL="file:./local-dev.db"`.
- **Commit trailer** (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY
  ```

## File Structure

**Created:**
- `components/seo-parser/SeoUploadCard.tsx` — the extracted CSV upload flow (client).
- `components/seo-parser/SeoAuditTabs.tsx` — tabbed "New SEO Audit" card (Scan / Upload).
- `components/seo-parser/SeoAuditTabs.test.tsx`, `SeoUploadCard.test.tsx`.

**Moved (`git mv`, history preserved):** `app/(app)/seo-parser/**` → `app/(app)/seo-audits/**` (8 files).

**Modified (URL swap):** `next.config.ts`, `next.config.test.ts`, `middleware.test.ts`, `lib/tools-registry.ts`, `components/footer.tsx`, `app/(app)/ada-audit/site/[id]/seo-only-redirect.ts` (+ its test), `components/widgets/{LiveNowWidget,RecentParsesWidget,QuickParserWidget,QuickSiteAuditWidget}.tsx`, `components/ada-audit/{QueueMemberRow,DashboardQueueStatus,SiteAuditForm}.tsx`, `components/clients/{IssueTrendCard,ScheduledScansCard}.tsx`, `app/(app)/pillar-analysis/[id]/page.tsx`, `lib/services/{client-dashboard,client-findings,scorecard-shared}.ts`, `components/seo-parser/{HistoryList,ResultsView,SeoScanForm}.tsx`, `app/(app)/seo-audits/page.tsx` (post-move), plus assorted test files.

**Modified (polish):** `lib/findings/seo-findings-fallback.ts`, `components/seo-parser/ResultsView.tsx`.

**Modified (skill):** `skills/er-handoff-memo/SKILL.md`, `skills/er-handoff-memo/templates/screaming-frog-setup.md`.

---

### Task 1: Permanent redirects in `next.config.ts`

**Files:**
- Modify: `next.config.ts`
- Test: `next.config.test.ts`, `middleware.test.ts`

**Interfaces:**
- Produces: `nextConfig.redirects()` resolving to an array containing `{ source: '/seo-parser', destination: '/seo-audits', permanent: true }` and `{ source: '/seo-parser/:path*', destination: '/seo-audits/:path*', permanent: true }`.

- [ ] **Step 1: Write the failing test** — append to `next.config.test.ts`:

```ts
describe('next.config /seo-parser → /seo-audits redirects', () => {
  it('permanently redirects the base path and all subpaths', async () => {
    const redirects = await (nextConfig.redirects?.() ?? Promise.resolve([]))
    const base = redirects.find((r) => r.source === '/seo-parser')
    const sub = redirects.find((r) => r.source === '/seo-parser/:path*')
    expect(base).toMatchObject({ destination: '/seo-audits', permanent: true })
    expect(sub).toMatchObject({ destination: '/seo-audits/:path*', permanent: true })
  })
})
```

- [ ] **Step 2: Add a `/seo-audits` gated-path assertion** — in `middleware.test.ts`, add to the existing "ordinary app API surface must remain gated" `it.each([...])` list (the one asserting `isPublicPath(p)).toBe(false)`) these two entries:

```ts
    // C11 PR3: the renamed SEO tool surface is authed exactly like /seo-parser was.
    '/seo-audits',
    '/seo-audits/results/run/abc',
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run next.config.test.ts middleware.test.ts`
Expected: `next.config.test.ts` FAILS (no redirects); `middleware.test.ts` PASSES already (isPublicPath returns false for unknown paths — this is a regression guard, may pass immediately).

- [ ] **Step 4: Add `redirects()` to `next.config.ts`** — inside the `nextConfig` object (e.g. after `poweredByHeader: false,`):

```ts
  async redirects() {
    // C11 PR3: /seo-parser renamed to /seo-audits. Permanent 308s so old
    // bookmarks and already-shipped srt_ handoff "Webapp:" links survive.
    // redirects() runs BEFORE middleware, so the old path 308s first and the
    // new path is then auth-gated exactly as the old one was.
    return [
      { source: '/seo-parser', destination: '/seo-audits', permanent: true },
      { source: '/seo-parser/:path*', destination: '/seo-audits/:path*', permanent: true },
    ]
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run next.config.test.ts middleware.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add next.config.ts next.config.test.ts middleware.test.ts
git commit -m "feat(c11): permanent /seo-parser → /seo-audits redirects$'\n\n'<trailer>"
```

---

### Task 2: Move the route folder + fix internal hrefs

**Files:**
- Move: `app/(app)/seo-parser/**` → `app/(app)/seo-audits/**`
- Modify (internal hrefs, post-move): `app/(app)/seo-audits/page.tsx`, `app/(app)/seo-audits/diff/page.tsx`, `app/(app)/seo-audits/results/[sessionId]/page.tsx`

**Interfaces:**
- Produces: routes `/seo-audits`, `/seo-audits/diff`, `/seo-audits/results/[sessionId]`, `/seo-audits/results/run/[runId]`.

- [ ] **Step 1: Move the folder with git**

```bash
git mv "app/(app)/seo-parser" "app/(app)/seo-audits"
```

- [ ] **Step 2: Fix internal `/seo-parser` hrefs inside the moved files**

In `app/(app)/seo-audits/page.tsx`: `router.push(\`/seo-parser/results/${sessionId}\`)` → `/seo-audits/results/${sessionId}`; `href="/seo-parser/diff"` → `/seo-audits/diff`.
In `app/(app)/seo-audits/diff/page.tsx`: both `<Link href="/seo-parser">` (lines ~193, ~224) → `/seo-audits`.
In `app/(app)/seo-audits/results/[sessionId]/page.tsx`: all three `href="/seo-parser"` (lines ~27, ~66, ~84) → `/seo-audits`.

(Leave `import … from '@/components/seo-parser/…'` imports unchanged — they are module paths, not URLs.)

- [ ] **Step 3: Verify no stale internal URL remains in the moved tree**

Run: `grep -rn "/seo-parser" "app/(app)/seo-audits"`
Expected: only `@/components/seo-parser` / `@/lib/seo-parser` import lines and `/api/seo-parser` API references — **no** bare `/seo-parser` route hrefs.

- [ ] **Step 4: Run the moved page's own tests + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/(app)/seo-audits/results/[sessionId]/result-json.test.ts" && npm run lint`
Expected: PASS (result-json tests are path-agnostic; tsc clean).

- [ ] **Step 5: Commit**

```bash
git add -A "app/(app)"
git commit -m "feat(c11): move seo-parser route tree to /seo-audits + internal hrefs$'\n\n'<trailer>"
```

---

### Task 3: Nav registry + footer label/href

**Files:**
- Modify: `lib/tools-registry.ts`, `components/footer.tsx`
- Test: `lib/tools-registry.test.ts`, `components/shell/Topbar.test.tsx`

**Interfaces:**
- Produces: nav entry with `name: 'SEO Audits'`, `href: '/seo-audits'`, children hrefs `/seo-audits` + `/seo-audits/diff`. Internal `id: 'seo-parser'` UNCHANGED.

- [ ] **Step 1: Update the failing tests first**

In `lib/tools-registry.test.ts` and `components/shell/Topbar.test.tsx`, change any assertion expecting `'/seo-parser'` / `'SEO Parser'` for this tool to `'/seo-audits'` / `'SEO Audits'`. (Grep them: `grep -n "seo-parser\|SEO Parser" lib/tools-registry.test.ts components/shell/Topbar.test.tsx`.) Keep the `id: 'seo-parser'` expectation if one exists — the id does not change.

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/tools-registry.test.ts components/shell/Topbar.test.tsx`
Expected: FAIL (source still says `/seo-parser`).

- [ ] **Step 3: Update source**

`lib/tools-registry.ts` (the `id: 'seo-parser'` entry): `name: 'SEO Parser'` → `'SEO Audits'`; `href: '/seo-parser'` → `'/seo-audits'`; children `{ name: 'All sessions', href: '/seo-parser' }` → `href: '/seo-audits'`; `{ name: 'Compare crawls', href: '/seo-parser/diff' }` → `href: '/seo-audits/diff'`. Optionally update `description` copy if it says "Parser". Leave `id: 'seo-parser'`.
`components/footer.tsx`: `{ name: 'SEO Parser', href: '/seo-parser' }` → `{ name: 'SEO Audits', href: '/seo-audits' }`.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/tools-registry.test.ts components/shell/Topbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tools-registry.ts components/footer.tsx lib/tools-registry.test.ts components/shell/Topbar.test.tsx
git commit -m "feat(c11): rename nav + footer 'SEO Parser' → 'SEO Audits' (/seo-audits)$'\n\n'<trailer>"
```

---

### Task 4: seoOnly behavioral routing hrefs

**Files:**
- Modify: `app/(app)/ada-audit/site/[id]/seo-only-redirect.ts`, `components/widgets/LiveNowWidget.tsx`, `components/ada-audit/QueueMemberRow.tsx`, `components/ada-audit/DashboardQueueStatus.tsx`
- Test: `app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts` (+ any widget/queue test asserting `/seo-parser`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `seoOnlyRedirectTarget({seoOnly:true})` returns `'/seo-audits'`.

- [ ] **Step 1: Update / add the failing tests.**
  - `seo-only-redirect.test.ts` — change the seoOnly expectation from `'/seo-parser'` to `'/seo-audits'`.
  - **Add href assertions** to the three UI-site tests (Codex: they currently assert only the SEO chip, so the source edits would otherwise be untested). In `components/widgets/LiveNowWidget.test.tsx`, `components/ada-audit/QueueMemberRow.test.tsx`, and `components/ada-audit/DashboardQueueStatus.test.tsx` (create the test or extend the existing one), assert the seoOnly row/card link points to `/seo-audits`, e.g.:
    ```tsx
    // for a seoOnly member/active audit fixture:
    expect(screen.getByRole('link', { name: /example\.com|Current Scan/i }).getAttribute('href')).toBe('/seo-audits')
    ```
    (Adjust the accessible name to the component's actual link text; these files use `// @vitest-environment jsdom` + `@testing-library/react`, no jest-dom — use `.getAttribute('href')).toBe(...)`, not `toHaveAttribute`.)

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts" components/widgets/LiveNowWidget.test.tsx components/ada-audit/QueueMemberRow.test.tsx components/ada-audit/DashboardQueueStatus.test.tsx`
Expected: FAIL (redirect target + the new href assertions).

- [ ] **Step 3: Update sources** (all four `active.seoOnly ? '/seo-parser' : …` / return sites):
  - `seo-only-redirect.ts:5` — `return audit.seoOnly ? '/seo-parser' : null` → `'/seo-audits'`.
  - `LiveNowWidget.tsx:40` — `active.seoOnly ? '/seo-parser' : …` → `'/seo-audits'`.
  - `QueueMemberRow.tsx:69` — `member.seoOnly ? '/seo-parser' : …` → `'/seo-audits'`.
  - `DashboardQueueStatus.tsx:131` — `active.seoOnly ? '/seo-parser' : …` → `'/seo-audits'`.
  - Update the adjacent `// … route to /seo-parser` comments to `/seo-audits` in each.

- [ ] **Step 4: Run to verify pass** (and any queue/widget test)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts" components/ada-audit components/widgets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/ada-audit/site/[id]/seo-only-redirect.ts" "app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts" components/widgets/LiveNowWidget.tsx components/ada-audit/QueueMemberRow.tsx components/ada-audit/DashboardQueueStatus.tsx
git commit -m "feat(c11): seoOnly routing hrefs → /seo-audits (4 behavioral sites)$'\n\n'<trailer>"
```

---

### Task 5: Remaining link-string swaps (widgets, forms, client cards, services, seo components)

**Files:**
- Modify: `components/ada-audit/SiteAuditForm.tsx`, `components/widgets/{QuickSiteAuditWidget,RecentParsesWidget,QuickParserWidget}.tsx`, `components/clients/{IssueTrendCard,ScheduledScansCard}.tsx`, `app/(app)/pillar-analysis/[id]/page.tsx`, `lib/services/{client-dashboard,client-findings,scorecard-shared}.ts`, `components/seo-parser/{HistoryList,ResultsView,SeoScanForm}.tsx`
- Test: the corresponding `*.test.ts(x)` for each (see grep in Step 1)

**Interfaces:**
- Produces: every remaining product `/seo-parser` URL literal becomes `/seo-audits`. `SeoScanForm` `replaceState` target becomes `/seo-audits`.

- [ ] **Step 1: Update failing tests first.** Grep the test set and swap `/seo-parser` → `/seo-audits` in each assertion:

Run: `grep -rln "/seo-parser" components/clients components/widgets components/seo-parser components/ada-audit lib/services --include="*.test.ts" --include="*.test.tsx"`
Update each hit (e.g. `RecentParsesWidget.test.tsx`, `QuickParserWidget.test.tsx`, `QuickSiteAuditWidget.test.tsx`, `ScheduledScansCard.test.tsx`, `Scorecard.test.tsx`, `FindingsPanel.test.tsx`, `ActivityTimeline.test.tsx`, `client-dashboard.test.ts`, `client-findings.test.ts`, `scorecard-shared.test.ts`, `SiteAuditForm.test.tsx`, `SeoScanForm.test.tsx`) so link expectations read `/seo-audits`. Leave `/api/seo-parser` and `tool:'seo-parser'` assertions untouched.

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients components/widgets components/seo-parser components/ada-audit/SiteAuditForm.test.tsx lib/services`
Expected: FAIL (sources still emit `/seo-parser`).

- [ ] **Step 3: Update sources** — swap the URL literal `/seo-parser` → `/seo-audits` at each site (NOT `/api/seo-parser`, NOT imports):
  - `SiteAuditForm.tsx:195,256` — `\`/seo-parser?scan=${data.id}\`` → `\`/seo-audits?scan=${data.id}\``.
  - `QuickSiteAuditWidget.tsx:30` — `\`/seo-parser?scan=${data.id}\`` → `\`/seo-audits?scan=${data.id}\`` (keep the `?scan=${data.id}`).
  - `RecentParsesWidget.tsx:25-26` — both `/seo-parser/results/...` → `/seo-audits/results/...`.
  - `QuickParserWidget.tsx:18` — `\`/seo-parser/results/${sessionId}\`` → `\`/seo-audits/results/${sessionId}\`` (keep the `/results/${sessionId}`). (Leave the `@/lib/seo-parser/client-upload` import.)
  - `IssueTrendCard.tsx:35` — `\`/seo-parser/diff?a=...&b=...\`` → `/seo-audits/diff?...`.
  - `ScheduledScansCard.tsx:198` — `\`/seo-parser/results/run/${s.liveRunId}\`` and `\`/seo-parser?scan=${s.lastRun.id}\`` → `/seo-audits/...`.
  - `pillar-analysis/[id]/page.tsx:68` — `\`/seo-parser/results/${pa.session.id}\`` → `/seo-audits/...`.
  - `lib/services/client-dashboard.ts:176,190` — both `href: \`/seo-parser/results/${s.id}\`` → `/seo-audits/...` (and the `:196` comment).
  - `lib/services/client-findings.ts:62-63` — `/seo-parser/results/run/${run.id}` + `/seo-parser/results/${run.sessionId}` → `/seo-audits/...`.
  - `lib/services/scorecard-shared.ts:74-75` — same two → `/seo-audits/...` (and the `:71-72` doc comment).
  - `components/seo-parser/HistoryList.tsx:232-233` — both → `/seo-audits/...`.
  - `components/seo-parser/ResultsView.tsx:116` — `router.push('/seo-parser')` → `'/seo-audits'`.
  - `components/seo-parser/SeoScanForm.tsx:39` — `replaceState({}, '', '/seo-parser')` → `'/seo-audits'`; `:230` — `href={\`/seo-parser/results/run/${runId}\`}` → `/seo-audits/...`.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients components/widgets components/seo-parser components/ada-audit/SiteAuditForm.test.tsx lib/services`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components lib/services "app/(app)/pillar-analysis"
git commit -m "feat(c11): swap remaining /seo-parser product links → /seo-audits$'\n\n'<trailer>"
```

---

### Task 6: Update the `er-handoff-memo` skill "Webapp:" path

**Files:**
- Modify: `skills/er-handoff-memo/SKILL.md`, `skills/er-handoff-memo/templates/screaming-frog-setup.md`

**Interfaces:** none (docs). New srt_ memos emit `/seo-audits`; old shipped memos still resolve via the Task 1 redirect.

- [ ] **Step 1: Update the skill paths**
  - `SKILL.md:137` — `{Webapp}/seo-parser/results/{sessionId}` → `{Webapp}/seo-audits/results/{sessionId}`.
  - `screaming-frog-setup.md` — the `/seo-parser` mentions (lines ~105, 107, 137, 156, 172, 251) → `/seo-audits`, and the `## Use case 1 — Technical Audit (\`/seo-parser\`)` heading → `/seo-audits`.

- [ ] **Step 2: Update user-facing docs (Codex: README has user-facing mentions)**
  - `README.md` — swap user-facing `/seo-parser` route mentions and the "SEO Parser" tool label → `/seo-audits` / "SEO Audits". (`grep -n "seo-parser\|SEO Parser" README.md` first.)
  - `CLAUDE.md` — update ONLY the tools-table row `| \`/seo-parser\` | Upload Screaming Frog CSVs → …` → `| \`/seo-audits\` | …`. **Leave** the deep historical prose (component descriptions, architecture notes) as-is — those are dated design records, not user-facing, and the rename is recorded in the tracker/handoff. Do not mass-swap CLAUDE.md.

- [ ] **Step 3: Verify no `/seo-parser` route mention remains in the skill**

Run: `grep -rn "/seo-parser" skills/er-handoff-memo`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add skills/er-handoff-memo README.md CLAUDE.md
git commit -m "docs(c11): Webapp path + README/CLAUDE tools-table → /seo-audits$'\n\n'<trailer>"
```

---

### Task 7: Live-scan results — first-class (not "archived")

**Files:**
- Modify: `lib/findings/seo-findings-fallback.ts`, `components/seo-parser/ResultsView.tsx`
- Test: `lib/findings/seo-findings-fallback.test.ts` (create if absent), `components/seo-parser/ResultsView.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `SeoSourceBadge` from `components/seo/SeoSourceBadge`.
- Produces: `buildSeoResultFromRun(run, pages, findings, origin, opts?: { archived?: boolean })` — defaults `archived: true` (preserves the session fallback). `loadRunSeoResult` selects `run.source` and passes `{ archived: run.source !== 'live-scan' }` (true live-scan → `false`; an sf-upload run hit via a run URL stays conservatively `true`). `ResultsView` derives `isLiveScan = !!runId && !sessionId` and skips both the archived and completeness banners on that branch.

- [ ] **Step 1: Amend the EXISTING builder/loader tests** — the file `lib/findings/seo-findings-fallback.test.ts` already exists. Make three edits:
  - Its `loadRunSeoResult` block currently asserts `expect(r!.archived).toBe(true)` (~line 182) for a `source:'live-scan'` run — **change it to `.toBe(false)`** (Codex: this would otherwise fail after the fix).
  - Add a builder unit test to the file:
    ```ts
    describe('buildSeoResultFromRun archived flag', () => {
      const run = { pagesTotal: 3, score: 55, domain: 'example.com' }
      it('defaults to archived:true (session prune fallback)', () => {
        expect(buildSeoResultFromRun(run, [], [], { siteName: null, files: [] }).archived).toBe(true)
      })
      it('honors archived:false when opts.archived is false', () => {
        expect(buildSeoResultFromRun(run, [], [], { siteName: null, files: [] }, { archived: false }).archived).toBe(false)
      })
    })
    ```
  - The `loadRunSeoResult` mock (~line 151) already returns `source: 'live-scan'`; the `tool: 'ada-audit'` → null test (~line 193) stays valid.

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-findings-fallback.test.ts`
Expected: FAIL (the flipped `archived` expectation + the new `archived:false` builder test).

- [ ] **Step 3: Implement the builder param + source selection** — in `lib/findings/seo-findings-fallback.ts`:
  - Change the signature to `export function buildSeoResultFromRun(run, pages, findings, origin, opts: { archived?: boolean } = {})`.
  - Replace the hardcoded `archived: true,` in the returned object with `archived: opts.archived ?? true,`.
  - In `loadRunSeoResult`, add `source: true,` to the `crawlRun.findUnique` `select` (alongside `tool`); keep the `if (run.tool !== 'seo-parser') return null` guard; pass `{ archived: run.source !== 'live-scan' }` as the 5th arg to `buildSeoResultFromRun(...)`.
  - Leave `loadArchivedSeoResult` calling with no opts (defaults to `true`).

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/seo-findings-fallback.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the live-scan branch test to the EXISTING `ResultsView.archived.test.tsx`** — that file already has `// @vitest-environment jsdom` and mocks `next/navigation` + `next/dynamic`. Reuse its structure; add a live-scan fixture (safe shape, `archived:false`) and this test (NO jest-dom — this repo uses `.toBeTruthy()`/`queryByText(...)===null`, per the note in `SeoScanForm.test.tsx`):

```tsx
const liveResult: AggregatedResult = {
  crawl_summary: { total_urls: 2 },
  issues: { critical: [], warnings: [], notices: [] },
  site_structure: {}, resources: {}, technical_seo: {}, performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0, site_name: 'live.test' },
  archived: false,
} as unknown as AggregatedResult

it('renders a live-scan run as first-class (no archived, no completeness banner)', () => {
  render(<ResultsView result={liveResult} runId="run_abc" />)
  expect(screen.queryByText(/Archived — rebuilt from findings/i)).toBeNull()
  expect(screen.getByText(/Live scan/i)).toBeTruthy() // SeoSourceBadge text
})
```

(If `AuditCompletenessBanner` renders identifiable copy, also assert that text is `null`; confirm the exact string in the component before asserting so the test is meaningful rather than vacuous.)

- [ ] **Step 6: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/ResultsView.archived.test.tsx`
Expected: FAIL (with `archived:false` + `runId`, current code renders `AuditCompletenessBanner`, no "Live scan" badge).

- [ ] **Step 7: Implement the live-scan branch in `ResultsView.tsx`**
  - After `const siteName = …`, add: `const isLiveScan = !!runId && !sessionId;`
  - Import the badge: `import { SeoSourceBadge } from '@/components/seo/SeoSourceBadge';`
  - Header block (the `result.archived ? <p>Archived…</p> : <FileProcessingPanel/>`): make it three-way —
    ```tsx
    {isLiveScan ? (
      <p className="mt-1"><SeoSourceBadge source="live-scan" /></p>
    ) : result.archived ? (
      <p className="text-gray-500 dark:text-white/50 text-sm mt-1">Archived — rebuilt from findings data</p>
    ) : (
      <FileProcessingPanel … />
    )}
    ```
  - Banner block (the `result.archived ? <ArchivedSessionBanner/> : <AuditCompletenessBanner/>`): make it —
    ```tsx
    {isLiveScan ? null : result.archived ? (
      <ArchivedSessionBanner />
    ) : (
      <AuditCompletenessBanner completeness={result.completeness ?? computeCompleteness(result)} />
    )}
    ```

- [ ] **Step 8: Run to verify pass + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/ResultsView.archived.test.tsx lib/findings/seo-findings-fallback.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/findings/seo-findings-fallback.ts components/seo-parser/ResultsView.tsx lib/findings/seo-findings-fallback.test.ts components/seo-parser/ResultsView.archived.test.tsx
git commit -m "fix(c11): live-scan results render first-class, not 'archived'$'\n\n'<trailer>"
```

---

### Task 8: Maturation — extract `SeoUploadCard`, add `SeoAuditTabs`, reshape the index

**Files:**
- Create: `components/seo-parser/SeoUploadCard.tsx`, `components/seo-parser/SeoAuditTabs.tsx`, `components/seo-parser/SeoUploadCard.test.tsx`, `components/seo-parser/SeoAuditTabs.test.tsx`
- Modify: `app/(app)/seo-audits/page.tsx`

**Interfaces:**
- Produces: `<SeoUploadCard />` (self-contained upload→analyze→reset flow, was the body of `page.tsx`); `<SeoAuditTabs />` (two tabs — `scan` default rendering `<SeoScanForm/>`, `upload` rendering `<SeoUploadCard/>`). Page becomes a thin wrapper: header + `<SeoAuditTabs/>` + `<HistoryList/>`.

- [ ] **Step 1: Create `SeoUploadCard.tsx`** — move the upload state/handlers (`handleDrop`, `handleAnalyze`, `handleReset`, the `FileDropzone`+`UploadChecklist`+Analyze/Reset button JSX, and the "Compare two crawls" link) out of the current `app/(app)/seo-audits/page.tsx` into a new client component `export function SeoUploadCard()`. It owns its own `useRouter`, `sessionId`, `files`, `isUploading`, `uploadProgress`, `isParsing`, `error` state — identical behavior, same `/api/upload` batching and `router.push(\`/seo-audits/results/${sessionId}\`)`. Wrap in the same card `div` (`bg-white dark:bg-navy-card … p-6`).

- [ ] **Step 2: Write `SeoUploadCard.test.tsx`** — start with `// @vitest-environment jsdom`; mock `next/navigation` `useRouter` (as the ResultsView tests do). A small behavior test pinning that the Analyze button is disabled until files are present / `coreMissing` is empty (drive via a minimal render or mock `missingCoreExports`). Use `.getAttribute(...)`/`.toBeTruthy()`, NOT jest-dom matchers. Mirror any existing FileDropzone test harness.

- [ ] **Step 3: Create `SeoAuditTabs.tsx`** — client component mirroring `AuditIndexTabs`' card+tab-header pattern (reuse its classNames for parity):

```tsx
'use client'
import { useState } from 'react'
import { SeoScanForm } from './SeoScanForm'
import { SeoUploadCard } from './SeoUploadCard'

type Tab = 'scan' | 'upload'

export function SeoAuditTabs() {
  const [tab, setTab] = useState<Tab>('scan') // Scan default so inbound ?scan= lands on a mounted SeoScanForm
  return (
    <div className="space-y-6">
      <div className="flex gap-2" role="tablist">
        <button role="tab" aria-selected={tab === 'scan'} onClick={() => setTab('scan')}
          className={tab === 'scan' ? 'font-display font-bold text-navy dark:text-white border-b-2 border-orange px-3 py-2' : 'text-navy/60 dark:text-white/60 px-3 py-2'}>
          Scan a URL
        </button>
        <button role="tab" aria-selected={tab === 'upload'} onClick={() => setTab('upload')}
          className={tab === 'upload' ? 'font-display font-bold text-navy dark:text-white border-b-2 border-orange px-3 py-2' : 'text-navy/60 dark:text-white/60 px-3 py-2'}>
          Upload Screaming Frog CSVs
        </button>
      </div>
      {tab === 'scan' ? <SeoScanForm /> : <SeoUploadCard />}
    </div>
  )
}
```

**Nested-card guard (Codex):** `SeoScanForm` is already wrapped in a card `div`, and `SeoUploadCard` will be too. So `SeoAuditTabs` must NOT wrap its children in another card frame — it renders only the tab-bar `<div>` + the selected child (each child owns its own card). Do not add an ADA-style outer `bg-white … rounded card` around the child panel. (Adjust tab-bar classes to match `AuditIndexTabs`' tab styling for parity; `dark:` on every element.)

- [ ] **Step 4: Write `SeoAuditTabs.test.tsx`** (jsdom + no jest-dom; mock the two children so the tabs render in isolation):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('./SeoScanForm', () => ({ SeoScanForm: () => <div data-testid="scan-panel" /> }))
vi.mock('./SeoUploadCard', () => ({ SeoUploadCard: () => <div data-testid="upload-panel" /> }))
import { SeoAuditTabs } from './SeoAuditTabs'

it('defaults to the Scan tab and switches to Upload', () => {
  render(<SeoAuditTabs />)
  expect(screen.getByTestId('scan-panel')).toBeTruthy()
  expect(screen.getByRole('tab', { name: /Scan a URL/i }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: /Upload Screaming Frog/i }))
  expect(screen.getByTestId('upload-panel')).toBeTruthy()
  expect(screen.getByRole('tab', { name: /Upload Screaming Frog/i }).getAttribute('aria-selected')).toBe('true')
})
```

- [ ] **Step 5: Run the new tests to verify they fail then pass** as you implement:

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/SeoAuditTabs.test.tsx components/seo-parser/SeoUploadCard.test.tsx`
Expected: PASS after Steps 1–4.

- [ ] **Step 6: Reshape `app/(app)/seo-audits/page.tsx`** — replace its body with a thin wrapper mirroring the ADA index header + wider container:

```tsx
import { SeoAuditTabs } from '@/components/seo-parser/SeoAuditTabs';
import { HistoryList } from '@/components/seo-parser/HistoryList';

export const metadata = { title: 'SEO Audits — ER SEO Tools' };

export default function SeoAuditsPage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="font-display font-bold text-[28px] text-navy dark:text-white">SEO Audits</h1>
        <p className="text-[14px] font-body text-navy/60 dark:text-white/60 mt-1">
          Scan a URL for on-page SEO, or upload Screaming Frog CSV exports for a prioritized report.
        </p>
      </div>
      <SeoAuditTabs />
      <HistoryList />
    </main>
  );
}
```

Note: the page is now a server component (no client state left in it). `SeoAuditTabs`, `SeoScanForm`, `SeoUploadCard`, `HistoryList` are all `'use client'`. Drop the old `'use client'` from the page. Ensure no `min-h-screen`/`bg-*` on the root (A8 shell convention).

- [ ] **Step 7: Full gate + manual sanity**

Run: `npm run lint && DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/seo-audits/page.tsx" components/seo-parser/SeoUploadCard.tsx components/seo-parser/SeoAuditTabs.tsx components/seo-parser/SeoUploadCard.test.tsx components/seo-parser/SeoAuditTabs.test.tsx
git commit -m "feat(c11): mature /seo-audits index — tabbed Scan/Upload hub (ADA mirror)$'\n\n'<trailer>"
```

---

### Task 9: Final sweep + full gates

**Files:** none (verification).

- [ ] **Step 1: Grep for stragglers** (Codex: tighten the discriminator exclusion so a line holding BOTH `tool:'seo-parser'` and an old URL isn't hidden; include README.md):

Run: `grep -rn "/seo-parser" app components lib skills README.md middleware.ts next.config.ts --include="*.ts" --include="*.tsx" --include="*.md" | grep -v "/api/seo-parser" | grep -v "@/components/seo-parser" | grep -v "@/lib/seo-parser" | grep -vE "tool.{0,4}(:|===).{0,4}'seo-parser'"`
Expected: NO output for `app components lib skills README.md`. (CLAUDE.md historical prose is intentionally out of scope — see Task 6 Step 2. Any remaining hit elsewhere is a missed link or a comment to reword — fix it in a `chore(c11)` commit.)

- [ ] **Step 2: Full gate-green**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
NODE_OPTIONS='--max-old-space-size=3072' npm run build
```
Expected: all three PASS. Record the test count.

- [ ] **Step 3: Confirm `tool`/API/imports untouched**

Run: `git diff origin/main --stat -- lib/findings lib/services | head` and spot-check that no `tool: 'seo-parser'` string, `/api/parse`, `/api/seo-parser`, or `@/…/seo-parser` import changed to `seo-audits`.
Expected: only URL hrefs changed; data/API/imports intact.

---

## Self-Review

**1. Spec coverage:**
- §3.1 route move → Task 2. §3.2 link swaps → Tasks 3, 4, 5. §3.2 skill → Task 6. §3.3/§3.4 kept-unchanged → Global Constraints + Task 9 Step 3. §4 redirects + tests → Task 1. §5 live-scan polish (builder param + isLiveScan branch + 4 guard tests) → Task 7. §6 maturation → Task 8. §7 gates → Task 9. All spec sections mapped.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Code blocks are concrete; class-name parity for `SeoAuditTabs` is explicitly flagged to match `AuditIndexTabs` during implementation (a real, bounded instruction, not a placeholder).

**3. Type consistency:** `buildSeoResultFromRun(..., opts: { archived?: boolean } = {})` — the 5th param and default are consistent between Task 7 Step 3 and the loader call. `isLiveScan = !!runId && !sessionId` uses `ResultsView`'s existing `runId`/`sessionId` props (verified present in `ResultsViewProps`). `SeoAuditTabs`/`SeoUploadCard` names match between Task 8 steps and the page import.

**Post-plan note:** verification is via `subagent-driven-development` (fresh subagent per task, two-stage review). After Task 9, proceed to PR → merge (gate-green) → deploy → post-deploy prod verification (spec §8) → tracker/handoff ritual.
